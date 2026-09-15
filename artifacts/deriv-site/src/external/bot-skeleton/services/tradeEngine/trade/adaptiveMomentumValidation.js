import { getAdaptiveMomentumSignalFromPrices } from './Ticks';

export const ADAPTIVE_MOMENTUM_VALIDATION_DISCLAIMER =
    'Paper replay metrics describe this validation sample only; they are not a profitability guarantee.';

export const getAdaptiveMomentumContractType = signal => {
    if (signal === 'CALL' || signal === 'PUT') return signal;
    return null;
};

const normalizeConfig = config => ({
    warmup: config?.warmup ?? 30,
    shortWindow: config?.shortWindow ?? 8,
    longWindow: config?.longWindow ?? 20,
    confidence: config?.confidence ?? 60,
    cooldownTicks: Math.max(0, Math.floor(Number(config?.cooldownTicks) || 0)),
    takeProfit: Number(config?.takeProfit ?? 10),
    stopLoss: Number(config?.stopLoss ?? 10),
});

const normalizeSettlement = settlement => {
    if (!settlement || !Number.isInteger(settlement.tickIndex) || settlement.tickIndex < 0) {
        throw new Error('Adaptive Momentum settlements require a non-negative integer tickIndex.');
    }
    if (!['win', 'loss'].includes(settlement.outcome)) {
        throw new Error('Adaptive Momentum settlements require a win or loss outcome.');
    }
    const profit = Number(settlement.profit);
    if (!Number.isFinite(profit)) {
        throw new Error('Adaptive Momentum settlements require a finite profit value.');
    }
    return { ...settlement, profit };
};

export const runAdaptiveMomentumPaperValidation = ({ ticks, settlements = [], config = {} }) => {
    if (!Array.isArray(ticks) || ticks.length === 0) {
        throw new Error('Adaptive Momentum paper validation requires replayable tick history.');
    }

    const normalizedConfig = normalizeConfig(config);
    const normalizedSettlements = settlements.map(normalizeSettlement);
    const settlementsByTick = new Map();
    normalizedSettlements.forEach(settlement => {
        if (settlementsByTick.has(settlement.tickIndex)) {
            throw new Error(`Only one settlement is supported per tick (${settlement.tickIndex}).`);
        }
        settlementsByTick.set(settlement.tickIndex, settlement);
    });

    const prices = [];
    const trades = [];
    const signalCounts = { CALL: 0, PUT: 0, WAIT: 0 };
    let cooldownRemaining = 0;
    let openTrade = null;
    let totalProfit = 0;
    let peakProfit = 0;
    let maxDrawdown = 0;
    let riskStop = null;
    let skippedByCooldown = 0;
    let skippedByOpenTrade = 0;
    let skippedByRiskLimit = 0;

    ticks.forEach((tick, tickIndex) => {
        const quote = Number(typeof tick === 'object' ? tick?.quote : tick);
        if (!Number.isFinite(quote)) {
            throw new Error(`Adaptive Momentum tick ${tickIndex} must contain a finite quote.`);
        }
        prices.push(quote);

        const settlement = settlementsByTick.get(tickIndex);
        if (settlement) {
            if (!openTrade) {
                throw new Error(`Adaptive Momentum settlement ${tickIndex} has no open paper trade.`);
            }
            totalProfit += settlement.profit;
            openTrade = {
                ...openTrade,
                outcome: settlement.outcome,
                profit: settlement.profit,
                settledAtTick: tickIndex,
            };
            trades[trades.length - 1] = openTrade;
            if (settlement.outcome === 'win') {
                // A winning contract immediately makes the paper runner eligible again.
                cooldownRemaining = 0;
            } else {
                cooldownRemaining = normalizedConfig.cooldownTicks;
            }
            openTrade = null;
            peakProfit = Math.max(peakProfit, totalProfit);
            maxDrawdown = Math.max(maxDrawdown, peakProfit - totalProfit);
        }

        if (
            riskStop === null &&
            (totalProfit >= normalizedConfig.takeProfit || totalProfit <= -Math.abs(normalizedConfig.stopLoss))
        ) {
            riskStop = {
                tickIndex,
                reason: totalProfit >= normalizedConfig.takeProfit ? 'take_profit' : 'stop_loss',
                totalProfit,
            };
        }
        if (riskStop) {
            skippedByRiskLimit += 1;
            return;
        }
        if (cooldownRemaining > 0) {
            cooldownRemaining -= 1;
            skippedByCooldown += 1;
            return;
        }
        if (openTrade) {
            skippedByOpenTrade += 1;
            return;
        }

        const signal = getAdaptiveMomentumSignalFromPrices(
            prices,
            normalizedConfig.warmup,
            normalizedConfig.shortWindow,
            normalizedConfig.longWindow,
            normalizedConfig.confidence
        );
        signalCounts[signal] += 1;
        const contractType = getAdaptiveMomentumContractType(signal);
        if (!contractType) return;

        const trade = {
            openedAtTick: tickIndex,
            signal,
            contractType,
            quote,
        };
        trades.push(trade);
        openTrade = trade;
    });

    return {
        disclaimer: ADAPTIVE_MOMENTUM_VALIDATION_DISCLAIMER,
        config: normalizedConfig,
        metrics: {
            ticksProcessed: ticks.length,
            signalCounts,
            purchases: trades.length,
            settledTrades: trades.filter(trade => trade.outcome).length,
            wins: trades.filter(trade => trade.outcome === 'win').length,
            losses: trades.filter(trade => trade.outcome === 'loss').length,
            totalProfit,
            maxDrawdown,
            skippedByCooldown,
            skippedByOpenTrade,
            skippedByRiskLimit,
            riskStop,
            openTrades: openTrade ? 1 : 0,
        },
        trades,
    };
};

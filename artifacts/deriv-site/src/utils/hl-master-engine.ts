// @ts-nocheck
// Direct paired runner for HL master Bot.
//
// One market tick produces two paired five-tick contracts:
//   Higher (HIGHER, +1 barrier) + Lower (LOWER, -1 barrier)
// The stake is per contract, so a $0.35 pair costs $0.70.

import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type HLMasterStatus = 'idle' | 'scanning' | 'trading' | 'stopped' | 'error';
export type HLMasterLogType = 'scan' | 'info' | 'win' | 'loss' | 'error' | 'system';

export interface HLMasterConfig {
    symbol: string;
    stake: number;
    duration?: number;
    currency?: string;
}

export interface HLMasterLog {
    seq: number;
    time: string;
    message: string;
    type: HLMasterLogType;
}

export interface HLMasterStats {
    profit: number;
    wins: number;
    losses: number;
    pairs: number;
    totalStake: number;
}

type Side = 'HIGHER' | 'LOWER';

const sides: Side[] = ['HIGHER', 'LOWER'];

const formatTime = () =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export class HLMasterEngine {
    private config: HLMasterConfig;
    private running = false;
    private tickSubId: string | null = null;
    private subscription: { unsubscribe: () => void } | null = null;
    private requestCounter = 0;
    private requestKinds = new Map<number, { kind: string; pairId?: string; side?: Side }>();
    private pendingPairs = new Map<string, { epoch: string; proposals: Partial<Record<Side, any>> }>();
    private openContracts = new Map<
        string,
        { side: Side; pairId: string; subscriptionId: string | null; stake: number }
    >();
    private pairSettlements = new Map<string, { settled: number; profit: number }>();
    private lastEpoch: string | null = null;
    private pairCounter = 0;
    private logCounter = 0;
    private profit = 0;
    private wins = 0;
    private losses = 0;
    private pairs = 0;

    onLog: (log: HLMasterLog) => void = () => {};
    onStatus: (status: HLMasterStatus) => void = () => {};
    onStats: (stats: HLMasterStats) => void = () => {};

    constructor(config: HLMasterConfig) {
        this.config = {
            ...config,
            stake: Math.max(0.35, Number(config.stake) || 0.35),
            // Deriv's Higher/Lower contracts require 5–10 ticks.
            duration: Math.max(5, Math.min(10, Number(config.duration) || 5)),
            currency: config.currency || 'USD',
        };
    }

    start(): boolean {
        if (!api_base.api) {
            this.fail('Deriv connection is not ready — please log in first.');
            return false;
        }
        if (!api_base.is_authorized) {
            this.fail('Not authorized — log in to your Deriv account first.');
            return false;
        }

        this.stop(false);
        this.running = true;
        this.lastEpoch = null;
        this.pendingPairs.clear();
        this.openContracts.clear();
        this.pairSettlements.clear();
        this.requestKinds.clear();
        this.profit = 0;
        this.wins = 0;
        this.losses = 0;
        this.pairs = 0;
        this.emitStats();
        this.onStatus('scanning');
        this.log(
            `HL master Bot ready on ${this.config.symbol} — Higher $${this.config.stake.toFixed(2)} + Lower $${this.config.stake.toFixed(2)} = $${(this.config.stake * 2).toFixed(2)} per tick.`,
            'system'
        );

        this.subscription = (api_base.api as any).onMessage().subscribe((raw: any) => {
            this.handle(raw?.data ?? raw);
        });
        this.sendTicks();
        return true;
    }

    stop(emit = true): void {
        this.running = false;
        if (this.tickSubId) {
            this.rawSend({ forget: this.tickSubId });
            this.tickSubId = null;
        }
        this.openContracts.forEach(contract => {
            if (contract.subscriptionId) this.rawSend({ forget: contract.subscriptionId });
        });
        this.subscription?.unsubscribe();
        this.subscription = null;
        this.requestKinds.clear();
        this.pendingPairs.clear();
        this.openContracts.clear();
        this.pairSettlements.clear();
        if (emit) {
            this.onStatus('stopped');
            this.log('HL master Bot stopped. No new pairs will be purchased.', 'system');
        }
    }

    getConfig(): HLMasterConfig {
        return { ...this.config };
    }

    private sendTicks(): void {
        this.send(
            {
                ticks: this.config.symbol,
                subscribe: 1,
            },
            { kind: 'ticks' }
        );
    }

    private sendProposal(pairId: string, epoch: string, side: Side): void {
        this.send(
            {
                proposal: 1,
                amount: this.config.stake,
                basis: 'stake',
                contract_type: side,
                currency: this.config.currency,
                duration: this.config.duration,
                duration_unit: 't',
                underlying_symbol: this.config.symbol,
                // Higher and Lower use opposite signed offsets. A positive
                // Lower barrier can have no return when it is too far above
                // spot, so the requested below-offset is explicitly -1.
                barrier: side === 'HIGHER' ? '+1' : '-1',
            },
            { kind: 'proposal', pairId, side, epoch }
        );
    }

    private send(payload: Record<string, unknown>, request: { kind: string; pairId?: string; side?: Side; epoch?: string }) {
        const reqId = ++this.requestCounter;
        this.requestKinds.set(reqId, request);
        this.rawSend({ req_id: reqId, ...payload });
        return reqId;
    }

    private rawSend(payload: Record<string, unknown>): void {
        try {
            (api_base.api as any)?.send(payload);
        } catch (error) {
            this.log(`Broker connection error: ${error?.message || 'unknown error'}`, 'error');
        }
    }

    private handle(message: Record<string, any>): void {
        if (!this.running || !message) return;

        const request = message.req_id !== undefined ? this.requestKinds.get(message.req_id) : undefined;
        const subId = message.subscription?.id;
        let openContract = subId
            ? [...this.openContracts.values()].find(contract => contract.subscriptionId === subId)
            : undefined;
        if (!openContract && request?.kind === 'poc' && request.pairId && request.side) {
            openContract = [...this.openContracts.values()].find(
                contract =>
                    contract.pairId === request.pairId &&
                    contract.side === request.side &&
                    contract.subscriptionId === null
            );
            if (openContract && subId) openContract.subscriptionId = subId;
        }

        if (message.error) {
            this.handleError(message, request);
            return;
        }

        switch (message.msg_type) {
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleTick(message.tick);
                break;
            case 'proposal':
                if (request?.kind === 'proposal') this.handleProposal(message.proposal, request);
                break;
            case 'buy':
                if (request?.kind === 'buy') this.handleBuy(message.buy, request);
                break;
            case 'proposal_open_contract':
                if (openContract) this.handleSettlement(message.proposal_open_contract, openContract, subId);
                break;
        }
    }

    private handleError(message: Record<string, any>, request?: { kind: string; pairId?: string; side?: Side }): void {
        const errorMessage = message.error?.message || 'Unknown broker error';
        if (request?.kind === 'proposal' && request.pairId) this.pendingPairs.delete(request.pairId);
        this.log(`Broker rejected ${request?.side || 'request'}: ${errorMessage}`, 'error');
        this.onStatus('error');
        if (this.running) {
            this.onStatus('scanning');
        }
    }

    private handleTick(tick: { quote: number; epoch?: number }): void {
        if (!tick || tick.epoch === undefined || tick.epoch === null) return;
        const epoch = String(tick.epoch);
        if (epoch === this.lastEpoch) return;
        this.lastEpoch = epoch;
        if (!this.running) return;

        this.onStatus('trading');
        const pairId = `pair-${++this.pairCounter}-${epoch}`;
        this.pendingPairs.set(pairId, { epoch, proposals: {} });
        this.log(
            `Tick ${epoch} received — pricing Higher and Lower at $${this.config.stake.toFixed(2)} each.`,
            'scan'
        );
        this.sendProposal(pairId, epoch, 'HIGHER');
        this.sendProposal(pairId, epoch, 'LOWER');
    }

    private handleProposal(proposal: Record<string, any>, request: { pairId?: string; side?: Side }): void {
        if (!request.pairId || !request.side || !proposal?.id) return;
        const pair = this.pendingPairs.get(request.pairId);
        if (!pair) return;
        pair.proposals[request.side] = proposal;

        if (!pair.proposals.HIGHER || !pair.proposals.LOWER) return;

        this.pendingPairs.delete(request.pairId);
        this.sendBuy(request.pairId, 'HIGHER', pair.proposals.HIGHER);
        this.sendBuy(request.pairId, 'LOWER', pair.proposals.LOWER);
        this.log(
            `Pair placed — Higher $${this.config.stake.toFixed(2)} + Lower $${this.config.stake.toFixed(2)} = $${(this.config.stake * 2).toFixed(2)} total.`,
            'info'
        );
    }

    private sendBuy(pairId: string, side: Side, proposal: Record<string, any>): void {
        this.send(
            { buy: proposal.id, price: Number(proposal.ask_price ?? this.config.stake) },
            { kind: 'buy', pairId, side }
        );
    }

    private handleBuy(buy: Record<string, any>, request: { pairId?: string; side?: Side }): void {
        if (!buy?.contract_id || !request.pairId || !request.side) return;
        this.openContracts.set(String(buy.contract_id), {
            side: request.side,
            pairId: request.pairId,
            subscriptionId: null,
            stake: Number(buy.buy_price ?? this.config.stake),
        });
        this.pairSettlements.set(
            request.pairId,
            this.pairSettlements.get(request.pairId) || { settled: 0, profit: 0 }
        );
        this.log(`${request.side} contract bought for $${Number(buy.buy_price ?? this.config.stake).toFixed(2)}.`, 'info');
        const reqId = this.send(
            { proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 },
            { kind: 'poc', pairId: request.pairId, side: request.side }
        );
        // The first POC response may carry the subscription id; reqId remains
        // associated with the side for brokers that omit it on the first update.
        this.requestKinds.set(reqId, { kind: 'poc', pairId: request.pairId, side: request.side });
    }

    private handleSettlement(
        contract: Record<string, any>,
        openContract: { side: Side; pairId: string; subscriptionId: string | null; stake: number },
        subId?: string
    ): void {
        if (!contract?.is_sold) return;
        if (subId) {
            openContract.subscriptionId = subId;
            this.rawSend({ forget: subId });
        }

        const contractId = String(contract.contract_id);
        this.openContracts.delete(contractId);
        const profit = Number(contract.profit ?? 0);
        const pair = this.pairSettlements.get(openContract.pairId) || { settled: 0, profit: 0 };
        pair.settled += 1;
        pair.profit += Number.isFinite(profit) ? profit : 0;
        this.pairSettlements.set(openContract.pairId, pair);

        const outcome = profit > 0 ? 'win' : 'loss';
        this.log(
            `${openContract.side} settled ${outcome.toUpperCase()} ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}.`,
            profit > 0 ? 'win' : 'loss'
        );

        if (pair.settled < 2) return;
        this.pairSettlements.delete(openContract.pairId);
        this.pairs += 1;
        this.profit += pair.profit;
        if (pair.profit > 0) this.wins += 1;
        else this.losses += 1;
        this.emitStats();
        this.log(
            `Pair #${this.pairs} settled ${pair.profit >= 0 ? 'positive' : 'negative'} ${pair.profit >= 0 ? '+' : ''}$${pair.profit.toFixed(2)}.`,
            pair.profit > 0 ? 'win' : 'loss'
        );
    }

    private emitStats(): void {
        this.onStats({
            profit: this.profit,
            wins: this.wins,
            losses: this.losses,
            pairs: this.pairs,
            totalStake: this.pairs * this.config.stake * 2,
        });
    }

    private fail(message: string): void {
        this.onStatus('error');
        this.log(message, 'error');
    }

    private log(message: string, type: HLMasterLogType): void {
        this.onLog({ seq: ++this.logCounter, time: formatTime(), message, type });
    }
}
import { observer } from '@/external/bot-skeleton/utils/observer';
import Ticks from '../Ticks';
import {
    getAdaptiveMomentumContractType,
    runAdaptiveMomentumPaperValidation,
    runAdaptiveMomentumSessionValidation,
} from '../adaptiveMomentumValidation';
import {
    ADAPTIVE_MOMENTUM_REPLAY_FIXTURE_VERSION,
    ADAPTIVE_MOMENTUM_REPLAY_FIXTURES,
} from '../adaptiveMomentumReplayFixtures';

class BaseEngine {}

describe('Ticks last-digit analysis events', () => {
    it('publishes the evaluated digits and false result for an unmet threshold', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.getPipSize = () => 2;
        engine.$scope = {
            ticksService: {
                request: jest.fn().mockResolvedValue([{ quote: 12.64 }, { quote: 12.76 }, { quote: 12.86 }]),
            },
        };

        const emit = jest.spyOn(observer, 'emit');

        await expect(engine.checkLastDigitsCondition('GREATER_OR_EQUAL', 3, 6)).resolves.toBe(false);

        expect(emit).toHaveBeenCalledWith('bot.analysis.condition', {
            market: 'R_25',
            condition: 'GREATER_OR_EQUAL',
            count: 3,
            compareValue: 6,
            digits: [4, 6, 6],
            result: false,
        });

        emit.mockRestore();
    });

    it('publishes a true result when the evaluated condition matches', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.getPipSize = () => 2;
        engine.$scope = {
            ticksService: {
                request: jest.fn().mockResolvedValue([{ quote: 12.44 }, { quote: 12.66 }, { quote: 12.88 }]),
            },
        };

        const emit = jest.spyOn(observer, 'emit');

        await expect(engine.checkLastDigitsCondition('ALL_EVEN', 3)).resolves.toBe(true);

        expect(emit).toHaveBeenCalledWith('bot.analysis.condition', {
            market: 'R_25',
            condition: 'ALL_EVEN',
            count: 3,
            compareValue: 0,
            digits: [4, 6, 8],
            result: true,
        });

        emit.mockRestore();
    });

    it('waits for a new broker tick before evaluating a requested re-analysis', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.latestTick = { epoch: 123 };
        engine.getLastDigitList = jest.fn().mockResolvedValue([1, 3, 5, 7]);
        engine.isBinaryMatrixWorkspace = () => true;
        engine.binaryMatrixStakeState = {
            reanalysisPending: true,
            reanalysisBlockedEpoch: 123,
        };

        await expect(engine.checkLastDigitsCondition('ALL_ODD', 4)).resolves.toBe(false);
        expect(engine.binaryMatrixStakeState.reanalysisPending).toBe(true);

        engine.latestTick = { epoch: 124 };
        await expect(engine.checkLastDigitsCondition('ALL_ODD', 4)).resolves.toBe(true);
        expect(engine.binaryMatrixStakeState.reanalysisPending).toBe(false);
        expect(engine.binaryMatrixStakeState.reanalysisBlockedEpoch).toBeNull();
    });

    it('signals the FAST execution loop when a subscribed tick arrives', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.store = { dispatch: jest.fn() };
        engine.observer = { emit: jest.fn() };
        engine.$scope = {
            ticksService: {
                monitor: jest.fn(async ({ callback }) => {
                    callback([{ epoch: 1234567890, quote: 12.34 }]);
                    return 'tick-listener';
                }),
            },
        };

        await engine.watchTicks('R_25');

        expect(engine.store.dispatch).toHaveBeenCalledWith({
            type: expect.any(String),
            payload: 1234567890,
        });
        expect(engine.observer.emit).toHaveBeenCalledWith('bot.tick', 1234567890);
    });

    it('restores a missing same-symbol monitor when history is already cached', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.tickListenerKey = null;
        engine.store = { dispatch: jest.fn() };
        engine.observer = { emit: jest.fn() };
        engine.$scope = {
            ticksService: {
                monitor: jest.fn(async ({ callback }) => {
                    callback([{ epoch: 1234567891, quote: 12.35 }]);
                    return 'restored-tick-listener';
                }),
            },
        };

        await engine.watchTicks('R_25');

        expect(engine.$scope.ticksService.monitor).toHaveBeenCalledTimes(1);
        expect(engine.tickListenerKey).toBe('restored-tick-listener');
        expect(engine.store.dispatch).toHaveBeenCalledWith({
            type: expect.any(String),
            payload: 1234567891,
        });
    });

    it('uses the cached live tick in either mode without requesting history again', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.getPipSize = () => 2;
        engine.latestTick = { epoch: 1234567890, quote: 12.34 };
        engine.$scope = {
            ticksService: {
                request: jest.fn(),
            },
        };

        await expect(engine.getLastTick(true)).resolves.toEqual({
            epoch: 1234567890,
            quote: 12.34,
        });

        expect(engine.$scope.ticksService.request).not.toHaveBeenCalled();
    });

    it('supports the Analysis Logics frequency, percentage, direction, and nth-digit methods', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.getPipSize = () => 2;
        engine.$scope = {
            ticksService: {
                request: jest
                    .fn()
                    .mockResolvedValue([{ quote: 12.64 }, { quote: 12.76 }, { quote: 12.86 }, { quote: 12.95 }]),
            },
        };

        await expect(engine.getMostFrequentDigit(1000, 'most')).resolves.toBe(6);
        await expect(engine.getMostFrequentDigit(1000, 'second_most')).resolves.toBe(4);
        await expect(engine.getMostFrequentDigit(1000, 'least')).resolves.toBe(0);
        await expect(engine.getMostFrequentDigit(1000, 'second_least')).resolves.toBe(1);
        await expect(engine.getParityPercentage('even', 1000)).resolves.toBe(75);
        await expect(engine.getBarrierPercentage('over', 5, 1000)).resolves.toBe(50);
        await expect(engine.getDigitPercentage(6, 1000, 'match')).resolves.toBe(50);
        await expect(engine.getDirectionPercentage('rise', 1000)).resolves.toBe(100);
        await expect(engine.checkLastNTicksDirection('rise', 3)).resolves.toBe(true);
        await expect(engine.getNthLastDigit(2)).resolves.toBe(6);
    });

    it('returns CALL, PUT, or WAIT from confirmed adaptive momentum windows', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.$scope = {
            ticksService: {
                request: jest
                    .fn()
                    .mockResolvedValue([
                        { quote: 1 },
                        { quote: 2 },
                        { quote: 3 },
                        { quote: 4 },
                        { quote: 5 },
                        { quote: 4 },
                        { quote: 5 },
                        { quote: 6 },
                        { quote: 7 },
                        { quote: 8 },
                    ]),
            },
        };

        await expect(engine.getAdaptiveMomentumSignal(5, 4, 8, 40)).resolves.toBe('CALL');
        await expect(engine.getAdaptiveMomentumSignal(20, 4, 8, 40)).resolves.toBe('WAIT');

        engine.$scope.ticksService.request.mockResolvedValue([
            { quote: 8 },
            { quote: 7 },
            { quote: 6 },
            { quote: 5 },
            { quote: 4 },
            { quote: 3 },
            { quote: 2 },
            { quote: 1 },
            { quote: 0 },
        ]);
        await expect(engine.getAdaptiveMomentumSignal(5, 4, 8, 40)).resolves.toBe('PUT');
    });

    it('returns WAIT for ambiguous windows and enforces the confidence threshold', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.$scope = {
            ticksService: {
                request: jest.fn().mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8, 7].map(quote => ({ quote }))),
            },
        };

        await expect(engine.getAdaptiveMomentumSignal(5, 4, 8, 51)).resolves.toBe('WAIT');
        await expect(engine.getAdaptiveMomentumSignal(5, 4, 8, 50)).resolves.toBe('CALL');

        engine.$scope.ticksService.request.mockResolvedValue([1, 2, 1, 2, 1, 2, 1, 2, 1].map(quote => ({ quote })));
        await expect(engine.getAdaptiveMomentumSignal(5, 4, 8, 1)).resolves.toBe('WAIT');
    });

    it('calculates predicted signal confidence from the requested recent tick window', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.$scope = {
            ticksService: {
                request: jest
                    .fn()
                    .mockResolvedValue([1, 2, 3, 2, 3, 4].map(quote => ({ quote }))),
            },
        };

        await expect(engine.getSignalConfidence('CALL', 5)).resolves.toBe(80);
        await expect(engine.getSignalConfidence('PUT', 5)).resolves.toBe(20);
        await expect(engine.getSignalConfidence('WAIT', 5)).resolves.toBe(0);
    });

    it('closes the purchase gate when current-tick confidence is below the minimum', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.store = {
            getState: () => ({ newTick: 123 }),
        };
        engine.lastSignalConfidenceEvaluation = {
            signal: 'CALL',
            confidence: 54,
            minimum: 55,
            tick: 123,
        };
        engine.recordIndicatorValue('adx', 30);
        engine.recordIndicatorValue('rsi', 60);
        engine.recordIndicatorValue('macd', 1);

        expect(engine.isPurchaseConditionGateOpen('CALL')).toBe(false);

        engine.lastSignalConfidenceEvaluation.confidence = 55;
        expect(engine.isPurchaseConditionGateOpen('CALL')).toBe(true);
    });

    it('keeps the first qualified volatility locked for the bot session', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = '1HZ100V';
        engine.options = { symbol: '1HZ100V' };
        engine.tradeOptions = { symbol: '1HZ100V' };
        engine.volatilitySelectionLock = {
            code: '1HZ25V',
            label: 'Volatility 25 (1s) Index',
            signal: 'CALL',
            confidence: 62,
        };
        engine.watchTicks = jest.fn(async symbol => {
            engine.symbol = symbol;
        });
        engine.makeProposals = jest.fn();
        engine.$scope = {
            ticksService: {
                request: jest.fn(),
            },
        };

        await expect(engine.scanVolatilityUntilQualified()).resolves.toBe(true);

        expect(engine.$scope.ticksService.request).not.toHaveBeenCalled();
        expect(engine.watchTicks).toHaveBeenCalledTimes(1);
        expect(engine.watchTicks).toHaveBeenCalledWith('1HZ25V');
        expect(engine.options.symbol).toBe('1HZ25V');
        expect(engine.tradeOptions.symbol).toBe('1HZ25V');
        expect(engine.makeProposals).toHaveBeenCalledTimes(1);

        await expect(engine.scanVolatilityUntilQualified()).resolves.toBe(true);
        expect(engine.$scope.ticksService.request).not.toHaveBeenCalled();
        expect(engine.watchTicks).toHaveBeenCalledTimes(1);
    });

    it('blocks a purchase when the engine no longer points at the locked volatility', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = '1HZ100V';
        engine.tradeOptions = { symbol: '1HZ100V' };
        engine.volatilitySelectionLock = { code: '1HZ25V' };
        engine.store = {
            getState: () => ({ newTick: 123 }),
        };

        expect(engine.isPurchaseConditionGateOpen('CALL')).toBe(false);

        engine.symbol = '1HZ25V';
        engine.tradeOptions = { symbol: '1HZ25V' };
        expect(engine.isPurchaseConditionGateOpen('CALL')).toBe(true);
    });

    it('publishes grouped Adaptive Momentum journal events with confidence and tick details', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.$scope = {
            ticksService: {
                request: jest
                    .fn()
                    .mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8, 9].map(quote => ({ quote }))),
            },
        };

        const emit = jest.spyOn(observer, 'emit');

        await expect(engine.getAdaptiveMomentumSignal(5, 4, 8, 50)).resolves.toBe('CALL');

        expect(emit).toHaveBeenCalledWith(
            'bot.adaptive_momentum.log',
            expect.objectContaining({
                event: 'analysis',
                market: 'R_25',
                tickCount: 9,
                requiredTicks: 9,
                confidence: 50,
                signal: 'CALL',
                signalConfidence: 100,
            })
        );
        expect(emit).toHaveBeenCalledWith(
            'bot.adaptive_momentum.log',
            expect.objectContaining({
                event: 'decision',
                signal: 'CALL',
                reason: 'confidence_confirmed',
            })
        );

        emit.mockClear();
        await expect(engine.getAdaptiveMomentumSignal(5, 4, 8, 50)).resolves.toBe('CALL');
        expect(emit).toHaveBeenCalledWith(
            'bot.adaptive_momentum.log',
            expect.objectContaining({ event: 'analysis', signal: 'CALL' })
        );
        expect(emit).not.toHaveBeenCalledWith(
            'bot.adaptive_momentum.log',
            expect.objectContaining({ event: 'decision' })
        );

        emit.mockRestore();
    });

    it('publishes a grouped skip event when history is not ready', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.$scope = {
            ticksService: {
                request: jest.fn().mockResolvedValue([1, 2, 3].map(quote => ({ quote }))),
            },
        };

        const emit = jest.spyOn(observer, 'emit');

        await expect(engine.getAdaptiveMomentumSignal(5, 4, 8, 50)).resolves.toBe('WAIT');

        expect(emit).toHaveBeenCalledWith(
            'bot.adaptive_momentum.log',
            expect.objectContaining({
                event: 'skip',
                reason: 'insufficient_history',
                signalConfidence: 0,
            })
        );

        emit.mockRestore();
    });

    it('replays loss cooldown progression and maps directional signals to paper contracts', () => {
        const result = runAdaptiveMomentumPaperValidation({
            ticks: Array.from({ length: 14 }, (_, index) => index + 1),
            settlements: [{ tickIndex: 9, outcome: 'loss', profit: -1 }],
            config: {
                warmup: 5,
                shortWindow: 4,
                longWindow: 8,
                confidence: 50,
                cooldownTicks: 2,
                takeProfit: 10,
                stopLoss: 10,
            },
        });

        expect(result.metrics.signalCounts).toEqual({ CALL: 2, PUT: 0, WAIT: 8 });
        expect(result.metrics.purchases).toBe(2);
        expect(result.metrics.skippedByCooldown).toBe(2);
        expect(result.trades).toEqual([
            expect.objectContaining({ openedAtTick: 8, signal: 'CALL', contractType: 'CALL', outcome: 'loss' }),
            expect.objectContaining({ openedAtTick: 11, signal: 'CALL', contractType: 'CALL' }),
        ]);
        expect(getAdaptiveMomentumContractType('WAIT')).toBeNull();
        expect(getAdaptiveMomentumContractType('CALL')).toBe('CALL');
        expect(getAdaptiveMomentumContractType('PUT')).toBe('PUT');
    });

    it('stops the paper runner at take-profit and stop-loss limits', () => {
        const baseConfig = { warmup: 5, shortWindow: 4, longWindow: 8, confidence: 50 };
        const takeProfit = runAdaptiveMomentumPaperValidation({
            ticks: Array.from({ length: 13 }, (_, index) => index + 1),
            settlements: [{ tickIndex: 9, outcome: 'win', profit: 3 }],
            config: { ...baseConfig, takeProfit: 3, stopLoss: 10 },
        });
        const stopLoss = runAdaptiveMomentumPaperValidation({
            ticks: Array.from({ length: 13 }, (_, index) => index + 1),
            settlements: [{ tickIndex: 9, outcome: 'loss', profit: -3 }],
            config: { ...baseConfig, takeProfit: 10, stopLoss: 3, cooldownTicks: 2 },
        });

        expect(takeProfit.metrics.riskStop).toEqual({ tickIndex: 9, reason: 'take_profit', totalProfit: 3 });
        expect(takeProfit.metrics.purchases).toBe(1);
        expect(takeProfit.metrics.skippedByRiskLimit).toBe(4);
        expect(stopLoss.metrics.riskStop).toEqual({ tickIndex: 9, reason: 'stop_loss', totalProfit: -3 });
        expect(stopLoss.metrics.purchases).toBe(1);
        expect(stopLoss.metrics.skippedByRiskLimit).toBe(4);
    });

    it('never purchases WAIT signals and reports validation metrics with a disclaimer', () => {
        const result = runAdaptiveMomentumPaperValidation({
            ticks: [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1],
            config: { warmup: 5, shortWindow: 4, longWindow: 8, confidence: 1 },
        });

        expect(result.metrics.signalCounts).toEqual({ CALL: 0, PUT: 0, WAIT: 11 });
        expect(result.metrics.purchases).toBe(0);
        expect(result.trades).toEqual([]);
        expect(result.disclaimer).toMatch(/not a profitability guarantee/i);
    });

    it('replays versioned chronological sessions and reports in-sample and out-of-sample metrics separately', () => {
        const { inSample, outOfSample } = ADAPTIVE_MOMENTUM_REPLAY_FIXTURES;
        const result = runAdaptiveMomentumSessionValidation({
            inSample,
            outOfSample,
            fixtureVersion: ADAPTIVE_MOMENTUM_REPLAY_FIXTURE_VERSION,
            config: {
                warmup: 5,
                shortWindow: 4,
                longWindow: 8,
                confidence: 50,
                cooldownTicks: 0,
                takeProfit: 100,
                stopLoss: 100,
            },
        });

        expect(inSample.ticks[0].epoch).toBeLessThan(inSample.ticks[inSample.ticks.length - 1].epoch);
        expect(outOfSample.ticks[0].epoch).toBeLessThan(outOfSample.ticks[outOfSample.ticks.length - 1].epoch);
        expect(inSample.capturedAt).toBe('2026-09-08');
        expect(outOfSample.capturedAt).toBe('2026-09-09');
        expect(result.fixtureVersion).toBe(ADAPTIVE_MOMENTUM_REPLAY_FIXTURE_VERSION);
        expect(result.metrics.inSample).toEqual(result.sessions.inSample.metrics);
        expect(result.metrics.outOfSample).toEqual(result.sessions.outOfSample.metrics);
        expect(result.metrics.inSample).not.toEqual(result.metrics.outOfSample);
        expect(result.sessions.inSample.metrics.signalCounts).toEqual({ CALL: 12, PUT: 0, WAIT: 8 });
        expect(result.sessions.outOfSample.metrics.signalCounts).toEqual({ CALL: 0, PUT: 12, WAIT: 8 });
        expect(result.sessions.inSample.metrics.totalProfit).toBe(3);
        expect(result.sessions.outOfSample.metrics.totalProfit).toBe(-3);
        expect(result.disclaimer).toMatch(/not a profitability guarantee/i);
        expect(result.executionMode).toBe('paper');
        expect(result.livePurchasesEnabled).toBe(false);
    });
});

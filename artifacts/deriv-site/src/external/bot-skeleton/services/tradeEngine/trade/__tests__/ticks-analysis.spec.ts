import { observer } from '@/external/bot-skeleton/utils/observer';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import Ticks, { analyzeSmartOver2RecoveryDigits, getSmartOver2V3EntryAssessment } from '../Ticks';
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
    it.each([
        [[3, 4, 5, 6], true],
        [[3, 4, 5, 7], false],
        [[2, 3, 4, 6], false],
        [[3, 4, 6], false],
    ])('applies the V3 all-digits-3-through-6 entry rule to %s', (digits, expected) => {
        expect(getSmartOver2V3EntryAssessment(digits, 4)).toEqual(
            expect.objectContaining({
                count: 4,
                digits,
                entryWindowReady: digits.length === 4,
                entryWindowMatches: expected,
                result: expected,
            })
        );
    });

    it('checks only the Last X digits selected in the startup setting', () => {
        expect(getSmartOver2V3EntryAssessment([3, 7, 3, 5], 2)).toEqual(
            expect.objectContaining({
                count: 2,
                digits: [3, 5],
                entryWindowReady: true,
                entryWindowMatches: true,
                result: true,
            })
        );
    });

    it('publishes V3 live digits and the 3–6 gate result on the shared analysis event', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const emit = jest.spyOn(observer, 'emit');
        engine.configureSmartOver2V3(true, 1);
        engine.tradeOptions = { amount: 0.5, symbol: '1HZ50V' };
        engine.latestTick = { epoch: 100, quote: '2591.500' };
        engine.getLastDigitList = jest.fn().mockResolvedValue([3, 4, 5, 7]);

        await expect(engine.checkSmartOver2V3Entry(1.2, true, 5, 30, 'smart-over-2')).resolves.toBe(false);

        expect(emit).toHaveBeenCalledWith(
            'bot.analysis.smart_over2',
            expect.objectContaining({
                version: 'v3',
                journalScope: 'smart-over-2',
                market: '1HZ50V',
                count: 4,
                digits: [3, 4, 5, 7],
                entryWindowReady: true,
                entryWindowMatches: false,
                result: false,
                prediction: 2,
                useVirtualHook: true,
                virtualLosses: 0,
                maxVirtualLosses: 1,
                waitingForVirtualHook: false,
            })
        );
        emit.mockRestore();
    });

    it('resets Even Odd Strike Eagle virtual loss streaks on wins and unlocks live trades per side', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const emit = jest.spyOn(observer, 'emit');
        engine.configureEvenOddStrikeEagleVirtualHook(2);
        engine.tradeOptions = { symbol: '1HZ25V' };
        engine.getLastDigit = jest
            .fn()
            .mockResolvedValueOnce(3)
            .mockResolvedValueOnce(4)
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce(7)
            .mockResolvedValueOnce(7);

        const checkA = () => engine.checkEvenOddStrikeEagleVirtualHook('A');
        engine.latestTick = { epoch: 100, quote: '2591.500' };
        await expect(checkA()).resolves.toBe(false);
        expect(engine.getEvenOddStrikeEagleVirtualHookState().pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITEVEN', entryEpoch: 100 })
        );

        engine.latestTick = { epoch: 101, quote: '2591.490' };
        await expect(checkA()).resolves.toBe(false);
        expect(engine.getEvenOddStrikeEagleVirtualHookState().virtualLosses).toBe(1);

        engine.latestTick = { epoch: 102, quote: '2591.480' };
        await expect(checkA()).resolves.toBe(false);
        engine.latestTick = { epoch: 103, quote: '2591.470' };
        await expect(checkA()).resolves.toBe(false);
        expect(engine.getEvenOddStrikeEagleVirtualHookState().virtualLosses).toBe(0);

        engine.latestTick = { epoch: 104, quote: '2591.460' };
        await expect(checkA()).resolves.toBe(false);
        engine.latestTick = { epoch: 105, quote: '2591.450' };
        await expect(checkA()).resolves.toBe(false);
        expect(engine.getEvenOddStrikeEagleVirtualHookState().virtualLosses).toBe(1);

        engine.latestTick = { epoch: 106, quote: '2591.440' };
        await expect(checkA()).resolves.toBe(false);
        engine.latestTick = { epoch: 107, quote: '2591.430' };
        await expect(checkA()).resolves.toBe(false);
        expect(engine.getEvenOddStrikeEagleVirtualHookState().virtualLosses).toBe(2);
        await expect(checkA()).resolves.toBe(false);

        engine.latestTick = { epoch: 108, quote: '2591.420' };
        await expect(checkA()).resolves.toBe(true);
        engine.latestTick = { epoch: 109, quote: '2591.410' };
        await expect(checkA()).resolves.toBe(true);

        const checkB = () => engine.checkEvenOddStrikeEagleVirtualHook('B');
        await expect(checkB()).resolves.toBe(false);
        expect(engine.getEvenOddStrikeEagleVirtualHookState()).toMatchObject({
            activeSide: 'B',
            virtualLosses: 0,
            pendingVirtualTrade: null,
        });
        engine.latestTick = { epoch: 110, quote: '2591.400' };
        await expect(checkB()).resolves.toBe(false);
        expect(engine.getEvenOddStrikeEagleVirtualHookState().pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITODD', entryEpoch: 110 })
        );
        engine.latestTick = { epoch: 111, quote: '2591.390' };
        await expect(checkB()).resolves.toBe(false);
        expect(engine.getEvenOddStrikeEagleVirtualHookState().virtualLosses).toBe(0);

        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                journalScope: 'even-odd-strike-eagle',
                event: 'virtual_settlement',
                contractType: 'DIGITEVEN',
                outcome: 'loss',
                virtualLosses: 1,
            })
        );
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                journalScope: 'even-odd-strike-eagle',
                event: 'live_ready',
                side: 'A',
                maxVirtualLosses: 2,
            })
        );
        emit.mockRestore();
    });

    it('simulates Over 2 until the configured virtual losses, then queues only a live Over 2', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.configureSmartOver2V3(true, 2, 4, 2);
        const state = engine.getSmartOver2V3State();
        expect(state.entryDigitCount).toBe(4);
        engine.tradeOptions = { amount: 0.5, symbol: '1HZ50V' };
        engine.latestTick = { epoch: 100, quote: '2591.500' };
        engine.getLastDigitList = jest.fn().mockResolvedValue([3, 4, 5, 6]);
        engine.getLastDigit = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1);
        const check = () => engine.checkSmartOver2V3Entry(1.2, true, 5, 30, 'smart-over-2');

        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITOVER', prediction: 2, entryEpoch: 100 })
        );
        expect(state.pendingPurchase).toBeNull();

        engine.latestTick = { epoch: 101, quote: '2591.490' };
        await expect(check()).resolves.toBe(false);
        expect(state.virtualLosses).toBe(1);
        expect(state.pendingPurchase).toBeNull();

        engine.latestTick = { epoch: 102, quote: '2591.480' };
        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITOVER', prediction: 2, entryEpoch: 102 })
        );

        engine.latestTick = { epoch: 103, quote: '2591.470' };
        await expect(check()).resolves.toBe(false);
        expect(state.virtualLosses).toBe(2);
        expect(state.pendingPurchase).toBeNull();

        engine.latestTick = { epoch: 104, quote: '2591.460' };
        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ contractType: 'DIGITOVER', prediction: 2 })
        );

        const plan = engine.getSmartOver2V3PurchasePlan('DIGITUNDER', 5);
        expect(plan).toEqual(
            expect.objectContaining({
                blocked: false,
                contractType: 'DIGITOVER',
                prediction: 2,
                order: state.pendingPurchase,
            })
        );
        const order = engine.beginSmartOver2V3Purchase(plan.order);
        expect(order).toEqual(expect.objectContaining({ contractType: 'DIGITOVER', prediction: 2 }));
        expect(engine.completeSmartOver2V3Purchase(order, { buy_price: 0.5, contract_id: 'v3-live-over' })).toBe(
            true
        );

        engine.lastSettledContract = {
            contract_id: 'v3-live-over',
            status: 'lost',
            buy_price: 0.5,
            sell_price: 0,
            profit: -0.5,
        };
        expect(engine.completeSmartOver2V3Settlement('smart-over-2')).toBe(false);
        expect(state.virtualLosses).toBe(0);
        expect(state.lastPurchasedContractId).toBeNull();
        expect(state.currentStake).toBe(0.6);
        expect(engine.getSmartOver2V3PurchasePlan('DIGITUNDER', 5).blocked).toBe(true);
    });

    it('uses startup Last X and Over Prediction for both virtual checks and real Over orders', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const emit = jest.spyOn(observer, 'emit');
        engine.configureSmartOver2V3(true, 1, 2, 4);
        engine.tradeOptions = { amount: 0.5, symbol: '1HZ50V' };
        engine.latestTick = { epoch: 100, quote: '2591.500' };
        engine.getLastDigitList = jest.fn().mockResolvedValue([3, 7, 3, 5]);
        engine.getLastDigit = jest.fn().mockResolvedValue(4);
        engine.purchase = jest.fn().mockResolvedValue(true);
        const check = () => engine.checkSmartOver2V3Entry(1.2, true, 5, 30, 'smart-over-2');
        const state = engine.getSmartOver2V3State();

        await expect(check()).resolves.toBe(false);
        expect(state.entryDigitCount).toBe(2);
        expect(state.overPrediction).toBe(4);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITOVER', prediction: 4, entryEpoch: 100 })
        );

        engine.latestTick = { epoch: 101, quote: '2591.490' };
        await expect(check()).resolves.toBe(false);
        expect(state.virtualLosses).toBe(1);
        expect(state.pendingVirtualTrade).toBeNull();

        engine.latestTick = { epoch: 102, quote: '2591.480' };
        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ contractType: 'DIGITOVER', prediction: 4 })
        );
        const plan = engine.getSmartOver2V3PurchasePlan('DIGITUNDER', 2);
        expect(plan).toEqual(
            expect.objectContaining({ blocked: false, contractType: 'DIGITOVER', prediction: 4 })
        );
        await expect(engine.purchaseSmartOver2V3('smart-over-2')).resolves.toBe(true);
        expect(engine.purchase).toHaveBeenCalledWith('DIGITOVER', 4);

        const order = engine.beginSmartOver2V3Purchase(plan.order);
        expect(order).toEqual(expect.objectContaining({ contractType: 'DIGITOVER', prediction: 4 }));
        expect(engine.completeSmartOver2V3Purchase(order, { buy_price: 0.5, contract_id: 'v3-live-over4' })).toBe(
            true
        );
        engine.lastSettledContract = {
            contract_id: 'v3-live-over4',
            status: 'lost',
            buy_price: 0.5,
            sell_price: 0,
            profit: -0.5,
        };
        engine.latestTick = { epoch: 103, quote: '2591.470' };
        expect(engine.completeSmartOver2V3Settlement('smart-over-2')).toBe(false);
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'settlement',
                prediction: 4,
                message: expect.stringContaining('Live Over 4 settled'),
            })
        );
        emit.mockRestore();
    });

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

    it('allows Smart Over 2 only when the full selected window is 3–7', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.getLastDigitList = jest.fn().mockResolvedValue([1, 2, 3, 5, 6]);

        await expect(engine.checkSmartOver2Entry(3)).resolves.toBe(true);
        await expect(engine.checkSmartOver2Entry(5)).resolves.toBe(false);
    });

    it.each([
        [
            [1, 3, 4, 5, 6],
            4,
            {
                digits: [3, 4, 5, 6],
                lastThree: [4, 5, 6],
                entryWindowReady: true,
                entryWindowMatches: true,
                skipWindowReady: true,
                skipHighTriple: false,
                skipLowTriple: false,
                result: true,
            },
        ],
        [
            [8, 9, 7],
            1,
            {
                digits: [7],
                lastThree: [8, 9, 7],
                entryWindowReady: true,
                entryWindowMatches: true,
                skipWindowReady: true,
                skipHighTriple: true,
                skipLowTriple: false,
                result: false,
            },
        ],
        [
            [8, 0, 1, 2],
            1,
            {
                digits: [2],
                lastThree: [0, 1, 2],
                entryWindowReady: true,
                entryWindowMatches: false,
                skipWindowReady: true,
                skipHighTriple: false,
                skipLowTriple: true,
                result: false,
            },
        ],
        [
            [3, 4],
            4,
            {
                digits: [3, 4],
                lastThree: [3, 4],
                entryWindowReady: false,
                entryWindowMatches: false,
                skipWindowReady: false,
                skipHighTriple: false,
                skipLowTriple: false,
                result: false,
            },
        ],
    ])('publishes the window and each Smart Over 2 rule for %s', async (digits, count, expected) => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.getLastDigitList = jest.fn().mockResolvedValue(digits);
        const emit = jest.spyOn(observer, 'emit');

        await expect(engine.checkSmartOver2Entry(count, 'rise-fall-master')).resolves.toBe(expected.result);

        expect(emit).toHaveBeenCalledWith('bot.analysis.smart_over2', {
            market: 'R_25',
            count,
            ...expected,
            journalScope: 'rise-fall-master',
        });
        emit.mockRestore();
    });

    it('does not publish Smart Over 2 Journal diagnostics unless the bot opts in', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.getLastDigitList = jest.fn().mockResolvedValue([3, 4, 5, 6]);
        const emit = jest.spyOn(observer, 'emit');

        await expect(engine.checkSmartOver2Entry(4)).resolves.toBe(true);

        expect(emit).not.toHaveBeenCalledWith(
            'bot.analysis.smart_over2',
            expect.objectContaining({ journalScope: 'rise-fall-master' })
        );
        emit.mockRestore();
    });

    it('publishes Smart Over 2 diagnostics with the active Smart Over 2 scope', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = 'R_25';
        engine.getLastDigitList = jest.fn().mockResolvedValue([3, 4, 5, 6]);
        const emit = jest.spyOn(observer, 'emit');

        await expect(engine.checkSmartOver2Entry(4, 'smart-over-2')).resolves.toBe(true);

        expect(emit).toHaveBeenCalledWith(
            'bot.analysis.smart_over2',
            expect.objectContaining({ journalScope: 'smart-over-2', result: true })
        );
        emit.mockRestore();
    });

    it.each([
        [[3, 7, 7, 7], 4, 'all 7s even though they satisfy the entry range'],
        [[4, 8, 8, 9], 1, 'an all-high latest-three skip even when the entry window is shorter'],
        [[7, 0, 1, 2], 1, 'an all-low latest-three skip even when the entry window is shorter'],
    ])('overrides entry eligibility for %s (%s)', async (digits, count) => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.getLastDigitList = jest.fn().mockResolvedValue(digits);

        await expect(engine.checkSmartOver2Entry(count)).resolves.toBe(false);
    });

    it('does not allow Smart Over 2 until both windows have enough digits', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.getLastDigitList = jest.fn().mockResolvedValue([3, 4]);

        await expect(engine.checkSmartOver2Entry(1)).resolves.toBe(false);
        await expect(engine.checkSmartOver2Entry(3)).resolves.toBe(false);
    });

    it('uses ungated Under 5 for real recovery when the Virtual Hook is off', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        state.useVirtualHook = false;
        state.maxVirtualLosses = 0;
        state.stage = 1;
        state.currentStake = 0.6;
        state.martingaleMultiplier = 1.2;
        engine.getLastDigitList = jest.fn().mockResolvedValue([9, 8, 9]);
        const emit = jest.spyOn(observer, 'emit');

        await expect(engine.checkSmartOver2Recovery(4, 100, 'smart-over-2')).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 })
        );
        expect(engine.getLastDigitList).not.toHaveBeenCalled();
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'status',
                stage: 1,
                message: expect.stringContaining('Under 5 is ready'),
                stake: 0.6,
                martingaleMultiplier: 1.2,
            })
        );

        state.pendingPurchase = null;
        await expect(engine.checkSmartOver2Recovery(4, 100, 'smart-over-2')).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 })
        );
        expect(engine.getLastDigitList).not.toHaveBeenCalled();
        emit.mockRestore();
    });

    it('defaults Smart Over 2 Virtual Hook on and enables it in the trade engine', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        const enableVirtualHook = jest.fn();
        engine.enableVirtualHook = enableVirtualHook;
        engine.getLastDigitList = jest.fn().mockResolvedValue([]);

        expect(state.useVirtualHook).toBe(true);
        expect(state.maxVirtualLosses).toBe(2);
        await engine.checkSmartOver2Recovery(undefined, 100, 'smart-over-2');
        expect(enableVirtualHook).toHaveBeenLastCalledWith(true);
    });

    it('requires consecutive virtual losses to start real Under recovery, then repeats real recovery until a win', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        const emit = jest.spyOn(observer, 'emit');
        engine.latestTick = { epoch: 100, quote: '2591.511' };
        engine.tradeOptions = { amount: 0.5, symbol: 'R_25' };
        engine.getLastDigitList = jest.fn().mockResolvedValue([3, 4, 5, 6]);
        engine.getLastDigit = jest.fn().mockResolvedValue(7);
        engine.setVirtualHookSettings = jest.fn();
        engine.enableVirtualHook = jest.fn();
        const check = () =>
            engine.checkSmartOver2Recovery(4, 100, 'smart-over-2', 1.2, true, 2, 5, true, 2, 5, 30);

        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 0, contractType: 'DIGITOVER', prediction: 2 })
        );
        expect(state.pendingVirtualTrade).toBeNull();
        expect(engine.setVirtualHookSettings).toHaveBeenCalledWith(2, 1);
        expect(engine.enableVirtualHook).toHaveBeenCalledWith(true);

        const initialOrder = engine.beginSmartOver2RecoveryPurchase(state.pendingPurchase);
        expect(initialOrder).toEqual(expect.objectContaining({ stage: 0, contractType: 'DIGITOVER' }));
        engine.completeSmartOver2RecoveryPurchase(initialOrder, { buy_price: 0.5, contract_id: 'initial-over' });
        engine.lastSettledContract = {
            contract_id: 'initial-over',
            status: 'lost',
            buy_price: 0.5,
            sell_price: 0,
            profit: -0.5,
        };
        expect(engine.completeSmartOver2Recovery('smart-over-2')).toBe(false);
        expect(state.stage).toBe(1);
        expect(state.virtualLosses).toBe(0);

        engine.latestTick = { epoch: 101, quote: '2591.458' };
        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({
                stage: 1,
                contractType: 'DIGITUNDER',
                prediction: 5,
                entryEpoch: 101,
                entrySpot: '2591.458',
            })
        );
        expect(state.pendingPurchase).toBeNull();

        engine.latestTick = { epoch: 102, quote: '2591.421' };
        await expect(check()).resolves.toBe(false);
        expect(state.virtualLosses).toBe(1);
        expect(state.pendingVirtualTrade).toBeNull();
        expect(state.lastVirtualSettlementEpoch).toBe(102);
        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toBeNull();
        expect(state.pendingPurchase).toBeNull();
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'virtual_settlement',
                outcome: 'loss',
                entrySpot: '2591.458',
                exitSpot: '2591.421',
                entryEpoch: 101,
                settlementEpoch: 102,
            })
        );

        engine.latestTick = { epoch: 103, quote: '2591.399' };
        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({
                stage: 1,
                contractType: 'DIGITUNDER',
                prediction: 5,
                entryEpoch: 103,
            })
        );

        engine.latestTick = { epoch: 104, quote: '2591.382' };
        await expect(check()).resolves.toBe(false);
        expect(state.stage).toBe(1);
        expect(state.virtualLosses).toBe(2);

        engine.latestTick = { epoch: 105, quote: '2591.367' };
        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 })
        );
        expect(state.recoveryRealMode).toBe(true);
        const recoveryOrder = engine.beginSmartOver2RecoveryPurchase(state.pendingPurchase);
        engine.completeSmartOver2RecoveryPurchase(recoveryOrder, { buy_price: 0.6, contract_id: 'first-recovery' });
        engine.lastSettledContract = {
            contract_id: 'first-recovery',
            status: 'lost',
            buy_price: 0.6,
            sell_price: 0,
            profit: -0.6,
        };
        expect(engine.completeSmartOver2Recovery('smart-over-2')).toBe(false);
        expect(state.stage).toBe(1);
        expect(state.recoveryRealMode).toBe(true);
        expect(state.virtualLosses).toBe(0);
        expect(state.currentStake).toBe(0.72);

        engine.latestTick = { epoch: 106, quote: '2591.354' };
        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 })
        );
        expect(state.pendingVirtualTrade).toBeNull();
        const nextRecoveryOrder = engine.beginSmartOver2RecoveryPurchase(state.pendingPurchase);
        engine.completeSmartOver2RecoveryPurchase(nextRecoveryOrder, {
            buy_price: 0.72,
            contract_id: 'second-recovery',
        });
        engine.lastSettledContract = {
            contract_id: 'second-recovery',
            status: 'lost',
            buy_price: 0.72,
            sell_price: 0,
            profit: -0.72,
        };
        expect(engine.completeSmartOver2Recovery('smart-over-2')).toBe(false);
        expect(state.stage).toBe(1);
        expect(state.recoveryRealMode).toBe(true);
        expect(state.currentStake).toBe(0.86);
        expect(state.pendingVirtualTrade).toBeNull();

        engine.latestTick = { epoch: 107, quote: '2591.347' };
        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 })
        );
        const winningRecoveryOrder = engine.beginSmartOver2RecoveryPurchase(state.pendingPurchase);
        engine.completeSmartOver2RecoveryPurchase(winningRecoveryOrder, {
            buy_price: 0.86,
            contract_id: 'winning-recovery',
        });
        engine.lastSettledContract = {
            contract_id: 'winning-recovery',
            status: 'won',
            buy_price: 0.86,
            sell_price: 1.72,
            profit: 0.86,
        };
        expect(engine.completeSmartOver2Recovery('smart-over-2')).toBe(false);
        expect(state.stage).toBe(0);
        expect(state.recoveryRealMode).toBe(false);
        expect(state.currentStake).toBe(0.5);
        expect(state.pendingVirtualTrade).toBeNull();

        engine.latestTick = { epoch: 108, quote: '2591.352' };
        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 0, contractType: 'DIGITOVER', prediction: 2 })
        );
        expect(engine.getLastDigit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({ event: 'virtual_settlement', outcome: 'loss', digit: 7 })
        );
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'settlement',
                contractId: 'second-recovery',
                message: expect.stringContaining('Continuing real Under 5 recoveries until a win'),
            })
        );
        emit.mockRestore();
    });

    it('keeps Virtual Hook active after a win and resets the consecutive-loss count', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        state.stage = 1;
        state.virtualLosses = 1;
        engine.latestTick = { epoch: 200, quote: '2591.300' };
        engine.getLastDigit = jest.fn().mockResolvedValueOnce(3);
        engine.getLastDigitList = jest.fn();
        const check = () =>
            engine.checkSmartOver2Recovery(4, 100, 'smart-over-2', 1.2, true, 2, 5, true, 2, 0, 0);

        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITUNDER', prediction: 5, entryEpoch: 200 })
        );

        engine.latestTick = { epoch: 201, quote: '2591.303' };
        await expect(check()).resolves.toBe(false);
        expect(state.stage).toBe(1);
        expect(state.virtualLosses).toBe(0);
        expect(state.recoveryRealMode).toBe(false);
        expect(state.pendingVirtualTrade).toBeNull();
        expect(state.pendingPurchase).toBeNull();

        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toBeNull();
        engine.latestTick = { epoch: 202, quote: '2591.304' };
        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITUNDER', prediction: 5, entryEpoch: 202 })
        );
        expect(state.pendingPurchase).toBeNull();
        expect(engine.getLastDigitList).not.toHaveBeenCalled();
    });

    it('uses Over 4 for both V2 virtual simulation and real recovery after Run once settings', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const enableVirtualHook = jest.fn();
        engine.enableVirtualHook = enableVirtualHook;
        engine.configureSmartOver2Recovery(true, 2, 4, 'DIGITOVER');
        expect(engine.resetSmartOver2RecoverySession()).toBe(true);
        const state = engine.getSmartOver2RecoveryState();
        state.stage = 1;
        state.virtualLosses = 1;
        engine.latestTick = { epoch: 300, quote: '2591.300' };
        engine.getLastDigit = jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(4).mockResolvedValueOnce(4);
        const check = () =>
            engine.checkSmartOver2Recovery(
                4,
                100,
                'smart-over-2',
                1.2,
                true,
                2,
                4,
                undefined,
                undefined,
                0,
                0,
                undefined
            );
        expect(state.recoveryContractType).toBe('DIGITOVER');
        expect(engine.enableVirtualHook).toHaveBeenLastCalledWith(true);

        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITOVER', prediction: 4, entryEpoch: 300 })
        );

        engine.latestTick = { epoch: 301, quote: '2591.301' };
        await expect(check()).resolves.toBe(false);
        expect(state.virtualLosses).toBe(0);
        expect(state.pendingVirtualTrade).toBeNull();
        expect(state.recoveryRealMode).toBe(false);

        engine.latestTick = { epoch: 302, quote: '2591.302' };
        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITOVER', prediction: 4, entryEpoch: 302 })
        );

        engine.latestTick = { epoch: 303, quote: '2591.303' };
        await expect(check()).resolves.toBe(false);
        expect(state.virtualLosses).toBe(1);
        engine.latestTick = { epoch: 304, quote: '2591.304' };
        await expect(check()).resolves.toBe(false);
        expect(state.pendingVirtualTrade).toEqual(
            expect.objectContaining({ contractType: 'DIGITOVER', prediction: 4, entryEpoch: 304 })
        );

        engine.latestTick = { epoch: 305, quote: '2591.305' };
        await expect(check()).resolves.toBe(false);
        expect(state.virtualLosses).toBe(2);
        engine.latestTick = { epoch: 306, quote: '2591.306' };
        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITOVER', prediction: 4 })
        );
        expect(state.recoveryRealMode).toBe(true);

        const order = engine.beginSmartOver2RecoveryPurchase(state.pendingPurchase);
        engine.completeSmartOver2RecoveryPurchase(order, { buy_price: 0.5, contract_id: 'v2-recovery' });
        engine.lastSettledContract = {
            contract_id: 'v2-recovery',
            status: 'lost',
            buy_price: 0.5,
            sell_price: 0,
            profit: -0.5,
        };
        expect(engine.completeSmartOver2Recovery('smart-over-2')).toBe(false);
        engine.latestTick = { epoch: 307, quote: '2591.307' };
        await expect(check()).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITOVER', prediction: 4 })
        );
    });

    it('keeps the Run once digit count after the trade gate stops accepting a count', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const emit = jest.spyOn(observer, 'emit');
        engine.configureSmartOver2Recovery(true, 2, 6);
        engine.getLastDigitList = jest.fn().mockResolvedValue([0, 1, 2, 8, 8, 8]);

        await engine.checkSmartOver2Recovery(undefined, 100, 'smart-over-2');

        expect(engine.getSmartOver2RecoveryState().entryDigitCount).toBe(6);
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'status',
                message: expect.stringContaining('Last 6:'),
            })
        );
        emit.mockRestore();
    });

    it('preserves Run once Virtual Hook settings when a new session resets recovery state', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.setVirtualHookSettings = jest.fn();
        engine.enableVirtualHook = jest.fn();
        engine.configureSmartOver2Recovery(true, 3, 6);
        const previousState = engine.getSmartOver2RecoveryState();
        previousState.stage = 1;
        previousState.virtualLosses = 2;

        expect(engine.resetSmartOver2RecoverySession()).toBe(true);

        const resetState = engine.getSmartOver2RecoveryState();
        expect(resetState).not.toBe(previousState);
        expect(resetState).toEqual(
            expect.objectContaining({
                stage: 0,
                useVirtualHook: true,
                maxVirtualLosses: 3,
                entryDigitCount: 6,
                virtualLosses: 0,
            })
        );
        expect(engine.enableVirtualHook).toHaveBeenLastCalledWith(true);
        expect(engine.setVirtualHookSettings).toHaveBeenLastCalledWith(3, 1);
    });

    it('keeps base stake with Martingale off and uses configured Under for real recovery', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        engine.tradeOptions = { amount: 0.75, symbol: '1HZ50V' };
        state.baseStake = 0.5;
        state.currentStake = 0.75;
        state.stage = 1;
        state.lastPurchasedStage = 1;
        const emit = jest.spyOn(observer, 'emit');

        await expect(
            engine.checkSmartOver2Recovery(4, 100, 'smart-over-2', 2, false, 3, 7, false, 2, 10, 6)
        ).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ contractType: 'DIGITUNDER', prediction: 7 })
        );

        engine.lastSettledContract = {
            contract_id: 'no-martingale-loss',
            status: 'lost',
            profit: -0.75,
        };
        expect(engine.completeSmartOver2Recovery('smart-over-2')).toBe(false);
        expect(state.stage).toBe(1);
        expect(state.currentStake).toBe(0.5);
        expect(engine.tradeOptions.amount).toBe(0.5);
        expect(state.useMartingale).toBe(false);
        expect(state.recoveryPrediction).toBe(7);
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'settlement',
                useMartingale: false,
                nextStake: 0.5,
            })
        );
        emit.mockRestore();
    });

    it.each([
        ['target_profit', 'won', 5],
        ['stop_loss', 'lost', -30],
    ])('stops Smart Over 2 after the configured %s limit is reached', (reason, status, profit) => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        const emit = jest.spyOn(observer, 'emit');
        state.targetProfit = 5;
        state.stopLoss = 30;
        state.lastPurchasedStage = 0;
        engine.lastSettledContract = {
            contract_id: `risk-${reason}`,
            status,
            profit,
        };

        expect(engine.completeSmartOver2Recovery('smart-over-2')).toBe(false);

        expect(state.stopped).toBe(true);
        expect(state.sessionProfit).toBe(profit);
        expect(emit).toHaveBeenCalledWith('bot.stop_button_click');
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({ event: 'risk_stop', reason, sessionProfit: profit })
        );
        emit.mockRestore();
    });

    it('keeps a queued Under 5 real recovery order until the broker accepts it', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        state.stage = 1;
        state.pendingPurchase = {
            stage: 1,
            contractType: 'DIGITUNDER',
            prediction: 5,
            journalScope: 'smart-over-2',
        };
        engine.purchase = jest.fn().mockResolvedValue('submitted');

        await expect(engine.purchaseSmartOver2Recovery('smart-over-2')).resolves.toBe('submitted');

        expect(engine.purchase).toHaveBeenCalledWith('DIGITUNDER', 5);
        expect(state.lastPurchasedStage).toBeNull();
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 })
        );
    });

    it('forces stale Over 2 calls to use the queued Under 5 real recovery order', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        state.stage = 1;
        state.pendingPurchase = {
            stage: 1,
            contractType: 'DIGITUNDER',
            prediction: 5,
            journalScope: 'smart-over-2',
        };

        expect(engine.getSmartOver2RecoveryPurchasePlan('DIGITOVER', 2)).toEqual({
            blocked: false,
            contractType: 'DIGITUNDER',
            prediction: 5,
            order: state.pendingPurchase,
        });

        state.purchaseInFlight = true;
        expect(engine.getSmartOver2RecoveryPurchasePlan('DIGITOVER', 2)).toEqual(
            expect.objectContaining({ blocked: true })
        );
        state.purchaseInFlight = false;
        state.pendingPurchase = null;
        expect(engine.getSmartOver2RecoveryPurchasePlan('DIGITOVER', 2)).toEqual(
            expect.objectContaining({ blocked: true })
        );
    });

    it('preserves legacy normal entries but blocks a repeat while the staged contract is unsettled', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();

        expect(engine.getSmartOver2RecoveryPurchasePlan('DIGITOVER', 2)).toEqual({
            blocked: false,
            contractType: 'DIGITOVER',
            prediction: 2,
            order: null,
        });

        state.lastPurchasedStage = 0;
        expect(engine.getSmartOver2RecoveryPurchasePlan('DIGITOVER', 2)).toEqual(
            expect.objectContaining({ blocked: true })
        );
    });

    it('retains the queued recovery order without a purchase Journal entry after a failed attempt', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        const emit = jest.spyOn(observer, 'emit');
        state.stage = 1;
        state.pendingPurchase = {
            stage: 1,
            contractType: 'DIGITUNDER',
            prediction: 5,
            journalScope: 'smart-over-2',
        };

        const order = engine.beginSmartOver2RecoveryPurchase(state.pendingPurchase);
        expect(engine.abortSmartOver2RecoveryPurchase(order)).toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 })
        );
        expect(state.purchaseInFlight).toBe(false);
        expect(state.lastPurchasedStage).toBeNull();
        expect(emit).not.toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({ event: 'purchase' })
        );
        emit.mockRestore();
    });

    it('records the recovery stage and Journal purchase only after broker acceptance', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        const emit = jest.spyOn(observer, 'emit');
        state.stage = 1;
        state.pendingPurchase = {
            stage: 1,
            contractType: 'DIGITUNDER',
            prediction: 5,
            journalScope: 'smart-over-2',
        };

        const order = engine.beginSmartOver2RecoveryPurchase(state.pendingPurchase);
        expect(order).toEqual(expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 }));
        expect(state.purchaseInFlight).toBe(true);
        expect(state.lastPurchasedStage).toBeNull();

        expect(engine.completeSmartOver2RecoveryPurchase(order, { contract_id: 123, buy_price: 0.6 })).toBe(true);
        expect(state.purchaseInFlight).toBe(false);
        expect(state.pendingPurchase).toBeNull();
        expect(state.lastPurchasedStage).toBe(1);
        expect(state.currentStake).toBe(0.6);
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'purchase',
                stage: 1,
                contractType: 'DIGITUNDER',
                prediction: 5,
                contractId: '123',
                message: expect.stringContaining('purchased Under 5'),
            })
        );
        emit.mockRestore();
    });

    it('chooses the stronger recent Over 4 or Under 4 bias and falls back to the latest non-4 digit on ties', () => {
        const overAnalysis = analyzeSmartOver2RecoveryDigits(Array(100).fill(8), 100);
        const underAnalysis = analyzeSmartOver2RecoveryDigits(Array(100).fill(1), 100);
        const tiedAnalysis = analyzeSmartOver2RecoveryDigits(
            Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? 1 : 8)),
            100
        );
        const insufficient = analyzeSmartOver2RecoveryDigits([1, 2, 3], 100);

        expect(overAnalysis).toEqual(expect.objectContaining({ ready: true, contractType: 'DIGITOVER' }));
        expect(underAnalysis).toEqual(expect.objectContaining({ ready: true, contractType: 'DIGITUNDER' }));
        expect(tiedAnalysis).toEqual(
            expect.objectContaining({ ready: true, contractType: 'DIGITOVER', tieBreak: 'recent_digit_over_4' })
        );
        expect(insufficient.ready).toBe(false);
    });

    it('compounds real losses, repeats Under 5 recovery when the hook is off, and resets on a win', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const state = engine.getSmartOver2RecoveryState();
        const emit = jest.spyOn(observer, 'emit');
        state.baseStake = 0.5;
        state.currentStake = 0.5;
        state.martingaleMultiplier = 1.2;
        engine.tradeOptions = { amount: 0.5, symbol: '1HZ50V' };

        const settle = (id: string, stage: number, outcome: 'won' | 'lost') => {
            state.stage = stage;
            state.lastPurchasedStage = stage;
            engine.lastSettledContract = {
                contract_id: id,
                status: outcome,
                profit: outcome === 'won' ? 0.5 : -0.5,
            };
            return engine.completeSmartOver2Recovery('smart-over-2');
        };

        expect(settle('normal-loss', 0, 'lost')).toBe(false);
        expect(state.stage).toBe(1);
        expect(state.currentStake).toBe(0.6);
        expect(engine.tradeOptions.amount).toBe(0.6);

        expect(settle('under-five-loss-1', 1, 'lost')).toBe(false);
        expect(state.stage).toBe(1);
        expect(state.currentStake).toBe(0.72);
        expect(engine.tradeOptions.amount).toBe(0.72);

        state.pendingPurchase = null;
        await expect(engine.checkSmartOver2Recovery(4, 100, 'smart-over-2')).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 1, contractType: 'DIGITUNDER', prediction: 5 })
        );

        expect(settle('under-five-win', 1, 'won')).toBe(false);
        expect(state.stage).toBe(0);
        expect(state.currentStake).toBe(0.5);
        expect(state.consecutiveLosses).toBe(0);

        engine.getLastDigitList = jest.fn().mockResolvedValue([9, 9, 9, 9]);
        await expect(engine.checkSmartOver2Recovery(4, 100, 'smart-over-2')).resolves.toBe(false);
        expect(engine.getLastDigitList).toHaveBeenCalledTimes(1);
        expect(state.pendingPurchase).toBeNull();

        engine.getLastDigitList.mockResolvedValue([3, 4, 5, 6]);
        await expect(engine.checkSmartOver2Recovery(4, 100, 'smart-over-2')).resolves.toBe(true);
        expect(state.pendingPurchase).toEqual(
            expect.objectContaining({ stage: 0, contractType: 'DIGITOVER', prediction: 2 })
        );

        state.pendingPurchase = null;
        state.currentStake = 1.44;
        expect(settle('normal-win', 0, 'won')).toBe(false);
        expect(state.stage).toBe(0);
        expect(state.currentStake).toBe(0.5);
        expect(state.stopped).toBe(false);
        expect(emit).not.toHaveBeenCalledWith('bot.stop');
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'settlement',
                outcome: 'loss',
                nextStake: 0.6,
            })
        );
        expect(emit).toHaveBeenCalledWith(
            'bot.smart_over2.recovery',
            expect.objectContaining({
                event: 'settlement',
                outcome: 'win',
                nextStake: 0.5,
                message: expect.stringContaining('condition-gated Over 2'),
            })
        );

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

    it('keeps the purchase gate open when confidence is disabled and indicators pass', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.requiresSignalConfidence = false;
        engine.store = {
            getState: () => ({ newTick: 123 }),
        };
        engine.lastSignalConfidenceEvaluation = {
            signal: 'CALL',
            confidence: 20,
            minimum: 55,
            tick: 123,
        };
        engine.recordIndicatorValue('adx', 30);
        engine.recordIndicatorValue('rsi', 60);
        engine.recordIndicatorValue('macd', 1);

        expect(engine.isPurchaseConditionGateOpen('CALL')).toBe(true);
        expect(engine.getVolatilityConditionSnapshot('CALL')).toEqual(
            expect.objectContaining({
                availableConfidence: null,
                minimumConfidence: null,
                conditionsPassed: true,
            })
        );
    });

    it('keeps the completed volatility scan authoritative for the purchase cycle', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.requiresSignalConfidence = false;
        engine.store = {
            getState: () => ({ newTick: 456 }),
        };
        engine.symbol = '1HZ10V';
        engine.tradeOptions = { symbol: '1HZ10V' };
        engine.volatilitySelectionLock = {
            code: '1HZ10V',
            signal: 'CALL',
            adx: 29.6,
            rsi: 69.6,
            macd: 0.02,
        };

        engine.beginPurchaseConditionEvaluation();
        engine.recordIndicatorValue('adx', 12);
        engine.recordIndicatorValue('rsi', 45);
        engine.recordIndicatorValue('macd', -0.1);

        expect(engine.purchaseIndicatorEvaluation).toEqual({
            adx: 29.6,
            rsi: 69.6,
            macd: 0.02,
            tick: 456,
        });
        expect(engine.isPurchaseConditionGateOpen('CALL')).toBe(true);
    });

    it('reuses the selected scan candles during FAST execution', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.fastClockActive = true;
        engine.volatilitySelectionLock = {
            executionPrices: [100, 101, 100.5],
        };
        engine.options = { candleInterval: 60 };
        engine.$scope = {
            ticksService: {
                request: jest.fn(() => {
                    throw new Error('FAST execution must not request fresh OHLC data');
                }),
            },
        };

        await expect(engine.getOhlc({ granularity: 60, field: 'close' })).resolves.toEqual([100, 101, 100.5]);
        expect(engine.$scope.ticksService.request).not.toHaveBeenCalled();
    });

    it('requires MACD and accepts either ADX or directional RSI', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.requiresSignalConfidence = false;

        const evaluate = indicators => {
            engine.purchaseIndicatorEvaluation = indicators;
            return engine.isPurchaseConditionValuesGateOpen('CALL');
        };

        expect(evaluate({ adx: 25, rsi: 45, macd: 1 })).toBe(true);
        expect(evaluate({ adx: 10, rsi: 60, macd: 1 })).toBe(true);
        expect(evaluate({ adx: 25, rsi: 60, macd: -1 })).toBe(false);
        expect(evaluate({ adx: 10, rsi: 45, macd: 1 })).toBe(false);
    });

    it('keeps one before-purchase evaluation valid when a new tick arrives during analysis', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        let currentTick = 123;
        engine.store = {
            getState: () => ({ newTick: currentTick }),
        };

        engine.beginPurchaseConditionEvaluation();
        engine.lastSignalConfidenceEvaluation = {
            signal: 'CALL',
            confidence: 61,
            minimum: 55,
            tick: engine.purchaseConditionEvaluationTick,
        };
        engine.recordIndicatorValue('adx', 30);
        engine.recordIndicatorValue('rsi', 60);
        engine.recordIndicatorValue('macd', 1);

        currentTick = 124;

        expect(engine.isPurchaseConditionGateOpen('CALL')).toBe(true);
        expect(engine.lastSignalConfidenceEvaluation.tick).toBe(123);
        expect(engine.purchaseIndicatorEvaluation.tick).toBe(123);
    });

    it('exposes available and minimum volatility conditions for Journal entry reporting', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.volatilitySelectionLock = {
            code: '1HZ25V',
            label: 'Volatility 25 (1s) Index',
            signal: 'CALL',
            confidence: 62,
            adx: 24,
            rsi: 58,
            macd: 0.12,
            minimumConfidence: 55,
            minimumAdx: 20,
        };
        engine.lastSignalConfidenceEvaluation = {
            signal: 'CALL',
            confidence: 61,
            minimum: 55,
        };
        engine.recordIndicatorValue('adx', 23);
        engine.recordIndicatorValue('rsi', 57);
        engine.recordIndicatorValue('macd', 0.08);

        expect(engine.getVolatilityConditionSnapshot('CALL')).toEqual({
            signal: 'CALL',
            availableConfidence: 61,
            minimumConfidence: 55,
            availableAdx: 23,
            minimumAdx: 20,
            availableRsi: 57,
            minimumRsi: 50,
            rsiOperator: '>',
            availableMacd: 0.08,
            minimumMacd: 0,
            macdOperator: '>',
            conditionsPassed: true,
        });
    });

    it('keeps the selected volatility while awaiting live confirmation', async () => {
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

    it('keeps the strongest selected volatility locked after settlement', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = '1HZ75V';
        engine.options = { symbol: '1HZ75V' };
        engine.tradeOptions = { symbol: '1HZ75V' };
        engine.store = {
            getState: () => ({ newTick: 123 }),
        };
        engine.volatilitySelectionLock = {
            code: '1HZ75V',
            label: 'Volatility 75 (1s) Index',
            signal: 'CALL',
            confidence: 1,
        };
        engine.volatilityPreferredMarket = {
            code: '1HZ75V',
            label: 'Volatility 75 (1s) Index',
        };
        engine.watchTicks = jest.fn();
        engine.makeProposals = jest.fn();
        engine.$scope = {
            ticksService: {
                request: jest.fn(),
            },
        };

        engine.prepareVolatilityRescan();

        expect(engine.volatilitySelectionLock).toEqual(
            expect.objectContaining({
                code: '1HZ75V',
            })
        );
        expect(engine.lastSignalConfidenceEvaluation).toBeNull();
        expect(engine.purchaseIndicatorEvaluation).toBeNull();
        await expect(engine.scanVolatilityUntilIndicatorsPass(20)).resolves.toBe(true);
        expect(engine.$scope.ticksService.request).not.toHaveBeenCalled();
        expect(engine.watchTicks).not.toHaveBeenCalled();
    });

    it('scans every market and selects the strongest qualified market', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const history = Array.from({ length: 61 }, (_, index) => ({ quote: 100 - index * index * 0.01 }));
        const request = jest.fn().mockResolvedValue(history);

        engine.volatilityPreferredMarket = {
            code: '1HZ100V',
            label: 'Volatility 100 (1s) Index',
        };
        engine.volatilityScanRequestGapMs = 0;
        engine.$scope = { ticksService: { request } };
        engine.watchTicks = jest.fn(async symbol => {
            engine.symbol = symbol;
        });
        engine.makeProposals = jest.fn();

        (api_base as any).active_symbols = [];
        (api_base as any).pip_sizes = { '1HZ100V': 2 };
        const marketEvents: any[] = [];
        const emit = jest.spyOn(observer, 'emit').mockImplementation((event, payload) => {
            if (event === 'bot.volatility.scan' && payload?.event === 'market') {
                marketEvents.push(payload);
            }
        });

        const scanResult = await engine.scanVolatilityUntilIndicatorsPass(20);
        expect(scanResult).toBe(true);
        expect(request).toHaveBeenCalledTimes(DERIV_VOLATILITIES.length);
        expect(request.mock.calls.map(([options]) => options.symbol)).toEqual(
            expect.arrayContaining(DERIV_VOLATILITIES.map(({ code }) => code))
        );
        expect(marketEvents).toHaveLength(DERIV_VOLATILITIES.length);
        expect(marketEvents.every(event => Number.isFinite(event.adx))).toBe(true);
        expect(marketEvents.every(event => Number.isFinite(event.rsi))).toBe(true);
        expect(marketEvents.every(event => Number.isFinite(event.macd))).toBe(true);
        expect(marketEvents.every(event => event.candidate === true)).toBe(true);
        expect(marketEvents.every(event => event.diagnostic !== true)).toBe(true);
        expect(request.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                symbol: '1HZ100V',
                force: false,
                subscribe: false,
            })
        );
        expect(engine.volatilitySelectionLock).toEqual(
            expect.objectContaining({
                signal: 'PUT',
            })
        );
        emit.mockRestore();
    });

    it('ranks all qualified markets by indicator count before confidence', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const history = Array.from({ length: 61 }, (_, index) => ({ quote: 100 - index * index * 0.01 }));
        const request = jest.fn().mockResolvedValue(history);

        engine.volatilityPreferredMarket = {
            code: '1HZ100V',
            label: 'Volatility 100 (1s) Index',
        };
        engine.volatilityScanRequestGapMs = 0;
        engine.$scope = { ticksService: { request } };
        engine.watchTicks = jest.fn(async symbol => {
            engine.symbol = symbol;
        });
        engine.makeProposals = jest.fn();
        engine.getVolatilityMarketRecord = jest.fn(async volatility => ({
            ...volatility,
            signal: 'PUT',
            confidence: volatility.code === '1HZ75V' ? 1 : volatility.code === '1HZ100V' ? 99 : 0,
            adx: 25,
            rsi: 40,
            macd: -0.1,
            qualifies: true,
            reason: 'qualified',
        }));
        engine.getVolatilityRecordStrength = jest.fn(record => {
            if (record.code === '1HZ100V') {
                return {
                    indicatorPassCount: 2,
                    confidence: 99,
                    adxMargin: 1,
                    rsiMargin: 20,
                    macdMagnitude: 1,
                };
            }
            if (record.code === '1HZ75V') {
                return {
                    indicatorPassCount: 3,
                    confidence: 1,
                    adxMargin: 4,
                    rsiMargin: 17,
                    macdMagnitude: 2,
                };
            }
            return {
                indicatorPassCount: 0,
                confidence: 0,
                adxMargin: 0,
                rsiMargin: 0,
                macdMagnitude: 0,
            };
        });

        (api_base as any).active_symbols = [];
        (api_base as any).pip_sizes = { '1HZ100V': 2, '1HZ75V': 2 };

        await expect(engine.scanVolatilityUntilIndicatorsPass(20)).resolves.toBe(true);

        expect(engine.volatilitySelectionLock).toEqual(
            expect.objectContaining({
                code: '1HZ75V',
                confidence: 1,
            })
        );
        expect(engine.makeProposals).toHaveBeenCalled();
    });

    it('releases a selected volatility after live conditions fail', () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.volatilitySelectionLock = {
            code: '1HZ25V',
            label: 'Volatility 25 (1s) Index',
            signal: 'PUT',
            confidence: 58,
        };
        engine.lastSignalConfidenceEvaluation = {
            signal: 'PUT',
            confidence: 54,
            minimum: 55,
            tick: 123,
        };
        engine.releaseVolatilitySelection('live_conditions_failed');

        expect(engine.volatilitySelectionLock).toBeNull();
        expect(engine.lastSignalConfidenceEvaluation).toBeNull();
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

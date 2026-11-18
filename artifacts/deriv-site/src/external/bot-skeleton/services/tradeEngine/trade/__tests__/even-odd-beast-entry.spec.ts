import { observer } from '@/external/bot-skeleton/utils/observer';
import { analyzeEvenOddBeastCandles } from '@/utils/even-odd-beast-strategy';
import Ticks from '../Ticks';

class BaseEngine {}

const candleStart = 1_700_000_040;
const makeBullishCandles = (matchedParity: 'EVEN' | 'ODD' = 'ODD') => {
    const fraction = matchedParity === 'EVEN' ? 0.12 : 0.13;
    const candles = Array.from({ length: 50 }, (_, index) => {
        const close = 100_000 + index * index * index * 10 + fraction;
        return {
            time: candleStart - (49 - index) * 60,
            open: close - 1,
            high: close,
            low: close - 1,
            close,
        };
    });

    for (let offset = 0; offset < 9; offset += 1) {
        const finalCandle = candles[candles.length - 1];
        finalCandle.close = 100_000 + 49 * 49 * 49 * 10 + fraction + offset;
        finalCandle.open = finalCandle.close - 1;
        finalCandle.high = finalCandle.close;
        finalCandle.low = finalCandle.open;
        const analysis = analyzeEvenOddBeastCandles({
            candles,
            pipSize: 2,
            expectedCandleTime: candleStart,
        });
        if (
            analysis.matchedDigit !== null &&
            analysis.matchedDigit % 2 === (matchedParity === 'EVEN' ? 0 : 1) &&
            analysis.signal === 'ODD'
        ) {
            return candles;
        }
    }

    throw new Error('Could not make a bullish Odd fixture.');
};

describe('Even Odd Beast live entry gate', () => {
    it('locks the setup side and re-enters without requiring another digit match', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const candles = makeBullishCandles('EVEN');
        const epoch = candleStart + 30;
        let conditionEpoch = epoch;
        engine.symbol = '1HZ25V';
        engine.latestTick = { epoch, quote: '123456.1300' };
        engine.$scope = { ticksService: { request: jest.fn().mockResolvedValue(candles) } };
        engine.getPurchaseConditionTick = jest.fn(() => conditionEpoch);
        engine.getPipSize = jest.fn(() => 2);
        engine.getActiveContractIds = jest.fn(() => []);
        const emit = jest.spyOn(observer, 'emit');

        try {
            await expect(engine.getEvenOddBeastSignal('EVEN')).resolves.toBe(false);
            await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(true);
            await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(false);
            expect(engine.evenOddBeastActiveSide).toBe('ODD');

            expect(engine.$scope.ticksService.request).toHaveBeenCalledWith({
                symbol: '1HZ25V',
                granularity: 60,
            });
            expect(engine.$scope.ticksService.request).toHaveBeenCalledTimes(1);
            expect(emit).toHaveBeenCalledWith(
                'bot.analysis.even_odd_beast',
                expect.objectContaining({
                    journalScope: 'even-odd-beast',
                    market: '1HZ25V',
                    signal: 'ODD',
                    selectedSide: 'ODD',
                    result: false,
                    reason: 'already_purchased_this_tick',
                })
            );

            const finalCandle = candles[candles.length - 1];
            finalCandle.close += 0.01;
            finalCandle.open = finalCandle.close - 1;
            finalCandle.high = finalCandle.close;
            finalCandle.low = finalCandle.open;
            const mismatchedAnalysis = analyzeEvenOddBeastCandles({
                candles,
                pipSize: 2,
                expectedCandleTime: candleStart,
            });
            expect(mismatchedAnalysis.matchedDigit).toBeNull();
            expect(mismatchedAnalysis.oddConditions).toBe(true);

            conditionEpoch += 1;
            engine.latestTick = { epoch: conditionEpoch, quote: '123456.1400' };
            await expect(engine.getEvenOddBeastSignal('EVEN')).resolves.toBe(false);
            await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(true);
            expect(engine.$scope.ticksService.request).toHaveBeenCalledTimes(2);
            expect(emit).toHaveBeenLastCalledWith(
                'bot.analysis.even_odd_beast',
                expect.objectContaining({
                    signal: 'ODD',
                    selectedSide: 'ODD',
                    matchedDigit: null,
                    result: true,
                    reason: 'ready_odd',
                })
            );

            finalCandle.open = finalCandle.close + 1;
            finalCandle.high = finalCandle.open;
            finalCandle.low = finalCandle.close;
            expect(
                analyzeEvenOddBeastCandles({
                    candles,
                    pipSize: 2,
                    expectedCandleTime: candleStart,
                }).oddConditions
            ).toBe(false);
            conditionEpoch += 1;
            engine.latestTick = { epoch: conditionEpoch, quote: '123456.1500' };
            await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(false);
            expect(emit).toHaveBeenLastCalledWith(
                'bot.analysis.even_odd_beast',
                expect.objectContaining({
                    signal: 'ODD',
                    selectedSide: 'ODD',
                    result: false,
                    reason: 'latched_setup_not_met',
                })
            );

            finalCandle.open = finalCandle.close - 1;
            finalCandle.high = finalCandle.close;
            finalCandle.low = finalCandle.open;
            conditionEpoch += 1;
            engine.latestTick = { epoch: conditionEpoch, quote: '123456.1600' };
            await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(true);
            expect(engine.$scope.ticksService.request).toHaveBeenCalledTimes(4);
        } finally {
            emit.mockRestore();
        }
    });

    it('does not qualify a contract while a previous contract is still open', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = '1HZ25V';
        engine.latestTick = { epoch: candleStart + 30, quote: '123456.1300' };
        engine.$scope = { ticksService: { request: jest.fn().mockResolvedValue(makeBullishCandles()) } };
        engine.getPurchaseConditionTick = jest.fn(() => candleStart + 30);
        engine.getPipSize = jest.fn(() => 2);
        engine.getActiveContractIds = jest.fn(() => ['open-contract']);

        await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(false);
    });
});

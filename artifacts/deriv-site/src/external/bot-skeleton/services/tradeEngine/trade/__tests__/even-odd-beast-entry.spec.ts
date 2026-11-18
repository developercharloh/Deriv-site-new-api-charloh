import { observer } from '@/external/bot-skeleton/utils/observer';
import { analyzeEvenOddBeastCandles } from '@/utils/even-odd-beast-strategy';
import Ticks from '../Ticks';

class BaseEngine {}

const candleStart = 1_700_000_040;
const makeOddCandles = () => {
    const candles = Array.from({ length: 50 }, (_, index) => {
        const close = 100_000 + index * index * index * 10 + 0.13;
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
        finalCandle.close = 100_000 + 49 * 49 * 49 * 10 + 0.13 + offset;
        finalCandle.open = finalCandle.close - 1;
        finalCandle.high = finalCandle.close;
        finalCandle.low = finalCandle.open;
        const analysis = analyzeEvenOddBeastCandles({
            candles,
            pipSize: 2,
            expectedCandleTime: candleStart,
        });
        if (analysis.signal === 'ODD') return candles;
    }

    throw new Error('Could not make a bullish Odd fixture.');
};

describe('Even Odd Beast live entry gate', () => {
    it('waits for matching-side analysis and permits only one purchase per candle', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        const candles = makeOddCandles();
        const epoch = candleStart + 30;
        engine.symbol = '1HZ25V';
        engine.latestTick = { epoch, quote: '123456.1300' };
        engine.$scope = { ticksService: { request: jest.fn().mockResolvedValue(candles) } };
        engine.getPurchaseConditionTick = jest.fn(() => epoch);
        engine.getPipSize = jest.fn(() => 2);
        engine.getActiveContractIds = jest.fn(() => []);
        const emit = jest.spyOn(observer, 'emit');

        try {
            await expect(engine.getEvenOddBeastSignal('EVEN')).resolves.toBe(false);
            await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(true);
            await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(false);

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
                    result: true,
                    reason: 'ready_odd',
                })
            );
        } finally {
            emit.mockRestore();
        }
    });

    it('does not qualify a contract while a previous contract is still open', async () => {
        const Engine = Ticks(BaseEngine as any);
        const engine: any = new Engine();
        engine.symbol = '1HZ25V';
        engine.latestTick = { epoch: candleStart + 30, quote: '123456.1300' };
        engine.$scope = { ticksService: { request: jest.fn().mockResolvedValue(makeOddCandles()) } };
        engine.getPurchaseConditionTick = jest.fn(() => candleStart + 30);
        engine.getPipSize = jest.fn(() => 2);
        engine.getActiveContractIds = jest.fn(() => ['open-contract']);

        await expect(engine.getEvenOddBeastSignal('ODD')).resolves.toBe(false);
    });
});

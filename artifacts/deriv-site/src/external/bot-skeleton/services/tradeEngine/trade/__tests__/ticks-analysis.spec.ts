import { observer } from '@/external/bot-skeleton/utils/observer';
import Ticks from '../Ticks';

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
});

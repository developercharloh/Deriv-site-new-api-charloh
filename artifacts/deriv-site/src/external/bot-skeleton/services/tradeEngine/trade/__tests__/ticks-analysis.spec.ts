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
});
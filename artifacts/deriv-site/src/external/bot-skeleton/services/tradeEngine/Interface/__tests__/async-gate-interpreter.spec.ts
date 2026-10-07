import getBotInterface from '../BotInterface';
import getTicksInterface from '../TicksInterface';
import Interface from '../index';
import Interpreter from '../../utils/interpreter';

jest.mock('../index', () => ({
    __esModule: true,
    default: jest.fn(),
}));

const runEvenOddGate = async (gateResult: boolean) => {
    const checkGate = jest.fn().mockResolvedValue(gateResult);
    const purchase = jest.fn().mockResolvedValue(true);
    const tradeEngine = {
        checkEvenOddStrikeEagleVirtualHook: checkGate,
        purchase,
    };
    const botInterface = {
        ...getBotInterface(tradeEngine as any),
        getTicksInterface: getTicksInterface(tradeEngine as any),
        alert: jest.fn(),
        prompt: jest.fn(),
        sleep: jest.fn().mockResolvedValue(undefined),
        console: { log: jest.fn() },
    };

    (Interface as jest.Mock).mockReturnValue({
        tradeEngine: {},
        getInterface: () => botInterface,
    });

    const interpreter = Interpreter();
    await interpreter.run(`
        if (Bot.checkEvenOddStrikeEagleVirtualHook("A")) {
            Bot.purchase("DIGITEVEN");
        }
    `);

    expect(checkGate).toHaveBeenCalledWith('A');
    expect(purchase).toHaveBeenCalledTimes(gateResult ? 1 : 0);
};

describe('Even Odd Strike Eagle async virtual gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not start a real purchase while the virtual gate resolves false', async () => {
        await runEvenOddGate(false);
    });

    it('allows a real purchase only after the virtual gate resolves true', async () => {
        await runEvenOddGate(true);
    });
});

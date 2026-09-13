import TradeEngine from '../trade';
import getBotInterface from './BotInterface';
import getTicksInterface from './TicksInterface';
import getToolsInterface from './ToolsInterface';
import {
    getBotExecutionDelayMs,
    getBotExecutionSpeed,
    shouldWaitForNextTick,
} from '@/constants/bot-execution-speed';

export const sleep = (observer, arg = 1) => {
    const speed = getBotExecutionSpeed();

    if (shouldWaitForNextTick(arg, speed)) {
        return new Promise(resolve => {
            observer.register('bot.tick', resolve, true);
        });
    }

    return new Promise(
        r =>
            // eslint-disable-next-line no-promise-executor-return
            setTimeout(r, getBotExecutionDelayMs(arg, speed)),
        () => {}
    );
};

const Interface = $scope => {
    const tradeEngine = new TradeEngine($scope);
    const { observer } = $scope;
    const getInterface = () => {
        return {
            ...getBotInterface(tradeEngine),
            ...getToolsInterface(tradeEngine),
            getTicksInterface: getTicksInterface(tradeEngine),
            watch: (...args) => tradeEngine.watch(...args),
            sleep: (...args) => sleep(observer, ...args),
            alert: (...args) => alert(...args), // eslint-disable-line no-alert
            prompt: (...args) => prompt(...args), // eslint-disable-line no-alert
            console: {
                log(...args) {
                    // eslint-disable-next-line no-console
                    console.log(new Date().toLocaleTimeString(), ...args);
                },
            },
        };
    };
    return { tradeEngine, observer, getInterface };
};

export default Interface;

import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import TradeEngine, { watchScope } from '..';
import * as constants from '../state/constants';
import rootReducer from '../state/reducers';

const watchBefore = store =>
    watchScope({
        store,
        stopScope: constants.DURING_PURCHASE,
        passScope: constants.BEFORE_PURCHASE,
        passFlag: 'proposalsReady',
    });

describe('FAST trade-cycle release', () => {
    afterEach(() => {
        window.localStorage.removeItem('dbot_execution_speed');
    });

    it('consumes each clock release so watch(before) cannot spin synchronously', async () => {
        window.localStorage.setItem('dbot_execution_speed', 'fast');
        const store = createStore(rootReducer);

        store.dispatch({ type: constants.START });
        store.dispatch({ type: constants.PROPOSALS_READY });
        store.dispatch({ type: constants.FAST_REARM });

        await expect(watchBefore(store)).resolves.toBe(true);
        expect(store.getState().fastReady).toBe(false);
        expect(store.getState().fastSlot).toBe(1);

        let secondWatchResolved = false;
        const secondWatch = watchBefore(store).then(result => {
            secondWatchResolved = true;
            return result;
        });

        await Promise.resolve();
        expect(secondWatchResolved).toBe(false);

        store.dispatch({ type: constants.FAST_REARM });
        await expect(secondWatch).resolves.toBe(true);
        expect(store.getState().fastReady).toBe(false);
        expect(store.getState().fastSlot).toBe(2);
    });
});

describe('shared trade-cycle restart', () => {
    afterEach(() => {
        window.localStorage.removeItem('dbot_execution_speed');
    });

    it('normalizes a settled cycle before the generated second Bot.start call', () => {
        window.localStorage.setItem('dbot_execution_speed', 'slow');

        const engine = Object.create(TradeEngine.prototype);
        engine.options = { symbol: 'R_25' };
        engine.store = createStore(rootReducer, applyMiddleware(thunk));
        engine.hasStarted = true;
        engine.fastClockActive = false;
        engine.activeContracts = new Map([['first-contract', { settled: true }]]);
        engine.validateTradeOptions = options => options;
        engine.checkLimits = jest.fn();
        engine.makeDirectPurchaseDecision = jest.fn();

        engine.store.dispatch({ type: constants.OPEN_CONTRACT });

        engine.start({ amount: 0.5, currency: 'USD', contractTypes: ['DIGITEVEN'] });

        expect(engine.store.getState().scope).toBe(constants.BEFORE_PURCHASE);
        expect(engine.makeDirectPurchaseDecision).toHaveBeenCalledTimes(1);
    });

    it('preserves a prepared FAST slot when the generated cycle restarts', () => {
        window.localStorage.setItem('dbot_execution_speed', 'fast');

        const engine = Object.create(TradeEngine.prototype);
        engine.options = { symbol: 'R_25' };
        engine.store = createStore(rootReducer, applyMiddleware(thunk));
        engine.hasStarted = true;
        engine.fastClockActive = true;
        engine.fastClock = { isRunning: () => true };
        engine.activeContracts = new Map();
        engine.validateTradeOptions = options => options;
        engine.checkLimits = jest.fn();
        engine.makeDirectPurchaseDecision = jest.fn();

        engine.store.dispatch({ type: constants.START });
        engine.store.dispatch({ type: constants.PROPOSALS_READY });
        engine.store.dispatch({ type: constants.FAST_REARM });

        engine.start({ amount: 0.5, currency: 'USD', contractTypes: ['DIGITEVEN'] });

        expect(engine.store.getState().scope).toBe(constants.BEFORE_PURCHASE);
        expect(engine.store.getState().fastReady).toBe(true);
        expect(engine.makeDirectPurchaseDecision).toHaveBeenCalledTimes(1);
    });
});
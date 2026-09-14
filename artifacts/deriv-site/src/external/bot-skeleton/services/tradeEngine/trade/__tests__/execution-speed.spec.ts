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

const watchDuring = store =>
    watchScope({
        store,
        stopScope: constants.STOP,
        passScope: constants.DURING_PURCHASE,
        passFlag: 'openContract',
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

    it('keeps a paused before-purchase watcher blocked until FAST resumes', async () => {
        window.localStorage.setItem('dbot_execution_speed', 'fast');
        const store = createStore(rootReducer);

        store.dispatch({ type: constants.START });
        store.dispatch({ type: constants.PROPOSALS_READY });
        store.dispatch({ type: constants.PAUSE });

        let resolved = false;
        const pending = watchBefore(store).then(result => {
            resolved = true;
            return result;
        });

        store.dispatch({ type: constants.FAST_REARM });
        await Promise.resolve();
        expect(resolved).toBe(false);

        store.dispatch({ type: constants.RESUME });
        store.dispatch({ type: constants.FAST_REARM });
        await expect(pending).resolves.toBe(true);
        expect(store.getState().paused).toBe(false);
        expect(store.getState().fastReady).toBe(false);
    });

    it('still lets an already-open contract advance while paused', async () => {
        window.localStorage.setItem('dbot_execution_speed', 'fast');
        const store = createStore(rootReducer);

        store.dispatch({ type: constants.START });
        store.dispatch({ type: constants.PURCHASE_SUCCESSFUL });
        store.dispatch({ type: constants.PAUSE });

        const pending = watchDuring(store);
        store.dispatch({ type: constants.OPEN_CONTRACT });
        store.dispatch({ type: constants.NEW_TICK, payload: 1 });

        await expect(pending).resolves.toBe(true);
        expect(store.getState().paused).toBe(true);
    });

    it('pauses and resumes the engine without rebuilding its FAST clock', () => {
        window.localStorage.setItem('dbot_execution_speed', 'fast');
        const engine = Object.create(TradeEngine.prototype);
        engine.store = createStore(rootReducer);
        engine.hasStarted = true;
        engine.paused = false;
        engine.stopFastClock = jest.fn(() => {
            engine.fastClockActive = false;
        });
        engine.startFastClock = jest.fn(() => {
            engine.fastClockActive = true;
        });

        engine.pause();
        expect(engine.paused).toBe(true);
        expect(engine.store.getState().paused).toBe(true);
        expect(engine.stopFastClock).toHaveBeenCalledTimes(1);

        engine.resume();
        expect(engine.paused).toBe(false);
        expect(engine.store.getState().paused).toBe(false);
        expect(engine.startFastClock).toHaveBeenCalledTimes(1);
    });
});

describe('SLOW broker-tick release', () => {
    afterEach(() => {
        window.localStorage.removeItem('dbot_execution_speed');
    });

    it('attaches the engine monitor even when tick history is already warm', () => {
        window.localStorage.setItem('dbot_execution_speed', 'slow');
        const engine = Object.create(TradeEngine.prototype);
        engine.checkTicksPromiseExists = jest.fn(() => ({ promise: Promise.resolve() }));
        engine.loginAndGetBalance = jest.fn(() => Promise.resolve());
        engine.watchTicks = jest.fn();

        engine.init('token', { symbol: 'R_25', contractTypes: ['DIGITEVEN'] });

        expect(engine.checkTicksPromiseExists).not.toHaveBeenCalled();
        expect(engine.watchTicks).toHaveBeenCalledWith('R_25');
    });

    it('waits for a fresh broker tick on every repeated purchase cycle', async () => {
        window.localStorage.setItem('dbot_execution_speed', 'slow');
        const store = createStore(rootReducer);

        store.dispatch({ type: constants.START });
        store.dispatch({ type: constants.PROPOSALS_READY });

        const firstWatch = watchBefore(store);
        store.dispatch({ type: constants.NEW_TICK, payload: 101 });
        await expect(firstWatch).resolves.toBe(true);

        store.dispatch({ type: constants.PURCHASE_SUCCESSFUL });
        store.dispatch({ type: constants.SELL });
        store.dispatch({ type: constants.START });

        let secondResolved = false;
        const secondWatch = watchBefore(store).then(result => {
            secondResolved = true;
            return result;
        });

        await Promise.resolve();
        expect(secondResolved).toBe(false);

        store.dispatch({ type: constants.NEW_TICK, payload: 102 });
        await expect(secondWatch).resolves.toBe(true);
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
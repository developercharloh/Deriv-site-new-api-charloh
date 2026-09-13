import { createStore } from 'redux';
import { watchScope } from '..';
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
    });
});
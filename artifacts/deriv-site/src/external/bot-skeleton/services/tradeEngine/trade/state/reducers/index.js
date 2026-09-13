import * as constants from '../constants';

const initialState = {
    scope: constants.STOP,
    proposalsReady: false,
    fastSlot: 0,
};

// eslint-disable-next-line default-param-last
const signal = (state = initialState, action) => {
    switch (action.type) {
        case constants.START:
            return {
                scope: constants.BEFORE_PURCHASE,
                proposalsReady: state.proposalsReady,
                newTick: state.newTick,
                fastReady: Boolean(state.fastReady),
                fastPending: false,
                fastSlot: state.fastSlot || 0,
            };
        case constants.PROPOSALS_READY:
            return {
                ...state,
                proposalsReady: true,
            };
        case constants.CLEAR_PROPOSALS:
            return {
                ...state,
                proposalsReady: false,
            };
        case constants.PURCHASE_SUCCESSFUL:
            return {
                scope: constants.DURING_PURCHASE,
                openContract: false,
                proposalsReady: state.proposalsReady,
                newTick: state.newTick,
                fastReady: false,
                fastPending: false,
                fastSlot: state.fastSlot || 0,
            };
        case constants.OPEN_CONTRACT:
            return {
                scope: constants.DURING_PURCHASE,
                openContract: true,
                proposalsReady: state.proposalsReady,
                newTick: state.newTick,
                fastReady: false,
                fastPending: false,
                fastSlot: state.fastSlot || 0,
            };
        case constants.SELL:
            return {
                scope: constants.STOP,
                proposalsReady: state.proposalsReady,
                newTick: state.newTick,
                fastReady: false,
                fastPending: false,
                fastSlot: state.fastSlot || 0,
            };
        case constants.FAST_REARM:
            return {
                ...state,
                scope: constants.BEFORE_PURCHASE,
                fastReady: true,
                fastSlot: (state.fastSlot || 0) + 1,
            };
        case constants.CONSUME_FAST_READY:
            return {
                ...state,
                fastReady: false,
            };
        case constants.NEW_TICK:
            return {
                ...state,
                newTick: action.payload,
            };
        default:
            return state;
    }
};

export default signal;

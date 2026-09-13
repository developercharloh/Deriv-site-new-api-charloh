import * as constants from '../constants';

const initialState = {
    scope: constants.STOP,
    proposalsReady: false,
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
            };
        case constants.OPEN_CONTRACT:
            return {
                scope: constants.DURING_PURCHASE,
                openContract: true,
                proposalsReady: state.proposalsReady,
                newTick: state.newTick,
                fastReady: false,
                fastPending: false,
            };
        case constants.SELL:
            return {
                scope: constants.STOP,
                proposalsReady: state.proposalsReady,
                newTick: state.newTick,
                fastReady: false,
                fastPending: false,
            };
        case constants.FAST_REARM:
            return {
                ...state,
                scope: constants.BEFORE_PURCHASE,
                fastReady: true,
                fastPending: false,
            };
        case constants.FAST_ARM_NEXT_TICK:
            return {
                ...state,
                scope: constants.STOP,
                fastReady: false,
                fastPending: true,
            };
        case constants.NEW_TICK:
            if (state.fastPending) {
                return {
                    ...state,
                    scope: constants.BEFORE_PURCHASE,
                    fastReady: true,
                    fastPending: false,
                    newTick: action.payload,
                };
            }
            return {
                ...state,
                newTick: action.payload,
            };
        default:
            return state;
    }
};

export default signal;

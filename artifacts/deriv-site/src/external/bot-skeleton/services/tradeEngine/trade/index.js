import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { checkBlocksForProposalRequest, doUntilDone } from '../utils/helpers';
import { expectInitArg } from '../utils/sanitize';
import { fastRearm, proposalsReady, sell, start } from './state/actions';
import * as constants from './state/constants';
import rootReducer from './state/reducers';
import Balance from './Balance';
import OpenContract from './OpenContract';
import Proposal from './Proposal';
import Purchase from './Purchase';
import Sell from './Sell';
import Ticks from './Ticks';
import Total from './Total';
import {
    FAST_CONTRACT_DURATION_UNIT,
    FAST_CONTRACT_DURATION_VALUE,
    getBotExecutionSpeed,
} from '@/constants/bot-execution-speed';
import { FastExecutionClock } from '@/utils/fast-execution-clock';

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

/* The watchScope function is called randomly and resets the prevTick
 * which leads to the same problem we try to solve. So prevTick is isolated
 */
let prevTick;
export const watchScope = ({ store, stopScope, passScope, passFlag, onTick }) => {
    // in case watch is called after stop is fired
    if (store.getState().scope === stopScope) {
        return Promise.resolve(false);
    }
    return new Promise(resolve => {
        const currentState = store.getState();
        let hasObservedNextTick = false;
        if (
            currentState.scope === passScope &&
            currentState[passFlag] &&
            currentState.fastReady &&
            getBotExecutionSpeed() === 'fast'
        ) {
            // FAST_REARM is a one-shot clock signal. Consume it before
            // resolving so the generated `while (watch('before'))` loop
            // cannot resolve synchronously forever on the same slot.
            store.dispatch({ type: constants.CONSUME_FAST_READY });
            resolve(true);
            return;
        }

        const unsubscribe = store.subscribe(() => {
            const newState = store.getState();

            if (newState.scope === stopScope) {
                unsubscribe();
                resolve(false);
                return;
            }
            if (newState.scope !== passScope) {
                unsubscribe();
                resolve(false);
                return;
            }

            const hasNewTick = newState.newTick !== prevTick;
            if (hasNewTick) {
                prevTick = newState.newTick;
                hasObservedNextTick = true;
            }

            if (onTick?.()) {
                unsubscribe();
                resolve(false);
                return;
            }

            // SLOW retains Deriv's normal next-tick behavior. FAST is released
            // by the one-second clock, never by a broker tick.
            const fastClockReleased =
                getBotExecutionSpeed() === 'fast' && newState.fastReady;
            if (
                (hasObservedNextTick || fastClockReleased) &&
                newState.scope === passScope &&
                newState[passFlag]
            ) {
                if (fastClockReleased) {
                    // Consume the release before resolving the watcher. The
                    // next watch call must wait for the next wall-clock slot.
                    store.dispatch({ type: constants.CONSUME_FAST_READY });
                }
                unsubscribe();
                resolve(true);
            }
        });
    });
};

export default class TradeEngine extends Balance(Purchase(Sell(OpenContract(Proposal(Ticks(Total(class {}))))))) {
    constructor($scope) {
        super();
        this.observer = $scope.observer;
        this.$scope = $scope;
        this.observe();
        this.data = {
            contract: {},
            proposals: [],
        };
        this.lastSettledContract = null;
        this.subscription_id_for_accumulators = null;
        this.is_proposal_requested_for_accumulators = false;
        this.fastClock = null;
        this.fastClockActive = false;
        this.hasStarted = false;
        this.store = createStore(rootReducer, applyMiddleware(thunk));
        this.binaryMatrixStakeState = null;
    }

    init(...args) {
        const [token, options] = expectInitArg(args);
        const { symbol } = options;

        this.initArgs = args;
        this.options = options;
        this.startPromise = this.loginAndGetBalance(token);

        if (!this.checkTicksPromiseExists()) this.watchTicks(symbol);
    }

    start(tradeOptions) {
        if (!this.options) {
            throw createError('NotInitialized', getLocalizedErrorMessage('NotInitialized'));
        }

        globalObserver.emit('bot.running');

        const validated_trade_options = this.validateTradeOptions(tradeOptions);
        const executionSpeed = getBotExecutionSpeed();
        const fastClockAlreadyRunning = this.fastClock?.isRunning() === true;
        const isNewBotSession = !this.hasStarted;
        this.hasStarted = true;
        if (executionSpeed !== 'fast') {
            this.stopFastClock();
        }
        this.tradeOptions = {
            ...this.getBinaryMatrixTradeOptions(validated_trade_options),
            ...(executionSpeed === 'fast'
                ? {
                    duration: FAST_CONTRACT_DURATION_VALUE,
                    duration_unit: FAST_CONTRACT_DURATION_UNIT,
                }
                : {}),
            symbol: this.options.symbol,
        };
        this.fastClockActive = executionSpeed === 'fast';
        // Bot.start is called again at the beginning of each generated trade
        // cycle. Only clear the previous result for a genuinely new session;
        // clearing it on every cycle makes Martingale look like a first-trade
        // win and skips the authoritative loss result.
        if (isNewBotSession) this.lastSettledContract = null;

        // The generated program calls Bot.start at the beginning of every
        // trade cycle. A settlement can mark the active contract complete
        // just before the interpreter resumes, while the Redux scope is
        // still DURING_PURCHASE. Normalize that completed cycle before
        // starting the next one; otherwise start() is correctly ignored by
        // the reducer and the following watch('before') waits forever.
        if (this.getActiveContractIds().length === 0 && this.store.getState().scope !== constants.STOP) {
            this.store.dispatch(sell());
        }
        this.store.dispatch(start());
        this.checkLimits(validated_trade_options);
        this.fastClockActive = executionSpeed === 'fast';
        // The generated DBot program calls Bot.start again at the beginning
        // of each trade cycle. Do not restart the FAST clock there: its
        // immediate first slot would recursively restart the cycle and lock
        // the browser after the first settlement.
        if (this.fastClockActive && !fastClockAlreadyRunning) this.startFastClock();

        this.makeDirectPurchaseDecision();
    }

    isBinaryMatrixWorkspace() {
        const blocks = window.Blockly?.derivWorkspace?.getAllBlocks?.(true) ?? [];
        return blocks.some(block => ['last_digits_condition', 'apollo_purchase2'].includes(block.type));
    }

    readBinaryMatrixNumberVariable(name, fallback) {
        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace) return fallback;

        const setter = workspace.getAllBlocks?.(true)?.find(block => {
            if (block.type !== 'variables_set') return false;
            const variableId = block.getFieldValue?.('VAR');
            const variableModel = workspace.getVariableById?.(variableId)
                ?? workspace.getVariableMap?.()?.getVariableById?.(variableId);
            const variableName = variableModel?.name
                ?? block.getField?.('VAR')?.getText?.()
                ?? block.getField?.('VAR')?.getValue?.();
            return variableName === name;
        });
        const valueBlock = setter?.getInputTargetBlock?.('VALUE')
            ?? setter?.getChildren?.()?.find(child =>
                ['math_number', 'math_number_positive'].includes(child.type)
            );
        const value = Number(valueBlock?.getFieldValue?.('NUM'));
        return Number.isFinite(value) ? value : fallback;
    }

    getBinaryMatrixTradeOptions(tradeOptions) {
        if (!this.isBinaryMatrixWorkspace()) {
            this.binaryMatrixStakeState = null;
            return tradeOptions;
        }

        const suppliedStake = Number(tradeOptions.amount);
        if (!Number.isFinite(suppliedStake) || suppliedStake <= 0) return tradeOptions;

        if (!this.binaryMatrixStakeState) {
            this.binaryMatrixStakeState = {
                initialStake: suppliedStake,
                currentStake: suppliedStake,
                multiplier: Math.max(1, this.readBinaryMatrixNumberVariable('Martingale', 2)),
            };
        }

        return {
            ...tradeOptions,
            amount: this.binaryMatrixStakeState.currentStake,
        };
    }

    applyBinaryMatrixSettlement(contract) {
        if (!this.binaryMatrixStakeState) return;

        const reportedProfit = Number(contract?.profit);
        const sellPrice = Number(contract?.sell_price);
        const buyPrice = Number(contract?.buy_price);
        const profit = Number.isFinite(reportedProfit)
            ? reportedProfit
            : sellPrice - buyPrice;
        const isWin = Number.isFinite(profit) && profit > 0;

        this.binaryMatrixStakeState.currentStake = isWin
            ? this.binaryMatrixStakeState.initialStake
            : Number(
                (this.binaryMatrixStakeState.currentStake * this.binaryMatrixStakeState.multiplier).toFixed(2)
            );
    }

    startFastClock() {
        this.stopFastClock();
        this.fastClockActive = true;
        this.fastClock = new FastExecutionClock(() => {
            // FAST is clock-paced, but never starts another contract while the
            // previous one is still open. This keeps Martingale progression
            // tied to the immediately preceding authoritative settlement.
            if (this.getActiveContractIds().length > 0) return;
            this.store.dispatch(fastRearm());
        });
        this.fastClock.start();
    }

    stopFastClock() {
        this.fastClockActive = false;
        this.fastClock?.stop();
        this.fastClock = null;
    }

    loginAndGetBalance(token) {
        if (this.token === token) {
            return Promise.resolve();
        }
        // for strategies using total runs, GetTotalRuns function is trying to get loginid and it gets called before Proposals calls.
        // the below required loginid to be set in Proposal calls where loginAndGetBalance gets resolved.
        // Earlier this used to happen as soon as we get ticks_history response and by the time GetTotalRuns gets called we have required info.
        this.accountInfo = api_base.account_info;
        this.token = api_base.token;
        return new Promise(resolve => {
            // Try to recover from a situation where API doesn't give us a correct response on
            // "proposal_open_contract" which would make the bot run forever. When there's a "sell"
            // event, wait a couple seconds for the API to give us the correct "proposal_open_contract"
            // response, if there's none after x seconds. Send an explicit request, which _should_
            // solve the issue. This is a backup!
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'transaction' && data.transaction.action === 'sell') {
                    const contractState = this.getContractState?.(data.transaction.contract_id);
                    if (!contractState) return;
                    contractState.recoveryTimeout = setTimeout(() => {
                        const contract = contractState?.contract ?? {};
                        // contract.status is 'open' for the proposal-subscription path.
                        // For the direct-buy path the contract object may be empty {} if no
                        // proposal_open_contract message was ever received (subscribe:1 was
                        // missing), so status is undefined — treat that as "needs recovery" too.
                        const is_open_contract = contract.status === 'open' || !contract.status;
                        if (!contractState.settled && is_open_contract) {
                            doUntilDone(() => {
                                api_base.api.send({ proposal_open_contract: 1, contract_id: data.transaction.contract_id });
                            }, ['PriceMoved']);
                        }
                    // Reduced from 1500 → 300 ms: digit contracts settle in ≈ 1 tick (≈ 1 s).
                    }, 300);
                }
                resolve();
            });
            api_base.pushSubscription(subscription);
        });
    }

    observe() {
        this.observeOpenContract();
        this.observeBalance();
        this.observeProposals();
    }

    watch(watchName) {
        if (watchName === 'before') {
            return watchBefore(this.store);
        }
        return watchDuring(this.store);
    }

    makeDirectPurchaseDecision() {
        const { has_payout_block, is_basis_payout } = checkBlocksForProposalRequest();
        this.is_proposal_subscription_required = has_payout_block || is_basis_payout;

        if (this.is_proposal_subscription_required) {
            this.makeProposals({ ...this.options, ...this.tradeOptions });
            this.checkProposalReady();
        } else {
            this.store.dispatch(proposalsReady());
        }
    }
}

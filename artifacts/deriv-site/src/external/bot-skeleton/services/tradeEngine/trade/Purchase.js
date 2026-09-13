import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';
import {
    releaseBotContractGate,
    setBotContractGateContract,
    tryAcquireBotContractGate,
} from '@/utils/bot-contract-gate';
import { getBotExecutionSpeed } from '@/constants/bot-execution-speed';

let delayIndex = 0;
let purchase_reference;

export const getPurchaseTradeOptions = (tradeOptions, prediction) => {
    if (prediction === undefined || prediction === null || prediction === '') {
        return tradeOptions;
    }

    const numericPrediction = Number(prediction);
    if (!Number.isFinite(numericPrediction)) return tradeOptions;

    return {
        ...tradeOptions,
        prediction: numericPrediction,
    };
};

export default Engine =>
    class Purchase extends Engine {
        getContractState(contractId) {
            return this.activeContracts?.get(String(contractId));
        }

        getActiveContractIds() {
            return [...(this.activeContracts?.values() ?? [])]
                .filter(contractState => !contractState.settled)
                .map(contractState => contractState.contractId);
        }

        setCurrentContract(contractId) {
            const contractState = this.getContractState(contractId);
            if (!contractState || contractState.settled) return;

            this.contractId = contractState.contractId;
            this.data.contract = contractState.contract;
            this.isSold = contractState.isSold;
            this.isSellAvailable = contractState.isSellAvailable;
            this.isExpired = contractState.isExpired;
            this.hasEntryTick = contractState.hasEntryTick;
        }

        selectLatestActiveContract() {
            const latest = [...(this.activeContracts?.values() ?? [])]
                .reverse()
                .find(contractState => !contractState.settled);

            if (latest) {
                this.setCurrentContract(latest.contractId);
            } else {
                this.contractId = '';
                this.data.contract = {};
                this.isSold = true;
                this.isSellAvailable = false;
                this.isExpired = true;
            }
        }

        purchase(contract_type, prediction) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }
            // Use this engine's own observed tick first. The shared latest-tick
            // value can be absent when the ticks monitor was already warm or
            // when another DBot session owns the shared service. In either
            // case, the Redux tick epoch is the value that released this
            // engine's before-purchase cycle and must be consumed once.
            const isFast = getBotExecutionSpeed() === 'fast';
            const currentTick = this.store.getState().newTick;
            const symbol = this.tradeOptions?.symbol || this.options?.symbol || this.symbol;
            const signalKey =
                isFast || currentTick === null || currentTick === undefined || currentTick === ''
                    ? undefined
                    : `${symbol ?? 'unknown'}:${String(currentTick)}`;
            // FAST is clock-paced and must be able to place one contract per
            // clock slot. SLOW keeps the single-contract gate so its normal
            // broker-tick flow cannot duplicate a purchase. FAST settlement
            // remains authoritative for result reporting and stake updates,
            // while the clock owns the purchase cadence.
            // A FAST clock slot must not create a second in-flight contract.
            // Waiting for settlement is required for deterministic Martingale
            // progression; the next clock slot will re-arm after this one is
            // settled.
            if (!tryAcquireBotContractGate(this, signalKey, false)) {
                return Promise.resolve();
            }
            const purchaseTradeOptions = getPurchaseTradeOptions(this.tradeOptions, prediction);
            const releasePurchaseLease = () =>
                releaseBotContractGate(this, undefined, signalKey);

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                const contractState = {
                    contractId: String(buy.contract_id),
                    signalKey: signalKey ?? null,
                    contract: {},
                    isSold: false,
                    isSellAvailable: false,
                    isExpired: false,
                    hasEntryTick: false,
                    settled: false,
                    afterPromise: null,
                    afterWatchdog: null,
                    afterWatchdog2: null,
                    recoveryTimeout: null,
                };
                if (!this.activeContracts) this.activeContracts = new Map();
                this.activeContracts.set(contractState.contractId, contractState);
                this.setCurrentContract(contractState.contractId);
                setBotContractGateContract(this, buy.contract_id, signalKey);
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                } else {
                    // ── Direct buy path: explicit POC subscription ────────────────
                    // When buying with `buy: '1'` (no prior proposal subscription),
                    // Deriv does NOT automatically push proposal_open_contract updates.
                    // The subscribe:1 field in the buy body is only honoured for
                    // proposal-id buys; for direct buys it is silently ignored.
                    // Without this request, observeOpenContract never receives the
                    // is_sold message and watch('during') hangs forever, freezing the
                    // bot at "Contract bought" indefinitely.
                    doUntilDone(
                        () => api_base.api.send({
                            proposal_open_contract: 1,
                            contract_id: buy.contract_id,
                            subscribe: 1,
                        }),
                        ['PriceMoved']
                    );
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required) {
                let selectedProposal;
                try {
                    selectedProposal = this.selectProposal(contract_type);
                } catch (error) {
                    releasePurchaseLease();
                    throw error;
                }
                const { id, askPrice } = selectedProposal;

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess).catch(error => {
                        releasePurchaseLease();
                        throw error;
                    });
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess).catch(error => {
                    releasePurchaseLease();
                    throw error;
                });
            }
            let trade_option;
            try {
                trade_option = tradeOptionToBuy(contract_type, purchaseTradeOptions);
            } catch (error) {
                releasePurchaseLease();
                throw error;
            }
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess).catch(error => {
                    releasePurchaseLease();
                    throw error;
                });
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess).catch(error => {
                releasePurchaseLease();
                throw error;
            });
        }
        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };

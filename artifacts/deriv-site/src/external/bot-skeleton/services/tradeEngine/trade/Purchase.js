import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log, notify } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { consumeFastReady, fastRearm, purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';
import {
    requestBotContractGate,
    getBotContractSessionId,
    releaseBotContractGate,
    setBotContractGateContract,
    tryAcquireBotContractGate,
} from '@/utils/bot-contract-gate';
import { getBotExecutionSpeed } from '@/constants/bot-execution-speed';
import { observer as globalObserver } from '../../../utils/observer';
import { getFastLatencyNow } from '../utils/fast-latency';

export const getPurchaseTradeOptions = (tradeOptions, prediction, contractType) => {
    if (['DIGITEVEN', 'DIGITODD'].includes(contractType)) {
        const { prediction: _ignoredPrediction, ...parityTradeOptions } = tradeOptions;
        return parityTradeOptions;
    }

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

const getPurchaseMappingLabel = (contractType, prediction) => {
    if (contractType === 'DIGITOVER') return `Over ${prediction}`;
    if (contractType === 'DIGITUNDER') return `Under ${prediction}`;
    if (contractType === 'DIGITEVEN') return 'Even';
    if (contractType === 'DIGITODD') return 'Odd';
    return contractType;
};

export default Engine =>
    class Purchase extends Engine {
        recordFastPurchaseRequest(contractType) {
            if (
                getBotExecutionSpeed() !== 'fast' ||
                !Number.isFinite(this.fastSettlementHandoffStartedAt)
            ) {
                return;
            }

            const purchaseRequestAt = getFastLatencyNow();
            const latencyMs = Math.max(0, purchaseRequestAt - this.fastSettlementHandoffStartedAt);
            this.lastFastHandoffLatencyMs = latencyMs;
            this.fastSettlementHandoffStartedAt = null;
            globalObserver.emit('bot.fast.latency', {
                event: 'settlement_to_purchase_request',
                latencyMs,
                market: this.tradeOptions?.symbol || this.options?.symbol || this.symbol,
                contractType,
                lockedDirection: this.volatilitySelectionLock?.signal || null,
            });
        }

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

        async purchaseFastLocked(contractType, prediction) {
            if (
                getBotExecutionSpeed() !== 'fast' ||
                !this.fastClockActive ||
                this.paused ||
                !['CALL', 'PUT'].includes(contractType) ||
                !this.volatilitySelectionLock ||
                this.getActiveContractIds().length > 0
            ) {
                return false;
            }

            // Re-enter the normal purchase path with a fresh FAST slot. This
            // keeps the existing contract gate, proposal selection, and broker
            // error handling in one place while avoiding the generated
            // before-purchase analysis stack.
            this.store.dispatch(fastRearm());
            this.store.dispatch(consumeFastReady());

            if (this.is_proposal_subscription_required) {
                const proposalsReady = await this.waitForProposalsReady();
                if (!proposalsReady) return false;
            }

            await this.purchase(contractType, prediction);
            return true;
        }

        async purchase(contract_type, prediction) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return;
            }
            const requestedContractType = contract_type;
            const requestedPrediction = prediction;
            // A Smart Over 2 workspace can have older saved Purchase blocks that
            // still request Over 2 during recovery. The staged order is authoritative
            // at the broker boundary, not just in the Journal message.
            let smartOver2V3Plan = this.getSmartOver2V3PurchasePlan?.(contract_type, prediction);
            if (smartOver2V3Plan?.blocked) return Promise.resolve(false);
            if (smartOver2V3Plan?.order) {
                contract_type = smartOver2V3Plan.contractType;
                prediction = smartOver2V3Plan.prediction;
            }
            let recoveryPlan = this.getSmartOver2RecoveryPurchasePlan?.(contract_type, prediction);
            if (recoveryPlan?.blocked) return Promise.resolve(false);
            if (recoveryPlan?.order) {
                contract_type = recoveryPlan.contractType;
                prediction = recoveryPlan.prediction;
            }
            // Blockly conditions are user-editable and saved workspaces can retain
            // older purchase branches. Once the current cycle has evaluated signal
            // confidence and indicators, enforce the same requirements here so the
            // first contract cannot bypass an unmet confidence or trend condition.
            if (!this.isPurchaseConditionGateOpen(contract_type)) {
                if (this.volatilitySelectionLock) {
                    this.releaseVolatilitySelection?.('live_conditions_failed');
                } else {
                    const conditionSnapshot = this.getVolatilityConditionSnapshot?.(contract_type);
                    if (conditionSnapshot) {
                        globalObserver.emit('bot.volatility.scan', {
                            event: 'blocked',
                            market: this.tradeOptions?.symbol || this.options?.symbol || this.symbol,
                            contractType: contract_type,
                            ...conditionSnapshot,
                            reason: 'live_conditions_failed',
                        });
                    } else {
                        notify(
                            'warning',
                            `Purchase blocked: ${contract_type} conditions were not satisfied for the current tick.`
                        );
                    }
                }
                return Promise.resolve();
            }
            // Use this engine's own observed tick first. The shared latest-tick
            // value can be absent when the ticks monitor was already warm or
            // when another DBot session owns the shared service. In either
            // case, the Redux tick epoch is the value that released this
            // engine's before-purchase cycle and must be consumed once.
            const isFast = getBotExecutionSpeed() === 'fast';
            const isCoordinatedSmartOver2 =
                isFast && Boolean(this.isSmartOver2TurboWorkspace?.());
            const currentTradeState = this.store.getState();
            const currentTick = currentTradeState.newTick;
            const symbol = this.tradeOptions?.symbol || this.options?.symbol || this.symbol;
            let waitedForBotGate = false;
            const signalKey =
                isFast
                    ? `fast:${getBotContractSessionId(this)}:${String(currentTradeState.fastSlot || 0)}`
                    : currentTick === null || currentTick === undefined || currentTick === ''
                      ? undefined
                      : `${symbol ?? 'unknown'}:${String(currentTick)}`;
            const purchaseTick = currentTradeState.newTick ?? this.latestTick?.epoch ?? null;
            const isPurchaseSignalCurrent = () => {
                const state = this.store.getState();
                const observedTick = state.newTick ?? this.latestTick?.epoch ?? null;
                const observedSymbol = this.tradeOptions?.symbol || this.options?.symbol || this.symbol;
                return (
                    state.scope === BEFORE_PURCHASE &&
                    !state.paused &&
                    !this.paused &&
                    (!isCoordinatedSmartOver2 ||
                        (getBotExecutionSpeed() === 'fast' &&
                            observedSymbol === symbol &&
                            observedTick === purchaseTick))
                );
            };
            // FAST is clock-paced and must be able to place one contract per
            // clock slot. SLOW keeps the single-contract gate so its normal
            // broker-tick flow cannot duplicate a purchase. FAST settlement
            // remains authoritative for result reporting and stake updates,
            // while the clock owns the purchase cadence.
            // A FAST clock slot must not create a second in-flight contract.
            // Waiting for settlement is required for deterministic Martingale
            // progression; the next clock slot will re-arm after this one is
            // settled.
            const gateAcquired = isCoordinatedSmartOver2
                ? await requestBotContractGate(
                      this,
                      signalKey,
                      isPurchaseSignalCurrent,
                      () => {
                          waitedForBotGate = true;
                      }
                  )
                : tryAcquireBotContractGate(this, signalKey, false);
            if (!gateAcquired) return false;
            let recoveryOrder = null;
            let smartOver2V3Order = null;
            let purchaseLeaseReleased = false;
            const releasePurchaseLease = () => {
                if (purchaseLeaseReleased) return;
                purchaseLeaseReleased = true;
                if (smartOver2V3Order) this.abortSmartOver2V3Purchase?.(smartOver2V3Order);
                if (recoveryOrder) this.abortSmartOver2RecoveryPurchase?.(recoveryOrder);
                releaseBotContractGate(this, undefined, signalKey);
            };

            if (!isPurchaseSignalCurrent()) {
                releasePurchaseLease();
                return false;
            }

            if (isCoordinatedSmartOver2) {
                // A queued bot may have waited through several market updates.
                // Re-read the staged Smart Over 2 order only after it owns the
                // account gate, so no stale recovery/V3 plan can be purchased.
                try {
                    contract_type = requestedContractType;
                    prediction = requestedPrediction;
                    smartOver2V3Plan = this.getSmartOver2V3PurchasePlan?.(contract_type, prediction);
                    if (smartOver2V3Plan?.blocked) {
                        releasePurchaseLease();
                        return false;
                    }
                    if (smartOver2V3Plan?.order) {
                        contract_type = smartOver2V3Plan.contractType;
                        prediction = smartOver2V3Plan.prediction;
                    }
                    recoveryPlan = this.getSmartOver2RecoveryPurchasePlan?.(contract_type, prediction);
                    if (recoveryPlan?.blocked) {
                        releasePurchaseLease();
                        return false;
                    }
                    if (recoveryPlan?.order) {
                        contract_type = recoveryPlan.contractType;
                        prediction = recoveryPlan.prediction;
                    }
                    if (!this.isPurchaseConditionGateOpen(contract_type)) {
                        releasePurchaseLease();
                        return false;
                    }
                } catch (error) {
                    releasePurchaseLease();
                    throw error;
                }
            }

            if (smartOver2V3Plan?.order) {
                smartOver2V3Order = this.beginSmartOver2V3Purchase?.(smartOver2V3Plan.order);
                if (!smartOver2V3Order) {
                    releasePurchaseLease();
                    return Promise.resolve(false);
                }
            }
            if (recoveryPlan?.order) {
                recoveryOrder = this.beginSmartOver2RecoveryPurchase?.(recoveryPlan.order);
                if (!recoveryOrder) {
                    releasePurchaseLease();
                    return Promise.resolve(false);
                }
            }
            globalObserver.emit('bot.purchase.mapping', {
                contractType: contract_type,
                prediction: ['DIGITEVEN', 'DIGITODD'].includes(contract_type) ? null : prediction ?? null,
                label: getPurchaseMappingLabel(contract_type, prediction),
            });
            const purchaseTradeOptions = getPurchaseTradeOptions(this.tradeOptions, prediction, contract_type);

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;
                if (smartOver2V3Order) {
                    this.completeSmartOver2V3Purchase?.(smartOver2V3Order, buy);
                }
                if (recoveryOrder) {
                    this.completeSmartOver2RecoveryPurchase?.(recoveryOrder, buy);
                }

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
                    entryLogged: false,
                };
                if (!this.activeContracts) this.activeContracts = new Map();
                this.activeContracts.set(contractState.contractId, contractState);
                this.setCurrentContract(contractState.contractId);
                setBotContractGateContract(this, buy.contract_id, signalKey);
                this.store.dispatch(purchaseSuccessful());
                globalObserver.emit('bot.volatility.scan', {
                    event: 'purchase',
                    market: this.tradeOptions?.symbol || this.options?.symbol || this.symbol,
                    contractType: contract_type,
                    contractId: buy.contract_id,
                    buyPrice: buy.buy_price,
                    ...this.getVolatilityConditionSnapshot?.(contract_type),
                });

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

                this.purchaseDelayIndex = 0;
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
                let proposalsReady;
                try {
                    proposalsReady = this.prepareProposalsForPurchase?.(
                        purchaseTradeOptions,
                        waitedForBotGate
                    ) ??
                        this.waitForProposalsReady();
                } catch (error) {
                    releasePurchaseLease();
                    throw error;
                }
                return Promise.resolve(proposalsReady).then(isReady => {
                    if (!isReady || !isPurchaseSignalCurrent()) {
                        releasePurchaseLease();
                        if (!isReady) {
                            notify('warning', 'Purchase blocked: the matching contract proposal was not ready.');
                        }
                        return false;
                    }

                    let selectedProposal;
                    try {
                        selectedProposal = this.selectProposal(contract_type, prediction);
                    } catch (error) {
                        releasePurchaseLease();
                        throw error;
                    }
                    const { id, askPrice } = selectedProposal;

                    const action = () => {
                        if (!isPurchaseSignalCurrent()) {
                            const error = new Error('The purchase signal expired before the order was sent.');
                            error.error = { code: 'STALE_PURCHASE_SIGNAL' };
                            throw error;
                        }
                        this.recordFastPurchaseRequest(contract_type);
                        return api_base.api.send({ buy: id, price: askPrice });
                    };

                    this.isSold = false;

                    contractStatus({
                        id: 'contract.purchase_sent',
                        data: askPrice,
                    });

                    if (!this.options.timeMachineEnabled) {
                        return doUntilDone(action).then(onSuccess).catch(error => {
                            releasePurchaseLease();
                            if (error?.error?.code === 'STALE_PURCHASE_SIGNAL') return false;
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
                        this.getNextPurchaseDelayIndex()
                    ).then(onSuccess).catch(error => {
                        releasePurchaseLease();
                        if (error?.error?.code === 'STALE_PURCHASE_SIGNAL') return false;
                        throw error;
                    });
                }, error => {
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
            const action = () => {
                if (!isPurchaseSignalCurrent()) {
                    const error = new Error('The purchase signal expired before the order was sent.');
                    error.error = { code: 'STALE_PURCHASE_SIGNAL' };
                    throw error;
                }
                this.recordFastPurchaseRequest(contract_type);
                return api_base.api.send(trade_option);
            };

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess).catch(error => {
                    releasePurchaseLease();
                    if (error?.error?.code === 'STALE_PURCHASE_SIGNAL') return false;
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
                this.getNextPurchaseDelayIndex()
            ).then(onSuccess).catch(error => {
                releasePurchaseLease();
                if (error?.error?.code === 'STALE_PURCHASE_SIGNAL') return false;
                throw error;
            });
        }
        getPurchaseReference = () => this.purchaseReference;
        regeneratePurchaseReference = () => {
            this.purchaseReference = getUUID();
        };
        getNextPurchaseDelayIndex = () => {
            const currentIndex = Number.isFinite(this.purchaseDelayIndex) ? this.purchaseDelayIndex : 0;
            this.purchaseDelayIndex = currentIndex + 1;
            return currentIndex;
        };
    };

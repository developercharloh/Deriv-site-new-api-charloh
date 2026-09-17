import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { adaptiveMomentumLog, contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { doUntilDone } from '../utils/helpers';
import { fastRearm, openContractReceived, sell } from './state/actions';
import { releaseBotContractGate } from '@/utils/bot-contract-gate';
import { getBotExecutionSpeed } from '@/constants/bot-execution-speed';
import { observer as globalObserver } from '../../../utils/observer';
import { getFastLatencyNow } from '../utils/fast-latency';

export default Engine =>
    class OpenContract extends Engine {
        clearAfterWatchdogs(contractState) {
            if (!contractState) return;
            clearTimeout(contractState.afterWatchdog);
            clearTimeout(contractState.afterWatchdog2);
            contractState.afterWatchdog = null;
            contractState.afterWatchdog2 = null;
        }

        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    const contractState = this.getContractState?.(contract.contract_id);
                    if (!contractState) return;
                    if (contractState.settled) return;

                    this.setContractFlags(contract, contractState);
                    contractState.contract = contract;

                    if (
                        !contractState.entryLogged &&
                        contract.entry_tick !== undefined &&
                        contract.entry_tick !== null &&
                        contract.entry_tick !== ''
                    ) {
                        contractState.entryLogged = true;
                        const entryEvent = {
                            market: contract.underlying || this.symbol || 'N/A',
                            contractId: contract.contract_id,
                            contractType: contract.contract_type,
                            entryTick: contract.entry_tick,
                            entryTickTime: contract.entry_tick_time,
                            buyPrice: contract.buy_price,
                        };
                        const conditionSnapshot = this.getVolatilityConditionSnapshot?.(contract.contract_type);
                        if (conditionSnapshot) {
                            globalObserver.emit('bot.volatility.scan', {
                                event: 'entry',
                                ...entryEvent,
                                ...conditionSnapshot,
                            });
                        }
                        if (this.adaptiveMomentumActive) {
                            adaptiveMomentumLog({
                                event: 'entry',
                                ...entryEvent,
                            });
                        }
                    }

                    if (String(contract.contract_id) === String(this.contractId)) {
                        this.data.contract = contract;
                    }

                    const executionSpeed = getBotExecutionSpeed();
                    const isFinalSettlement = Boolean(contractState.isSold && !contractState.settled);

                    // FAST must not let a UI subscriber sit in front of the
                    // next purchase. Publish the final contract snapshot
                    // after the settlement path has released the gate.
                    if (!isFinalSettlement || executionSpeed !== 'fast') {
                        broadcastContract({ accountID: api_base.account_info.loginid, ...contract });
                    }

                    if (isFinalSettlement) {
                        contractState.settled = true;
                        // Keep result-dependent generated bot logic tied to the
                        // latest final broker settlement. In FAST, the current
                        // contract may already be a newer open contract.
                        this.lastSettledContract = contract;
                        clearTimeout(contractState.recoveryTimeout);
                        this.clearAfterWatchdogs(contractState);

                        // Update the authoritative settlement and unlock the
                        // generated after-purchase path before broadcasting
                        // the UI status. FAST must buy from this broker event,
                        // not from a later rendered win/loss notification.
                        this.updateTotals(contract, executionSpeed === 'fast');
                        this.applyBinaryMatrixSettlement(contract);
                        const selectedVolatility = this.volatilitySelectionLock;
                        globalObserver.emit('bot.volatility.scan', {
                            event: 'settlement',
                            market: contract.underlying || this.symbol || this.options?.symbol,
                            contractId: contract.contract_id,
                            outcome: contract.status || (Number(contract.profit) >= 0 ? 'won' : 'lost'),
                            profit: contract.profit,
                            continuesOnSelectedMarket: Boolean(selectedVolatility?.code),
                            selectedMarket: selectedVolatility?.code || null,
                        });
                        if (executionSpeed === 'fast') {
                            // The settlement determines the next Binary Matrix
                            // stake. Start its proposal request now instead of
                            // waiting for the interpreter to finish the cycle.
                            this.prewarmFastNextProposal?.();
                        }

                        const hasOtherActiveContracts = this.getActiveContractIds().length > 0;
                        const settlementDrivenFast =
                            executionSpeed === 'fast' &&
                            !hasOtherActiveContracts &&
                            ['CALL', 'PUT'].includes(this.volatilitySelectionLock?.signal);
                        if (settlementDrivenFast) {
                            this.fastSettlementHandoffStartedAt = getFastLatencyNow();
                        }
                        if (!hasOtherActiveContracts) this.prepareVolatilityRescan?.();
                        const clockPacedFast = executionSpeed === 'fast' && this.fastClockActive;
                        const canFastRearm = releaseBotContractGate(
                            this,
                            contract.contract_id,
                            contractState.signalKey,
                            executionSpeed === 'fast' && !clockPacedFast,
                        );
                        if (clockPacedFast) {
                            // Close the generated during-purchase cycle as soon
                            // as settlement is authoritative. Leaving Redux in
                            // DURING_PURCHASE here can make the interpreter wait
                            // forever after the first FAST contract settles.
                            if (!hasOtherActiveContracts) this.store.dispatch(sell());
                            if (!hasOtherActiveContracts && !settlementDrivenFast) {
                                this.scheduleFastSlotAfterSettlement?.();
                            }
                        } else if (canFastRearm) {
                            this.store.dispatch(fastRearm());
                        } else if (!hasOtherActiveContracts) {
                            this.store.dispatch(sell());
                        }

                        // Complete the engine state transition before resuming
                        // any interpreter continuation waiting on a manual sell.
                        // Resolving first lets the generated cycle re-enter
                        // while the store is still DURING_PURCHASE and the
                        // contract gate is still owned by the settled trade.
                        if (contractState.afterPromise) {
                            // Clear before calling to prevent double-resolution
                            const resolve = contractState.afterPromise;
                            contractState.afterPromise = null;
                            resolve();
                        }

                        this.activeContracts?.delete(String(contract.contract_id));
                        if (hasOtherActiveContracts) this.selectLatestActiveContract?.();
                        this.fastSettlementHandoffPending = settlementDrivenFast;

                        const publishSettlement = () => {
                            if (executionSpeed === 'fast') {
                                broadcastContract({ accountID: api_base.account_info.loginid, ...contract });
                            }
                            contractStatus({
                                id: 'contract.sold',
                                data: contract.transaction_ids.sell,
                                contract,
                            });
                        };
                        if (executionSpeed === 'fast') {
                            queueMicrotask(publishSettlement);
                        } else {
                            publishSettlement();
                        }
                    } else {
                        if (getBotExecutionSpeed() !== 'fast') {
                            this.store.dispatch(openContractReceived());
                        }
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        waitForAfter(contractId = this.contractId) {
            const contractState = this.getContractState?.(contractId);
            if (!contractState) return Promise.resolve();

            return new Promise(resolve => {
                // Wrap resolve so watchdogs and the normal path share one clear-and-call pattern
                const done = () => {
                    clearTimeout(contractState.afterWatchdog);
                    clearTimeout(contractState.afterWatchdog2);
                    if (contractState.afterPromise) {
                        contractState.afterPromise = null;
                        resolve();
                    }
                };
                contractState.afterPromise = done;

                // ── Watchdog 1 (2 s) ─────────────────────────────────────────
                // Digit contracts settle in ≈ 1 tick (≈ 1 s on Volatility markets).
                // If afterPromise still hasn't been called after 2 s it means the
                // proposal_open_contract message with is_sold=1 was lost (mobile
                // browser backgrounded, transient WebSocket hiccup, etc.).
                // Explicitly re-request the contract status to trigger the settlement.
                clearTimeout(contractState.afterWatchdog);
                contractState.afterWatchdog = setTimeout(() => {
                    if (!contractState.afterPromise) return; // Already resolved — nothing to do
                    const { contract } = contractState;
                    if (contract?.contract_id) {
                        doUntilDone(
                            () => api_base.api.send({
                                proposal_open_contract: 1,
                                contract_id: contract.contract_id,
                            }),
                            ['PriceMoved']
                        );
                    }
                }, 2000);

                // ── Watchdog 2 (5 s) ─────────────────────────────────────────
                // Last resort: force-resolve so the bot can buy the next contract.
                // A 1-tick digit contract cannot still be open after 5 s under any
                // normal circumstances. This prevents the bot from hanging forever
                // when both the WebSocket message and the recovery poll are lost.
                clearTimeout(contractState.afterWatchdog2);
                contractState.afterWatchdog2 = setTimeout(() => {
                    if (contractState.afterPromise) {
                        done();
                    }
                }, 5000);
            });
        }

        setContractFlags(contract, contractState = this.getContractState?.(contract.contract_id)) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            if (contractState) {
                contractState.isSold = Boolean(is_sold);
                contractState.isSellAvailable = !contractState.isSold && Boolean(is_valid_to_sell);
                contractState.isExpired = Boolean(is_expired);
                contractState.hasEntryTick = Boolean(entry_tick);
            }

            if (String(contract.contract_id) === String(this.contractId)) {
                this.isSold = Boolean(is_sold);
                this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
                this.isExpired = Boolean(is_expired);
                this.hasEntryTick = Boolean(entry_tick);
            }
        }

        expectedContractId(contractId) {
            return Boolean(this.getContractState?.(contractId));
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };

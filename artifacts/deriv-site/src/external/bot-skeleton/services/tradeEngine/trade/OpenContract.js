import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { doUntilDone } from '../utils/helpers';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;

                    broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

                    if (this.isSold) {
                        this.contractId = '';
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(contract);
                        contractStatus({
                            id: 'contract.sold',
                            data: contract.transaction_ids.sell,
                            contract,
                        });

                        if (this.afterPromise) {
                            // Clear before calling to prevent double-resolution
                            const resolve = this.afterPromise;
                            this.afterPromise = null;
                            resolve();
                        }

                        this.store.dispatch(sell());
                    } else {
                        this.store.dispatch(openContractReceived());
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        waitForAfter() {
            return new Promise(resolve => {
                // Wrap resolve so watchdogs and the normal path share one clear-and-call pattern
                const done = () => {
                    clearTimeout(this._afterWatchdog);
                    clearTimeout(this._afterWatchdog2);
                    if (this.afterPromise) {
                        this.afterPromise = null;
                        resolve();
                    }
                };
                this.afterPromise = done;

                // ── Watchdog 1 (2 s) ─────────────────────────────────────────
                // Digit contracts settle in ≈ 1 tick (≈ 1 s on Volatility markets).
                // If afterPromise still hasn't been called after 2 s it means the
                // proposal_open_contract message with is_sold=1 was lost (mobile
                // browser backgrounded, transient WebSocket hiccup, etc.).
                // Explicitly re-request the contract status to trigger the settlement.
                clearTimeout(this._afterWatchdog);
                this._afterWatchdog = setTimeout(() => {
                    if (!this.afterPromise) return; // Already resolved — nothing to do
                    const { contract } = this.data;
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
                clearTimeout(this._afterWatchdog2);
                this._afterWatchdog2 = setTimeout(() => {
                    if (this.afterPromise) {
                        done();
                    }
                }, 5000);
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };

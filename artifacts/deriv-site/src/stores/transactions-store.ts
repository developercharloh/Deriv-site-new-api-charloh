// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { formatDate, isEnded } from '@/components/shared';
import { LogTypes } from '@/external/bot-skeleton';
import { ProposalOpenContract } from '@deriv/api-types';
import { TPortfolioPosition, TStores } from '@deriv/stores/types';
import { TContractInfo } from '../components/summary/summary-card.types';
import { transaction_elements } from '../constants/transactions';
import { getStoredItemsByKey, getStoredItemsByUser, setStoredItemsByKey } from '../utils/session-storage';
import RootStore from './root-store';

type TTransaction = {
    type: string;
    data?: string | TContractInfo;
};

type TElement = {
    [key: string]: TTransaction[];
};

export default class TransactionsStore {
    root_store: RootStore;
    core: TStores;
    disposeReactionsFn: () => void;

    constructor(root_store: RootStore, core: TStores) {
        this.root_store = root_store;
        this.core = core;
        this.is_transaction_details_modal_open = false;
        this.disposeReactionsFn = this.registerReactions();

        makeObservable(this, {
            elements: observable,
            active_transaction_id: observable,
            recovered_completed_transactions: observable,
            recovered_transactions: observable,
            is_called_proposal_open_contract: observable,
            is_transaction_details_modal_open: observable,
            transactions: computed,
            onBotContractEvent: action.bound,
            pushTransaction: action.bound,
            pushVirtualHookTransaction: action.bound,
            clear: action.bound,
            registerReactions: action.bound,
            recoverPendingContracts: action.bound,
            updateResultsCompletedContract: action.bound,
            sortOutPositionsBeforeAction: action.bound,
            recoverPendingContractsById: action.bound,
        });
    }
    TRANSACTION_CACHE = 'transaction_cache';

    // Load the full per-account dict from sessionStorage.
    // getStoredItemsByUser returns only one user's array (wrong shape for TElement);
    // we must load the whole dict so all loginid keys are preserved.
    elements: TElement = (() => {
        const stored = getStoredItemsByKey(this.TRANSACTION_CACHE, {});
        return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    })();
    active_transaction_id: null | number = null;
    recovered_completed_transactions: number[] = [];
    recovered_transactions: number[] = [];
    is_called_proposal_open_contract = false;
    is_transaction_details_modal_open = false;

    get transactions(): TTransaction[] {
        if (this.core?.client?.loginid) return this.elements[this.core?.client?.loginid] ?? [];
        return [];
    }

    get statistics() {
        let total_runs = 0;
        // Filter out only contract transactions and remove dividers
        const trxs = this.transactions.filter(
            trx =>
                trx.type === transaction_elements.CONTRACT &&
                typeof trx.data === 'object' &&
                Boolean(trx.data) &&
                !trx.data.is_virtual_hook
        );
        const statistics = trxs.reduce(
            (stats, { data }) => {
                const contract = data as TContractInfo;
                const profit = Number(contract.profit) || 0;
                const is_completed = contract.is_completed || false;
                const buy_price = Number(contract.buy_price) || 0;
                const payout = Number(contract.payout) || Number(contract.bid_price) || 0;
                const bid_price = Number(contract.bid_price) || 0;

                if (is_completed) {
                    if (profit > 0) {
                        stats.won_contracts += 1;
                        stats.total_payout += payout ?? bid_price ?? 0;
                    } else {
                        stats.lost_contracts += 1;
                    }
                    stats.total_profit += profit;
                    stats.total_stake += buy_price;
                    total_runs += 1;
                }
                return stats;
            },
            {
                lost_contracts: 0,
                number_of_runs: 0,
                total_profit: 0,
                total_payout: 0,
                total_stake: 0,
                won_contracts: 0,
            }
        );
        statistics.number_of_runs = total_runs;
        return statistics;
    }

    toggleTransactionDetailsModal = (is_open: boolean) => {
        this.is_transaction_details_modal_open = is_open;
    };

    onBotContractEvent(data: TContractInfo) {
        this.pushTransaction(data);
    }

    pushVirtualHookTransaction(event: {
        journalScope?: string | null;
        virtualTradeId?: string;
        outcome?: 'win' | 'loss';
        contractType?: string;
        prediction?: number;
        market?: string;
        entryEpoch?: number | null;
        settlementEpoch?: number | null;
        entrySpot?: number | string | null;
        exitSpot?: number | string | null;
    }) {
        const current_account = this.core?.client?.loginid as string;
        if (!current_account || (event.outcome !== 'win' && event.outcome !== 'loss')) return;

        const market = event.market || '';
        const contract_type = event.contractType || 'DIGITUNDER';
        const prediction = event.prediction;
        const virtual_hook_id =
            event.virtualTradeId ||
            [event.journalScope || 'smart-over-2', market, event.entryEpoch ?? '', contract_type, prediction ?? ''].join(
                ':'
            );
        const existing: TTransaction[] = [...(this.elements[current_account] ?? [])];
        const already_recorded = existing.some(
            transaction =>
                transaction.type === transaction_elements.CONTRACT &&
                typeof transaction.data === 'object' &&
                transaction.data?.virtual_hook_id === virtual_hook_id
        );
        if (already_recorded) return;

        const toMilliseconds = (epoch?: number | null) => {
            const value = Number(epoch);
            return Number.isFinite(value) && value > 0 ? value * 1000 : undefined;
        };
        const entry_time = toMilliseconds(event.entryEpoch);
        const exit_time = toMilliseconds(event.settlementEpoch);
        const entry_spot = event.entrySpot === null || event.entrySpot === undefined ? '' : String(event.entrySpot);
        const exit_spot = event.exitSpot === null || event.exitSpot === undefined ? '' : String(event.exitSpot);
        const run_id = this.root_store.run_panel.run_id;
        const contract: TContractInfo = {
            contract_type,
            barrier: prediction === undefined ? '' : String(prediction),
            underlying_symbol: market,
            currency: this.core?.client?.currency || '',
            buy_price: 0,
            payout: 0,
            profit: 0,
            status: event.outcome === 'win' ? 'won' : 'lost',
            is_completed: true,
            run_id,
            date_start: entry_time ? formatDate(entry_time, 'YYYY-M-D HH:mm:ss [GMT]') : '',
            purchase_time: event.entryEpoch ?? undefined,
            entry_spot,
            entry_tick: entry_spot,
            entry_tick_time: entry_time ? formatDate(entry_time, 'YYYY-M-D HH:mm:ss [GMT]') : undefined,
            exit_spot,
            exit_tick: exit_spot,
            exit_tick_time: exit_time ? formatDate(exit_time, 'YYYY-M-D HH:mm:ss [GMT]') : undefined,
            is_virtual_hook: true,
            virtual_hook_id,
            virtual_hook_outcome: event.outcome,
        };

        let base = existing;
        if (existing.length > 0) {
            const first = existing[0];
            const is_new_run =
                first.type === transaction_elements.CONTRACT &&
                typeof first.data === 'object' &&
                contract.run_id !== first.data?.run_id;
            if (is_new_run) {
                base = [{ type: transaction_elements.DIVIDER, data: contract.run_id }, ...existing];
            }
        }

        this.elements = {
            ...this.elements,
            [current_account]: [{ type: transaction_elements.CONTRACT, data: contract }, ...base],
        };
    }

    pushTransaction(data: TContractInfo) {
        const { run_id } = this.root_store.run_panel;
        const current_account = this.core?.client?.loginid as string;

        // Guard: never store under an empty key — the transactions getter
        // returns [] for falsy loginid, so the data would be permanently invisible.
        if (!current_account) return;

        // Deriv can send a settlement update with the result and P/L before
        // repeating the entry/exit spot fields. Keep the best-known values
        // from the open update instead of replacing them with undefined.
        const existing: TTransaction[] = [...(this.elements[current_account] ?? [])];
        const same_contract_index = existing.findIndex(c => {
            if (typeof c.data === 'string') return false;
            return (
                c.type === transaction_elements.CONTRACT &&
                c.data?.transaction_ids &&
                String(c.data.transaction_ids.buy) === String(data.transaction_ids?.buy)
            );
        });
        const previous_data =
            same_contract_index >= 0 && typeof existing[same_contract_index].data === 'object'
                ? (existing[same_contract_index].data as TContractInfo)
                : undefined;
        const merged_data: TContractInfo = {
            ...previous_data,
            ...data,
            entry_spot: data.entry_spot ?? previous_data?.entry_spot ?? data.entry_tick ?? previous_data?.entry_tick,
            exit_spot: data.exit_spot ?? previous_data?.exit_spot ?? data.exit_tick ?? previous_data?.exit_tick,
            entry_tick_time: data.entry_tick_time ?? previous_data?.entry_tick_time,
            exit_tick_time: data.exit_tick_time ?? previous_data?.exit_tick_time,
        };
        const is_completed = isEnded(merged_data as ProposalOpenContract);
        const contract: TContractInfo = {
            ...merged_data,
            is_completed,
            run_id,
            date_start: formatDate(merged_data.date_start, 'YYYY-M-D HH:mm:ss [GMT]'),
            entry_tick: merged_data.entry_spot ?? merged_data.entry_tick,
            entry_tick_time:
                merged_data.entry_tick_time && formatDate(merged_data.entry_tick_time, 'YYYY-M-D HH:mm:ss [GMT]'),
            exit_tick: merged_data.exit_spot ?? merged_data.exit_tick,
            exit_tick_time:
                merged_data.exit_tick_time && formatDate(merged_data.exit_tick_time, 'YYYY-M-D HH:mm:ss [GMT]'),
            profit: is_completed ? merged_data.profit : 0,
        };

        let updated: TTransaction[];

        if (same_contract_index === -1) {
            // Prepend a divider when the run_id changes.
            let base = existing;
            if (existing.length > 0) {
                const first = existing[0];
                const is_new_run =
                    first.type === transaction_elements.CONTRACT &&
                    typeof first.data === 'object' &&
                    contract.run_id !== (first.data as TContractInfo)?.run_id;
                if (is_new_run) {
                    base = [{ type: transaction_elements.DIVIDER, data: contract.run_id }, ...existing];
                }
            }
            updated = [{ type: transaction_elements.CONTRACT, data: contract }, ...base];
        } else {
            // Replace the existing entry with a fresh object (new reference).
            updated = [...existing];
            updated[same_contract_index] = { type: transaction_elements.CONTRACT, data: contract };
        }

        // Single assignment — always produces a new elements object AND a new
        // inner array, so both the outer and inner MobX equality checks pass.
        this.elements = { ...this.elements, [current_account]: updated };
    }

    clear() {
        const loginid = this.core?.client?.loginid as string;
        if (loginid && this.elements[loginid]?.length > 0) {
            // New object + new array → MobX sees both the outer and inner reference change.
            this.elements = { ...this.elements, [loginid]: [] };
        }
        this.recovered_completed_transactions = [];
        this.recovered_transactions = [];
        this.is_transaction_details_modal_open = false;
    }

    registerReactions() {
        const { client } = this.core;

        // Write transactions to session storage on each change in transaction elements.
        const disposeTransactionElementsListener = reaction(
            () => this.elements[client?.loginid as string],
            elements => {
                const stored_transactions = getStoredItemsByKey(this.TRANSACTION_CACHE, {});
                stored_transactions[client.loginid as string] = elements?.slice(0, 5000) ?? [];
                setStoredItemsByKey(this.TRANSACTION_CACHE, stored_transactions);
            }
        );

        // User could've left the page mid-contract. On initial load, try
        // to recover any pending contracts so we can reflect accurate stats
        // and transactions.
        const disposeRecoverContracts = reaction(
            () => this.transactions.length,
            () => this.recoverPendingContracts()
        );

        return () => {
            disposeTransactionElementsListener();
            disposeRecoverContracts();
        };
    }

    recoverPendingContracts(contract = null) {
        this.transactions.forEach(({ data: trx }) => {
            if (
                typeof trx === 'string' ||
                trx?.is_completed ||
                !trx?.contract_id ||
                this.recovered_transactions.includes(trx?.contract_id)
            )
                return;
            this.recoverPendingContractsById(trx.contract_id, contract);
        });
    }

    updateResultsCompletedContract(contract: ProposalOpenContract) {
        const { journal, summary_card } = this.root_store;
        const { contract_info } = summary_card;
        const { currency, profit } = contract;

        if (contract.contract_id !== contract_info?.contract_id) {
            this.onBotContractEvent(contract);

            if (contract.contract_id && !this.recovered_transactions.includes(contract.contract_id)) {
                this.recovered_transactions.push(contract.contract_id);
            }
            if (
                contract.contract_id &&
                !this.recovered_completed_transactions.includes(contract.contract_id) &&
                isEnded(contract)
            ) {
                this.recovered_completed_transactions.push(contract.contract_id);

                journal.onLogSuccess({
                    log_type: profit && profit > 0 ? LogTypes.PROFIT : LogTypes.LOST,
                    extra: { currency, profit },
                });
            }
        }
    }

    sortOutPositionsBeforeAction(positions: TPortfolioPosition[], element_id?: number) {
        positions?.forEach(position => {
            if (!element_id || (element_id && position.id === element_id)) {
                const contract_details = position.contract_info;
                this.updateResultsCompletedContract(contract_details);
            }
        });
    }

    async recoverPendingContractsById(contract_id: number, contract: ProposalOpenContract | null = null) {
        // TODO: need to fix as the portfolio is not available now
        // const positions = this.core.portfolio.positions;
        const positions: unknown[] = [];

        if (contract) {
            this.is_called_proposal_open_contract = true;
            if (contract.contract_id === contract_id) {
                this.updateResultsCompletedContract(contract);
            }
        }

        if (!this.is_called_proposal_open_contract) {
            if (this.core?.client?.loginid) {
                const current_account = this.core?.client?.loginid;
                if (!this.elements[current_account]?.length) {
                    this.sortOutPositionsBeforeAction(positions);
                }

                const elements = this.elements[current_account];
                const [element = null] = elements;
                if (typeof element?.data === 'object' && !element?.data?.profit) {
                    const element_id = element.data.contract_id;
                    this.sortOutPositionsBeforeAction(positions, element_id);
                }
            }
        }
    }
}

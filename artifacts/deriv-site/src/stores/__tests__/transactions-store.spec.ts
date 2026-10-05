import TransactionsStore from '../transactions-store';
import { getStoredItemsByKey, setStoredItemsByKey } from '../../utils/session-storage';

describe('TransactionsStore Virtual Hook entries', () => {
    const createStore = () => {
        const loginid = 'VIRTUAL-HOOK-TEST-ACCOUNT';
        const store = new TransactionsStore(
            { run_panel: { run_id: 'run-1' } } as any,
            { client: { loginid, currency: 'USD' } } as any
        );
        store.elements = { ...store.elements, [loginid]: [] };
        return { store, loginid };
    };

    it('records settled hook outcomes with spots and zero stake without changing real trade statistics', () => {
        const { store, loginid } = createStore();
        const settlement = {
            journalScope: 'smart-over-2',
            virtualTradeId: 'smart-over-2:101:DIGITUNDER:5',
            outcome: 'win' as const,
            contractType: 'DIGITUNDER',
            prediction: 5,
            market: 'R_25',
            entryEpoch: 101,
            settlementEpoch: 102,
            entrySpot: '2591.458',
            exitSpot: '2591.421',
        };

        store.pushVirtualHookTransaction(settlement);

        expect(store.transactions).toHaveLength(1);
        expect(store.transactions[0]).toMatchObject({
            type: 'contract',
            data: {
                is_virtual_hook: true,
                virtual_hook_id: settlement.virtualTradeId,
                virtual_hook_outcome: 'win',
                contract_type: 'DIGITUNDER',
                underlying_symbol: 'R_25',
                buy_price: 0,
                profit: 0,
                currency: 'USD',
                entry_spot: '2591.458',
                exit_spot: '2591.421',
                is_completed: true,
            },
        });
        expect(store.statistics).toMatchObject({
            won_contracts: 0,
            lost_contracts: 0,
            number_of_runs: 0,
            total_payout: 0,
            total_profit: 0,
            total_stake: 0,
        });

        store.pushVirtualHookTransaction(settlement);
        expect(store.transactions).toHaveLength(1);

        store.disposeReactionsFn();
        expect(store.elements[loginid]).toHaveLength(1);
    });

    it('stores hook losses as completed loss outcomes', () => {
        const { store } = createStore();

        store.pushVirtualHookTransaction({
            virtualTradeId: 'smart-over-2:201:DIGITUNDER:5',
            outcome: 'loss',
            contractType: 'DIGITUNDER',
            prediction: 5,
            market: 'R_25',
            entryEpoch: 201,
            settlementEpoch: 202,
            entrySpot: '2591.21',
            exitSpot: '2591.18',
        });

        expect(store.transactions[0]?.data).toMatchObject({
            is_virtual_hook: true,
            virtual_hook_outcome: 'loss',
            status: 'lost',
            is_completed: true,
        });
        store.disposeReactionsFn();
    });

    it('keeps both legs of one Edging pro virtual pair as separate transactions', () => {
        const { store } = createStore();
        const shared = {
            journalScope: 'edging-pro',
            market: '1HZ50V',
            entryEpoch: 301,
            settlementEpoch: 302,
            entrySpot: '185425.65',
            exitSpot: '185418.96',
        };

        store.pushVirtualHookTransaction({
            ...shared,
            virtualTradeId: 'edging-pro:run-1:17:DIGITOVER',
            outcome: 'win',
            contractType: 'DIGITOVER',
            prediction: 5,
        });
        store.pushVirtualHookTransaction({
            ...shared,
            virtualTradeId: 'edging-pro:run-1:17:DIGITUNDER',
            outcome: 'loss',
            contractType: 'DIGITUNDER',
            prediction: 4,
        });

        expect(store.transactions).toHaveLength(2);
        expect(store.transactions.map(transaction => transaction.data)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    virtual_hook_id: 'edging-pro:run-1:17:DIGITOVER',
                    virtual_hook_outcome: 'win',
                    contract_type: 'DIGITOVER',
                    entry_spot: shared.entrySpot,
                    exit_spot: shared.exitSpot,
                }),
                expect.objectContaining({
                    virtual_hook_id: 'edging-pro:run-1:17:DIGITUNDER',
                    virtual_hook_outcome: 'loss',
                    contract_type: 'DIGITUNDER',
                    entry_spot: shared.entrySpot,
                    exit_spot: shared.exitSpot,
                }),
            ])
        );
        store.disposeReactionsFn();
    });

    it('upserts native and broker reports for one contract when buy transaction IDs differ', () => {
        const { store } = createStore();
        const shared = {
            contract_id: '15703925199',
            contract_type: 'DIGITOVER',
            underlying_symbol: '1HZ50V',
            buy_price: 1,
            payout: 2.26,
            date_start: '2026-10-05T14:17:14.000Z',
            entry_spot: '185382.61',
        };

        store.onBotContractEvent({
            ...shared,
            transaction_ids: { buy: '15703925199' },
            status: 'open',
            is_sold: 0,
        } as any);
        store.onBotContractEvent({
            ...shared,
            transaction_ids: { buy: 'actual-buy-transaction' },
            status: 'won',
            is_sold: 1,
            exit_spot: '185382.61',
            profit: 1.26,
        } as any);

        expect(store.transactions).toHaveLength(1);
        expect(store.transactions[0]?.data).toMatchObject({
            contract_id: shared.contract_id,
            transaction_ids: { buy: 'actual-buy-transaction' },
            status: 'won',
            entry_spot: shared.entry_spot,
            exit_spot: shared.entry_spot,
            profit: 1.26,
            is_completed: true,
        });
        store.disposeReactionsFn();
    });

    it('keeps two paired contracts separate when they share an entry price', () => {
        const { store } = createStore();
        const shared = {
            contract_type: 'DIGITOVER',
            underlying_symbol: '1HZ50V',
            buy_price: 1,
            payout: 2.26,
            date_start: '2026-10-05T14:17:14.000Z',
            entry_spot: '185382.61',
            is_sold: 1,
        };

        store.onBotContractEvent({
            ...shared,
            contract_id: '15703925199',
            transaction_ids: { buy: 'buy-over' },
            status: 'won',
            profit: 1.26,
        } as any);
        store.onBotContractEvent({
            ...shared,
            contract_id: '15703925159',
            transaction_ids: { buy: 'buy-under' },
            contract_type: 'DIGITUNDER',
            status: 'lost',
            profit: -1,
        } as any);

        expect(store.transactions).toHaveLength(2);
        expect(store.transactions.map(transaction => transaction.data)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ contract_id: '15703925199', status: 'won' }),
                expect.objectContaining({ contract_id: '15703925159', status: 'lost' }),
            ])
        );
        store.disposeReactionsFn();
    });

    it('removes legacy duplicate contract rows from the saved transaction cache on load', () => {
        const loginid = 'LEGACY-DUPLICATE-TEST-ACCOUNT';
        const contract = {
            contract_id: '15703925199',
            contract_type: 'DIGITOVER',
            underlying_symbol: '1HZ50V',
            buy_price: 1,
            payout: 2.26,
            status: 'won',
            is_sold: 1,
            is_completed: true,
            profit: 1.26,
            entry_spot: '185382.61',
            exit_spot: '185382.61',
        };
        sessionStorage.clear();
        setStoredItemsByKey('transaction_cache', {
            [loginid]: [
                {
                    type: 'contract',
                    data: { ...contract, transaction_ids: { buy: 'actual-buy-transaction' } },
                },
                {
                    type: 'contract',
                    data: { ...contract, transaction_ids: { buy: contract.contract_id } },
                },
            ],
        });

        const store = new TransactionsStore(
            { run_panel: { run_id: 'run-1' } } as any,
            { client: { loginid, currency: 'USD' } } as any
        );

        expect(store.transactions).toHaveLength(1);
        expect(store.transactions[0]?.data).toMatchObject({
            contract_id: contract.contract_id,
            transaction_ids: { buy: 'actual-buy-transaction' },
            status: 'won',
            profit: 1.26,
        });
        expect(getStoredItemsByKey('transaction_cache', {})[loginid]).toHaveLength(1);

        store.disposeReactionsFn();
        sessionStorage.clear();
    });
});
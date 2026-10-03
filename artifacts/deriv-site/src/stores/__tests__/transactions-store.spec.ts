import TransactionsStore from '../transactions-store';

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
});
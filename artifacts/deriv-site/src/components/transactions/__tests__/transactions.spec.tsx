import React from 'react';
import { act, render, screen } from '@testing-library/react';

import { observer } from '@/external/bot-skeleton/utils/observer';
import { run_panel } from '@/constants/run-panel';
import { useStore } from '@/hooks/useStore';
import RunPanelStore, { TLastDigitsAnalysis } from '@/stores/run-panel-store';
import { useDevice } from '@deriv-com/ui';
import Transactions from '../transactions';

jest.mock('@/hooks/useStore', () => ({
    useStore: jest.fn(),
}));

jest.mock('@/utils/store-helpers', () => ({
    helpers: {},
}));

jest.mock('@deriv-com/ui', () => ({
    useDevice: jest.fn(),
}));

jest.mock('@/components/download', () => ({
    __esModule: true,
    default: () => null,
}));

jest.mock('@/components/shared_ui/button', () => ({
    __esModule: true,
    default: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
}));

jest.mock('@/components/shared_ui/data-list', () => ({
    __esModule: true,
    default: () => null,
}));

jest.mock('@/components/shared_ui/text', () => ({
    __esModule: true,
    default: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

jest.mock('@/components/shared_ui/themed-scrollbars', () => ({
    __esModule: true,
    default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

jest.mock('../transaction', () => ({
    __esModule: true,
    default: () => null,
}));

jest.mock('@deriv/quill-icons/Illustration', () => ({
    DerivLightEmptyCardboardBoxIcon: () => null,
}));

const mockedUseStore = useStore as jest.MockedFunction<typeof useStore>;
const mockedUseDevice = useDevice as jest.MockedFunction<typeof useDevice>;

const createStore = () => {
    const journal = {
        pushMessage: jest.fn(),
    };
    const rootStore = {
        dbot: {},
        journal,
    };
    const core = {
        client: { loginid: null },
        common: { is_socket_opened: false },
        ui: {},
    };
    const runPanel = new RunPanelStore(rootStore as any, core as any);
    runPanel.onMount();
    runPanel.setActiveTabIndex(run_panel.TRANSACTIONS);

    return {
        runPanel,
        store: {
            run_panel: runPanel,
            transactions: {
                transactions: [],
                recoverPendingContracts: jest.fn(),
                toggleTransactionDetailsModal: jest.fn(),
            },
        },
    };
};

const analysis = (result: boolean): TLastDigitsAnalysis => ({
    market: '1HZ50V',
    condition: result ? 'ALL_EVEN' : 'ALL_ODD',
    count: 4,
    compareValue: 0,
    digits: result ? [2, 6, 2, 8] : [1, 3, 1, 1],
    result,
});

describe('Transactions live analysis banner', () => {
    beforeEach(() => {
        mockedUseDevice.mockReturnValue({ isDesktop: false } as ReturnType<typeof useDevice>);
    });

    afterEach(() => {
        observer.unregisterAll('bot.analysis.condition');
        jest.clearAllMocks();
    });

    it('refreshes FALSE to TRUE to FALSE on mobile without opening Journal', async () => {
        const { runPanel, store } = createStore();
        mockedUseStore.mockReturnValue(store as any);

        render(<Transactions is_drawer_open />);

        const emitAnalysis = async (result: boolean) => {
            await act(async () => {
                observer.emit('bot.analysis.condition', analysis(result));
            });
        };

        await emitAnalysis(false);
        expect(screen.getByRole('status')).toHaveTextContent('❌ FALSE');

        await emitAnalysis(true);
        expect(screen.getByRole('status')).toHaveTextContent('✅ TRUE');

        await emitAnalysis(false);
        expect(screen.getByRole('status')).toHaveTextContent('❌ FALSE');

        expect(runPanel.active_index).toBe(run_panel.TRANSACTIONS);
        expect(screen.queryByText('Journal')).not.toBeInTheDocument();
    });
});
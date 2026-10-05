import React from 'react';
import { render, screen } from '@testing-library/react';
import Transaction from '../transaction';

jest.mock('@/components/shared_ui/money', () => ({
    __esModule: true,
    default: ({ amount, currency }: { amount: number; currency: string }) =>
        `${Number(amount).toFixed(2)} ${currency}`,
}));

jest.mock('@/external/bot-skeleton', () => ({
    getContractTypeName: () => 'Under 5',
}));

jest.mock('@/external/bot-skeleton/utils/workspace', () => ({
    isDbotRTL: () => false,
}));

jest.mock('@/utils/symbol-display-name', () => ({
    getSymbolDisplayNameSync: () => 'Synthetic 25 Index',
}));

jest.mock('@deriv/quill-icons', () => ({
    LegacyRadioOffIcon: () => null,
    LegacyRadioOnIcon: () => null,
}));

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => i18n_default_text,
    localize: (text: string) => text,
}));

jest.mock('../../market/market-icon', () => ({
    MarketIcon: () => null,
}));

jest.mock('../../shared', () => ({
    convertDateFormat: (value: string) => value,
}));

jest.mock('../../shared_ui/popover', () => ({
    __esModule: true,
    default: ({ children }: React.PropsWithChildren) => children,
}));

jest.mock('../../trade-type/trade-type-icon', () => ({
    TradeTypeIcon: () => null,
}));

const virtualContract = (outcome: 'win' | 'loss', contractType = 'DIGITUNDER') =>
    ({
        contract_type: contractType,
        underlying_symbol: 'R_25',
        display_name: 'Synthetic 25 Index',
        buy_price: 0,
        currency: 'USD',
        is_completed: true,
        is_virtual_hook: true,
        virtual_hook_outcome: outcome,
        profit: 0,
        entry_spot: '2591.458',
        exit_spot: '2591.421',
    }) as any;

describe('Transactions Virtual Hook rows', () => {
    it('shows a completed zero-stake Hook Won result', () => {
        render(<Transaction contract={virtualContract('win')} />);

        expect(screen.getByText('Hook Won')).toHaveClass('transactions__profit--win');
        expect(screen.getByText('0.00 USD')).toBeInTheDocument();
    });

    it('shows Hook Lost with the loss styling', () => {
        render(<Transaction contract={virtualContract('loss')} />);

        expect(screen.getByText('Hook Lost')).toHaveClass('transactions__profit--loss');
    });

    it('shows both outcomes as separate rows for one virtual pair on the same spots', () => {
        render(
            <>
                <Transaction contract={virtualContract('win', 'DIGITOVER')} />
                <Transaction contract={virtualContract('loss', 'DIGITUNDER')} />
            </>
        );

        expect(screen.getByText('Hook Won')).toHaveClass('transactions__profit--win');
        expect(screen.getByText('Hook Lost')).toHaveClass('transactions__profit--loss');
        expect(screen.getAllByText('0.00 USD')).toHaveLength(2);
        expect(screen.getAllByText('2591.458')).toHaveLength(2);
        expect(screen.getAllByText('2591.421')).toHaveLength(2);
    });
});
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import { OverUnderSignalBoard } from '../over-under-signal-board';

jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));

describe('Over/Under live signal board', () => {
    beforeEach(() => {
        (api_base as any).api = null;
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'closed' });
    });

    it('shows all four approved barriers on every market, including while waiting for live data', () => {
        const symbol = DERIV_VOLATILITIES[0];
        render(
            <OverUnderSignalBoard
                active
                onToggle={jest.fn()}
                maintenanceActive={false}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Over / Under Signals' })).toBeInTheDocument();
        expect(screen.getAllByRole('article')).toHaveLength(DERIV_VOLATILITIES.length);
        expect(screen.getByText('0/13 live')).toBeInTheDocument();

        const firstMarket = screen.getAllByRole('article')[0];
        expect(within(firstMarket).getByText('OVER 4')).toBeInTheDocument();
        expect(within(firstMarket).getByText('OVER 5')).toBeInTheDocument();
        expect(within(firstMarket).getByText('UNDER 6')).toBeInTheDocument();
        expect(within(firstMarket).getByText('UNDER 5')).toBeInTheDocument();
        expect(within(firstMarket).getAllByText('Trend Strength Index 14 · one line')).toHaveLength(2);
        expect(within(firstMarket).getByText('Reconnecting')).toBeInTheDocument();
        expect(within(firstMarket).getAllByText('WAITING FOR INDICATOR CONDITIONS')).toHaveLength(4);
        expect(screen.getByText(/00:02 before each one-minute candle closes/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Configure #21/ })).not.toBeInTheDocument();
        expect(within(firstMarket).getByTestId(`data-signal-option-${symbol.code}-over-4`)).toBeInTheDocument();
        expect(within(firstMarket).getByTestId(`data-signal-option-${symbol.code}-under-5`)).toBeInTheDocument();
    });
});

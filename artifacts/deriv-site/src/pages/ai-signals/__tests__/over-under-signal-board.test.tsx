import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import { canEnterOverUnderSignal, OverUnderSignalBoard } from '../over-under-signal-board';
import type { OverUnderIndicatorStatus } from '@/utils/over-under-indicator-strategy';

jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));

describe('Over/Under live signal board', () => {
    beforeEach(() => {
        (api_base as any).api = null;
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'closed' });
    });

    it('keeps Enter Now available at any second while the setup and feed are ready', () => {
        const setup: OverUnderIndicatorStatus = {
            mode: 'MACD_OVER_4',
            side: 'OVER',
            barrier: 4,
            indicator: 'MACD',
            indicatorValue: 0.4,
            setupReady: true,
            entryWindow: false,
            feedFresh: true,
            tradeNow: false,
            conditions: [],
        };
        expect(canEnterOverUnderSignal(setup)).toBe(true);
        expect(canEnterOverUnderSignal({ ...setup, entryWindow: true, tradeNow: true })).toBe(true);
        expect(canEnterOverUnderSignal({ ...setup, feedFresh: false })).toBe(false);
        expect(canEnterOverUnderSignal({ ...setup, setupReady: false })).toBe(false);
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
        expect(within(firstMarket).getAllByText('WAITING FOR INDICATOR DATA')).toHaveLength(4);
        expect(screen.getByText(/00:02 is a timing reference only/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Configure #21/ })).not.toBeInTheDocument();
        expect(within(firstMarket).getByTestId(`data-signal-option-${symbol.code}-over-4`)).toBeInTheDocument();
        expect(within(firstMarket).getByTestId(`data-signal-option-${symbol.code}-under-5`)).toBeInTheDocument();
    });
});

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
                maintenanceActive={false}
                onSelectSignal={jest.fn()}
                signals={[{
                    symbol,
                    direction: 'OVER 4',
                    isSignal: true,
                    signalStrength: 76,
                    winProbability: 0.57,
                    options: [
                        { side: 'OVER', barrier: 4, probability: 0.57, edge: 0.07 },
                        { side: 'OVER', barrier: 5, probability: 0.47, edge: 0.07 },
                        { side: 'UNDER', barrier: 6, probability: 0.63, edge: 0.03 },
                        { side: 'UNDER', barrier: 5, probability: 0.51, edge: 0.01 },
                    ],
                    watchdogStatus: 'holding',
                    watchdogWinPct: 0.62,
                    resultAvailable: true,
                }]}
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
        expect(within(firstMarket).getByText('57.0% observed')).toBeInTheDocument();
        expect(within(firstMarket).getByText('Reconnecting')).toBeInTheDocument();
        expect(within(firstMarket).getByText('WAITING FOR LIVE CHECK')).toBeInTheDocument();
        expect(screen.getByText(/00:02 before the one-minute candle closes/)).toBeInTheDocument();
        expect(
            within(firstMarket).getByTestId(`button-review-signal-${symbol.code}`),
        ).toBeDisabled();
    });
});

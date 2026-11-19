import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { DERIV_CONTINUOUS_VOLATILITIES } from '@/utils/deriv-volatilities';
import {
    canTradeEvenOddBeastSignal,
    EvenOddBeastSignalBoard,
    formatCandleCloseCountdown,
    getSecondsUntilCandleClose,
} from '../even-odd-beast-signal-board';

jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));

describe('Even Odd Beast setup signal board', () => {
    beforeEach(() => {
        (api_base as any).api = null;
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'closed' });
    });

    it('offers only fresh Even/Odd setups to the handoff', () => {
        const analysis = { signal: 'EVEN' } as any;
        expect(canTradeEvenOddBeastSignal(analysis, true)).toBe(true);
        expect(canTradeEvenOddBeastSignal({ signal: 'ODD' } as any, true)).toBe(true);
        expect(canTradeEvenOddBeastSignal({ signal: 'WAIT' } as any, true)).toBe(false);
        expect(canTradeEvenOddBeastSignal({ signal: 'ODD' } as any, false)).toBe(false);
    });

    it('counts down to the next one-minute candle close using server time', () => {
        expect(getSecondsUntilCandleClose(3_600)).toBe(60);
        expect(getSecondsUntilCandleClose(3_630.2)).toBe(30);
        expect(getSecondsUntilCandleClose(3_659.2)).toBe(1);
        expect(getSecondsUntilCandleClose(null)).toBeNull();
        expect(formatCandleCloseCountdown(60)).toBe('01:00');
        expect(formatCandleCloseCountdown(9)).toBe('00:09');
        expect(formatCandleCloseCountdown(null)).toBe('Waiting');
    });

    it('lists only continuous markets and keeps digit-entry rules off the signal board', () => {
        render(
            <EvenOddBeastSignalBoard
                active
                onToggle={jest.fn()}
                maintenanceActive={false}
                onSelectSignal={jest.fn()}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Even / Odd Setups' })).toBeInTheDocument();
        expect(screen.getAllByRole('article')).toHaveLength(DERIV_CONTINUOUS_VOLATILITIES.length);
        expect(screen.getByRole('status')).toHaveTextContent('0/8');
        expect(screen.queryByText(/R_10|R_25|R_50|R_75|R_100/)).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Trade with Even Odd Beast' }))
            .toHaveLength(DERIV_CONTINUOUS_VOLATILITIES.length);
        expect(screen.getAllByRole('button', { name: 'Trade with Even Odd Beast' })
            .every(button => (button as HTMLButtonElement).disabled)).toBe(true);
        expect(screen.getByText(/green candle above a rising MA9/)).toBeInTheDocument();
        expect(screen.getByText(/red candle below a falling MA9/)).toBeInTheDocument();
        expect(screen.getAllByText('1-minute candle closes in')).toHaveLength(DERIV_CONTINUOUS_VOLATILITIES.length);
        expect(screen.getAllByTestId('candle-close-countdown').every(timer => timer.textContent?.includes('Waiting'))).toBe(true);
        expect(screen.queryByText(/match|entry digit/i)).not.toBeInTheDocument();
        expect(within(screen.getAllByRole('article')[0]).getByText('Waiting for live data')).toBeInTheDocument();
        expect(screen.getAllByText(/Candle and MA9 decimal digits match/)).toHaveLength(DERIV_CONTINUOUS_VOLATILITIES.length);
        expect(screen.getAllByRole('button', { name: 'Trade with Even Odd Beast' })
            .every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    });
});

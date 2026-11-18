import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { DERIV_CONTINUOUS_VOLATILITIES } from '@/utils/deriv-volatilities';
import {
    canTradeEvenOddBeastSignal,
    EvenOddBeastSignalBoard,
} from '../even-odd-beast-signal-board';

jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));

describe('Even Odd Beast setup signal board', () => {
    beforeEach(() => {
        (api_base as any).api = null;
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'closed' });
    });

    it('offers only fresh Even/Odd setups to the handoff', () => {
        expect(canTradeEvenOddBeastSignal('EVEN', true)).toBe(true);
        expect(canTradeEvenOddBeastSignal('ODD', true)).toBe(true);
        expect(canTradeEvenOddBeastSignal('WAIT', true)).toBe(false);
        expect(canTradeEvenOddBeastSignal('ODD', false)).toBe(false);
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
        expect(screen.queryByText(/match|entry digit/i)).not.toBeInTheDocument();
        expect(within(screen.getAllByRole('article')[0]).getByText('Waiting for live data')).toBeInTheDocument();
    });
});

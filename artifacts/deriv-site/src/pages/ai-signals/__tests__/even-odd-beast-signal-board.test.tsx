import React from 'react';
import { render, screen } from '@testing-library/react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import {
    canTradeEvenOddBeastSignal,
    EvenOddBeastSignalBoard,
    formatCandleCloseCountdown,
    getSecondsUntilCandleClose,
    hasStrongEvenOddBeastSignal,
} from '../even-odd-beast-signal-board';

jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));

describe('Even Odd Beast setup signal board', () => {
    beforeEach(() => {
        (api_base as any).api = null;
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'closed' });
    });

    it('offers only fresh Even/Odd setups to the handoff', () => {
        const analysis = {
            signal: 'EVEN',
            setupSignal: 'EVEN',
            evenConditions: true,
            oddConditions: false,
            matchedDigit: 4,
        } as any;
        expect(canTradeEvenOddBeastSignal(analysis, true)).toBe(true);
        const oddAnalysis = {
            signal: 'ODD',
            setupSignal: 'ODD',
            oddConditions: true,
            evenConditions: false,
            matchedDigit: 5,
        } as any;
        expect(canTradeEvenOddBeastSignal(oddAnalysis, true)).toBe(true);
        expect(canTradeEvenOddBeastSignal({ ...analysis, signal: 'WAIT' } as any, true)).toBe(false);
        expect(canTradeEvenOddBeastSignal({ ...analysis, signal: 'ODD' } as any, true)).toBe(false);
        expect(canTradeEvenOddBeastSignal({ ...analysis, matchedDigit: null } as any, true)).toBe(false);
        expect(canTradeEvenOddBeastSignal(analysis, false)).toBe(false);
        expect(hasStrongEvenOddBeastSignal(analysis)).toBe(true);
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

    it('hides markets until a complete Even/Odd setup qualifies', () => {
        render(
            <EvenOddBeastSignalBoard
                active
                onToggle={jest.fn()}
                maintenanceActive={false}
                onSelectSignal={jest.fn()}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Even / Odd Setups' })).toBeInTheDocument();
        expect(screen.queryAllByRole('article')).toHaveLength(0);
        expect(screen.getAllByRole('status')[0]).toHaveTextContent('0/8');
        expect(screen.queryByText(/R_10|R_25|R_50|R_75|R_100/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Trade with Even Odd Beast' })).not.toBeInTheDocument();
        expect(screen.getByText('No qualified setups right now. Incomplete setups are hidden.')).toBeInTheDocument();
        expect(screen.getByText(/green candle above a rising MA9/)).toBeInTheDocument();
        expect(screen.getByText(/red candle below a falling MA9/)).toBeInTheDocument();
        expect(screen.queryByText(/entry digit/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Candle and MA9 decimal digits match/)).not.toBeInTheDocument();
    });
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DERIV_CONTINUOUS_VOLATILITIES } from '@/utils/deriv-volatilities';
import { digitsForMatchesKingCount, MatchesKingConfig } from '../MatchesKingConfig';

describe('Matches King signal configuration', () => {
    beforeEach(() => localStorage.clear());

    it('keeps TSI digits inside the 0–4 signal range and saves all settings', () => {
        const onSave = jest.fn();
        render(
            <MatchesKingConfig
                selection={{ symbol: DERIV_CONTINUOUS_VOLATILITIES[0], setup: 'tsi' }}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={onSave}
            />,
        );

        expect(digitsForMatchesKingCount(3, 'tsi')).toEqual([0, 1, 2]);
        fireEvent.change(screen.getByTestId('matches-king-digit-count'), { target: { value: '3' } });
        expect(Array.from(screen.getByTestId('matches-king-digit-preview').querySelectorAll('b'))
            .map(digit => digit.textContent)).toEqual(['0', '1', '2']);
        fireEvent.click(screen.getByRole('button', { name: 'Save & Run #19 now' }));

        expect(onSave).toHaveBeenCalledWith({
            stake: 0.5,
            takeProfit: 10,
            stopLoss: 30,
            martingale: 2,
            digitCount: 3,
            digits: [0, 1, 2],
            useVirtualHook: true,
            virtualLossThreshold: 2,
        });
    });

    it('auto-fills MACD digits from 6–9 and defaults to the full signal range', () => {
        const onSave = jest.fn();
        render(
            <MatchesKingConfig
                selection={{ symbol: DERIV_CONTINUOUS_VOLATILITIES[0], setup: 'macd' }}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={onSave}
            />,
        );

        expect(digitsForMatchesKingCount(3, 'macd')).toEqual([6, 7, 8]);
        expect(screen.getByTestId('matches-king-digit-count')).toHaveValue('4');
        expect(Array.from(screen.getByTestId('matches-king-digit-preview').querySelectorAll('b'))
            .map(digit => digit.textContent)).toEqual(['6', '7', '8', '9']);
        expect(screen.getAllByRole('option')).toHaveLength(4);

        fireEvent.change(screen.getByTestId('matches-king-digit-count'), { target: { value: '3' } });
        expect(Array.from(screen.getByTestId('matches-king-digit-preview').querySelectorAll('b'))
            .map(digit => digit.textContent)).toEqual(['6', '7', '8']);
        fireEvent.click(screen.getByRole('button', { name: 'Save & Run #19 now' }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            digitCount: 3,
            digits: [6, 7, 8],
        }));
    });

    it('hides the loss threshold when Virtual Hook is disabled', () => {
        render(
            <MatchesKingConfig
                selection={{ symbol: DERIV_CONTINUOUS_VOLATILITIES[0], setup: 'macd' }}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByTestId('matches-king-use-virtual-hook'));
        expect(screen.queryByTestId('matches-king-virtual-loss-threshold')).not.toBeInTheDocument();
    });
});

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import { OverUnderSecretWeaponConfig } from '../OverUnderSecretWeaponConfig';
import type { OverUnderSignalSelection } from '../over-under-signal-board';

function makeSelection(side: 'OVER' | 'UNDER'): OverUnderSignalSelection {
    const isOver = side === 'OVER';
    return {
        symbol: DERIV_VOLATILITIES[0],
        setup: {
            mode: isOver ? 'MACD_OVER_4' : 'TSI_UNDER_6',
            side,
            barrier: isOver ? 4 : 6,
            indicator: isOver ? 'MACD' : 'TSI',
            indicatorValue: 0.5,
            setupReady: true,
            entryWindow: false,
            feedFresh: true,
            tradeNow: false,
            conditions: [],
        },
    };
}

describe('Over Under Secret Weapon signal configuration', () => {
    beforeEach(() => localStorage.clear());

    it('offers Over barriers 0 through 8 and passes risk values to Save & Run', () => {
        const onSave = jest.fn();
        render(
            <OverUnderSecretWeaponConfig
                selection={makeSelection('OVER')}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={onSave}
            />,
        );

        const barrierSelect = screen.getByTestId('secret-weapon-barrier') as HTMLSelectElement;
        expect(Array.from(barrierSelect.options).map(option => option.value)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
        fireEvent.change(barrierSelect, { target: { value: '0' } });
        fireEvent.change(screen.getByLabelText('Stake ($)'), { target: { value: '0.75' } });
        fireEvent.click(screen.getByTestId('secret-weapon-save'));

        expect(screen.getByTestId('secret-weapon-save')).toHaveTextContent('Save & Run #21 now');
        expect(onSave).toHaveBeenCalledWith({
            barrier: 0,
            stake: 0.75,
            takeProfit: 15,
            stopLoss: 50,
            martingale: 2,
        });
    });

    it('offers Under barriers from 9 down to 1', () => {
        render(
            <OverUnderSecretWeaponConfig
                selection={makeSelection('UNDER')}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={jest.fn()}
            />,
        );

        const options = within(screen.getByTestId('secret-weapon-barrier')).getAllByRole('option');
        expect(options.map(option => (option as HTMLOptionElement).value)).toEqual(['9', '8', '7', '6', '5', '4', '3', '2', '1']);
        expect(screen.getByText(/no entry-point wait/)).toBeInTheDocument();
    });
});

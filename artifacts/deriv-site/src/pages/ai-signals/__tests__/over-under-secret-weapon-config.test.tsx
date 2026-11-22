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

    it('allows Over and Under selection and passes the selected side and risk settings', () => {
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
        fireEvent.change(barrierSelect, { target: { value: '1' } });
        fireEvent.change(screen.getByTestId('secret-weapon-max-trades'), { target: { value: '7' } });
        fireEvent.change(screen.getByLabelText('Stake ($)'), { target: { value: '0.75' } });
        fireEvent.click(screen.getByTestId('secret-weapon-save'));

        expect(screen.getByTestId('secret-weapon-save')).toHaveTextContent('Save & Run #21 now');
        expect(onSave).toHaveBeenCalledWith({
            side: 'OVER',
            barrier: 1,
            stake: 0.75,
            takeProfit: 15,
            stopLoss: 50,
            martingale: 2,
            maxTrades: 7,
        });
    });

    it('lets an Under source switch to Over, then back to Under barriers', () => {
        render(
            <OverUnderSecretWeaponConfig
                selection={makeSelection('UNDER')}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={jest.fn()}
            />,
        );

        const sideSelect = screen.getByTestId('secret-weapon-side') as HTMLSelectElement;
        expect(sideSelect.value).toBe('UNDER');
        const options = within(screen.getByTestId('secret-weapon-barrier')).getAllByRole('option');
        expect(options.map(option => (option as HTMLOptionElement).value)).toEqual(['9', '8', '7', '6', '5', '4', '3', '2', '1']);
        fireEvent.change(sideSelect, { target: { value: 'OVER' } });
        const overOptions = within(screen.getByTestId('secret-weapon-barrier')).getAllByRole('option');
        expect(overOptions.map(option => (option as HTMLOptionElement).value)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
        fireEvent.change(screen.getByTestId('secret-weapon-barrier'), { target: { value: '1' } });
        fireEvent.change(sideSelect, { target: { value: 'UNDER' } });
        expect((screen.getByTestId('secret-weapon-barrier') as HTMLSelectElement).value).toBe('1');
        expect(screen.getByText(/no entry-point wait/)).toBeInTheDocument();
    });

    it('restores a saved trade direction, barrier, and trade limit', () => {
        localStorage.setItem('fb_cfg_over-under-secret-weapon', JSON.stringify({
            side: 'OVER',
            barrier: 1,
            stake: '2',
            takeProfit: '10',
            stopLoss: '20',
            martingale: '1.5',
            maxTrades: '9',
        }));
        render(
            <OverUnderSecretWeaponConfig
                selection={makeSelection('UNDER')}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={jest.fn()}
            />,
        );

        expect(screen.getByTestId('secret-weapon-side')).toHaveValue('OVER');
        expect(screen.getByTestId('secret-weapon-barrier')).toHaveValue('1');
        expect(screen.getByTestId('secret-weapon-max-trades')).toHaveValue(9);
    });
});

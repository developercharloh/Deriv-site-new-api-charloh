import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DERIV_CONTINUOUS_VOLATILITIES } from '@/utils/deriv-volatilities';
import { EvenOddBeastConfig } from '../EvenOddBeastConfig';

describe('Even Odd Beast handoff settings', () => {
    beforeEach(() => localStorage.clear());

    it('passes the selected market side and editable risk settings to Save and Run', () => {
        const onSave = jest.fn();
        render(
            <EvenOddBeastConfig
                selection={{
                    symbol: DERIV_CONTINUOUS_VOLATILITIES[0],
                    side: 'ODD',
                    analysis: {} as any,
                }}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={onSave}
            />,
        );

        expect(screen.getByText(/Signal side:/)).toHaveTextContent('ODD');
        expect(screen.getByText(/Volatility 10 \(1s\) Index/)).toHaveTextContent('1HZ10V');
        fireEvent.change(screen.getByLabelText('Stake ($)'), { target: { value: '1.25' } });
        fireEvent.change(screen.getByLabelText('Take Profit ($)'), { target: { value: '25' } });
        fireEvent.change(screen.getByLabelText('Stop Loss ($)'), { target: { value: '40' } });
        fireEvent.change(screen.getByLabelText('Martingale multiplier (×)'), { target: { value: '1.7' } });
        fireEvent.change(screen.getByLabelText('Maximum trades'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save and Run Even Odd Beast' }));

        expect(onSave).toHaveBeenCalledWith({
            stake: 1.25,
            takeProfit: 25,
            stopLoss: 40,
            martingale: 1.7,
            maxTrades: 12,
        });
    });

    it('rejects non-positive settings before starting the bot', () => {
        const onSave = jest.fn();
        render(
            <EvenOddBeastConfig
                selection={{
                    symbol: DERIV_CONTINUOUS_VOLATILITIES[0],
                    side: 'EVEN',
                    analysis: {} as any,
                }}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={onSave}
            />,
        );
        fireEvent.change(screen.getByLabelText('Stake ($)'), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save and Run Even Odd Beast' }));

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('must be greater than zero');
    });

    it('requires a positive whole-number trade limit', () => {
        const onSave = jest.fn();
        render(
            <EvenOddBeastConfig
                selection={{
                    symbol: DERIV_CONTINUOUS_VOLATILITIES[0],
                    side: 'EVEN',
                    analysis: {} as any,
                }}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={onSave}
            />,
        );
        fireEvent.change(screen.getByLabelText('Maximum trades'), { target: { value: '2.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save and Run Even Odd Beast' }));

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('whole number from 1 to 10,000');
    });

    it('restores the saved trade limit when reopening the setup', () => {
        localStorage.setItem('ai-signals-even-odd-beast-config', JSON.stringify({
            stake: '1',
            takeProfit: '5',
            stopLoss: '10',
            martingale: '2',
            maxTrades: '8',
        }));
        render(
            <EvenOddBeastConfig
                selection={{
                    symbol: DERIV_CONTINUOUS_VOLATILITIES[0],
                    side: 'ODD',
                    analysis: {} as any,
                }}
                loading={false}
                error=''
                onClose={jest.fn()}
                onSave={jest.fn()}
            />,
        );

        expect(screen.getByTestId('even-odd-beast-maxTrades')).toHaveValue(8);
    });
});

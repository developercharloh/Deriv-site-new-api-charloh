import React from 'react';
import { render, screen } from '@testing-library/react';
import TradingViewPage from '../index';

describe('Trading View tab', () => {
    it('embeds Deriv’s advanced TradingView charts', () => {
        render(<TradingViewPage />);

        const chartFrame = screen.getByTitle('TradingView advanced charts and tools from Deriv');
        expect(chartFrame).toHaveAttribute(
            'src',
            'https://charts.deriv.com/deriv?hide-signup=true&instrument=R_25&timePeriod=1'
        );
        expect(screen.getByRole('region', { name: 'TradingView advanced charts and tools' })).toContainElement(
            chartFrame
        );
    });
});

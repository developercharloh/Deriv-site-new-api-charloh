import React from 'react';
import { render, screen } from '@testing-library/react';
import TradingViewPage from '../index';

describe('Trading View tab', () => {
    it('opens Deriv’s official chart directly instead of nesting the chart in an iframe', () => {
        render(<TradingViewPage />);

        const chartLink = screen.getByRole('link', { name: 'Open Deriv TradingView' });
        expect(chartLink).toHaveAttribute(
            'href',
            'https://charts.deriv.com/deriv?hide-signup=true&instrument=R_25&timePeriod=1'
        );
        expect(chartLink).toHaveAttribute('target', '_blank');
        expect(chartLink).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByRole('region', { name: 'TradingView advanced charts and tools' })).toContainElement(chartLink);
    });
});

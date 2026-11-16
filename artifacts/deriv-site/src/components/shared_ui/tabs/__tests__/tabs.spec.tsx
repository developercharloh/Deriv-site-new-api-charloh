import React from 'react';
import { render, screen } from '@testing-library/react';
import Tabs from '../tabs';

jest.mock('../../themed-scrollbars/themed-scrollbars', () => ({
    __esModule: true,
    default: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
        <div className={className}>{children}</div>
    ),
}));

describe('shared tabs', () => {
    it('keeps every labeled tab, including AI Analysis, when the active tab changes', () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { container, rerender } = render(
            <Tabs active_index={0} className='main' is_scrollable top history={undefined as any}>
                <div id='id-free-bots' label={<span>Free Bots</span>}>Free Bots panel</div>
                <div id='id-ai-analysis' label={<span>AI Analysis</span>}>AI Analysis panel</div>
                <div id='id-d-circles' label={<span>Execution Plan</span>}>Execution Plan panel</div>
            </Tabs>
        );

        expect(screen.getByText('Free Bots')).toBeInTheDocument();
        expect(screen.getByText('AI Analysis')).toBeInTheDocument();
        expect(screen.getByText('Execution Plan')).toBeInTheDocument();
        expect(container.querySelector('.dc-tabs')?.getAttribute('style')).toContain('--tab-width: unset');
        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key/i);

        rerender(
            <Tabs active_index={1} className='main' is_scrollable top history={undefined as any}>
                <div id='id-free-bots' label={<span>Free Bots</span>}>Free Bots panel</div>
                <div id='id-ai-analysis' label={<span>AI Analysis</span>}>AI Analysis panel</div>
                <div id='id-d-circles' label={<span>Execution Plan</span>}>Execution Plan panel</div>
            </Tabs>
        );

        expect(screen.getByText('AI Analysis')).toBeInTheDocument();
        expect(screen.getByText('AI Analysis panel')).toBeInTheDocument();
        expect(screen.getByText('Execution Plan')).toBeInTheDocument();
        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key/i);
        consoleError.mockRestore();
    });
});

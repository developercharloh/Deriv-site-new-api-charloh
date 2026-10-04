import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FreeBotCategoryTabs, { type FreeBotCategoryTab } from '../FreeBotCategoryTabs';
import type { FreeBotSection } from '../types';

const tabs: FreeBotCategoryTab[] = [
    { id: 'smart-contract', label: 'Smart Contract Bots', count: 11 },
    { id: 'premium', label: 'Premium Bots', count: 7 },
    { id: 'edging', label: 'Edging Bots', count: 0 },
];

const CategoryTabsHarness: React.FC = () => {
    const [selectedId, setSelectedId] = useState<FreeBotSection>('smart-contract');
    const selectedTab = tabs.find(tab => tab.id === selectedId)!;

    return (
        <>
            <FreeBotCategoryTabs tabs={tabs} selectedId={selectedId} onSelect={setSelectedId} />
            <div role='tabpanel'>{selectedTab.label} list</div>
        </>
    );
};

describe('FreeBotCategoryTabs', () => {
    it('starts on Smart Contract Bots and only shows the selected category panel', () => {
        render(<CategoryTabsHarness />);

        expect(screen.getByRole('tab', { name: 'Smart Contract Bots, 11 bots' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Smart Contract Bots list');
    });

    it('switches the visible panel when a category tab is clicked', () => {
        render(<CategoryTabsHarness />);

        fireEvent.click(screen.getByRole('tab', { name: 'Premium Bots, 7 bots' }));

        expect(screen.getByRole('tab', { name: 'Premium Bots, 7 bots' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Premium Bots list');
    });

    it('supports arrow-key tab navigation and opens the empty Edging category', () => {
        render(<CategoryTabsHarness />);
        const smartContractTab = screen.getByRole('tab', { name: 'Smart Contract Bots, 11 bots' });

        fireEvent.keyDown(smartContractTab, { key: 'ArrowLeft' });

        const edgingTab = screen.getByRole('tab', { name: 'Edging Bots, 0 bots' });
        expect(edgingTab).toHaveAttribute('aria-selected', 'true');
        expect(edgingTab).toHaveFocus();
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Edging Bots list');
    });
});
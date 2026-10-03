import React, { useRef } from 'react';
import type { FreeBotSection } from './types';

export interface FreeBotCategoryTab {
    id: FreeBotSection;
    label: string;
    count: number;
}

interface FreeBotCategoryTabsProps {
    tabs: FreeBotCategoryTab[];
    selectedId: FreeBotSection;
    onSelect: (sectionId: FreeBotSection) => void;
}

const FreeBotCategoryTabs: React.FC<FreeBotCategoryTabsProps> = ({ tabs, selectedId, onSelect }) => {
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        let nextIndex: number;

        switch (event.key) {
            case 'ArrowRight':
                nextIndex = (index + 1) % tabs.length;
                break;
            case 'ArrowLeft':
                nextIndex = (index - 1 + tabs.length) % tabs.length;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = tabs.length - 1;
                break;
            default:
                return;
        }

        event.preventDefault();
        onSelect(tabs[nextIndex].id);
        tabRefs.current[nextIndex]?.focus();
    };

    return (
        <div className='free-bots__category-tabs' role='tablist' aria-label='Free bot categories'>
            {tabs.map((tab, index) => {
                const isSelected = tab.id === selectedId;

                return (
                    <button
                        ref={element => {
                            tabRefs.current[index] = element;
                        }}
                        className='free-bots__category-tab'
                        id={`free-bots-tab-${tab.id}`}
                        key={tab.id}
                        type='button'
                        role='tab'
                        aria-label={`${tab.label}, ${tab.count} ${tab.count === 1 ? 'bot' : 'bots'}`}
                        aria-selected={isSelected}
                        aria-controls={`free-bots-panel-${tab.id}`}
                        tabIndex={isSelected ? 0 : -1}
                        onClick={() => onSelect(tab.id)}
                        onKeyDown={event => handleKeyDown(event, index)}
                    >
                        <span className='free-bots__category-label'>{tab.label}</span>
                        <span className='free-bots__category-count' aria-hidden='true'>
                            {tab.count}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

export default FreeBotCategoryTabs;
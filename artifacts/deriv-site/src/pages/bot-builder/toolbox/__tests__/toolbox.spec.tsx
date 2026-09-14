import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { observable } from 'mobx';
import { useDevice } from '@deriv-com/ui';
import { useStore } from '@/hooks/useStore';
import { doesCategoryMatchSearch } from '@/stores/toolbox-search';
import Toolbox from '../toolbox';

jest.mock('@/hooks/useStore', () => ({
    useStore: jest.fn(),
}));

jest.mock('@deriv-com/ui', () => ({
    ...jest.requireActual('@deriv-com/ui'),
    useDevice: jest.fn(),
}));

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
}));

jest.mock('@deriv/quill-icons/LabelPaired', () => ({
    LabelPairedChevronDownMdFillIcon: () => null,
    LabelPairedSearchCaptionRegularIcon: () => null,
}));

jest.mock('@deriv/quill-icons/Legacy', () => ({
    LegacyCloseCircle1pxBlackIcon: ({ onClick }: { onClick: () => void }) => (
        <button type='button' aria-label='clear-search' onClick={onClick} />
    ),
}));

jest.mock('@/components/shared_ui/text', () => ({
    __esModule: true,
    default: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

jest.mock('../toolbox-items', () => ({
    ToolboxItems: () => '<xml />',
}));

const mockedUseDevice = useDevice as jest.MockedFunction<typeof useDevice>;
const mockedUseStore = useStore as jest.MockedFunction<typeof useStore>;

const createToolboxDom = () => {
    const toolboxDom = document.createElement('xml');

    ['Analysis Logics 🔥', 'Trade parameters', 'Logic'].forEach((name, index) => {
        const category = document.createElement('category');
        category.id = `category-${index}`;
        category.setAttribute('name', name);
        if (name === 'Logic') {
            const block = document.createElement('block');
            block.setAttribute('type', 'logic_compare');
            category.appendChild(block);
        }
        toolboxDom.appendChild(category);
    });

    return toolboxDom;
};

describe('Toolbox mobile Blocks menu', () => {
    beforeEach(() => {
        mockedUseDevice.mockReturnValue({ isDesktop: false } as ReturnType<typeof useDevice>);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('opens and closes without changing the Blockly toolbox DOM', async () => {
        const toolboxDom = createToolboxDom();

        const initialToolboxMarkup = toolboxDom.innerHTML;
        const onToolboxItemClick = jest.fn();
        const setVisibility = jest.fn();

        mockedUseStore.mockReturnValue({
            toolbox: {
                hasSubCategory: jest.fn(() => false),
                is_search_loading: false,
                search_term: '',
                categoryMatchesSearch: jest.fn(() => true),
                onMount: jest.fn(),
                onSearch: jest.fn(),
                onSearchBlur: jest.fn(),
                onSearchClear: jest.fn(),
                onSearchKeyUp: jest.fn(),
                onToolboxItemClick,
                onToolboxItemExpand: jest.fn(),
                onUnmount: jest.fn(),
                sub_category_index: [],
                toolbox_dom: toolboxDom,
            },
            flyout: {
                selected_category: undefined,
                setVisibility,
            },
        } as any);

        const user = userEvent.setup();
        render(<Toolbox />);

        expect(screen.queryByText('Quick strategy')).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument();
        expect(screen.getByTestId('button-open-blocks-menu')).toHaveAttribute('aria-expanded', 'false');

        await user.click(screen.getByTestId('button-open-blocks-menu'));

        expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
        expect(screen.getByText('Analysis Logics 🔥')).toBeInTheDocument();
        expect(screen.getByText('Trade parameters')).toBeInTheDocument();
        expect(screen.getByText('Logic')).toBeInTheDocument();
        expect(screen.getByTestId('button-open-blocks-menu')).toHaveAttribute('aria-expanded', 'true');

        await user.click(screen.getByTestId('button-open-blocks-menu'));

        expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument();
        expect(screen.queryByText('Trade parameters')).not.toBeInTheDocument();
        expect(screen.queryByText('Logic')).not.toBeInTheDocument();
        expect(screen.getByTestId('button-open-blocks-menu')).toHaveAttribute('aria-expanded', 'false');
        expect(toolboxDom.innerHTML).toBe(initialToolboxMarkup);
        expect(onToolboxItemClick).not.toHaveBeenCalled();
        expect(setVisibility).toHaveBeenCalledTimes(2);
        expect(setVisibility).toHaveBeenLastCalledWith(false);
    });

    it('filters matching categories while searching and restores all categories when cleared', async () => {
        const toolboxDom = createToolboxDom();
        let toolbox: any;
        toolbox = observable({
            hasSubCategory: jest.fn(() => false),
            is_search_loading: false,
            search_term: '',
            categoryMatchesSearch: jest.fn((category: HTMLElement) =>
                doesCategoryMatchSearch(category, toolbox.search_term)
            ),
            onMount: jest.fn(),
            onSearch: jest.fn((values: { search: string }) => {
                toolbox.search_term = values.search;
            }),
            onSearchBlur: jest.fn(),
            onSearchClear: jest.fn((setFieldValue: (field: string, value: string) => void) => {
                setFieldValue('search', '');
                toolbox.search_term = '';
            }),
            onSearchKeyUp: jest.fn(),
            onToolboxItemClick: jest.fn(),
            onToolboxItemExpand: jest.fn(),
            onUnmount: jest.fn(),
            sub_category_index: [],
            toolbox_dom: toolboxDom,
        });

        mockedUseStore.mockReturnValue({
            toolbox,
            flyout: {
                selected_category: undefined,
                setVisibility: jest.fn(),
            },
        } as any);

        const user = userEvent.setup();
        render(<Toolbox />);
        await user.click(screen.getByTestId('button-open-blocks-menu'));

        const search = screen.getByPlaceholderText('Search');
        await user.click(search);
        await user.type(search, 'logic_compare');

        act(() => {
            toolbox.onSearch({ search: 'Logic' });
        });

        expect(toolbox.search_term).toBe('Logic');
        await waitFor(() => {
            expect(screen.getByText('Logic')).toBeInTheDocument();
            expect(screen.queryByText('Trade parameters')).not.toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: 'clear-search' }));

        expect(screen.getByText('Trade parameters')).toBeInTheDocument();
        expect(screen.getByText('Logic')).toBeInTheDocument();
    });
});

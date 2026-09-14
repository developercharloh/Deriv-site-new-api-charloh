import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDevice } from '@deriv-com/ui';
import { useStore } from '@/hooks/useStore';
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
});

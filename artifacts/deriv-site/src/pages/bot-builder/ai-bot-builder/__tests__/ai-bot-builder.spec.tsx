const mockMutateAsync = jest.fn();
const mockValidateGeneratedBotXml = jest.fn();
const mockBlockCatalog =
    '<xml><block type="trade_definition"/><block type="before_purchase"/><block type="after_purchase"/><block type="purchase"/></xml>';

jest.mock('@workspace/api-client-react', () => ({
    useGenerateOpenaiBotStrategy: () => ({
        mutateAsync: mockMutateAsync,
        isPending: false,
        isError: false,
        error: null,
    }),
}));

jest.mock('../blockly-preview', () => ({
    getBotBuilderBlockCatalog: () => mockBlockCatalog,
    validateGeneratedBotXml: (...args: unknown[]) => mockValidateGeneratedBotXml(...args),
}));

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AiBotBuilder from '../ai-bot-builder';

const generatedStrategy = {
    title: 'One trade',
    summary: 'Place one contract and stop.',
    xml: '<xml is_dbot="true"></xml>',
    blockCount: 5,
    warnings: ['Review before use.'],
};

describe('AiBotBuilder', () => {
    beforeEach(() => {
        mockMutateAsync.mockReset();
        mockValidateGeneratedBotXml.mockReset();
        localStorage.removeItem('deriv-ai-bot-builder-history:CR12345');
        localStorage.removeItem('deriv-ai-bot-builder-history:CR98765');
        localStorage.removeItem('deriv-ai-bot-builder-history:guest');
        localStorage.removeItem('deriv-ai-bot-builder-launcher-position');
    });

    it('requires explicit confirmation before replacing the current workspace', async () => {
        const onLoad = jest.fn();
        mockMutateAsync.mockResolvedValue(generatedStrategy);
        render(<AiBotBuilder onLoad={onLoad} renderPreview={() => <div>Block preview</div>} />);

        fireEvent.click(screen.getByTestId('button-open-ai-bot-builder'));
        fireEvent.change(screen.getByTestId('input-ai-bot-builder-prompt'), {
            target: { value: 'Buy one Rise contract and stop after settlement.' },
        });
        fireEvent.click(screen.getByTestId('button-generate-ai-strategy'));

        expect(await screen.findByTestId('result-ai-bot-builder')).toBeInTheDocument();
        expect(onLoad).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('button-load-ai-strategy'));
        expect(onLoad).not.toHaveBeenCalled();
        expect(screen.getByText('Replace your current workspace?')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('button-confirm-load-ai-strategy'));
        await waitFor(() => expect(onLoad).toHaveBeenCalledWith(generatedStrategy.xml));
    });

    it('saves generated bots to account history and sends their XML when refining', async () => {
        const refinedStrategy = {
            ...generatedStrategy,
            title: 'Refined one trade',
            summary: 'A refined strategy.',
            xml: '<xml is_dbot="true"><block type="trade_definition"></block></xml>',
        };
        mockMutateAsync
            .mockResolvedValueOnce(generatedStrategy)
            .mockResolvedValueOnce(refinedStrategy);
        render(
            <AiBotBuilder
                accountId='CR12345'
                onLoad={jest.fn()}
                renderPreview={() => <div>Block preview</div>}
            />
        );

        fireEvent.click(screen.getByTestId('button-open-ai-bot-builder'));
        fireEvent.change(screen.getByTestId('input-ai-bot-builder-prompt'), {
            target: { value: 'Buy one Rise contract and stop after settlement.' },
        });
        fireEvent.click(screen.getByTestId('button-generate-ai-strategy'));
        expect(await screen.findByTestId('result-ai-bot-builder')).toBeInTheDocument();
        expect(mockMutateAsync).toHaveBeenNthCalledWith(1, {
            data: {
                prompt: 'Buy one Rise contract and stop after settlement.',
                blockCatalog: mockBlockCatalog,
            },
        });

        fireEvent.click(screen.getByTestId('button-toggle-ai-bot-history'));
        fireEvent.click(screen.getByRole('button', { name: 'Refine', exact: true }));
        expect(screen.getByTestId('text-ai-bot-builder-refining')).toHaveTextContent('One trade');
        fireEvent.change(screen.getByTestId('input-ai-bot-builder-prompt'), {
            target: { value: 'Change the stake to 0.50 and keep one trade.' },
        });
        fireEvent.click(screen.getByTestId('button-generate-ai-strategy'));

        await waitFor(() =>
            expect(mockMutateAsync).toHaveBeenNthCalledWith(2, {
                data: {
                    prompt: 'Change the stake to 0.50 and keep one trade.',
                    existingXml: generatedStrategy.xml,
                    blockCatalog: mockBlockCatalog,
                },
            })
        );
        expect(JSON.parse(localStorage.getItem('deriv-ai-bot-builder-history:CR12345') || '[]')).toHaveLength(2);
    });

    it('keeps bot history isolated when the active account changes', async () => {
        localStorage.setItem(
            'deriv-ai-bot-builder-history:CR12345',
            JSON.stringify([
                {
                    ...generatedStrategy,
                    id: 'saved-for-account-one',
                    prompt: 'Buy one Rise contract and stop after settlement.',
                    savedAt: Date.now(),
                },
            ])
        );
        const props = {
            onLoad: jest.fn(),
            renderPreview: () => <div>Block preview</div>,
        };
        const { rerender } = render(<AiBotBuilder {...props} accountId='CR12345' />);
        fireEvent.click(screen.getByTestId('button-open-ai-bot-builder'));

        await waitFor(() =>
            expect(screen.getByTestId('button-toggle-ai-bot-history')).toHaveTextContent('1')
        );

        rerender(<AiBotBuilder {...props} accountId='CR98765' />);
        await waitFor(() =>
            expect(screen.getByTestId('button-toggle-ai-bot-history')).toHaveTextContent('0')
        );
        fireEvent.click(screen.getByTestId('button-toggle-ai-bot-history'));
        expect(screen.getByTestId('list-ai-bot-history')).toHaveTextContent(
            'Generated strategies will appear here'
        );
        expect(screen.queryByText('One trade')).not.toBeInTheDocument();
    });

    it('lets users reposition the launcher with keyboard arrow keys', () => {
        render(<AiBotBuilder onLoad={jest.fn()} renderPreview={() => <div>Block preview</div>} />);
        fireEvent.keyDown(screen.getByTestId('button-move-ai-bot-builder'), { key: 'ArrowRight' });
        expect(localStorage.getItem('deriv-ai-bot-builder-launcher-position')).toBeTruthy();
        expect(screen.queryByTestId('panel-ai-bot-builder')).not.toBeInTheDocument();
    });

    it('does not show or save a strategy that fails workspace verification', async () => {
        mockMutateAsync.mockResolvedValue(generatedStrategy);
        mockValidateGeneratedBotXml.mockImplementation(() => {
            throw new Error('A generated block does not support this input.');
        });
        render(<AiBotBuilder onLoad={jest.fn()} renderPreview={() => <div>Block preview</div>} />);

        fireEvent.click(screen.getByTestId('button-open-ai-bot-builder'));
        fireEvent.change(screen.getByTestId('input-ai-bot-builder-prompt'), {
            target: { value: 'Buy one Rise contract and stop after settlement.' },
        });
        fireEvent.click(screen.getByTestId('button-generate-ai-strategy'));

        expect(await screen.findByTestId('status-ai-bot-builder-error')).toHaveTextContent(
            'A generated block does not support this input.',
        );
        expect(screen.queryByTestId('result-ai-bot-builder')).not.toBeInTheDocument();
        expect(localStorage.getItem('deriv-ai-bot-builder-history:guest')).toBeNull();
    });
});

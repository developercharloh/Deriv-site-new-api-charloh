const mockMutateAsync = jest.fn();

jest.mock('@workspace/api-client-react', () => ({
    useGenerateOpenaiBotStrategy: () => ({
        mutateAsync: mockMutateAsync,
        isPending: false,
        isError: false,
        error: null,
    }),
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
});

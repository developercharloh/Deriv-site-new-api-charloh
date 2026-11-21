import { useState, type FormEvent, type ReactNode } from 'react';
import { localize } from '@deriv-com/translations';
import { useGenerateOpenaiBotStrategy } from '@workspace/api-client-react';
import './ai-bot-builder.scss';

type StrategyResult = {
    title: string;
    summary: string;
    xml: string;
    blockCount: number;
    warnings: string[];
};

type AiBotBuilderProps = {
    onLoad: (xml: string) => void | Promise<void>;
    renderPreview: (xml: string) => ReactNode;
};

const MIN_PROMPT_LENGTH = 12;
const MAX_PROMPT_LENGTH = 1400;

const Sparkles = () => (
    <svg aria-hidden='true' viewBox='0 0 24 24' fill='none'>
        <path d='m12 3 1.55 5.45L19 10l-5.45 1.55L12 17l-1.55-5.45L5 10l5.45-1.55L12 3Z' />
        <path d='m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z' />
    </svg>
);

const CloseIcon = () => (
    <svg aria-hidden='true' viewBox='0 0 24 24' fill='none'>
        <path d='m6 6 12 12M18 6 6 18' />
    </svg>
);

const getErrorMessage = (error: unknown) => {
    if (error && typeof error === 'object') {
        const responseError = error as { error?: string; message?: string; data?: { error?: string } };
        return responseError.data?.error || responseError.error || responseError.message;
    }
    return undefined;
};

export function AiBotBuilder({ onLoad, renderPreview }: AiBotBuilderProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [result, setResult] = useState<StrategyResult | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
    const generateStrategy = useGenerateOpenaiBotStrategy();

    const trimmedPrompt = prompt.trim();
    const promptError =
        trimmedPrompt.length > 0 && trimmedPrompt.length < MIN_PROMPT_LENGTH
            ? localize('Enter at least 12 characters to describe your strategy.')
            : trimmedPrompt.length > MAX_PROMPT_LENGTH
              ? localize('Your strategy description must be 1,400 characters or fewer.')
              : '';

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (trimmedPrompt.length < MIN_PROMPT_LENGTH || trimmedPrompt.length > MAX_PROMPT_LENGTH) return;

        setResult(null);
        setIsConfirming(false);
        setLoadError('');
        try {
            const generated = await generateStrategy.mutateAsync({ data: { prompt: trimmedPrompt } });
            setResult(generated);
        } catch {
            // React Query exposes the mutation error below so the error remains visible in the form.
        }
    };

    const handleLoad = async () => {
        if (!result) return;
        setIsLoadingWorkspace(true);
        setLoadError('');
        try {
            await onLoad(result.xml);
            setIsConfirming(false);
            setIsOpen(false);
        } catch (error) {
            setLoadError(getErrorMessage(error) || localize('The strategy could not be loaded. Your workspace was not changed.'));
        } finally {
            setIsLoadingWorkspace(false);
        }
    };

    const handleClose = () => {
        setIsOpen(false);
        setIsConfirming(false);
    };

    return (
        <div className='ai-bot-builder' data-testid='ai-bot-builder'>
            {isOpen && (
                <section
                    id='ai-bot-builder-panel'
                    className='ai-bot-builder__panel'
                    aria-label={localize('AI Bot Builder')}
                    aria-describedby='ai-bot-builder-description'
                    data-testid='panel-ai-bot-builder'
                >
                    <header className='ai-bot-builder__header'>
                        <div className='ai-bot-builder__heading'>
                            <span className='ai-bot-builder__mark'>
                                <Sparkles />
                            </span>
                            <div>
                                <p className='ai-bot-builder__eyebrow'>{localize('STRATEGY ASSIST')}</p>
                                <h2>{localize('AI Bot Builder')}</h2>
                            </div>
                        </div>
                        <button
                            type='button'
                            className='ai-bot-builder__close'
                            onClick={handleClose}
                            aria-label={localize('Close AI Bot Builder')}
                            data-testid='button-close-ai-bot-builder'
                        >
                            <CloseIcon />
                        </button>
                    </header>

                    <p id='ai-bot-builder-description' className='ai-bot-builder__intro'>
                        {localize('Describe a strategy. Review its blocks before you choose to load it.')}
                    </p>

                    <form className='ai-bot-builder__form' onSubmit={handleSubmit}>
                        <label htmlFor='ai-bot-builder-prompt'>{localize('What should your bot do?')}</label>
                        <textarea
                            id='ai-bot-builder-prompt'
                            value={prompt}
                            onChange={event => setPrompt(event.target.value.slice(0, MAX_PROMPT_LENGTH))}
                            placeholder={localize(
                                'For example: Buy a rise contract after three consecutive falling candles, with a 2-tick duration.',
                            )}
                            rows={4}
                            maxLength={MAX_PROMPT_LENGTH}
                            aria-invalid={Boolean(promptError)}
                            aria-describedby='ai-bot-builder-prompt-help ai-bot-builder-prompt-count'
                            data-testid='input-ai-bot-builder-prompt'
                        />
                        <div className='ai-bot-builder__field-meta'>
                            <span
                                id='ai-bot-builder-prompt-help'
                                className={promptError ? 'ai-bot-builder__validation' : ''}
                                role={promptError ? 'alert' : undefined}
                                data-testid='text-ai-bot-builder-validation'
                            >
                                {promptError || localize('Use 12–1,400 characters. Be specific about entry and exit rules.')}
                            </span>
                            <span id='ai-bot-builder-prompt-count' className='ai-bot-builder__counter'>
                                {trimmedPrompt.length}/{MAX_PROMPT_LENGTH}
                            </span>
                        </div>

                        {generateStrategy.isError && (
                            <div className='ai-bot-builder__error' role='alert' data-testid='status-ai-bot-builder-error'>
                                <strong>{localize('Strategy not generated')}</strong>
                                <span>
                                    {getErrorMessage(generateStrategy.error) ||
                                        localize('Something went wrong. Check your connection and try again.')}
                                </span>
                            </div>
                        )}

                        <button
                            type='submit'
                            className='ai-bot-builder__generate'
                            disabled={
                                generateStrategy.isPending ||
                                trimmedPrompt.length < MIN_PROMPT_LENGTH ||
                                trimmedPrompt.length > MAX_PROMPT_LENGTH
                            }
                            data-testid='button-generate-ai-strategy'
                        >
                            {generateStrategy.isPending ? (
                                <>
                                    <span className='ai-bot-builder__progress' aria-hidden='true' />
                                    {localize('Building your strategy…')}
                                </>
                            ) : (
                                <>
                                    <Sparkles />
                                    {localize('Generate strategy')}
                                </>
                            )}
                        </button>
                        <p className='ai-bot-builder__credits' data-testid='text-ai-bot-builder-credits'>
                            {localize('Generation uses Replit AI credits. Review the result before loading it.')}
                        </p>
                    </form>

                    {generateStrategy.isPending && (
                        <div className='ai-bot-builder__loading' role='status' aria-live='polite' data-testid='status-ai-bot-builder-loading'>
                            <span className='ai-bot-builder__skeleton ai-bot-builder__skeleton--title' />
                            <span className='ai-bot-builder__skeleton' />
                            <span className='ai-bot-builder__skeleton ai-bot-builder__skeleton--short' />
                            <span className='ai-bot-builder__loading-label'>{localize('Turning your rules into editable blocks…')}</span>
                        </div>
                    )}

                    {result && !generateStrategy.isPending && (
                        <div className='ai-bot-builder__result' data-testid='result-ai-bot-builder'>
                            <div className='ai-bot-builder__result-heading'>
                                <div>
                                    <p className='ai-bot-builder__eyebrow'>{localize('READY TO REVIEW')}</p>
                                    <h3>{result.title}</h3>
                                </div>
                                <span className='ai-bot-builder__block-count'>
                                    {localize('{{count}} blocks', { count: result.blockCount })}
                                </span>
                            </div>
                            <p className='ai-bot-builder__summary'>{result.summary}</p>
                            {result.warnings.length > 0 && (
                                <div className='ai-bot-builder__warnings' role='note' data-testid='list-ai-bot-builder-warnings'>
                                    <strong>{localize('Check before loading')}</strong>
                                    <ul>
                                        {result.warnings.map((warning, index) => (
                                            <li key={`${warning}-${index}`}>{warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className='ai-bot-builder__preview' aria-label={localize('Read-only strategy preview')}>
                                <div className='ai-bot-builder__preview-label'>
                                    <span>{localize('BLOCK PREVIEW')}</span>
                                    <span>{localize('Read only')}</span>
                                </div>
                                <div className='ai-bot-builder__preview-content'>{renderPreview(result.xml)}</div>
                            </div>

                            {isConfirming ? (
                                <div className='ai-bot-builder__confirm' role='alertdialog' aria-labelledby='ai-bot-builder-confirm-title'>
                                    <h4 id='ai-bot-builder-confirm-title'>{localize('Replace your current workspace?')}</h4>
                                    <p>
                                        {localize(
                                            'Loading this strategy will replace the blocks in your current workspace. It will not start the bot.',
                                        )}
                                    </p>
                                    {loadError && (
                                        <p className='ai-bot-builder__validation' role='alert' data-testid='status-ai-bot-builder-load-error'>
                                            {loadError}
                                        </p>
                                    )}
                                    <div className='ai-bot-builder__confirm-actions'>
                                        <button
                                            type='button'
                                            className='ai-bot-builder__secondary'
                                            onClick={() => setIsConfirming(false)}
                                            disabled={isLoadingWorkspace}
                                            data-testid='button-cancel-load-ai-strategy'
                                        >
                                            {localize('Keep current blocks')}
                                        </button>
                                        <button
                                            type='button'
                                            className='ai-bot-builder__load'
                                            onClick={handleLoad}
                                            disabled={isLoadingWorkspace}
                                            data-testid='button-confirm-load-ai-strategy'
                                        >
                                            {isLoadingWorkspace ? localize('Loading…') : localize('Replace workspace')}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type='button'
                                    className='ai-bot-builder__load'
                                    onClick={() => {
                                        setLoadError('');
                                        setIsConfirming(true);
                                    }}
                                    data-testid='button-load-ai-strategy'
                                >
                                    {localize('Load into workspace')}
                                </button>
                            )}
                        </div>
                    )}
                </section>
            )}

            <button
                type='button'
                className={`ai-bot-builder__launcher${isOpen ? ' ai-bot-builder__launcher--open' : ''}`}
                onClick={() => (isOpen ? handleClose() : setIsOpen(true))}
                aria-expanded={isOpen}
                aria-controls='ai-bot-builder-panel'
                data-testid='button-open-ai-bot-builder'
            >
                <Sparkles />
                <span>{localize('AI Bot Builder')}</span>
                {isOpen && <span className='ai-bot-builder__launcher-close'><CloseIcon /></span>}
            </button>
        </div>
    );
}

export default AiBotBuilder;

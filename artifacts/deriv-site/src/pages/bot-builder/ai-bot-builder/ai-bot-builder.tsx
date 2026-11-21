import {
    useEffect,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from 'react';
import { localize } from '@deriv-com/translations';
import { useGenerateOpenaiBotStrategy } from '@workspace/api-client-react';
import {
    AI_BOT_BUILDER_HISTORY_STORAGE_PREFIX,
    AI_BOT_BUILDER_LAUNCHER_STORAGE_KEY,
} from './storage';
import { getBotBuilderBlockCatalog, validateGeneratedBotXml } from './blockly-preview';
import './ai-bot-builder.scss';

type StrategyResult = {
    title: string;
    summary: string;
    xml: string;
    blockCount: number;
    warnings: string[];
};

type SavedStrategy = StrategyResult & {
    id: string;
    prompt: string;
    savedAt: number;
};

type AiBotBuilderProps = {
    onLoad: (xml: string) => void | Promise<void>;
    renderPreview: (xml: string) => ReactNode;
    accountId?: string;
};

const MIN_PROMPT_LENGTH = 12;
const MAX_PROMPT_LENGTH = 1400;
const MAX_HISTORY_ITEMS = 20;
type BuildStage = 'checking' | 'building' | 'validating';

const getSavedStrategies = (storageKey: string): SavedStrategy[] => {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (item): item is SavedStrategy =>
                item &&
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                typeof item.title === 'string' &&
                typeof item.summary === 'string' &&
                typeof item.prompt === 'string' &&
                typeof item.xml === 'string' &&
                item.xml.length <= 60000 &&
                typeof item.blockCount === 'number' &&
                typeof item.savedAt === 'number' &&
                Array.isArray(item.warnings) &&
                item.warnings.every((warning: unknown) => typeof warning === 'string'),
        ).slice(0, MAX_HISTORY_ITEMS);
    } catch {
        return [];
    }
};

const getLauncherPosition = (): { left: number; bottom: number } | null => {
    try {
        const parsed = JSON.parse(localStorage.getItem(AI_BOT_BUILDER_LAUNCHER_STORAGE_KEY) || 'null');
        return parsed &&
            typeof parsed.left === 'number' &&
            typeof parsed.bottom === 'number'
            ? parsed
            : null;
    } catch {
        return null;
    }
};

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

const MoveIcon = () => (
    <svg aria-hidden='true' viewBox='0 0 24 24' fill='currentColor'>
        <circle cx='8' cy='6' r='1.5' />
        <circle cx='16' cy='6' r='1.5' />
        <circle cx='8' cy='12' r='1.5' />
        <circle cx='16' cy='12' r='1.5' />
        <circle cx='8' cy='18' r='1.5' />
        <circle cx='16' cy='18' r='1.5' />
    </svg>
);

const getErrorMessage = (error: unknown) => {
    if (error && typeof error === 'object') {
        const responseError = error as { error?: string; message?: string; data?: { error?: string } };
        return responseError.data?.error || responseError.error || responseError.message;
    }
    return undefined;
};

export function AiBotBuilder({ onLoad, renderPreview, accountId = '' }: AiBotBuilderProps) {
    const historyStorageKey = `${AI_BOT_BUILDER_HISTORY_STORAGE_PREFIX}:${accountId || 'guest'}`;
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [result, setResult] = useState<StrategyResult | null>(null);
    const [history, setHistory] = useState<SavedStrategy[]>([]);
    const [loadedHistoryStorageKey, setLoadedHistoryStorageKey] = useState(historyStorageKey);
    const [editingBase, setEditingBase] = useState<SavedStrategy | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [resultVerified, setResultVerified] = useState(false);
    const [launcherPosition, setLauncherPosition] = useState<{ left: number; bottom: number } | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [requestError, setRequestError] = useState('');
    const [buildStage, setBuildStage] = useState<BuildStage | null>(null);
    const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
    const generateStrategy = useGenerateOpenaiBotStrategy();
    const historyStorageKeyRef = useRef(historyStorageKey);
    historyStorageKeyRef.current = historyStorageKey;
    const launcherNearTop =
        Boolean(launcherPosition) &&
        typeof window !== 'undefined' &&
        launcherPosition!.bottom > window.innerHeight / 2;
    const panelPositionStyle = launcherPosition
        ? launcherNearTop
            ? {
                  left: `${launcherPosition.left}px`,
                  top: `${window.innerHeight - launcherPosition.bottom + 62}px`,
                  bottom: 'auto',
              }
            : {
                  left: `${launcherPosition.left}px`,
                  bottom: `${launcherPosition.bottom + 62}px`,
                  top: 'auto',
              }
        : undefined;
    const dragState = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        startLeft: number;
        startBottom: number;
        moved: boolean;
    } | null>(null);

    useEffect(() => {
        setHistory(getSavedStrategies(historyStorageKey));
        setLoadedHistoryStorageKey(historyStorageKey);
        setPrompt('');
        setResult(null);
        setEditingBase(null);
        setResultVerified(false);
        setShowHistory(false);
    }, [historyStorageKey]);

    const visibleHistory = loadedHistoryStorageKey === historyStorageKey ? history : [];

    useEffect(() => {
        const savedPosition = getLauncherPosition();
        if (!savedPosition) return;
        setLauncherPosition({
            left: Math.max(8, Math.min(window.innerWidth - 240, savedPosition.left)),
            bottom: Math.max(
                window.innerWidth < 768 ? 118 : 12,
                Math.min(window.innerHeight - 86, savedPosition.bottom),
            ),
        });
    }, []);

    useEffect(() => {
        const clampLauncherToViewport = () => {
            setLauncherPosition(current =>
                current
                    ? {
                          left: Math.max(8, Math.min(window.innerWidth - 240, current.left)),
                          bottom: Math.max(
                              window.innerWidth < 768 ? 118 : 12,
                              Math.min(window.innerHeight - 86, current.bottom),
                          ),
                      }
                    : null
            );
        };
        window.addEventListener('resize', clampLauncherToViewport);
        return () => window.removeEventListener('resize', clampLauncherToViewport);
    }, []);

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
        setRequestError('');
        setResultVerified(false);
        setBuildStage('checking');
        try {
            const requestStorageKey = historyStorageKey;
            const blockCatalog = getBotBuilderBlockCatalog();
            setBuildStage('building');
            const generated = await generateStrategy.mutateAsync({
                data: {
                    prompt: trimmedPrompt,
                    ...(editingBase ? { existingXml: editingBase.xml } : {}),
                    blockCatalog,
                },
            });
            if (historyStorageKeyRef.current !== requestStorageKey) return;
            setBuildStage('validating');
            validateGeneratedBotXml(generated.xml, { verifyWorkspace: true });
            setResultVerified(true);
            setResult(generated);
            const saved: SavedStrategy = {
                ...generated,
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                prompt: trimmedPrompt,
                savedAt: Date.now(),
            };
            setHistory(previous => {
                const next = [saved, ...previous].slice(0, MAX_HISTORY_ITEMS);
                try {
                    localStorage.setItem(historyStorageKey, JSON.stringify(next));
                } catch {
                    // Keep the generated strategy usable even if browser storage is full.
                }
                return next;
            });
            setEditingBase(saved);
        } catch (error) {
            setRequestError(
                getErrorMessage(error) ||
                    localize('The generated blocks did not pass workspace verification. Your current bot was not changed.'),
            );
        } finally {
            setBuildStage(null);
        }
    };

    const handleLoad = async () => {
        if (!result) return;
        setIsLoadingWorkspace(true);
        setLoadError('');
        try {
            await onLoad(result.xml);
            setResultVerified(true);
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

    const startLauncherDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const bounds = event.currentTarget.closest('.ai-bot-builder__launcher-group')?.getBoundingClientRect();
        if (!bounds) return;
        dragState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: launcherPosition?.left ?? bounds.left,
            startBottom: launcherPosition?.bottom ?? window.innerHeight - bounds.bottom,
            moved: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const moveLauncher = (event: ReactPointerEvent<HTMLButtonElement>, save: boolean) => {
        const drag = dragState.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true;
        const position = {
            left: Math.max(8, Math.min(window.innerWidth - 240, drag.startLeft + deltaX)),
            bottom: Math.max(
                window.innerWidth < 768 ? 118 : 12,
                Math.min(window.innerHeight - 86, drag.startBottom - deltaY),
            ),
        };
        setLauncherPosition(position);
        if (save && drag.moved) {
            try {
                localStorage.setItem(AI_BOT_BUILDER_LAUNCHER_STORAGE_KEY, JSON.stringify(position));
            } catch {
                // Repositioning still works for the current session if storage is unavailable.
            }
        }
        if (save) dragState.current = null;
    };

    const moveLauncherWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        const offsets: Record<string, { x: number; y: number }> = {
            ArrowUp: { x: 0, y: 20 },
            ArrowDown: { x: 0, y: -20 },
            ArrowLeft: { x: -20, y: 0 },
            ArrowRight: { x: 20, y: 0 },
        };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const group = event.currentTarget.closest('.ai-bot-builder__launcher-group')?.getBoundingClientRect();
        const current = launcherPosition || {
            left: group?.left ?? 14,
            bottom: group ? window.innerHeight - group.bottom : 118,
        };
        const position = {
            left: Math.max(8, Math.min(window.innerWidth - 240, current.left + offset.x)),
            bottom: Math.max(
                window.innerWidth < 768 ? 118 : 12,
                Math.min(window.innerHeight - 86, current.bottom + offset.y),
            ),
        };
        setLauncherPosition(position);
        try {
            localStorage.setItem(AI_BOT_BUILDER_LAUNCHER_STORAGE_KEY, JSON.stringify(position));
        } catch {
            // Keyboard positioning remains available for this session.
        }
    };

    const openSavedStrategy = (strategy: SavedStrategy, refine: boolean) => {
        setResult(strategy);
        setResultVerified(false);
        setEditingBase(refine ? strategy : null);
        setPrompt(refine ? '' : strategy.prompt);
        setShowHistory(false);
        setIsConfirming(false);
        setLoadError('');
    };

    return (
        <div className='ai-bot-builder' data-testid='ai-bot-builder'>
            {isOpen && (
                <section
                    id='ai-bot-builder-panel'
                    className={`ai-bot-builder__panel${launcherNearTop ? ' ai-bot-builder__panel--below-launcher' : ''}`}
                    style={panelPositionStyle}
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
                        {localize('Describe a strategy, refine a saved bot, and review every block before loading it.')}
                    </p>

                    <div className='ai-bot-builder__history-toolbar'>
                        <button
                            type='button'
                            className={`ai-bot-builder__history-toggle${showHistory ? ' ai-bot-builder__history-toggle--active' : ''}`}
                            onClick={() => setShowHistory(value => !value)}
                            aria-expanded={showHistory}
                            data-testid='button-toggle-ai-bot-history'
                        >
                            {localize('Bot history')}
                            <span>{visibleHistory.length}</span>
                        </button>
                        {editingBase && (
                            <button
                                type='button'
                                className='ai-bot-builder__new'
                                onClick={() => {
                                    setEditingBase(null);
                                    setResult(null);
                                    setPrompt('');
                                    setShowHistory(false);
                                }}
                                data-testid='button-new-ai-strategy'
                            >
                                {localize('New strategy')}
                            </button>
                        )}
                    </div>

                    {showHistory && (
                        <section
                            className='ai-bot-builder__history'
                            aria-label={localize('Saved bot strategies')}
                            data-testid='list-ai-bot-history'
                        >
                            {visibleHistory.length === 0 ? (
                                <p className='ai-bot-builder__history-empty'>
                                    {localize('Generated strategies will appear here and stay on this account in this browser.')}
                                </p>
                            ) : (
                                visibleHistory.map(strategy => (
                                    <article className='ai-bot-builder__history-item' key={strategy.id}>
                                        <div className='ai-bot-builder__history-copy'>
                                            <h3>{strategy.title}</h3>
                                            <p>{new Date(strategy.savedAt).toLocaleDateString()}</p>
                                        </div>
                                        <div className='ai-bot-builder__history-actions'>
                                            <button
                                                type='button'
                                                onClick={() => openSavedStrategy(strategy, false)}
                                                data-testid={`button-open-history-${strategy.id}`}
                                            >
                                                {localize('Review')}
                                            </button>
                                            <button
                                                type='button'
                                                onClick={() => openSavedStrategy(strategy, true)}
                                                data-testid={`button-refine-history-${strategy.id}`}
                                            >
                                                {localize('Refine')}
                                            </button>
                                        </div>
                                    </article>
                                ))
                            )}
                        </section>
                    )}

                    {!showHistory && <form className='ai-bot-builder__form' onSubmit={handleSubmit}>
                        {editingBase && (
                            <div className='ai-bot-builder__refining' data-testid='text-ai-bot-builder-refining'>
                                <span>{localize('Refining')}</span>
                                <strong>{editingBase.title}</strong>
                            </div>
                        )}
                        <label htmlFor='ai-bot-builder-prompt'>{localize('What should your bot do?')}</label>
                        <textarea
                            id='ai-bot-builder-prompt'
                            value={prompt}
                            onChange={event => setPrompt(event.target.value.slice(0, MAX_PROMPT_LENGTH))}
                            placeholder={localize(
                                'Example: Over 4 when the last 4 digits are below 4; Under 5 when the last 3 digits are over 5.',
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

                        {(requestError || generateStrategy.isError) && (
                            <div className='ai-bot-builder__error' role='alert' data-testid='status-ai-bot-builder-error'>
                                <strong>{localize('Strategy not generated')}</strong>
                                <span>
                                    {requestError ||
                                        getErrorMessage(generateStrategy.error) ||
                                        localize('Something went wrong. Check your connection and try again.')}
                                </span>
                            </div>
                        )}

                        <button
                            type='submit'
                            className='ai-bot-builder__generate'
                            disabled={
                                generateStrategy.isPending || buildStage !== null ||
                                trimmedPrompt.length < MIN_PROMPT_LENGTH ||
                                trimmedPrompt.length > MAX_PROMPT_LENGTH
                            }
                            data-testid='button-generate-ai-strategy'
                        >
                            {generateStrategy.isPending || buildStage !== null ? (
                                <>
                                    <span className='ai-bot-builder__progress' aria-hidden='true' />
                                    {buildStage === 'checking'
                                        ? localize('Checking available blocks…')
                                        : buildStage === 'validating'
                                          ? localize('Verifying blocks and connections…')
                                          : localize('Building from registered blocks…')}
                                </>
                            ) : (
                                <>
                                    <Sparkles />
                                    {editingBase ? localize('Refine strategy') : localize('Generate strategy')}
                                </>
                            )}
                        </button>
                        <p className='ai-bot-builder__credits' data-testid='text-ai-bot-builder-credits'>
                            {localize('Uses Replit AI credits. Up to 20 strategies are saved locally for this account.')}
                        </p>
                    </form>}

                    {(generateStrategy.isPending || buildStage !== null) && (
                        <div className='ai-bot-builder__loading' role='status' aria-live='polite' data-testid='status-ai-bot-builder-loading'>
                            <span className='ai-bot-builder__skeleton ai-bot-builder__skeleton--title' />
                            <span className='ai-bot-builder__skeleton' />
                            <span className='ai-bot-builder__skeleton ai-bot-builder__skeleton--short' />
                            <span className='ai-bot-builder__loading-label'>
                                {buildStage === 'checking'
                                    ? localize('Checking the active toolbox and its real block definitions…')
                                    : buildStage === 'validating'
                                      ? localize('Importing every block into a test workspace and checking its connections…')
                                      : localize('Building your strategy from verified, registered blocks…')}
                            </span>
                        </div>
                    )}

                    {result && !showHistory && !generateStrategy.isPending && (
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
                            <p className='ai-bot-builder__verified' role='status' data-testid='status-ai-bot-builder-verified'>
                                {resultVerified
                                    ? localize('Verification complete: every block imported and its connections passed. Review the strategy before loading.')
                                    : localize('Saved strategy: it will be checked against the current block library before replacing your workspace.')}
                            </p>
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

            <div
                className='ai-bot-builder__launcher-group'
                style={launcherPosition ? { left: `${launcherPosition.left}px`, bottom: `${launcherPosition.bottom}px` } : undefined}
            >
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
                <button
                    type='button'
                    className='ai-bot-builder__launcher-grip'
                    aria-label={localize('Move AI Bot Builder')}
                    title={localize('Drag to move')}
                    onKeyDown={moveLauncherWithKeyboard}
                    onPointerDown={startLauncherDrag}
                    onPointerMove={event => moveLauncher(event, false)}
                    onPointerUp={event => moveLauncher(event, true)}
                    onPointerCancel={event => moveLauncher(event, true)}
                    data-testid='button-move-ai-bot-builder'
                >
                    <MoveIcon />
                </button>
            </div>
        </div>
    );
}

export default AiBotBuilder;

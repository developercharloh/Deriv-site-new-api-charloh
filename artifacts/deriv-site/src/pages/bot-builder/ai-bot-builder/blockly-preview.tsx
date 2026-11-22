import { useEffect, useRef, useState } from 'react';
import { localize } from '@deriv-com/translations';

type BlocklyApi = {
    Blocks: Record<string, unknown>;
    Themes?: Record<string, unknown>;
  Events?: {
      disable?: () => void;
      enable?: () => void;
  };
  derivWorkspace?: {
      options?: {
          languageTree?: Element;
      };
  };
    inject: (container: HTMLElement, options: Record<string, unknown>) => any;
    Xml: {
        domToWorkspace: (xml: Element | Document, workspace: any) => unknown;
    domToText?: (xml: Element | Document) => string;
    };
    utils: {
        xml: {
            textToDom: (xml: string) => Element;
        };
    };
    svgResize?: (workspace: any) => void;
};

const REQUIRED_TOP_LEVEL_BLOCKS = ['trade_definition', 'before_purchase', 'after_purchase'];
const MAX_BLOCKS = 250;
const BLOCK_CATALOG_CATEGORIES = new Set([
    'analysis_logics',
    'binary_matrix_ai',
    'trade_parameters',
    'purchase_conditions',
    'sell_conditions',
    'trade_results',
    'indicators',
    'tick_analysis',
    'contract_details',
    'stats',
    'notifications',
    'time',
    'math',
    'text',
    'logic',
    'strategy_controls',
    'virtual_hook_switcher',
    'custom_notification',
    'binarytools',
    'contract_modifiers',
    'barrier_settings',
    'edging_bots',
]);
const MAX_BLOCK_CATALOG_LENGTH = 75000;

type ValidateOptions = {
    verifyWorkspace?: boolean;
};

function getBlockNodes(root: Element): Element[] {
    return Array.from(root.getElementsByTagName('*')).filter(node =>
        node.localName === 'block' || node.localName === 'shadow'
    );
}

function isOverriddenShadow(node: Element): boolean {
    if (node.localName !== 'shadow') return false;
    const input = node.parentElement;
    return Boolean(
        input &&
            (input.localName === 'value' || input.localName === 'statement') &&
            Array.from(input.children).some(child => child.localName === 'block')
    );
}

function getImportableBlockNodes(root: Element): Element[] {
    return getBlockNodes(root).filter(node => !isOverriddenShadow(node));
}

function verifyBlocklyWorkspaceImport(root: Element, Blockly: BlocklyApi) {
    const validationRoot = root.cloneNode(true) as Element;
    // Blockly XML can include both a shadow fallback and a real block under
    // one input. Blockly imports the real block and does not create the shadow.
    const xmlBlocks = getImportableBlockNodes(validationRoot);
    xmlBlocks.forEach((node, index) => node.setAttribute('id', `ai-builder-check-${index}`));
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
        position: 'fixed',
        left: '-10000px',
        top: '0',
        width: '1024px',
        height: '768px',
        visibility: 'hidden',
        pointerEvents: 'none',
    });
    document.body.appendChild(host);
    const activeWorkspace = Blockly.derivWorkspace;
    let workspace: any;
    let eventsDisabled = false;

    try {
        Blockly.Events?.disable?.();
        eventsDisabled = Boolean(Blockly.Events?.enable);
        workspace = Blockly.inject(host, {
            readOnly: true,
            toolbox: null,
            renderer: 'zelos',
            theme: Blockly.Themes?.zelos_renderer,
            media: `${(window as any).__webpack_public_path__ || ''}assets/media/`,
            scrollbars: false,
            trashcan: false,
            sounds: false,
            move: { scrollbars: false, drag: false, wheel: false },
            zoom: { controls: false, wheel: false, startScale: 0.65, minScale: 0.3, maxScale: 1.2 },
        });
        Blockly.Xml.domToWorkspace(validationRoot, workspace);

        const imported = workspace.getAllBlocks(false);
        if (imported.length !== xmlBlocks.length) {
            throw new Error(
                localize('Blockly could not create every block from the generated XML. Regenerate the strategy.'),
            );
        }

        for (const node of xmlBlocks) {
            const type = node.getAttribute('type') || '';
            const block = workspace.getBlockById(node.getAttribute('id'));
            if (!block || block.type !== type) {
                throw new Error(localize('Blockly could not register one of the generated blocks.'));
            }

            for (const fieldNode of Array.from(node.children).filter(child => child.localName === 'field')) {
                const fieldName = fieldNode.getAttribute('name') || '';
                if (!fieldName || !block.getField(fieldName)) {
                    throw new Error(localize(`Block "${type}" does not support its "${fieldName}" field.`));
                }
            }

            for (const inputNode of Array.from(node.children).filter(
                child => child.localName === 'value' || child.localName === 'statement',
            )) {
                const inputName = inputNode.getAttribute('name') || '';
                const input = inputName && block.getInput(inputName);
                if (!input) {
                    throw new Error(localize(`Block "${type}" does not support its "${inputName}" input.`));
                }
                const hasChildBlock = Array.from(inputNode.children).some(
                    child => child.localName === 'block' || child.localName === 'shadow',
                );
                if (hasChildBlock && !block.getInputTargetBlock(inputName)) {
                    throw new Error(
                        localize(`A block could not connect to "${inputName}" on "${type}". Regenerate the strategy.`),
                    );
                }
            }

            const nextNode = Array.from(node.children).find(child => child.localName === 'next');
            const hasNextBlock = Boolean(
                nextNode &&
                    Array.from(nextNode.children).some(
                        child => child.localName === 'block' || child.localName === 'shadow',
                    ),
            );
            if (hasNextBlock && !block.getNextBlock()) {
                throw new Error(localize(`A following block could not connect to "${type}". Regenerate the strategy.`));
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message) throw error;
        throw new Error(localize('Blockly could not validate this strategy. Regenerate it before loading.'));
    } finally {
        if (eventsDisabled) Blockly.Events?.enable?.();
        workspace?.dispose?.();
        if (Blockly.derivWorkspace !== activeWorkspace) Blockly.derivWorkspace = activeWorkspace;
        host.remove();
    }
}

export function validateGeneratedBotXml(xml: string, options: ValidateOptions = {}): Element {
    if (xml.length > 60000 || /<!DOCTYPE|<!ENTITY|<script\b/i.test(xml)) {
        throw new Error(localize('The generated Blockly document is not allowed.'));
    }

    const Blockly = window.Blockly as unknown as BlocklyApi;
    if (!Blockly?.Blocks) {
        throw new Error(localize('Blockly is still loading. Try again in a moment.'));
    }

    let root: Element;
    try {
        root = Blockly.utils.xml.textToDom(xml);
    } catch {
        throw new Error(localize('The generated strategy is not valid Blockly XML.'));
    }

    if (root.localName !== 'xml' || root.getAttribute('is_dbot') !== 'true') {
        throw new Error(localize('The generated strategy is not valid Blockly XML.'));
    }

    const allBlockNodes = getBlockNodes(root);
    if (allBlockNodes.length < 4 || allBlockNodes.length > MAX_BLOCKS) {
        throw new Error(localize('The generated strategy has an invalid number of blocks.'));
    }

    const blockTypes = allBlockNodes.map(node => node.getAttribute('type') || '');
    const missingTypes = [...new Set(blockTypes.filter(type => !type || !Blockly.Blocks[type]))];
    if (missingTypes.length > 0) {
        throw new Error(
            localize('This strategy uses Blockly blocks that are not available in this workspace. Generate it again with simpler rules.'),
        );
    }

    const topLevelTypes = Array.from(root.children)
        .filter(node => node.localName === 'block')
        .map(node => node.getAttribute('type'));
    const hasRequiredRoots = REQUIRED_TOP_LEVEL_BLOCKS.every(
        type => topLevelTypes.filter(rootType => rootType === type).length === 1,
    );
    const hasPurchase = blockTypes.some(type =>
        ['purchase', 'apollo_purchase', 'apollo_purchase2'].includes(type)
    );

    if (!hasRequiredRoots || !hasPurchase) {
        throw new Error(localize('The strategy is missing a required trade, purchase, or settlement section.'));
    }

    if (options.verifyWorkspace) verifyBlocklyWorkspaceImport(root, Blockly);

    return root;
}

export function getBotBuilderBlockCatalog(): string {
    const Blockly = window.Blockly as unknown as BlocklyApi;
    const toolbox = Blockly?.derivWorkspace?.options?.languageTree;
    if (!toolbox || !Blockly.Xml.domToText) {
        throw new Error(localize('The Bot Builder block toolbox is not ready yet. Open the builder and try again.'));
    }

    const candidates = new Map<string, { categoryId: string; node: Element; score: number }>();
    for (const category of Array.from(toolbox.getElementsByTagName('*')).filter(
        node => node.localName === 'category' && BLOCK_CATALOG_CATEGORIES.has(node.getAttribute('id') || ''),
    )) {
        const categoryId = category.getAttribute('id') || '';
        for (const node of Array.from(category.children).filter(child => child.localName === 'block')) {
            const type = node.getAttribute('type') || '';
            if (!type || !Blockly.Blocks[type]) continue;
            const score = node.getElementsByTagName('*').length;
            const previous = candidates.get(type);
            if (!previous || score > previous.score) {
                candidates.set(type, { categoryId, node, score });
            }
        }
    }

    if (candidates.size === 0) {
        throw new Error(localize('No usable Blockly blocks were found in the active toolbox.'));
    }

    const root = document.createElement('xml');
    root.setAttribute('xmlns', 'https://developers.google.com/blockly/xml');
    const categories = new Map<string, Element>();
    for (const { categoryId, node } of candidates.values()) {
        let category = categories.get(categoryId);
        if (!category) {
            category = document.createElement('category');
            category.setAttribute('id', categoryId);
            categories.set(categoryId, category);
            root.appendChild(category);
        }
        category.appendChild(node.cloneNode(true));
    }

    const catalog = Blockly.Xml.domToText(root);
    if (catalog.length > MAX_BLOCK_CATALOG_LENGTH) {
        throw new Error(localize('The available block catalog is too large to verify safely.'));
    }
    return catalog;
}

export function BlocklyPreview({ xml }: { xml: string }) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const host = hostRef.current;
        const Blockly = window.Blockly as unknown as BlocklyApi;
        if (!host || !Blockly) return undefined;

        let workspace: any;
        let disposed = false;
        try {
            const document = validateGeneratedBotXml(xml);
            const activeWorkspace = Blockly.derivWorkspace;
            workspace = Blockly.inject(host, {
                readOnly: true,
                toolbox: null,
                renderer: 'zelos',
                theme: Blockly.Themes?.zelos_renderer,
                media: `${(window as any).__webpack_public_path__ || ''}assets/media/`,
                scrollbars: true,
                trashcan: false,
                sounds: false,
                move: { scrollbars: true, drag: false, wheel: false },
                zoom: { controls: false, wheel: false, startScale: 0.65, minScale: 0.3, maxScale: 1.2 },
            });
            Blockly.Xml.domToWorkspace(document, workspace);
            if (activeWorkspace && Blockly.derivWorkspace !== activeWorkspace) {
                Blockly.derivWorkspace = activeWorkspace;
            }
            workspace.scrollbar?.setY?.(0);
            setError('');
            requestAnimationFrame(() => {
                if (!disposed) Blockly.svgResize?.(workspace);
            });
        } catch {
            workspace?.dispose?.();
            setError(localize('A visual preview is unavailable for this result. Review the strategy details before loading.'));
        }

        return () => {
            disposed = true;
            workspace?.dispose?.();
        };
    }, [xml]);

    return (
        <div className='ai-bot-builder__workspace-preview'>
            {error ? (
                <p className='ai-bot-builder__preview-error' role='status' data-testid='status-ai-bot-builder-preview-error'>
                    {error}
                </p>
            ) : (
                <div
                    ref={hostRef}
                    className='ai-bot-builder__workspace-preview-host'
                    aria-label={localize('Generated Blockly blocks, read only')}
                    data-testid='preview-ai-bot-builder-workspace'
                />
            )}
        </div>
    );
}

export default BlocklyPreview;

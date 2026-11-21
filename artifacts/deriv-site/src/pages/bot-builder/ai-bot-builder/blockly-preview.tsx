import { useEffect, useRef, useState } from 'react';
import { localize } from '@deriv-com/translations';

type BlocklyApi = {
    Blocks: Record<string, unknown>;
    Themes?: Record<string, unknown>;
    derivWorkspace?: unknown;
    inject: (container: HTMLElement, options: Record<string, unknown>) => any;
    Xml: {
        domToWorkspace: (xml: Element | Document, workspace: any) => unknown;
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

export function validateGeneratedBotXml(xml: string): Element {
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

    const allBlockNodes = [
        ...Array.from(root.getElementsByTagName('block')),
        ...Array.from(root.getElementsByTagName('shadow')),
    ];
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
    const hasPurchase = blockTypes.includes('purchase');

    if (!hasRequiredRoots || !hasPurchase) {
        throw new Error(localize('The strategy is missing a required trade, purchase, or settlement section.'));
    }

    return root;
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

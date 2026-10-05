import { config } from '../constants/config';

const PURCHASE_BLOCK_TYPES = [
    'purchase',
    'apollo_purchase2',
    'smart_over2_recovery_purchase',
    'smart_over2_v3_purchase',
];

export const isPurchaseBlockType = blockType => PURCHASE_BLOCK_TYPES.includes(blockType);

export const isMobileBlocklyViewport = (deviceIsMobile, viewportWidth) =>
    Boolean(deviceIsMobile) || viewportWidth < 768;

export const hasPurchaseBlock = blocks =>
    Array.isArray(blocks) && blocks.some(block => isPurchaseBlockType(block?.type));

export const getMissingRequiredBlocks = (blocks, requiredBlockTypes) =>
    requiredBlockTypes.filter(blockType => {
        if (blockType === 'purchase') {
            return !hasPurchaseBlock(blocks);
        }
        return !blocks.some(block => block.type === blockType);
    });

export const hasAllRequiredBlocks = () => {
    const blocks_in_workspace = window.Blockly.derivWorkspace.getAllBlocks();
    const { mandatoryMainBlocks } = config();
    const required_block_types = ['trade_definition_tradeoptions', ...mandatoryMainBlocks];
    return getMissingRequiredBlocks(blocks_in_workspace, required_block_types).length === 0;
};

export const onWorkspaceResize = () => {
    const workspace = window.Blockly.derivWorkspace;
    if (workspace) {
        // kept this commented to fix slow rendering issue
        //workspace.getAllFields().forEach(field => field.forceRerender());

        const el_scratch_div = document.getElementById('scratch_div');
        if (el_scratch_div) {
            window.Blockly.svgResize(workspace);
        }
    }
};

export const removeLimitedBlocks = (workspace, block_types) => {
    const types = Array.isArray(block_types) ? block_types : [block_types];

    types.forEach(block_type => {
        if (config().single_instance_blocks.includes(block_type)) {
            workspace.getAllBlocks().forEach(ws_block => {
                if (ws_block.type === block_type) {
                    ws_block.dispose();
                }
            });
        }
    });
};

export const isDbotRTL = () => {
    const htmlElement = document.documentElement;
    const dirValue = htmlElement.getAttribute('dir');
    return dirValue === 'rtl';
};

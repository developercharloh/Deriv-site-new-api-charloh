export const centerWorkspaceRoot = (workspace, rootType) => {
    if (!workspace || !rootType) return false;

    const topBlocks = workspace.getTopBlocks?.(true) ?? [];
    const rootBlock = topBlocks.find(block => block.type === rootType);
    if (!rootBlock || typeof workspace.centerOnBlock !== 'function') return false;

    workspace.centerOnBlock(rootBlock.id, true);
    return true;
};

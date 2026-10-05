export const centerWorkspaceRoot = (workspace, rootType) => {
    if (!workspace || !rootType) return false;

    const topBlocks = workspace.getTopBlocks?.(true) ?? [];
    const rootBlock = topBlocks.find(block => block.type === rootType);
    if (!rootBlock || typeof workspace.centerOnBlock !== 'function') return false;

    workspace.centerOnBlock(rootBlock.id, true);
    return true;
};

const normalizeMobileWorkspaceOrigin = workspace => {
    const topBlocks = workspace?.getTopBlocks?.(true) ?? [];
    if (!topBlocks.length || window.innerWidth >= 768) return;

    const positions = topBlocks
        .map(block => block.getRelativeToSurfaceXY?.())
        .filter(position => position && Number.isFinite(position.x) && Number.isFinite(position.y));
    if (!positions.length) return;

    const minX = Math.min(...positions.map(position => position.x));
    const minY = Math.min(...positions.map(position => position.y));
    const deltaX = 24 - minX;
    const deltaY = 24 - minY;

    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
    topBlocks.forEach(block => block.moveBy?.(deltaX, deltaY));
};

export const revealWorkspaceFromTop = (workspace, focusRootType) => {
    if (!workspace || !workspace.getTopBlocks?.(true).length) return;

    const isMobileViewport = window.innerWidth < 768;
    if (isMobileViewport) normalizeMobileWorkspaceOrigin(workspace);

    window.Blockly?.svgResize?.(workspace);
    workspace.scrollbar?.resize?.();
    workspace.scroll?.(0, 0);

    // Centering a tall strategy root can move the mobile canvas far below its
    // first visible blocks. Mobile should start at the normalized root origin.
    if (focusRootType && !isMobileViewport) centerWorkspaceRoot(workspace, focusRootType);
};

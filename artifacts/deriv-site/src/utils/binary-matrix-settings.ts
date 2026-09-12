type BlocklyWorkspaceLike = {
    getAllBlocks: (deep: boolean) => Array<any>;
    getVariableById?: (id: string) => { name?: string } | null;
    getVariableMap?: () => { getVariableById?: (id: string) => { name?: string } | null } | null;
};

export const readBlocklyNumberVariable = (
    workspace: BlocklyWorkspaceLike,
    name: string,
    fallback: number
): number => {
    const setter = workspace.getAllBlocks(true).find(block => {
        if (block.type !== 'variables_set') return false;

        const variableId = block.getFieldValue?.('VAR');
        const variableModel = workspace.getVariableById?.(variableId)
            ?? workspace.getVariableMap?.()?.getVariableById?.(variableId);
        const variableName = variableModel?.name
            ?? block.getField?.('VAR')?.getText?.()
            ?? block.getField?.('VAR')?.getValue?.();

        return variableName === name;
    });

    const valueBlock = setter?.getInputTargetBlock?.('VALUE')
        ?? setter?.getChildren?.().find((child: any) =>
            ['math_number', 'math_number_positive'].includes(child.type)
        );
    const value = Number(valueBlock?.getFieldValue?.('NUM'));

    return Number.isFinite(value) ? value : fallback;
};
type BlocklyWorkspaceReadiness = {
    workspace: unknown;
    hasSvg: boolean;
    isLoading: boolean;
};

export const isBotBuilderWorkspaceReady = ({
    workspace,
    hasSvg,
    isLoading,
}: BlocklyWorkspaceReadiness): boolean => Boolean(workspace && hasSvg && !isLoading);

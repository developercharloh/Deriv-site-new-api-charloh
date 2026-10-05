import { isBotBuilderWorkspaceReady } from '../workspace-readiness';

describe('Bot Builder workspace readiness', () => {
    it('does not mistake an injected SVG for a ready workspace while DBot is still restoring', () => {
        expect(
            isBotBuilderWorkspaceReady({
                workspace: {},
                hasSvg: true,
                isLoading: true,
            })
        ).toBe(false);
    });

    it('waits for both the Blockly workspace and its SVG mount', () => {
        expect(
            isBotBuilderWorkspaceReady({
                workspace: null,
                hasSvg: true,
                isLoading: false,
            })
        ).toBe(false);
        expect(
            isBotBuilderWorkspaceReady({
                workspace: {},
                hasSvg: false,
                isLoading: false,
            })
        ).toBe(false);
    });

    it('is ready only after the initial Blockly restore finishes', () => {
        expect(
            isBotBuilderWorkspaceReady({
                workspace: {},
                hasSvg: true,
                isLoading: false,
            })
        ).toBe(true);
    });
});

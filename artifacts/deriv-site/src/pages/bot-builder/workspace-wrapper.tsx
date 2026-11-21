import React from 'react';
import { observer } from 'mobx-react-lite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Flyout from '@/components/flyout';
import { load } from '@/external/bot-skeleton/scratch/utils';
import { useStore } from '@/hooks/useStore';
import StopBotModal from '../dashboard/stop-bot-modal';
import AiBotBuilder from './ai-bot-builder/ai-bot-builder';
import { BlocklyPreview, validateGeneratedBotXml } from './ai-bot-builder/blockly-preview';
import Toolbar from './toolbar';
import Toolbox from './toolbox';
import './workspace.scss';

const ai_bot_builder_query_client = new QueryClient();

const WorkspaceWrapper = observer(() => {
    const { blockly_store, client, run_panel, toolbar } = useStore();
    const { onMount, onUnmount, is_loading } = blockly_store;

    React.useEffect(() => {
        onMount();
        return () => {
            onUnmount();
        };
    }, []);

    const handleLoadGeneratedBot = React.useCallback(
        async (xml: string) => {
            if (run_panel.is_running) {
                throw new Error('Stop the running bot before replacing the workspace.');
            }

            const workspace = window.Blockly?.derivWorkspace;
            if (!workspace) {
                throw new Error('The Blockly workspace is not ready.');
            }

            validateGeneratedBotXml(xml);
            toolbar.setResetButtonState(true);
            try {
                const result = await load({
                    block_string: xml,
                    file_name: 'AI Bot Builder',
                    strategy_id: null,
                    from: null,
                    drop_event: null,
                    workspace,
                    showIncompatibleStrategyDialog: null,
                    show_snackbar: false,
                });
                if (result?.error) throw new Error(result.error);
                (workspace as any).scroll?.(0, 0);
            } finally {
                toolbar.setResetButtonState(false);
            }
        },
        [run_panel.is_running, toolbar],
    );

    if (is_loading) return null;

    if (window.Blockly?.derivWorkspace)
        return (
            <React.Fragment>
                <Toolbox />
                <Toolbar />
                <Flyout />
                <StopBotModal />
                <QueryClientProvider client={ai_bot_builder_query_client}>
                    <AiBotBuilder
                        key={client.loginid || 'guest'}
                        onLoad={handleLoadGeneratedBot}
                        renderPreview={xml => <BlocklyPreview xml={xml} />}
                        accountId={client.loginid ?? ''}
                    />
                </QueryClientProvider>
            </React.Fragment>
        );

    return null;
});

export default WorkspaceWrapper;

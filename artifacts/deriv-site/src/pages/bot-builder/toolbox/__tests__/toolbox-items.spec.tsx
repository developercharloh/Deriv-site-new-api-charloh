import fs from 'node:fs';
import path from 'node:path';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
}));

describe('bot builder toolbox structure', () => {
    const toolboxSource = fs.readFileSync(path.resolve(__dirname, '../toolbox-items.tsx'), 'utf8');
    const analysisBlocksSource = fs.readFileSync(
        path.resolve(__dirname, '../../../../external/bot-skeleton/scratch/blocks/Custom/analysis_blocks.js'),
        'utf8'
    );
    const apolloBlocksSource = fs.readFileSync(
        path.resolve(__dirname, '../../../../external/bot-skeleton/scratch/blocks/Custom/apollo_blocks.js'),
        'utf8'
    );
    const edgingBlocksSource = fs.readFileSync(
        path.resolve(__dirname, '../../../../external/bot-skeleton/scratch/blocks/Custom/edging_pro_blocks.js'),
        'utf8'
    );

    it('keeps the screenshot menu order and exposes Binary Matrix AI', () => {
        const categoryIds = [...toolboxSource.matchAll(/<Category id='([^']+)'/g)].map(match => match[1]);

        expect(categoryIds.slice(0, 7)).toEqual([
            'analysis_logics',
            'binary_matrix_ai',
            'trade_parameters',
            'purchase_conditions',
            'sell_conditions',
            'trade_results',
            'analysis',
        ]);
        expect(toolboxSource).toContain("name={localize('Analysis Logics 🔥')}");
        expect(toolboxSource).toContain("name={localize('Binary Matrix AI')}");
    });

    it('uses the registered functional Binary Matrix block types', () => {
        expect(toolboxSource).toContain("type='last_digits_condition'");
        expect(toolboxSource).toContain("type='apollo_purchase2'");
        expect(toolboxSource).toContain("type='multiplier_take_profit'");
        expect(toolboxSource).toContain("type='multiplier_stop_loss'");
    });

    it('registers and exposes the legacy Apollo purchase block', () => {
        const binaryToolsSection = toolboxSource.match(/<Category id='binarytools'[\s\S]*?<\/Category>/)?.[0];

        expect(binaryToolsSection).toContain("type='apollo_purchase'");
        expect(apolloBlocksSource).toContain('window.Blockly.Blocks.apollo_purchase =');
        expect(apolloBlocksSource).toContain('javascriptGenerator.forBlock.apollo_purchase');
        expect(apolloBlocksSource).toContain("getAllBlocks?.(false)");
    });

    it('shows the Edging pro entry rule in the Purchase conditions menu', () => {
        expect(toolboxSource).toContain("<Block type='edging_pro_purchase_condition' />");
        expect(edgingBlocksSource).toContain('window.Blockly.Blocks.edging_pro_purchase_condition');
        expect(edgingBlocksSource).toContain('javascriptGenerator.forBlock.edging_pro_purchase_condition');
    });

    it('exposes the XML-backed Edging pro strategy and its editable settings', () => {
        expect(toolboxSource).toContain("id='edging_bots'");
        expect(toolboxSource).toContain("type='edging_pro_strategy'");
        expect(edgingBlocksSource).toContain('window.Blockly.Blocks.edging_pro_strategy');
        expect(edgingBlocksSource).toContain('javascriptGenerator.forBlock.edging_pro_strategy');
        [
            'LAST_X',
            'STAKE',
            'OVER_PREDICTION',
            'UNDER_PREDICTION',
            'MARTINGALE',
            'TAKE_PROFIT',
            'STOP_LOSS',
            'USE_VIRTUAL_HOOK',
            'VIRTUAL_LOSS_THRESHOLD',
        ].forEach(field => expect(edgingBlocksSource).toContain(`name: '${field}'`));
    });

    it('puts the live digit and tick analysis blocks in Analysis Logics', () => {
        const analysisLogicsSection = toolboxSource.match(/<Category id='analysis_logics'[\s\S]*?<\/Category>/)?.[0];

        expect(analysisLogicsSection).toBeDefined();
        [
            'last_digits_condition',
            'smart_over2_entry_gate',
            'digit_frequency_analysis',
            'even_odd_percentage',
            'over_under_analysis',
            'match_differ_analysis',
            'last_n_ticks_direction',
            'rise_fall_percentage',
            'adaptive_momentum_signal',
            'adaptive_session_stop',
            'tick',
            'last_digit',
            'second_last_digit',
            'nth_last_digit',
        ].forEach(type => expect(analysisLogicsSection).toContain(`type='${type}'`));
    });

    it('offers all four digit-frequency rankings', () => {
        expect(analysisBlocksSource).toContain("[localize('Most'), 'most']");
        expect(analysisBlocksSource).toContain("[localize('Second most'), 'second_most']");
        expect(analysisBlocksSource).toContain("[localize('Least'), 'least']");
        expect(analysisBlocksSource).toContain("[localize('Second least'), 'second_least']");
    });

    it('limits Virtual Hook Switcher to the three screenshot blocks', () => {
        const virtualHookSection = toolboxSource.match(/<Category id='virtual_hook_switcher'[\s\S]*?<\/Category>/)?.[0];

        expect(virtualHookSection).toBeDefined();
        expect(virtualHookSection).toContain("type='vh_settings'");
        expect(virtualHookSection).toContain("type='enable_virtual_hook'");
        expect(virtualHookSection).toContain("type='virtual_hook_status'");
        expect(virtualHookSection).not.toContain("type='variables_get'");
        expect(virtualHookSection).not.toContain("type='variables_set'");
        expect(virtualHookSection).not.toContain("type='logic_boolean'");
    });
});

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: true },
}));

jest.mock('@/utils/store-helpers', () => ({
    helpers: {},
}));

import { MessageTypes } from '@/external/bot-skeleton';
import { observer } from '@/external/bot-skeleton/utils/observer';
import RunPanelStore from '@/stores/run-panel-store';
import { BinaryMatrixEngine } from '@/utils/binary-matrix-engine';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

describe('Binary Matrix analysis observer integration', () => {
    const config = {
        symbol: 'R_25',
        currency: 'USD',
        initialStake: 0.5,
        martingale: 2,
        takeProfit: 10,
        stopLoss: 50,
        reanalyzeAfterWins: 3,
    };

    afterEach(() => {
        observer.unregisterAll('bot.analysis.condition');
        api_base.api = null;
    });

    it('advances visible analysis and appends one matching Journal row per live tick', () => {
        const journal = {
            pushMessage: jest.fn(),
        };
        const rootStore = {
            dbot: {},
            journal,
        };
        const core = {
            client: { loginid: null },
            common: { is_socket_opened: false },
            ui: {},
        };
        const runPanel = new RunPanelStore(rootStore as any, core as any);
        runPanel.onMount();

        const engine = new BinaryMatrixEngine(config) as any;
        engine.running = true;
        engine.paused = true;

        const visibleAnalyses: Array<Record<string, unknown>> = [];
        const ticks = [1, 3, 5, 7];

        ticks.forEach(digit => {
            engine.trader.onTick(`1.${digit}`, digit);
            visibleAnalyses.push({ ...runPanel.last_digits_analysis });
        });

        expect(visibleAnalyses).toEqual([
            expect.objectContaining({ digits: [1], result: false }),
            expect.objectContaining({ digits: [1, 3], result: false }),
            expect.objectContaining({ digits: [1, 3, 5], result: false }),
            expect.objectContaining({ digits: [1, 3, 5, 7], result: true }),
        ]);

        const journalRows = journal.pushMessage.mock.calls;
        expect(journalRows).toHaveLength(ticks.length);
        expect(journalRows.map(([message]) => message)).toEqual([
            expect.stringContaining('Digits: [1]'),
            expect.stringContaining('Digits: [1, 3]'),
            expect.stringContaining('Digits: [1, 3, 5]'),
            expect.stringContaining('Digits: [1, 3, 5, 7]'),
        ]);
        expect(journalRows.map(([message, messageType]) => [message, messageType])).toEqual([
            [expect.stringContaining('Result: ❌ CONDITIONS NOT MET'), MessageTypes.NOTIFY],
            [expect.stringContaining('Result: ❌ CONDITIONS NOT MET'), MessageTypes.NOTIFY],
            [expect.stringContaining('Result: ❌ CONDITIONS NOT MET'), MessageTypes.NOTIFY],
            [expect.stringContaining('Result: ✅ CONDITIONS MET'), MessageTypes.NOTIFY],
        ]);
    });
});
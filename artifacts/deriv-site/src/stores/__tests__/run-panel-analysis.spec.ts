jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: true },
}));

jest.mock('@/utils/store-helpers', () => ({
    helpers: {},
}));

import { MessageTypes } from '@/external/bot-skeleton';
import { observer } from '@/external/bot-skeleton/utils/observer';
import Ticks from '@/external/bot-skeleton/services/tradeEngine/trade/Ticks';
import JournalStore from '@/stores/journal-store';
import RunPanelStore from '@/stores/run-panel-store';
import { BinaryMatrixEngine } from '@/utils/binary-matrix-engine';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { autorun } from 'mobx';

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
        observer.unregisterAll('bot.analysis.smart_over2');
        observer.unregisterAll('bot.smart_over2.recovery');
        observer.unregisterAll('bot.volatility.scan');
        api_base.api = null;
    });

    it('updates the Edging pro Journal row with the latest digits and explicit condition status', () => {
        const journal = {
            pushMessage: jest.fn(),
            updateEdgingProAnalysisMessage: jest.fn(),
            active_bot_template_id: 'edging-pro-engine',
        };
        const runPanel = new RunPanelStore(
            { dbot: {}, journal } as any,
            {
                client: { loginid: null },
                common: { is_socket_opened: false },
                ui: {},
            } as any
        );

        runPanel.onLastDigitsAnalysis({
            market: '1HZ50V',
            condition: 'CONSECUTIVE_DIGITS_BETWEEN_4_AND_5',
            count: 4,
            compareValue: '4–5 inclusive',
            digits: [4, 5, 5, 4],
            result: true,
            status: 'MET',
        });

        expect(journal.updateEdgingProAnalysisMessage).toHaveBeenCalledWith(
            '[Edging pro] Last 4 digits on 1HZ50V: [4, 5, 5, 4] · 4–5 condition: MET'
        );
        expect(journal.pushMessage).not.toHaveBeenCalled();
    });

    it('keeps Rise/Fall volatility-scan Journal entries out of Smart Over 2', () => {
        const journal = {
            pushMessage: jest.fn(),
            updateVolatilityScanMessage: jest.fn(),
            active_bot_template_id: 'smart-over-2',
        };
        const rootStore = { dbot: {}, journal };
        const core = {
            client: { loginid: null },
            common: { is_socket_opened: false },
            ui: {},
        };
        const runPanel = new RunPanelStore(rootStore as any, core as any);
        runPanel.onMount();

        const purchaseEvent = {
            event: 'purchase',
            market: '1HZ25V',
            contractType: 'DIGITOVER',
            contractId: '12345',
            buyPrice: 0.5,
            availableAdx: null,
            availableRsi: null,
            availableMacd: null,
        };

        observer.emit('bot.volatility.scan', purchaseEvent);
        expect(journal.pushMessage).not.toHaveBeenCalled();
        expect(journal.updateVolatilityScanMessage).not.toHaveBeenCalled();

        journal.active_bot_template_id = 'rise-fall-master';
        observer.emit('bot.volatility.scan', purchaseEvent);

        expect(journal.pushMessage).toHaveBeenCalledWith(
            expect.stringContaining('[Volatility Scan] Entry order submitted'),
            MessageTypes.NOTIFY,
            'journal__text'
        );
    });

    it('advances visible analysis and appends one matching Journal row per live tick', () => {
        const journal = {
            pushMessage: jest.fn(),
            active_bot_template_id: 'rise-fall-master',
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

    it('journals Smart Over 2 analysis only in the bot whose gate emitted it', () => {
        const journal = {
            pushMessage: jest.fn(),
            updateSmartOver2AnalysisMessage: jest.fn(),
            active_bot_template_id: 'rise-fall-master',
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

        observer.emit('bot.analysis.smart_over2', {
            market: 'R_25',
            journalScope: 'rise-fall-master',
            count: 4,
            digits: [3, 4, 5, 6],
            lastThree: [4, 5, 6],
            entryWindowReady: true,
            entryWindowMatches: true,
            skipWindowReady: true,
            skipHighTriple: false,
            skipLowTriple: false,
            result: true,
        });
        observer.emit('bot.analysis.smart_over2', {
            market: 'R_25',
            journalScope: 'rise-fall-master',
            count: 1,
            digits: [2],
            lastThree: [0, 1, 2],
            entryWindowReady: true,
            entryWindowMatches: false,
            skipWindowReady: true,
            skipHighTriple: false,
            skipLowTriple: true,
            result: false,
        });
        observer.emit('bot.analysis.smart_over2', {
            market: 'R_25',
            journalScope: 'smart-over-2',
            count: 1,
            digits: [2],
            lastThree: [0, 1, 2],
            entryWindowReady: true,
            entryWindowMatches: false,
            skipWindowReady: true,
            skipHighTriple: false,
            skipLowTriple: true,
            result: false,
        });
        journal.active_bot_template_id = 'smart-over-2';
        observer.emit('bot.analysis.smart_over2', {
            market: 'R_25',
            journalScope: 'rise-fall-master',
            count: 4,
            digits: [3, 4, 5, 6],
            lastThree: [4, 5, 6],
            entryWindowReady: true,
            entryWindowMatches: true,
            skipWindowReady: true,
            skipHighTriple: false,
            skipLowTriple: false,
            result: true,
        });
        observer.emit('bot.analysis.smart_over2', {
            market: 'R_25',
            journalScope: 'smart-over-2',
            count: 4,
            digits: [3, 4, 5, 6],
            lastThree: [4, 5, 6],
            entryWindowReady: true,
            entryWindowMatches: true,
            skipWindowReady: true,
            skipHighTriple: false,
            skipLowTriple: false,
            result: true,
        });

        const messages = journal.updateSmartOver2AnalysisMessage.mock.calls.map(([message]) => message);
        expect(messages).toHaveLength(3);
        expect(messages[0]).toContain('Last 4: [3, 4, 5, 6]');
        expect(messages[0]).toContain('3–7 window: MET');
        expect(messages[0]).toContain('all 7–9: NO');
        expect(messages[0]).toContain('all 0–2: NO');
        expect(messages[0]).toContain('Entry: ALLOWED');
        expect(messages[1]).toContain('Last 1: [2]');
        expect(messages[1]).toContain('3–7 window: NOT MET');
        expect(messages[1]).toContain('all 7–9: NO');
        expect(messages[1]).toContain('all 0–2: MATCH — SKIP');
        expect(messages[1]).toContain('Entry: BLOCKED');
        expect(messages[2]).toContain('Last 4: [3, 4, 5, 6]');
        expect(messages[2]).toContain('Entry: ALLOWED');
        expect(journal.pushMessage).not.toHaveBeenCalled();
    });

    it('keeps one live recovery status row and journals scoped decisions and settlements', () => {
        const journal = {
            pushMessage: jest.fn(),
            updateSmartOver2AnalysisMessage: jest.fn(),
            active_bot_template_id: 'smart-over-2',
        };
        const transactions = { pushVirtualHookTransaction: jest.fn() };
        const rootStore = { dbot: {}, journal, transactions };
        const core = {
            client: { loginid: null },
            common: { is_socket_opened: false },
            ui: {},
        };
        const runPanel = new RunPanelStore(rootStore as any, core as any);
        runPanel.onMount();

        observer.emit('bot.smart_over2.recovery', {
            event: 'status',
            journalScope: 'smart-over-2',
            message: '[Smart Over 2] Status · Recovery 2 · waiting for all digits below 4',
        });
        observer.emit('bot.smart_over2.recovery', {
            event: 'settlement',
            journalScope: 'smart-over-2',
            message: '[Smart Over 2] Recovery 1 settled LOSS. Starting Recovery 2.',
        });
        observer.emit('bot.smart_over2.recovery', {
            event: 'settlement',
            journalScope: 'rise-fall-master',
            message: '[Smart Over 2] Recovery event from another bot.',
        });
        observer.emit('bot.smart_over2.recovery', {
            event: 'virtual_settlement',
            journalScope: 'rise-fall-master',
            outcome: 'loss',
            contractType: 'DIGITUNDER',
            prediction: 5,
            virtualTradeId: 'smart-over2:101:DIGITUNDER:5',
            market: 'R_25',
            entryEpoch: 101,
            settlementEpoch: 102,
            entrySpot: '2591.458',
            exitSpot: '2591.421',
            message: '[Smart Over 2] Virtual Under 5 settled LOSS on digit 7.',
        });

        expect(journal.updateSmartOver2AnalysisMessage).toHaveBeenCalledTimes(1);
        expect(journal.updateSmartOver2AnalysisMessage).toHaveBeenCalledWith(
            '[Smart Over 2] Status · Recovery 2 · waiting for all digits below 4'
        );
        expect(journal.pushMessage).toHaveBeenCalledTimes(1);
        expect(journal.pushMessage).toHaveBeenCalledWith(
            '[Smart Over 2] Recovery 1 settled LOSS. Starting Recovery 2.',
            MessageTypes.NOTIFY,
            'journal__text'
        );
        expect(transactions.pushVirtualHookTransaction).toHaveBeenCalledTimes(1);
        expect(transactions.pushVirtualHookTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'virtual_settlement',
                outcome: 'loss',
                virtualTradeId: expect.any(String),
                journalScope: 'rise-fall-master',
            })
        );
    });

    it('routes Even Odd Strike Eagle virtual settlements to its Journal and account transaction list', () => {
        const journal = {
            pushMessage: jest.fn(),
            updateSmartOver2AnalysisMessage: jest.fn(),
            active_bot_template_id: 'Even_Odd_Strike_Eagle.xml',
        };
        const transactions = { pushVirtualHookTransaction: jest.fn() };
        const rootStore = { dbot: {}, journal, transactions };
        const core = {
            client: { loginid: null },
            common: { is_socket_opened: false },
            ui: {},
        };
        const runPanel = new RunPanelStore(rootStore as any, core as any);
        runPanel.onMount();

        observer.emit('bot.smart_over2.recovery', {
            event: 'virtual_settlement',
            journalScope: 'even-odd-strike-eagle',
            outcome: 'loss',
            contractType: 'DIGITEVEN',
            virtualTradeId: 'even-odd-strike-eagle:A:101:DIGITEVEN',
            market: '1HZ25V',
            entryEpoch: 101,
            settlementEpoch: 102,
            entrySpot: '2591.500',
            exitSpot: '2591.490',
            message: '[Even Odd Strike Eagle] Virtual Even settled LOSS on digit 3.',
        });

        expect(transactions.pushVirtualHookTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'virtual_settlement',
                journalScope: 'even-odd-strike-eagle',
                contractType: 'DIGITEVEN',
                outcome: 'loss',
            })
        );
        expect(journal.pushMessage).toHaveBeenCalledWith(
            '[Even Odd Strike Eagle] Virtual Even settled LOSS on digit 3.',
            MessageTypes.NOTIFY,
            'journal__text'
        );
    });

    it('shows V3 digits, range qualification, and Virtual Hook progress in the Journal status row', () => {
        const journal = {
            pushMessage: jest.fn(),
            updateSmartOver2AnalysisMessage: jest.fn(),
            active_bot_template_id: 'smart-over-2-v3',
        };
        const rootStore = { dbot: {}, journal };
        const core = {
            client: { loginid: null },
            common: { is_socket_opened: false },
            ui: {},
        };
        const runPanel = new RunPanelStore(rootStore as any, core as any);
        runPanel.onMount();

        observer.emit('bot.analysis.smart_over2', {
            version: 'v3',
            market: '1HZ50V',
            journalScope: 'smart-over-2',
            count: 4,
            digits: [3, 4, 5, 7],
            lastThree: [4, 5, 7],
            entryWindowReady: true,
            entryWindowMatches: false,
            skipWindowReady: false,
            skipHighTriple: false,
            skipLowTriple: false,
            result: false,
            prediction: 4,
            useVirtualHook: true,
            virtualLosses: 0,
            maxVirtualLosses: 1,
            waitingForVirtualHook: false,
        });
        observer.emit('bot.analysis.smart_over2', {
            version: 'v3',
            market: '1HZ50V',
            journalScope: 'smart-over-2',
            count: 4,
            digits: [3, 4, 5, 6],
            lastThree: [4, 5, 6],
            entryWindowReady: true,
            entryWindowMatches: true,
            skipWindowReady: false,
            skipHighTriple: false,
            skipLowTriple: false,
            result: true,
            prediction: 4,
            useVirtualHook: true,
            virtualLosses: 0,
            maxVirtualLosses: 1,
            waitingForVirtualHook: true,
        });
        observer.emit('bot.analysis.smart_over2', {
            version: 'v3',
            market: '1HZ50V',
            journalScope: 'smart-over-2',
            count: 4,
            digits: [3, 4, 5, 6],
            lastThree: [4, 5, 6],
            entryWindowReady: true,
            entryWindowMatches: true,
            skipWindowReady: false,
            skipHighTriple: false,
            skipLowTriple: false,
            result: true,
            prediction: 4,
            useVirtualHook: true,
            virtualLosses: 1,
            maxVirtualLosses: 1,
            waitingForVirtualHook: false,
        });

        const messages = journal.updateSmartOver2AnalysisMessage.mock.calls.map(([message]) => message);
        expect(messages).toHaveLength(3);
        expect(messages[0]).toContain('Last 4: [3, 4, 5, 7]');
        expect(messages[0]).toContain('every digit 3–6: NOT MET');
        expect(messages[0]).toContain('Over prediction: 4');
        expect(messages[0]).toContain('Entry: BLOCKED');
        expect(messages[1]).toContain('every digit 3–6: MET');
        expect(messages[1]).toContain('Over prediction: 4');
        expect(messages[1]).toContain('Virtual Hook: 0/1 consecutive losses');
        expect(messages[1]).toContain('Entry: WAITING FOR VIRTUAL LOSSES');
        expect(messages[2]).toContain('Virtual Hook: 1/1 consecutive losses');
        expect(messages[2]).toContain('Over prediction: 4');
        expect(messages[2]).toContain('Entry: LIVE OVER 4 READY');
        expect(journal.pushMessage).not.toHaveBeenCalled();
    });

    it('updates the Smart Over 2 status row instead of appending a row per tick', () => {
        const journal = Object.create(JournalStore.prototype) as any;
        journal.active_bot_template_id = 'smart-over-2';
        journal.unfiltered_messages = [
            {
                message: '[Smart Over 2] Status · Normal Over 2 · Entry: WAITING',
                message_type: MessageTypes.NOTIFY,
                time: '10:00:00 GMT',
                unique_id: 'status-row',
                extra: { botTemplateId: 'smart-over-2' },
            },
        ];
        journal.getServerTime = jest.fn(() => new Date('2026-10-03T10:01:00Z'));
        journal.pushMessage = jest.fn();

        journal.updateSmartOver2AnalysisMessage('[Smart Over 2] Status · Recovery 2 · Entry: WAITING');

        expect(journal.unfiltered_messages).toHaveLength(1);
        expect(journal.unfiltered_messages[0]).toEqual(
            expect.objectContaining({
                message: '[Smart Over 2] Status · Recovery 2 · Entry: WAITING',
                unique_id: 'status-row',
            })
        );
        expect(journal.pushMessage).not.toHaveBeenCalled();
    });

    it('keeps generated condition banners and Journal rows ordered within each configured tick cadence', async () => {
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

        const Engine = Ticks(class {} as any);
        const engine: any = new Engine();
        engine.getPipSize = () => 2;
        engine.store = { dispatch: jest.fn() };
        engine.observer = { emit: jest.fn() };

        let currentWindow: Array<{ quote: number }> = [];
        let tickCallback: ((ticks: Array<{ epoch: number; quote: number }>) => void) | undefined;
        engine.$scope = {
            ticksService: {
                monitor: jest.fn(async ({ callback }) => {
                    tickCallback = callback;
                    return 'generated-analysis-tick-listener';
                }),
                request: jest.fn(async () => currentWindow),
            },
        };

        const visibleEvents: Array<{
            epoch: number;
            analysis: Record<string, unknown> | null;
        }> = [];
        observer.register('bot.analysis.condition', () => {
            visibleEvents.push({
                epoch: engine.latestTick.epoch,
                analysis: runPanel.last_digits_analysis
                    ? { ...runPanel.last_digits_analysis }
                    : null,
            });
        });

        const configuredCadenceSeconds =
            DERIV_VOLATILITIES.find(({ code }) => code === 'R_25')?.tickEvery ?? 2;
        const firstEpoch = 1_700_000_000;
        const tickWindows = [
            {
                epoch: firstEpoch,
                ticks: [{ quote: 1.44 }],
                conditions: [
                    { condition: 'ALL_EVEN', count: 1, compareValue: 0, result: true },
                    { condition: 'ALL_ODD', count: 1, compareValue: 0, result: false },
                    { condition: 'ALL_EVEN', count: 1, compareValue: 0, result: true },
                ],
            },
            {
                epoch: firstEpoch + configuredCadenceSeconds,
                ticks: [{ quote: 1.44 }, { quote: 1.46 }],
                conditions: [
                    { condition: 'GREATER_OR_EQUAL', count: 2, compareValue: 6, result: false },
                    { condition: 'LESS_OR_EQUAL', count: 2, compareValue: 6, result: true },
                    { condition: 'GREATER_OR_EQUAL', count: 2, compareValue: 6, result: false },
                ],
            },
        ];

        await engine.watchTicks('R_25');
        expect(tickCallback).toBeDefined();

        for (const tick of tickWindows) {
            currentWindow = tick.ticks;
            tickCallback?.([{ epoch: tick.epoch, quote: tick.ticks.at(-1)?.quote ?? 0 }]);

            for (const expected of tick.conditions) {
                await expect(
                    engine.checkLastDigitsCondition(expected.condition, expected.count, expected.compareValue)
                ).resolves.toBe(expected.result);
            }
        }

        const expectedAnalyses = tickWindows.flatMap(tick =>
            tick.conditions.map(condition => ({
                epoch: tick.epoch,
                analysis: {
                    market: 'R_25',
                    condition: condition.condition,
                    count: condition.count,
                    compareValue: condition.compareValue,
                    digits: tick.ticks.map(({ quote }) => Number(quote.toFixed(2).slice(-1))),
                    result: condition.result,
                },
            }))
        );

        expect(visibleEvents).toEqual(expectedAnalyses);

        const expectedJournalMessages = expectedAnalyses.map(({ analysis }) => {
            const conditionLabel = (() => {
                switch (analysis.condition) {
                    case 'ALL_EVEN':
                        return 'all even';
                    case 'ALL_ODD':
                        return 'all odd';
                    case 'LESS_OR_EQUAL':
                        return `less than or equal to ${analysis.compareValue}`;
                    case 'GREATER_OR_EQUAL':
                        return `greater than or equal to ${analysis.compareValue}`;
                    default:
                        return analysis.condition;
                }
            })();

            return (
                `Last Digits Analysis Market: ${analysis.market} ` +
                `Condition: ${conditionLabel} ` +
                `Digits: [${analysis.digits.join(', ')}] ` +
                `Entry point: ${analysis.result ? 'HIT' : 'NOT HIT'} · ` +
                `Result: ${analysis.result ? '✅ CONDITIONS MET' : '❌ CONDITIONS NOT MET'}`
            );
        });

        expect(journal.pushMessage.mock.calls.map(([message]) => message)).toEqual(expectedJournalMessages);
        expect(journal.pushMessage.mock.calls.map(([, messageType]) => messageType)).toEqual(
            expectedAnalyses.map(() => MessageTypes.NOTIFY)
        );

        const distinctEpochs = [...new Set(visibleEvents.map(({ epoch }) => epoch))];
        expect(distinctEpochs).toEqual(tickWindows.map(({ epoch }) => epoch));
        expect(distinctEpochs.slice(1).map((epoch, index) => epoch - distinctEpochs[index])).toEqual([
            configuredCadenceSeconds,
        ]);
    });

    it('rerenders the live analysis state through false and true results without opening Journal', () => {
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

        const renderedResults: boolean[] = [];
        const dispose = autorun(() => {
            const analysis = runPanel.last_digits_analysis;
            if (analysis) renderedResults.push(analysis.result);
        });

        const emitAnalysis = (result: boolean, digits: number[]) => {
            observer.emit('bot.analysis.condition', {
                market: '1HZ50V',
                condition: result ? 'ALL_EVEN' : 'ALL_ODD',
                count: 4,
                compareValue: 0,
                digits,
                result,
            });
        };

        emitAnalysis(false, [1, 3, 1, 1]);
        emitAnalysis(true, [2, 6, 2, 8]);
        emitAnalysis(false, [1, 6, 2, 8]);

        expect(renderedResults).toEqual([false, true, false]);
        expect(journal.pushMessage).toHaveBeenCalledTimes(3);
        dispose();
    });

    it('keeps the uploaded purchase mapping visible in the banner and Journal', () => {
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

        observer.emit('bot.analysis.condition', {
            market: '1HZ10V',
            condition: 'ALL_ODD',
            count: 3,
            compareValue: 0,
            digits: [1, 3, 5],
            result: true,
        });
        observer.emit('bot.purchase.mapping', {
            contractType: 'DIGITOVER',
            prediction: 2,
            label: 'Over 2',
        });

        expect(runPanel.last_digits_analysis).toEqual(expect.objectContaining({ purchaseMapping: 'Over 2' }));
        expect(journal.pushMessage).toHaveBeenLastCalledWith(
            'Purchase mapping: Over 2 (contract DIGITOVER, prediction 2)',
            MessageTypes.NOTIFY,
            'journal__text'
        );
    });
});
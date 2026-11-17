import fs from 'node:fs';
import path from 'node:path';
import { applyCandleCloseEntryGate, isCandleCloseEntryWindow } from '../candle-close-entry';
import { configureOverUnderBotXml, fetchAndPatchBot } from '../bot-patch';
import { DerivV2Engine } from '../deriv-v2-engine';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: false },
}));

const botXml = (name: string) => fs.readFileSync(
    path.resolve(__dirname, `../../../public/bots/${name}`),
    'utf8',
);

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

describe('broker-tick candle-close entry', () => {
    test('opens only on the configured broker second before candle close', () => {
        expect(isCandleCloseEntryWindow(58, 60, 2)).toBe(true);
        expect(isCandleCloseEntryWindow(58.9, 60, 2)).toBe(true);
        expect(isCandleCloseEntryWindow(57, 60, 2)).toBe(false);
        expect(isCandleCloseEntryWindow(59, 60, 2)).toBe(false);
        expect(isCandleCloseEntryWindow(null, 60, 2)).toBe(false);
        expect(isCandleCloseEntryWindow(58, 60, 60)).toBe(false);
    });

    test('configures #21 with source-side signals and a 00:02 one-minute entry gate', () => {
        const rawXml = botXml('OverUnder_Signal_Bot.xml');
        const original = parseXml(rawXml);
        expect(original.querySelector('block[id="ou_indicator_signal"]')).toBeNull();
        expect(original.querySelector('block[id="ou_ep_gate"]')).not.toBeNull();

        const doc = configureOverUnderBotXml(rawXml, {
            mode: 'MACD_OVER_4',
            barrier: 0,
            stake: 0.35,
            takeProfit: 15,
            stopLoss: 50,
            martingale: 2,
        });
        expect(doc.querySelector('block[type="trade_definition_candleinterval"] field[name="CANDLEINTERVAL_LIST"]')?.textContent)
            .toBe('60');
        expect(doc.querySelector('block[id="ou_tm_init"] field[name="NUM"]')?.textContent).toBe('1');
        expect(doc.querySelector('block[type="over_under_indicator_signal"]')).toBeNull();
        expect(doc.querySelector(
            'block[id="ou_entry_time_gate"] value[name="IF0"] block[type="candle_close_entry_window"] field[name="SECONDS_BEFORE_CLOSE"]'
        )?.textContent).toBe('2');
        expect(doc.querySelector(
            'block[id="ou_entry_time_gate"] value[name="IF0"] block[type="candle_close_entry_window"] field[name="INTERVAL_SECONDS"]'
        )?.textContent).toBe('60');
        expect(doc.querySelector('block[id="ou_barrier_num"] field[name="NUM"]')?.textContent).toBe('0');
        expect(doc.querySelector('block[id="ou_ep_num"] field[name="NUM"]')?.textContent).toBe('2');
        expect(doc.querySelector('variable[id="ou_ep_id"]')?.textContent).toBe('Entry Point Seconds');
        expect(doc.querySelector('block[id="ou_tm_gate"] > statement[name="ELSE"]')).toBeNull();
        expect(doc.querySelector('block[id="ou_tm_gate"] > mutation')?.getAttribute('else')).toBe('0');
        expect(doc.querySelector('block[id="ou_dir_purchase_check"]')).not.toBeNull();
        expect(doc.querySelector('block[id="ou_dir_purchase_check"] > statement[name="ELSE"] block[id="ou_purchase_under"]')).not.toBeNull();
        expect(doc.querySelector('block[id="ou_scan_notify"]')).toBeNull();

        const configured = configureOverUnderBotXml(rawXml, {
            mode: 'TSI_UNDER_5',
            barrier: 9,
            stake: 0.75,
            takeProfit: 12,
            stopLoss: 25,
            martingale: 1.8,
        });
        expect(configured.querySelector('block[id="ou_dir_text_val"] field[name="TEXT"]')?.textContent)
            .toBe('UNDER');
        expect(configured.querySelector('block[id="ou_barrier_num"] field[name="NUM"]')?.textContent)
            .toBe('9');
        expect(configured.querySelector('block[id="ou_stake_num"] field[name="NUM"]')?.textContent)
            .toBe('0.75');
        expect(configured.querySelector('block[id="ou_tp_num"] field[name="NUM"]')?.textContent)
            .toBe('12');
        expect(configured.querySelector('block[id="sl_ou_num"] field[name="NUM"]')?.textContent)
            .toBe('25');
        expect(configured.querySelector('block[id="ou_mart_num"] field[name="NUM"]')?.textContent)
            .toBe('1.8');
        expect(() => configureOverUnderBotXml(rawXml, {
            mode: 'MACD_OVER_4',
            barrier: 9,
            stake: 0.35,
            takeProfit: 15,
            stopLoss: 50,
            martingale: 2,
        })).toThrow('Over barriers must be between 0 and 8.');
        expect(() => configureOverUnderBotXml(rawXml, {
            mode: 'TSI_UNDER_5',
            barrier: 0,
            stake: 0.35,
            takeProfit: 15,
            stopLoss: 50,
            martingale: 2,
        })).toThrow('Under barriers must be between 1 and 9.');
    });

    test('routes a source signal into #21 on its own volatility without adding signal-condition blocks', async () => {
        const xml = botXml('OverUnder_Signal_Bot.xml');
        const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            text: async () => xml,
        } as Response);
        try {
            const doc = await fetchAndPatchBot(
                'over-under-secret-weapon',
                {
                    symbol: '1HZ10V',
                    symbolLabel: 'Volatility 10 (1s) Index',
                    direction: 'UNDER 9',
                    entryPoint: '00:02 before candle close',
                    confidence: 100,
                    market: 'over_under',
                    indicatorMode: 'TSI_UNDER_6',
                    contractType: 'DIGITUNDER',
                    recoveryContractType: 'DIGITUNDER',
                },
                0.5,
                12,
                25,
                2,
            );

            expect(doc.querySelector('block[type="trade_definition_market"] field[name="SYMBOL_LIST"]')?.textContent)
                .toBe('1HZ10V');
            expect(doc.querySelector('block[type="over_under_indicator_signal"]')).toBeNull();
            expect(doc.querySelector('block[type="candle_close_entry_window"] field[name="SECONDS_BEFORE_CLOSE"]')?.textContent)
                .toBe('2');
            expect(doc.querySelector('block[type="trade_definition_candleinterval"] field[name="CANDLEINTERVAL_LIST"]')?.textContent)
                .toBe('60');
            expect(doc.querySelector('block[id="ou_barrier_num"] field[name="NUM"]')?.textContent).toBe('9');
            expect(doc.querySelector('block[id="ou_dir_init"] field[name="TEXT"]')?.textContent).toBe('UNDER');
        } finally {
            fetchMock.mockRestore();
        }
    });

    test('rewires both Destroyer templates without retaining digit entry gates', () => {
        for (const name of ['Over_Destroyer_Bot.xml', 'Under_Destroyer_Bot.xml']) {
            const doc = parseXml(botXml(name));
            applyCandleCloseEntryGate(doc);

            expect(doc.querySelector('block[type="trade_definition_candleinterval"] field[name="CANDLEINTERVAL_LIST"]')?.textContent)
                .toBe('60');
            expect(doc.querySelector('block[type="before_purchase"] statement[name="BEFOREPURCHASE_STACK"] block > value[name="IF0"] block[type="candle_close_entry_window"]'))
                .not.toBeNull();
        }
    });

    test('V2 buys once inside the time window and defers late proposals to the next candle', () => {
        const engine = new DerivV2Engine({
            symbol: 'R_100',
            contractKind: 'DIGITOVER',
            direction: 'OVER',
            entryPoint: 0,
            barrier: 4,
            initialStake: 0.5,
            martingale: 2,
            martingaleLevel: 6,
            takeProfit: 10,
            stopLoss: 30,
            candleCloseEntryWindow: { intervalSeconds: 60, secondsBeforeClose: 2 },
        });
        const internal = engine as any;
        internal.isRunning = true;
        internal.readyProposal = { id: 'ready-1', price: 0.5, stake: 0.5, fetchedAt: Date.now() };
        const executeBuy = jest.spyOn(internal, 'executeBuy').mockImplementation(() => undefined);

        internal.handleTick({ quote: 123.45, pip_size: 2, epoch: 58 });
        internal.handleTick({ quote: 123.46, pip_size: 2, epoch: 58.7 });
        expect(executeBuy).toHaveBeenCalledTimes(1);

        internal.readyProposal = null;
        internal.proposalInflight = true;
        internal.handleTick({ quote: 123.47, pip_size: 2, epoch: 118 });
        internal.handleTick({ quote: 123.48, pip_size: 2, epoch: 119 });
        internal.handleProposal({ id: 'late-2', ask_price: 0.5 });
        expect(executeBuy).toHaveBeenCalledTimes(1);

        internal.handleTick({ quote: 123.49, pip_size: 2, epoch: 178 });
        expect(executeBuy).toHaveBeenCalledTimes(2);
        expect((executeBuy.mock.calls[1][0] as any).id).toBe('late-2');
        engine.stop();
    });
});

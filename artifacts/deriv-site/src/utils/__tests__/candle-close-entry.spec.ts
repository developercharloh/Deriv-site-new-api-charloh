import fs from 'node:fs';
import path from 'node:path';
import { applyCandleCloseEntryGate, isCandleCloseEntryWindow } from '../candle-close-entry';
import { configureOverUnderBotXml } from '../bot-patch';
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

    test('uses the selected one-line indicator gate in the standard Over/Under template', () => {
        const rawXml = botXml('OverUnder_Signal_Bot.xml');
        const original = parseXml(rawXml);
        expect(original.querySelector('block[id="ou_indicator_signal"]')).toBeNull();
        expect(original.querySelector('block[id="ou_ep_gate"]')).not.toBeNull();

        const doc = configureOverUnderBotXml(rawXml, {
            mode: 'MACD_OVER_4',
            stake: 0.35,
            takeProfit: 15,
            stopLoss: 50,
            martingale: 2,
        });
        expect(doc.querySelector('block[type="trade_definition_candleinterval"] field[name="CANDLEINTERVAL_LIST"]')?.textContent)
            .toBe('60');
        expect(doc.querySelector('block[id="ou_tm_init"] field[name="NUM"]')?.textContent).toBe('1');
        expect(doc.querySelector('block[id="ou_indicator_gate"] value[name="IF0"] block[type="over_under_indicator_signal"] field[name="MODE"]')?.textContent)
            .toBe('MACD_OVER_4');
        expect(doc.querySelector('block[id="ou_dir_purchase_check"]')).not.toBeNull();
        expect(doc.querySelector('block[id="ou_ep_gate"], block[id="ou_scan_notify"]')).toBeNull();

        const configured = configureOverUnderBotXml(rawXml, {
            mode: 'TSI_UNDER_5',
            stake: 0.75,
            takeProfit: 12,
            stopLoss: 25,
            martingale: 1.8,
        });
        expect(configured.querySelector('block[id="ou_indicator_signal"] field[name="MODE"]')?.textContent)
            .toBe('TSI_UNDER_5');
        expect(configured.querySelector('block[id="ou_dir_text_val"] field[name="TEXT"]')?.textContent)
            .toBe('UNDER');
        expect(configured.querySelector('block[id="ou_barrier_num"] field[name="NUM"]')?.textContent)
            .toBe('5');
        expect(configured.querySelector('block[id="ou_stake_num"] field[name="NUM"]')?.textContent)
            .toBe('0.75');
        expect(configured.querySelector('block[id="ou_tp_num"] field[name="NUM"]')?.textContent)
            .toBe('12');
        expect(configured.querySelector('block[id="sl_ou_num"] field[name="NUM"]')?.textContent)
            .toBe('25');
        expect(configured.querySelector('block[id="ou_mart_num"] field[name="NUM"]')?.textContent)
            .toBe('1.8');
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

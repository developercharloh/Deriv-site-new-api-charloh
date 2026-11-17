import fs from 'node:fs';
import path from 'node:path';
import { applyCandleCloseEntryGate, isCandleCloseEntryWindow } from '../candle-close-entry';
import { DerivV2Engine } from '../deriv-v2-engine';
import { parseXmlV2Config } from '../xml-v2-parser';

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

    test('rewires Secret Weapon to a time gate and keeps the selected direction purchases', () => {
        const doc = parseXml(botXml('OverUnder_Signal_Bot.xml'));
        applyCandleCloseEntryGate(doc, 'secret-weapon');

        expect(doc.querySelector('block[type="trade_definition_candleinterval"] field[name="CANDLEINTERVAL_LIST"]')?.textContent)
            .toBe('60');
        expect(doc.querySelector('block[id="ou_tm_gate"] > value[name="IF0"] block[type="candle_close_entry_window"]'))
            .not.toBeNull();
        expect(doc.querySelector('block[id="ou_tm_gate"] > statement[name="DO0"] > block[id="ou_dir_purchase_check"]'))
            .not.toBeNull();
        expect(doc.querySelector('block[id="ou_purchase_over"] field[name="PURCHASE_LIST"]')?.textContent)
            .toBe('DIGITOVER');
        expect(doc.querySelector('block[id="ou_purchase_under"] field[name="PURCHASE_LIST"]')?.textContent)
            .toBe('DIGITUNDER');
        expect(doc.querySelector('block[id="ou_tm_gate"] > statement[name="ELSE"]')?.children.length)
            .toBe(0);

        expect(parseXmlV2Config(new XMLSerializer().serializeToString(doc.documentElement)).candleCloseEntryWindow)
            .toEqual({ intervalSeconds: 60, secondsBeforeClose: 2 });
    });

    test('rewires both Destroyer templates without retaining digit entry gates', () => {
        for (const name of ['Over_Destroyer_Bot.xml', 'Under_Destroyer_Bot.xml']) {
            const doc = parseXml(botXml(name));
            applyCandleCloseEntryGate(doc, 'destroyer');

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

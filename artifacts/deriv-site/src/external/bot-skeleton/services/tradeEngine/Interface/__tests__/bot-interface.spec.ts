import getBotInterface from '../BotInterface';
import getTicksInterface from '../TicksInterface';

describe('Bot payout lookup', () => {
    const createTradeEngine = () => ({
        data: {
            proposals: [
                { contract_type: 'CALL', purchase_reference: 'current', payout: 1.82 },
                { contract_type: 'PUT', purchase_reference: 'current', payout: 1.79 },
                { contract_type: 'CALL', purchase_reference: 'stale', payout: 9.99 },
            ],
        },
        getPurchaseReference: () => 'current',
    });

    it('uses the current-reference proposal when a restored payout block has no contract type', () => {
        const bot = getBotInterface(createTradeEngine());

        expect(bot.getPayout('')).toBe(1.82);
    });

    it('returns zero instead of throwing when no current proposal exists', () => {
        const tradeEngine = createTradeEngine();
        tradeEngine.data.proposals = [];
        const bot = getBotInterface(tradeEngine);

        expect(bot.getPayout('')).toBe(0);
    });
});

describe('Bot volatility scan interface', () => {
    it('exposes the confidence-free scanner to generated Blockly programs', async () => {
        const scanVolatilityUntilIndicatorsPass = jest.fn().mockResolvedValue(true);
        const ticks = getTicksInterface({ scanVolatilityUntilIndicatorsPass });

        await expect(ticks.scanVolatilityUntilIndicatorsPass(20)).resolves.toBe(true);
        expect(scanVolatilityUntilIndicatorsPass).toHaveBeenCalledWith(20);
    });
});
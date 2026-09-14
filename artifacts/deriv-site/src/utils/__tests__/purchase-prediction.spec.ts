import { getPurchaseTradeOptions } from '@/external/bot-skeleton/services/tradeEngine/trade/Purchase';
import { tradeOptionToBuy } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';

describe('generated purchase prediction forwarding', () => {
    const baseTradeOptions = {
        amount: 0.5,
        basis: 'stake',
        currency: 'USD',
        duration: 1,
        duration_unit: 't',
        symbol: 'R_25',
    };

    it('includes the Over barrier in the direct buy request', () => {
        const options = getPurchaseTradeOptions(baseTradeOptions, 4);
        const request = tradeOptionToBuy('DIGITOVER', options);

        expect(request.parameters).toMatchObject({
            contract_type: 'DIGITOVER',
            barrier: 4,
        });
    });

    it('includes the Under barrier in the direct buy request', () => {
        const options = getPurchaseTradeOptions(baseTradeOptions, 5);
        const request = tradeOptionToBuy('DIGITUNDER', options);

        expect(request.parameters).toMatchObject({
            contract_type: 'DIGITUNDER',
            barrier: 5,
        });
    });

    it('does not add a prediction to Even or Odd purchases', () => {
        const options = getPurchaseTradeOptions({ ...baseTradeOptions, prediction: 5 }, 5, 'DIGITODD');

        expect(options).not.toHaveProperty('prediction');
        expect(tradeOptionToBuy('DIGITEVEN', options).parameters).not.toHaveProperty('barrier');
        expect(tradeOptionToBuy('DIGITODD', options).parameters).not.toHaveProperty('barrier');
        expect(tradeOptionToBuy('DIGITODD', { ...options, prediction: 5 }).parameters).not.toHaveProperty(
            'barrier'
        );
    });
});
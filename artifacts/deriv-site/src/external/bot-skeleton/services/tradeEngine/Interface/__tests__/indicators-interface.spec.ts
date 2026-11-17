import getIndicatorsInterface from '../IndicatorsInterface';

describe('indicator interface initialization', () => {
    it('reads pip precision only when an indicator is called', () => {
        const getPipSize = jest.fn(() => 2);
        const indicators = getIndicatorsInterface({ getPipSize });

        expect(getPipSize).not.toHaveBeenCalled();

        indicators.getAdxValue([], 14, 'adx');

        expect(getPipSize).toHaveBeenCalledTimes(1);
    });
});

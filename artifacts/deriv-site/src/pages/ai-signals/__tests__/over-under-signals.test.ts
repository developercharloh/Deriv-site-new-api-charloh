import {
    getOverUnderSignalOptions,
    OVER_UNDER_SIGNAL_BARRIERS,
} from '../over-under-signals';

describe('AI Signals Over/Under barrier selection', () => {
    it('limits Over signals to 4 and 5, and Under signals to 6 and 5', () => {
        expect(OVER_UNDER_SIGNAL_BARRIERS).toEqual({
            OVER: [4, 5],
            UNDER: [6, 5],
        });
    });

    it('scores only the four configured signal choices', () => {
        const digits = Array.from({ length: 100 }, (_, index) => index % 10);
        const options = getOverUnderSignalOptions(digits);

        expect(options.map(({ side, barrier }) => `${side} ${barrier}`).sort()).toEqual([
            'OVER 4',
            'OVER 5',
            'UNDER 5',
            'UNDER 6',
        ]);
        expect(options.find(option => option.side === 'OVER' && option.barrier === 4)).toMatchObject({
            probability: 0.5,
            edge: 0,
        });
        expect(options.find(option => option.side === 'UNDER' && option.barrier === 6)).toMatchObject({
            probability: 0.6,
            edge: 0,
        });
    });
});

// Versioned, chronological paper-replay data. These fixtures are intentionally
// kept separate from the live tick and purchase services.
export const ADAPTIVE_MOMENTUM_REPLAY_FIXTURE_VERSION = '2026-09-15.v1';

const makeTicks = (startEpoch, quotes) =>
    quotes.map((quote, index) => ({
        epoch: startEpoch + index,
        quote,
    }));

export const ADAPTIVE_MOMENTUM_REPLAY_FIXTURES = Object.freeze({
    inSample: Object.freeze({
        id: 'adaptive-momentum-in-sample-2026-09-08',
        label: 'In-sample session',
        capturedAt: '2026-09-08',
        ticks: Object.freeze(
            makeTicks(1788825600, [
                100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117,
                118, 119,
            ])
        ),
        settlements: Object.freeze([
            { tickIndex: 9, outcome: 'win', profit: 1 },
            { tickIndex: 10, outcome: 'win', profit: 1 },
            { tickIndex: 11, outcome: 'loss', profit: -1 },
            { tickIndex: 12, outcome: 'win', profit: 1 },
            { tickIndex: 13, outcome: 'loss', profit: -1 },
            { tickIndex: 14, outcome: 'win', profit: 1 },
            { tickIndex: 15, outcome: 'win', profit: 1 },
            { tickIndex: 16, outcome: 'loss', profit: -1 },
            { tickIndex: 17, outcome: 'win', profit: 1 },
            { tickIndex: 18, outcome: 'win', profit: 1 },
            { tickIndex: 19, outcome: 'loss', profit: -1 },
        ]),
    }),
    outOfSample: Object.freeze({
        id: 'adaptive-momentum-out-of-sample-2026-09-09',
        label: 'Out-of-sample session',
        capturedAt: '2026-09-09',
        ticks: Object.freeze(
            makeTicks(1788912000, [
                120, 119, 118, 117, 116, 115, 114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103,
                102, 101,
            ])
        ),
        settlements: Object.freeze([
            { tickIndex: 9, outcome: 'loss', profit: -1 },
            { tickIndex: 10, outcome: 'loss', profit: -1 },
            { tickIndex: 11, outcome: 'win', profit: 1 },
            { tickIndex: 12, outcome: 'loss', profit: -1 },
            { tickIndex: 13, outcome: 'loss', profit: -1 },
            { tickIndex: 14, outcome: 'win', profit: 1 },
            { tickIndex: 15, outcome: 'loss', profit: -1 },
            { tickIndex: 16, outcome: 'win', profit: 1 },
            { tickIndex: 17, outcome: 'loss', profit: -1 },
            { tickIndex: 18, outcome: 'loss', profit: -1 },
            { tickIndex: 19, outcome: 'win', profit: 1 },
        ]),
    }),
});
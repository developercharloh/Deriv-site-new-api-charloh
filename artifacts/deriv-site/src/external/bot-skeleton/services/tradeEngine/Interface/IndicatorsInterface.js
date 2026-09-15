import {
    adxSnapshot,
    aroonSnapshot,
    bollingerBands as bb,
    bollingerBandsArray as bba,
    bollingerSnapshot,
    exponentialMovingAverage as ema,
    exponentialMovingAverageArray as emaa,
    ichimokuSnapshot,
    isIndicatorReady,
    macdArray as macda,
    macdCross,
    macdSnapshot,
    modelConfidence,
    modelSignal,
    relativeStrengthIndex as rsi,
    relativeStrengthIndexArray as rsia,
    rsiCross,
    rsiSnapshot,
    simpleMovingAverage as sma,
    simpleMovingAverageArray as smaa,
    atrSnapshot,
    stochasticSnapshot,
} from '@/external/indicators/index';

const decorate = (f, input, tradeEngine, config, ...args) => {
    const pipSize = tradeEngine.getPipSize();
    return f(input, { pipSize, ...config }, ...args);
};

const getIndicatorsInterface = tradeEngine => {
    const pipSize = tradeEngine.getPipSize();
    const safeNumber = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
    const snapshotValue = (snapshot, component) => safeNumber(snapshot?.[component]);

    return {
        sma: (input, periods) => decorate(sma, input, tradeEngine, { periods }),
        smaa: (input, periods) => decorate(smaa, input, tradeEngine, { periods }),
        ema: (input, periods) => decorate(ema, input, tradeEngine, { periods }),
        emaa: (input, periods) => decorate(emaa, input, tradeEngine, { periods }),
        rsi: (input, periods) => decorate(rsi, input, tradeEngine, { periods }),
        rsia: (input, periods) => decorate(rsia, input, tradeEngine, { periods }),
        bb: (input, config, field) => decorate(bb, input, tradeEngine, config)[field],
        bba: (input, config, field) => decorate(bba, input, tradeEngine, config).map(r => r[field]),
        macda: (input, config, field) => decorate(macda, input, tradeEngine, config).map(r => r[field]),
        getAroonValue: (input, periods, component) =>
            snapshotValue(aroonSnapshot(input, { periods, pipSize }), component),
        getIchimokuValue: (input, conversionPeriods, basePeriods, spanPeriods, component) =>
            snapshotValue(
                ichimokuSnapshot(input, {
                    conversionPeriods,
                    basePeriods,
                    spanPeriods,
                    pipSize,
                }),
                component
            ),
        getAdxValue: (input, periods, component) => snapshotValue(adxSnapshot(input, { periods, pipSize }), component),
        getAtrValue: (input, periods) => safeNumber(atrSnapshot(input, { periods, pipSize })),
        getStochasticValue: (input, periods, signalPeriods, component) =>
            snapshotValue(stochasticSnapshot(input, { periods, signalPeriods, pipSize }), component),
        getMacdValue: (input, fastEmaPeriod, slowEmaPeriod, signalEmaPeriod, component) =>
            snapshotValue(macdSnapshot(input, { fastEmaPeriod, slowEmaPeriod, signalEmaPeriod, pipSize }), component),
        isMacdCross: (input, fastEmaPeriod, slowEmaPeriod, signalEmaPeriod, direction) =>
            macdCross(input, { fastEmaPeriod, slowEmaPeriod, signalEmaPeriod, pipSize }, direction),
        getRsiValue: (input, periods) => safeNumber(rsiSnapshot(input, { periods, pipSize })),
        isRsiCross: (input, periods, level, direction) => rsiCross(input, { periods, pipSize }, level, direction),
        getBollingerValue: (input, periods, stdDevUp, stdDevDown, component) =>
            snapshotValue(
                bollingerSnapshot(input, {
                    periods,
                    stdDevUp,
                    stdDevDown,
                    pipSize,
                }),
                component
            ),
        isBollingerSqueeze: (input, periods, stdDevUp, stdDevDown, maxWidth) => {
            const snapshot = bollingerSnapshot(input, { periods, stdDevUp, stdDevDown, pipSize });
            return snapshot !== null && snapshot.width <= Number(maxWidth);
        },
        isIndicatorReady: (input, periods, minimumExtra) => isIndicatorReady(input, periods, minimumExtra),
        getModelConfidence: (bullishScore, bearishScore) => modelConfidence(bullishScore, bearishScore),
        getModelSignal: (bullishScore, bearishScore, minimumEdge) =>
            modelSignal(bullishScore, bearishScore, minimumEdge),
    };
};

export default getIndicatorsInterface;

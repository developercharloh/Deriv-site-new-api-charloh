const getTicksInterface = tradeEngine => {
    return {
        getDelayTickValue: (...args) => tradeEngine.getDelayTickValue(...args),
        getCurrentStat: (...args) => tradeEngine.getCurrentStat(...args),
        getStatList: (...args) => tradeEngine.getStatList(...args),
        getLastTick: (...args) => tradeEngine.getLastTick(...args),
        getLastDigit: (...args) => tradeEngine.getLastDigit(...args),
        getTicks: (...args) => tradeEngine.getTicks(...args),
        checkDirection: (...args) => tradeEngine.checkDirection(...args),
        getOhlcFromEnd: (...args) => tradeEngine.getOhlcFromEnd(...args),
        getOhlc: (...args) => tradeEngine.getOhlc(...args),
        getLastDigitList: (...args) => tradeEngine.getLastDigitList(...args),
        checkLastDigitsCondition: (...args) => tradeEngine.checkLastDigitsCondition(...args),
        checkSmartOver2Entry: (...args) => tradeEngine.checkSmartOver2Entry(...args),
        // This Promise<boolean> gate must use the tick interface so the interpreter
        // wraps it as an async function before Blockly evaluates its condition.
        checkEvenOddStrikeEagleVirtualHook: (...args) =>
            tradeEngine.checkEvenOddStrikeEagleVirtualHook(...args),
        getMostFrequentDigit: (...args) => tradeEngine.getMostFrequentDigit(...args),
        getDigitPercentage: (...args) => tradeEngine.getDigitPercentage(...args),
        getParityPercentage: (...args) => tradeEngine.getParityPercentage(...args),
        getBarrierPercentage: (...args) => tradeEngine.getBarrierPercentage(...args),
        getDirectionPercentage: (...args) => tradeEngine.getDirectionPercentage(...args),
        getSignalConfidence: (...args) => tradeEngine.getSignalConfidence(...args),
        getSignalConfidenceGate: (...args) => tradeEngine.getSignalConfidenceGate(...args),
        getVolatilitySelectionSignal: (...args) => tradeEngine.getVolatilitySelectionSignal(...args),
        scanVolatilityUntilQualified: (...args) => tradeEngine.scanVolatilityUntilQualified(...args),
         scanVolatilityUntilIndicatorsPass: (...args) => tradeEngine.scanVolatilityUntilIndicatorsPass(...args),
        checkLastNTicksDirection: (...args) => tradeEngine.checkLastNTicksDirection(...args),
        getAdaptiveMomentumSignal: (...args) => tradeEngine.getAdaptiveMomentumSignal(...args),
        getNthLastDigit: (...args) => tradeEngine.getNthLastDigit(...args),
    };
};

export default getTicksInterface;

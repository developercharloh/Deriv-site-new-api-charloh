import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import { discoverVolatilitySymbols, getMetadataSymbolCode, type SyntheticSymbol } from './market-catalog';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import {
    DTraderEngine,
    type DTBuyFeedback,
    type DTConfig,
    type DTBuyGuard,
    type DTPosition,
    type DTStatus,
    getPayoutMultiplier,
} from '@/utils/dtrader-engine';
import {
    NEXUS_MARKET_OPTION_GROUPS,
    NEXUS_PURCHASE_MARKET_OPTION_GROUPS,
    evaluateNexusQuoteGate,
    getNexusStakeForLossStreak,
    isNexusExecutionDecisionAllowed,
    isNexusDigitEvidenceQualified,
    isNexusDigitDecisionQualified,
    marketConditionLabel,
    purchaseMarketLabel,
    NEXUS_DEFAULT_PAYOUT_FLOOR,
    selectAdaptiveDigitMarketPlan,
    selectBestAvailableDigitFallback,
    selectNextNexusDecision,
    selectNexusAutomaticCandidates,
    purchaseMarketFromDecision,
    strategyContractDisplayLabel,
    type MarketCondition,
    type PurchaseMarket,
    type RankedMarketDecision,
    type StrategySource,
    type AdaptiveDigitMarketPlan,
    quotesToLastDigits,
    selectConfiguredMarket,
    selectStrongestMarket,
    withPurchaseMarket,
} from './alpha-market-strategy';
import './alpha-scan-ai.scss';

const DERIV_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const SCAN_TIMEOUT_MS = 35_000;
const SHORT_RETURN_WINDOW = 20;
const SYMBOL_PAGE_SIZE = 1;
const MODEL_VERSION = 'feature-logistic-causal-denoise-v1';
const MIN_VALIDATION_SAMPLES = 200;
const MIN_ACCURACY = 0.51;
const MAX_BRIER_SCORE = 0.26;
const MAX_CALIBRATION_ERROR = 0.08;
const MIN_WINDOW_ACCURACY = 0.49;
const VALIDATION_WINDOW_COUNT = 3;
const CALIBRATION_BIN_COUNT = 5;
const FEATURE_WARMUP = 50;
const FEATURE_MIN_TRAINING_SAMPLES = 120;
const FEATURE_RETRAIN_INTERVAL = 80;
const FEATURE_TRAINING_ITERATIONS = 45;
const FEATURE_LEARNING_RATE = 0.08;
const FEATURE_L2_PENALTY = 0.02;
const FEATURE_WINDOWS = [3, 5, 10, 20, 50];
const MAX_NOISE_FRACTION = 0.65;
const UNAVAILABLE_MARKET_TTL_MS = 5 * 60_000;
const LOW_PAYOUT_MARKET_TTL_MS = 60_000;
const UNAVAILABLE_DIGIT_CONTRACT_PATTERN = /contract(?:notallowed|notallowed|validation|forbidden)|market(?:closed|unavailable)|not permitted|contract type.*(?:not|unavailable)|invalid contract/i;

const isUnavailableDigitContractFeedback = (feedback: DTBuyFeedback): boolean =>
    Boolean(feedback.code && /contract|market/i.test(feedback.code)) ||
    UNAVAILABLE_DIGIT_CONTRACT_PATTERN.test(feedback.message);

type SampleSize = 300 | 600 | 1200;
type ScanStatus =
    | 'idle'
    | 'discovering'
    | 'collecting'
    | 'ready'
    | 'empty'
    | 'timeout'
    | 'connection-error'
    | 'partial-data';
type DiscoverySource = 'public-metadata' | 'verified-catalog' | 'fixture';
type FailurePhase = 'Metadata discovery' | 'History collection' | 'Symbol history';

type ScanRow = SyntheticSymbol & {
    prices: number[];
    lastDigits: number[];
    pipSize: number;
    sampleSize: number;
    latestPrice: number;
    shortReturn: number;
    realizedVolatility: number;
    noiseFraction: number;
    directionalImbalance: number;
    reversalRate: number;
    regime: string;
    baselineProbability: number;
    walkForwardAccuracy: number;
    brierScore: number;
    validationSamples: number;
    climatologyBrierScore: number;
    benchmarkAccuracy: number;
    benchmarkBrierScore: number;
    calibrationError: number;
    validationWindows: ValidationWindow[];
    validationGate: ValidationGate;
    gateReasons: string[];
};

type AlphaTradeJournalEntry = {
    contractId: string;
    leg: 'primary' | 'recovery';
    time: string;
    symbol: string;
    price: string | null;
    entryPrice: string | null;
    exitPrice: string | null;
    market: string;
    strategy: string;
    gate: 'Running' | 'Won' | 'Lost';
    stake: number;
    payout: number;
    profit: number | null;
};

type ValidationWindow = {
    samples: number;
    accuracy: number;
    brierScore: number;
};

type ValidationGate = 'insufficient-evidence' | 'failed' | 'validated';

type WebSocketMessage = {
    msg_type?: string;
    req_id?: number;
    error?: { message?: string };
    active_symbols?: Array<Record<string, unknown>>;
    history?: { prices?: Array<number | string> };
    pip_size?: number | string;
    echo_req?: { symbol?: string; active_symbols?: string };
};

const buildFixtureRows = (
    sampleSize: SampleSize,
    autoRunnerFixture = false,
    confirmationFixtureMode: AlphaConfirmationFixture = null,
): ScanRow[] => {
    const fixtureSymbols = DERIV_VOLATILITIES.map((index, symbolIndex) => ({
        symbol: index.code,
        displayName: index.label,
        submarket: index.tickEvery === 1 ? 'Continuous Indices' : 'Standard Indices',
        digitPattern: symbolIndex % 2 === 0 ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9],
        status: 'open' as const,
    }));
    const forceDigitFallback = autoRunnerFixture && confirmationFixtureMode === 'route-change';
    const nexusMomentumFixture = autoRunnerFixture &&
        (confirmationFixtureMode === 'nexus-call' || confirmationFixtureMode === 'nexus-put');
    const nexusMomentumDirection = confirmationFixtureMode === 'nexus-put' ? -1 : 1;

    return fixtureSymbols.map((fixture, symbolIndex) => {
        const pipSize = 2;
        const prices = Array.from({ length: sampleSize }, (_, index) => {
            if (forceDigitFallback) {
                return Number((100 + symbolIndex * 25 + fixture.digitPattern[0] / 100).toFixed(2));
            }
            if (nexusMomentumFixture) {
                if (symbolIndex !== 0) return 100 + symbolIndex * 25;
                return Number((100 + nexusMomentumDirection * index * 0.02).toFixed(2));
            }
            if (autoRunnerFixture && symbolIndex === 0 && index >= sampleSize - 40) {
                return 100 + index * 0.01;
            }
            const digit = fixture.digitPattern[(index + symbolIndex) % fixture.digitPattern.length];
            const wholePart = 100 + symbolIndex * 25 + Math.floor(index / 100);
            return Number(`${wholePart}.${String(digit).padStart(2, '0')}`);
        });
        const lastDigits = quotesToLastDigits(prices, pipSize);
        const shortReturn = (prices[prices.length - 1] - prices[prices.length - SHORT_RETURN_WINDOW - 1]) /
            prices[prices.length - SHORT_RETURN_WINDOW - 1] * 100;

        return {
            symbol: fixture.symbol,
            displayName: fixture.displayName,
            market: 'Derived',
            submarket: fixture.submarket,
            status: fixture.status,
            pipSize,
            prices,
            lastDigits,
            sampleSize,
            latestPrice: prices[prices.length - 1],
            shortReturn,
            realizedVolatility: 0.12 + symbolIndex * 0.04,
            noiseFraction: 0.08 + symbolIndex * 0.01,
            directionalImbalance: symbolIndex % 2 === 0 ? 0.12 : -0.12,
            reversalRate: 0.34 + symbolIndex * 0.03,
            regime: symbolIndex % 2 === 0 ? 'Rising drift' : 'Mixed movement',
            baselineProbability: 0.48 + symbolIndex * 0.01,
            walkForwardAccuracy: 0.5,
            brierScore: 0.25,
            validationSamples: sampleSize - FEATURE_WARMUP,
            climatologyBrierScore: 0.249,
            benchmarkAccuracy: 0.51,
            benchmarkBrierScore: 0.249,
            calibrationError: 0.04,
            validationWindows: [
                { samples: Math.floor((sampleSize - FEATURE_WARMUP) / 3), accuracy: 0.5, brierScore: 0.25 },
                { samples: Math.floor((sampleSize - FEATURE_WARMUP) / 3), accuracy: 0.5, brierScore: 0.25 },
                { samples: Math.ceil((sampleSize - FEATURE_WARMUP) / 3), accuracy: 0.5, brierScore: 0.25 },
            ],
            validationGate: 'failed',
            gateReasons: ['Deterministic fixture data is for layout checks only; live validation was not performed.'],
        };
    });
};

const mean = (values: number[]): number =>
    values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

const median = (values: number[]): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const causalDenoiseReturns = (returns: number[]): number[] =>
    returns.map((_, index) => median(returns.slice(Math.max(0, index - 2), index + 1)));

const calculateNoiseFraction = (returns: number[], denoisedReturns: number[]): number => {
    const residualMagnitude = mean(returns.map((value, index) => Math.abs(value - denoisedReturns[index])));
    const signalMagnitude = mean(denoisedReturns.map(value => Math.abs(value)));
    return residualMagnitude + signalMagnitude
        ? residualMagnitude / (residualMagnitude + signalMagnitude)
        : 0;
};

type Prediction = { probability: number; actual: number };

type ValidationSummary = {
    baselineProbability: number;
    walkForwardAccuracy: number;
    brierScore: number;
    validationSamples: number;
    climatologyBrierScore: number;
    calibrationError: number;
    validationWindows: ValidationWindow[];
    validationGate: ValidationGate;
    gateReasons: string[];
};

const summarizePredictions = (
    predictions: Prediction[],
    benchmark?: { accuracy: number; brierScore: number },
): Omit<ValidationSummary, 'baselineProbability'> => {
    const validationSamples = predictions.length;
    const positiveRate = mean(predictions.map(prediction => prediction.actual));
    const accuracy = predictions.length
        ? mean(predictions.map(prediction => (prediction.probability >= 0.5 ? 1 : 0) === prediction.actual ? 1 : 0))
        : 0;
    const brierScore = predictions.length
        ? mean(predictions.map(prediction => (prediction.probability - prediction.actual) ** 2))
        : 0;
    const climatologyBrierScore = predictions.length
        ? mean(predictions.map(prediction => (positiveRate - prediction.actual) ** 2))
        : 0;
    const calibrationError = validationSamples
        ? Array.from({ length: CALIBRATION_BIN_COUNT }, (_, binIndex) => {
            const lower = binIndex / CALIBRATION_BIN_COUNT;
            const upper = (binIndex + 1) / CALIBRATION_BIN_COUNT;
            const bin = predictions.filter(({ probability }) =>
                probability >= lower && (binIndex === CALIBRATION_BIN_COUNT - 1 ? probability <= upper : probability < upper),
            );
            if (!bin.length) return 0;
            return (bin.length / validationSamples) * Math.abs(
                mean(bin.map(prediction => prediction.probability)) - mean(bin.map(prediction => prediction.actual)),
            );
        }).reduce((total, value) => total + value, 0)
        : 0;
    const windowSize = Math.max(1, Math.ceil(validationSamples / VALIDATION_WINDOW_COUNT));
    const validationWindows = Array.from({ length: VALIDATION_WINDOW_COUNT }, (_, windowIndex) => {
        const window = predictions.slice(windowIndex * windowSize, (windowIndex + 1) * windowSize);
        return {
            samples: window.length,
            accuracy: window.length
                ? mean(window.map(prediction => (prediction.probability >= 0.5 ? 1 : 0) === prediction.actual ? 1 : 0))
                : 0,
            brierScore: window.length
                ? mean(window.map(prediction => (prediction.probability - prediction.actual) ** 2))
                : 0,
        };
    });
    const gateReasons: string[] = [];
    if (validationSamples < MIN_VALIDATION_SAMPLES) {
        gateReasons.push(`Needs ${MIN_VALIDATION_SAMPLES} validation ticks; received ${validationSamples}.`);
    }
    if (accuracy < MIN_ACCURACY) {
        gateReasons.push(`Accuracy ${formatPercent(accuracy * 100)} is below the ${formatPercent(MIN_ACCURACY * 100)} gate.`);
    }
    if (brierScore >= MAX_BRIER_SCORE || brierScore >= climatologyBrierScore) {
        gateReasons.push('Brier score does not beat the climatology baseline.');
    }
    if (benchmark && (accuracy <= benchmark.accuracy || brierScore >= benchmark.brierScore)) {
        gateReasons.push('The feature model does not improve on the empirical baseline.');
    }
    if (calibrationError > MAX_CALIBRATION_ERROR) {
        gateReasons.push(`Calibration error ${formatPercent(calibrationError * 100)} exceeds the ${formatPercent(MAX_CALIBRATION_ERROR * 100)} gate.`);
    }
    if (validationWindows.some(window => window.samples > 0 && window.accuracy < MIN_WINDOW_ACCURACY)) {
        gateReasons.push('Accuracy is unstable across at least one chronological validation window.');
    }

    return {
        walkForwardAccuracy: accuracy,
        brierScore,
        validationSamples,
        climatologyBrierScore,
        calibrationError,
        validationWindows,
        validationGate: !validationSamples || validationSamples < MIN_VALIDATION_SAMPLES
            ? 'insufficient-evidence'
            : gateReasons.length
                ? 'failed'
                : 'validated',
        gateReasons,
    };
};

const calculateWalkForwardBaseline = (returns: number[], validationStart = 40) => {
    const minimumTrainingWindow = 40;
    const trainingLookback = 100;
    const predictions: Prediction[] = [];
    let latestProbability = 0.5;

    for (let index = Math.max(minimumTrainingWindow, validationStart); index < returns.length; index += 1) {
        const trainingReturns = returns.slice(Math.max(0, index - trainingLookback), index);
        const positiveMoves = trainingReturns.filter(value => value > 0).length;
        const probability = (positiveMoves + 1) / (trainingReturns.length + 2);
        const actual = returns[index] > 0 ? 1 : 0;

        latestProbability = probability;
        predictions.push({ probability, actual });
    }

    return {
        baselineProbability: latestProbability,
        predictions,
    };
};

type FeatureRow = {
    index: number;
    features: number[];
    actual: number;
};

type LogisticModel = {
    weights: number[];
    bias: number;
    means: number[];
    scales: number[];
};

type CalibratedLogisticModel = {
    model: LogisticModel;
    slope: number;
    intercept: number;
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value))));
const logit = (probability: number): number => Math.log(
    Math.max(0.0001, Math.min(0.9999, probability)) /
    Math.max(0.0001, Math.min(0.9999, 1 - probability)),
);

const buildFeatureVector = (returns: number[], index: number): number[] => {
    const values: number[] = [];

    FEATURE_WINDOWS.forEach(windowSize => {
        const window = returns.slice(Math.max(0, index - windowSize), index);
        const average = mean(window);
        const variance = mean(window.map(value => (value - average) ** 2));
        const volatility = Math.sqrt(variance) || 1e-8;
        const positiveRate = window.length ? window.filter(value => value > 0).length / window.length : 0.5;

        values.push(
            average / volatility,
            volatility,
            (positiveRate - 0.5) * 2,
        );
    });

    const latestReturn = returns[index - 1] || 0;
    const recentVolatility = Math.sqrt(mean(
        returns.slice(Math.max(0, index - 20), index).map(value => (value - mean(returns.slice(Math.max(0, index - 20), index))) ** 2),
    )) || 1e-8;
    let streak = 0;
    const latestSign = Math.sign(latestReturn);
    for (let cursor = index - 1; cursor >= 0 && Math.sign(returns[cursor]) === latestSign; cursor -= 1) {
        if (latestSign === 0) break;
        streak += latestSign;
    }

    const autocorrelationWindow = returns.slice(Math.max(1, index - 20), index);
    const laggedWindow = returns.slice(Math.max(0, index - 21), index - 1);
    const meanCurrent = mean(autocorrelationWindow);
    const meanLagged = mean(laggedWindow);
    const autocorrelationDenominator = Math.sqrt(
        mean(autocorrelationWindow.map(value => (value - meanCurrent) ** 2)) *
        mean(laggedWindow.map(value => (value - meanLagged) ** 2)),
    );
    const autocorrelation = autocorrelationDenominator
        ? mean(autocorrelationWindow.map((value, offset) => (value - meanCurrent) * ((laggedWindow[offset] || 0) - meanLagged))) /
            autocorrelationDenominator
        : 0;

    values.push(
        latestReturn / recentVolatility,
        streak / 10,
        autocorrelation,
    );

    return values.map(value => Number.isFinite(value) ? value : 0);
};

const fitLogisticRegression = (samples: FeatureRow[]): LogisticModel | null => {
    if (!samples.length) return null;

    const featureCount = samples[0].features.length;
    const means = Array.from({ length: featureCount }, (_, featureIndex) =>
        mean(samples.map(sample => sample.features[featureIndex])),
    );
    const scales = Array.from({ length: featureCount }, (_, featureIndex) => {
        const variance = mean(samples.map(sample => (sample.features[featureIndex] - means[featureIndex]) ** 2));
        return Math.sqrt(variance) || 1;
    });
    const weights = Array.from({ length: featureCount }, () => 0);
    let bias = Math.log((mean(samples.map(sample => sample.actual)) + 0.01) / (1.01 - mean(samples.map(sample => sample.actual))));

    for (let iteration = 0; iteration < FEATURE_TRAINING_ITERATIONS; iteration += 1) {
        const weightGradient = Array.from({ length: featureCount }, () => 0);
        let biasGradient = 0;

        samples.forEach(sample => {
            const normalized = sample.features.map((value, featureIndex) =>
                (value - means[featureIndex]) / scales[featureIndex],
            );
            const probability = sigmoid(bias + normalized.reduce((total, value, featureIndex) => total + value * weights[featureIndex], 0));
            const error = probability - sample.actual;
            biasGradient += error;
            normalized.forEach((value, featureIndex) => {
                weightGradient[featureIndex] += error * value;
            });
        });

        const sampleCount = samples.length;
        bias -= FEATURE_LEARNING_RATE * (biasGradient / sampleCount);
        weightGradient.forEach((gradient, featureIndex) => {
            weights[featureIndex] -= FEATURE_LEARNING_RATE * (
                gradient / sampleCount + FEATURE_L2_PENALTY * weights[featureIndex]
            );
        });
    }

    return { weights, bias, means, scales };
};

const predictLogisticRegression = (model: LogisticModel, features: number[]): number => {
    const normalized = features.map((value, featureIndex) =>
        (value - model.means[featureIndex]) / model.scales[featureIndex],
    );
    return sigmoid(model.bias + normalized.reduce((total, value, featureIndex) => total + value * model.weights[featureIndex], 0));
};

const fitCalibratedLogisticRegression = (samples: FeatureRow[]): CalibratedLogisticModel | null => {
    if (!samples.length) return null;

    const calibrationStart = Math.max(40, Math.floor(samples.length * 0.7));
    const model = fitLogisticRegression(samples.slice(0, calibrationStart));
    const calibrationSamples = samples.slice(calibrationStart);
    if (!model || !calibrationSamples.length) return model ? { model, slope: 1, intercept: 0 } : null;

    let slope = 1;
    let intercept = 0;
    for (let iteration = 0; iteration < FEATURE_TRAINING_ITERATIONS; iteration += 1) {
        let slopeGradient = 0;
        let interceptGradient = 0;

        calibrationSamples.forEach(sample => {
            const rawProbability = predictLogisticRegression(model, sample.features);
            const probability = sigmoid(slope * logit(rawProbability) + intercept);
            const error = probability - sample.actual;
            slopeGradient += error * logit(rawProbability);
            interceptGradient += error;
        });

        slope -= FEATURE_LEARNING_RATE * (slopeGradient / calibrationSamples.length);
        intercept -= FEATURE_LEARNING_RATE * (interceptGradient / calibrationSamples.length);
    }

    return { model, slope, intercept };
};

const predictCalibratedLogisticRegression = (model: CalibratedLogisticModel, features: number[]): number => {
    const rawProbability = predictLogisticRegression(model.model, features);
    return sigmoid(model.slope * logit(rawProbability) + model.intercept);
};

const calculateFeatureModel = (returns: number[], noiseFraction: number): ValidationSummary => {
    const featureRows: FeatureRow[] = [];
    for (let index = FEATURE_WARMUP; index < returns.length; index += 1) {
        featureRows.push({
            index,
            features: buildFeatureVector(returns, index),
            actual: returns[index] > 0 ? 1 : 0,
        });
    }

    const validationStart = FEATURE_WARMUP + FEATURE_MIN_TRAINING_SAMPLES;
    const validationRows = featureRows.filter(row => row.index >= validationStart);
    const predictions: Prediction[] = [];
    let model: CalibratedLogisticModel | null = null;
    let lastFitIndex = -Infinity;
    let latestProbability = 0.5;

    validationRows.forEach(row => {
        if (!model || row.index - lastFitIndex >= FEATURE_RETRAIN_INTERVAL) {
            model = fitCalibratedLogisticRegression(featureRows.filter(trainingRow => trainingRow.index < row.index));
            lastFitIndex = row.index;
        }
        if (!model) return;

        latestProbability = predictCalibratedLogisticRegression(model, row.features);
        predictions.push({ probability: latestProbability, actual: row.actual });
    });

    const empiricalSummary = summarizePredictions(
        calculateWalkForwardBaseline(returns, validationStart).predictions,
    );

    const summary: ValidationSummary = {
        baselineProbability: latestProbability,
        ...summarizePredictions(predictions, {
            accuracy: empiricalSummary.walkForwardAccuracy,
            brierScore: empiricalSummary.brierScore,
        }),
    };

    if (noiseFraction > MAX_NOISE_FRACTION) {
        summary.gateReasons.push(
            `Tick noise fraction ${formatPercent(noiseFraction * 100)} exceeds the ${formatPercent(MAX_NOISE_FRACTION * 100)} denoising gate.`,
        );
        if (summary.validationGate === 'validated') summary.validationGate = 'failed';
    }

    return summary;
};

const calculateMetrics = (prices: number[]): Omit<ScanRow, keyof SyntheticSymbol | 'prices' | 'lastDigits' | 'pipSize'> => {
    const returns = prices
        .slice(1)
        .map((price, index) => (prices[index] > 0 && price > 0 ? Math.log(price / prices[index]) : 0));
    const denoisedReturns = causalDenoiseReturns(returns);
    const noiseFraction = calculateNoiseFraction(returns, denoisedReturns);
    const averageReturn = mean(denoisedReturns);
    const variance = mean(denoisedReturns.map(value => (value - averageReturn) ** 2));
    const positiveMoves = denoisedReturns.filter(value => value > 0).length;
    const negativeMoves = denoisedReturns.filter(value => value < 0).length;
    const directionalMoves = positiveMoves + negativeMoves;
    const reversals = denoisedReturns.slice(1).filter((value, index) =>
        value !== 0 && denoisedReturns[index] !== 0 && Math.sign(value) !== Math.sign(denoisedReturns[index]),
    ).length;
    const shortBase = prices[Math.max(0, prices.length - SHORT_RETURN_WINDOW - 1)] || prices[0] || 0;
    const shortReturn = shortBase ? ((prices[prices.length - 1] - shortBase) / shortBase) * 100 : 0;
    const directionalImbalance = directionalMoves ? (positiveMoves - negativeMoves) / directionalMoves : 0;
    const reversalRate = denoisedReturns.length > 1 ? reversals / (denoisedReturns.length - 1) : 0;
    const validationStart = FEATURE_WARMUP + FEATURE_MIN_TRAINING_SAMPLES;
    const empiricalSummary = summarizePredictions(calculateWalkForwardBaseline(denoisedReturns, validationStart).predictions);
    const featureModel = calculateFeatureModel(denoisedReturns, noiseFraction);

    let regime = 'Mixed movement';
    if (directionalImbalance > 0.18 && shortReturn > 0.1) regime = 'Rising drift';
    else if (directionalImbalance < -0.18 && shortReturn < -0.1) regime = 'Falling drift';
    else if (reversalRate > 0.48) regime = 'Mean-reverting';
    else if (Math.abs(directionalImbalance) > 0.2) regime = 'Directional, uneven';

    return {
        sampleSize: prices.length,
        latestPrice: prices[prices.length - 1] || 0,
        shortReturn,
        realizedVolatility: Math.sqrt(variance) * 100,
        noiseFraction,
        directionalImbalance,
        reversalRate,
        regime,
        ...featureModel,
        benchmarkAccuracy: empiricalSummary.walkForwardAccuracy,
        benchmarkBrierScore: empiricalSummary.brierScore,
    };
};

const formatPrice = (value: number): string =>
    value.toLocaleString(undefined, { maximumFractionDigits: 8, minimumFractionDigits: 0 });

const formatPercent = (value: number, signed = false): string => {
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(2)}%`;
};

const formatRatio = (value: number, signed = false): string => {
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(2)}`;
};

const formatMoney = (value: number | null): string =>
    value === null || !Number.isFinite(value) ? '—' : `$${value.toFixed(2)}`;

const createExplicitPurchaseDecision = (
    source: StrategySource,
    windowSize: number,
    condition: MarketCondition,
    purchaseMarket: PurchaseMarket,
): RankedMarketDecision => withPurchaseMarket({
    condition,
    label: marketConditionLabel(condition),
    contractType: 'DIGITEVEN',
    barrier: null,
    digits: source.lastDigits.slice(-windowSize),
    strength: 0,
    reason: 'Explicit Run action using the selected purchase market.',
    symbol: source.symbol,
    displayName: source.displayName,
}, purchaseMarket);

const formatTime = (value: Date | null): string =>
    value
        ? value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'Not captured';

const statusCopy: Record<ScanStatus, string> = {
    idle: 'Ready for a statistical scan',
    discovering: 'Reading public market metadata',
    collecting: 'Collecting historical observations',
    ready: 'Snapshot and validation ready',
    empty: 'No eligible synthetic symbols found',
    timeout: 'The public data request timed out',
    'connection-error': 'Could not reach the public market feed',
    'partial-data': 'Snapshot ready with incomplete coverage',
};

type AlphaExecutionEngine = {
    onStatus: (status: DTStatus) => void;
    onBuyFeedback: (feedback: DTBuyFeedback) => void;
    onPosition: (position: DTPosition) => void;
    onPriceWindow: (prices: number[], pipSize: number | undefined, isFreshTick: boolean) => void;
    start: (config: DTConfig) => boolean;
    stop: () => void;
    updateConfig: (patch: Partial<DTConfig>) => void;
    placeBuyNow: (patch: Partial<DTConfig>) => void;
    setBuyGuard: (guard: DTBuyGuard | null) => void;
};

type AlphaRiskFixture = 'target' | 'stop-loss' | 'consecutive-losses' | 'trade-count';
type AlphaConfirmationFixture =
    | 'reverse'
    | 'route-change'
    | 'nexus-digits'
    | 'repeated-price-ticks'
    | 'mismatch-then-match-ticks'
    | 'evidence-decay'
    | 'nexus-call'
    | 'nexus-put'
    | null;
type AlphaUnavailableContractFixture = 'once' | null;
type AlphaRecoveryFixture = 'loss' | null;
type NexusSession = {
    baseStake: number;
    currentStake: number;
    sessionProfit: number;
    trades: number;
    consecutiveLosses: number;
    nextLeg: 'primary' | 'recovery';
    lastSymbol: string | null;
    lastDecisionKey: string | null;
};
/**
 * The browser regression runs without a Deriv account. This deterministic
 * engine exercises the same Alpha Scan callbacks as DTraderEngine, including
 * fresh price confirmation, one open position, and a later settlement.
 */
class FixtureAlphaExecutionEngine implements AlphaExecutionEngine {
    public onStatus: (status: DTStatus) => void = () => {};
    public onBuyFeedback: (feedback: DTBuyFeedback) => void = () => {};
    public onPosition: (position: DTPosition) => void = () => {};
    public onPriceWindow: (prices: number[], _pipSize: number | undefined, _isFreshTick: boolean) => void = () => {};

    private config: DTConfig | null = null;
    private activePosition: DTPosition | null = null;
    private contractSequence = 0;
    private timers = new Set<ReturnType<typeof setTimeout>>();
    private readonly riskFixtureMode: AlphaRiskFixture | null;
    private readonly confirmationFixtureMode: AlphaConfirmationFixture;
    private readonly unavailableContractFixture: AlphaUnavailableContractFixture;
    private readonly recoveryFixtureMode: AlphaRecoveryFixture;
    private confirmationReversalUsed = false;
    private confirmationEvidenceDecayUsed = false;
    private confirmationRouteChangeUsed = false;
    private unavailableContractUsed = false;
    private buyGuard: DTBuyGuard = () => null;
    private lowPayoutProposalUsed = false;

    constructor(
        riskFixtureMode: AlphaRiskFixture | null = null,
        confirmationFixtureMode: AlphaConfirmationFixture = null,
        unavailableContractFixture: AlphaUnavailableContractFixture = null,
        recoveryFixtureMode: AlphaRecoveryFixture = null,
    ) {
        this.riskFixtureMode = riskFixtureMode;
        this.confirmationFixtureMode = confirmationFixtureMode;
        this.unavailableContractFixture = unavailableContractFixture;
        this.recoveryFixtureMode = recoveryFixtureMode;
    }

    private schedule(callback: () => void, delay: number): void {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            callback();
        }, delay);
        this.timers.add(timer);
    }

    start(config: DTConfig): boolean {
        if (this.activePosition) {
            this.onBuyFeedback({
                seq: Date.now(),
                kind: 'error',
                message: 'A contract is already running.',
            });
            return false;
        }

        this.stop();
        this.config = { ...config };
        this.onStatus('subscribing');
        const routeChangeSeed = this.confirmationFixtureMode === 'route-change';
        const routeChange = routeChangeSeed && !this.confirmationRouteChangeUsed;
        if (routeChange) this.confirmationRouteChangeUsed = true;
        const reverseConfirmation = this.confirmationFixtureMode === 'reverse' && !this.confirmationReversalUsed;
        if (reverseConfirmation) this.confirmationReversalUsed = true;
        const evidenceDecay = this.confirmationFixtureMode === 'evidence-decay' &&
            !this.confirmationEvidenceDecayUsed;
        if (evidenceDecay) this.confirmationEvidenceDecayUsed = true;
        const nexusMomentumFixture = this.confirmationFixtureMode === 'nexus-call' ||
            this.confirmationFixtureMode === 'nexus-put';
        const nexusMomentumDirection = this.confirmationFixtureMode === 'nexus-put' ? -1 : 1;
        const seedLength = 80;
        const seedOffset = routeChangeSeed && !routeChange ? 0.01 : 0;
        let prices = Array.from({ length: seedLength }, (_, index) =>
            Number((100 + nexusMomentumDirection * index * 0.02 + seedOffset).toFixed(2)),
        );
        if (
            config.contractType.startsWith('DIGIT') &&
            !reverseConfirmation &&
            !routeChangeSeed
        ) {
            const barrier = Number(config.barrier);
            const matchingDigit = config.contractType === 'DIGITEVEN'
                ? 8
                : config.contractType === 'DIGITODD'
                    ? 9
                    : config.contractType === 'DIGITOVER'
                        ? Math.min(9, barrier + 1)
                        : config.contractType === 'DIGITUNDER'
                            ? Math.max(0, barrier - 1)
                            : Number.isInteger(barrier) ? barrier : null;
            if (matchingDigit !== null && Number.isFinite(matchingDigit)) {
                prices = Array.from({ length: seedLength }, (_, index) =>
                    Number((100 + index + matchingDigit / 100).toFixed(2)),
                );
            }
        }
        const confirmationDelay = this.riskFixtureMode ? 10 : nexusMomentumFixture ? 250 : 70;

        this.schedule(() => {
            if (!this.config) return;
            this.onStatus('ready');
            this.onPriceWindow(prices, 2, false);
            const confirmationCount = routeChange
                ? 5
                : this.confirmationFixtureMode === 'mismatch-then-match-ticks'
                    ? 4
                    : evidenceDecay ? 1 : 3;
            for (let confirmation = 1; confirmation <= confirmationCount; confirmation += 1) {
                this.schedule(() => {
                    if (!this.config) return;
                    if (reverseConfirmation && confirmation === 1) {
                        const latestPrice = prices[prices.length - 1];
                        prices = [
                            ...prices,
                            ...Array.from({ length: 9 }, (_, index) => latestPrice - (index + 1) * 0.01),
                        ];
                    } else if (routeChange && confirmation === 2) {
                        const latestPrice = prices[prices.length - 1];
                        prices = [
                            ...prices,
                            ...Array.from({ length: 20 }, (_, index) =>
                                Number((latestPrice + 0.03 + index * 0.02).toFixed(2)),
                            ),
                        ];
                    } else if (evidenceDecay && confirmation === 1) {
                        const latestPrice = prices[prices.length - 1];
                        const barrier = Number(this.config.barrier);
                        const matchingDigit = this.config.contractType === 'DIGITEVEN'
                            ? 8
                            : this.config.contractType === 'DIGITODD'
                                ? 9
                                : this.config.contractType === 'DIGITOVER'
                                    ? Math.min(9, barrier + 1)
                                    : Math.max(0, barrier - 1);
                        const mismatchingDigit = this.config.contractType === 'DIGITEVEN'
                            ? 9
                            : this.config.contractType === 'DIGITODD'
                                ? 8
                                : barrier;
                        const nextBase = Math.floor(latestPrice) + 1;
                        prices = [
                            ...prices,
                            ...Array.from({ length: 60 }, (_, index) => {
                                const digit = index % 2 === 0 ? matchingDigit : mismatchingDigit;
                                return Number((nextBase + index + digit / 100).toFixed(2));
                            }),
                        ];
                    } else if (this.confirmationFixtureMode === 'repeated-price-ticks') {
                        prices = [...prices, prices[prices.length - 1]];
                    } else if (this.confirmationFixtureMode === 'mismatch-then-match-ticks') {
                        const latestPrice = prices[prices.length - 1];
                        const barrier = Number(this.config.barrier);
                        const matchingDigit = this.config.contractType === 'DIGITEVEN'
                            ? 8
                            : this.config.contractType === 'DIGITODD'
                                ? 9
                                : this.config.contractType === 'DIGITOVER'
                                    ? Math.min(9, barrier + 1)
                                    : Math.max(0, barrier - 1);
                        const mismatchDigit = this.config.contractType === 'DIGITEVEN'
                            ? 9
                            : this.config.contractType === 'DIGITODD'
                                ? 8
                                : barrier;
                        const nextDigit = confirmation === 1 ? mismatchDigit : matchingDigit;
                        const nextPrice = Math.floor(latestPrice) + 1 + nextDigit / 100;
                        prices = [...prices, Number(nextPrice.toFixed(2))];
                    } else {
                        const latestPrice = prices[prices.length - 1];
                        const increment = routeChangeSeed
                            ? 1
                            : this.confirmationFixtureMode === 'nexus-put'
                                ? -0.01
                                : this.confirmationFixtureMode === 'nexus-call'
                                    ? 0.01
                                    : 1;
                        prices = [...prices, Number((latestPrice + increment).toFixed(2))];
                    }
                    this.onPriceWindow(prices, 2, true);
                }, confirmation * confirmationDelay);
            }
        }, 20);
        return true;
    }

    stop(): void {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        if (!this.activePosition) {
            this.config = null;
            this.onStatus('idle');
        }
    }

    updateConfig(patch: Partial<DTConfig>): void {
        if (this.config) this.config = { ...this.config, ...patch };
    }

    setBuyGuard(guard: DTBuyGuard | null): void {
        this.buyGuard = guard || (() => null);
    }

    placeBuyNow(patch: Partial<DTConfig>): void {
        if (!this.config || this.activePosition) {
            this.onBuyFeedback({
                seq: Date.now(),
                kind: 'error',
                message: 'A contract is already running.',
            });
            return;
        }

        const config = { ...this.config, ...patch };
        const isDigitContract = config.contractType.startsWith('DIGIT');
        if (isDigitContract && this.unavailableContractFixture === 'once' && !this.unavailableContractUsed) {
            this.unavailableContractUsed = true;
            this.onBuyFeedback({
                seq: Date.now(),
                kind: 'error',
                code: 'ContractNotAllowed',
                contractType: config.contractType,
                message: 'Contract type is unavailable for this market.',
            });
            return;
        }
        const payoutMultiplier = this.recoveryFixtureMode === 'loss' && config.stake > 10
            ? 2.2
            : this.lowPayoutProposalUsed
                ? 2
                : 1.6;
        const proposal = {
            id: `fixture-proposal-${this.contractSequence + 1}`,
            askPrice: config.stake,
            payout: config.stake * payoutMultiplier,
            profit: config.stake * (payoutMultiplier - 1),
            profitPct: (payoutMultiplier - 1) * 100,
            longcode: 'Fixture proposal',
            spot: '100.40',
            spotNum: 100.4,
            previewHighBarrier: null,
            previewLowBarrier: null,
            previewStopOut: null,
        };
        const guardMessage = this.buyGuard(proposal);
        this.lowPayoutProposalUsed = true;
        if (guardMessage) {
            this.onBuyFeedback({
                seq: Date.now(),
                kind: 'error',
                message: guardMessage,
            });
            return;
        }
        const contractId = `fixture-${++this.contractSequence}`;
        const payout = proposal.payout;
        const position: DTPosition = {
            contractId,
            contractType: config.contractType,
            barrier: config.barrier,
            symbol: config.symbol,
            stake: config.stake,
            payout,
            buyPrice: config.stake,
            currentSpot: '100.40',
            currentBid: config.stake,
            profit: null,
            isOpen: true,
            isWin: null,
            entrySpot: '100.40',
            exitSpot: null,
            longcode: 'Fixture contract',
            purchaseTime: new Date().toLocaleTimeString(),
            highBarrier: null,
            lowBarrier: null,
            entrySpotNum: 100.4,
            barrierBroken: false,
            stopOutLevel: null,
            takeProfitLevel: null,
            stopLossLevel: null,
        };
        this.config = config;
        this.activePosition = position;
        if (typeof window !== 'undefined') {
            const fixtureWindow = window as Window & {
                __alphaScanFixtureBuyCalls?: Array<{
                    contractType: string;
                    barrier: string | null;
                    symbol: string;
                    stake: number;
                    payoutMultiplier: number;
                    projectedProfit: number;
                }>;
            };
            fixtureWindow.__alphaScanFixtureBuyCalls ??= [];
            fixtureWindow.__alphaScanFixtureBuyCalls.push({
                contractType: config.contractType,
                barrier: config.barrier ?? null,
                symbol: config.symbol,
                stake: config.stake,
                payoutMultiplier,
                projectedProfit: proposal.profit,
            });
        }
        const fixtureOpenDelayMs = 45;
        const fixtureSettlementDelayMs = this.riskFixtureMode ? 100 : this.recoveryFixtureMode ? 300 : 500;
        this.schedule(() => {
            if (!this.activePosition || this.activePosition.contractId !== contractId) return;
            this.onBuyFeedback({
                seq: Date.now(),
                kind: 'success',
                message: `Bought #${contractId}  $${config.stake.toFixed(2)} → payout $${payout.toFixed(2)}`,
            });
            this.onPosition(position);
        }, fixtureOpenDelayMs);
        this.schedule(() => {
            if (!this.activePosition || this.activePosition.contractId !== contractId) return;
            const settlement = this.recoveryFixtureMode === 'loss' && this.contractSequence === 1
                ? { payout: config.stake - 1, profit: -1, isWin: false }
                : this.riskFixtureMode === 'target'
                    ? { payout: config.stake + 8, profit: 8, isWin: true }
                : this.riskFixtureMode === 'stop-loss'
                ? { payout: config.stake - 5, profit: -5, isWin: false }
                : this.riskFixtureMode === 'consecutive-losses'
                    ? { payout: config.stake - 1, profit: -1, isWin: false }
                    : this.riskFixtureMode === 'trade-count'
                        ? { payout: config.stake, profit: 0, isWin: true }
                        : { payout, profit: payout - config.stake, isWin: true };
            this.activePosition = null;
            this.onPosition({
                ...position,
                currentBid: settlement.payout,
                profit: settlement.profit,
                isOpen: false,
                isWin: settlement.isWin,
                exitSpot: settlement.isWin ? '100.45' : '100.35',
            });
        }, fixtureSettlementDelayMs);
    }
}

const Sparkline: React.FC<{ prices: number[]; symbol: string }> = ({ prices, symbol }) => {
    const points = useMemo(() => {
        if (prices.length < 2) return '';
        const window = prices.slice(-36);
        const min = Math.min(...window);
        const max = Math.max(...window);
        const range = max - min || 1;
        return window
            .map((price, index) => `${(index / (window.length - 1)) * 100},${30 - ((price - min) / range) * 24}`)
            .join(' ');
    }, [prices]);

    return (
        <svg className='alpha-scan__sparkline' viewBox='0 0 100 32' role='img' aria-label={`Descriptive price path for ${symbol}`}>
            <line x1='0' y1='30' x2='100' y2='30' className='alpha-scan__sparkline-axis' />
            {points && <polyline points={points} className='alpha-scan__sparkline-line' />}
        </svg>
    );
};

const StatusPill: React.FC<{ status: ScanStatus }> = ({ status }) => (
    <span className={`alpha-scan__status-pill alpha-scan__status-pill--${status}`}>
        <span className='alpha-scan__status-dot' aria-hidden='true' />
        {statusCopy[status]}
    </span>
);

const PremiumAlphaLanding: React.FC = () => (
    <main className='alpha-scan alpha-scan--premium' aria-hidden='true'>
        <section className='alpha-scan__premium-landing'>
            <div className='alpha-scan__premium-grid' />
            <div className='alpha-scan__premium-noise' />
            <div className='alpha-scan__premium-glow alpha-scan__premium-glow--teal' />
            <div className='alpha-scan__premium-glow alpha-scan__premium-glow--gold' />
            <div className='alpha-scan__premium-orbit alpha-scan__premium-orbit--outer' />
            <div className='alpha-scan__premium-orbit alpha-scan__premium-orbit--inner' />
            <div className='alpha-scan__premium-signal'>
                <span className='alpha-scan__premium-signal-core' />
                <span className='alpha-scan__premium-signal-ring alpha-scan__premium-signal-ring--one' />
                <span className='alpha-scan__premium-signal-ring alpha-scan__premium-signal-ring--two' />
                <span className='alpha-scan__premium-signal-ring alpha-scan__premium-signal-ring--three' />
                <span className='alpha-scan__premium-signal-beam alpha-scan__premium-signal-beam--one' />
                <span className='alpha-scan__premium-signal-beam alpha-scan__premium-signal-beam--two' />
                <span className='alpha-scan__premium-signal-beam alpha-scan__premium-signal-beam--three' />
            </div>
            <div className='alpha-scan__premium-wave alpha-scan__premium-wave--one' />
            <div className='alpha-scan__premium-wave alpha-scan__premium-wave--two' />
            <div className='alpha-scan__premium-orb alpha-scan__premium-orb--one' />
            <div className='alpha-scan__premium-orb alpha-scan__premium-orb--two' />
            <div className='alpha-scan__premium-orb alpha-scan__premium-orb--three' />
        </section>
    </main>
);

type AlphaToolSurfaceProps = {
    rows: ScanRow[];
    sampleSize: SampleSize;
    scanCount: number;
    status: ScanStatus;
    scanSource: DiscoverySource;
    executionFixtureMode: boolean;
    confirmationFixtureMode: AlphaConfirmationFixture;
    unavailableContractFixture: AlphaUnavailableContractFixture;
    recoveryFixtureMode: AlphaRecoveryFixture;
    riskFixtureMode: AlphaRiskFixture | null;
    isBusy: boolean;
    lastUpdated: Date | null;
    modelStatus: string;
    averageWalkForwardAccuracy: number;
    averageVolatility: number;
    validatedRows: number;
    discoveredCount: number;
    failedSymbols: string[];
    errorMessage: string;
    onScan: (options?: { preserveExisting?: boolean }) => void;
};

type MarketConditionSelectProps = {
    value: MarketCondition;
    onChange: (value: MarketCondition) => void;
    label: string;
    testId: string;
};

const MarketConditionSelect: React.FC<MarketConditionSelectProps> = ({ value, onChange, label, testId }) => (
    <select
        className='alpha-tool__rule-select alpha-tool__rule-select--market'
        value={value}
        onChange={event => onChange(event.target.value as MarketCondition)}
        aria-label={label}
        data-testid={testId}
    >
        {NEXUS_MARKET_OPTION_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
                {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
        ))}
    </select>
);

type PurchaseMarketSelectProps = {
    value: PurchaseMarket;
    onChange: (value: PurchaseMarket) => void;
    label: string;
    testId: string;
};

const PurchaseMarketSelect: React.FC<PurchaseMarketSelectProps> = ({ value, onChange, label, testId }) => (
    <select
        className='alpha-tool__rule-select alpha-tool__rule-select--market alpha-tool__rule-select--purchase'
        value={value}
        onChange={event => onChange(event.target.value as PurchaseMarket)}
        aria-label={label}
        data-testid={testId}
    >
        {NEXUS_PURCHASE_MARKET_OPTION_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
                {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
        ))}
    </select>
);

const AlphaToolSurface: React.FC<AlphaToolSurfaceProps> = ({
    rows,
    sampleSize,
    scanCount,
    status,
    scanSource,
    executionFixtureMode,
    confirmationFixtureMode,
    unavailableContractFixture,
    recoveryFixtureMode,
    riskFixtureMode,
    isBusy,
    lastUpdated,
    modelStatus,
    averageWalkForwardAccuracy,
    averageVolatility,
    validatedRows,
    discoveredCount,
    failedSymbols,
    errorMessage,
    onScan,
}) => {
    const AUTO_MAX_TRADES = 50;
    const AUTO_MAX_CONSECUTIVE_LOSSES = 3;
    const { client } = useStore();
    const { isAuthorized } = useApiBase();
    const fixtureQuery = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : null;
    const initialFixtureSelection = (key: string, choices: string[], fallback: string): string => {
        const value = executionFixtureMode ? fixtureQuery?.get(key) : null;
        return value && choices.includes(value) ? value : fallback;
    };
    const liveEngineRef = useRef<AlphaExecutionEngine | null>(null);
    if (liveEngineRef.current === null) {
        liveEngineRef.current = executionFixtureMode
            ? new FixtureAlphaExecutionEngine(riskFixtureMode, confirmationFixtureMode, unavailableContractFixture, recoveryFixtureMode)
            : new DTraderEngine();
    }
    const liveEngine = liveEngineRef.current;
    const [selectedSymbol, setSelectedSymbol] = useState('');
    const [digitWindow, setDigitWindow] = useState(3);
    const [recoveryDigitWindow, setRecoveryDigitWindow] = useState(3);
    const [primaryCondition, setPrimaryCondition] = useState<MarketCondition>('all-even');
    const [recoveryCondition, setRecoveryCondition] = useState<MarketCondition>('all-odd');
    const [primaryPurchaseMarket, setPrimaryPurchaseMarket] = useState<PurchaseMarket>('even');
    const [recoveryPurchaseMarket, setRecoveryPurchaseMarket] = useState<PurchaseMarket>('over-4');
    const [recoveryEnabled, setRecoveryEnabled] = useState(true);
    const [multiMarketScanning, setMultiMarketScanning] = useState(true);
    const [autoVolatilityMode, setAutoVolatilityMode] = useState(false);
    const [stake, setStake] = useState('10');
    const [payoutFloor, setPayoutFloor] = useState(() =>
        initialFixtureSelection(
            'alpha_scan_fixture_payout_floor',
            ['1.5', '1.8', '2'],
            String(NEXUS_DEFAULT_PAYOUT_FLOOR),
        ),
    );
    const [targetProfit, setTargetProfit] = useState(() =>
        initialFixtureSelection('alpha_scan_fixture_target_profit', ['10', '15', '25', '50'], '15'),
    );
    const [stopLoss, setStopLoss] = useState(() =>
        initialFixtureSelection('alpha_scan_fixture_stop_loss', ['5', '10', '20', '50'], '5'),
    );
    const [martingale, setMartingale] = useState(() =>
        initialFixtureSelection('alpha_scan_fixture_martingale', ['no', '2', '3'], 'no'),
    );
    const [liveMode, setLiveMode] = useState(true);
    const [liveStatus, setLiveStatus] = useState<DTStatus>('idle');
    const [liveFeedback, setLiveFeedback] = useState<DTBuyFeedback | null>(null);
    const [payoutSkipCount, setPayoutSkipCount] = useState(0);
    const [lastPayoutSkipMessage, setLastPayoutSkipMessage] = useState('');
    const [liveTrade, setLiveTrade] = useState<DTPosition | null>(null);
    const [toolRealizedProfitLoss, setToolRealizedProfitLoss] = useState(0);
    const [liveTradeLeg, setLiveTradeLeg] = useState<'primary' | 'recovery' | null>(null);
    const [liveTradeDecision, setLiveTradeDecision] = useState<RankedMarketDecision | null>(null);
    const [digitFallbackCount, setDigitFallbackCount] = useState(0);
    const [journalRows, setJournalRows] = useState<AlphaTradeJournalEntry[]>([]);
    const [executionLeg, setExecutionLeg] = useState<'idle' | 'primary-pending' | 'primary-running' | 'recovery-pending' | 'recovery-running'>('idle');
    const [nexusSessionActive, setNexusSessionActive] = useState(false);
    const [primaryDecision, setPrimaryDecision] = useState<RankedMarketDecision | null>(null);
    const [recoveryDecision, setRecoveryDecision] = useState<RankedMarketDecision | null>(null);
    const activeLegRef = useRef<'primary' | 'recovery' | null>(null);
    const activeDecisionRef = useRef<RankedMarketDecision | null>(null);
    const settledContractIdsRef = useRef(new Set<string>());
    const nexusSessionRef = useRef<NexusSession | null>(null);
    const nexusCandidatesRef = useRef<RankedMarketDecision[]>([]);
    const nexusSkippedCandidatesRef = useRef(new Map<string, number>());
    const nexusScanConsumedRef = useRef(0);
    const nexusRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ignoreNextNexusBuyErrorRef = useRef(false);
    const startNexusDecisionRef = useRef<() => void>(() => {});
    const unavailableDigitMarketsRef = useRef(new Map<string, number>());
    const lowPayoutDigitMarketsRef = useRef(new Map<string, number>());
    const fallbackAttemptedRef = useRef(false);
    const pendingAutoEntryRef = useRef<{
        decision: RankedMarketDecision;
        leg: 'primary' | 'recovery';
        confirmations: number;
        waitingFor: 'window' | 'match' | null;
    } | null>(null);
    const autoQualifiedQueueRef = useRef<RankedMarketDecision[]>([]);
    const autoRescanPendingRef = useRef(false);
    const nexusAdaptivePlanRef = useRef<AdaptiveDigitMarketPlan | null>(null);
    const autoRiskRef = useRef({
        sessionProfit: 0,
        trades: 0,
        consecutiveLosses: 0,
    });
    const nexusLaunchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nexusLaunchPendingRef = useRef(false);
    const nexusAutoLaunchAfterScanRef = useRef(false);
    const nexusScanStateRef = useRef({
        isBusy: true,
        hasCompleteCoverage: false,
        status: 'discovering',
    });
    const recoveryUsedRef = useRef(false);
    const primaryPayoutMultiplierRef = useRef<number | null>(null);
    const recoveryTargetProfitRef = useRef(0);
    const executeDecisionRef = useRef<(
        decision: RankedMarketDecision,
        leg: 'primary' | 'recovery',
        stakeOverride?: number,
    ) => void>(() => {});
    const startQueuedAutoPrimaryRef = useRef<(settlementMessage?: string) => void>(() => {});
    const runtimeRef = useRef({
        rows,
        digitWindow,
        recoveryDigitWindow,
        liveMode,
        liveAuthorized: false,
        currency: 'USD',
        stake,
        primaryCondition,
        recoveryCondition,
        primaryPurchaseMarket,
        recoveryPurchaseMarket,
        martingale,
        recoveryEnabled,
        multiMarketScanning,
        autoVolatilityMode,
        payoutFloor,
        selectedSymbol,
        targetProfit,
        stopLoss,
    });

    const emitNexusFeedback = useCallback((
        message: string,
        kind: DTBuyFeedback['kind'] = 'info',
    ): void => {
        const feedback: DTBuyFeedback = { seq: Date.now(), kind, message };
        setLiveFeedback(feedback);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('nexus-ai-feedback', { detail: feedback }));
        }
    }, []);

    const bestModelRow = useMemo(() => {
        if (!rows.length) return undefined;
        return [...rows].sort((left, right) => {
            const gateScore = (right.validationGate === 'validated' ? 1 : 0) - (left.validationGate === 'validated' ? 1 : 0);
            if (gateScore !== 0) return gateScore;
            return right.realizedVolatility - left.realizedVolatility;
        })[0];
    }, [rows]);

    useEffect(() => {
        if (!selectedSymbol && bestModelRow?.symbol) setSelectedSymbol(bestModelRow.symbol);
        if (selectedSymbol && rows.length && !rows.some(row => row.symbol === selectedSymbol)) {
            setSelectedSymbol(bestModelRow?.symbol || '');
        }
    }, [bestModelRow, rows, selectedSymbol]);

    const useDeterministicDigitFixture = Boolean(riskFixtureMode) || (
        executionFixtureMode &&
        !['route-change', 'reverse'].includes(confirmationFixtureMode || '')
    );
    const strategySources = useMemo<StrategySource[]>(() => rows.map(row => ({
        symbol: row.symbol,
        displayName: row.displayName,
        prices: useDeterministicDigitFixture
            ? Array.from({ length: 80 }, (_, index) => Number((100 + index * 0.02).toFixed(2)))
            : row.prices,
        lastDigits: useDeterministicDigitFixture ? Array(80).fill(8) : row.lastDigits,
        tradable: row.status === 'open',
    })), [rows, useDeterministicDigitFixture]);

    const nexusAutomaticCandidates = useMemo(
        () => selectNexusAutomaticCandidates(strategySources),
        [strategySources],
    );
    nexusCandidatesRef.current = nexusAutomaticCandidates;

    const nexusAdaptivePlan = useMemo<AdaptiveDigitMarketPlan | null>(() => {
        const candidates = strategySources
            .filter(source => source.tradable === true)
            .map(source => ({
                source,
                plan: selectAdaptiveDigitMarketPlan(source, Math.max(20, digitWindow)),
            }))
            .filter((candidate): candidate is {
                source: StrategySource;
                plan: AdaptiveDigitMarketPlan;
            } => Boolean(candidate.plan))
            .sort((left, right) => {
                const strengthDelta = right.plan.primary.strength - left.plan.primary.strength;
                if (strengthDelta !== 0) return strengthDelta;
                return right.plan.primary.digits.length - left.plan.primary.digits.length;
            });
        return candidates[0]?.plan || null;
    }, [digitWindow, strategySources]);

    const hasCompleteNexusScan =
        !isBusy &&
        status === 'ready' &&
        discoveredCount > 0 &&
        rows.length >= discoveredCount &&
        failedSymbols.length === 0;
    nexusScanStateRef.current = {
        isBusy,
        hasCompleteCoverage: hasCompleteNexusScan,
        status,
    };

    useEffect(() => {
        const detail = {
            busy: isBusy,
            status,
            complete: hasCompleteNexusScan,
            hasPlan: nexusAutomaticCandidates.length > 0,
            candidateCount: nexusAutomaticCandidates.length,
        };
        const publishStatus = () => {
            window.dispatchEvent(new CustomEvent('nexus-ai-scan-status', { detail }));
        };
        const handleScanStatusRequest = () => publishStatus();
        const handleNexusScan = () => {
            const scanState = nexusScanStateRef.current;
            if (
                scanState.isBusy ||
                nexusLaunchPendingRef.current ||
                nexusSessionRef.current ||
                activeLegRef.current ||
                autoRescanPendingRef.current
            ) return;
            onScan();
        };
        window.addEventListener('nexus-ai-scan', handleNexusScan);
        window.addEventListener('nexus-ai-scan-status-request', handleScanStatusRequest);
        publishStatus();
        return () => {
            window.removeEventListener('nexus-ai-scan', handleNexusScan);
            window.removeEventListener('nexus-ai-scan-status-request', handleScanStatusRequest);
        };
    }, [hasCompleteNexusScan, isBusy, nexusAutomaticCandidates.length, onScan, scanCount, status]);

    useEffect(() => {
        if (!nexusAutoLaunchAfterScanRef.current || isBusy) return;
        if (hasCompleteNexusScan && nexusAutomaticCandidates.length) {
            if (nexusRetryTimerRef.current) {
                clearTimeout(nexusRetryTimerRef.current);
                nexusRetryTimerRef.current = null;
            }
            window.dispatchEvent(new CustomEvent('nexus-ai-launch', {
                detail: { resumeAfterScan: true },
            }));
            return;
        }
        if (!['ready', 'partial-data', 'empty', 'timeout', 'connection-error'].includes(String(status))) return;

        const message = status === 'ready'
            ? 'No qualified market yet. Nexus is staying active and will rescan before opening a contract.'
            : `The live scan ended with ${status}. Nexus is staying active and will retry; no contract was opened.`;
        emitNexusFeedback(message, status === 'ready' ? 'info' : 'error');
        if (nexusRetryTimerRef.current) clearTimeout(nexusRetryTimerRef.current);
        nexusRetryTimerRef.current = setTimeout(() => {
            nexusRetryTimerRef.current = null;
            if (
                nexusAutoLaunchAfterScanRef.current &&
                nexusLaunchPendingRef.current &&
                !nexusScanStateRef.current.isBusy
            ) onScan({ preserveExisting: true });
        }, riskFixtureMode ? 100 : 12_000);
    }, [emitNexusFeedback, hasCompleteNexusScan, isBusy, nexusAutomaticCandidates.length, onScan, riskFixtureMode, scanCount, status]);

    const selectedRow = rows.find(row => row.symbol === selectedSymbol) || rows[0];
    const autoQualifiedDecisions = nexusAutomaticCandidates;
    const autoPrimaryDecision = autoQualifiedDecisions[0] || null;
    const autoPrimaryRow = rows.find(row => row.symbol === autoPrimaryDecision?.symbol);
    const modelPick = autoVolatilityMode
        ? autoPrimaryRow || selectedRow
        : bestModelRow || selectedRow;
    const autoCandidateSymbol = autoVolatilityMode ? autoPrimaryDecision?.symbol : undefined;

    const calculatedPrimaryDecision = useMemo(() => {
        const source = multiMarketScanning ? bestModelRow : selectedRow;
        if (!source) return null;
        const decision = selectConfiguredMarket(
            {
                symbol: source.symbol,
                displayName: source.displayName,
                prices: source.prices,
                lastDigits: source.lastDigits,
            },
            digitWindow,
            primaryCondition,
        );
        return decision ? withPurchaseMarket(decision, primaryPurchaseMarket) : null;
    }, [bestModelRow, digitWindow, multiMarketScanning, primaryCondition, primaryPurchaseMarket, selectedRow]);

    const explicitPrimaryDecision = useMemo(() => {
        const source = multiMarketScanning ? bestModelRow : selectedRow;
        return source
            ? createExplicitPurchaseDecision(source, digitWindow, primaryCondition, primaryPurchaseMarket)
            : null;
    }, [bestModelRow, digitWindow, multiMarketScanning, primaryCondition, primaryPurchaseMarket, selectedRow]);

    const calculatedRecoveryDecision = useMemo(() => {
        if (multiMarketScanning) {
            const decision = selectStrongestMarket(strategySources, recoveryDigitWindow, recoveryCondition);
            return decision ? withPurchaseMarket(decision, recoveryPurchaseMarket) : null;
        }
        if (!selectedRow) return null;
        const decision = selectConfiguredMarket(
            {
                symbol: selectedRow.symbol,
                displayName: selectedRow.displayName,
                prices: selectedRow.prices,
                lastDigits: selectedRow.lastDigits,
            },
            recoveryDigitWindow,
            recoveryCondition,
        );
        return decision ? withPurchaseMarket(decision, recoveryPurchaseMarket) : null;
    }, [multiMarketScanning, recoveryCondition, recoveryDigitWindow, recoveryPurchaseMarket, selectedRow, strategySources]);

    useEffect(() => {
        setPrimaryDecision(calculatedPrimaryDecision);
        setRecoveryDecision(calculatedRecoveryDecision);
    }, [calculatedPrimaryDecision, calculatedRecoveryDecision]);

    const isLoggedIn = client?.is_logged_in ?? false;
    const liveAuthorized = executionFixtureMode || (isLoggedIn && isAuthorized && Boolean(api_base.api));

    useEffect(() => {
        runtimeRef.current = {
            rows,
            digitWindow,
            recoveryDigitWindow,
            liveMode,
            liveAuthorized,
            currency: client?.currency || 'USD',
            stake,
            primaryCondition,
            recoveryCondition,
            primaryPurchaseMarket,
            recoveryPurchaseMarket,
            recoveryEnabled,
            multiMarketScanning,
            autoVolatilityMode,
            payoutFloor,
            selectedSymbol,
            martingale,
            targetProfit,
            stopLoss,
        };
    }, [autoVolatilityMode, client?.currency, digitWindow, liveAuthorized, liveMode, martingale, multiMarketScanning, payoutFloor, primaryCondition, primaryPurchaseMarket, recoveryCondition, recoveryDigitWindow, recoveryEnabled, recoveryPurchaseMarket, rows, selectedSymbol, stake, stopLoss, targetProfit]);

    const scheduleAutoRescan = useCallback((delayOverride?: number) => {
        if (
            (!runtimeRef.current.autoVolatilityMode &&
                !nexusSessionRef.current &&
                !nexusAutoLaunchAfterScanRef.current) ||
            autoRescanPendingRef.current ||
            nexusScanStateRef.current.isBusy
        ) return;
        autoRescanPendingRef.current = true;
        setTimeout(() => {
            autoRescanPendingRef.current = false;
            if (nexusSessionRef.current || nexusAutoLaunchAfterScanRef.current || runtimeRef.current.autoVolatilityMode) {
                onScan({ preserveExisting: true });
            }
        }, delayOverride ?? (riskFixtureMode ? 50 : 650));
    }, [onScan, riskFixtureMode]);

    const executeDecision = useCallback((
        decision: RankedMarketDecision,
        leg: 'primary' | 'recovery',
        stakeOverride?: number,
    ) => {
        const runtime = runtimeRef.current;
        if (!isNexusExecutionDecisionAllowed(decision)) {
            const message = 'Blocked unsupported contract. Only Over 1–5, Under 4–8, Even, and Odd are allowed; Rise/Fall and other digit contracts are disabled.';
            emitNexusFeedback(message, 'error');
            setExecutionLeg('idle');
            activeLegRef.current = null;
            activeDecisionRef.current = null;
            pendingAutoEntryRef.current = null;
            if (runtime.autoVolatilityMode) setAutoVolatilityMode(false);
            if (nexusSessionRef.current) {
                nexusSessionRef.current = null;
                setNexusSessionActive(false);
                liveEngine.stop();
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                        detail: { active: false, message },
                    }));
                }
            }
            return;
        }
        if (!runtime.liveMode || !runtime.liveAuthorized) {
            emitNexusFeedback('Log in to a Deriv account before live execution.', 'error');
            setExecutionLeg('idle');
            if (nexusSessionRef.current) {
                nexusSessionRef.current = null;
                setNexusSessionActive(false);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                        detail: { active: false, message: 'Log in to a Deriv account before live execution.' },
                    }));
                }
            }
            return;
        }
        const amount = Number(runtime.stake);
        if (!Number.isFinite(amount) || amount <= 0) {
            emitNexusFeedback('Enter a valid stake before executing.', 'error');
            setExecutionLeg('idle');
            if (nexusSessionRef.current) {
                nexusSessionRef.current = null;
                setNexusSessionActive(false);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                        detail: { active: false, message: 'Enter a valid stake before executing.' },
                    }));
                }
            }
            return;
        }

        const effectiveStake = stakeOverride !== undefined
            ? stakeOverride
            : leg === 'recovery'
                ? getNexusStakeForLossStreak(amount, runtime.martingale, 1)
                : amount;
        const config: DTConfig = {
            symbol: decision.symbol,
            contractType: decision.contractType,
            durationValue: 1,
            durationUnit: 't',
            stake: effectiveStake,
            barrier: decision.barrier,
            currency: runtime.currency,
        };
        const automaticPrimary = runtime.autoVolatilityMode && leg === 'primary';
        const automaticNexus = Boolean(nexusSessionRef.current);
        const enforceLivePayoutFloor = runtime.autoVolatilityMode || automaticNexus;
        liveEngine.setBuyGuard(proposal => {
            const minimumPayout = Number(runtimeRef.current.payoutFloor);
            const payoutMultiplier = getPayoutMultiplier(proposal);
            const reasons = evaluateNexusQuoteGate({
                leg,
                payoutMultiplier,
                minimumPayoutMultiplier: minimumPayout,
                enforceMinimumPayout: enforceLivePayoutFloor,
                primaryPayoutMultiplier: primaryPayoutMultiplierRef.current,
                projectedProfit: Number(proposal.profit),
                sessionDeficit: recoveryTargetProfitRef.current,
            });

            if (!reasons.length) {
                if (leg === 'primary') {
                    primaryPayoutMultiplierRef.current = payoutMultiplier;
                    recoveryTargetProfitRef.current = 0;
                }
                return null;
            }

            const rejectedMarket = purchaseMarketFromDecision(decision);
            const now = Date.now();
            for (const [key, expiresAt] of lowPayoutDigitMarketsRef.current) {
                if (expiresAt <= now) lowPayoutDigitMarketsRef.current.delete(key);
            }
            if (rejectedMarket) {
                lowPayoutDigitMarketsRef.current.set(
                    `${decision.symbol}|${rejectedMarket}`,
                    now + LOW_PAYOUT_MARKET_TTL_MS,
                );
            }
            const source = runtimeRef.current.rows.find(row => row.symbol === decision.symbol);
            const unavailableMarkets = new Set<PurchaseMarket>();
            for (const [key, expiresAt] of unavailableDigitMarketsRef.current) {
                if (expiresAt > now && key.startsWith(`${decision.symbol}|`)) {
                    unavailableMarkets.add(key.slice(decision.symbol.length + 1) as PurchaseMarket);
                }
            }
            for (const [key, expiresAt] of lowPayoutDigitMarketsRef.current) {
                if (expiresAt > now && key.startsWith(`${decision.symbol}|`)) {
                    unavailableMarkets.add(key.slice(decision.symbol.length + 1) as PurchaseMarket);
                }
            }
            const payoutFallback = runtimeRef.current.autoVolatilityMode && source && rejectedMarket
                ? selectBestAvailableDigitFallback(
                    source,
                    rejectedMarket,
                    runtimeRef.current.digitWindow,
                    unavailableMarkets,
                )
                : null;
            const message = `Skipping ${decision.label}: ${reasons.join('; ')}. ${
                payoutFallback
                    ? `Trying ${payoutFallback.label} with a fresh quote.`
                    : automaticNexus
                        ? 'Rescanning for another allowed route.'
                        : runtimeRef.current.autoVolatilityMode
                            ? 'Skipping recovery and moving to the next qualified digit route.'
                            : 'No order was sent.'
            }`;

            ignoreNextNexusBuyErrorRef.current = true;
            liveEngine.stop();
            pendingAutoEntryRef.current = null;
            activeLegRef.current = null;
            activeDecisionRef.current = null;
            setExecutionLeg('idle');
            setPayoutSkipCount(count => count + 1);
            setLastPayoutSkipMessage(message);
            emitNexusFeedback(message, enforceLivePayoutFloor ? 'info' : 'error');
            if (nexusSessionRef.current) {
                nexusSessionRef.current.nextLeg = leg;
                nexusSkippedCandidatesRef.current.set(
                    `${decision.symbol}|${decision.contractType}|${decision.barrier || ''}`,
                    now + LOW_PAYOUT_MARKET_TTL_MS,
                );
                setTimeout(() => scheduleAutoRescan(), 0);
            } else if (payoutFallback) {
                setTimeout(() => {
                    fallbackAttemptedRef.current = true;
                    setDigitFallbackCount(count => count + 1);
                    executeDecisionRef.current(payoutFallback, leg);
                    scheduleAutoRescan();
                }, 0);
            } else if (runtimeRef.current.autoVolatilityMode) {
                setTimeout(() => {
                    startQueuedAutoPrimaryRef.current(message);
                    scheduleAutoRescan();
                }, 0);
            }
            return message;
        });
        activeLegRef.current = leg;
        activeDecisionRef.current = decision;
        setExecutionLeg(leg === 'primary' ? 'primary-pending' : 'recovery-pending');
        if (!fallbackAttemptedRef.current) setLiveFeedback(null);
        const waitForFreshConfirmation = runtime.autoVolatilityMode || automaticNexus;
        if (waitForFreshConfirmation) {
            pendingAutoEntryRef.current = {
                decision,
                leg,
                confirmations: 0,
                waitingFor: null,
            };
        } else {
            pendingAutoEntryRef.current = null;
        }
        // Restarting for every leg ensures recovery subscribes to the selected
        // volatility before the fresh proposal is purchased.
        if (!liveEngine.start(config)) {
            activeLegRef.current = null;
            activeDecisionRef.current = null;
            pendingAutoEntryRef.current = null;
            setExecutionLeg('idle');
            if (nexusSessionRef.current) {
                nexusSessionRef.current = null;
                setNexusSessionActive(false);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                        detail: { active: false, message: 'Nexus AI could not start the next contract.' },
                    }));
                }
            }
            return;
        }
        // Automated digit entries wait for three fresh matching digits after
        // the history seed before the engine requests a live payout proposal.
        if (!waitForFreshConfirmation) {
            liveEngine.placeBuyNow(config);
        }
    }, [emitNexusFeedback, liveEngine, riskFixtureMode, scheduleAutoRescan]);

    executeDecisionRef.current = executeDecision;

    const startQueuedAutoPrimary = useCallback((settlementMessage = 'Previous contract settled.') => {
        if (!runtimeRef.current.autoVolatilityMode || autoRescanPendingRef.current) return;
        const nextDecision = autoQualifiedQueueRef.current.shift();
        if (!nextDecision) {
            setLiveFeedback({
                seq: Date.now(),
                kind: 'success',
                message: `${settlementMessage} All currently qualified markets were checked. Refreshing the market universe for the next entry cycle.`,
            });
            scheduleAutoRescan();
            return;
        }
        setLiveFeedback({
            seq: Date.now(),
            kind: 'success',
            message: `${settlementMessage} Next qualified entry: ${nextDecision.displayName} · ${nextDecision.label}.`,
        });
        recoveryUsedRef.current = false;
        fallbackAttemptedRef.current = false;
        executeDecisionRef.current(nextDecision, 'primary');
    }, [scheduleAutoRescan]);

    startQueuedAutoPrimaryRef.current = startQueuedAutoPrimary;

    const startNextNexusDecision = useCallback(() => {
        const session = nexusSessionRef.current;
        if (!session || activeLegRef.current || nexusLaunchPendingRef.current) return;

        const requestedNextStake = getNexusStakeForLossStreak(
            session.baseStake,
            runtimeRef.current.martingale,
            session.consecutiveLosses,
        );
        const stop = Number(runtimeRef.current.stopLoss);
        const remainingStopBudget = stop > 0
            ? stop + session.sessionProfit
            : Number.POSITIVE_INFINITY;
        const stakeExceedsBudget = requestedNextStake > remainingStopBudget;
        const nextStake = stakeExceedsBudget ? session.baseStake : requestedNextStake;
        const recovery = session.nextLeg === 'recovery' &&
            runtimeRef.current.recoveryEnabled &&
            !stakeExceedsBudget;
        if (session.nextLeg === 'recovery' && !recovery) {
            session.nextLeg = 'primary';
        }
        session.currentStake = nextStake;

        const now = Date.now();
        for (const [key, expiresAt] of nexusSkippedCandidatesRef.current) {
            if (expiresAt <= now) nexusSkippedCandidatesRef.current.delete(key);
        }
        const candidates = nexusCandidatesRef.current.filter(decision =>
            !nexusSkippedCandidatesRef.current.has(
                `${decision.symbol}|${decision.contractType}|${decision.barrier || ''}`,
            ),
        );
        const nextDecision = selectNextNexusDecision(candidates, {
            recovery,
            lastSymbol: session.lastSymbol,
            lastDecisionKey: session.lastDecisionKey,
        });

        if (!nextDecision) {
            if (recovery) {
                session.nextLeg = 'primary';
                emitNexusFeedback(
                    `No other currently qualified market is available for recovery. Skipping that leg and rescanning at the next stake of $${nextStake.toFixed(2)}.`,
                );
            } else if (stakeExceedsBudget) {
                emitNexusFeedback(
                    `The Martingale stake would exceed the remaining session stop-loss budget. Rescanning at the base stake of $${nextStake.toFixed(2)}.`,
                );
            } else {
                emitNexusFeedback('No market currently meets the entry gates. Nexus is rescanning; no contract was opened.');
            }
            scheduleAutoRescan(12_000);
            return;
        }

        const leg = recovery ? 'recovery' : 'primary';
        session.nextLeg = 'primary';
        nexusScanConsumedRef.current = scanCount;
        if (leg === 'recovery') {
            setRecoveryDecision(nextDecision);
            emitNexusFeedback(
                `Starting one guarded recovery leg on ${nextDecision.displayName} · ${nextDecision.label} at $${nextStake.toFixed(2)}.`,
            );
        } else {
            setPrimaryDecision(nextDecision);
            emitNexusFeedback(
                stakeExceedsBudget
                    ? `Qualified entry found · ${nextDecision.displayName} · ${nextDecision.label}. Martingale progression exceeds the remaining stop-loss budget, so the base stake $${nextStake.toFixed(2)} will be used.`
                    : `Qualified entry found · ${nextDecision.displayName} · ${nextDecision.label} at $${nextStake.toFixed(2)}.`,
                'success',
            );
        }
        executeDecisionRef.current(nextDecision, leg, nextStake);
    }, [emitNexusFeedback, scanCount, scheduleAutoRescan]);
    startNexusDecisionRef.current = startNextNexusDecision;

    useEffect(() => {
        const handleNexusLaunch = (event: Event) => {
            const resumeAfterScan = Boolean(
                (event as CustomEvent<{ resumeAfterScan?: boolean }>).detail?.resumeAfterScan,
            );
            if (resumeAfterScan) {
                if (!nexusAutoLaunchAfterScanRef.current || !nexusLaunchPendingRef.current) return;
                nexusAutoLaunchAfterScanRef.current = false;
                nexusLaunchPendingRef.current = false;
            }
            if (
                activeLegRef.current ||
                nexusSessionRef.current ||
                nexusLaunchPendingRef.current ||
                autoRescanPendingRef.current
            ) return;
            const scanState = nexusScanStateRef.current;
            nexusLaunchPendingRef.current = true;
            emitNexusFeedback('Launching Nexus AI…');
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                    detail: { active: true, message: 'Launching Nexus AI…' },
                }));
            }

            if (!scanState.hasCompleteCoverage || !nexusAutomaticCandidates.length) {
                nexusAutoLaunchAfterScanRef.current = true;
                nexusLaunchPendingRef.current = true;
                const message = scanState.isBusy
                    ? 'Waiting for the live market scan to complete…'
                    : 'Scanning all open markets for the first qualified entry…';
                emitNexusFeedback(message);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                        detail: { active: true, message },
                    }));
                }
                if (!scanState.isBusy) {
                    onScan({ preserveExisting: true });
                }
                return;
            }

            nexusAutoLaunchAfterScanRef.current = false;
            nexusLaunchTimerRef.current = setTimeout(() => {
                emitNexusFeedback('Starting a fresh, payout-checked market cycle…');
                nexusLaunchTimerRef.current = setTimeout(() => {
                    nexusLaunchPendingRef.current = false;
                    const baseStake = Number(runtimeRef.current.stake);
                    nexusAdaptivePlanRef.current = nexusAdaptivePlan;
                    primaryPayoutMultiplierRef.current = null;
                    recoveryTargetProfitRef.current = 0;
                    nexusSessionRef.current = {
                        baseStake,
                        currentStake: baseStake,
                        sessionProfit: 0,
                        trades: 0,
                        consecutiveLosses: 0,
                        nextLeg: 'primary',
                        lastSymbol: null,
                        lastDecisionKey: null,
                    };
                    setNexusSessionActive(true);
                    recoveryUsedRef.current = false;
                    fallbackAttemptedRef.current = false;
                    nexusScanConsumedRef.current = scanCount;
                    startNexusDecisionRef.current();
                }, 550);
            }, 250);
        };

        const handleNexusStop = () => {
            if (!nexusSessionRef.current && !activeLegRef.current && !nexusLaunchPendingRef.current) return;
            if (nexusLaunchTimerRef.current) {
                clearTimeout(nexusLaunchTimerRef.current);
                nexusLaunchTimerRef.current = null;
            }
            nexusLaunchPendingRef.current = false;
            nexusAutoLaunchAfterScanRef.current = false;
            autoRescanPendingRef.current = false;
            if (nexusRetryTimerRef.current) {
                clearTimeout(nexusRetryTimerRef.current);
                nexusRetryTimerRef.current = null;
            }
            nexusSessionRef.current = null;
            setNexusSessionActive(false);
            pendingAutoEntryRef.current = null;
            recoveryUsedRef.current = false;
            activeLegRef.current = null;
            activeDecisionRef.current = null;
            liveEngine.stop();
            setExecutionLeg('idle');
            emitNexusFeedback('Nexus AI stopped manually. No new contracts will be opened.', 'success');
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                    detail: { active: false, message: 'Nexus AI stopped manually. No new contracts will be opened.' },
                }));
            }
        };

        window.addEventListener('nexus-ai-launch', handleNexusLaunch);
        window.addEventListener('nexus-ai-stop', handleNexusStop);
        return () => {
            if (nexusLaunchTimerRef.current) clearTimeout(nexusLaunchTimerRef.current);
            window.removeEventListener('nexus-ai-launch', handleNexusLaunch);
            window.removeEventListener('nexus-ai-stop', handleNexusStop);
        };
    }, [emitNexusFeedback, liveEngine, nexusAdaptivePlan, nexusAutomaticCandidates.length, onScan, scanCount]);

    useEffect(() => {
        if (
            !nexusSessionActive ||
            isBusy ||
            !hasCompleteNexusScan ||
            executionLeg !== 'idle' ||
            activeLegRef.current ||
            nexusLaunchPendingRef.current ||
            nexusScanConsumedRef.current === scanCount
        ) return;
        nexusScanConsumedRef.current = scanCount;
        startNexusDecisionRef.current();
    }, [executionLeg, hasCompleteNexusScan, isBusy, nexusSessionActive, nexusAutomaticCandidates, scanCount]);

    useEffect(() => {
        if (!nexusSessionActive || isBusy || hasCompleteNexusScan) return;
        const retryTimer = setTimeout(() => {
            if (nexusSessionRef.current && !nexusScanStateRef.current.isBusy) {
                onScan({ preserveExisting: true });
            }
        }, riskFixtureMode ? 100 : 12_000);
        return () => clearTimeout(retryTimer);
    }, [hasCompleteNexusScan, isBusy, nexusSessionActive, onScan, riskFixtureMode, scanCount]);

    const toggleAutoRunner = useCallback(() => {
        autoQualifiedQueueRef.current = [];
        autoRescanPendingRef.current = false;
        setAutoVolatilityMode(value => {
            if (!value) {
                autoRiskRef.current = {
                    sessionProfit: 0,
                    trades: 0,
                    consecutiveLosses: 0,
                };
                primaryPayoutMultiplierRef.current = null;
                recoveryTargetProfitRef.current = 0;
            }
            return !value;
        });
    }, []);

    const runTrade = useCallback(() => {
        if (executionLeg !== 'idle') return;
        if (autoRescanPendingRef.current) return;
        if (!liveAuthorized) {
            setLiveFeedback({ seq: Date.now(), kind: 'error', message: 'Log in to a Deriv account before running a real trade.' });
            return;
        }
        if (autoVolatilityMode) {
            const risk = autoRiskRef.current;
            const target = Number(targetProfit);
            const stop = Number(stopLoss);
            const riskMessage = risk.sessionProfit >= target
                ? `Session target reached (+$${risk.sessionProfit.toFixed(2)}). Auto runner stopped.`
                : risk.sessionProfit <= -stop
                    ? `Session stop loss reached ($${risk.sessionProfit.toFixed(2)}). Auto runner stopped.`
                    : risk.consecutiveLosses >= AUTO_MAX_CONSECUTIVE_LOSSES
                        ? `${AUTO_MAX_CONSECUTIVE_LOSSES} consecutive losses reached. Auto runner stopped.`
                        : risk.trades >= AUTO_MAX_TRADES
                            ? `${AUTO_MAX_TRADES} trades reached for this session. Auto runner stopped.`
                            : '';
            if (riskMessage) {
                setAutoVolatilityMode(false);
                setLiveFeedback({ seq: Date.now(), kind: 'error', message: riskMessage });
                return;
            }
        }
        const decision = autoVolatilityMode
            ? (() => {
                if (!autoQualifiedQueueRef.current.length) {
                    autoQualifiedQueueRef.current = autoQualifiedDecisions.slice();
                }
                return autoQualifiedQueueRef.current.shift() || null;
            })()
            : primaryDecision || explicitPrimaryDecision;
        if (!decision) {
            setLiveFeedback({
                seq: Date.now(),
                kind: 'error',
                message: autoVolatilityMode
                    ? 'No allowed digit route passed the evidence gate. Waiting for the next scan.'
                    : 'Wait for the market scan to produce a selectable digit route.',
            });
            return;
        }
        recoveryUsedRef.current = false;
        fallbackAttemptedRef.current = false;
        setLiveFeedback(null);
        executeDecision(decision, 'primary');
    }, [autoQualifiedDecisions, autoVolatilityMode, executeDecision, executionLeg, explicitPrimaryDecision, liveAuthorized, primaryDecision, stopLoss, targetProfit]);

    useEffect(() => {
        if (!autoVolatilityMode || !liveMode || !liveAuthorized || isBusy || executionLeg !== 'idle' || autoRescanPendingRef.current || !autoPrimaryDecision) {
            return;
        }

        const timer = setTimeout(runTrade, riskFixtureMode ? 50 : 450);
        return () => clearTimeout(timer);
    }, [autoPrimaryDecision, autoVolatilityMode, executionLeg, isBusy, liveAuthorized, liveMode, riskFixtureMode, runTrade, scanCount]);

    const upsertJournalEntry = useCallback((position: DTPosition, leg: 'primary' | 'recovery', decision: RankedMarketDecision | null) => {
        const strategyLabel = decision?.label
            ? `${decision.label}${decision.entryDigit === undefined ? '' : ` · entry digit ${decision.entryDigit}`}`
            : position.contractType === 'DIGITEVEN'
                ? 'Even'
                : position.contractType === 'DIGITODD'
                    ? 'Odd'
                    : strategyContractDisplayLabel(position.contractType);
        const nextEntry: AlphaTradeJournalEntry = {
            contractId: position.contractId,
            leg,
            time: position.purchaseTime,
            symbol: position.symbol,
            price: position.currentSpot,
            entryPrice: position.entrySpot,
            exitPrice: position.exitSpot,
            market: leg === 'recovery' ? 'Market 2' : 'Market 1',
            strategy: strategyLabel,
            gate: position.isOpen ? 'Running' : position.isWin ? 'Won' : 'Lost',
            stake: position.stake,
            payout: position.payout,
            profit: position.isOpen ? null : position.profit,
        };
        setJournalRows(current => {
            const existingIndex = current.findIndex(entry => entry.contractId === nextEntry.contractId);
            if (existingIndex < 0) return [nextEntry, ...current].slice(0, 20);
            const next = current.slice();
            next[existingIndex] = { ...next[existingIndex], ...nextEntry };
            return next;
        });
    }, []);

    useEffect(() => {
        liveEngine.onStatus = setLiveStatus;
        liveEngine.onBuyFeedback = feedback => {
            const activeDecision = activeDecisionRef.current;
            const activeLeg = activeLegRef.current;
            const runtime = runtimeRef.current;
            if (feedback.kind === 'error' && ignoreNextNexusBuyErrorRef.current) {
                ignoreNextNexusBuyErrorRef.current = false;
                return;
            }
            const rejectedMarket = activeDecision
                ? purchaseMarketFromDecision(activeDecision)
                : null;
            if (
                feedback.kind === 'error' &&
                (runtime.autoVolatilityMode || Boolean(nexusSessionRef.current)) &&
                !fallbackAttemptedRef.current &&
                activeDecision &&
                activeLeg &&
                rejectedMarket &&
                activeDecision.contractType.startsWith('DIGIT') &&
                isUnavailableDigitContractFeedback(feedback)
            ) {
                const source = runtime.rows.find(row => row.symbol === activeDecision.symbol);
                const cacheKey = `${activeDecision.symbol}|${rejectedMarket}`;
                const now = Date.now();
                for (const [key, expiresAt] of unavailableDigitMarketsRef.current) {
                    if (expiresAt <= now) unavailableDigitMarketsRef.current.delete(key);
                }
                unavailableDigitMarketsRef.current.set(cacheKey, now + UNAVAILABLE_MARKET_TTL_MS);
                fallbackAttemptedRef.current = true;
                const unavailableMarkets = new Set<PurchaseMarket>();
                for (const [key, expiresAt] of unavailableDigitMarketsRef.current) {
                    if (key.startsWith(`${activeDecision.symbol}|`) && expiresAt > now) {
                        unavailableMarkets.add(key.slice(activeDecision.symbol.length + 1) as PurchaseMarket);
                    }
                }
                const fallback = source
                    ? selectBestAvailableDigitFallback(
                        source,
                        rejectedMarket,
                        activeLeg === 'recovery' ? runtime.recoveryDigitWindow : runtime.digitWindow,
                        unavailableMarkets,
                    )
                    : null;
                if (fallback) {
                    setDigitFallbackCount(count => count + 1);
                    pendingAutoEntryRef.current = null;
                    setExecutionLeg('idle');
                    activeLegRef.current = null;
                    activeDecisionRef.current = null;
                    emitNexusFeedback(
                        `${purchaseMarketLabel(rejectedMarket)} is unavailable on ${activeDecision.displayName}. Retrying once with ${fallback.label} on the same market.`,
                    );
                    setTimeout(() => executeDecisionRef.current(fallback, activeLeg), 0);
                    return;
                }
            }

            if (feedback.kind === 'error' && nexusSessionRef.current) {
                pendingAutoEntryRef.current = null;
                setExecutionLeg('idle');
                activeLegRef.current = null;
                activeDecisionRef.current = null;
                liveEngine.stop();
                const isAuthorizationFailure = /log in|not logged|authorization|invalid token/i.test(feedback.message);
                if (isAuthorizationFailure) {
                    nexusSessionRef.current = null;
                    setNexusSessionActive(false);
                    emitNexusFeedback(feedback.message, 'error');
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                            detail: { active: false, message: feedback.message },
                        }));
                    }
                } else {
                    if (activeDecision) {
                        nexusSkippedCandidatesRef.current.set(
                            `${activeDecision.symbol}|${activeDecision.contractType}|${activeDecision.barrier || ''}`,
                            Date.now() + UNAVAILABLE_MARKET_TTL_MS,
                        );
                    }
                    emitNexusFeedback(
                        `${feedback.message} Skipping this candidate and rescanning; the Nexus session remains active.`,
                    );
                    scheduleAutoRescan();
                }
                return;
            }

            setLiveFeedback(feedback);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('nexus-ai-feedback', { detail: feedback }));
            }
            if (feedback.kind === 'error') {
                pendingAutoEntryRef.current = null;
                setExecutionLeg('idle');
                activeLegRef.current = null;
                activeDecisionRef.current = null;
            }
        };
        liveEngine.onPosition = position => {
            const leg = activeLegRef.current;
            const decision = activeDecisionRef.current;
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('nexus-ai-position', { detail: position }));
                window.dispatchEvent(new CustomEvent('nexus-ai-journal', {
                    detail: {
                        ...position,
                        leg: leg || 'primary',
                        strategy: decision?.label
                            ? `${decision.label}${decision.entryDigit === undefined ? '' : ` · entry digit ${decision.entryDigit}`}`
                            : strategyContractDisplayLabel(position.contractType),
                        entryDigit: decision?.entryDigit ?? null,
                        market: (() => {
                            const market = decision ? purchaseMarketFromDecision(decision) : null;
                            return market ? purchaseMarketLabel(market) : strategyContractDisplayLabel(position.contractType);
                        })(),
                    },
                }));
            }
            upsertJournalEntry(position, leg || 'primary', activeDecisionRef.current);
            if (position.isOpen) {
                const nexusSession = nexusSessionRef.current;
                if (nexusSession && decision) {
                    nexusSession.lastSymbol = decision.symbol;
                    nexusSession.lastDecisionKey =
                        `${decision.symbol}|${decision.contractType}|${decision.barrier || ''}`;
                }
                setLiveTrade(position);
                setLiveTradeLeg(leg);
                setLiveTradeDecision(activeDecisionRef.current);
                setExecutionLeg(leg === 'recovery' ? 'recovery-running' : 'primary-running');
                const entryContext = decision?.entryDigit === undefined
                    ? ''
                    : ` · entry digit ${decision.entryDigit}`;
                emitNexusFeedback(
                    `${leg === 'recovery' ? 'Recovery' : 'Primary'} ${strategyContractDisplayLabel(position.contractType)} contract executed · ${decision?.displayName || position.symbol}${entryContext} · tracking live price.`,
                    'success',
                );
                if (nexusSessionRef.current) scheduleAutoRescan();
                return;
            }

            setLiveTrade(null);
            setLiveTradeLeg(null);
            setLiveTradeDecision(null);

            const settledContractId = String(position.contractId || '');
            if (settledContractId && settledContractIdsRef.current.has(settledContractId)) return;
            if (settledContractId) settledContractIdsRef.current.add(settledContractId);
            const settledProfit = Number(position.profit) || 0;
            setToolRealizedProfitLoss(current => current + settledProfit);

            const nexusSession = nexusSessionRef.current;
            if (nexusSession && leg) {
                nexusSession.sessionProfit += settledProfit;
                nexusSession.trades += 1;
                if (position.isWin === false) {
                    nexusSession.consecutiveLosses += 1;
                } else if (position.isWin === true) {
                    nexusSession.consecutiveLosses = 0;
                }
                const target = Number(runtimeRef.current.targetProfit);
                const stop = Number(runtimeRef.current.stopLoss);
                const riskMessage = target > 0 && nexusSession.sessionProfit >= target
                    ? `Take profit reached (+$${nexusSession.sessionProfit.toFixed(2)}). Nexus AI stopped.`
                    : stop > 0 && nexusSession.sessionProfit <= -stop
                        ? `Stop loss reached ($${nexusSession.sessionProfit.toFixed(2)}). Nexus AI stopped.`
                        : nexusSession.consecutiveLosses >= AUTO_MAX_CONSECUTIVE_LOSSES
                            ? `${AUTO_MAX_CONSECUTIVE_LOSSES} consecutive losses reached. Nexus AI stopped.`
                            : nexusSession.trades >= AUTO_MAX_TRADES
                                ? `${AUTO_MAX_TRADES} contracts reached for this session. Nexus AI stopped.`
                                : '';

                setExecutionLeg('idle');
                activeLegRef.current = null;
                activeDecisionRef.current = null;
                if (riskMessage) {
                    nexusSessionRef.current = null;
                    setNexusSessionActive(false);
                    liveEngine.stop();
                    emitNexusFeedback(riskMessage, 'success');
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('nexus-ai-session', {
                            detail: { active: false, message: riskMessage },
                        }));
                    }
                    return;
                }

                fallbackAttemptedRef.current = false;
                const loss = position.isWin === false;
                const canRecover = runtimeRef.current.recoveryEnabled;
                if (leg === 'primary' && loss) {
                    recoveryTargetProfitRef.current = Math.max(0, -nexusSession.sessionProfit);
                }
                const requestedNextStake = loss
                    ? getNexusStakeForLossStreak(
                        nexusSession.baseStake,
                        runtimeRef.current.martingale,
                        nexusSession.consecutiveLosses,
                    )
                    : nexusSession.baseStake;
                const remainingStopBudget = stop > 0
                    ? stop + nexusSession.sessionProfit
                    : Number.POSITIVE_INFINITY;
                const stakeExceedsBudget = requestedNextStake > remainingStopBudget;
                const nextStake = stakeExceedsBudget
                    ? nexusSession.baseStake
                    : requestedNextStake;
                if (
                    leg === 'primary' &&
                    loss &&
                    canRecover &&
                    !stakeExceedsBudget
                ) {
                    nexusSession.nextLeg = 'recovery';
                    nexusSession.currentStake = nextStake;
                    emitNexusFeedback(
                        `Primary lost. Scanning for a different qualified market for one recovery leg at $${nextStake.toFixed(2)}.`,
                    );
                } else {
                    if (stakeExceedsBudget) {
                        emitNexusFeedback(
                            `The Martingale stake would exceed the remaining session stop-loss budget. Continuing at the base stake of $${nextStake.toFixed(2)}.`,
                        );
                    } else {
                        emitNexusFeedback(
                            leg === 'recovery'
                                ? `Recovery ${position.isWin ? 'won' : 'lost'}. Scanning again at $${nextStake.toFixed(2)}.`
                                : `${position.isWin ? 'Primary won' : 'Primary settled'}. Scanning all open markets for the next entry.`,
                            position.isWin ? 'success' : 'info',
                        );
                    }
                    nexusSession.nextLeg = 'primary';
                    nexusSession.currentStake = nextStake;
                }
                scheduleAutoRescan();
                return;
            }

            if (runtimeRef.current.autoVolatilityMode && leg === 'primary') {
                const settledDecision = activeDecisionRef.current;
                const settledSymbol = settledDecision?.symbol || position.symbol;
                const risk = autoRiskRef.current;
                risk.sessionProfit += Number(position.profit) || 0;
                if (position.isWin === false) {
                    recoveryTargetProfitRef.current = Math.max(0, -risk.sessionProfit);
                }
                risk.trades += 1;
                risk.consecutiveLosses = position.isWin ? 0 : risk.consecutiveLosses + 1;
                const target = Number(targetProfit);
                const stop = Number(stopLoss);
                const riskMessage = risk.sessionProfit >= target
                    ? `Session target reached (+$${risk.sessionProfit.toFixed(2)}). Auto runner stopped.`
                    : risk.sessionProfit <= -stop
                        ? `Session stop loss reached ($${risk.sessionProfit.toFixed(2)}). Auto runner stopped.`
                        : risk.consecutiveLosses >= AUTO_MAX_CONSECUTIVE_LOSSES
                            ? `${AUTO_MAX_CONSECUTIVE_LOSSES} consecutive losses reached. Auto runner stopped.`
                            : risk.trades >= AUTO_MAX_TRADES
                                ? `${AUTO_MAX_TRADES} trades reached for this session. Auto runner stopped.`
                                : '';
                setExecutionLeg('idle');
                activeLegRef.current = null;
                activeDecisionRef.current = null;
                if (riskMessage) {
                    setAutoVolatilityMode(false);
                    setLiveFeedback({ seq: Date.now(), kind: 'error', message: riskMessage });
                    return;
                }
                if (position.isWin === false && runtimeRef.current.recoveryEnabled && !recoveryUsedRef.current) {
                    recoveryUsedRef.current = true;
                    const recoverySource = runtimeRef.current.rows.find(row =>
                        row.symbol === settledSymbol,
                    );
                    const recovery = recoverySource
                        ? selectAdaptiveDigitMarketPlan(
                            recoverySource,
                            runtimeRef.current.recoveryDigitWindow,
                        )?.recovery || null
                        : null;
                    if (recovery) {
                        fallbackAttemptedRef.current = false;
                        setRecoveryDecision(recovery);
                        setExecutionLeg('recovery-pending');
                        setLiveFeedback({
                            seq: Date.now(),
                            kind: 'info',
                            message: `Primary loss on ${recoverySource?.displayName || 'the selected market'}. Starting ${recovery.label} recovery.`,
                        });
                        setTimeout(() => executeDecisionRef.current(recovery, 'recovery'), 0);
                        return;
                    }
                }
                setLiveFeedback({
                    seq: Date.now(),
                    kind: position.isWin ? 'success' : 'info',
                    message: `${position.isWin ? 'Contract won' : 'Contract settled'}. Moving to the next qualified volatility market.`,
                });
                startQueuedAutoPrimary(`${position.isWin ? 'Contract won' : 'Contract settled'}.`);
                return;
            }

            if (runtimeRef.current.autoVolatilityMode && leg === 'recovery') {
                setExecutionLeg('idle');
                activeLegRef.current = null;
                activeDecisionRef.current = null;
                setLiveFeedback({
                    seq: Date.now(),
                    kind: position.isWin ? 'success' : 'info',
                    message: `Recovery ${position.isWin ? 'won' : 'settled'}. Moving to the next qualified volatility market.`,
                });
                startQueuedAutoPrimary(`Recovery ${position.isWin ? 'won' : 'settled'}.`);
                return;
            }

            if (leg === 'primary' && position.isWin === false) {
                recoveryTargetProfitRef.current = Math.max(0, -settledProfit);
            }

            if (leg === 'primary' && position.isWin === false && runtimeRef.current.recoveryEnabled && !recoveryUsedRef.current) {
                recoveryUsedRef.current = true;
                const nexusRecovery = nexusAdaptivePlanRef.current?.recovery;
                if (nexusRecovery) {
                    setRecoveryDecision(nexusRecovery);
                    setExecutionLeg('recovery-pending');
                    setLiveFeedback({
                        seq: Date.now(),
                        kind: 'info',
                        message: `Primary loss recorded. Starting ${nexusRecovery.label} recovery on ${nexusRecovery.displayName}.`,
                    });
                    setTimeout(() => executeDecisionRef.current(nexusRecovery, 'recovery'), 0);
                    return;
                }
                const runtimeRows = runtimeRef.current.rows.map(row => ({
                    symbol: row.symbol,
                    displayName: row.displayName,
                    prices: row.prices,
                    lastDigits: row.lastDigits,
                }));
                const recoverySource = runtimeRef.current.multiMarketScanning
                    ? runtimeRows[0]
                    : runtimeRows.find(item => item.symbol === runtimeRef.current.selectedSymbol) || runtimeRows[0];
                const recoverySignal = runtimeRef.current.multiMarketScanning
                    ? selectStrongestMarket(runtimeRows, runtimeRef.current.recoveryDigitWindow, runtimeRef.current.recoveryCondition)
                    : (() => {
                        const row = runtimeRef.current.rows.find(item => item.symbol === runtimeRef.current.selectedSymbol) || runtimeRef.current.rows[0];
                        return row
                            ? selectConfiguredMarket({
                                symbol: row.symbol,
                                displayName: row.displayName,
                                prices: row.prices,
                                lastDigits: row.lastDigits,
                            }, runtimeRef.current.recoveryDigitWindow, runtimeRef.current.recoveryCondition)
                            : null;
                    })();
                const recovery = recoverySignal
                    ? withPurchaseMarket(recoverySignal, runtimeRef.current.recoveryPurchaseMarket)
                    : recoverySource
                        ? createExplicitPurchaseDecision(
                            recoverySource,
                            runtimeRef.current.recoveryDigitWindow,
                            runtimeRef.current.recoveryCondition,
                            runtimeRef.current.recoveryPurchaseMarket,
                        )
                        : null;
                setRecoveryDecision(recovery);
                if (recovery) {
                    setExecutionLeg('recovery-pending');
                    setTimeout(() => executeDecisionRef.current(recovery, 'recovery'), 0);
                    return;
                }
                setLiveFeedback({
                    seq: Date.now(),
                    kind: 'error',
                    message: 'Primary trade lost, but no recovery pattern qualified.',
                });
            }

            setExecutionLeg('idle');
            activeLegRef.current = null;
            activeDecisionRef.current = null;
            if (leg === 'recovery' || position.isWin) nexusAdaptivePlanRef.current = null;
        };
        liveEngine.onPriceWindow = (prices, pipSize, isFreshTick) => {
            const pending = pendingAutoEntryRef.current;
            if (!pending || !isFreshTick || !prices.length) return;

            const latestPrice = prices[prices.length - 1];
            if (!Number.isFinite(latestPrice)) return;

            const freshSource = {
                symbol: pending.decision.symbol,
                displayName: pending.decision.displayName,
                prices,
                lastDigits: quotesToLastDigits(prices, pipSize),
                tradable: true,
            };
            const evidenceDigits = freshSource.lastDigits
                .slice(-60)
                .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
            if (evidenceDigits.length < 60) {
                const previousConfirmations = pending.confirmations;
                pending.confirmations = 0;
                if (pending.waitingFor !== 'window' || previousConfirmations > 0) {
                    const resetNotice = previousConfirmations > 0
                        ? ` The previous ${previousConfirmations}/3 confirmations were reset.`
                        : '';
                    emitNexusFeedback(
                        `Live digit history is still loading (${evidenceDigits.length}/60); waiting for a complete 60-tick window before confirming this candidate.${resetNotice} No order was sent.`,
                        'info',
                    );
                }
                pending.waitingFor = 'window';
                return;
            }

            const freshEvidenceConfirmed = isNexusDigitEvidenceQualified(pending.decision, freshSource);
            if (!freshEvidenceConfirmed) {
                if (nexusSessionRef.current) {
                    nexusSkippedCandidatesRef.current.set(
                        `${pending.decision.symbol}|${pending.decision.contractType}|${pending.decision.barrier || ''}`,
                        Date.now() + LOW_PAYOUT_MARKET_TTL_MS,
                    );
                    nexusSessionRef.current.nextLeg = pending.leg;
                }
                pendingAutoEntryRef.current = null;
                setExecutionLeg('idle');
                activeLegRef.current = null;
                activeDecisionRef.current = null;
                liveEngine.stop();
                emitNexusFeedback(
                    `The live 60-tick digit evidence no longer qualifies for ${pending.decision.displayName} · ${pending.decision.label}. Discarding this candidate and rescanning; no order was sent.`,
                    'info',
                );
                scheduleAutoRescan();
                return;
            }

            const freshSignalConfirmed = isNexusDigitDecisionQualified(pending.decision, freshSource);
            if (!freshSignalConfirmed) {
                const previousConfirmations = pending.confirmations;
                pending.confirmations = 0;
                if (pending.waitingFor !== 'match' || previousConfirmations > 0) {
                    const resetNotice = previousConfirmations > 0
                        ? ` The previous ${previousConfirmations}/3 confirmations were reset.`
                        : '';
                    const latestDigit = freshSource.lastDigits[freshSource.lastDigits.length - 1];
                    emitNexusFeedback(
                        `Live digit ${latestDigit} did not match ${pending.decision.label}.${resetNotice} The 60-tick evidence still qualifies, so Nexus is waiting for three consecutive matching fresh ticks.`,
                        'info',
                    );
                }
                pending.waitingFor = 'match';
                return;
            }

            pending.waitingFor = null;
            pending.confirmations += 1;
            if (pending.confirmations < 3) {
                emitNexusFeedback(
                    `Fresh digit confirmation ${pending.confirmations}/3 for ${pending.decision.displayName} · ${pending.decision.label}.`,
                );
                return;
            }

            const confirmedDigits = freshSource.lastDigits.slice(-pending.decision.digits.length);
            const entryDigit = confirmedDigits[confirmedDigits.length - 1];
            const confirmedDecision: RankedMarketDecision = {
                ...pending.decision,
                digits: confirmedDigits,
                entryDigit,
                reason: `${pending.decision.reason} Three fresh entry ticks matched; latest entry digit ${entryDigit}.`,
            };
            activeDecisionRef.current = confirmedDecision;
            if (pending.leg === 'recovery') setRecoveryDecision(confirmedDecision);
            else setPrimaryDecision(confirmedDecision);
            pendingAutoEntryRef.current = null;
            emitNexusFeedback(
                `Fresh 3/3 digit confirmation passed for ${confirmedDecision.displayName} · ${confirmedDecision.label}; entry digit ${entryDigit}. Requesting a live payout-checked quote.`,
            );
            setTimeout(() => liveEngine.placeBuyNow({
                symbol: confirmedDecision.symbol,
                contractType: confirmedDecision.contractType,
                barrier: confirmedDecision.barrier,
            }), 75);
        };
        return () => {
            liveEngine.stop();
            pendingAutoEntryRef.current = null;
            liveEngine.onStatus = () => {};
            liveEngine.onBuyFeedback = () => {};
            liveEngine.onPosition = () => {};
            liveEngine.onPriceWindow = () => {};
        };
    }, [autoVolatilityMode, emitNexusFeedback, liveEngine, riskFixtureMode, scheduleAutoRescan, startQueuedAutoPrimary, stopLoss, targetProfit, upsertJournalEntry]);

    const oosAccuracy = rows.length ? Math.round(averageWalkForwardAccuracy * 100) : 0;
    const modelLabel = isBusy ? 'SYNCING' : modelStatus;
    const capturedAt = lastUpdated
        ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';
    const activeDecision = autoVolatilityMode ? autoPrimaryDecision : primaryDecision || explicitPrimaryDecision;
    const effectivePrimaryPurchaseMarket = autoVolatilityMode
        ? (autoPrimaryDecision ? purchaseMarketFromDecision(autoPrimaryDecision) : null) || primaryPurchaseMarket
        : primaryPurchaseMarket;
    const effectiveRecoveryPurchaseMarket = autoVolatilityMode
        ? (recoveryDecision ? purchaseMarketFromDecision(recoveryDecision) : null) || recoveryPurchaseMarket
        : recoveryPurchaseMarket;
    const modelProbability = modelPick ? Math.round(modelPick.baselineProbability * 100) : 0;
    const openProfitLossValue =
        liveTrade?.isOpen && liveTrade.profit !== null && Number.isFinite(liveTrade.profit)
            ? liveTrade.profit
            : null;
    const openProfitLoss = openProfitLossValue ?? 0;
    const openProfitLossLabel = liveTrade?.isOpen
        ? openProfitLossValue === null ? 'Pending' : formatMoney(openProfitLossValue)
        : formatMoney(0);
    const totalProfitLoss = toolRealizedProfitLoss + openProfitLoss;
    const visibleJournalRows = journalRows.filter(entry => entry.contractId !== liveTrade?.contractId);
    const modelGate = modelPick?.validationGate || 'insufficient-evidence';
    const modelGateLabel = modelGate === 'validated'
        ? 'VALIDATED'
        : modelGate === 'failed'
            ? 'REJECTED'
            : 'EVIDENCE NEEDED';
    const modelGateTone = modelGate === 'validated' ? 'positive' : modelGate === 'failed' ? 'negative' : 'neutral';
    const runLabel = executionLeg !== 'idle'
        ? executionLeg.includes('recovery') ? 'RECOVERY ACTIVE' : 'PRIMARY ACTIVE'
        : autoVolatilityMode ? 'START DIGIT RUNNER' : 'RUN MODEL PICK';
    return (
        <main
            className='alpha-tool alpha-tool--model-cockpit'
            data-testid='alpha-tool'
            data-status={status}
            data-scan-source={scanSource}
            data-sample-size={sampleSize}
            data-discovered-count={discoveredCount}
            data-model-row-count={rows.length}
            data-model-version={MODEL_VERSION}
            data-scan-count={scanCount}
            data-error={errorMessage}
            data-failed-symbols={JSON.stringify(failedSymbols)}
            data-digit-window={digitWindow}
            data-recovery-digit-window={recoveryDigitWindow}
            data-primary-condition={primaryCondition}
            data-primary-market={marketConditionLabel(primaryCondition)}
            data-primary-purchase-market={effectivePrimaryPurchaseMarket}
            data-primary-purchase={purchaseMarketLabel(effectivePrimaryPurchaseMarket)}
            data-recovery-condition={recoveryCondition}
            data-recovery-market={marketConditionLabel(recoveryCondition)}
            data-recovery-purchase-market={effectiveRecoveryPurchaseMarket}
            data-recovery-purchase={purchaseMarketLabel(effectiveRecoveryPurchaseMarket)}
            data-execution-leg={executionLeg}
            data-auto-volatility-mode={autoVolatilityMode}
            data-execution-fixture={executionFixtureMode}
            data-confirmation-fixture={confirmationFixtureMode || ''}
            data-journal-count={journalRows.length}
            data-auto-trades={autoRiskRef.current.trades}
            data-auto-qualified-count={autoQualifiedDecisions.length}
            data-auto-qualified-symbols={autoQualifiedDecisions.map(decision => decision.symbol).join(',')}
            data-payout-floor={payoutFloor}
            data-payout-skip-count={payoutSkipCount}
            data-digit-fallback-count={digitFallbackCount}
            data-last-payout-skip={lastPayoutSkipMessage}
            data-realized-profit-loss={toolRealizedProfitLoss.toFixed(2)}
            data-open-profit-loss={openProfitLossValue?.toFixed(2) || ''}
            data-total-profit-loss={totalProfitLoss.toFixed(2)}
        >
            <header className='alpha-cockpit__topbar'>
                <div className='alpha-cockpit__brand'>
                    <span className='alpha-cockpit__brand-mark' aria-hidden='true'>A</span>
                    <div>
                        <span className='alpha-cockpit__overline'>NEXUS AI</span>
                        <strong>AI Auto Scan</strong>
                    </div>
                </div>
                <div className='alpha-cockpit__topbar-actions'>
                    <span className={`alpha-cockpit__connection alpha-cockpit__connection--${status}`}>
                        <span aria-hidden='true' />
                        {status === 'ready' ? 'FEED READY' : statusCopy[status].toUpperCase()}
                    </span>
                    <span className='alpha-cockpit__timestamp'>MODEL {MODEL_VERSION} · {capturedAt}</span>
                    <button type='button' className='alpha-cockpit__refresh' onClick={() => { setLiveFeedback(null); onScan(); }} disabled={isBusy} data-testid='button-run-scan'>
                        {isBusy ? 'SYNCING' : 'REFRESH DATA'}
                    </button>
                </div>
            </header>

            <div
                className={`alpha-cockpit__total-pnl alpha-cockpit__total-pnl--${totalProfitLoss >= 0 ? 'positive' : 'negative'}`}
                data-testid='tool-total-pnl'
                data-total-profit-loss={totalProfitLoss.toFixed(2)}
                aria-label='Profit and loss since this tool opened'
                aria-live='polite'
            >
                <div>
                    <span>TOTAL PROFIT / LOSS</span>
                    <strong>{formatMoney(totalProfitLoss)}</strong>
                </div>
                <small>Realized {formatMoney(toolRealizedProfitLoss)} · Open {openProfitLossLabel} · Since this tool opened</small>
            </div>

            <section className='alpha-cockpit__headline'>
                <div>
                            <span className='alpha-cockpit__overline'>DIGIT-ONLY AUTOMATED EXECUTION</span>
                    <h1>Scan. Qualify.<br /><em>Execute with rules.</em></h1>
                            <p>Only Over 1–5, Under 4–8, Even, and Odd are eligible. Rise/Fall is disabled. Every entry needs fresh digit confirmation and a live payout check; losses remain possible.</p>
                </div>
                <div className={`alpha-cockpit__gate alpha-cockpit__gate--${modelGateTone}`}>
                    <span className='alpha-cockpit__gate-label'>CURRENT MODEL GATE</span>
                    <strong data-testid='tool-model-status'>{modelLabel}</strong>
                    <small>{rows.length ? `${validatedRows} of ${rows.length} markets passed validation` : 'Run a scan to build evidence'}</small>
                </div>
            </section>

            <section className='alpha-cockpit__decision-grid' aria-label='Current model decision'>
                <article className='alpha-cockpit__decision-panel alpha-cockpit__decision-panel--signal' data-testid='tool-model-pick' data-symbol={modelPick?.symbol || ''}>
                    <div className='alpha-cockpit__panel-topline'>
                        <span className='alpha-cockpit__overline'>PRIMARY SIGNAL</span>
                        <span className={`alpha-cockpit__status-tag alpha-cockpit__status-tag--${modelGateTone}`}>{modelGateLabel}</span>
                    </div>
                    <div className='alpha-cockpit__signal-main'>
                        <div>
                            <span className='alpha-cockpit__label'>Selected market</span>
                            <h2>{modelPick?.displayName || 'Waiting for scan'}</h2>
                            <strong className='alpha-cockpit__symbol'>{modelPick?.symbol || '—'}</strong>
                        </div>
                        <div className='alpha-cockpit__probability'>
                            <span>BASELINE P</span>
                            <strong>{modelPick ? `${modelProbability}%` : '—'}</strong>
                        </div>
                    </div>
                    {modelPick ? <Sparkline prices={modelPick.prices} symbol={modelPick.symbol} /> : <div className='alpha-cockpit__empty-chart'>No observation window loaded</div>}
                    <div className='alpha-cockpit__signal-stats'>
                        <div><span>OOS accuracy</span><strong>{Math.round(modelPick?.walkForwardAccuracy * 100 || 0)}%</strong></div>
                        <div><span>Brier score</span><strong>{modelPick?.brierScore?.toFixed(3) || '—'}</strong></div>
                        <div><span>Sample</span><strong>{modelPick?.validationSamples || 0}</strong></div>
                        <div><span>Regime</span><strong>{modelPick?.regime || '—'}</strong></div>
                    </div>
                </article>

                <article className='alpha-cockpit__decision-panel alpha-cockpit__decision-panel--execution'>
                    <div className='alpha-cockpit__panel-topline'>
                        <span className='alpha-cockpit__overline'>EXECUTION CONTROL</span>
                        <span className={`alpha-cockpit__live-state alpha-cockpit__live-state--${liveStatus}`}>{liveStatus.toUpperCase()}</span>
                    </div>
                    <div className='alpha-cockpit__execution-row'>
                        <div>
                            <span className='alpha-cockpit__label'>AI proposed contract</span>
                            <strong className='alpha-cockpit__contract'>{activeDecision ? strategyContractDisplayLabel(activeDecision.contractType) : 'WAIT'}</strong>
                            <small>{activeDecision?.label || 'No qualified contract selected'}</small>
                        </div>
                        <div className='alpha-cockpit__direction'>
                            <span>ENTRY DIGIT</span>
                            <strong>{activeDecision?.entryDigit ?? activeDecision?.digits[activeDecision.digits.length - 1] ?? '—'}</strong>
                        </div>
                    </div>
                    <div className='alpha-cockpit__execution-reason'>
                        <span className='alpha-cockpit__label'>Why this candidate</span>
                        <p>{activeDecision?.reason || modelPick?.gateReasons?.[0] || 'No decision is available until the model has enough evidence.'}</p>
                    </div>
                    <div className='alpha-cockpit__execution-controls'>
                        <label>STAKE<input value={`$${stake}`} onChange={event => setStake(event.target.value.replace(/\D/g, '').slice(0, 5))} inputMode='numeric' aria-label='Stake' /></label>
                        <label>TARGET PROFIT<select value={targetProfit} onChange={event => setTargetProfit(event.target.value)} aria-label='Target profit'><option value='10'>$10</option><option value='15'>$15</option><option value='25'>$25</option><option value='50'>$50</option></select></label>
                        <label>STOP LOSS<select value={stopLoss} onChange={event => setStopLoss(event.target.value)} aria-label='Stop loss'><option value='5'>$5</option><option value='10'>$10</option><option value='20'>$20</option><option value='50'>$50</option></select></label>
                        <label>MARTINGALE<select value={martingale} onChange={event => setMartingale(event.target.value)} aria-label='Martingale'><option value='no'>OFF · 1x</option><option value='2'>ON · 2x</option><option value='3'>ON · 3x</option></select></label>
                        <label>MIN PAYOUT<select value={payoutFloor} onChange={event => setPayoutFloor(event.target.value)} aria-label='Minimum payout'><option value='1.5'>1.50x</option><option value='1.8'>1.80x</option><option value='2'>2.00x</option></select></label>
                    </div>
                    <div className='alpha-cockpit__execution-actions'>
                        <button
                            type='button'
                            className='alpha-cockpit__run'
                            onClick={runTrade}
                            disabled={!liveAuthorized || !liveMode || (autoVolatilityMode ? !autoPrimaryDecision : !explicitPrimaryDecision) || isBusy || executionLeg !== 'idle'}
                            data-testid='button-run-trade'
                        >
                            <span>{runLabel}</span><span aria-hidden='true'>↗</span>
                        </button>
                         <button type='button' className={`alpha-cockpit__mode ${autoVolatilityMode ? 'alpha-cockpit__mode--active' : ''}`} onClick={toggleAutoRunner} aria-pressed={autoVolatilityMode} data-testid='toggle-auto-volatility'>
                            <span className='alpha-cockpit__mode-dot' />{autoVolatilityMode ? 'DIGIT RUNNER ON' : 'MANUAL MODE'}
                        </button>
                    </div>
                    {liveFeedback ? <div className={`alpha-cockpit__feedback alpha-cockpit__feedback--${liveFeedback.kind}`} role={liveFeedback.kind === 'error' ? 'alert' : 'status'} data-testid='live-trade-feedback'>{liveFeedback.message}</div> : null}
                    {!liveAuthorized && !executionFixtureMode ? <small className='alpha-cockpit__auth-note'>Connect a Deriv account to enable execution. Model analysis remains read-only.</small> : null}
                </article>
            </section>

            <section className='alpha-cockpit__metric-strip' aria-label='Model metrics'>
                <div><span>MARKETS COVERED</span><strong>{rows.length || '—'}</strong><small>{discoveredCount || rows.length || 0} discovered</small></div>
                <div><span>VALIDATED</span><strong>{validatedRows || '—'}</strong><small>{rows.length ? `${Math.round((validatedRows / rows.length) * 100)}% of sample` : 'Awaiting scan'}</small></div>
                <div><span>OOS ACCURACY</span><strong>{oosAccuracy ? `${oosAccuracy}%` : '—'}</strong><small>{averageVolatility ? `${formatPercent(averageVolatility)} realized vol` : 'Model pending'}</small></div>
                <div><span>EXECUTION</span><strong>{liveTrade ? 'OPEN' : 'FLAT'}</strong><small>{journalRows.length} journal events · {payoutSkipCount} payout skips</small></div>
            </section>

            <section className='alpha-cockpit__workspace-grid'>
                <article className='alpha-cockpit__data-panel' data-testid='scan-coverage'>
                    <div className='alpha-cockpit__section-head'>
                        <div><span className='alpha-cockpit__overline'>MARKET UNIVERSE</span><h2>Volatility indices & qualified markets</h2></div>
                        <span className='alpha-cockpit__count'>{rows.length} / {discoveredCount || rows.length} markets</span>
                    </div>
                    <div className='alpha-cockpit__table-wrap'>
                        <table className='alpha-cockpit__table'>
                            <thead><tr><th>Market</th><th>Model</th><th>OOS</th><th>Volatility</th><th>Gate</th></tr></thead>
                            <tbody>
                                {rows.length ? rows.map(row => (
                                    <tr key={row.symbol} className={row.symbol === modelPick?.symbol ? 'alpha-cockpit__table-row--selected' : ''} data-symbol={row.symbol} data-selected={row.symbol === modelPick?.symbol} data-qualified={row.validationGate === 'validated'}>
                                        <td><strong>{row.symbol}</strong><small>{row.displayName}</small></td>
                                        <td><span className='alpha-cockpit__table-number'>{Math.round(row.baselineProbability * 100)}%</span><small>{row.regime}</small></td>
                                        <td>{Math.round(row.walkForwardAccuracy * 100)}%</td>
                                        <td>{formatPercent(row.realizedVolatility)}</td>
                                        <td><span className={`alpha-cockpit__row-gate alpha-cockpit__row-gate--${row.validationGate}`}>{row.validationGate === 'validated' ? 'PASS' : row.validationGate === 'failed' ? 'BLOCK' : 'HOLD'}</span></td>
                                    </tr>
                                )) : <tr><td colSpan={5} className='alpha-cockpit__table-empty'>{isBusy ? 'Collecting market observations…' : 'Run Refresh Data to load the model universe.'}</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </article>

                <aside className='alpha-cockpit__side-stack'>
                    <article className='alpha-cockpit__data-panel alpha-cockpit__rules-panel'>
                        <div className='alpha-cockpit__section-head'><div><span className='alpha-cockpit__overline'>STRATEGY BUILDER</span><h2>Primary rule & recovery marker</h2></div></div>
                        <label>PRIMARY WINDOW<select value={digitWindow} onChange={event => setDigitWindow(Number(event.target.value))} aria-label='Market 1 last digit count' data-testid='select-primary-digit-window'>{Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} latest digits</option>)}</select></label>
                        <label>PRIMARY CONDITION<MarketConditionSelect value={primaryCondition} onChange={setPrimaryCondition} label='Market 1 condition' testId='select-primary-market' /></label>
                        <label>PURCHASE TYPE<PurchaseMarketSelect value={primaryPurchaseMarket} onChange={setPrimaryPurchaseMarket} label='Market 1 purchase option' testId='select-primary-purchase' /></label>
                        <div className='alpha-cockpit__rule-divider' />
                        <label>RECOVERY CONDITION<MarketConditionSelect value={recoveryCondition} onChange={setRecoveryCondition} label='Recovery market condition' testId='select-recovery-market' /></label>
                        <label>RECOVERY TYPE<PurchaseMarketSelect value={recoveryPurchaseMarket} onChange={setRecoveryPurchaseMarket} label='Recovery market purchase option' testId='select-recovery-purchase' /></label>
                        <button type='button' className={`alpha-cockpit__scan-toggle ${recoveryEnabled ? 'alpha-cockpit__scan-toggle--on' : ''}`} onClick={() => setRecoveryEnabled(value => !value)} aria-pressed={recoveryEnabled} data-testid='toggle-recovery'><span />Recovery marker {recoveryEnabled ? 'ON' : 'OFF'}</button>
                        <button type='button' className={`alpha-cockpit__scan-toggle ${multiMarketScanning ? 'alpha-cockpit__scan-toggle--on' : ''}`} onClick={() => setMultiMarketScanning(value => !value)} aria-pressed={multiMarketScanning} data-testid='toggle-multi-market'><span />{multiMarketScanning ? 'All volatility indices active' : 'Single market active'}</button>
                    </article>
                </aside>
            </section>

            <section className='alpha-cockpit__journal-panel' data-testid='tool-journal'>
                <div className='alpha-cockpit__section-head'><div><span className='alpha-cockpit__overline'>EXECUTION HISTORY</span><h2>Trade journal</h2></div><span className='alpha-cockpit__count'>{liveTrade ? '1 open' : `${journalRows.length} recorded`}</span></div>
                <div className='alpha-cockpit__table-wrap'>
                    <table className='alpha-cockpit__table alpha-cockpit__table--journal'>
                        <thead><tr><th>Time</th><th>Market</th><th>Leg</th><th>Strategy</th><th>Price</th><th>Entry</th><th>Exit</th><th>State</th><th>Result</th></tr></thead>
                        <tbody>
                            {liveTrade ? (
                                <tr
                                    data-symbol={liveTrade.symbol}
                                    data-leg={liveTradeLeg || 'primary'}
                                    data-stake={liveTrade.stake}
                                >
                                    <td>{liveTrade.purchaseTime}</td>
                                    <td><strong>{liveTrade.symbol}</strong></td>
                                    <td>{liveTradeLeg === 'recovery' ? 'Recovery' : 'Primary'}</td>
                                    <td>{liveTradeDecision?.label || strategyContractDisplayLabel(liveTrade.contractType)}</td>
                                    <td>{liveTrade.currentSpot || '—'}</td>
                                    <td>{liveTrade.entrySpot || '—'}</td>
                                    <td>—</td>
                                    <td><span className='alpha-cockpit__row-gate alpha-cockpit__row-gate--validated'>OPEN</span></td>
                                    <td className={openProfitLossValue === null ? '' : openProfitLossValue >= 0 ? 'alpha-cockpit__gain' : 'alpha-cockpit__loss'}>
                                        {openProfitLossValue === null ? 'Live · P/L pending' : `Live · ${formatMoney(openProfitLossValue)}`}
                                    </td>
                                </tr>
                            ) : null}
                            {visibleJournalRows.map(entry => (
                                <tr
                                    key={entry.contractId}
                                    data-contract-id={entry.contractId}
                                    data-symbol={entry.symbol}
                                    data-leg={entry.leg}
                                    data-stake={entry.stake}
                                    data-profit={entry.profit === null ? undefined : entry.profit}
                                >
                                    <td>{entry.time}</td>
                                    <td><strong>{entry.symbol}</strong></td>
                                    <td>{entry.leg}</td>
                                    <td>{entry.strategy}</td>
                                    <td>{entry.price || '—'}</td>
                                    <td>{entry.entryPrice || '—'}</td>
                                    <td>{entry.exitPrice || '—'}</td>
                                    <td><span className={`alpha-cockpit__row-gate alpha-cockpit__row-gate--${entry.gate.toLowerCase()}`}>{entry.gate.toUpperCase()}</span></td>
                                    <td className={entry.profit !== null && entry.profit >= 0 ? 'alpha-cockpit__gain' : 'alpha-cockpit__loss'}>
                                        {entry.profit === null ? `Open · ${formatMoney(entry.payout)}` : `${entry.profit >= 0 ? '+' : ''}${formatMoney(entry.profit)}`}
                                    </td>
                                </tr>
                            ))}
                            {!liveTrade && !visibleJournalRows.length ? (
                                <tr>
                                    <td colSpan={9} className='alpha-cockpit__table-empty'>
                                        {liveFeedback?.message || 'No executions recorded. The journal will keep every approved attempt and settlement.'}
                                    </td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </section>
        </main>
    );
    return (
        <main
            className='alpha-tool'
            data-testid='alpha-tool'
            data-status={status}
            data-scan-source={scanSource}
            data-sample-size={sampleSize}
            data-discovered-count={discoveredCount}
            data-model-row-count={rows.length}
            data-model-version={MODEL_VERSION}
            data-scan-count={scanCount}
            data-error={errorMessage}
            data-failed-symbols={JSON.stringify(failedSymbols)}
            data-digit-window={digitWindow}
            data-recovery-digit-window={recoveryDigitWindow}
            data-primary-condition={primaryCondition}
            data-primary-market={marketConditionLabel(primaryCondition)}
            data-primary-purchase-market={effectivePrimaryPurchaseMarket}
            data-primary-purchase={purchaseMarketLabel(effectivePrimaryPurchaseMarket)}
            data-recovery-condition={recoveryCondition}
            data-recovery-market={marketConditionLabel(recoveryCondition)}
            data-recovery-purchase-market={effectiveRecoveryPurchaseMarket}
            data-recovery-purchase={purchaseMarketLabel(effectiveRecoveryPurchaseMarket)}
            data-execution-leg={executionLeg}
            data-auto-volatility-mode={autoVolatilityMode}
            data-execution-fixture={executionFixtureMode}
            data-journal-count={journalRows.length}
            data-auto-trades={autoRiskRef.current.trades}
            data-payout-floor={payoutFloor}
            data-payout-skip-count={payoutSkipCount}
            data-digit-fallback-count={digitFallbackCount}
            data-last-payout-skip={lastPayoutSkipMessage}
        >
            <header className='alpha-tool__hero'>
                <button type='button' className='alpha-tool__menu' aria-label='Open tool menu'>
                    <span />
                    <span />
                    <span />
                </button>
                <div className='alpha-tool__hero-copy'>
                    <span className='alpha-tool__eyebrow'>Rule-based execution workspace</span>
                    <h1>Clear Rules.<br />Live Digits.<br /><strong>Controlled Execution.</strong></h1>
                </div>
                <div className='alpha-tool__hero-art' aria-hidden='true'>
                    <span className='alpha-tool__globe' />
                    <span className='alpha-tool__trend-line alpha-tool__trend-line--one' />
                    <span className='alpha-tool__trend-line alpha-tool__trend-line--two' />
                    <span className='alpha-tool__candle alpha-tool__candle--one' />
                    <span className='alpha-tool__candle alpha-tool__candle--two' />
                    <span className='alpha-tool__candle alpha-tool__candle--three' />
                    <span className='alpha-tool__hero-spark' />
                </div>
                <div className='alpha-tool__headline-card'>
                    <div className='alpha-tool__headline-icon'>✦</div>
                    <span>Volatility engine</span>
                    <strong data-testid='tool-model-status'>{modelLabel}</strong>
                    <small>{scanSource === 'fixture'
                        ? 'Deterministic fixture · layout checks only'
                        : rows.length
                            ? `${rows.length} symbols · checked ${capturedAt}`
                            : 'Scan required before execution'}</small>
                </div>
            </header>

            <section className='alpha-tool__selector-grid' aria-label='Execution controls' data-testid='tool-model-pick' data-symbol={modelPick?.symbol || ''}>
                <div className='alpha-tool__selector alpha-tool__selector--green'>
                    <span className='alpha-tool__selector-icon'>∿</span>
                    <span className='alpha-tool__selector-copy'><b>Digit route</b><small>{autoVolatilityMode ? 'Evidence-selected digit market' : multiMarketScanning ? 'Model-selected market' : 'Single selected market'}</small></span>
                    <strong className='alpha-tool__selector-value'>
                        {autoVolatilityMode
                            ? autoPrimaryRow?.displayName || 'Waiting for digit evidence'
                            : (multiMarketScanning ? modelPick : selectedRow)?.displayName || 'Waiting for scan'}
                    </strong>
                </div>
                <div className='alpha-tool__selector alpha-tool__selector--purple alpha-tool__selector--rule' data-testid='market-1-rule'>
                    <span className='alpha-tool__selector-icon'>◉</span>
                    <span className='alpha-tool__selector-copy'><b>Market 1</b><small>Primary purchase rule</small></span>
                    <div className='alpha-tool__selector-rule'>
                        <div className='alpha-tool__selector-rule-line'>
                            <span>If the last</span>
                            <select
                                className='alpha-tool__rule-select alpha-tool__rule-select--digits'
                                value={digitWindow}
                                onChange={event => setDigitWindow(Number(event.target.value))}
                                aria-label='Market 1 last digit count'
                                data-testid='select-primary-digit-window'
                            >
                                {Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
                            </select>
                            <span>digits are</span>
                            <MarketConditionSelect value={primaryCondition} onChange={setPrimaryCondition} label='Market 1 condition' testId='select-primary-market' />
                            <span>purchase</span>
                            <PurchaseMarketSelect value={primaryPurchaseMarket} onChange={setPrimaryPurchaseMarket} label='Market 1 purchase option' testId='select-primary-purchase' />
                        </div>
                    </div>
                </div>
                <div className='alpha-tool__selector alpha-tool__selector--blue alpha-tool__selector--rule alpha-tool__selector--recovery-rule' data-testid='market-2-rule'>
                    <span className='alpha-tool__selector-icon'>◌</span>
                    <span className='alpha-tool__selector-copy'><b>Recovery Market</b><small>After Market 1 loss</small></span>
                    <div className='alpha-tool__selector-rule'>
                        <div className='alpha-tool__selector-rule-line'>
                            <span>If the last</span>
                            <select
                                className='alpha-tool__rule-select alpha-tool__rule-select--digits'
                                value={recoveryDigitWindow}
                                onChange={event => setRecoveryDigitWindow(Number(event.target.value))}
                                aria-label='Market 2 last digit count'
                                data-testid='select-recovery-digit-window'
                            >
                                {Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
                            </select>
                            <span>digits are</span>
                            <MarketConditionSelect value={recoveryCondition} onChange={setRecoveryCondition} label='Recovery market condition' testId='select-recovery-market' />
                            <span>purchase</span>
                            <PurchaseMarketSelect value={recoveryPurchaseMarket} onChange={setRecoveryPurchaseMarket} label='Recovery market purchase option' testId='select-recovery-purchase' />
                        </div>
                    </div>
                </div>
            </section>

            <section className='alpha-tool__panel alpha-tool__panel--settings'>
                <div className='alpha-tool__panel-heading'>
                    <span className='alpha-tool__panel-icon'>⚙</span>
                    <b>Trade Settings</b>
                    <button
                        type='button'
                        className='alpha-tool__scan-mode'
                        onClick={() => setMultiMarketScanning(value => !value)}
                        aria-pressed={multiMarketScanning}
                        aria-label='Toggle multi-market scanning'
                        data-testid='toggle-multi-market'
                    >
                        <span>{multiMarketScanning ? 'Multi scan' : 'Single scan'}</span>
                        <span className={`alpha-tool__switch ${multiMarketScanning ? 'alpha-tool__switch--on' : ''}`} aria-hidden='true'><span /></span>
                    </button>
                    <button
                        type='button'
                        className='alpha-tool__scan-mode'
                        onClick={toggleAutoRunner}
                        aria-pressed={autoVolatilityMode}
                        aria-label='Toggle digit-only automatic runner'
                        data-testid='toggle-auto-volatility'
                    >
                        <span>{autoVolatilityMode ? 'Auto runner' : 'Manual runner'}</span>
                        <span className={`alpha-tool__switch ${autoVolatilityMode ? 'alpha-tool__switch--on' : ''}`} aria-hidden='true'><span /></span>
                    </button>
                </div>
                <div className='alpha-tool__setting-row'><span className='alpha-tool__setting-icon'>◎</span><span>Stake</span><input value={`$${stake}`} onChange={event => setStake(event.target.value.replace(/\D/g, '').slice(0, 5))} inputMode='numeric' aria-label='Stake' /></div>
                <label className='alpha-tool__setting-row'><span className='alpha-tool__setting-icon'>%</span><span>Min Payout</span><select value={payoutFloor} onChange={event => setPayoutFloor(event.target.value)} aria-label='Minimum payout'><option value='1.5'>1.50x</option><option value='1.8'>1.80x</option><option value='2'>2.00x</option></select></label>
                <label className='alpha-tool__setting-row'><span className='alpha-tool__setting-icon'>↗</span><span>Target Profit</span><select value={targetProfit} onChange={event => setTargetProfit(event.target.value)} aria-label='Target profit'><option value='10'>$10</option><option value='15'>$15</option><option value='25'>$25</option><option value='50'>$50</option></select></label>
                <label className='alpha-tool__setting-row'><span className='alpha-tool__setting-icon'>↓</span><span>Stop Loss</span><select value={stopLoss} onChange={event => setStopLoss(event.target.value)} aria-label='Stop loss'><option value='5'>$5</option><option value='10'>$10</option><option value='20'>$20</option><option value='50'>$50</option></select></label>
                <label className='alpha-tool__setting-row'><span className='alpha-tool__setting-icon'>×</span><span>Martingale</span><select value={martingale} onChange={event => setMartingale(event.target.value)} aria-label='Martingale'><option value='no'>No (1x)</option><option value='2'>2x</option><option value='3'>3x</option></select></label>
                <div className='alpha-tool__settings-note'>
                    {autoVolatilityMode
                        ? `Digit-only runner · Over 1–5, Under 4–8, Even, Odd · 60-tick evidence + 3 fresh matching entry digits · payout ≥ ${payoutFloor}x · one contract at a time`
                        : 'One-tick digit contract · only Over 1–5, Under 4–8, Even, or Odd · recovery requires a better quote and enough profit to cover the deficit'}
                </div>
            </section>

            <section className='alpha-tool__auto-trade'>
                <span className='alpha-tool__auto-icon'>ϟ</span>
                <div><b>Live Execution</b><small>{liveMode ? 'Deriv account required' : 'Execution locked'}</small></div>
                <button type='button' className={`alpha-tool__switch ${liveMode ? 'alpha-tool__switch--on' : ''}`} onClick={() => setLiveMode(value => !value)} aria-pressed={liveMode}><span /></button>
                <div className='alpha-tool__action-stack'>
                    <button
                        type='button'
                        className='alpha-tool__run'
                        onClick={runTrade}
                        disabled={!liveAuthorized || !liveMode || (autoVolatilityMode ? !autoPrimaryDecision : !explicitPrimaryDecision) || isBusy || executionLeg !== 'idle'}
                        data-testid='button-run-trade'
                        title={liveAuthorized
                            ? autoVolatilityMode
                                ? 'Start the automatic volatility runner'
                                : 'Buy one one-tick Deriv contract using the selected purchase market'
                            : 'Log in to run a real Deriv trade'}
                    >
                        {executionLeg !== 'idle' ? 'Running' : autoVolatilityMode ? 'Auto run' : 'Run'}
                    </button>
                    <button type='button' className='alpha-tool__refresh' onClick={() => { setLiveFeedback(null); onScan(); }} disabled={isBusy} data-testid='button-run-scan'>
                        <span>{isBusy ? 'Syncing' : 'Refresh Model'}</span>
                    </button>
                        {liveFeedback ? (
                            <div
                                className={`alpha-tool__live-feedback alpha-tool__live-feedback--${liveFeedback.kind}`}
                                role={liveFeedback.kind === 'error' ? 'alert' : 'status'}
                                data-testid='live-trade-feedback'
                            >
                                {liveFeedback.message}
                            </div>
                        ) : null}
                </div>
            </section>

            <section className='alpha-tool__scan-coverage panel' data-testid='scan-coverage'>
                <div className='alpha-tool__section-heading'>
                    <div><span className='alpha-tool__section-icon'>◎</span><b>Automatic Scan Coverage</b></div>
                    <span className='alpha-tool__view-label'>{rows.length} / {discoveredCount || rows.length} markets</span>
                </div>
                <p className='alpha-tool__scan-coverage-note'>
                    Each open index is checked for evidence on Over 1–5, Under 4–8, Even, and Odd. Rise/Fall and other digit contracts are excluded. Automated entries require three fresh matching digits and a live payout quote; no outcome is guaranteed.
                </p>
                <div className='alpha-tool__scan-coverage-list'>
                    {rows.map(row => {
                        const rowCandidates = autoQualifiedDecisions.filter(decision => decision.symbol === row.symbol);
                        const nextRoute = rowCandidates[0];
                        const isCandidate = row.symbol === autoCandidateSymbol;
                        const wasExecuted = journalRows.some(entry => entry.symbol === row.symbol);
                        const status = row.status === 'closed'
                            ? 'Symbol closed'
                            : wasExecuted
                                ? 'Signal executed'
                                : isCandidate
                                    ? 'Next digit route'
                                    : rowCandidates.length
                                        ? 'Qualified'
                                        : 'Conditions not met';
                        const conditionSummary = nextRoute
                            ? `${nextRoute.label} · 60-tick evidence`
                            : 'No allowed digit route passed';
                        const reason = row.status === 'closed'
                            ? 'Symbol status is closed; it cannot be selected.'
                            : nextRoute?.reason || 'No allowed digit route passed the recent-digit evidence screen.';
                        return (
                            <div
                                className={`alpha-tool__scan-market${isCandidate ? ' alpha-tool__scan-market--selected' : ''}${rowCandidates.length ? ' alpha-tool__scan-market--qualified' : ''}${wasExecuted ? ' alpha-tool__scan-market--executed' : ''}`}
                                key={row.symbol}
                                data-symbol={row.symbol}
                                data-selected={isCandidate}
                                data-qualified={rowCandidates.length > 0}
                                title={`${conditionSummary} — ${reason}`}
                            >
                                <span className='alpha-tool__scan-market-copy'>
                                    <span className='alpha-tool__scan-market-symbol'>{row.symbol}</span>
                                    <small>{conditionSummary}</small>
                                </span>
                                <span className='alpha-tool__scan-market-status'>{status}</span>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className='alpha-tool__journal panel' data-testid='tool-journal'>
                <div className='alpha-tool__section-heading'>
                    <div><span className='alpha-tool__section-icon'>▤</span><b>Trade Journal · Executed Contracts</b></div>
                    <span className='alpha-tool__view-label'>{liveTrade ? '1 running' : 'No trades running'}⌄</span>
                </div>
                <div className='alpha-tool__journal-table-wrap'>
                    <table className='alpha-tool__journal-table'>
                        <thead><tr><th>Time</th><th>Volatility</th><th>Market</th><th>Strategy</th><th>Price</th><th>Entry</th><th>Exit</th><th>Gate</th><th>Return</th></tr></thead>
                        <tbody>
                            {liveTrade ? (
                                <tr data-symbol={liveTrade.symbol}>
                                    <td>{liveTrade.purchaseTime}</td>
                                    <td><span className='alpha-tool__table-icon'>∿</span>{liveTrade.symbol}</td>
                                    <td>{liveTradeLeg === 'recovery' ? 'Market 2' : 'Market 1'}</td>
                                    <td><span className='alpha-tool__brain'>♧</span>{liveTradeDecision?.label || 'Selected market'}</td>
                                    <td>{liveTrade.currentSpot || '—'}</td>
                                    <td>{liveTrade.entrySpot || '—'}</td>
                                    <td>—</td>
                                    <td><span className='alpha-tool__result alpha-tool__result--validated'>Running</span></td>
                                    <td className='alpha-tool__gain'>Live · {formatMoney(liveTrade.profit)}</td>
                                </tr>
                            ) : (
                                journalRows.length ? journalRows.map(entry => (
                                    <tr key={entry.contractId} data-contract-id={entry.contractId}>
                                        <td>{entry.time}</td>
                                        <td><span className='alpha-tool__table-icon'>∿</span>{entry.symbol}</td>
                                        <td>{entry.market}</td>
                                        <td><span className='alpha-tool__brain'>♧</span>{entry.strategy}</td>
                                        <td>{entry.price || '—'}</td>
                                        <td>{entry.entryPrice || '—'}</td>
                                        <td>{entry.exitPrice || '—'}</td>
                                        <td><span className={`alpha-tool__result alpha-tool__result--${entry.gate.toLowerCase()}`}>{entry.gate}</span></td>
                                        <td className={entry.profit !== null && entry.profit >= 0 ? 'alpha-tool__gain' : 'alpha-tool__loss'}>
                                            {entry.profit === null
                                                ? `Open · ${formatMoney(entry.stake)} → ${formatMoney(entry.payout)}`
                                                : `${entry.profit >= 0 ? '+' : ''}${formatMoney(entry.profit)} · ${formatMoney(entry.stake)} → ${formatMoney(entry.payout)}`}
                                        </td>
                                    </tr>
                                )) : (
                                    <tr><td colSpan={9} className='alpha-tool__journal-empty'>{isBusy ? 'No trades running · model is scanning…' : liveFeedback?.message || 'No trades running. Run a validated model pick to start.'}</td></tr>
                                )
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className='alpha-tool__summary-grid'>
                <div className='alpha-tool__summary-card alpha-tool__summary-card--blue'><span>◎</span><small>Models</small><strong>{rows.length || '—'}</strong><em>covered</em></div>
                <div className='alpha-tool__summary-card alpha-tool__summary-card--green'><span>✓</span><small>Validated</small><strong>{validatedRows || '—'}</strong><em>{rows.length ? `${Math.round((validatedRows / rows.length) * 100)}%` : '—'}</em></div>
                <div className='alpha-tool__summary-card alpha-tool__summary-card--pink'><span>×</span><small>Gated</small><strong>{rows.length ? rows.length - validatedRows : '—'}</strong><em>live gated</em></div>
                <div className='alpha-tool__summary-card alpha-tool__summary-card--purple'><span>✦</span><small>OOS accuracy</small><strong>{oosAccuracy ? `${oosAccuracy}%` : '—'}</strong><em>{averageVolatility ? `${formatPercent(averageVolatility)} volatility` : 'model pending'}</em></div>
            </section>
        </main>
    );
};

const AlphaScanWorkspace: React.FC = () => {
    const fixtureMode = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('alpha_scan_fixture') === '1';
    const executionFixtureMode = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('alpha_scan_execution_fixture') === '1';
    const confirmationFixtureMode: AlphaConfirmationFixture = typeof window !== 'undefined'
        ? (() => {
            const requested = new URLSearchParams(window.location.search).get('alpha_scan_confirmation_fixture');
            return requested === 'reverse' ||
                requested === 'route-change' ||
                requested === 'nexus-digits' ||
                requested === 'repeated-price-ticks' ||
                requested === 'mismatch-then-match-ticks' ||
                requested === 'evidence-decay' ||
                requested === 'nexus-call' ||
                requested === 'nexus-put'
                ? requested
                : null;
        })()
        : null;
    const unavailableContractFixture: AlphaUnavailableContractFixture = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('alpha_scan_unavailable_contract') === '1'
        ? 'once'
        : null;
    const recoveryFixtureMode: AlphaRecoveryFixture = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('alpha_scan_recovery_fixture') === 'loss'
        ? 'loss'
        : null;
    const requestedRiskFixture = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('alpha_scan_risk_fixture')
        : null;
    const riskFixtureMode: AlphaRiskFixture | null = requestedRiskFixture === 'target' ||
        requestedRiskFixture === 'stop-loss' ||
        requestedRiskFixture === 'consecutive-losses' ||
        requestedRiskFixture === 'trade-count'
        ? requestedRiskFixture
        : null;
    const autoRunnerFixture = fixtureMode && executionFixtureMode;
    const [sampleSize, setSampleSize] = useState<SampleSize>(() => {
        if (typeof window === 'undefined') return 600;
        const requested = Number(new URLSearchParams(window.location.search).get('alpha_scan_sample'));
        return requested === 1200 || requested === 300 ? requested : 600;
    });
    const [status, setStatus] = useState<ScanStatus>('idle');
    const [rows, setRows] = useState<ScanRow[]>([]);
    const [discoveredCount, setDiscoveredCount] = useState(0);
    const [completedCount, setCompletedCount] = useState(0);
    const [failedCount, setFailedCount] = useState(0);
    const [failedSymbols, setFailedSymbols] = useState<string[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [hasMoreSymbols, setHasMoreSymbols] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [discoverySource, setDiscoverySource] = useState<DiscoverySource>('public-metadata');

    const socketRef = useRef<WebSocket | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scanIdRef = useRef(0);
    const pendingRef = useRef(new Set<number>());
    const resultRowsRef = useRef<ScanRow[]>([]);
    const failedSymbolsRef = useRef(new Set<string>());
    const loadMoreRef = useRef<() => void>(() => {});
    const infiniteSentinelRef = useRef<HTMLDivElement | null>(null);

    const closeSocket = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        if (socketRef.current) {
            socketRef.current.onclose = null;
            socketRef.current.close();
            socketRef.current = null;
        }
        pendingRef.current.clear();
        loadMoreRef.current = () => {};
    }, []);

    const finishWithCurrentData = useCallback((nextStatus: ScanStatus, message = '') => {
        setStatus(nextStatus);
        setErrorMessage(message);
        setLastUpdated(resultRowsRef.current.length ? new Date() : null);
    }, []);

    const scan = useCallback((options: { preserveExisting?: boolean } = {}) => {
        const preserveExisting = options.preserveExisting === true;
        const previousRows = resultRowsRef.current;
        closeSocket();
        const scanId = scanIdRef.current + 1;
        scanIdRef.current = scanId;
        const scanSearchParams = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search)
            : null;
        const simulatedFailureSymbol = scanSearchParams?.get('alpha_scan_failure_symbol') || '';
        const simulatedFailureMode = scanSearchParams?.get('alpha_scan_failure_mode') === 'error'
            ? 'error'
            : 'incomplete';
        let simulatedFailureTarget = '';
        let simulatedFailureUsed = false;
        resultRowsRef.current = [];
        failedSymbolsRef.current = new Set<string>();
        pendingRef.current = new Set<number>();
        if (preserveExisting && previousRows.length) {
            setRows(previousRows);
        } else {
            setRows([]);
        }
        if (!preserveExisting) setDiscoveredCount(0);
        setCompletedCount(0);
        setFailedCount(0);
        setFailedSymbols([]);
        setLastUpdated(null);
        setErrorMessage('');
        setHasMoreSymbols(false);
        setIsLoadingMore(false);
        setDiscoverySource(fixtureMode ? 'fixture' : 'public-metadata');
        setStatus('discovering');

        if (fixtureMode) {
            const fixtureRows = buildFixtureRows(sampleSize, autoRunnerFixture, confirmationFixtureMode);
            resultRowsRef.current = fixtureRows;
            setRows(fixtureRows);
            setDiscoveredCount(fixtureRows.length);
            setCompletedCount(fixtureRows.length);
            setFailedCount(0);
            setFailedSymbols([]);
            setLastUpdated(new Date());
            setErrorMessage('Deterministic fixture data — live market feed not requested.');
            setStatus('ready');
            return;
        }

        const socket = new WebSocket(DERIV_WS_URL);
        socketRef.current = socket;
        const requestMap = new Map<number, SyntheticSymbol>();
        let discoveredSymbols: SyntheticSymbol[] = [];
        let nextSymbolIndex = 0;
        let metadataReceived = false;
        const completedCountRef = { current: 0 };

        const recordFailure = (symbol: string) => {
            failedSymbolsRef.current.add(symbol);
            const nextFailedSymbols = Array.from(failedSymbolsRef.current);
            setFailedCount(nextFailedSymbols.length);
            setFailedSymbols(nextFailedSymbols);
        };

        const recordPendingFailures = () => {
            for (const symbol of requestMap.values()) recordFailure(symbol.symbol);
        };

        const failedSymbolMessage = (phase: FailurePhase) => {
            const symbols = Array.from(failedSymbolsRef.current);
            return symbols.length
                ? `${phase} incomplete for symbols: ${symbols.join(', ')}.`
                : '';
        };

        const handleScanTimeout = () => {
            if (scanIdRef.current !== scanId) return;
            recordPendingFailures();
            const failures = failedSymbolMessage('History collection');
            if (!metadataReceived) {
                finishWithCurrentData(
                    'timeout',
                    'Metadata discovery timed out: no public market metadata arrived within the time limit.',
                );
                setHasMoreSymbols(false);
                setIsLoadingMore(false);
                closeSocket();
                return;
            }
            if (resultRowsRef.current.length) {
                finishWithCurrentData(
                    'partial-data',
                    `History collection timed out; rows shown are the data received so far.${failures ? ` ${failures}` : ''}`,
                );
            } else {
                finishWithCurrentData(
                    'timeout',
                    `History collection timed out: no usable history arrived within the time limit.${failures ? ` ${failures}` : ''}`,
                );
            }
            setHasMoreSymbols(false);
            setIsLoadingMore(false);
            closeSocket();
        };

        const armScanTimeout = () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(handleScanTimeout, SCAN_TIMEOUT_MS);
        };

        const requestNextPage = () => {
            if (
                scanIdRef.current !== scanId ||
                pendingRef.current.size > 0 ||
                nextSymbolIndex >= discoveredSymbols.length ||
                socket.readyState !== WebSocket.OPEN
            ) {
                return;
            }

            const page = discoveredSymbols.slice(nextSymbolIndex, nextSymbolIndex + SYMBOL_PAGE_SIZE);
            nextSymbolIndex += page.length;
            setStatus('collecting');
            setIsLoadingMore(true);
            setHasMoreSymbols(nextSymbolIndex < discoveredSymbols.length);
            setErrorMessage(`Loading symbols ${nextSymbolIndex - page.length + 1}–${nextSymbolIndex} of ${discoveredSymbols.length}.`);
            armScanTimeout();

            page.forEach((symbol, pageIndex) => {
                const reqId = scanId * 100000 + nextSymbolIndex - page.length + pageIndex + 1;
                requestMap.set(reqId, symbol);
                pendingRef.current.add(reqId);
                socket.send(
                    JSON.stringify({
                        ticks_history: symbol.symbol,
                        end: 'latest',
                        count: sampleSize,
                        style: 'ticks',
                        req_id: reqId,
                    }),
                );
            });
        };

        const completePageIfDone = () => {
            if (scanIdRef.current !== scanId || pendingRef.current.size > 0) return;

            const hasMore = nextSymbolIndex < discoveredSymbols.length;
            setHasMoreSymbols(hasMore);

            // Model validation must cover the complete discovered universe. Keep
            // requesting pages automatically while rows stream into the ledger.
            if (hasMore) {
                requestNextPage();
                return;
            }

            setIsLoadingMore(false);
            closeSocket();
            if (!resultRowsRef.current.length) {
                const failures = failedSymbolMessage('History collection');
                finishWithCurrentData(
                    'empty',
                    `History collection failed: no history was returned for the discovered synthetic symbols.${failures ? ` ${failures}` : ''}`,
                );
            } else if (failedSymbolsRef.current.size) {
                finishWithCurrentData(
                    'partial-data',
                    `${failedSymbolMessage('History collection')} ${failedSymbolsRef.current.size} symbol${failedSymbolsRef.current.size === 1 ? '' : 's'} did not return a complete sample.`,
                );
            } else {
                finishWithCurrentData('ready');
            }
        };

        socket.onopen = () => {
            if (scanIdRef.current !== scanId) return;
            socket.send(JSON.stringify({ active_symbols: 'full', req_id: scanId }));
        };

        socket.onmessage = event => {
            if (scanIdRef.current !== scanId) return;
            let message: WebSocketMessage;
            try {
                message = JSON.parse(event.data as string) as WebSocketMessage;
            } catch {
                return;
            }

            if (message.error && message.echo_req?.active_symbols) {
                finishWithCurrentData(
                    'connection-error',
                    `Metadata discovery failed: ${message.error.message || 'the market metadata request was rejected.'}`,
                );
                closeSocket();
                return;
            }

            if (message.active_symbols && !metadataReceived) {
                metadataReceived = true;
                const metadataSymbols = discoverVolatilitySymbols(message.active_symbols);
                const supportedCodes = new Set(DERIV_VOLATILITIES.map(index => index.code));
                const matchedMetadataCount = message.active_symbols.filter(record =>
                    supportedCodes.has(getMetadataSymbolCode(record)),
                ).length;
                const usingVerifiedCatalog = matchedMetadataCount === 0;
                discoveredSymbols = metadataSymbols;
                simulatedFailureTarget = simulatedFailureSymbol === 'first'
                    ? discoveredSymbols[0]?.symbol || ''
                    : simulatedFailureSymbol;
                setDiscoverySource(usingVerifiedCatalog ? 'verified-catalog' : 'public-metadata');
                setDiscoveredCount(discoveredSymbols.length);
                if (!discoveredSymbols.length) {
                    finishWithCurrentData(
                        'empty',
                        `Metadata discovery failed: the public metadata response returned ${message.active_symbols.length} records, but none matched the supported Volatility Index symbols.`,
                    );
                    closeSocket();
                    return;
                }

                loadMoreRef.current = requestNextPage;
                setHasMoreSymbols(true);
                if (usingVerifiedCatalog) {
                    setErrorMessage(
                        `The public catalogue returned ${message.active_symbols.length} records. Validating the verified Volatility Index catalogue through live tick history.`,
                    );
                }
                requestNextPage();
                return;
            }

            if (message.req_id && requestMap.has(message.req_id)) {
                const symbol = requestMap.get(message.req_id);
                requestMap.delete(message.req_id);
                pendingRef.current.delete(message.req_id);
                const isSimulatedFailure = Boolean(
                    symbol &&
                    !simulatedFailureUsed &&
                    simulatedFailureTarget &&
                    simulatedFailureTarget === symbol.symbol,
                );
                if (isSimulatedFailure) simulatedFailureUsed = true;
                if (message.error || (isSimulatedFailure && simulatedFailureMode === 'error') || !message.history?.prices) {
                    if (symbol) {
                        recordFailure(symbol.symbol);
                        setErrorMessage(
                            `History collection failed for ${symbol.symbol}: ${
                                isSimulatedFailure && simulatedFailureMode === 'error'
                                    ? 'the deterministic regression response returned an error.'
                                    : message.error?.message || 'no history response returned.'
                            }`,
                        );
                    }
                } else if (symbol) {
                    const prices = message.history.prices.map(Number).filter(Number.isFinite);
                    const responsePrices = isSimulatedFailure ? prices.slice(0, 1) : prices;
                    if (responsePrices.length > 1) {
                        const pipSize = Number.isFinite(Number(message.pip_size))
                            ? Number(message.pip_size)
                            : symbol.pipSize;
                        const row = {
                            ...symbol,
                            prices: responsePrices,
                            pipSize: Number.isFinite(pipSize) ? pipSize as number : 0,
                            lastDigits: quotesToLastDigits(responsePrices, pipSize),
                            ...calculateMetrics(responsePrices),
                        };
                        resultRowsRef.current = [...resultRowsRef.current, row];
                        setRows(resultRowsRef.current);
                    } else {
                        recordFailure(symbol.symbol);
                        setErrorMessage(
                            `History collection failed for ${symbol.symbol}: the response contained fewer than two usable prices.`,
                        );
                    }
                }
                completedCountRef.current += 1;
                setCompletedCount(completedCountRef.current);
                completePageIfDone();
            }
        };

        socket.onerror = () => {
            if (scanIdRef.current !== scanId) return;
            if (!metadataReceived) {
                finishWithCurrentData('connection-error', 'Metadata discovery connection error: the public market feed could not be reached.');
                setHasMoreSymbols(false);
                setIsLoadingMore(false);
                closeSocket();
                return;
            }
            recordPendingFailures();
            const failures = failedSymbolMessage('History collection');
            if (resultRowsRef.current.length) {
                finishWithCurrentData(
                    'partial-data',
                    `History collection connection error: the connection closed before every requested symbol returned.${failures ? ` ${failures}` : ''}`,
                );
            } else {
                finishWithCurrentData(
                    'connection-error',
                    `History collection connection error: the public market feed could not be reached.${failures ? ` ${failures}` : ''}`,
                );
            }
            setHasMoreSymbols(false);
            setIsLoadingMore(false);
            closeSocket();
        };

        socket.onclose = () => {
            if (scanIdRef.current !== scanId) return;
            setHasMoreSymbols(false);
            setIsLoadingMore(false);
            if (pendingRef.current.size === 0 && resultRowsRef.current.length) {
                finishWithCurrentData('partial-data', 'History collection ended before all pages were loaded.');
                return;
            }
            if (pendingRef.current.size === 0) {
                if (!metadataReceived) {
                    finishWithCurrentData('connection-error', 'Metadata discovery connection error: the public market feed closed before returning metadata.');
                }
                return;
            }
            recordPendingFailures();
            const failures = failedSymbolMessage('History collection');
            if (resultRowsRef.current.length) {
                finishWithCurrentData(
                    'partial-data',
                    `History collection ended before every requested symbol returned.${failures ? ` ${failures}` : ''}`,
                );
            } else {
                finishWithCurrentData(
                    'connection-error',
                    `History collection ended before returning history.${failures ? ` ${failures}` : ''}`,
                );
            }
        };

        armScanTimeout();
    }, [autoRunnerFixture, closeSocket, finishWithCurrentData, fixtureMode, sampleSize]);

    useEffect(() => () => closeSocket(), [closeSocket]);

    useEffect(() => {
        scan();
    }, [scan]);

    useEffect(() => {
        const sentinel = infiniteSentinelRef.current;
        if (!sentinel || !hasMoreSymbols) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !isLoadingMore) {
                    loadMoreRef.current();
                }
            },
            { rootMargin: '480px 0px' },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMoreSymbols, isLoadingMore]);

    const isBusy = status === 'discovering' || status === 'collecting';
    const coverage = discoveredCount ? Math.round((rows.length / discoveredCount) * 100) : 0;
    const averageVolatility = rows.length ? mean(rows.map(row => row.realizedVolatility)) : 0;
    const averageBaselineProbability = rows.length ? mean(rows.map(row => row.baselineProbability)) : 0;
    const averageWalkForwardAccuracy = rows.length ? mean(rows.map(row => row.walkForwardAccuracy)) : 0;
    const averageBrierScore = rows.length ? mean(rows.map(row => row.brierScore)) : 0;
    const averageCalibrationError = rows.length ? mean(rows.map(row => row.calibrationError)) : 0;
    const validatedRows = rows.filter(row => row.validationGate === 'validated').length;
    const modelStatus = rows.length > 0 && coverage === 100 && validatedRows === rows.length
        ? 'ACTIVE'
        : validatedRows > 0
            ? 'PARTIAL'
            : 'SKIP';
    const modelStatusDescription = modelStatus === 'ACTIVE'
        ? `all ${rows.length} symbols passed validation gates`
        : modelStatus === 'PARTIAL'
            ? `${validatedRows} of ${rows.length} symbols passed; controls remain gated`
            : 'evidence, stability, or noise gates are incomplete';

    return (
        <AlphaToolSurface
            rows={rows}
            sampleSize={sampleSize}
            scanCount={scanIdRef.current}
            status={status}
            scanSource={discoverySource}
            executionFixtureMode={executionFixtureMode}
            confirmationFixtureMode={confirmationFixtureMode}
            unavailableContractFixture={unavailableContractFixture}
            recoveryFixtureMode={recoveryFixtureMode}
            riskFixtureMode={riskFixtureMode}
            isBusy={isBusy}
            lastUpdated={lastUpdated}
            modelStatus={modelStatus}
            averageWalkForwardAccuracy={averageWalkForwardAccuracy}
            averageVolatility={averageVolatility}
            validatedRows={validatedRows}
            discoveredCount={discoveredCount}
            failedSymbols={failedSymbols}
            errorMessage={errorMessage}
            onScan={scan}
        />
    );

    return (
        <main className='alpha-scan' aria-labelledby='alpha-scan-title'>
            <header className='alpha-scan__header'>
                <div className='alpha-scan__kicker'>
                    <span className='alpha-scan__signal-mark' aria-hidden='true'>
                        <span />
                        <span />
                        <span />
                    </span>
                    Nexus AI <span className='alpha-scan__kicker-divider'>/</span> Research terminal
                </div>
                <div className='alpha-scan__header-meta'>
                    <span className='alpha-scan__live-indicator' />
                    Public market data
                    <span className='alpha-scan__header-separator' />
                    Paper-only surface
                </div>
                <h1 id='alpha-scan-title'>Read the market before you read a signal.</h1>
                <p className='alpha-scan__lede'>
                    A disciplined synthetic index monitor built around observable history. Start with coverage, inspect the evidence, and keep uncertainty visible.
                </p>
            </header>

            <section className='alpha-scan__control-panel' aria-label='Scan controls'>
                <div className='alpha-scan__control-copy'>
                    <span className='alpha-scan__section-label'>Research action</span>
                     <h2>Build a statistical snapshot</h2>
                     <p>Discover eligible symbols from public metadata, validate each one through live history, and evaluate a calibrated feature model against an empirical benchmark.</p>
                </div>
                <div className='alpha-scan__controls'>
                    <label className='alpha-scan__select-label' htmlFor='alpha-scan-sample-size'>
                        Observation window
                        <select
                            id='alpha-scan-sample-size'
                            data-testid='select-sample-size'
                            value={sampleSize}
                            disabled={isBusy}
                            onChange={event => setSampleSize(Number(event.target.value) as SampleSize)}
                        >
                             <option value='300'>300 observations (descriptive)</option>
                            <option value='600'>600 observations</option>
                            <option value='1200'>1,200 observations</option>
                        </select>
                    </label>
                    <button
                        type='button'
                        className='alpha-scan__scan-button'
                        data-testid='button-run-scan'
                        onClick={scan}
                        disabled={isBusy}
                    >
                         <span>{isBusy ? 'Scanning public feed' : status === 'idle' ? 'Run statistical scan' : 'Run new scan'}</span>
                        <span className='alpha-scan__button-arrow' aria-hidden='true'>↗</span>
                    </button>
                </div>
                <p className='alpha-scan__control-note'>
                     Uses <code>active_symbols</code> and live <code>ticks_history</code> over a public WebSocket. The 300-tick window is descriptive only; use 600 or 1,200 ticks for validation evidence.
                    {discoverySource === 'verified-catalog' ? ' The public catalogue is empty, so each verified Synthetic Index is validated directly through live history.' : ' No account session is requested.'}
                </p>
            </section>

            <section className='alpha-scan__status-bar' aria-live='polite' data-testid='status-scan'>
                <StatusPill status={status} />
                <span className='alpha-scan__status-message'>
                    {errorMessage ||
                        (isBusy
                            ? `${completedCount} of ${discoveredCount || '…'} symbols processed`
                            : status === 'ready'
                                ? `Complete live-history coverage for ${rows.length} symbols.`
                                : status === 'idle'
                                    ? 'Nothing has been requested yet.'
                                    : statusCopy[status])}
                </span>
                {isBusy && discoveredCount > 0 && (
                    <span className='alpha-scan__progress' aria-label={`${completedCount} of ${discoveredCount} symbols processed`}>
                        <span style={{ width: `${Math.min(100, (completedCount / discoveredCount) * 100)}%` }} />
                    </span>
                )}
            </section>

            {status === 'idle' && (
                <section className='alpha-scan__idle' data-testid='state-idle'>
                    <div className='alpha-scan__idle-grid' aria-hidden='true'>
                        <span />
                        <span />
                        <span />
                        <span />
                    </div>
                    <div className='alpha-scan__idle-content'>
                        <span className='alpha-scan__eyebrow'>First phase / evidence layer</span>
                         <h2>Know what was observed.</h2>
                          <p>The calibrated feature model activates after live history arrives. It uses a causal median filter to remove isolated tick spikes before leakage-safe walk-forward evaluation; the trade decision layer remains gated until every symbol passes validation.</p>
                        <div className='alpha-scan__principles'>
                             <div><strong>01</strong><span>Causal denoising, not fabricated certainty</span></div>
                            <div><strong>02</strong><span>Public data, timestamped at capture</span></div>
                            <div><strong>03</strong><span>SKIP until production validation exists</span></div>
                        </div>
                    </div>
                </section>
            )}

            {(status === 'discovering' || status === 'collecting') && (
                <section className='alpha-scan__loading' data-testid='state-loading'>
                    <div className='alpha-scan__loading-scanline' aria-hidden='true' />
                    <div className='alpha-scan__loading-copy'>
                        <span className='alpha-scan__eyebrow'>{status === 'discovering' ? 'Stage 01 / discovery' : 'Stage 02 / collection'}</span>
                        <h2>{status === 'discovering' ? 'Reading market metadata' : 'Collecting historical observations'}</h2>
                        <p>{status === 'discovering' ? 'Filtering the public symbol catalogue for Synthetic Index metadata.' : 'Each symbol is requested independently. A partial response is kept visible rather than hidden.'}</p>
                    </div>
                    <div className='alpha-scan__skeleton-table' aria-hidden='true'>
                        <span />
                        <span />
                        <span />
                    </div>
                </section>
            )}

            {(status === 'empty' || status === 'timeout' || status === 'connection-error') && (
                <section className='alpha-scan__empty' data-testid={`state-${status}`}>
                    <div className='alpha-scan__empty-index'>{status === 'empty' ? '00' : '!!'}</div>
                    <div>
                        <span className='alpha-scan__eyebrow'>{status === 'empty' ? 'No coverage' : 'Scan interrupted'}</span>
                        <h2>{status === 'empty' ? 'No eligible symbols returned.' : status === 'timeout' ? 'The public feed took too long.' : 'The public feed is unavailable.'}</h2>
                        <p>{errorMessage || 'Try the scan again when the public data connection is available.'}</p>
                        <button type='button' className='alpha-scan__secondary-button' data-testid='button-retry-scan' onClick={scan}>Retry scan</button>
                    </div>
                </section>
            )}

            {(rows.length > 0 || status === 'partial-data') && (
                <>
                    <section className='alpha-scan__summary' aria-label='Snapshot summary'>
                        <div className='alpha-scan__summary-heading'>
                            <div>
                                 <span className='alpha-scan__section-label'>Snapshot / validation gate</span>
                                <h2>Coverage at a glance</h2>
                            </div>
                            <div className='alpha-scan__capture'>
                                <span>Last captured</span>
                                <strong data-testid='text-last-captured'>{formatTime(lastUpdated)}</strong>
                            </div>
                        </div>
                        <div className='alpha-scan__summary-grid'>
                            <div className='alpha-scan__summary-cell'>
                                <span>Symbols covered</span>
                                <strong data-testid='text-coverage'>{rows.length}<small> / {discoveredCount || rows.length}</small></strong>
                                <em>{coverage}% response coverage</em>
                            </div>
                            <div className='alpha-scan__summary-cell'>
                                <span>Sample window</span>
                                <strong data-testid='text-sample-window'>{sampleSize.toLocaleString()}</strong>
                                <em>requested observations per symbol</em>
                            </div>
                            <div className='alpha-scan__summary-cell'>
                                <span>Mean realized volatility</span>
                                <strong data-testid='text-mean-volatility'>{formatPercent(averageVolatility)}</strong>
                                <em>log-return dispersion / tick</em>
                            </div>
                             <div className='alpha-scan__summary-cell'>
                                 <span>Mean tick noise</span>
                                 <strong data-testid='text-mean-noise'>{formatPercent(mean(rows.map(row => row.noiseFraction)) * 100)}</strong>
                                 <em>residual after causal median filter</em>
                             </div>
                             <div className={`alpha-scan__summary-cell alpha-scan__summary-cell--decision alpha-scan__summary-cell--${modelStatus.toLowerCase()}`}>
                                 <span>Model status</span>
                                 <strong data-testid='text-model-status'>{modelStatus}</strong>
                                 <em>{MODEL_VERSION} · {modelStatusDescription}</em>
                            </div>
                        </div>
                    </section>

                    <section className='alpha-scan__table-section' aria-labelledby='alpha-scan-table-title'>
                        <div className='alpha-scan__table-heading'>
                            <div>
                                <span className='alpha-scan__section-label'>Evidence ledger</span>
                                <h2 id='alpha-scan-table-title'>Synthetic index observations</h2>
                            </div>
                            <p>{failedCount > 0 ? `${failedCount} incomplete response${failedCount === 1 ? '' : 's'}.` : 'Sorted by returned symbol order.'}</p>
                        </div>
                        <div className='alpha-scan__table-scroll'>
                            <table>
                                <thead>
                                    <tr>
                                        <th scope='col'>Symbol</th>
                                        <th scope='col'>Sample</th>
                                        <th scope='col'>Latest price</th>
                                        <th scope='col'>Short return<small>last 20</small></th>
                                         <th scope='col'>Realized vol.<small>per tick</small></th>
                                         <th scope='col'>Tick noise<small>filtered</small></th>
                                         <th scope='col'>Model P(up)<small>latest estimate</small></th>
                                        <th scope='col'>OOS accuracy<small>walk-forward</small></th>
                                        <th scope='col'>Brier score<small>lower is better</small></th>
                                        <th scope='col'>Calibration error<small>lower is better</small></th>
                                        <th scope='col'>Validation gate</th>
                                        <th scope='col'>Directional imbalance</th>
                                        <th scope='col'>Reversal rate</th>
                                        <th scope='col'>Descriptive regime</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => (
                                        <tr key={row.symbol} data-testid={`row-symbol-${row.symbol}`}>
                                            <th scope='row'>
                                                <div className='alpha-scan__symbol'>
                                                    <Sparkline prices={row.prices} symbol={row.symbol} />
                                                    <span>
                                                        <strong>{row.symbol}</strong>
                                                        <small>{row.submarket}</small>
                                                    </span>
                                                </div>
                                            </th>
                                            <td data-label='Sample'>{row.sampleSize.toLocaleString()}</td>
                                            <td data-label='Latest price' className='alpha-scan__mono'>{formatPrice(row.latestPrice)}</td>
                                            <td data-label='Short return' className={row.shortReturn >= 0 ? 'alpha-scan__positive' : 'alpha-scan__negative'}>{formatPercent(row.shortReturn, true)}</td>
                                            <td data-label='Realized volatility' className='alpha-scan__mono'>{formatPercent(row.realizedVolatility)}</td>
                                             <td data-label='Tick noise' className='alpha-scan__mono'>{formatPercent(row.noiseFraction * 100)}</td>
                                            <td data-label='Baseline probability' className='alpha-scan__mono'>{formatPercent(row.baselineProbability * 100)}</td>
                                            <td data-label='OOS accuracy' className='alpha-scan__mono'>{formatPercent(row.walkForwardAccuracy * 100)}</td>
                                            <td data-label='Brier score' className='alpha-scan__mono'>{formatRatio(row.brierScore)}</td>
                                            <td data-label='Calibration error' className='alpha-scan__mono'>{formatPercent(row.calibrationError * 100)}</td>
                                            <td data-label='Validation gate'>
                                                <span
                                                    className={`alpha-scan__regime alpha-scan__regime--${row.validationGate}`}
                                                    title={row.gateReasons.length ? row.gateReasons.join(' ') : `${MODEL_VERSION}: every validation gate passed.`}
                                                >
                                                    {row.validationGate === 'validated' ? 'Passed' : row.validationGate === 'failed' ? 'Failed' : 'Insufficient evidence'}
                                                </span>
                                            </td>
                                            <td data-label='Directional imbalance' className={row.directionalImbalance >= 0 ? 'alpha-scan__positive' : 'alpha-scan__negative'}>{formatRatio(row.directionalImbalance, true)}</td>
                                            <td data-label='Reversal rate'>{formatPercent(row.reversalRate)}</td>
                                            <td data-label='Descriptive regime'><span className='alpha-scan__regime'>{row.regime}</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                    {hasMoreSymbols && (
                        <>
                            <div ref={infiniteSentinelRef} className='alpha-scan__infinite-sentinel' aria-hidden='true' />
                            <div className='alpha-scan__infinite-loader' aria-live='polite' data-testid='infinite-loader'>
                                {isLoadingMore ? (
                                    <span>Loading the next page of public observations…</span>
                                ) : (
                                    <button type='button' onClick={() => loadMoreRef.current()}>
                                        Load more observations
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    <section className='alpha-scan__interpretation'>
                        <div className='alpha-scan__interpretation-main'>
                            <span className='alpha-scan__section-label'>Read the evidence</span>
                            <h2>Validation metrics are not permission to trade.</h2>
                            <p>Model P(up) is produced by the calibrated feature classifier using only observations available before each test tick. Accuracy and Brier score are walk-forward diagnostics; they are not a trade signal.</p>
                        </div>
                        <div className='alpha-scan__interpretation-side'>
                             <div><span>Mean model P(up)</span><strong>{formatPercent(averageBaselineProbability * 100)}</strong></div>
                            <div><span>Mean OOS accuracy</span><strong>{formatPercent(averageWalkForwardAccuracy * 100)}</strong></div>
                            <div><span>Mean Brier score</span><strong>{formatRatio(averageBrierScore)}</strong></div>
                            <div><span>Mean calibration error</span><strong>{formatPercent(averageCalibrationError * 100)}</strong></div>
                             <div><span>Mean tick noise</span><strong>{formatPercent(mean(rows.map(row => row.noiseFraction)) * 100)}</strong></div>
                            <div><span>Validated symbols</span><strong>{validatedRows} / {rows.length}</strong></div>
                            <div><span>Decision status</span><strong>SKIP — paper-only research</strong></div>
                        </div>
                    </section>
                </>
            )}

            <footer className='alpha-scan__disclosure'>
                <div className='alpha-scan__disclosure-mark'>i</div>
                <div>
                    <strong>Paper-only research surface</strong>
                     <p>No authenticated trading, no live execution, no payout or contract values, and no persistence of paper trades. The decision remains <b>SKIP — paper-only research</b> until every required validation gate passes.</p>
                </div>
            </footer>
        </main>
    );
};

const AlphaScanAI: React.FC = () => <AlphaScanWorkspace />;

export default AlphaScanAI;

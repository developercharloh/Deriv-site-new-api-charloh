import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useStore } from '@/hooks/useStore';
import {
    DTraderEngine,
    type DTBuyFeedback,
    type DTConfig,
    type DTPosition,
    type DTStatus,
} from '@/utils/dtrader-engine';
import {
    MARKET_OPTION_GROUPS,
    PURCHASE_MARKET_OPTION_GROUPS,
    marketConditionLabel,
    purchaseMarketLabel,
    type MarketCondition,
    type PurchaseMarket,
    type RankedMarketDecision,
    type StrategySource,
    quotesToLastDigits,
    selectConfiguredMarket,
    selectStrongestMarket,
    withPurchaseMarket,
} from './alpha-market-strategy';
import './alpha-scan-ai.scss';

const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1';
const SCAN_TIMEOUT_MS = 35_000;
const SHORT_RETURN_WINDOW = 20;
const SYMBOL_PAGE_SIZE = 8;
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

type SyntheticSymbol = {
    symbol: string;
    displayName: string;
    market: string;
    submarket: string;
    pipSize?: number;
};

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

const stringFromRecord = (record: Record<string, unknown>, keys: string[]): string =>
    keys.map(key => record[key]).find(value => typeof value === 'string' && value.length > 0) as string || '';

const numberFromRecord = (record: Record<string, unknown>, keys: string[]): number | undefined => {
    const value = keys.map(key => record[key]).find(candidate =>
        typeof candidate === 'number' || (typeof candidate === 'string' && candidate.length > 0),
    );
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const isSyntheticIndex = (record: Record<string, unknown>): boolean => {
    const symbol = stringFromRecord(record, ['symbol']);
    const metadata = [
        record.market,
        record.market_display_name,
        record.submarket,
        record.submarket_display_name,
        record.symbol_type,
        record.symbol_type_display_name,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/[_-]/g, ' ');

    const syntheticMetadata =
        metadata.includes('synthetic') ||
        metadata.includes('derived') ||
        metadata.includes('volatility') ||
        metadata.includes('continuous indice') ||
        metadata.includes('random indice') ||
        metadata.includes('jump index') ||
        metadata.includes('boom') ||
        metadata.includes('crash') ||
        metadata.includes('step index') ||
        metadata.includes('drift switch') ||
        metadata.includes('range break');
    const syntheticSymbolFamily = /^(?:R_|1HZ|JD|BOOM|CRASH|STEP|JUMP|DRIFT|RB_|RDB_)/i.test(symbol);

    return syntheticMetadata || syntheticSymbolFamily;
};

const discoverSyntheticSymbols = (records: Array<Record<string, unknown>>): SyntheticSymbol[] => {
    const seen = new Set<string>();

    return records
        .filter(isSyntheticIndex)
        .map(record => {
            const symbol = stringFromRecord(record, ['symbol']);
            if (!symbol || seen.has(symbol)) return null;
            seen.add(symbol);
            return {
                symbol,
                displayName: stringFromRecord(record, ['display_name', 'underlying_symbol', 'symbol']) || symbol,
                market: stringFromRecord(record, ['market_display_name', 'market']) || 'Synthetic Index',
                submarket: stringFromRecord(record, ['submarket_display_name', 'submarket']) || 'Synthetic',
                pipSize: numberFromRecord(record, ['pip_size']),
            };
        })
        .filter((item): item is SyntheticSymbol => item !== null);
};

const getVerifiedCatalogSymbols = (): SyntheticSymbol[] =>
    DERIV_VOLATILITIES.map(index => ({
        symbol: index.code,
        displayName: index.label,
        market: 'Derived',
        submarket: index.tickEvery === 1 ? 'Continuous Indices' : 'Volatility Indices',
    }));

const buildFixtureRows = (sampleSize: SampleSize): ScanRow[] => {
    const fixtureSymbols = [
        { symbol: 'R_10', displayName: 'Volatility 10 Index', submarket: 'Continuous Indices', digitPattern: [0, 2, 4, 6, 8] },
        { symbol: 'R_25', displayName: 'Volatility 25 Index', submarket: 'Continuous Indices', digitPattern: [1, 3, 5, 7, 9] },
        { symbol: 'R_50', displayName: 'Volatility 50 Index', submarket: 'Continuous Indices', digitPattern: [2, 4, 6, 8, 0] },
        { symbol: 'R_75', displayName: 'Volatility 75 Index', submarket: 'Continuous Indices', digitPattern: [9, 7, 5, 3, 1] },
    ];

    return fixtureSymbols.map((fixture, symbolIndex) => {
        const pipSize = 2;
        const prices = Array.from({ length: sampleSize }, (_, index) => {
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
    status: ScanStatus;
    scanSource: DiscoverySource;
    isBusy: boolean;
    lastUpdated: Date | null;
    modelStatus: string;
    averageWalkForwardAccuracy: number;
    averageVolatility: number;
    validatedRows: number;
    discoveredCount: number;
    errorMessage: string;
    onScan: () => void;
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
        {MARKET_OPTION_GROUPS.map(group => (
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
        {PURCHASE_MARKET_OPTION_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
                {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
        ))}
    </select>
);

const AlphaToolSurface: React.FC<AlphaToolSurfaceProps> = ({
    rows,
    sampleSize,
    status,
    scanSource,
    isBusy,
    lastUpdated,
    modelStatus,
    averageWalkForwardAccuracy,
    averageVolatility,
    validatedRows,
    discoveredCount,
    errorMessage,
    onScan,
}) => {
    const { client } = useStore();
    const liveEngineRef = useRef<DTraderEngine | null>(null);
    if (liveEngineRef.current === null) liveEngineRef.current = new DTraderEngine();
    const liveEngine = liveEngineRef.current;
    const [selectedSymbol, setSelectedSymbol] = useState('');
    const [digitWindow, setDigitWindow] = useState(3);
    const [recoveryDigitWindow, setRecoveryDigitWindow] = useState(3);
    const [primaryCondition, setPrimaryCondition] = useState<MarketCondition>('all-even');
    const [recoveryCondition, setRecoveryCondition] = useState<MarketCondition>('all-odd');
    const [primaryPurchaseMarket, setPrimaryPurchaseMarket] = useState<PurchaseMarket>('even');
    const [recoveryPurchaseMarket, setRecoveryPurchaseMarket] = useState<PurchaseMarket>('odd');
    const [multiMarketScanning, setMultiMarketScanning] = useState(true);
    const [stake, setStake] = useState('10');
    const [liveMode, setLiveMode] = useState(true);
    const [liveStatus, setLiveStatus] = useState<DTStatus>('idle');
    const [liveFeedback, setLiveFeedback] = useState<DTBuyFeedback | null>(null);
    const [liveTrade, setLiveTrade] = useState<DTPosition | null>(null);
    const [liveTradeLeg, setLiveTradeLeg] = useState<'primary' | 'recovery' | null>(null);
    const [liveTradeDecision, setLiveTradeDecision] = useState<RankedMarketDecision | null>(null);
    const [executionLeg, setExecutionLeg] = useState<'idle' | 'primary-pending' | 'primary-running' | 'recovery-pending' | 'recovery-running'>('idle');
    const [primaryDecision, setPrimaryDecision] = useState<RankedMarketDecision | null>(null);
    const [recoveryDecision, setRecoveryDecision] = useState<RankedMarketDecision | null>(null);
    const activeLegRef = useRef<'primary' | 'recovery' | null>(null);
    const activeDecisionRef = useRef<RankedMarketDecision | null>(null);
    const recoveryUsedRef = useRef(false);
    const executeDecisionRef = useRef<(decision: RankedMarketDecision, leg: 'primary' | 'recovery') => void>(() => {});
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
        multiMarketScanning,
        selectedSymbol,
    });

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

    const strategySources = useMemo<StrategySource[]>(() => rows.map(row => ({
        symbol: row.symbol,
        displayName: row.displayName,
        prices: row.prices,
        lastDigits: row.lastDigits,
    })), [rows]);

    const selectedRow = rows.find(row => row.symbol === selectedSymbol) || rows[0];
    const modelPick = bestModelRow || selectedRow;

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
    const liveAuthorized = isLoggedIn && Boolean(api_base.api && api_base.is_authorized);

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
            multiMarketScanning,
            selectedSymbol,
        };
    }, [client?.currency, digitWindow, liveAuthorized, liveMode, multiMarketScanning, primaryCondition, primaryPurchaseMarket, recoveryCondition, recoveryDigitWindow, recoveryPurchaseMarket, rows, selectedSymbol, stake]);

    const executeDecision = useCallback((decision: RankedMarketDecision, leg: 'primary' | 'recovery') => {
        const runtime = runtimeRef.current;
        if (!runtime.liveMode || !runtime.liveAuthorized) {
            setLiveFeedback({ seq: Date.now(), kind: 'error', message: 'Log in to a Deriv account before live execution.' });
            setExecutionLeg('idle');
            return;
        }

        const amount = Number(runtime.stake);
        if (!Number.isFinite(amount) || amount <= 0) {
            setLiveFeedback({ seq: Date.now(), kind: 'error', message: 'Enter a valid stake before executing.' });
            setExecutionLeg('idle');
            return;
        }

        const config: DTConfig = {
            symbol: decision.symbol,
            contractType: decision.contractType,
            durationValue: 1,
            durationUnit: 't',
            stake: amount,
            barrier: decision.barrier,
            currency: runtime.currency,
        };
        activeLegRef.current = leg;
        activeDecisionRef.current = decision;
        setExecutionLeg(leg === 'primary' ? 'primary-pending' : 'recovery-pending');
        setLiveFeedback(null);
        // Restarting for every leg ensures recovery subscribes to the selected
        // volatility before the fresh proposal is purchased.
        liveEngine.start(config);
        liveEngine.placeBuyNow(config);
    }, [liveEngine]);

    executeDecisionRef.current = executeDecision;

    useEffect(() => {
        liveEngine.onStatus = setLiveStatus;
        liveEngine.onBuyFeedback = setLiveFeedback;
        liveEngine.onPosition = position => {
            const leg = activeLegRef.current;
            if (position.isOpen) {
                setLiveTrade(position);
                setLiveTradeLeg(leg);
                setLiveTradeDecision(activeDecisionRef.current);
                setExecutionLeg(leg === 'recovery' ? 'recovery-running' : 'primary-running');
                return;
            }

            setLiveTrade(null);
            setLiveTradeLeg(null);
            setLiveTradeDecision(null);

            if (leg === 'primary' && position.isWin === false && !recoveryUsedRef.current) {
                recoveryUsedRef.current = true;
                const runtimeRows = runtimeRef.current.rows.map(row => ({
                    symbol: row.symbol,
                    displayName: row.displayName,
                    prices: row.prices,
                    lastDigits: row.lastDigits,
                }));
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
        };
        return () => {
            liveEngine.stop();
            liveEngine.onStatus = () => {};
            liveEngine.onBuyFeedback = () => {};
            liveEngine.onPosition = () => {};
        };
    }, [liveEngine]);

    const oosAccuracy = rows.length ? Math.round(averageWalkForwardAccuracy * 100) : 0;
    const modelLabel = isBusy ? 'SYNCING' : modelStatus;
    const capturedAt = lastUpdated
        ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';
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
            data-error={errorMessage}
            data-digit-window={digitWindow}
            data-recovery-digit-window={recoveryDigitWindow}
            data-primary-condition={primaryCondition}
            data-primary-market={marketConditionLabel(primaryCondition)}
            data-primary-purchase-market={primaryPurchaseMarket}
            data-primary-purchase={purchaseMarketLabel(primaryPurchaseMarket)}
            data-recovery-condition={recoveryCondition}
            data-recovery-market={marketConditionLabel(recoveryCondition)}
            data-recovery-purchase-market={recoveryPurchaseMarket}
            data-recovery-purchase={purchaseMarketLabel(recoveryPurchaseMarket)}
            data-execution-leg={executionLeg}
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
                    <span className='alpha-tool__selector-copy'><b>Volatility</b><small>{multiMarketScanning ? 'Model-selected market' : 'Single selected market'}</small></span>
                    <strong className='alpha-tool__selector-value'>{(multiMarketScanning ? modelPick : selectedRow)?.displayName || 'Waiting for scan'}</strong>
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
                </div>
                <div className='alpha-tool__setting-row'><span className='alpha-tool__setting-icon'>◎</span><span>Stake</span><input value={`$${stake}`} onChange={event => setStake(event.target.value.replace(/\D/g, '').slice(0, 5))} inputMode='numeric' aria-label='Stake' /></div>
                {!multiMarketScanning && (
                    <label className='alpha-tool__setting-row'><span className='alpha-tool__setting-icon'>∿</span><span>Volatility</span><select value={selectedSymbol} onChange={event => setSelectedSymbol(event.target.value)} aria-label='Selected volatility' data-testid='select-volatility'>
                        {rows.length ? rows.map(row => <option key={row.symbol} value={row.symbol}>{row.displayName}</option>) : <option value=''>Waiting for scan</option>}
                    </select></label>
                )}
                <div className='alpha-tool__setting-row alpha-tool__setting-row--toggle'><span className='alpha-tool__setting-icon'>◌</span><span>Multi-market scanning</span><button type='button' className={`alpha-tool__switch ${multiMarketScanning ? 'alpha-tool__switch--on' : ''}`} onClick={() => setMultiMarketScanning(value => !value)} aria-pressed={multiMarketScanning} aria-label='Toggle multi-market scanning' data-testid='toggle-multi-market'><span /></button></div>
                <div className='alpha-tool__settings-note'>One-tick contract · one selected market condition · recovery starts only after a primary loss</div>
            </section>

            <section className='alpha-tool__auto-trade'>
                <span className='alpha-tool__auto-icon'>ϟ</span>
                <div><b>Live Execution</b><small>{liveMode ? 'Deriv account required' : 'Execution locked'}</small></div>
                <button type='button' className={`alpha-tool__switch ${liveMode ? 'alpha-tool__switch--on' : ''}`} onClick={() => setLiveMode(value => !value)} aria-pressed={liveMode}><span /></button>
                <div className='alpha-tool__action-stack'>
                    <button type='button' className='alpha-tool__refresh' onClick={() => { setLiveFeedback(null); onScan(); }} disabled={isBusy} data-testid='button-run-scan'>
                        <span>{isBusy ? 'Syncing' : 'Refresh Model'}</span>
                    </button>
                </div>
            </section>

            <section className='alpha-tool__journal panel' data-testid='tool-journal'>
                <div className='alpha-tool__section-heading'>
                    <div><span className='alpha-tool__section-icon'>▤</span><b>Trade Journal</b></div>
                    <span className='alpha-tool__view-label'>{liveTrade ? '1 running' : 'No trades running'}⌄</span>
                </div>
                <div className='alpha-tool__journal-table-wrap'>
                    <table className='alpha-tool__journal-table'>
                        <thead><tr><th>Time</th><th>Volatility</th><th>Market</th><th>Strategy</th><th>Gate</th><th>Return</th></tr></thead>
                        <tbody>
                            {liveTrade ? (
                                <tr data-symbol={liveTrade.symbol}>
                                    <td>{liveTrade.purchaseTime}</td>
                                    <td><span className='alpha-tool__table-icon'>∿</span>{liveTrade.symbol}</td>
                                    <td>{liveTradeLeg === 'recovery' ? 'Market 2' : 'Market 1'}</td>
                                    <td><span className='alpha-tool__brain'>♧</span>{liveTradeDecision?.label || 'Selected market'}</td>
                                    <td><span className='alpha-tool__result alpha-tool__result--validated'>Running</span></td>
                                    <td className='alpha-tool__gain'>Live</td>
                                </tr>
                            ) : (
                                <tr><td colSpan={6} className='alpha-tool__journal-empty'>{isBusy ? 'No trades running · model is scanning…' : liveFeedback?.message || 'No trades running. Execute a validated model pick to start.'}</td></tr>
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

    const scan = useCallback(() => {
        closeSocket();
        const scanId = scanIdRef.current + 1;
        scanIdRef.current = scanId;
        resultRowsRef.current = [];
        failedSymbolsRef.current = new Set<string>();
        pendingRef.current = new Set<number>();
        setRows([]);
        setDiscoveredCount(0);
        setCompletedCount(0);
        setFailedCount(0);
        setLastUpdated(null);
        setErrorMessage('');
        setHasMoreSymbols(false);
        setIsLoadingMore(false);
        setDiscoverySource(fixtureMode ? 'fixture' : 'public-metadata');
        setStatus('discovering');

        if (fixtureMode) {
            const fixtureRows = buildFixtureRows(sampleSize);
            resultRowsRef.current = fixtureRows;
            setRows(fixtureRows);
            setDiscoveredCount(fixtureRows.length);
            setCompletedCount(fixtureRows.length);
            setFailedCount(0);
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
            setFailedCount(failedSymbolsRef.current.size);
        };

        const handleScanTimeout = () => {
            if (scanIdRef.current !== scanId) return;
            if (resultRowsRef.current.length) {
                finishWithCurrentData('partial-data', 'The scan reached its time limit; rows shown are the data received so far.');
            } else {
                finishWithCurrentData('timeout', 'No usable history arrived within the time limit.');
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
                finishWithCurrentData('empty', 'No history was returned for the discovered synthetic symbols.');
            } else if (failedSymbolsRef.current.size) {
                finishWithCurrentData('partial-data', `${failedSymbolsRef.current.size} symbol${failedSymbolsRef.current.size === 1 ? '' : 's'} did not return a complete sample.`);
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
                finishWithCurrentData('connection-error', message.error.message || 'The market metadata request was rejected.');
                closeSocket();
                return;
            }

            if (message.active_symbols && !metadataReceived) {
                metadataReceived = true;
                const metadataSymbols = discoverSyntheticSymbols(message.active_symbols);
                const usingVerifiedCatalog = metadataSymbols.length === 0;
                discoveredSymbols = usingVerifiedCatalog ? getVerifiedCatalogSymbols() : metadataSymbols;
                setDiscoverySource(usingVerifiedCatalog ? 'verified-catalog' : 'public-metadata');
                setDiscoveredCount(discoveredSymbols.length);
                if (!discoveredSymbols.length) {
                    finishWithCurrentData(
                        'empty',
                        `The public metadata response returned ${message.active_symbols.length} records, but none matched a Synthetic Index market or symbol family.`,
                    );
                    closeSocket();
                    return;
                }

                loadMoreRef.current = requestNextPage;
                setHasMoreSymbols(true);
                if (usingVerifiedCatalog) {
                    setErrorMessage(
                        `The public catalogue returned ${message.active_symbols.length} records. Validating the verified Synthetic Index catalogue through live tick history.`,
                    );
                }
                requestNextPage();
                return;
            }

            if (message.req_id && requestMap.has(message.req_id)) {
                const symbol = requestMap.get(message.req_id);
                requestMap.delete(message.req_id);
                pendingRef.current.delete(message.req_id);
                if (message.error || !message.history?.prices) {
                    if (symbol) recordFailure(symbol.symbol);
                } else if (symbol) {
                    const prices = message.history.prices.map(Number).filter(Number.isFinite);
                    if (prices.length > 1) {
                        const pipSize = Number.isFinite(Number(message.pip_size))
                            ? Number(message.pip_size)
                            : symbol.pipSize;
                        const row = {
                            ...symbol,
                            prices,
                            pipSize: Number.isFinite(pipSize) ? pipSize as number : 0,
                            lastDigits: quotesToLastDigits(prices, pipSize),
                            ...calculateMetrics(prices),
                        };
                        resultRowsRef.current = [...resultRowsRef.current, row];
                        setRows(resultRowsRef.current);
                    } else {
                        recordFailure(symbol.symbol);
                    }
                }
                completedCountRef.current += 1;
                setCompletedCount(completedCountRef.current);
                completePageIfDone();
            }
        };

        socket.onerror = () => {
            if (scanIdRef.current !== scanId) return;
            if (resultRowsRef.current.length) {
                finishWithCurrentData('partial-data', 'The connection closed before every requested symbol returned.');
            } else {
                finishWithCurrentData('connection-error', 'The public market feed could not be reached.');
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
                finishWithCurrentData('partial-data', 'The public market feed closed before all pages were loaded.');
                return;
            }
            if (pendingRef.current.size === 0) return;
            if (resultRowsRef.current.length) {
                finishWithCurrentData('partial-data', 'The connection closed before every requested symbol returned.');
            } else {
                finishWithCurrentData('connection-error', 'The public market feed closed before returning history.');
            }
        };

        armScanTimeout();
    }, [closeSocket, finishWithCurrentData, fixtureMode, sampleSize]);

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
            status={status}
            scanSource={discoverySource}
            isBusy={isBusy}
            lastUpdated={lastUpdated}
            modelStatus={modelStatus}
            averageWalkForwardAccuracy={averageWalkForwardAccuracy}
            averageVolatility={averageVolatility}
            validatedRows={validatedRows}
            discoveredCount={discoveredCount}
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
                    Alpha Scan AI <span className='alpha-scan__kicker-divider'>/</span> Research terminal
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
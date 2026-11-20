import { getPublicWsUrl } from '@/external/deriv-core/config/urls';
import { macdArray } from '@/external/indicators';
import { DERIV_VOLATILITIES, type DerivVolatility } from './deriv-volatilities';
import {
    BINARY_MATRIX_CONDITION_IDS,
    binaryMatrixDecisionForCondition,
    evaluateBinaryMatrix,
} from './binary-matrix-strategy';
import type { BinaryMatrixCondition, BinaryMatrixDecision } from './binary-matrix-strategy';

export type BinaryMatrixMarketRowStatus =
    | 'scanning'
    | 'candidate'
    | 'qualified'
    | 'indicator-mismatch'
    | 'no-signal'
    | 'insufficient-data'
    | 'unavailable';

export type BinaryMatrixIndicatorState = 'bullish' | 'bearish' | 'mixed' | 'unavailable';

export interface BinaryMatrixIndicators {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
    rsi: number | null;
    state: BinaryMatrixIndicatorState;
}

export interface BinaryMatrixMarketScanRow {
    symbol: string;
    label: string;
    status: BinaryMatrixMarketRowStatus;
    ruleTriggered: boolean;
    currentCondition: string | null;
    currentDigits: number[];
    macdHistogram: number | null;
    rsi: number | null;
    indicatorState: BinaryMatrixIndicatorState;
    digitRates: number[];
    trainingSampleCount: number;
    trainingWins: number;
    sampleCount: number;
    validationWins: number;
    validationWinRate: number | null;
    lowerConfidenceBound: number | null;
    breakEvenWinRate: number | null;
    score: number | null;
    reason: string;
}

export type BinaryMatrixCandidateOrder = 'weakest-first' | 'strongest-first';

export function rankBinaryMatrixCandidates(
    rows: readonly BinaryMatrixMarketScanRow[],
    order: BinaryMatrixCandidateOrder,
): BinaryMatrixMarketScanRow[] {
    const direction = order === 'weakest-first' ? 1 : -1;
    return [...rows].sort((left, right) => {
        const leftScore = left.score !== null && Number.isFinite(left.score) ? left.score : null;
        const rightScore = right.score !== null && Number.isFinite(right.score) ? right.score : null;
        if (leftScore === null && rightScore !== null) return order === 'weakest-first' ? -1 : 1;
        if (leftScore !== null && rightScore === null) return order === 'weakest-first' ? 1 : -1;
        if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
            return direction * (leftScore - rightScore);
        }
        const sampleDifference = left.sampleCount - right.sampleCount;
        if (sampleDifference !== 0) return direction * sampleDifference;
        return left.symbol.localeCompare(right.symbol);
    });
}

export interface BinaryMatrixScanSnapshot {
    status: 'idle' | 'connecting' | 'scanning' | 'waiting' | 'selected' | 'error';
    completedMarkets: number;
    totalMarkets: number;
    selectedSymbol: string | null;
    selectedContract: string | null;
    rows: BinaryMatrixMarketScanRow[];
    updatedAt: number | null;
    message: string;
}

export interface BinaryMatrixHistoricalEvidence {
    decision: BinaryMatrixDecision | null;
    indicators: BinaryMatrixIndicators;
    currentDigits: number[];
    trainingSampleCount: number;
    trainingWins: number;
    sampleCount: number;
    wins: number;
    winRate: number | null;
    trainingWinRate: number | null;
    lowerConfidenceBound: number | null;
    score: number | null;
}

interface RuleCounts {
    trainingWins: number;
    trainingTotal: number;
    validationWins: number;
    validationTotal: number;
}

interface MarketState {
    symbol: DerivVolatility;
    pipSize: number;
    digits: number[];
    prices: number[];
    ready: boolean;
    unavailableReason?: string;
}

interface WebSocketLike {
    readyState: number;
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    send(data: string): void;
    close(): void;
}

type SocketFactory = (url: string) => WebSocketLike;

const HISTORY_COUNT = 5000;
const MIN_VALIDATION_SAMPLES = 30;
const MIN_TRAINING_SAMPLES = 20;
const FAMILY_WISE_Z = 3.29;
export const DEFAULT_BINARY_MATRIX_MACD_SETTINGS = {
    fastEmaPeriod: 12,
    slowEmaPeriod: 26,
    signalEmaPeriod: 9,
    rsiPeriod: 14,
} as const;
const HISTORY_REQUEST_TIMEOUT_MS = 8000;
const NEXT_SYMBOL_DELAY_MS = 250;
export const BINARY_MATRIX_INDICATOR_HISTORY_LIMIT = 5000;
const MAX_DIGITS = BINARY_MATRIX_INDICATOR_HISTORY_LIMIT;
const PUBLIC_FEED_KEEPALIVE_INTERVAL_MS = 25_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 8000;

const defaultSocketFactory: SocketFactory = url => new WebSocket(url);

const lastDigitFromQuote = (value: unknown, pipSize: number): number | null => {
    const quote = Number(value);
    if (!Number.isFinite(quote) || !Number.isInteger(pipSize) || pipSize < 0 || pipSize > 10) return null;
    const fixed = quote.toFixed(pipSize);
    const digit = Number.parseInt(fixed[fixed.length - 1] ?? '', 10);
    return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : null;
};

export function calculateDigitRates(digits: readonly number[], windowSize = 1000): number[] {
    const window = digits.slice(-windowSize).filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    if (window.length === 0) return [];
    const counts = new Array(10).fill(0) as number[];
    window.forEach(digit => {
        counts[digit] += 1;
    });
    return counts.map(count => count / window.length);
}

const emptyIndicators = (): BinaryMatrixIndicators => ({
    macd: null,
    signal: null,
    histogram: null,
    rsi: null,
    state: 'unavailable',
});

const rsiFromAverages = (averageGain: number, averageLoss: number): number => {
    if (averageGain === 0 && averageLoss === 0) return 50;
    if (averageLoss === 0) return 100;
    if (averageGain === 0) return 0;
    const relativeStrength = averageGain / averageLoss;
    return 100 - 100 / (1 + relativeStrength);
};

export function calculateBinaryMatrixIndicatorSeries(prices: readonly number[]): BinaryMatrixIndicators[] {
    const series = Array.from({ length: prices.length }, emptyIndicators);
    const { fastEmaPeriod, slowEmaPeriod, signalEmaPeriod, rsiPeriod } =
        DEFAULT_BINARY_MATRIX_MACD_SETTINGS;

    const firstMacdIndex = slowEmaPeriod + signalEmaPeriod - 2;
    if (prices.length >= slowEmaPeriod + signalEmaPeriod - 1) {
        const macdValues = macdArray([...prices], {
            fastEmaPeriod,
            slowEmaPeriod,
            signalEmaPeriod,
            pipSize: 12,
        });
        macdValues.forEach(([histogram, macd, signal], index) => {
            const target = series[firstMacdIndex + index];
            if (!target || ![histogram, macd, signal].every(Number.isFinite)) return;
            target.histogram = histogram;
            target.macd = macd;
            target.signal = signal;
        });
    }

    if (prices.length > rsiPeriod) {
        let averageGain = 0;
        let averageLoss = 0;
        for (let index = 1; index <= rsiPeriod; index += 1) {
            const difference = prices[index] - prices[index - 1];
            averageGain += Math.max(difference, 0);
            averageLoss += Math.max(-difference, 0);
        }
        averageGain /= rsiPeriod;
        averageLoss /= rsiPeriod;
        series[rsiPeriod].rsi = rsiFromAverages(averageGain, averageLoss);

        for (let index = rsiPeriod + 1; index < prices.length; index += 1) {
            const difference = prices[index] - prices[index - 1];
            averageGain = (averageGain * (rsiPeriod - 1) + Math.max(difference, 0)) / rsiPeriod;
            averageLoss = (averageLoss * (rsiPeriod - 1) + Math.max(-difference, 0)) / rsiPeriod;
            series[index].rsi = rsiFromAverages(averageGain, averageLoss);
        }
    }

    return series.map(indicators => ({
        ...indicators,
        state: indicators.histogram === null || indicators.rsi === null
            ? 'unavailable'
            : indicators.histogram > 0 && indicators.rsi > 50
              ? 'bullish'
              : indicators.histogram < 0 && indicators.rsi < 50
                ? 'bearish'
                : 'mixed',
    }));
}

export function calculateBinaryMatrixIndicators(prices: readonly number[]): BinaryMatrixIndicators {
    const series = calculateBinaryMatrixIndicatorSeries(prices);
    return series[series.length - 1] ?? emptyIndicators();
}

export function indicatorsConfirmDecision(
    decision: BinaryMatrixDecision,
    indicators: BinaryMatrixIndicators | null | undefined,
): boolean {
    if (decision.contractType === 'DIGITOVER') return indicators?.state === 'bullish';
    if (decision.contractType === 'DIGITUNDER') return indicators?.state === 'bearish';
    return true;
}

export function wilsonLowerBound(wins: number, total: number, z = FAMILY_WISE_Z): number | null {
    if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0 || wins < 0 || wins > total) {
        return null;
    }
    const p = wins / total;
    const zSquared = z * z;
    const denominator = 1 + zSquared / total;
    const center = p + zSquared / (2 * total);
    const margin = z * Math.sqrt((p * (1 - p) + zSquared / (4 * total)) / total);
    return (center - margin) / denominator;
}

const didContractWin = (decision: BinaryMatrixDecision, digit: number): boolean => {
    switch (decision.contractType) {
        case 'DIGITEVEN':
            return digit % 2 === 0;
        case 'DIGITODD':
            return digit % 2 === 1;
        case 'DIGITOVER':
            return digit > Number(decision.barrier);
        case 'DIGITUNDER':
            return digit < Number(decision.barrier);
        default:
            return false;
    }
};

/**
 * Tests the existing matrix rules against a chronological holdout segment.
 * The rule is selected using only the preceding four digits; the following
 * digit is the observed one-tick contract result.
 */
export function analyzeBinaryMatrixHistories(
    digits: readonly number[],
    prices: readonly number[] = [],
): BinaryMatrixHistoricalEvidence[] {
    const normalized = digits.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const indicatorSeries = calculateBinaryMatrixIndicatorSeries(prices);
    const indicators = indicatorSeries[normalized.length - 1] ?? emptyIndicators();
    const counts = new Map<string, RuleCounts>();
    const lastCountedAt = new Map<string, number>();
    const splitAt = Math.floor(normalized.length * 0.6);

    for (let resultIndex = 4; resultIndex < normalized.length; resultIndex += 1) {
        const priorWindow = normalized.slice(resultIndex - 4, resultIndex);
        const historicalDecision = evaluateBinaryMatrix(priorWindow);
        if (!historicalDecision?.condition) continue;
        const historicalIndicators = indicatorSeries[resultIndex - 1];
        if (!indicatorsConfirmDecision(historicalDecision, historicalIndicators)) continue;
        const previousResult = lastCountedAt.get(historicalDecision.condition);
        if (previousResult !== undefined && resultIndex - previousResult < 4) continue;

        const rule = counts.get(historicalDecision.condition) ?? {
            trainingWins: 0,
            trainingTotal: 0,
            validationWins: 0,
            validationTotal: 0,
        };
        const won = didContractWin(historicalDecision, normalized[resultIndex]);
        if (resultIndex < splitAt) {
            rule.trainingTotal += 1;
            if (won) rule.trainingWins += 1;
        } else {
            rule.validationTotal += 1;
            if (won) rule.validationWins += 1;
        }
        counts.set(historicalDecision.condition, rule);
        lastCountedAt.set(historicalDecision.condition, resultIndex);
    }

    return BINARY_MATRIX_CONDITION_IDS.map(condition => {
        const decision = binaryMatrixDecisionForCondition(condition, normalized);
        const evidence = counts.get(condition);
        const trainingSampleCount = evidence?.trainingTotal ?? 0;
        const trainingWins = evidence?.trainingWins ?? 0;
        const sampleCount = evidence?.validationTotal ?? 0;
        const wins = evidence?.validationWins ?? 0;
        const winRate = sampleCount > 0 ? wins / sampleCount : null;
        const trainingWinRate = trainingSampleCount > 0 ? trainingWins / trainingSampleCount : null;
        const lowerConfidenceBound =
            trainingSampleCount >= MIN_TRAINING_SAMPLES && sampleCount >= MIN_VALIDATION_SAMPLES
                ? wilsonLowerBound(wins, sampleCount)
                : null;
        const clearsTrainingCheck = trainingWinRate !== null && trainingWinRate > 0.5;
        const score =
            lowerConfidenceBound !== null && clearsTrainingCheck
                ? lowerConfidenceBound - 0.5
                : null;

        return {
            decision,
            indicators,
            currentDigits: normalized.slice(-4),
            trainingSampleCount,
            trainingWins,
            sampleCount,
            wins,
            winRate,
            trainingWinRate,
            lowerConfidenceBound: clearsTrainingCheck ? lowerConfidenceBound : null,
            score,
        };
    });
}

export function analyzeBinaryMatrixHistory(
    digits: readonly number[],
    prices: readonly number[] = [],
    targetCondition?: BinaryMatrixCondition,
): BinaryMatrixHistoricalEvidence {
    const normalized = digits.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const evidences = analyzeBinaryMatrixHistories(normalized, prices);
    if (targetCondition) {
        return evidences.find(evidence => evidence.decision?.condition === targetCondition) ?? {
            decision: null,
            indicators: evidences[0]?.indicators ?? emptyIndicators(),
            currentDigits: normalized.slice(-4),
            trainingSampleCount: 0,
            trainingWins: 0,
            sampleCount: 0,
            wins: 0,
            winRate: null,
            trainingWinRate: null,
            lowerConfidenceBound: null,
            score: null,
        };
    }

    const currentDecision = evaluateBinaryMatrix(normalized.slice(-4));
    return currentDecision
        ? evidences.find(evidence => evidence.decision?.condition === currentDecision.condition)!
        : {
            decision: null,
            indicators: evidences[0]?.indicators ?? emptyIndicators(),
            currentDigits: normalized.slice(-4),
            trainingSampleCount: 0,
            trainingWins: 0,
            sampleCount: 0,
            wins: 0,
            winRate: null,
            trainingWinRate: null,
            lowerConfidenceBound: null,
            score: null,
        };
}

export class BinaryMatrixMarketScanner {
    private socket: WebSocketLike | null = null;
    private requestIndex = 0;
    private pendingRequestId: number | null = null;
    private requestTimer: ReturnType<typeof setTimeout> | null = null;
    private nextRequestTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    private reconnectAttempts = 0;
    private stopped = true;
    private socketFactory: SocketFactory;
    private symbols: DerivVolatility[];
    private readonly marketStates = new Map<string, MarketState>();
    private readonly subscriptionSymbols = new Map<string, string>();
    private readonly rowsBySymbol = new Map<string, BinaryMatrixMarketScanRow>();
    private onUpdate: (snapshot: BinaryMatrixScanSnapshot) => void = () => {};
    private onError: (message: string) => void = () => {};

    constructor(options: { socketFactory?: SocketFactory; symbols?: DerivVolatility[] } = {}) {
        this.socketFactory = options.socketFactory ?? defaultSocketFactory;
        this.symbols = options.symbols ?? DERIV_VOLATILITIES;
        this.symbols.forEach(symbol => {
            this.marketStates.set(symbol.code, {
                symbol,
                pipSize: 2,
                digits: [],
                prices: [],
                ready: false,
            });
        });
    }

    getPriceHistory(symbol: string): number[] {
        return [...(this.marketStates.get(symbol)?.prices ?? [])];
    }

    start(
        onUpdate: (snapshot: BinaryMatrixScanSnapshot) => void,
        onError: (message: string) => void,
    ): void {
        this.stop();
        this.reset();
        this.stopped = false;
        this.onUpdate = onUpdate;
        this.onError = onError;
        this.emit('connecting', 'Connecting to the public volatility tick feed.');

        this.connect();
    }

    private connect(): void {
        if (this.stopped) return;
        try {
            this.socket = this.socketFactory(getPublicWsUrl());
        } catch (error) {
            this.scheduleReconnect(error instanceof Error ? error.message : 'Could not connect to the volatility tick feed.');
            return;
        }

        const socket = this.socket;
        socket.onopen = () => {
            if (this.stopped || this.socket !== socket) return;
            this.startKeepAlive(socket);
            this.emit('scanning', 'Loading recent tick history for each volatility market.');
            this.requestNextHistory();
        };
        socket.onmessage = event => {
            if (!this.stopped && this.socket === socket) this.handleMessage(event.data);
        };
        socket.onerror = () => this.scheduleReconnect('The volatility tick feed reported a connection error.', socket);
        socket.onclose = () => this.scheduleReconnect('The volatility tick feed disconnected.', socket);
    }

    private startKeepAlive(socket: WebSocketLike): void {
        this.clearKeepAliveTimer();
        this.keepAliveTimer = setInterval(() => {
            if (this.stopped || this.socket !== socket || socket.readyState !== 1) return;
            try {
                socket.send(JSON.stringify({ ping: 1 }));
            } catch {
                this.scheduleReconnect('The volatility tick feed stopped responding.', socket);
            }
        }, PUBLIC_FEED_KEEPALIVE_INTERVAL_MS);
    }

    private scheduleReconnect(reason: string, failedSocket?: WebSocketLike): void {
        if (this.stopped || this.reconnectTimer) return;
        if (failedSocket && this.socket !== failedSocket) return;

        this.clearRequestTimer();
        if (this.nextRequestTimer) clearTimeout(this.nextRequestTimer);
        this.nextRequestTimer = null;
        this.clearKeepAliveTimer();
        this.pendingRequestId = null;
        this.subscriptionSymbols.clear();

        const socket = this.socket;
        this.socket = null;
        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.onclose = null;
            try {
                socket.close();
            } catch {
                // The failed socket may already be closed by the browser.
            }
        }

        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.fail(`${reason} Reconnect stopped after ${MAX_RECONNECT_ATTEMPTS} attempts.`);
            return;
        }

        this.reconnectAttempts += 1;
        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
            RECONNECT_MAX_DELAY_MS,
        );
        this.emit(
            'connecting',
            `${reason} Reconnecting in ${Math.ceil(delay / 1000)}s (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}).`,
        );
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.stopped) return;
            this.reset();
            this.connect();
        }, delay);
    }

    stop(): void {
        this.stopped = true;
        if (this.requestTimer) clearTimeout(this.requestTimer);
        if (this.nextRequestTimer) clearTimeout(this.nextRequestTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.requestTimer = null;
        this.nextRequestTimer = null;
        this.reconnectTimer = null;
        this.clearKeepAliveTimer();
        this.reconnectAttempts = 0;
        this.pendingRequestId = null;
        if (this.socket) {
            this.socket.onopen = null;
            this.socket.onmessage = null;
            this.socket.onerror = null;
            this.socket.onclose = null;
            try {
                this.socket.close();
            } catch {
                // The socket may already be closed by the browser.
            }
        }
        this.socket = null;
    }

    private clearKeepAliveTimer(): void {
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
    }

    private reset(): void {
        this.requestIndex = 0;
        this.pendingRequestId = null;
        this.marketStates.clear();
        this.subscriptionSymbols.clear();
        this.rowsBySymbol.clear();
        this.symbols.forEach(symbol => {
            const state = {
                symbol,
                pipSize: 2,
                digits: [],
                prices: [],
                ready: false,
            };
            this.marketStates.set(symbol.code, state);
            this.rowsBySymbol.set(symbol.code, this.rowFor(state));
        });
    }

    private requestNextHistory(): void {
        if (this.stopped || !this.socket || this.socket.readyState !== 1) return;
        if (this.requestIndex >= this.symbols.length) {
            this.emit('scanning', 'Market histories loaded; monitoring fresh ticks.');
            return;
        }

        const symbol = this.symbols[this.requestIndex];
        const reqId = this.requestIndex + 1;
        this.pendingRequestId = reqId;
        try {
            this.socket.send(
                JSON.stringify({
                    ticks_history: symbol.code,
                    adjust_start_time: 1,
                    count: HISTORY_COUNT,
                    end: 'latest',
                    style: 'ticks',
                    subscribe: 1,
                    req_id: reqId,
                }),
            );
        } catch {
            this.completeMarketFailure(reqId, 'Could not request tick history.');
            return;
        }

        this.requestTimer = setTimeout(() => {
            if (this.pendingRequestId === reqId) {
                this.completeMarketFailure(reqId, 'Tick-history request timed out.');
            }
        }, HISTORY_REQUEST_TIMEOUT_MS);
    }

    private handleMessage(data: unknown): void {
        if (this.stopped) return;
        let message: any;
        try {
            message = JSON.parse(typeof data === 'string' ? data : String(data));
        } catch {
            return;
        }

        const reqId = Number(message?.req_id);
        if (message?.error && reqId && reqId === this.pendingRequestId) {
            const reason = String(message.error.message ?? message.error.code ?? 'Market history unavailable.');
            this.completeMarketFailure(reqId, reason);
            return;
        }

        if (message?.msg_type === 'history' && reqId && reqId === this.pendingRequestId) {
            this.completeMarketHistory(reqId, message);
            return;
        }

        if (message?.msg_type === 'tick') this.handleTick(message);
    }

    private completeMarketHistory(reqId: number, message: any): void {
        const symbol = this.symbols[reqId - 1];
        if (!symbol || this.pendingRequestId !== reqId) return;
        this.clearRequestTimer();

        const state = this.marketStates.get(symbol.code);
        const prices = message?.history?.prices;
        const pipSize = Number(message?.pip_size ?? message?.history?.pip_size);
        if (!state || !Array.isArray(prices) || !Number.isInteger(pipSize) || pipSize < 0 || pipSize > 10) {
            state && (state.unavailableReason = 'History response did not include valid prices and precision.');
            this.finishMarketRequest();
            return;
        }

        state.pipSize = pipSize;
        const validTicks = prices
            .map((price: unknown) => {
                const quote = Number(price);
                const digit = lastDigitFromQuote(price, pipSize);
                return Number.isFinite(quote) && digit !== null ? { quote, digit } : null;
            })
            .filter((tick: { quote: number; digit: number } | null): tick is { quote: number; digit: number } => tick !== null)
            .slice(-MAX_DIGITS);
        state.digits = validTicks.map(tick => tick.digit);
        state.prices = validTicks.map(tick => tick.quote);
        state.ready = state.digits.length >= 100;
        if (!state.ready) {
            state.unavailableReason = `Only ${state.digits.length} valid tick digits were returned.`;
        }

        const subscriptionId = String(message?.subscription?.id ?? '');
        if (subscriptionId) this.subscriptionSymbols.set(subscriptionId, symbol.code);
        this.refreshRow(state);
        this.finishMarketRequest();
    }

    private completeMarketFailure(reqId: number, reason: string): void {
        const symbol = this.symbols[reqId - 1];
        if (!symbol || this.pendingRequestId !== reqId) return;
        this.clearRequestTimer();
        const state = this.marketStates.get(symbol.code);
        if (state) state.unavailableReason = reason;
        if (state) this.refreshRow(state);
        this.finishMarketRequest();
    }

    private finishMarketRequest(): void {
        this.pendingRequestId = null;
        this.requestIndex += 1;
        this.emit('scanning', `Loaded ${this.completedMarkets()} of ${this.symbols.length} markets.`);
        if (this.requestIndex >= this.symbols.length) {
            this.reconnectAttempts = 0;
            this.emit('scanning', 'Market histories loaded; monitoring fresh ticks.');
            return;
        }
        this.nextRequestTimer = setTimeout(() => this.requestNextHistory(), NEXT_SYMBOL_DELAY_MS);
    }

    private handleTick(message: any): void {
        const subscriptionId = String(message?.subscription?.id ?? '');
        const symbolCode = this.subscriptionSymbols.get(subscriptionId);
        if (!symbolCode) return;

        const state = this.marketStates.get(symbolCode);
        const quote = message?.tick?.quote;
        const pip = Number(message?.tick?.pip_size ?? state?.pipSize);
        if (!state || !Number.isInteger(pip)) return;
        const digit = lastDigitFromQuote(quote, pip);
        if (digit === null) return;
        state.pipSize = pip;
        state.digits = [...state.digits, digit].slice(-MAX_DIGITS);
        state.prices = [...state.prices, Number(quote)].slice(-MAX_DIGITS);
        this.refreshRow(state);
        this.emit('scanning', 'Monitoring live volatility ticks.');
    }

    private clearRequestTimer(): void {
        if (this.requestTimer) clearTimeout(this.requestTimer);
        this.requestTimer = null;
    }

    private completedMarkets(): number {
        return [...this.marketStates.values()].filter(state => state.ready || state.unavailableReason).length;
    }

    private snapshot(status: BinaryMatrixScanSnapshot['status'], message: string): BinaryMatrixScanSnapshot {
        const rows = this.symbols
            .map(symbol => this.rowsBySymbol.get(symbol.code))
            .filter((row): row is BinaryMatrixMarketScanRow => Boolean(row));
        return {
            status,
            completedMarkets: this.completedMarkets(),
            totalMarkets: this.symbols.length,
            selectedSymbol: null,
            selectedContract: null,
            rows,
            updatedAt: Date.now(),
            message,
        };
    }

    private refreshRow(state: MarketState): void {
        this.rowsBySymbol.set(state.symbol.code, this.rowFor(state));
    }

    private rowFor(state: MarketState): BinaryMatrixMarketScanRow {
        if (state.unavailableReason) {
            return {
                symbol: state.symbol.code,
                label: state.symbol.label,
                status: 'unavailable',
                ruleTriggered: false,
                currentCondition: null,
                currentDigits: state.digits.slice(-4),
                macdHistogram: null,
                rsi: null,
                indicatorState: 'unavailable',
                digitRates: calculateDigitRates(state.digits),
                trainingSampleCount: 0,
                trainingWins: 0,
                sampleCount: 0,
                validationWins: 0,
                validationWinRate: null,
                lowerConfidenceBound: null,
                breakEvenWinRate: null,
                score: null,
                reason: state.unavailableReason,
            };
        }

        if (!state.ready) {
            return {
                symbol: state.symbol.code,
                label: state.symbol.label,
                status: 'scanning',
                ruleTriggered: false,
                currentCondition: null,
                currentDigits: state.digits.slice(-4),
                macdHistogram: null,
                rsi: null,
                indicatorState: 'unavailable',
                digitRates: calculateDigitRates(state.digits),
                trainingSampleCount: 0,
                trainingWins: 0,
                sampleCount: 0,
                validationWins: 0,
                validationWinRate: null,
                lowerConfidenceBound: null,
                breakEvenWinRate: null,
                score: null,
                reason: 'Waiting for market history.',
            };
        }

        const triggeredEvidence = analyzeBinaryMatrixHistory(state.digits, state.prices);
        const evidenceByCondition = BINARY_MATRIX_CONDITION_IDS
            .map(condition => analyzeBinaryMatrixHistory(state.digits, state.prices, condition))
            .filter((evidence): evidence is BinaryMatrixHistoricalEvidence & { decision: BinaryMatrixDecision } =>
                Boolean(evidence.decision),
            );
        const qualifiedEvidence = evidenceByCondition
            .filter(evidence =>
                evidence.sampleCount >= MIN_VALIDATION_SAMPLES &&
                evidence.lowerConfidenceBound !== null &&
                evidence.lowerConfidenceBound > 0.5 &&
                indicatorsConfirmDecision(evidence.decision, evidence.indicators),
            )
            .sort((left, right) => {
                const scoreDifference = (right.score ?? -Infinity) - (left.score ?? -Infinity);
                if (scoreDifference !== 0) return scoreDifference;
                const sampleDifference = right.sampleCount - left.sampleCount;
                if (sampleDifference !== 0) return sampleDifference;
                return BINARY_MATRIX_CONDITION_IDS.indexOf(left.decision.condition as BinaryMatrixCondition) -
                    BINARY_MATRIX_CONDITION_IDS.indexOf(right.decision.condition as BinaryMatrixCondition);
            });
        const evidence = qualifiedEvidence[0] ?? triggeredEvidence;
        if (!evidence.decision) {
            return {
                symbol: state.symbol.code,
                label: state.symbol.label,
                status: 'no-signal',
                ruleTriggered: false,
                currentCondition: null,
                currentDigits: evidence.currentDigits,
                macdHistogram: evidence.indicators.histogram,
                rsi: evidence.indicators.rsi,
                indicatorState: evidence.indicators.state,
                digitRates: calculateDigitRates(state.digits),
                trainingSampleCount: 0,
                trainingWins: 0,
                sampleCount: 0,
                validationWins: 0,
                validationWinRate: null,
                lowerConfidenceBound: null,
                breakEvenWinRate: null,
                score: null,
                reason: 'The latest digits do not match a Binary Matrix rule.',
            };
        }

        const historicalQualified =
            evidence.sampleCount >= MIN_VALIDATION_SAMPLES &&
            evidence.lowerConfidenceBound !== null &&
            evidence.lowerConfidenceBound > 0.5;
        const currentIndicatorsConfirmed = indicatorsConfirmDecision(evidence.decision, evidence.indicators);
        const qualified = historicalQualified && currentIndicatorsConfirmed;
        const ruleTriggered = Boolean(analyzeBinaryMatrixHistory(state.digits, state.prices).decision?.condition ===
            evidence.decision.condition);
        return {
            symbol: state.symbol.code,
            label: state.symbol.label,
            status: qualified
                ? 'candidate'
                : historicalQualified && !currentIndicatorsConfirmed
                  ? 'indicator-mismatch'
                  : 'insufficient-data',
            ruleTriggered,
            currentCondition: evidence.decision.condition ?? null,
            currentDigits: evidence.currentDigits,
            macdHistogram: evidence.indicators.histogram,
            rsi: evidence.indicators.rsi,
            indicatorState: evidence.indicators.state,
            digitRates: calculateDigitRates(state.digits),
            trainingSampleCount: evidence.trainingSampleCount,
            trainingWins: evidence.trainingWins,
            sampleCount: evidence.sampleCount,
            validationWins: evidence.wins,
            validationWinRate: evidence.winRate,
            lowerConfidenceBound: evidence.lowerConfidenceBound,
            breakEvenWinRate: null,
            score: evidence.score,
            reason: qualified
                ? ruleTriggered
                    ? `Historical holdout clears the 50% baseline; MACD and RSI ${this.indicatorLabel(evidence.decision)}; live payout still needs checking.`
                    : `Historical evidence and indicators qualify ${evidence.decision.label}; waiting for its configured Last-X digit pattern.`
                : historicalQualified && !currentIndicatorsConfirmed
                  ? `${ruleTriggered ? 'Rule triggered' : 'Signal is waiting'}; current MACD/RSI are ${evidence.indicators.state}, but ${this.indicatorLabel(evidence.decision)}.`
                : evidence.trainingSampleCount < MIN_TRAINING_SAMPLES
                  ? `${ruleTriggered ? 'Rule triggered' : 'No Last-X trigger yet'}, but only ${evidence.trainingSampleCount} training examples; at least ${MIN_TRAINING_SAMPLES} are required.`
                  : evidence.sampleCount < MIN_VALIDATION_SAMPLES
                    ? `${ruleTriggered ? 'Rule triggered' : 'No Last-X trigger yet'}, but only ${evidence.sampleCount} holdout examples; at least ${MIN_VALIDATION_SAMPLES} are required.`
                    : evidence.trainingWinRate === null || evidence.trainingWinRate <= 0.5
                      ? `${ruleTriggered ? 'Rule triggered' : 'No Last-X trigger yet'}, but the training win rate does not clear 50%.`
                      : `${ruleTriggered ? 'Rule triggered' : 'No Last-X trigger yet'}, but the holdout confidence bound does not clear 50%.`,
        };
    }

    private indicatorLabel(decision: BinaryMatrixDecision): string {
        if (decision.contractType === 'DIGITOVER') return 'confirm bullish direction for Over 4';
        if (decision.contractType === 'DIGITUNDER') return 'confirm bearish direction for Under 5';
        return 'are not required for Even/Odd';
    }

    private emit(status: BinaryMatrixScanSnapshot['status'], message: string): void {
        this.onUpdate(this.snapshot(status, message));
    }

    private fail(message: string): void {
        if (this.stopped) return;
        this.onError(message);
        this.emit('error', message);
        this.stop();
    }
}

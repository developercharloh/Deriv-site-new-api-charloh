import { getPublicWsUrl } from '@/external/deriv-core/config/urls';
import { DERIV_VOLATILITIES, type DerivVolatility } from './deriv-volatilities';
import { evaluateBinaryMatrix } from './binary-matrix-strategy';
import type { BinaryMatrixDecision } from './binary-matrix-strategy';

export type BinaryMatrixMarketRowStatus =
    | 'scanning'
    | 'candidate'
    | 'qualified'
    | 'momentum-mismatch'
    | 'no-signal'
    | 'insufficient-data'
    | 'unavailable';

export type BinaryMatrixMomentumState = 'rising' | 'falling' | 'neutral' | 'unavailable';

export interface BinaryMatrixMarketScanRow {
    symbol: string;
    label: string;
    status: BinaryMatrixMarketRowStatus;
    ruleTriggered: boolean;
    currentCondition: string | null;
    currentDigits: number[];
    momentumRoc: number | null;
    momentumState: BinaryMatrixMomentumState;
    recentPrices: number[];
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
export const DEFAULT_BINARY_MATRIX_ROC_PERIOD = 5;
const HISTORY_REQUEST_TIMEOUT_MS = 8000;
const NEXT_SYMBOL_DELAY_MS = 250;
const MAX_DIGITS = 5000;

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

const calculateRateOfChangeAt = (
    prices: readonly number[],
    currentIndex: number,
    period: number,
): number | null => {
    if (
        !Number.isInteger(period) ||
        period < 1 ||
        !Number.isInteger(currentIndex) ||
        currentIndex < period ||
        currentIndex >= prices.length
    ) return null;
    const current = Number(prices[currentIndex]);
    const previous = Number(prices[currentIndex - period]);
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
};

export function calculateRateOfChange(prices: readonly number[], period = DEFAULT_BINARY_MATRIX_ROC_PERIOD): number | null {
    return calculateRateOfChangeAt(prices, prices.length - 1, period);
}

export function getMomentumState(roc: number | null): BinaryMatrixMomentumState {
    if (roc === null || !Number.isFinite(roc)) return 'unavailable';
    if (roc > 0) return 'rising';
    if (roc < 0) return 'falling';
    return 'neutral';
}

export function momentumConfirmsDecision(decision: BinaryMatrixDecision, roc: number | null): boolean {
    if (decision.contractType === 'DIGITOVER') return roc !== null && roc > 0;
    if (decision.contractType === 'DIGITUNDER') return roc !== null && roc < 0;
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
export function analyzeBinaryMatrixHistory(
    digits: readonly number[],
    prices: readonly number[] = [],
    momentumPeriod = DEFAULT_BINARY_MATRIX_ROC_PERIOD,
): BinaryMatrixHistoricalEvidence {
    const normalized = digits.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const decision = evaluateBinaryMatrix(normalized.slice(-4));
    const counts = new Map<string, RuleCounts>();
    const lastCountedAt = new Map<string, number>();
    const splitAt = Math.floor(normalized.length * 0.6);

    for (let resultIndex = 4; resultIndex < normalized.length; resultIndex += 1) {
        const priorWindow = normalized.slice(resultIndex - 4, resultIndex);
        const historicalDecision = evaluateBinaryMatrix(priorWindow);
        if (!historicalDecision?.condition) continue;
        if (
            historicalDecision.contractType === 'DIGITOVER' ||
            historicalDecision.contractType === 'DIGITUNDER'
        ) {
            const historicalRoc = calculateRateOfChangeAt(
                prices,
                resultIndex - 1,
                momentumPeriod,
            );
            if (!momentumConfirmsDecision(historicalDecision, historicalRoc)) continue;
        }
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

    if (!decision?.condition) {
        return {
            decision: null,
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

    const evidence = counts.get(decision.condition);
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
}

export class BinaryMatrixMarketScanner {
    private socket: WebSocketLike | null = null;
    private requestIndex = 0;
    private pendingRequestId: number | null = null;
    private requestTimer: ReturnType<typeof setTimeout> | null = null;
    private nextRequestTimer: ReturnType<typeof setTimeout> | null = null;
    private stopped = true;
    private socketFactory: SocketFactory;
    private symbols: DerivVolatility[];
    private readonly momentumPeriod: number;
    private readonly marketStates = new Map<string, MarketState>();
    private readonly subscriptionSymbols = new Map<string, string>();
    private readonly rowsBySymbol = new Map<string, BinaryMatrixMarketScanRow>();
    private onUpdate: (snapshot: BinaryMatrixScanSnapshot) => void = () => {};
    private onError: (message: string) => void = () => {};

    constructor(options: { socketFactory?: SocketFactory; symbols?: DerivVolatility[]; momentumPeriod?: number } = {}) {
        this.socketFactory = options.socketFactory ?? defaultSocketFactory;
        this.symbols = options.symbols ?? DERIV_VOLATILITIES;
        this.momentumPeriod = Number.isInteger(options.momentumPeriod) && options.momentumPeriod! > 0
            ? options.momentumPeriod!
            : DEFAULT_BINARY_MATRIX_ROC_PERIOD;
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

        try {
            this.socket = this.socketFactory(getPublicWsUrl());
        } catch (error) {
            this.fail(error instanceof Error ? error.message : 'Could not connect to the volatility tick feed.');
            return;
        }

        this.socket.onopen = () => {
            if (this.stopped) return;
            this.emit('scanning', 'Loading recent tick history for each volatility market.');
            this.requestNextHistory();
        };
        this.socket.onmessage = event => this.handleMessage(event.data);
        this.socket.onerror = () => this.fail('The volatility tick feed reported a connection error.');
        this.socket.onclose = () => {
            if (!this.stopped) this.fail('The volatility tick feed disconnected.');
        };
    }

    stop(): void {
        this.stopped = true;
        if (this.requestTimer) clearTimeout(this.requestTimer);
        if (this.nextRequestTimer) clearTimeout(this.nextRequestTimer);
        this.requestTimer = null;
        this.nextRequestTimer = null;
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
                momentumRoc: calculateRateOfChange(state.prices, this.momentumPeriod),
                momentumState: getMomentumState(calculateRateOfChange(state.prices, this.momentumPeriod)),
                recentPrices: state.prices.slice(-(this.momentumPeriod + 1)),
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
                momentumRoc: calculateRateOfChange(state.prices, this.momentumPeriod),
                momentumState: getMomentumState(calculateRateOfChange(state.prices, this.momentumPeriod)),
                recentPrices: state.prices.slice(-(this.momentumPeriod + 1)),
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

        const currentRoc = calculateRateOfChange(state.prices, this.momentumPeriod);
        const evidence = analyzeBinaryMatrixHistory(state.digits, state.prices, this.momentumPeriod);
        if (!evidence.decision) {
            return {
                symbol: state.symbol.code,
                label: state.symbol.label,
                status: 'no-signal',
                ruleTriggered: false,
                currentCondition: null,
                currentDigits: evidence.currentDigits,
                momentumRoc: currentRoc,
                momentumState: getMomentumState(currentRoc),
                recentPrices: state.prices.slice(-(this.momentumPeriod + 1)),
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
        const currentMomentumConfirmed = momentumConfirmsDecision(evidence.decision, currentRoc);
        const qualified = historicalQualified && currentMomentumConfirmed;
        return {
            symbol: state.symbol.code,
            label: state.symbol.label,
            status: qualified
                ? 'candidate'
                : historicalQualified && !currentMomentumConfirmed
                  ? 'momentum-mismatch'
                  : 'insufficient-data',
            ruleTriggered: true,
            currentCondition: evidence.decision.condition ?? null,
            currentDigits: evidence.currentDigits,
            momentumRoc: currentRoc,
            momentumState: getMomentumState(currentRoc),
            recentPrices: state.prices.slice(-(this.momentumPeriod + 1)),
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
                ? `Historical holdout clears the 50% baseline; ROC ${this.momentumLabel(evidence.decision)}; live payout still needs checking.`
                : historicalQualified && !currentMomentumConfirmed
                  ? `Rule triggered, but current ROC is ${getMomentumState(currentRoc)}; ${this.momentumLabel(evidence.decision)}.`
                : evidence.trainingSampleCount < MIN_TRAINING_SAMPLES
                  ? `Rule triggered, but only ${evidence.trainingSampleCount} training examples; at least ${MIN_TRAINING_SAMPLES} are required.`
                  : evidence.sampleCount < MIN_VALIDATION_SAMPLES
                    ? `Rule triggered, but only ${evidence.sampleCount} holdout examples; at least ${MIN_VALIDATION_SAMPLES} are required.`
                    : evidence.trainingWinRate === null || evidence.trainingWinRate <= 0.5
                      ? 'Rule triggered, but the training win rate does not clear 50%.'
                      : 'Rule triggered, but the holdout confidence bound does not clear 50%.',
        };
    }

    private momentumLabel(decision: BinaryMatrixDecision): string {
        if (decision.contractType === 'DIGITOVER') return 'confirms rising momentum';
        if (decision.contractType === 'DIGITUNDER') return 'confirms falling momentum';
        return 'does not direction-filter Even/Odd';
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

import { getPublicWsUrl } from '@/external/deriv-core/config/urls';
import { DERIV_VOLATILITIES, type DerivVolatility } from './deriv-volatilities';
import { evaluateBinaryMatrix } from './binary-matrix-strategy';
import type { BinaryMatrixDecision } from './binary-matrix-strategy';

export type BinaryMatrixMarketRowStatus =
    | 'scanning'
    | 'candidate'
    | 'qualified'
    | 'no-signal'
    | 'insufficient-data'
    | 'unavailable';

export interface BinaryMatrixMarketScanRow {
    symbol: string;
    label: string;
    status: BinaryMatrixMarketRowStatus;
    currentCondition: string | null;
    currentDigits: number[];
    digitRates: number[];
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
    sampleCount: number;
    wins: number;
    winRate: number | null;
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
export function analyzeBinaryMatrixHistory(digits: readonly number[]): BinaryMatrixHistoricalEvidence {
    const normalized = digits.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const decision = evaluateBinaryMatrix(normalized.slice(-4));
    const counts = new Map<string, RuleCounts>();
    const lastCountedAt = new Map<string, number>();
    const splitAt = Math.floor(normalized.length * 0.6);

    for (let resultIndex = 4; resultIndex < normalized.length; resultIndex += 1) {
        const priorWindow = normalized.slice(resultIndex - 4, resultIndex);
        const historicalDecision = evaluateBinaryMatrix(priorWindow);
        if (!historicalDecision?.condition) continue;
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
            sampleCount: 0,
            wins: 0,
            winRate: null,
            lowerConfidenceBound: null,
            score: null,
        };
    }

    const evidence = counts.get(decision.condition);
    const sampleCount = evidence?.validationTotal ?? 0;
    const wins = evidence?.validationWins ?? 0;
    const winRate = sampleCount > 0 ? wins / sampleCount : null;
    const lowerConfidenceBound =
        evidence && evidence.trainingTotal >= MIN_TRAINING_SAMPLES && sampleCount >= MIN_VALIDATION_SAMPLES
            ? wilsonLowerBound(wins, sampleCount)
            : null;
    const trainingWinRate =
        evidence && evidence.trainingTotal > 0 ? evidence.trainingWins / evidence.trainingTotal : null;
    const clearsTrainingCheck = trainingWinRate !== null && trainingWinRate > 0.5;
    const score =
        lowerConfidenceBound !== null && clearsTrainingCheck
            ? lowerConfidenceBound - 0.5
            : null;

    return {
        decision,
        currentDigits: normalized.slice(-4),
        sampleCount,
        wins,
        winRate,
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
        state.digits = prices
            .map((price: unknown) => lastDigitFromQuote(price, pipSize))
            .filter((digit: number | null): digit is number => digit !== null)
            .slice(-MAX_DIGITS);
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
                currentCondition: null,
                currentDigits: state.digits.slice(-4),
                digitRates: calculateDigitRates(state.digits),
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
                currentCondition: null,
                currentDigits: state.digits.slice(-4),
                digitRates: calculateDigitRates(state.digits),
                sampleCount: 0,
                validationWins: 0,
                validationWinRate: null,
                lowerConfidenceBound: null,
                breakEvenWinRate: null,
                score: null,
                reason: 'Waiting for market history.',
            };
        }

        const evidence = analyzeBinaryMatrixHistory(state.digits);
        if (!evidence.decision) {
            return {
                symbol: state.symbol.code,
                label: state.symbol.label,
                status: 'no-signal',
                currentCondition: null,
                currentDigits: evidence.currentDigits,
                digitRates: calculateDigitRates(state.digits),
                sampleCount: 0,
                validationWins: 0,
                validationWinRate: null,
                lowerConfidenceBound: null,
                breakEvenWinRate: null,
                score: null,
                reason: 'The latest digits do not match a Binary Matrix rule.',
            };
        }

        const qualified =
            evidence.sampleCount >= MIN_VALIDATION_SAMPLES &&
            evidence.lowerConfidenceBound !== null &&
            evidence.lowerConfidenceBound > 0.5;
        return {
            symbol: state.symbol.code,
            label: state.symbol.label,
            status: qualified ? 'candidate' : 'insufficient-data',
            currentCondition: evidence.decision.condition ?? null,
            currentDigits: evidence.currentDigits,
            digitRates: calculateDigitRates(state.digits),
            sampleCount: evidence.sampleCount,
            validationWins: evidence.wins,
            validationWinRate: evidence.winRate,
            lowerConfidenceBound: evidence.lowerConfidenceBound,
            breakEvenWinRate: null,
            score: evidence.score,
            reason: qualified
                ? 'Historical holdout clears the 50% baseline; broker break-even still needs checking.'
                : evidence.sampleCount < MIN_VALIDATION_SAMPLES
                  ? 'Not enough matching out-of-sample trades to evaluate this rule.'
                  : 'The out-of-sample confidence bound does not clear the 50% baseline.',
        };
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

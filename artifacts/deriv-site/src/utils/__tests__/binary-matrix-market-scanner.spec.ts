import {
    calculateDigitRates,
    calculateBinaryMatrixIndicators,
    analyzeBinaryMatrixHistory,
    BinaryMatrixMarketScanner,
    candleColorConfirmsDecision,
    indicatorsConfirmDecision,
    rankBinaryMatrixCandidates,
    wilsonLowerBound,
} from '../binary-matrix-market-scanner';
import { evaluateBinaryMatrix } from '../binary-matrix-strategy';
import type { DerivVolatility } from '../deriv-volatilities';
import type { BinaryMatrixMarketScanRow } from '../binary-matrix-market-scanner';

class FakeSocket {
    readyState = 1;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    sent: Array<Record<string, unknown>> = [];
    closed = false;

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {
        this.closed = true;
        this.readyState = 3;
    }

    disconnect(): void {
        this.readyState = 3;
        this.onclose?.({} as CloseEvent);
    }

    open(): void {
        this.onopen?.({} as Event);
    }

    respond(message: unknown): void {
        this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
    }
}

const testSymbol: DerivVolatility = {
    code: 'R_25',
    label: 'Volatility 25 Index',
    short: 'V25',
    tickEvery: 2,
};

const pricesForDigits = (digits: number[]): string[] =>
    digits.map((digit, index) => `${(index + 1).toString()}.${digit.toString().padStart(2, '0')}`);

const numericPricesForDigits = (digits: number[]): number[] => pricesForDigits(digits).map(Number);

const decreasingPricesForDigits = (digits: number[]): number[] =>
    digits.map((digit, index) => Number(`${(digits.length - index).toString()}.${digit.toString().padStart(2, '0')}`));

const epochsForTicks = (count: number, start = 1_700_000_000): number[] =>
    Array.from({ length: count }, (_, index) => start + index);

describe('Binary Matrix market scanner evidence', () => {
    it('qualifies a historical rule before its configured Last-X pattern is present', () => {
        const digits: number[] = [];
        for (let index = 0; index < 120; index += 1) digits.push(1, 1, 1, 1, 0);
        digits.push(2, 4, 5, 7);

        const evidence = analyzeBinaryMatrixHistory(
            digits,
            numericPricesForDigits(digits),
            'ALL_ODD',
            epochsForTicks(digits.length),
        );

        expect(evidence.decision).toMatchObject({
            condition: 'ALL_ODD',
            contractType: 'DIGITEVEN',
        });
        expect(evidence.currentDigits).toEqual([2, 4, 5, 7]);
        expect(evidence.lowerConfidenceBound).toBeGreaterThan(0.5);
    });

    it('uses a conservative Wilson lower confidence bound', () => {
        expect(wilsonLowerBound(100, 100)).toBeLessThan(1);
        expect(wilsonLowerBound(50, 100)).toBeLessThan(0.5);
        expect(wilsonLowerBound(0, 0)).toBeNull();
    });

    it('reports observed per-digit frequencies from the recent sample', () => {
        const rates = calculateDigitRates([0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(rates).toHaveLength(10);
        expect(rates[0]).toBeCloseTo(2 / 11);
        expect(rates[9]).toBeCloseTo(1 / 11);
        expect(calculateDigitRates([])).toEqual([]);
    });

    it('uses only MACD direction for Over/Under and leaves Even/Odd independent', () => {
        const rising = calculateBinaryMatrixIndicators(
            Array.from({ length: 120 }, (_, index) => 100 + index + index * index * 0.01),
        );
        const falling = calculateBinaryMatrixIndicators(
            Array.from({ length: 120 }, (_, index) => 300 - index - index * index * 0.01),
        );
        const evenDecision = evaluateBinaryMatrix([1, 3, 5, 7]);
        const overDecision = evaluateBinaryMatrix([4, 1, 2, 3]);
        const underDecision = evaluateBinaryMatrix([9, 6, 7, 8]);

        expect(rising.state).toBe('bullish');
        expect(rising.histogram).toBeGreaterThan(0);
        expect(falling.state).toBe('bearish');
        expect(falling.histogram).toBeLessThan(0);
        expect(calculateBinaryMatrixIndicators([100, 101]).state).toBe('unavailable');
        expect(indicatorsConfirmDecision(overDecision!, rising)).toBe(true);
        expect(indicatorsConfirmDecision(overDecision!, falling)).toBe(false);
        expect(indicatorsConfirmDecision(underDecision!, falling)).toBe(true);
        expect(indicatorsConfirmDecision(underDecision!, rising)).toBe(false);
        expect(indicatorsConfirmDecision(evenDecision!, null)).toBe(true);
    });

    it('confirms EVEN with a green closed candle and ODD with a red closed candle', () => {
        const evenDecision = evaluateBinaryMatrix([1, 3, 5, 7]);
        const oddDecision = evaluateBinaryMatrix([2, 4, 6, 8]);
        const overDecision = evaluateBinaryMatrix([4, 1, 2, 3]);

        expect(candleColorConfirmsDecision(evenDecision!, 'green')).toBe(true);
        expect(candleColorConfirmsDecision(evenDecision!, 'red')).toBe(false);
        expect(candleColorConfirmsDecision(oddDecision!, 'red')).toBe(true);
        expect(candleColorConfirmsDecision(oddDecision!, 'green')).toBe(false);
        expect(candleColorConfirmsDecision(evenDecision!, 'doji')).toBe(false);
        expect(candleColorConfirmsDecision(overDecision!, 'unavailable')).toBe(true);
    });

    it('counts parity history only when the previous closed candle confirms that side', () => {
        const digits: number[] = [];
        for (let index = 0; index < 120; index += 1) digits.push(2, 2, 2, 2, 1);
        digits.push(2, 2, 2, 2);
        const epochs = epochsForTicks(digits.length);
        const falling = analyzeBinaryMatrixHistory(
            digits,
            decreasingPricesForDigits(digits),
            'ALL_EVEN',
            epochs,
        );
        const rising = analyzeBinaryMatrixHistory(
            digits,
            numericPricesForDigits(digits),
            'ALL_EVEN',
            epochs,
        );

        expect(falling.decision?.contractType).toBe('DIGITODD');
        expect(falling.sampleCount).toBeGreaterThan(30);
        expect(falling.winRate).toBe(1);
        expect(rising.sampleCount).toBe(0);
    });

    it('ranks the candidate list weak-to-strong while preserving strongest-first execution order', () => {
        const candidates = [
            { symbol: 'R_50', score: 0.18, sampleCount: 60 },
            { symbol: 'R_25', score: 0.04, sampleCount: 30 },
            { symbol: 'R_75', score: 0.09, sampleCount: 45 },
        ] as BinaryMatrixMarketScanRow[];

        expect(rankBinaryMatrixCandidates(candidates, 'weakest-first').map(row => row.symbol)).toEqual([
            'R_25',
            'R_75',
            'R_50',
        ]);
        expect(rankBinaryMatrixCandidates(candidates, 'strongest-first').map(row => row.symbol)).toEqual([
            'R_50',
            'R_75',
            'R_25',
        ]);
    });

    it('scores directional holdout examples only when MACD agrees with Over or Under', () => {
        const digits: number[] = [];
        for (let index = 0; index < 120; index += 1) digits.push(4, 1, 2, 3, 5);
        digits.push(4, 1, 2, 3);
        const risingPrices = digits.map((_, index) => 100 + index + index * index * 0.001);
        const fallingPrices = digits.map((_, index) => 1000 - index - index * index * 0.001);

        const risingEvidence = analyzeBinaryMatrixHistory(digits, risingPrices);
        const fallingEvidence = analyzeBinaryMatrixHistory(digits, fallingPrices);

        expect(risingEvidence.decision?.contractType).toBe('DIGITOVER');
        expect(risingEvidence.trainingSampleCount).toBeGreaterThan(20);
        expect(risingEvidence.sampleCount).toBeGreaterThan(30);
        expect(risingEvidence.winRate).toBe(1);
        expect(fallingEvidence.decision?.contractType).toBe('DIGITOVER');
        expect(fallingEvidence.trainingSampleCount).toBe(0);
        expect(fallingEvidence.sampleCount).toBe(0);
    });

    it('scores only the decision-specific chronological holdout results', () => {
        const digits: number[] = [];
        for (let index = 0; index < 240; index += 1) digits.push(1, 1, 1, 1, 0);
        digits.push(1, 1, 1, 1);

        const evidence = analyzeBinaryMatrixHistory(
            digits,
            numericPricesForDigits(digits),
            undefined,
            epochsForTicks(digits.length),
        );

        expect(evidence.decision).toMatchObject({
            condition: 'ALL_ODD',
            contractType: 'DIGITEVEN',
            label: 'EVEN',
        });
        expect(evidence.sampleCount).toBeGreaterThan(30);
        expect(evidence.winRate).toBe(1);
        expect(evidence.lowerConfidenceBound).toBeGreaterThan(0.5);
        expect(evidence.score).toBeGreaterThan(0);
    });

    it('does not invent a signal when the latest digits match no rule', () => {
        const evidence = analyzeBinaryMatrixHistory([1, 3, 6, 8, 2]);
        expect(evidence.decision).toBeNull();
        expect(evidence.lowerConfidenceBound).toBeNull();
    });
});

describe('BinaryMatrixMarketScanner websocket lifecycle', () => {
    it('shows a qualified rule as waiting when its Last-X digits have not triggered', () => {
        jest.useFakeTimers();
        const socket = new FakeSocket();
        const scanner = new BinaryMatrixMarketScanner({
            socketFactory: () => socket,
            symbols: [testSymbol],
        });
        const updates: any[] = [];
        scanner.start(snapshot => updates.push(snapshot), jest.fn());
        socket.open();

        const digits: number[] = [];
        for (let index = 0; index < 120; index += 1) digits.push(1, 1, 1, 1, 0);
        digits.push(2, 4, 5, 7);
        socket.respond({
            msg_type: 'history',
            req_id: 1,
            pip_size: 2,
            history: { prices: pricesForDigits(digits), times: epochsForTicks(digits.length) },
            subscription: { id: 'sub-r25' },
        });

        expect(updates[updates.length - 1].rows[0]).toMatchObject({
            status: 'candidate',
            ruleTriggered: false,
            currentCondition: 'ALL_ODD',
            lastClosedCandleColor: 'green',
            candleConfirmed: true,
        });
        expect(updates[updates.length - 1].rows[0].reason).toContain(
            'waiting for its configured Last-X pattern and candle confirmation',
        );

        scanner.stop();
        jest.useRealTimers();
    });

    it('paces history requests and updates live row data from the symbol subscription', () => {
        jest.useFakeTimers();
        const socket = new FakeSocket();
        const scanner = new BinaryMatrixMarketScanner({
            socketFactory: () => socket,
            symbols: [testSymbol],
        });
        const updates: any[] = [];
        scanner.start(snapshot => updates.push(snapshot), jest.fn());
        socket.open();

        expect(socket.sent).toHaveLength(1);
        expect(socket.sent[0]).toMatchObject({
            ticks_history: 'R_25',
            count: 5000,
            subscribe: 1,
            req_id: 1,
        });

        const digits: number[] = [];
        for (let index = 0; index < 120; index += 1) digits.push(1, 1, 1, 1, 0);
        digits.push(1, 1, 1, 1);
        socket.respond({
            msg_type: 'history',
            req_id: 1,
            pip_size: 2,
            history: { prices: pricesForDigits(digits), times: epochsForTicks(digits.length) },
            subscription: { id: 'sub-r25' },
        });

        const completed = updates[updates.length - 1];
        expect(completed.completedMarkets).toBe(1);
        expect(completed.rows[0]).toMatchObject({
            symbol: 'R_25',
            currentCondition: 'ALL_ODD',
            status: 'candidate',
            ruleTriggered: true,
            trainingSampleCount: expect.any(Number),
            lastClosedCandleColor: 'green',
            candleConfirmed: true,
        });
        expect(completed.rows[0].macdHistogram).toEqual(expect.any(Number));
        expect(completed.rows[0]).not.toHaveProperty('rsi');

        socket.respond({
            msg_type: 'tick',
            tick: { quote: 999.04, pip_size: 2, epoch: 1_700_000_700 },
            subscription: { id: 'sub-r25' },
        });
        expect(updates[updates.length - 1].rows[0].currentDigits).toEqual([1, 1, 1, 4]);
        expect(updates[updates.length - 1].rows[0]).toMatchObject({
            currentCondition: 'ALL_ODD',
            ruleTriggered: false,
            status: 'candidate',
        });

        scanner.stop();
        expect(socket.closed).toBe(true);
        jest.useRealTimers();
    });

    it('keeps the public feed warm and restores market history after a disconnect', () => {
        jest.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const scanner = new BinaryMatrixMarketScanner({
            socketFactory: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            symbols: [testSymbol],
        });
        const updates: any[] = [];
        const onError = jest.fn();
        scanner.start(snapshot => updates.push(snapshot), onError);

        sockets[0].open();
        const digits: number[] = [];
        for (let index = 0; index < 120; index += 1) digits.push(1, 1, 1, 1, 0);
        digits.push(1, 1, 1, 1);
        sockets[0].respond({
            msg_type: 'history',
            req_id: 1,
            pip_size: 2,
            history: { prices: pricesForDigits(digits), times: epochsForTicks(digits.length) },
            subscription: { id: 'sub-r25-before-reconnect' },
        });

        jest.advanceTimersByTime(25_000);
        expect(sockets[0].sent).toContainEqual({ ping: 1 });

        sockets[0].disconnect();
        expect(updates[updates.length - 1]).toMatchObject({ status: 'connecting' });
        expect(onError).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1000);

        expect(sockets).toHaveLength(2);
        sockets[1].open();
        expect(sockets[1].sent[0]).toMatchObject({
            ticks_history: 'R_25',
            count: 5000,
            subscribe: 1,
            req_id: 1,
        });
        sockets[1].respond({
            msg_type: 'history',
            req_id: 1,
            pip_size: 2,
            history: { prices: pricesForDigits(digits), times: epochsForTicks(digits.length) },
            subscription: { id: 'sub-r25-after-reconnect' },
        });

        expect(updates[updates.length - 1]).toMatchObject({
            status: 'scanning',
            completedMarkets: 1,
            rows: [{ symbol: 'R_25', status: 'candidate' }],
        });
        sockets[0].respond({
            msg_type: 'tick',
            tick: { quote: 999.04, pip_size: 2 },
            subscription: { id: 'sub-r25-before-reconnect' },
        });
        expect(updates[updates.length - 1].rows[0].currentDigits).toEqual([1, 1, 1, 1]);

        scanner.stop();
        jest.useRealTimers();
    });

    it('cancels pending reconnect attempts when the scanner is stopped', () => {
        jest.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const scanner = new BinaryMatrixMarketScanner({
            socketFactory: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            symbols: [testSymbol],
        });
        const onError = jest.fn();
        scanner.start(jest.fn(), onError);
        sockets[0].disconnect();
        scanner.stop();
        jest.advanceTimersByTime(30_000);

        expect(sockets).toHaveLength(1);
        expect(onError).not.toHaveBeenCalled();
        jest.useRealTimers();
    });

    it('reports an error only after bounded reconnect attempts are exhausted', () => {
        jest.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const scanner = new BinaryMatrixMarketScanner({
            socketFactory: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            symbols: [testSymbol],
        });
        const updates: any[] = [];
        const onError = jest.fn();
        scanner.start(snapshot => updates.push(snapshot), onError);

        for (let attempt = 0; attempt < 5; attempt += 1) {
            sockets[sockets.length - 1].disconnect();
            jest.advanceTimersByTime(10_000);
        }
        expect(sockets).toHaveLength(6);
        sockets[5].disconnect();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(updates.filter(snapshot => snapshot.status === 'error')).toHaveLength(1);
        expect(updates[updates.length - 1].message).toContain('Reconnect stopped after 5 attempts');
        scanner.stop();
        jest.useRealTimers();
    });

    it('marks a market unavailable after a broker history error and continues the scan', () => {
        jest.useFakeTimers();
        const socket = new FakeSocket();
        const secondSymbol: DerivVolatility = {
            code: 'R_50',
            label: 'Volatility 50 Index',
            short: 'V50',
            tickEvery: 2,
        };
        const scanner = new BinaryMatrixMarketScanner({
            socketFactory: () => socket,
            symbols: [testSymbol, secondSymbol],
        });
        const updates: any[] = [];
        scanner.start(snapshot => updates.push(snapshot), jest.fn());
        socket.open();
        socket.respond({ req_id: 1, error: { message: 'Market suspended' } });
        jest.advanceTimersByTime(250);

        expect(socket.sent[1]).toMatchObject({ ticks_history: 'R_50', req_id: 2 });
        socket.respond({ req_id: 2, error: { message: 'Unsupported symbol' } });

        const finalSnapshot = updates[updates.length - 1];
        expect(finalSnapshot.completedMarkets).toBe(2);
        expect(finalSnapshot.rows.map((row: any) => row.status)).toEqual(['unavailable', 'unavailable']);
        expect(finalSnapshot.rows[0].reason).toBe('Market suspended');
        scanner.stop();
        jest.useRealTimers();
    });
});

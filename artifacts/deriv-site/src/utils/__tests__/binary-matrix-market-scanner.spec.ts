import {
    calculateDigitRates,
    analyzeBinaryMatrixHistory,
    BinaryMatrixMarketScanner,
    wilsonLowerBound,
} from '../binary-matrix-market-scanner';
import type { DerivVolatility } from '../deriv-volatilities';

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

describe('Binary Matrix market scanner evidence', () => {
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

    it('scores only the decision-specific chronological holdout results', () => {
        const digits: number[] = [];
        for (let index = 0; index < 240; index += 1) digits.push(1, 1, 1, 1, 0);
        digits.push(1, 1, 1, 1);

        const evidence = analyzeBinaryMatrixHistory(digits);

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
            history: { prices: pricesForDigits(digits) },
            subscription: { id: 'sub-r25' },
        });

        const completed = updates[updates.length - 1];
        expect(completed.completedMarkets).toBe(1);
        expect(completed.rows[0]).toMatchObject({
            symbol: 'R_25',
            currentCondition: 'ALL_ODD',
            status: 'candidate',
        });

        socket.respond({
            msg_type: 'tick',
            tick: { quote: 999.04, pip_size: 2 },
            subscription: { id: 'sub-r25' },
        });
        expect(updates[updates.length - 1].rows[0].currentDigits).toEqual([1, 1, 1, 4]);
        expect(updates[updates.length - 1].rows[0].currentCondition).toBeNull();

        scanner.stop();
        expect(socket.closed).toBe(true);
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

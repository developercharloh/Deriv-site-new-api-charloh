import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './alpha-scan-ai.scss';

const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1';
const SCAN_TIMEOUT_MS = 35_000;
const SHORT_RETURN_WINDOW = 20;

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

type SyntheticSymbol = {
    symbol: string;
    displayName: string;
    market: string;
    submarket: string;
};

type ScanRow = SyntheticSymbol & {
    prices: number[];
    sampleSize: number;
    latestPrice: number;
    shortReturn: number;
    realizedVolatility: number;
    directionalImbalance: number;
    reversalRate: number;
    regime: string;
};

type WebSocketMessage = {
    msg_type?: string;
    req_id?: number;
    error?: { message?: string };
    active_symbols?: Array<Record<string, unknown>>;
    history?: { prices?: Array<number | string> };
    echo_req?: { symbol?: string; active_symbols?: string };
};

const numberFromRecord = (record: Record<string, unknown>, keys: string[]): string =>
    keys.map(key => record[key]).find(value => typeof value === 'string' && value.length > 0) as string || '';

const isSyntheticIndex = (record: Record<string, unknown>): boolean => {
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

    return metadata.includes('synthetic index') || metadata.includes('synthetic indices') || metadata.includes('synthetic_index');
};

const discoverSyntheticSymbols = (records: Array<Record<string, unknown>>): SyntheticSymbol[] => {
    const seen = new Set<string>();

    return records
        .filter(isSyntheticIndex)
        .map(record => {
            const symbol = numberFromRecord(record, ['symbol']);
            if (!symbol || seen.has(symbol)) return null;
            seen.add(symbol);
            return {
                symbol,
                displayName: numberFromRecord(record, ['display_name', 'underlying_symbol', 'symbol']) || symbol,
                market: numberFromRecord(record, ['market_display_name', 'market']) || 'Synthetic Index',
                submarket: numberFromRecord(record, ['submarket_display_name', 'submarket']) || 'Synthetic',
            };
        })
        .filter((item): item is SyntheticSymbol => item !== null);
};

const mean = (values: number[]): number =>
    values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

const calculateMetrics = (prices: number[]): Omit<ScanRow, keyof SyntheticSymbol | 'prices'> => {
    const returns = prices
        .slice(1)
        .map((price, index) => (prices[index] > 0 && price > 0 ? Math.log(price / prices[index]) : 0));
    const averageReturn = mean(returns);
    const variance = mean(returns.map(value => (value - averageReturn) ** 2));
    const positiveMoves = returns.filter(value => value > 0).length;
    const negativeMoves = returns.filter(value => value < 0).length;
    const directionalMoves = positiveMoves + negativeMoves;
    const reversals = returns.slice(1).filter((value, index) => value !== 0 && returns[index] !== 0 && Math.sign(value) !== Math.sign(returns[index])).length;
    const shortBase = prices[Math.max(0, prices.length - SHORT_RETURN_WINDOW - 1)] || prices[0] || 0;
    const shortReturn = shortBase ? ((prices[prices.length - 1] - shortBase) / shortBase) * 100 : 0;
    const directionalImbalance = directionalMoves ? (positiveMoves - negativeMoves) / directionalMoves : 0;
    const reversalRate = returns.length > 1 ? reversals / (returns.length - 1) : 0;

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
        directionalImbalance,
        reversalRate,
        regime,
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
    idle: 'Ready for a descriptive scan',
    discovering: 'Reading public market metadata',
    collecting: 'Collecting historical observations',
    ready: 'Snapshot ready',
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

const AlphaScanAI: React.FC = () => {
    const [sampleSize, setSampleSize] = useState<SampleSize>(600);
    const [status, setStatus] = useState<ScanStatus>('idle');
    const [rows, setRows] = useState<ScanRow[]>([]);
    const [discoveredCount, setDiscoveredCount] = useState(0);
    const [completedCount, setCompletedCount] = useState(0);
    const [failedCount, setFailedCount] = useState(0);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    const socketRef = useRef<WebSocket | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scanIdRef = useRef(0);
    const pendingRef = useRef(new Set<number>());
    const resultRowsRef = useRef<ScanRow[]>([]);
    const failedSymbolsRef = useRef(new Set<string>());

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
        setStatus('discovering');

        const socket = new WebSocket(DERIV_WS_URL);
        socketRef.current = socket;
        const requestMap = new Map<number, SyntheticSymbol>();
        let discoveredSymbols: SyntheticSymbol[] = [];

        const recordFailure = (symbol: string) => {
            failedSymbolsRef.current.add(symbol);
            setFailedCount(failedSymbolsRef.current.size);
        };

        const completeIfDone = () => {
            if (scanIdRef.current !== scanId || pendingRef.current.size > 0) return;
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
            socket.send(JSON.stringify({ active_symbols: 'brief', req_id: scanId }));
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

            if (message.active_symbols) {
                discoveredSymbols = discoverSyntheticSymbols(message.active_symbols);
                setDiscoveredCount(discoveredSymbols.length);
                if (!discoveredSymbols.length) {
                    finishWithCurrentData('empty', 'The public metadata response contained no synthetic index symbols.');
                    closeSocket();
                    return;
                }

                setStatus('collecting');
                discoveredSymbols.forEach((symbol, index) => {
                    const reqId = scanId * 10000 + index + 1;
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
                        const row = { ...symbol, prices, ...calculateMetrics(prices) };
                        resultRowsRef.current = [...resultRowsRef.current, row];
                        setRows(resultRowsRef.current);
                    } else {
                        recordFailure(symbol.symbol);
                    }
                }
                setCompletedCount(discoveredSymbols.length - pendingRef.current.size);
                completeIfDone();
            }
        };

        socket.onerror = () => {
            if (scanIdRef.current !== scanId) return;
            if (resultRowsRef.current.length) {
                finishWithCurrentData('partial-data', 'The connection closed before every requested symbol returned.');
            } else {
                finishWithCurrentData('connection-error', 'The public market feed could not be reached.');
            }
            closeSocket();
        };

        socket.onclose = () => {
            if (scanIdRef.current !== scanId || pendingRef.current.size === 0) return;
            if (resultRowsRef.current.length) {
                finishWithCurrentData('partial-data', 'The connection closed before every requested symbol returned.');
            } else {
                finishWithCurrentData('connection-error', 'The public market feed closed before returning history.');
            }
        };

        timeoutRef.current = setTimeout(() => {
            if (scanIdRef.current !== scanId) return;
            if (resultRowsRef.current.length) {
                finishWithCurrentData('partial-data', 'The scan reached its time limit; rows shown are the data received so far.');
            } else {
                finishWithCurrentData('timeout', 'No usable history arrived within the time limit.');
            }
            closeSocket();
        }, SCAN_TIMEOUT_MS);
    }, [closeSocket, finishWithCurrentData, sampleSize]);

    useEffect(() => () => closeSocket(), [closeSocket]);

    const isBusy = status === 'discovering' || status === 'collecting';
    const coverage = discoveredCount ? Math.round((rows.length / discoveredCount) * 100) : 0;
    const averageVolatility = rows.length ? mean(rows.map(row => row.realizedVolatility)) : 0;
    const averageImbalance = rows.length ? mean(rows.map(row => row.directionalImbalance)) : 0;

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
                    <h2>Build a descriptive snapshot</h2>
                    <p>Discover eligible symbols from public metadata, then request tick history for each one.</p>
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
                            <option value='300'>300 observations</option>
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
                        <span>{isBusy ? 'Scanning public feed' : status === 'idle' ? 'Run descriptive scan' : 'Run new scan'}</span>
                        <span className='alpha-scan__button-arrow' aria-hidden='true'>↗</span>
                    </button>
                </div>
                <p className='alpha-scan__control-note'>
                    Uses <code>active_symbols</code> and <code>ticks_history</code> over a public WebSocket. No account session is requested.
                </p>
            </section>

            <section className='alpha-scan__status-bar' aria-live='polite' data-testid='status-scan'>
                <StatusPill status={status} />
                <span className='alpha-scan__status-message'>{errorMessage || (isBusy ? `${completedCount} of ${discoveredCount || '…'} symbols processed` : 'Nothing has been requested yet.')}</span>
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
                        <p>There is no trained model behind this surface yet. This first phase makes the raw descriptive layer inspectable before any future validation work.</p>
                        <div className='alpha-scan__principles'>
                            <div><strong>01</strong><span>Transparent metrics, not probabilities</span></div>
                            <div><strong>02</strong><span>Public data, timestamped at capture</span></div>
                            <div><strong>03</strong><span>SKIP until out-of-sample validation exists</span></div>
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
                                <span className='alpha-scan__section-label'>Snapshot / descriptive only</span>
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
                            <div className='alpha-scan__summary-cell alpha-scan__summary-cell--decision'>
                                <span>Decision gate</span>
                                <strong data-testid='text-decision'>SKIP</strong>
                                <em>validation pending</em>
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
                                            <td data-label='Directional imbalance' className={row.directionalImbalance >= 0 ? 'alpha-scan__positive' : 'alpha-scan__negative'}>{formatRatio(row.directionalImbalance, true)}</td>
                                            <td data-label='Reversal rate'>{formatPercent(row.reversalRate)}</td>
                                            <td data-label='Descriptive regime'><span className='alpha-scan__regime'>{row.regime}</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section className='alpha-scan__interpretation'>
                        <div className='alpha-scan__interpretation-main'>
                            <span className='alpha-scan__section-label'>Read the evidence</span>
                            <h2>Descriptive metrics are not validated signals.</h2>
                            <p>Directional imbalance compares up and down moves. Reversal rate counts sign changes between adjacent returns. Realized volatility is the standard deviation of log returns for this sample. These are descriptive snapshots, not ML probabilities or forecasts.</p>
                        </div>
                        <div className='alpha-scan__interpretation-side'>
                            <div><span>Mean imbalance</span><strong>{formatRatio(averageImbalance, true)}</strong></div>
                            <div><span>Decision status</span><strong>SKIP — validation pending</strong></div>
                        </div>
                    </section>
                </>
            )}

            <footer className='alpha-scan__disclosure'>
                <div className='alpha-scan__disclosure-mark'>i</div>
                <div>
                    <strong>Paper-only research surface</strong>
                    <p>No authenticated trading, no live execution, no payout or contract values, and no persistence of paper trades. The decision remains <b>SKIP — validation pending</b> until out-of-sample training and walk-forward validation are implemented.</p>
                </div>
            </footer>
        </main>
    );
};

export default AlphaScanAI;
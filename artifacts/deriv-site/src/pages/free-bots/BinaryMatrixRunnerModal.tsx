import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BotConfig } from './types';
import {
    BinaryMatrixEngine,
    type BinaryMatrixConfig,
    type BinaryMatrixMarketScanRow,
    type BinaryMatrixScanSnapshot,
    type BinaryMatrixStats,
    type BinaryMatrixStatus,
} from '@/utils/binary-matrix-engine';
import { rankBinaryMatrixCandidates } from '@/utils/binary-matrix-market-scanner';
import type { DTLog } from '@/utils/dtrader-engine';
import { APOLLO_BLOCK_REGISTRY } from '@/utils/apollo-block-registry';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useStore } from '@/hooks/useStore';
import { contract_stages } from '@/constants/contract-stage';

interface Props {
    bot: BotConfig;
    onClose: () => void;
}

interface RunnerSettings {
    stake: string;
    takeProfit: string;
    stopLoss: string;
    martingale: string;
    reanalyzeAfterWins: string;
}

const DEFAULT_SETTINGS: RunnerSettings = {
    stake: '0.5',
    takeProfit: '10',
    stopLoss: '50',
    martingale: '2',
    reanalyzeAfterWins: '3',
};

const STATUS_LABELS: Record<BinaryMatrixStatus, string> = {
    idle: 'IDLE',
    scanning: 'SCANNING',
    buying: 'BUYING',
    waiting: 'WAITING FOR SETTLEMENT',
    stopped: 'STOPPED',
    error: 'ERROR',
};

const INITIAL_SCAN: BinaryMatrixScanSnapshot = {
    status: 'idle',
    completedMarkets: 0,
    totalMarkets: 0,
    selectedSymbol: null,
    selectedContract: null,
    rows: [],
    updatedAt: null,
    message: 'Start the runner to begin evaluating available markets.',
};

const SCAN_STATUS_LABELS: Record<BinaryMatrixScanSnapshot['status'], string> = {
    idle: 'READY',
    connecting: 'CONNECTING',
    scanning: 'SCANNING MARKETS',
    waiting: 'WAITING FOR SETTLEMENT',
    selected: 'MARKET SELECTED',
    error: 'SCAN ERROR',
};

const MARKET_STATUS_LABELS: Record<BinaryMatrixMarketScanRow['status'], string> = {
    scanning: 'Scanning',
    candidate: 'Qualified · awaiting selection',
    qualified: 'Qualified · payout cleared',
    'indicator-mismatch': 'MACD/RSI mismatch',
    'no-signal': 'No signal',
    'insufficient-data': 'Insufficient data',
    unavailable: 'Unavailable',
};

function formatRate(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatScore(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : value.toFixed(3);
}

function formatMacd(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : value.toFixed(6);
}

function formatRsi(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

function getHotColdDigitSets(rates: number[]): { hot: Set<number>; cold: Set<number> } {
    if (rates.length !== 10) return { hot: new Set(), cold: new Set() };
    const ranked = rates
        .map((rate, digit) => ({ digit, rate }))
        .sort((left, right) => right.rate - left.rate || left.digit - right.digit);
    const hot = ranked.slice(0, 3).filter(item => item.rate > 0.1).map(item => item.digit);
    const cold = ranked.slice(-3).filter(item => item.rate < 0.1).map(item => item.digit);
    return { hot: new Set(hot), cold: new Set(cold) };
}

const STATUS_COLORS: Record<BinaryMatrixStatus, string> = {
    idle: '#64748b',
    scanning: '#3b82f6',
    buying: '#f59e0b',
    waiting: '#8b5cf6',
    stopped: '#64748b',
    error: '#ef4444',
};

const LOG_COLORS: Record<DTLog['type'], string> = {
    info: '#60a5fa',
    win: '#34d399',
    loss: '#fb7185',
    error: '#f87171',
    system: '#c4b5fd',
};

function readSettings(): RunnerSettings {
    try {
        const saved = localStorage.getItem('binary_matrix_ai_settings');
        return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
        return DEFAULT_SETTINGS;
    }
}

function numberSetting(value: string, fallback: number, minimum: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

const BinaryMatrixRunnerModal: React.FC<Props> = ({ bot, onClose }) => {
    const { client, run_panel, transactions } = useStore();
    const [settings, setSettings] = useState<RunnerSettings>(readSettings);
    const [status, setStatus] = useState<BinaryMatrixStatus>('idle');
    const [stopPending, setStopPending] = useState(false);
    const [authorized, setAuthorized] = useState(() => Boolean(api_base.is_authorized));
    const [logs, setLogs] = useState<DTLog[]>([]);
    const [stats, setStats] = useState<BinaryMatrixStats>({
        profit: 0,
        wins: 0,
        losses: 0,
        currentStake: 0.5,
        qualifyingWins: 0,
        lastDecision: null,
        openContractId: null,
    });
    const [scan, setScan] = useState<BinaryMatrixScanSnapshot>(INITIAL_SCAN);
    const engineRef = useRef<BinaryMatrixEngine | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);

    const isRunning = status === 'scanning' || status === 'buying' || status === 'waiting';
    const rankedCandidates = rankBinaryMatrixCandidates(
        scan.rows.filter(row => row.status === 'candidate' || row.status === 'qualified'),
        'weakest-first',
    );
    const rankedCandidateSymbols = new Set(rankedCandidates.map(row => row.symbol));
    const rowsForDisplay = [
        ...rankedCandidates,
        ...scan.rows.filter(row => !rankedCandidateSymbols.has(row.symbol)),
    ];
    const candidateRankBySymbol = new Map(rankedCandidates.map((row, index) => [row.symbol, index + 1]));

    useEffect(() => {
        const checkAuth = () => setAuthorized(Boolean(api_base.is_authorized));
        checkAuth();
        const interval = window.setInterval(checkAuth, 1000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => () => {
        engineRef.current?.stop();
        engineRef.current = null;
    }, []);

    const appendLog = useCallback((log: DTLog) => {
        setLogs(previous => [...previous, log].slice(-300));
    }, []);

    const updateSetting = (key: keyof RunnerSettings, value: string) => {
        const next = { ...settings, [key]: value };
        setSettings(next);
        try {
            localStorage.setItem('binary_matrix_ai_settings', JSON.stringify(next));
        } catch {
            // Settings persistence is optional; the running configuration remains local.
        }
    };

    const start = () => {
        if (isRunning) return;
        setStopPending(false);
        const config: BinaryMatrixConfig = {
            symbol: 'R_25',
            currency: client?.currency || 'USD',
            initialStake: numberSetting(settings.stake, 0.5, 0.35),
            takeProfit: numberSetting(settings.takeProfit, 10, 0.01),
            stopLoss: numberSetting(settings.stopLoss, 50, 0.01),
            martingale: numberSetting(settings.martingale, 2, 1),
            reanalyzeAfterWins: Math.max(1, Math.floor(numberSetting(settings.reanalyzeAfterWins, 3, 1))),
            autoMarketScan: true,
        };

        engineRef.current?.stop();
        setLogs([]);
        setScan(INITIAL_SCAN);
        setStats({
            profit: 0,
            wins: 0,
            losses: 0,
            currentStake: config.initialStake,
            qualifyingWins: 0,
            lastDecision: null,
            openContractId: null,
        });

        const engine = new BinaryMatrixEngine(config);
        engine.onLog = appendLog;
        engine.onStatus = nextStatus => {
            setStatus(nextStatus);
            if (nextStatus === 'stopped' || nextStatus === 'idle') {
                setStopPending(false);
                run_panel.unregisterNativeBot();
                if (engineRef.current === engine) engineRef.current = null;
                return;
            }

            const stage = nextStatus === 'buying'
                ? contract_stages.PURCHASE_SENT
                : nextStatus === 'waiting'
                  ? contract_stages.PURCHASE_RECEIVED
                  : nextStatus === 'scanning' || nextStatus === 'error'
                    ? contract_stages.RUNNING
                    : contract_stages.STARTING;
            run_panel.updateNativeBot(stage, nextStatus === 'waiting');
        };
        engine.onStats = setStats;
        engine.onMarketScan = setScan;
        engine.onPosition = position => {
            transactions.onBotContractEvent(
                run_panel.nativePositionToContractInfo(position) as unknown as Parameters<
                    typeof transactions.onBotContractEvent
                >[0]
            );
        };
        engine.onAlert = alert => appendLog({
            seq: Date.now(),
            time: new Date().toTimeString().slice(0, 8),
            message: alert.kind === 'tp'
                ? `Take Profit reached at +$${alert.profit.toFixed(2)}.`
                : `Stop Loss reached at $${alert.profit.toFixed(2)}.`,
            type: alert.kind === 'tp' ? 'win' : 'loss',
        });
        engineRef.current = engine;
        if (!engine.start()) {
            engineRef.current = null;
            return;
        }
                run_panel.registerNativeBot(
                    () => engine.stop(),
                    paused => (paused ? engine.pause() : engine.resume())
                );
    };

    const stop = () => {
        const engine = engineRef.current;
        if (!engine) return;
        setStopPending(true);
        engine.stop();
        run_panel.unregisterNativeBot();
    };

    const close = () => {
        stop();
        const engine = engineRef.current;
        if (engine) {
            engine.onLog = () => {};
            engine.onStatus = () => {};
            engine.onStats = () => {};
            engine.onMarketScan = () => {};
            engine.onTrade = () => {};
            engine.onAlert = () => {};
        }
        onClose();
    };

    return (
        <div className='matrix-overlay' onClick={close} data-testid='binary-matrix-overlay'>
            <div className='matrix-modal' onClick={event => event.stopPropagation()} role='dialog' aria-modal='true' aria-label='Binary Matrix AI runner'>
                <div className='matrix-modal__header' style={{ background: bot.gradient }}>
                    <div>
                        <div className='matrix-modal__title'>{bot.name}</div>
                        <div className='matrix-modal__badge'>ADAPTIVE VOLATILITY SCAN · 1 TICK</div>
                    </div>
                    <button className='matrix-modal__close' onClick={close} aria-label='Stop and close' data-testid='button-close-runner'>×</button>
                </div>

                <div className='matrix-modal__statusbar'>
                    <div className='matrix-modal__status'>
                        <span className='matrix-modal__status-dot' style={{ background: STATUS_COLORS[status] }} />
                        <strong style={{ color: STATUS_COLORS[status] }} data-testid='status-runner'>{STATUS_LABELS[status]}</strong>
                    </div>
                    <div className='matrix-modal__stats'>
                        <span className={stats.profit >= 0 ? 'is-positive' : 'is-negative'}>
                            P/L {stats.profit >= 0 ? '+' : ''}${stats.profit.toFixed(2)}
                        </span>
                        <span className='is-positive'>W {stats.wins}</span>
                        <span className='is-negative'>L {stats.losses}</span>
                    </div>
                </div>

                <div className='matrix-modal__body'>
                    <section className='matrix-modal__scan' aria-labelledby='matrix-scan-title' data-testid='panel-market-scan'>
                        <div className='matrix-modal__scan-head'>
                            <div>
                                <div className='matrix-modal__eyebrow'>Adaptive market selection</div>
                                <h2 id='matrix-scan-title'>Scan evidence</h2>
                                <p>Only statistically qualified markets are eligible. No profitability is implied.</p>
                                <p>Over 4 needs bullish MACD and RSI above 50; Under 5 needs bearish MACD and RSI below 50. Even/Odd stays digit-only.</p>
                            </div>
                            <div className={`matrix-modal__scan-state matrix-modal__scan-state--${scan.status}`} role='status' aria-live='polite' data-testid='status-market-scan'>
                                <span className='matrix-modal__scan-indicator' />
                                {SCAN_STATUS_LABELS[scan.status]}
                            </div>
                        </div>
                        <div className='matrix-modal__scan-summary'>
                            <div><span>Markets reviewed</span><strong data-testid='text-markets-reviewed'>{scan.completedMarkets} / {scan.totalMarkets}</strong></div>
                            <div><span>Last-X matches now</span><strong data-testid='text-triggered-count'>{scan.rows.filter(row => row.ruleTriggered).length}</strong></div>
                            <div><span>Qualified signals</span><strong data-testid='text-qualified-count'>{scan.rows.filter(row => row.status === 'candidate' || row.status === 'qualified').length}</strong></div>
                            <div><span>Selected market</span><strong data-testid='text-selected-market'>{scan.selectedSymbol || 'None'}</strong></div>
                        </div>
                        {rankedCandidates.length > 0 && (
                            <div className='matrix-modal__candidate-order' data-testid='text-candidate-order'>
                                Signal rank: weaker to strongest. Execution stays one at a time, strongest first.
                            </div>
                        )}
                        <div className='matrix-modal__scan-message' data-testid='text-scan-message'>
                            {scan.status === 'selected' && scan.selectedSymbol
                                ? `Selected ${scan.selectedSymbol}${scan.selectedContract ? ` · ${scan.selectedContract}` : ''}`
                                : scan.status === 'waiting' ? 'No new entry while the current contract settles.'
                                  : scan.completedMarkets === scan.totalMarkets && scan.totalMarkets > 0 && !scan.rows.some(row => row.status === 'candidate' || row.status === 'qualified')
                                    ? scan.rows.some(row => row.ruleTriggered)
                                        ? 'A Last-X pattern matched, but no market currently passes every entry gate. Check each market’s reason below.'
                                        : 'No trade — no Binary Matrix rule currently matches the latest digits.'
                                    : scan.message}
                        </div>
                        {scan.updatedAt !== null && (
                            <div className='matrix-modal__scan-updated' data-testid='text-scan-updated'>
                                Updated {new Date(scan.updatedAt).toLocaleTimeString()}
                            </div>
                        )}
                        {scan.rows.length === 0 ? (
                            <div className={`matrix-modal__scan-empty ${scan.status === 'connecting' || scan.status === 'scanning' ? 'is-loading' : ''}`} data-testid='state-scan-empty'>
                                {scan.status === 'connecting' || scan.status === 'scanning' ? (
                                    <><span className='matrix-modal__skeleton' /><span className='matrix-modal__skeleton' /><span className='matrix-modal__skeleton' /></>
                                ) : <><strong>{scan.status === 'error' ? 'Market scan unavailable' : 'No market evidence yet'}</strong><span>{scan.message}</span></>}
                            </div>
                        ) : (
                            <div className='matrix-modal__market-list' role='list' aria-label='Per-market scan evidence'>
                                {rowsForDisplay.map(row => {
                                    const { hot, cold } = getHotColdDigitSets(row.digitRates);
                                    const signalRank = candidateRankBySymbol.get(row.symbol);
                                    const rankLabel = signalRank === undefined
                                        ? null
                                        : rankedCandidates.length === 1
                                            ? 'Only ranked candidate'
                                            : signalRank === 1
                                                ? `Rank ${signalRank}/${rankedCandidates.length} · weakest`
                                                : signalRank === rankedCandidates.length
                                                    ? `Rank ${signalRank}/${rankedCandidates.length} · strongest`
                                                    : `Rank ${signalRank}/${rankedCandidates.length}`;
                                    return (
                                        <article
                                            className={`matrix-modal__market matrix-modal__market--${row.status}${scan.selectedSymbol === row.symbol ? ' is-selected' : ''}`}
                                            key={row.symbol}
                                            role='listitem'
                                            data-testid={`row-market-${row.symbol}`}
                                        >
                                        <div className='matrix-modal__market-top'>
                                            <div className='matrix-modal__market-name'>
                                                <strong>{row.label}</strong><code>{row.symbol}</code>
                                            </div>
                                            <span className={`matrix-modal__market-status matrix-modal__market-status--${row.status}`} data-testid={`status-market-${row.symbol}`}>
                                                {scan.selectedSymbol === row.symbol
                                                    ? row.ruleTriggered
                                                        ? row.status === 'qualified' ? 'Qualified · payout cleared' : 'Locked · payout pending'
                                                        : row.status === 'qualified' ? 'Qualified · waiting for Last X' : 'Locked · waiting for Last X'
                                                    : row.ruleTriggered && row.status === 'insufficient-data'
                                                        ? 'Last-X matched · gates not passed'
                                                        : MARKET_STATUS_LABELS[row.status]}
                                            </span>
                                        </div>
                                        <div className='matrix-modal__market-condition'>
                                            <span>Qualified rule</span><strong>{row.currentCondition || '—'}</strong>
                                        </div>
                                        {rankLabel && (
                                            <div
                                                className='matrix-modal__market-rank'
                                                data-testid={`rank-market-${row.symbol}`}
                                                aria-label={`Signal rank ${signalRank} of ${rankedCandidates.length}, ordered weaker to stronger`}
                                            >
                                                {rankLabel}
                                            </div>
                                        )}
                                        <div className={`matrix-modal__indicators matrix-modal__indicators--${row.indicatorState}`} data-testid={`indicators-${row.symbol}`}>
                                            <span>MACD histogram · RSI(14)</span>
                                            <strong>MACD {formatMacd(row.macdHistogram)} · RSI {formatRsi(row.rsi)} · {row.indicatorState}</strong>
                                        </div>
                                        <div className='matrix-modal__digits' aria-label={`Recent digits for ${row.label}`}>
                                            {row.currentDigits.length ? row.currentDigits.map((digit, index) => (
                                                <span key={`${row.symbol}-${index}`} data-testid={`digit-${row.symbol}-${index}`}>{digit}</span>
                                            )) : <span className='matrix-modal__digits-empty'>No digit stream</span>}
                                        </div>
                                        <div className='matrix-modal__frequency-wrap'>
                                            <div className='matrix-modal__frequency-label'>
                                                <span>Recent digit frequency</span>
                                                <small>Hot/cold are descriptive, not predictive</small>
                                            </div>
                                            {row.digitRates.length === 10 ? (
                                                <div className='matrix-modal__frequency' aria-label={`Observed digit frequencies for ${row.label}`}>
                                                    {row.digitRates.map((rate, digit) => (
                                                        <span
                                                            className={`matrix-modal__frequency-digit${hot.has(digit) ? ' is-hot' : ''}${cold.has(digit) ? ' is-cold' : ''}`}
                                                            key={`${row.symbol}-frequency-${digit}`}
                                                            data-testid={`frequency-${row.symbol}-${digit}`}
                                                            title={`${digit}: ${(rate * 100).toFixed(1)}% of recent ticks`}
                                                        >
                                                            <b>{digit}</b>
                                                            <small>{(rate * 100).toFixed(0)}%</small>
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className='matrix-modal__digits-empty'>Frequency data unavailable</span>
                                            )}
                                        </div>
                                        <div className='matrix-modal__evidence'>
                                            <div><span>Training wins / samples</span><strong>{row.trainingWins} / {row.trainingSampleCount}</strong></div>
                                            <div><span>Holdout wins / samples</span><strong>{row.validationWins} / {row.sampleCount}</strong></div>
                                            <div><span>Validation rate</span><strong>{formatRate(row.validationWinRate)}</strong></div>
                                            <div><span>Lower bound</span><strong>{formatRate(row.lowerConfidenceBound)}</strong></div>
                                            <div><span>Break-even</span><strong>{formatRate(row.breakEvenWinRate)}</strong></div>
                                            <div><span>Score</span><strong>{formatScore(row.score)}</strong></div>
                                        </div>
                                        <div className='matrix-modal__market-reason'>{row.reason}</div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {!authorized && (
                        <div className='matrix-modal__notice matrix-modal__notice--warn'>
                            Log in to a Deriv demo or real account before starting. The runner will not place trades while unauthorised.
                        </div>
                    )}

                    {authorized && (
                        <div className='matrix-modal__notice matrix-modal__notice--ok'>
                            Deriv session detected. Purchases use the authenticated session and Deriv-provided proposals and settlement results.
                        </div>
                    )}

                    <section className='matrix-modal__section'>
                        <div className='matrix-modal__section-title'>Registered strategy blocks</div>
                        <div className='matrix-modal__blocks'>
                            {Object.values(APOLLO_BLOCK_REGISTRY).map(block => (
                                <div className='matrix-modal__block' key={block.type}>
                                    <code>{block.type}</code>
                                    <span>{block.description}</span>
                                </div>
                            ))}
                        </div>
                        <p className='matrix-modal__hint'>
                            These custom blocks preserve the supplied strategy’s condition order and purchase mapping.
                        </p>
                    </section>

                    <section className='matrix-modal__section'>
                        <div className='matrix-modal__section-title'>Trade settings</div>
                        <div className='matrix-modal__fields'>
                            {([
                                ['stake', 'Initial stake ($)', '0.01'],
                                ['takeProfit', 'Take Profit ($)', '0.5'],
                                ['stopLoss', 'Stop Loss ($)', '0.5'],
                                ['martingale', 'Martingale ×', '0.1'],
                                ['reanalyzeAfterWins', 'Re-analyse after wins', '1'],
                            ] as const).map(([key, label, step]) => (
                                <label className='matrix-modal__field' key={key}>
                                    <span>{label}</span>
                                    <input
                                        type='number'
                                        min='0'
                                        step={step}
                                        value={settings[key]}
                                        disabled={isRunning}
                                        onChange={event => updateSetting(key, event.target.value)}
                                        aria-label={label}
                                        data-testid={`input-setting-${key}`}
                                    />
                                </label>
                            ))}
                        </div>
                    </section>

                    <section className='matrix-modal__section matrix-modal__section--summary'>
                        <div><span>Market selection</span><strong>All available volatility markets</strong></div>
                        <div><span>Rules</span><strong>4 odd → Even · 4 even → Odd · 3 low → Over 4 with bullish MACD/RSI · 3 high → Under 5 with bearish MACD/RSI</strong></div>
                        <div><span>Current stake</span><strong>${stats.currentStake.toFixed(2)}</strong></div>
                        {stats.lastDecision && (
                            <div><span>Last decision</span><strong>{stats.lastDecision.label} · {stats.lastDecision.scannedDigits.join(' ')}</strong></div>
                        )}
                        {stats.openContractId && (
                            <div><span>Open contract</span><strong>#{stats.openContractId}</strong></div>
                        )}
                    </section>

                    <section className='matrix-modal__section'>
                        <div className='matrix-modal__section-title'>Live journal</div>
                        <div className='matrix-modal__log'>
                            {logs.length === 0 && <div className='matrix-modal__empty' data-testid='state-journal-empty'>The native runner journal will appear here.</div>}
                            {logs.map(log => (
                                <div className='matrix-modal__log-row' key={`${log.seq}-${log.message}`}>
                                    <time>{log.time}</time>
                                    <span style={{ color: LOG_COLORS[log.type] }}>{log.message}</span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </section>
                </div>

                <div className='matrix-modal__footer'>
                    <button className='matrix-modal__button matrix-modal__button--cancel' onClick={close} data-testid='button-cancel-runner'>
                        {isRunning ? 'Stop & close' : 'Close'}
                    </button>
                    {isRunning ? (
                        <button className='matrix-modal__button matrix-modal__button--stop' onClick={stop} disabled={stopPending} data-testid='button-stop-runner'>
                            {stopPending ? 'Waiting for settlement…' : 'Stop runner'}
                        </button>
                    ) : (
                        <button
                            className='matrix-modal__button matrix-modal__button--start'
                            onClick={start}
                            disabled={!authorized}
                            data-testid='button-start-runner'
                        >
                            Start Binary Matrix AI
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BinaryMatrixRunnerModal;
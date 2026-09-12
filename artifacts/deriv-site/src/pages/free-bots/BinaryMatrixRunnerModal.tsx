import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BotConfig } from './types';
import {
    BinaryMatrixEngine,
    type BinaryMatrixConfig,
    type BinaryMatrixStats,
    type BinaryMatrixStatus,
} from '@/utils/binary-matrix-engine';
import type { DTLog } from '@/utils/dtrader-engine';
import { APOLLO_BLOCK_REGISTRY } from '@/utils/apollo-block-registry';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useStore } from '@/hooks/useStore';

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
    const { client } = useStore();
    const [settings, setSettings] = useState<RunnerSettings>(readSettings);
    const [status, setStatus] = useState<BinaryMatrixStatus>('idle');
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
    const engineRef = useRef<BinaryMatrixEngine | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);

    const isRunning = status === 'scanning' || status === 'buying' || status === 'waiting';

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
        const config: BinaryMatrixConfig = {
            symbol: 'R_25',
            currency: client?.currency || 'USD',
            initialStake: numberSetting(settings.stake, 0.5, 0.35),
            takeProfit: numberSetting(settings.takeProfit, 10, 0.01),
            stopLoss: numberSetting(settings.stopLoss, 50, 0.01),
            martingale: numberSetting(settings.martingale, 2, 1),
            reanalyzeAfterWins: Math.max(1, Math.floor(numberSetting(settings.reanalyzeAfterWins, 3, 1))),
        };

        engineRef.current?.stop();
        setLogs([]);
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
        engine.onStatus = setStatus;
        engine.onStats = setStats;
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
        }
    };

    const stop = () => {
        engineRef.current?.stop();
        engineRef.current = null;
    };

    const close = () => {
        stop();
        onClose();
    };

    return (
        <div className='matrix-overlay' onClick={close}>
            <div className='matrix-modal' onClick={event => event.stopPropagation()}>
                <div className='matrix-modal__header' style={{ background: bot.gradient }}>
                    <div>
                        <div className='matrix-modal__title'>{bot.emoji} {bot.name}</div>
                        <div className='matrix-modal__badge'>NATIVE APOLLO RUNNER · R_25 · 1 TICK</div>
                    </div>
                    <button className='matrix-modal__close' onClick={close} aria-label='Stop and close'>✕</button>
                </div>

                <div className='matrix-modal__statusbar'>
                    <div className='matrix-modal__status'>
                        <span className='matrix-modal__status-dot' style={{ background: STATUS_COLORS[status] }} />
                        <strong style={{ color: STATUS_COLORS[status] }}>{STATUS_LABELS[status]}</strong>
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
                        <div className='matrix-modal__section-title'>Registered Apollo blocks</div>
                        <div className='matrix-modal__blocks'>
                            {Object.values(APOLLO_BLOCK_REGISTRY).map(block => (
                                <div className='matrix-modal__block' key={block.type}>
                                    <code>{block.type}</code>
                                    <span>{block.description}</span>
                                </div>
                            ))}
                        </div>
                        <p className='matrix-modal__hint'>
                            These native adapters replace the unsupported Blockly blocks without changing their condition order or purchase mapping.
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
                                    />
                                </label>
                            ))}
                        </div>
                    </section>

                    <section className='matrix-modal__section matrix-modal__section--summary'>
                        <div><span>Symbol</span><strong>Volatility 25 Index (R_25)</strong></div>
                        <div><span>Rules</span><strong>4 odd → Even · 4 even → Odd · 3 low → Over 4 · 3 high → Under 5</strong></div>
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
                            {logs.length === 0 && <div className='matrix-modal__empty'>The native runner journal will appear here.</div>}
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
                    <button className='matrix-modal__button matrix-modal__button--cancel' onClick={close}>
                        {isRunning ? 'Stop & close' : 'Close'}
                    </button>
                    {isRunning ? (
                        <button className='matrix-modal__button matrix-modal__button--stop' onClick={stop}>
                            Stop runner
                        </button>
                    ) : (
                        <button
                            className='matrix-modal__button matrix-modal__button--start'
                            onClick={start}
                            disabled={!authorized}
                        >
                            ▶ Start Binary Matrix AI
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BinaryMatrixRunnerModal;
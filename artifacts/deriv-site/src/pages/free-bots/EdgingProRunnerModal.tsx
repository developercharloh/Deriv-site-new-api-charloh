import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BotConfig } from './types';
import {
    EdgingProEngine,
    type EdgingProConfig,
    type EdgingProStats,
    type EdgingProStatus,
} from '@/utils/edging-pro-engine';
import { assessEdgingProEntry } from '@/utils/edging-pro-strategy';
import type { DTLog } from '@/utils/dtrader-engine';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useStore } from '@/hooks/useStore';
import { contract_stages } from '@/constants/contract-stage';

interface Props {
    bot: BotConfig;
    onClose: () => void;
}

interface RunnerSettings {
    lastX: string;
    stake: string;
    takeProfit: string;
    stopLoss: string;
    martingale: string;
    overPrediction: string;
    underPrediction: string;
    useVirtualHook: boolean;
    virtualLossThreshold: string;
}

const DEFAULT_SETTINGS: RunnerSettings = {
    lastX: '4',
    stake: '0.5',
    takeProfit: '10',
    stopLoss: '30',
    martingale: '2',
    overPrediction: '5',
    underPrediction: '4',
    useVirtualHook: true,
    virtualLossThreshold: '2',
};

const SETTINGS_KEY = 'edging_pro_engine_settings';

const STATUS_LABELS: Record<EdgingProStatus, string> = {
    idle: 'IDLE',
    scanning: 'SCANNING',
    paused: 'PAUSED',
    virtual: 'VIRTUAL HOOK',
    buying: 'BUYING PAIR',
    waiting: 'WAITING FOR SETTLEMENT',
    stopped: 'STOPPED',
    error: 'ERROR',
};

const STATUS_COLORS: Record<EdgingProStatus, string> = {
    idle: '#64748b',
    scanning: '#3b82f6',
    paused: '#64748b',
    virtual: '#8b5cf6',
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
        const saved = localStorage.getItem(SETTINGS_KEY);
        return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
        return DEFAULT_SETTINGS;
    }
}

const EdgingProRunnerModal: React.FC<Props> = ({ bot, onClose }) => {
    const { client, run_panel, transactions } = useStore();
    const [settings, setSettings] = useState<RunnerSettings>(readSettings);
    const [status, setStatus] = useState<EdgingProStatus>('idle');
    const [authorized, setAuthorized] = useState(() => Boolean(api_base.is_authorized));
    const [logs, setLogs] = useState<DTLog[]>([]);
    const [error, setError] = useState('');
    const [stats, setStats] = useState<EdgingProStats>({
        profit: 0,
        wins: 0,
        losses: 0,
        currentStake: 0.5,
        consecutiveVirtualLosses: 0,
        activeContracts: 0,
        lastAnalysis: assessEdgingProEntry([], 4),
    });
    const engineRef = useRef<EdgingProEngine | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);

    const isRunning =
        status === 'scanning' ||
        status === 'paused' ||
        status === 'virtual' ||
        status === 'buying' ||
        status === 'waiting' ||
        stats.activeContracts > 0;

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

    const updateSetting = <K extends keyof RunnerSettings>(key: K, value: RunnerSettings[K]) => {
        const next = { ...settings, [key]: value };
        setSettings(next);
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        } catch {
            // Persisting settings is optional; this run still uses the current values.
        }
    };

    const start = () => {
        if (isRunning || !authorized) return;
        setError('');
        const config: EdgingProConfig = {
            symbol: '1HZ50V',
            currency: client?.currency || 'USD',
            initialStake: Number(settings.stake),
            takeProfit: Number(settings.takeProfit),
            stopLoss: Number(settings.stopLoss),
            martingale: Number(settings.martingale),
            lastX: Number(settings.lastX),
            overPrediction: Number(settings.overPrediction),
            underPrediction: Number(settings.underPrediction),
            useVirtualHook: settings.useVirtualHook,
            virtualLossThreshold: Number(settings.virtualLossThreshold),
        };
        const valid =
            [config.initialStake, config.takeProfit, config.stopLoss].every(value => Number.isFinite(value) && value > 0) &&
            Number.isFinite(config.martingale) && config.martingale >= 1 &&
            Number.isInteger(config.lastX) && config.lastX >= 1 && config.lastX <= 1000 &&
            Number.isInteger(config.overPrediction) && config.overPrediction >= 1 && config.overPrediction <= 8 &&
            Number.isInteger(config.underPrediction) && config.underPrediction >= 0 &&
            config.underPrediction < config.overPrediction &&
            Number.isInteger(config.virtualLossThreshold) && config.virtualLossThreshold >= 1;
        if (!valid) {
            setError('Check all values. Predictions must be integers from 0–8, with Under below Over; Last X must be 1–1000.');
            return;
        }

        engineRef.current?.stop();
        setLogs([]);
        setStats({
            profit: 0,
            wins: 0,
            losses: 0,
            currentStake: config.initialStake,
            consecutiveVirtualLosses: 0,
            activeContracts: 0,
            lastAnalysis: assessEdgingProEntry([], config.lastX),
        });
        const engine = new EdgingProEngine(config);
        engine.onLog = appendLog;
        engine.onStatus = nextStatus => {
            setStatus(nextStatus);
            if (nextStatus === 'stopped' || nextStatus === 'idle' || nextStatus === 'error') {
                run_panel.unregisterNativeBot();
                return;
            }
            const stage =
                nextStatus === 'buying'
                    ? contract_stages.PURCHASE_SENT
                    : nextStatus === 'waiting'
                      ? contract_stages.PURCHASE_RECEIVED
                      : nextStatus === 'scanning' || nextStatus === 'virtual'
                        ? contract_stages.RUNNING
                        : contract_stages.STARTING;
            run_panel.updateNativeBot(stage, nextStatus === 'waiting');
        };
        engine.onStats = setStats;
        engine.onPosition = position => {
            transactions.onBotContractEvent(
                run_panel.nativePositionToContractInfo(position) as unknown as Parameters<
                    typeof transactions.onBotContractEvent
                >[0],
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
            paused => (paused ? engine.pause() : engine.resume()),
        );
    };

    const stop = () => {
        engineRef.current?.stop();
        run_panel.unregisterNativeBot();
        engineRef.current = null;
    };

    const close = () => {
        stop();
        onClose();
    };

    const condition = stats.lastAnalysis;
    const conditionText =
        condition.status === 'MET'
            ? 'MET'
            : condition.status === 'NOT MET'
              ? 'NOT MET'
              : `WAITING (${condition.digits.length}/${condition.lookback})`;

    return (
        <div className='matrix-overlay' onClick={close}>
            <div className='matrix-modal' onClick={event => event.stopPropagation()}>
                <div className='matrix-modal__header' style={{ background: bot.gradient }}>
                    <div>
                        <div className='matrix-modal__title'>{bot.emoji} {bot.name}</div>
                        <div className='matrix-modal__badge'>PAIRED DIGIT RUNNER · 1HZ50V · 1 TICK</div>
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
                            Log in to a Deriv demo or real account before starting. No trades are placed while unauthorised.
                        </div>
                    )}
                    {authorized && (
                        <div className='matrix-modal__notice matrix-modal__notice--ok'>
                            Deriv session detected. Both legs are priced from live proposals and submitted together.
                        </div>
                    )}
                    <div className='matrix-modal__notice matrix-modal__notice--warn'>
                        Risk: stake is per leg, so each pair uses 2× the configured stake. Digits 4 or 5 lose both legs.
                        Virtual Hook P/L uses the live proposal payouts; after a real pair, its loss counter restarts.
                    </div>
                    {error && <div className='matrix-modal__notice matrix-modal__notice--warn'>{error}</div>}

                    <section className='matrix-modal__section'>
                        <div className='matrix-modal__section-title'>Trade settings</div>
                        <div className='matrix-modal__fields'>
                            {([
                                ['lastX', 'Last X digits', '1'],
                                ['stake', 'Stake per leg ($)', '0.01'],
                                ['martingale', 'Martingale ×', '0.1'],
                                ['takeProfit', 'Take Profit ($)', '0.5'],
                                ['stopLoss', 'Stop Loss ($)', '0.5'],
                                ['overPrediction', 'Over prediction', '1'],
                                ['underPrediction', 'Under prediction', '1'],
                            ] as const).map(([key, label, step]) => (
                                <label className='matrix-modal__field' key={key}>
                                    <span>{label}</span>
                                    <input
                                        type='number'
                                        min={key === 'lastX' ? '1' : '0'}
                                        step={step}
                                        value={settings[key]}
                                        disabled={isRunning}
                                        onChange={event => updateSetting(key, event.target.value)}
                                    />
                                </label>
                            ))}
                        </div>
                        <label className='matrix-modal__field' style={{ marginTop: 12 }}>
                            <span>
                                <input
                                    type='checkbox'
                                    checked={settings.useVirtualHook}
                                    disabled={isRunning}
                                    onChange={event => updateSetting('useVirtualHook', event.target.checked)}
                                />{' '}
                                Use Virtual Hook
                            </span>
                        </label>
                        {settings.useVirtualHook && (
                            <label className='matrix-modal__field' style={{ marginTop: 12 }}>
                                <span>Real trades after consecutive virtual losses</span>
                                <input
                                    type='number'
                                    min='1'
                                    step='1'
                                    value={settings.virtualLossThreshold}
                                    disabled={isRunning}
                                    onChange={event => updateSetting('virtualLossThreshold', event.target.value)}
                                />
                            </label>
                        )}
                        <p className='matrix-modal__hint'>
                            Entry requires all of the latest X digits to be 4 or 5. Contracts last one tick. Default market: Volatility 50 (1s).
                        </p>
                    </section>

                    <section className='matrix-modal__section matrix-modal__section--summary'>
                        <div><span>Predictions</span><strong>Digit Over {settings.overPrediction} + Digit Under {settings.underPrediction}</strong></div>
                        <div><span>Journal condition</span><strong>Last {condition.lookback}: [{condition.digits.join(' ')}] · {conditionText}</strong></div>
                        <div><span>Virtual losses</span><strong>{stats.consecutiveVirtualLosses}/{settings.virtualLossThreshold} consecutive</strong></div>
                        <div><span>Current stake</span><strong>${stats.currentStake.toFixed(2)} per leg · ${(stats.currentStake * 2).toFixed(2)} total</strong></div>
                        <div><span>Open contracts</span><strong>{stats.activeContracts}</strong></div>
                    </section>

                    <section className='matrix-modal__section'>
                        <div className='matrix-modal__section-title'>Live journal</div>
                        <div className='matrix-modal__log'>
                            {logs.length === 0 && <div className='matrix-modal__empty'>The live digit and condition journal will appear here.</div>}
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
                            ▶ Start Edging pro Engine
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EdgingProRunnerModal;
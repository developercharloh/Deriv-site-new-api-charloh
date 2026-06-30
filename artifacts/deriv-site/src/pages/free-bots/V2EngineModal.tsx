import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DerivV2Engine, type V2BotConfig, type EngineLog, type EngineStatus, type TradeDirection } from '@/utils/deriv-v2-engine';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import type { BotConfig } from './types';

// ─── Per-bot V2 defaults ──────────────────────────────────────────────────────

function buildV2Config(bot: BotConfig, s: V2Settings): V2BotConfig {
    const stake          = Math.max(0.35, parseFloat(s.stake)          || 1);
    const takeProfit     = Math.max(0.5,  parseFloat(s.takeProfit)     || 10);
    const stopLoss       = Math.max(1,    parseFloat(s.stopLoss)       || 50);
    const martingale     = Math.max(1.1,  parseFloat(s.martingale)     || 2);
    const entryPoint     = Math.min(9, Math.max(0, parseInt(s.entryPoint,     10) || 0));
    const martiLevel     = Math.min(10, Math.max(1, parseInt(s.martingaleLevel, 10) || 6));
    const dir            = (s.direction as TradeDirection) || 'EVEN';

    switch (bot.id) {
        case 'matches-signal':
            return { symbol: '1HZ75V', contractKind: 'DIGITMATCH', prediction: entryPoint, entryPoint, initialStake: stake, martingale, martingaleLevel: martiLevel, takeProfit, stopLoss };
        case 'differ-v2':
            return { symbol: 'R_100', contractKind: 'DIGITDIFF', prediction: entryPoint, entryPoint, initialStake: stake, martingale, martingaleLevel: martiLevel, takeProfit, stopLoss };
        case 'even-odd-scanner':
            return { symbol: 'R_100', contractKind: 'DIGITEVEN', direction: dir, entryPoint, initialStake: stake, martingale, martingaleLevel: martiLevel, takeProfit, stopLoss };
        case 'over-under-signal':
            return { symbol: s.symbol || 'R_100', contractKind: 'DIGITOVER', direction: dir, barrier: entryPoint, entryPoint, initialStake: stake, martingale, martingaleLevel: martiLevel, takeProfit, stopLoss };
        default:
            return { symbol: 'R_100', contractKind: 'DIGITMATCH', prediction: entryPoint, entryPoint, initialStake: stake, martingale, martingaleLevel: martiLevel, takeProfit, stopLoss };
    }
}

function defaultSettings(bot: BotConfig): V2Settings {
    switch (bot.id) {
        case 'matches-signal':    return { stake:'10',   takeProfit:'15', stopLoss:'50', martingale:'2',   martingaleLevel:'6',  entryPoint:'4', direction:'EVEN', symbol:'' };
        case 'differ-v2':         return { stake:'1',    takeProfit:'5',  stopLoss:'10', martingale:'2.5', martingaleLevel:'6',  entryPoint:'9', direction:'EVEN', symbol:'' };
        case 'even-odd-scanner':  return { stake:'0.55', takeProfit:'10', stopLoss:'50', martingale:'2',   martingaleLevel:'10', entryPoint:'0', direction:'EVEN', symbol:'' };
        case 'over-under-signal': return { stake:'0.5',  takeProfit:'10', stopLoss:'50', martingale:'2',   martingaleLevel:'6',  entryPoint:'5', direction:'OVER', symbol:'R_100' };
        default:                  return { stake:'1',    takeProfit:'10', stopLoss:'50', martingale:'2',   martingaleLevel:'6',  entryPoint:'0', direction:'EVEN', symbol:'' };
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface V2Settings {
    stake:           string;
    takeProfit:      string;
    stopLoss:        string;
    martingale:      string;
    martingaleLevel: string;
    entryPoint:      string;
    direction:       string;
    symbol:          string;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
    bot:     BotConfig;
    onClose: () => void;
}

const MAX_LOGS = 300;

const V2EngineModal: React.FC<Props> = ({ bot, onClose }) => {
    const settingsKey = `deriv_v2_cfg_${bot.id}`;
    const [cfg, setCfg] = useState<V2Settings>(() => {
        try {
            const raw = localStorage.getItem(settingsKey);
            return raw ? JSON.parse(raw) as V2Settings : defaultSettings(bot);
        } catch { return defaultSettings(bot); }
    });

    const [status,  setStatus]  = useState<EngineStatus>('idle');
    const [logs,    setLogs]    = useState<EngineLog[]>([]);
    const [profit,  setProfit]  = useState(0);
    const [wins,    setWins]    = useState(0);
    const [losses,  setLosses]  = useState(0);

    const engineRef = useRef<DerivV2Engine | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    const isRunning = status !== 'idle' && status !== 'stopped' && status !== 'error';

    // Check if user is logged in
    const isAuthorized = api_base.is_authorized;

    // Auto-scroll log to bottom
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    // Cleanup on unmount
    useEffect(() => () => { engineRef.current?.stop(); }, []);

    const saveCfg = useCallback((next: V2Settings) => {
        setCfg(next);
        try { localStorage.setItem(settingsKey, JSON.stringify(next)); } catch { /* ignore */ }
    }, [settingsKey]);

    function pushLog(log: EngineLog) {
        setLogs(prev => {
            const next = [...prev, log];
            return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
        });
    }

    function handleStart() {
        setLogs([]);
        setProfit(0);
        setWins(0);
        setLosses(0);

        const config = buildV2Config(bot, cfg);
        const engine = new DerivV2Engine(config);

        engine.onLog    = pushLog;
        engine.onStatus = setStatus;
        engine.onProfit = (p, w, l) => { setProfit(p); setWins(w); setLosses(l); };

        engineRef.current = engine;
        engine.start();
    }

    function handleStop() {
        engineRef.current?.stop();
        engineRef.current = null;
    }

    const isEvenOdd   = bot.id === 'even-odd-scanner';
    const isOverUnder = bot.id === 'over-under-signal';
    const needsDir    = isEvenOdd || isOverUnder;
    const needsSymbol = isOverUnder;

    const statusColor = {
        idle:       '#888',
        connecting: '#f59e0b',
        scanning:   '#3b82f6',
        trading:    '#10b981',
        stopped:    '#6b7280',
        error:      '#ef4444',
    }[status];

    const statusLabel = {
        idle:       'IDLE',
        connecting: 'CONNECTING…',
        scanning:   'SCANNING',
        trading:    'TRADING',
        stopped:    'STOPPED',
        error:      'ERROR',
    }[status];

    const logColor: Record<string, string> = {
        scan:   '#6b7280',
        info:   '#3b82f6',
        win:    '#10b981',
        loss:   '#ef4444',
        error:  '#dc2626',
        system: '#a78bfa',
    };

    return (
        <div className='v2-overlay' onClick={onClose}>
            <div className='v2-modal' onClick={e => e.stopPropagation()}>

                {/* ── Header ── */}
                <div className='v2-modal__header' style={{ background: bot.gradient }}>
                    <div className='v2-modal__header-left'>
                        <span className='v2-modal__emoji'>{bot.emoji}</span>
                        <div>
                            <div className='v2-modal__bot-name'>{bot.name}</div>
                            <div className='v2-modal__engine-badge'>⚡ V2 Direct Engine</div>
                        </div>
                    </div>
                    <button className='v2-modal__close' onClick={onClose}>✕</button>
                </div>

                {/* ── Status bar ── */}
                <div className='v2-modal__statusbar'>
                    <div className='v2-modal__status-dot-wrap'>
                        <span className='v2-modal__status-dot' style={{ background: statusColor }} />
                        <span className='v2-modal__status-label' style={{ color: statusColor }}>{statusLabel}</span>
                    </div>
                    <div className='v2-modal__stats'>
                        <span className='v2-modal__stat v2-modal__stat--pnl' style={{ color: profit >= 0 ? '#10b981' : '#ef4444' }}>
                            P&L {profit >= 0 ? '+' : ''}{profit.toFixed(2)}
                        </span>
                        <span className='v2-modal__stat v2-modal__stat--wins'>W {wins}</span>
                        <span className='v2-modal__stat v2-modal__stat--losses'>L {losses}</span>
                    </div>
                </div>

                <div className='v2-modal__body'>

                    {/* ── Auth warning if not logged in ── */}
                    {!isAuthorized && (
                        <div className='v2-modal__section'>
                            <div className='v2-modal__auth-warn'>
                                ⚠️ You are not logged in. Log in to your account using the <strong>Log in</strong> button in the top bar, then try again.
                            </div>
                        </div>
                    )}

                    {/* ── Connection info ── */}
                    {isAuthorized && (
                        <div className='v2-modal__section'>
                            <div className='v2-modal__conn-info'>
                                ✅ Using your active Deriv session — no token needed.
                            </div>
                        </div>
                    )}

                    {/* ── Settings ── */}
                    <div className='v2-modal__section'>
                        <label className='v2-modal__section-title'>Settings</label>
                        <div className='v2-modal__fields'>
                            {([
                                { label: 'Stake ($)',        key: 'stake'           as const, step: '0.01' },
                                { label: 'Take Profit ($)',  key: 'takeProfit'      as const, step: '0.5'  },
                                { label: 'Stop Loss ($)',    key: 'stopLoss'        as const, step: '0.5'  },
                                { label: 'Martingale ×',    key: 'martingale'      as const, step: '0.1'  },
                                { label: 'Max Losses',      key: 'martingaleLevel' as const, step: '1'    },
                                { label: 'Entry Digit',     key: 'entryPoint'      as const, step: '1'    },
                            ]).map(f => (
                                <div key={f.key} className='v2-modal__field'>
                                    <label>{f.label}</label>
                                    <input
                                        type='number' step={f.step} min='0'
                                        value={cfg[f.key]}
                                        onChange={e => saveCfg({ ...cfg, [f.key]: e.target.value })}
                                        disabled={isRunning}
                                    />
                                </div>
                            ))}

                            {needsDir && (
                                <div className='v2-modal__field'>
                                    <label>Direction</label>
                                    <select
                                        value={cfg.direction}
                                        onChange={e => saveCfg({ ...cfg, direction: e.target.value })}
                                        disabled={isRunning}
                                    >
                                        {isEvenOdd
                                            ? (<><option value='EVEN'>EVEN</option><option value='ODD'>ODD</option></>)
                                            : (<><option value='OVER'>OVER</option><option value='UNDER'>UNDER</option></>)
                                        }
                                    </select>
                                </div>
                            )}

                            {needsSymbol && (
                                <div className='v2-modal__field'>
                                    <label>Symbol</label>
                                    <select
                                        value={cfg.symbol}
                                        onChange={e => saveCfg({ ...cfg, symbol: e.target.value })}
                                        disabled={isRunning}
                                    >
                                        <option value='R_100'>Volatility 100</option>
                                        <option value='R_75'>Volatility 75</option>
                                        <option value='R_50'>Volatility 50</option>
                                        <option value='R_25'>Volatility 25</option>
                                        <option value='R_10'>Volatility 10</option>
                                        <option value='1HZ100V'>Vol 100 (1s)</option>
                                        <option value='1HZ75V'>Vol 75 (1s)</option>
                                        <option value='1HZ50V'>Vol 50 (1s)</option>
                                        <option value='1HZ25V'>Vol 25 (1s)</option>
                                        <option value='1HZ10V'>Vol 10 (1s)</option>
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Live Journal ── */}
                    <div className='v2-modal__section'>
                        <label className='v2-modal__section-title'>Live Journal</label>
                        <div className='v2-modal__log'>
                            {logs.length === 0 && (
                                <div className='v2-modal__log-empty'>Journal will appear here when engine starts…</div>
                            )}
                            {logs.map((l, i) => (
                                <div key={i} className='v2-modal__log-row' style={{ color: logColor[l.type] ?? '#444' }}>
                                    <span className='v2-modal__log-time'>{l.time}</span>
                                    <span className='v2-modal__log-msg'>{l.message}</span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                </div>

                {/* ── Footer ── */}
                <div className='v2-modal__footer'>
                    <button
                        className='v2-modal__btn v2-modal__btn--cancel'
                        onClick={onClose}
                        disabled={isRunning}
                    >
                        Close
                    </button>
                    {!isRunning ? (
                        <button
                            className='v2-modal__btn v2-modal__btn--start'
                            onClick={handleStart}
                            disabled={!isAuthorized}
                        >
                            ▶ Start V2 Engine
                        </button>
                    ) : (
                        <button className='v2-modal__btn v2-modal__btn--stop' onClick={handleStop}>
                            ⏹ Stop Engine
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default V2EngineModal;

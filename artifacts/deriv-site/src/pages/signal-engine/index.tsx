import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, ChevronDown, Wifi, WifiOff, Loader2, Bot, X } from '@/utils/lucide-shim';
import '../entry-zone/entry-zone.scss';
import './signal-engine.scss';
import {
    analyzeSignals, trainMLWeights, modelVolatility,
    checkRegimeChange,
    initialMLWeights, type Signal, type MarketType, type MLWeights, type RegimeStatus,
} from './signal-brain';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { botIdFromSignal, fetchAndPatchBot, parseDigitFrom, prefetchBotXml } from '@/utils/bot-patch';

const ENGINE_KEY    = 'free_bots_engine_mode';
const V2_CONFIG_KEY = 'free_bots_v2_config';

// ─── All Deriv volatility symbols ────────────────────────────────────────────
import {
    DERIV_VOL_CODES,
    DERIV_VOL_SHORT,
    DERIV_VOL_LONG,
    DERIV_CONTINUOUS_VOLATILITIES,
    DERIV_STANDARD_VOLATILITIES,
} from '../../utils/deriv-volatilities';

const ALL_SYMBOLS = DERIV_VOL_CODES;
type Sym = string;

const SYM_SHORT = DERIV_VOL_SHORT;
const SYM_LONG  = DERIV_VOL_LONG;

const DERIV_WS = 'wss://ws.derivws.com/websockets/v3?app_id=1';
const BUF_SIZE = 300;

const DISPLAY_MARKETS = [
    { group: 'Volatility (1s) Indices', items: DERIV_CONTINUOUS_VOLATILITIES.map(v => v.code) },
    { group: 'Volatility Indices',      items: DERIV_STANDARD_VOLATILITIES.map(v => v.code)   },
];

// ─── Win rate tracking ────────────────────────────────────────────────────────

interface WinRecord {
    id:        string;
    symbol:    string;
    direction: string;
    market:    MarketType;
    resolved:  boolean;
    won:       boolean;
}

function resolveSignal(market: MarketType, direction: string, digit: number): boolean {
    if (market === 'over_under') {
        const b = Number(direction.split(' ')[1]);
        return direction.startsWith('OVER') ? digit > b : digit < b;
    }
    if (market === 'even_odd') {
        return direction === 'EVEN' ? digit % 2 === 0 : digit % 2 !== 0;
    }
    const d = Number(direction.split(' ')[1]);
    return direction.startsWith('MATCHES') ? digit === d : digit !== d;
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

function getRankColor(rank: number): string {
    if (rank === 1)  return '#10b981';
    if (rank === 2)  return '#0ea5e9';
    if (rank === 10) return '#ef4444';
    if (rank === 9)  return '#eab308';
    return '#64748b';
}
function getRankLabel(rank: number): string {
    if (rank === 1)  return 'Most';
    if (rank === 2)  return '2nd';
    if (rank === 10) return 'Least';
    if (rank === 9)  return '2nd↓';
    return '';
}
function computeRanks(dist: number[]): number[] {
    const indexed = dist.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const ranks   = new Array(10).fill(0);
    indexed.forEach(({ i }, pos) => { ranks[i] = pos + 1; });
    return ranks;
}
function circleSize(_p: number): number { return 52; }
const D_COLORS = ['#6366f1','#8b5cf6','#0ea5e9','#10b981','#eab308','#f97316','#ef4444','#ec4899','#14b8a6','#84cc16'];

// ─── Tick helpers ─────────────────────────────────────────────────────────────

function lastDigit(price: number, pip: number): number {
    return Math.abs(Math.round(price * Math.pow(10, pip))) % 10;
}
function buildDist(digits: number[]): number[] {
    const counts = Array(10).fill(0);
    for (const d of digits) counts[d]++;
    const n = digits.length || 1;
    return counts.map(c => Math.round((c / n) * 1000) / 10);
}

// ─── Per-symbol buffer ───────────────────────���────────────────────────────────

interface SymBuf {
    digits:       number[];
    ts:           number[];
    pip:          number;
    liveDigit:    number | null;
    livePrice:    number | null;
    prevPrice:    number | null;
    distribution: number[];
    tickCount:    number;
    status:       'connecting' | 'live' | 'error';
}
function makeBuf(): SymBuf {
    return { digits:[], ts:[], pip:2, liveDigit:null, livePrice:null, prevPrice:null,
             distribution: Array(10).fill(0), tickCount:0, status:'connecting' };
}

// ─── Display snapshot ─────────────────────────────────────────────────────────

interface DisplaySnap {
    distribution: number[];
    liveDigit:    number | null;
    livePrice:    number | null;
    prevPrice:    number | null;
    pipSize:      number;
    tickCount:    number;
    status:       'connecting' | 'live' | 'error';
}
const INIT_SNAP: DisplaySnap = {
    distribution: Array(10).fill(0), liveDigit:null, livePrice:null,
    prevPrice:null, pipSize:2, tickCount:0, status:'connecting',
};

// ─── Multi-market hook ────────────────────────────────────��───────────────────

interface TickEvent { sym: string; tc: number; }
interface MultiMarketHook {
    snap:       DisplaySnap;
    scanStatus: Record<string, 'connecting'|'live'|'error'>;
    tickEvent:  TickEvent | null;
    bufsRef:    React.MutableRefObject<Map<string, SymBuf>>;
}

function useMultiMarket(selectedSym: string): MultiMarketHook {
    const bufsRef    = useRef<Map<string, SymBuf>>(new Map(ALL_SYMBOLS.map(s => [s, makeBuf()])));
    const [snap, setSnap]         = useState<DisplaySnap>(INIT_SNAP);
    const [scanStatus, setScan]   = useState<Record<string, 'connecting'|'live'|'error'>>(
        Object.fromEntries(ALL_SYMBOLS.map(s => [s, 'connecting' as const])));
    const [tickEvent, setTickEvt] = useState<TickEvent | null>(null);
    const selectedRef             = useRef(selectedSym); selectedRef.current = selectedSym;

    const pushSnap = useCallback((sym: string) => {
        if (sym !== selectedRef.current) return;
        const buf = bufsRef.current.get(sym)!;
        setSnap({ distribution: [...buf.distribution], liveDigit: buf.liveDigit,
            livePrice: buf.livePrice, prevPrice: buf.prevPrice,
            pipSize: buf.pip, tickCount: buf.tickCount, status: buf.status });
    }, []);

    useEffect(() => {
        const wsList: WebSocket[] = [];
        const timerIds: ReturnType<typeof setTimeout>[] = [];

        ALL_SYMBOLS.forEach((sym, idx) => {
            const timer = setTimeout(() => {
                const ws = new WebSocket(DERIV_WS);
                wsList.push(ws);

                ws.onopen = () => ws.send(JSON.stringify({
                    ticks_history: sym, count: BUF_SIZE, end: 'latest',
                    style: 'ticks', subscribe: 1,
                }));

                ws.onmessage = (ev: MessageEvent) => {
                    let msg: any;
                    try { msg = JSON.parse(ev.data as string); } catch { return; }
                    if (msg.error) {
                        const buf = bufsRef.current.get(sym);
                        if (buf) buf.status = 'error';
                        setScan(s => ({ ...s, [sym]: 'error' }));
                        return;
                    }

                    const buf = bufsRef.current.get(sym);
                    if (!buf) return;

                    if (msg.msg_type === 'history') {
                        const prices: number[] = msg.history?.prices ?? [];
                        const pip  = msg.pip_size ?? 2;
                        const digs = prices.map((p: number) => lastDigit(p, pip));
                        buf.pip          = pip;
                        buf.digits       = digs.slice(-BUF_SIZE);
                        buf.ts           = digs.map((_, i) => Date.now() - (digs.length - 1 - i) * 1000).slice(-50);
                        buf.tickCount    = buf.digits.length;
                        buf.liveDigit    = digs[digs.length - 1] ?? null;
                        buf.livePrice    = prices[prices.length - 1] ?? null;
                        buf.prevPrice    = null;
                        buf.distribution = buildDist(buf.digits);
                        buf.status       = 'live';
                        setScan(s => ({ ...s, [sym]: 'live' }));
                        pushSnap(sym);
                    }

                    if (msg.msg_type === 'tick' && msg.tick) {
                        const { quote, pip_size } = msg.tick;
                        const pip = pip_size ?? buf.pip;
                        const dig = lastDigit(quote, pip);
                        buf.pip          = pip;
                        buf.prevPrice    = buf.livePrice;
                        buf.digits       = [...buf.digits.slice(-(BUF_SIZE - 1)), dig];
                        buf.ts           = [...buf.ts.slice(-49), Date.now()];
                        buf.tickCount++;
                        buf.liveDigit    = dig;
                        buf.livePrice    = quote;
                        buf.distribution = buildDist(buf.digits);
                        buf.status       = 'live';
                        pushSnap(sym);
                        // Fire on every tick (not throttled) so the entry-point
                        // banner reflects the current anchor digit instantly —
                        // the market can flip before the next execution.
                        setTickEvt({ sym, tc: buf.tickCount });
                    }
                };

                ws.onerror = () => {
                    const buf = bufsRef.current.get(sym);
                    if (buf) buf.status = 'error';
                    setScan(s => ({ ...s, [sym]: 'error' }));
                };

                ws.onclose = () => {
                    const buf = bufsRef.current.get(sym);
                    if (buf && buf.status !== 'live') {
                        buf.status = 'error';
                        setScan(s => ({ ...s, [sym]: 'error' }));
                    }
                };
            }, idx * 150);

            timerIds.push(timer);
        });

        return () => {
            timerIds.forEach(clearTimeout);
            wsList.forEach(ws => {
                ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
                ws.close();
            });
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const buf = bufsRef.current.get(selectedSym);
        if (!buf || buf.digits.length === 0) { setSnap(INIT_SNAP); return; }
        setSnap({ distribution: [...buf.distribution], liveDigit: buf.liveDigit,
            livePrice: buf.livePrice, prevPrice: null, pipSize: buf.pip,
            tickCount: buf.tickCount, status: buf.status });
    }, [selectedSym]);

    return { snap, scanStatus, tickEvent, bufsRef };
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useNow(ms = 1000): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
    return now;
}
function fmtCountdown(ms: number): string {
    if (ms <= 0) return '0:00';
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── QuadrantRow ──────────────────────────────────────────────────────────────

function QuadrantRow({ digits, distribution, ranks, liveDigit }: {
    digits: number[]; distribution: number[]; ranks: number[]; liveDigit: number | null;
}) {
    // Split 0–9 across two fixed-cell rows (0–4 upper, 5–9 lower) so a
    // circle resizing on each tick stays *inside* its grid cell instead of
    // shoving neighbors around. Cursor X is computed from the row index
    // (no DOM measurement → no per-tick reflow).
    const upper = digits.slice(0, 5);
    const lower = digits.slice(5, 10);

    const renderCell = (d: number) => {
        const rank   = ranks[d]; const color = getRankColor(rank);
        const p      = distribution[d] ?? 0; const size = circleSize(p);
        const isLive = liveDigit === d; const isHigh = rank <= 2 || rank >= 9;
        return (
            <div key={d} className='ez-circle-col'>
                <div className='ez-circle-holder'>
                    <div
                        className='ez-circle'
                        style={{ width: size, height: size, background: isHigh ? color : `${color}20`, border: `2px solid ${color}`, color: isHigh ? '#fff' : color, boxShadow: isLive ? `0 0 16px ${color}` : isHigh ? `0 0 6px ${color}44` : 'none' }}
                    >
                        {d}
                    </div>
                </div>
                <div className='ez-bar-track'>
                    <div className='ez-bar-fill' style={{ background: color, width: `${Math.min(100, p * 7)}%` }} />
                </div>
                <span className='ez-pct' style={{ color }}>{p.toFixed(1)}%</span>
            </div>
        );
    };

    const renderBand = (rowDigits: number[], key: string) => {
        const liveIdx = liveDigit !== null ? rowDigits.indexOf(liveDigit) : -1;
        return (
            <div className='ez-band' key={key}>
                {liveIdx !== -1 && (
                    <div className='ez-cursor-layer'>
                        <div className='ez-cursor' style={{ left: `${(liveIdx + 0.5) * 20}%` }}>
                            <span className='ez-cursor__arrow'>▼</span>
                        </div>
                    </div>
                )}
                <div className='ez-circles ez-circles--grid'>
                    {rowDigits.map(renderCell)}
                </div>
            </div>
        );
    };

    return (
        <div className='ez-quadrant ez-quadrant--split'>
            {renderBand(upper, 'upper')}
            {renderBand(lower, 'lower')}
        </div>
    );
}

// ─── LivePriceDisplay ─────────────────────────────────────────────────────────

function LivePriceDisplay({ livePrice, prevPrice, liveDigit, pipSize, status }: {
    livePrice:number|null; prevPrice:number|null; liveDigit:number|null; pipSize:number; status:string;
}) {
    const dir      = livePrice !== null && prevPrice !== null ? livePrice > prevPrice ? 'up' : livePrice < prevPrice ? 'down' : 'flat' : 'flat';
    const priceStr = livePrice !== null ? livePrice.toFixed(pipSize) : '—';
    const prefix   = livePrice !== null ? priceStr.slice(0, -1) : '—';
    const lastChar = liveDigit !== null ? String(liveDigit) : '—';
    const dc       = liveDigit !== null ? D_COLORS[liveDigit] : '#94a3b8';
    return (
        <div className='ez-price'>
            <div className='ez-price__status'>
                {status==='live'       ? <span className='ez-dot ez-dot--live'/>       : null}
                {status==='connecting' ? <span className='ez-dot ez-dot--connecting'/> : null}
                {status==='error'      ? <span className='ez-dot ez-dot--error'/>      : null}
                <span className='ez-price__status-text'>{status==='live'?'Live':status==='connecting'?'Connecting…':'Error'}</span>
                {dir==='up'   && <TrendingUp   className='ez-price__arrow ez-price__arrow--up'/>}
                {dir==='down' && <TrendingDown  className='ez-price__arrow ez-price__arrow--down'/>}
            </div>
            <div className='ez-price__value'>
                <span className='ez-price__prefix'>{prefix}</span>
                <AnimatePresence mode='wait'>
                    <motion.span key={lastChar} className='ez-price__last-digit' style={{ color:dc, textShadow:`0 0 16px ${dc}80` }}
                        initial={{ y:-18, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:18, opacity:0 }} transition={{ duration:0.2 }}>
                        {lastChar}
                    </motion.span>
                </AnimatePresence>
            </div>
        </div>
    );
}

// ─── Scan status row ──────────────────────────────────────────────────────────

function ScanStatusRow({ statuses }: { statuses: Record<string, 'connecting'|'live'|'error'> }) {
    const liveCount = ALL_SYMBOLS.filter(s => statuses[s] === 'live').length;
    return (
        <div className='se-scan-row'>
            <span className='se-scan-row__label'>
                {liveCount}/{ALL_SYMBOLS.length} markets live
            </span>
            <div className='se-scan-row__dots'>
                {ALL_SYMBOLS.map(sym => (
                    <span key={sym} className={`se-scan-dot se-scan-dot--${statuses[sym] ?? 'connecting'}`} title={SYM_SHORT[sym]} />
                ))}
            </div>
        </div>
    );
}

// ─── Signal Settings Modal ────────────────────────────────────────────────────

interface SignalSettings {
    stake:      string;
    takeProfit: string;
    stopLoss:   string;
    martingale: string;
    ticks:      string;
}

type RunState = 'idle' | 'launching' | 'no-workspace' | 'error';

function SignalSettingsModal({ signal, rank, onClose }: {
    signal: Signal; rank: number; onClose: () => void;
}) {
    const { dashboard, run_panel } = useStore();
    const storageKey = `sig_cfg_${signal.symbol}_${signal.market}`;
    const defaultTicks = String(signal.recommendedTicks ?? 1);
    const [cfg, setCfg] = useState<SignalSettings>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<SignalSettings>;
                // Always honour the signal's recommended ticks for a fresh open
                // (the user can still change it before clicking Save & Run).
                return {
                    stake:      parsed.stake      ?? '0.5',
                    takeProfit: parsed.takeProfit ?? '10',
                    stopLoss:   parsed.stopLoss   ?? '30',
                    martingale: parsed.martingale ?? '2',
                    ticks:      defaultTicks,
                };
            }
        } catch { /* ignore */ }
        return { stake: '0.5', takeProfit: '10', stopLoss: '30', martingale: '2', ticks: defaultTicks };
    });
    const [runState,   setRunState]   = useState<RunState>('idle');
    const [errMsg,     setErrMsg]     = useState('');
    const [engineMode, setEngineMode] = useState<'v1' | 'v2'>(() =>
        localStorage.getItem(ENGINE_KEY) === 'v2' ? 'v2' : 'v1'
    );
    const color = MARKET_COLOR[signal.market];

    // Pre-warm the bot XML the moment the modal opens. By the time the user
    // finishes adjusting stake/TP/SL/martingale and clicks Run, the file is
    // already cached in memory — saves the ~200–500 ms cold fetch + parse.
    useEffect(() => {
        try { prefetchBotXml(botIdFromSignal(signal)); } catch { /* ignore */ }
    }, [signal.market, signal.direction]);

    async function handleRun() {
        localStorage.setItem(storageKey, JSON.stringify(cfg));
        setRunState('launching');
        setErrMsg('');

        try {
            const stake      = parseFloat(cfg.stake)      || 0.5;
            const takeProfit = parseFloat(cfg.takeProfit) || 10;
            const stopLoss   = parseFloat(cfg.stopLoss)   || 30;
            const martingale = parseFloat(cfg.martingale) || 2;
            const ticks      = Math.max(1, Math.min(10, Math.round(parseInt(cfg.ticks, 10) || 1)));

            // Persist the chosen engine mode globally
            localStorage.setItem(ENGINE_KEY, engineMode);
            window.dispatchEvent(new StorageEvent('storage', { key: ENGINE_KEY, newValue: engineMode }));

            if (engineMode === 'v2') {
                // ── V2: build config directly from signal — no XML needed ──────────────
                // XML parsing was unreliable (TYPE_LIST varies per bot file). The signal
                // already carries the exact market + direction, so we derive V2BotConfig
                // straight from those values.
                const entryPoint      = parseDigitFrom(signal.entryPoint);
                const martingaleLevel = Math.max(3, Math.min(10, Math.round(stopLoss / stake)));

                type ContractKind  = 'DIGITMATCH'|'DIGITDIFF'|'DIGITEVEN'|'DIGITODD'|'DIGITOVER'|'DIGITUNDER';
                type TradeDir      = 'EVEN'|'ODD'|'OVER'|'UNDER';

                let contractKind: ContractKind;
                let direction:    TradeDir | undefined;
                let prediction:   number   | undefined;
                let barrier:      number   | undefined;

                if (signal.market === 'even_odd') {
                    const d = signal.direction.trim().toUpperCase();
                    direction    = d === 'ODD' ? 'ODD' : 'EVEN';
                    contractKind = d === 'ODD' ? 'DIGITODD' : 'DIGITEVEN';

                } else if (signal.market === 'over_under') {
                    const parts  = signal.direction.trim().toUpperCase().split(/\s+/);
                    direction    = parts[0] === 'UNDER' ? 'UNDER' : 'OVER';
                    barrier      = parseInt(parts[1] ?? '5', 10);
                    contractKind = direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';

                } else {
                    // matches_differs
                    const parts  = signal.direction.trim().toUpperCase().split(/\s+/);
                    const isDiff = parts[0] === 'DIFFERS' || parts[0] === 'DIFFER';
                    contractKind = isDiff ? 'DIGITDIFF' : 'DIGITMATCH';
                    prediction   = parseInt(parts[1] ?? '0', 10);
                }

                const v2Cfg = {
                    symbol: signal.symbol,
                    contractKind,
                    direction,
                    prediction,
                    barrier,
                    entryPoint,
                    initialStake:    stake,
                    martingale,
                    martingaleLevel,
                    takeProfit,
                    stopLoss,
                    duration:        ticks,
                };

                const v2CfgStr = JSON.stringify(v2Cfg);
                localStorage.setItem(V2_CONFIG_KEY, v2CfgStr);
                window.dispatchEvent(new StorageEvent('storage', { key: V2_CONFIG_KEY, newValue: v2CfgStr }));

                onClose();

                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('deriv-v2-autostart'));
                }, 400);

            } else {
                // ── V1: fetch XML, load into DBot Blockly workspace, auto-run ──────────
                const botId  = botIdFromSignal(signal);
                const doc    = await fetchAndPatchBot(botId, signal, stake, takeProfit, stopLoss, martingale, ticks);
                const xmlStr = new XMLSerializer().serializeToString(doc.documentElement);

                const Blockly = (window as any).Blockly;
                if (!Blockly?.derivWorkspace) {
                    setRunState('no-workspace');
                    return;
                }

                const dom = Blockly.utils.xml.textToDom(xmlStr);
                Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
                Blockly.derivWorkspace.cleanUp();
                Blockly.derivWorkspace.clearUndo();

                dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
                onClose();

                // 150 ms is enough for the Bot Builder tab to mount and the
                // Blockly workspace to register the freshly-loaded XML. The old
                // 500 ms was an over-conservative buffer.
                setTimeout(() => {
                    if (!(run_panel as any).is_running) {
                        run_panel.onRunButtonClick();
                    }
                }, 150);
            }

        } catch (e: any) {
            setRunState('error');
            setErrMsg(e?.message || 'Failed to load bot.');
        }
    }

    const fields: { label: string; key: keyof SignalSettings; hint: string; step: string; min: string; max?: string }[] = [
        { label: 'Stake',       key: 'stake',      hint: '$',     step: '0.01', min: '0' },
        { label: 'Take Profit', key: 'takeProfit',  hint: '$',     step: '0.01', min: '0' },
        { label: 'Stop Loss',   key: 'stopLoss',    hint: '$',     step: '0.01', min: '0' },
        { label: 'Martingale',  key: 'martingale',  hint: '×',     step: '0.1',  min: '0' },
        { label: 'Ticks',       key: 'ticks',       hint: 'duration', step: '1', min: '1', max: '10' },
    ];

    return (
        <div className='se-modal-overlay' onClick={onClose}>
            <motion.div className='se-modal'
                initial={{ opacity:0, scale:0.94, y:24 }} animate={{ opacity:1, scale:1, y:0 }}
                exit={{ opacity:0, scale:0.94, y:24 }} transition={{ duration:0.22, ease:'easeOut' }}
                onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className='se-modal__header'>
                    <span className='se-modal__title'>Signal Settings</span>
                    <button className='se-modal__close' onClick={onClose}><X size={16}/></button>
                </div>

                {/* Signal info card */}
                <div className='se-modal__info-card'>
                    <div className='se-modal__info-left'>
                        <span className='se-modal__info-row-label'>Selected:</span>
                        <span className='se-modal__info-sym'>{signal.symbolLabel}</span>
                    </div>
                    <div className='se-modal__info-right'>
                        <span className='se-modal__info-dir' style={{ color }}>{signal.direction}</span>
                        <span className='se-modal__info-meta'>Rank #{rank} | Confidence: {signal.confidence}%</span>
                    </div>
                </div>

                {/* Engine mode selector */}
                <div className='se-modal__engine-row'>
                    <div className='se-modal__engine-label-wrap'>
                        <span className='se-modal__engine-label'>Execute with</span>
                        <span className='se-modal__engine-rec'>
                            ★ Recommended: <strong>{signal.recommendedEngine.toUpperCase()}</strong>
                        </span>
                    </div>
                    <div className='se-modal__engine-seg'>
                        <button
                            type='button'
                            className={`se-modal__engine-opt ${engineMode === 'v1' ? 'se-modal__engine-opt--active' : ''}`}
                            onClick={() => setEngineMode('v1')}
                        >
                            ⚙️ V1
                            {signal.recommendedEngine === 'v1' && <span className='se-modal__engine-star'>★</span>}
                        </button>
                        <button
                            type='button'
                            className={`se-modal__engine-opt se-modal__engine-opt--v2 ${engineMode === 'v2' ? 'se-modal__engine-opt--v2-active' : ''}`}
                            onClick={() => setEngineMode('v2')}
                        >
                            ⚡ V2
                            {signal.recommendedEngine === 'v2' && <span className='se-modal__engine-star'>★</span>}
                        </button>
                    </div>
                </div>

                {/* Inputs 2×2 */}
                <div className='se-modal__inputs'>
                    {fields.map(({ label, key, hint, step, min, max }) => {
                        const isTicks = key === 'ticks';
                        return (
                            <div key={key} className={`se-modal__field${isTicks ? ' se-modal__field--full' : ''}`}>
                                <label className='se-modal__field-label'>
                                    {label} <span className='se-modal__field-hint'>{hint}</span>
                                    {isTicks && (
                                        <span className='se-modal__field-rec'>
                                            recommended: {signal.recommendedTicks}
                                        </span>
                                    )}
                                </label>
                                {isTicks ? (
                                    <select
                                        className='se-modal__input se-modal__select'
                                        value={cfg.ticks}
                                        onChange={e => setCfg(p => ({ ...p, ticks: e.target.value }))}
                                        disabled={runState === 'launching'}
                                    >
                                        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                                            <option key={n} value={String(n)}>
                                                {n} {n === 1 ? 'tick' : 'ticks'}
                                                {n === signal.recommendedTicks ? '  ★ recommended' : ''}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        className='se-modal__input'
                                        type='number' min={min} step={step} max={max}
                                        value={cfg[key]}
                                        onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))}
                                        disabled={runState === 'launching'}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* No-workspace warning */}
                {runState === 'no-workspace' && (
                    <motion.div className='se-modal__warn-banner'
                        initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}>
                        <div className='se-modal__warn-icon'>⚠️</div>
                        <div className='se-modal__warn-body'>
                            <strong>Bot Builder not ready yet.</strong>
                            <span>Visit the <strong>Bot Builder</strong> tab once to initialise the workspace, then come back and tap Save &amp; Run again.</span>
                        </div>
                        <button className='se-modal__btn se-modal__btn--cancel se-modal__warn-close' onClick={() => setRunState('idle')}>OK</button>
                    </motion.div>
                )}

                {/* Generic error */}
                {runState === 'error' && (
                    <motion.div className='se-modal__warn-banner se-modal__warn-banner--error'
                        initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}>
                        <div className='se-modal__warn-icon'>❌</div>
                        <div className='se-modal__warn-body'>
                            <strong>Could not load bot.</strong>
                            <span>{errMsg}</span>
                        </div>
                        <button className='se-modal__btn se-modal__btn--cancel se-modal__warn-close' onClick={() => setRunState('idle')}>Retry</button>
                    </motion.div>
                )}

                {/* Footer */}
                <div className='se-modal__footer'>
                    <button className='se-modal__btn se-modal__btn--cancel'
                        onClick={onClose} disabled={runState === 'launching'}>Cancel</button>
                    <button className='se-modal__btn se-modal__btn--run'
                        onClick={handleRun} disabled={runState === 'launching'}>
                        {runState === 'launching'
                            ? <><Loader2 size={13} className='se-modal__spin'/> Launching…</>
                            : 'Save and Run'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

const MARKET_LABEL: Record<MarketType, string> = {
    over_under:'OVER / UNDER', even_odd:'EVEN / ODD', matches_differs:'MATCH / DIFFER',
};
const MARKET_COLOR: Record<MarketType, string> = {
    over_under:'#6366f1', even_odd:'#10b981', matches_differs:'#f59e0b',
};

function SignalCard({ signal, now, winResult, onLoadAI }: {
    signal: Signal; now: number; winResult?: boolean; onLoadAI: () => void;
}) {
    const remaining = signal.expiresAt - now;
    const ttl       = signal.expiresAt - signal.createdAt; // 60 000 or 120 000
    const pct       = Math.max(0, remaining / ttl);
    const color     = MARKET_COLOR[signal.market];
    const urgent    = remaining < 30_000;

    // Recency bar colour: green if strong, amber if moderate
    const recentPct  = signal.recentTotal > 0 ? signal.recentScore / signal.recentTotal : 0;
    const recentColor = recentPct >= 0.70 ? '#10b981' : recentPct >= 0.55 ? '#eab308' : '#ef4444';

    return (
        <div className='se-signal-card'
            style={{ '--sig-color': color } as React.CSSProperties}>

            {/* head: market badge + timer + optional win/loss */}
            <div className='se-signal-card__head'>
                <span className='se-signal-card__badge' style={{ background:`${color}22`, color }}>
                    {MARKET_LABEL[signal.market]}
                </span>
                <div className='se-signal-card__head-right'>
                    {winResult !== undefined && (
                        <span className={`se-signal-card__result se-signal-card__result--${winResult ? 'win' : 'loss'}`}>
                            {winResult ? '✓ WIN' : '✗ LOSS'}
                        </span>
                    )}
                    <span className={`se-signal-card__timer ${urgent ? 'se-signal-card__timer--urgent' : ''}`}>
                        ⏱ {fmtCountdown(remaining)}
                    </span>
                </div>
            </div>

            <div className='se-signal-card__direction' style={{ color }}>{signal.direction}</div>

            <div className='se-signal-card__symbol'>
                <span className='se-signal-card__sym-badge'>{SYM_SHORT[signal.symbol] ?? signal.symbol}</span>
                {signal.symbolLabel}
            </div>

            <div className='se-signal-card__models'>
                {signal.modelsAgreeing.map(m => (
                    <span key={m} className='se-signal-card__model-chip'>{m}</span>
                ))}
            </div>

            {/* meta: sample size + recency score */}
            <div className='se-signal-card__meta'>
                <span className='se-signal-card__meta-pill'>
                    📊 {signal.sampleSize} ticks
                </span>
                <span className='se-signal-card__meta-pill' style={{ color: recentColor }}>
                    🕐 {signal.recentScore}/{signal.recentTotal} recent
                </span>
            </div>

            <div className='se-signal-card__conf-row'>
                <span className='se-signal-card__conf-label'>Confidence</span>
                <span className='se-signal-card__conf-val' style={{ color }}>{signal.confidence}%</span>
            </div>
            <div className='se-signal-card__conf-track'>
                <div className='se-signal-card__conf-fill' style={{ background: color, width:`${signal.confidence}%` }} />
            </div>

            <div className='se-signal-card__entry'>{signal.entryPoint}</div>

            <button className='se-signal-card__ai-btn' onClick={onLoadAI}>
                <Bot size={11} /> Load AI Signal
            </button>

            <div className='se-signal-card__ttl-track'>
                <div className='se-signal-card__ttl-fill'
                    style={{ background: urgent ? '#ef4444' : color, width:`${pct*100}%` }} />
            </div>
        </div>
    );
}

// ─── Volatility badge ─────────────────────────────────────────────────────────

function VolBadge({ digits, tickTimes }: { digits: number[]; tickTimes: number[] }) {
    const { status, reason } = modelVolatility(digits, tickTimes);
    return (
        <div className={`se-vol-badge se-vol-badge--${status.toLowerCase()}`}>
            <span className='se-vol-badge__dot' />
            <span>{status === 'ALLOW' ? 'Stable' : reason}</span>
        </div>
    );
}

// ─── Win rate pill ────────────────────────────────────────────────────────────

function WinRatePill({ wins, total }: { wins: number; total: number }) {
    if (total === 0) return null;
    const pct   = Math.round((wins / total) * 100);
    const color = pct >= 60 ? '#10b981' : pct >= 45 ? '#eab308' : '#ef4444';
    return (
        <span className='se-win-rate' style={{ color, borderColor: `${color}40`, background: `${color}12` }}>
            {wins}/{total} won · {pct}%
        </span>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SignalEngine = () => {
    const [selectedSym, setSelectedSym] = useState<string>(() => {
        try { return localStorage.getItem('chart_active_symbol') || '1HZ10V'; } catch { return '1HZ10V'; }
    });
    const { snap, scanStatus, tickEvent, bufsRef } = useMultiMarket(selectedSym);

    const { distribution, liveDigit, livePrice, prevPrice, pipSize, tickCount, status } = snap;
    const ranks = computeRanks(distribution);

    // ── Sync symbol from Charts tab whenever it changes ──────────────────────
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === 'chart_active_symbol' && e.newValue) {
                setSelectedSym(e.newValue);
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    // Signal state
    const [signals,   setSignals]   = useState<Signal[]>([]);
    const mlWeightsRef              = useRef<MLWeights>(initialMLWeights());
    const now                       = useNow(1000);

    // Signal settings modal
    const [settingsSignal, setSettingsSignal] = useState<{ signal: Signal; rank: number } | null>(null);

    // Regime change tracking (per symbol)
    const [regimeMap, setRegimeMap] = useState<Map<string, RegimeStatus>>(new Map());

    // Win rate tracking
    const winRecordsRef = useRef<WinRecord[]>([]);
    const [winStats,  setWinStats]  = useState<{ wins: number; total: number }>({ wins: 0, total: 0 });
    const [winMap,    setWinMap]    = useState<Map<string, boolean>>(new Map());

    // Expire signals every second
    useEffect(() => {
        setSignals(prev => prev.filter(s => s.expiresAt > now));
    }, [now]);

    // Run analysis on every 10-tick event + resolve win records
    useEffect(() => {
        if (!tickEvent) return;
        const { sym, tc } = tickEvent;
        const buf = bufsRef.current.get(sym);
        if (!buf || buf.digits.length < 50) return;

        const dig = buf.liveDigit;

        // 1. Resolve any pending win records for this symbol
        if (dig !== null) {
            let anyResolved = false;
            winRecordsRef.current.forEach(rec => {
                if (rec.resolved || rec.symbol !== sym) return;
                rec.won      = resolveSignal(rec.market, rec.direction, dig);
                rec.resolved = true;
                anyResolved  = true;
            });
            if (anyResolved) {
                // Keep at most 100 records
                if (winRecordsRef.current.length > 100)
                    winRecordsRef.current = winRecordsRef.current.slice(-100);
                const resolved = winRecordsRef.current.filter(r => r.resolved);
                const newMap   = new Map(resolved.map(r => [r.id, r.won]));
                setWinMap(newMap);
                setWinStats({ wins: resolved.filter(r => r.won).length, total: resolved.length });
            }
        }

        // 2. Retrain ML every 50 ticks on the selected symbol
        if (sym === selectedSym && tc % 50 === 0) {
            mlWeightsRef.current = trainMLWeights(buf.digits, mlWeightsRef.current);
        }

        // 3. Check regime change for this symbol (every 25 ticks)
        if (tc % 25 === 0 && buf.digits.length >= 200) {
            const regime = checkRegimeChange(buf.digits);
            setRegimeMap(prev => new Map(prev).set(sym, regime));
        }

        // 4. Run signal analysis
        const symLabel = SYM_LONG[sym] ?? sym;
        setSignals(prev => {
            const nowT          = Date.now();
            const active        = prev.filter(s => s.expiresAt > nowT);
            const activeMarkets = new Set(
                active.filter(s => s.symbol === sym).map(s => s.market)
            ) as Set<MarketType>;

            const newSigs = analyzeSignals(
                buf.digits, buf.ts, sym, symLabel,
                mlWeightsRef.current, activeMarkets,
            );

            if (newSigs.length > 0) {
                // Register new signals for win tracking
                newSigs.forEach(s => winRecordsRef.current.push({
                    id: s.id, symbol: s.symbol,
                    direction: s.direction, market: s.market,
                    resolved: false, won: false,
                }));
            }

            return newSigs.length > 0 ? [...active, ...newSigs] : active;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tickEvent]);

    // Publish top signal per direction type to localStorage for Free Bots wiring
    useEffect(() => {
        const now = Date.now();
        const active = signals.filter(s => s.expiresAt > now);

        const topMatch  = active.filter(s => s.market === 'matches_differs' && s.direction.startsWith('MATCHES'))
                                .sort((a, b) => b.confidence - a.confidence)[0];
        const topDiffer = active.filter(s => s.market === 'matches_differs' && s.direction.startsWith('DIFFERS'))
                                .sort((a, b) => b.confidence - a.confidence)[0];
        const topEO     = active.filter(s => s.market === 'even_odd')
                                .sort((a, b) => b.confidence - a.confidence)[0];
        const topOU     = active.filter(s => s.market === 'over_under')
                                .sort((a, b) => b.confidence - a.confidence)[0];

        const push = (key: string, sig: Signal | undefined) => {
            if (!sig) return;
            const payload: Record<string, unknown> = {
                symbol:      sig.symbol,
                symbolLabel: sig.symbolLabel,
                direction:   sig.direction,
                entryPoint:  sig.entryPoint,
                confidence:  sig.confidence,
                market:      sig.market,
                savedAt:     now,
            };
            // Over/Under: derive and save contractType + recoveryContractType so
            // the Over Under AI Signals Bot patches the correct PURCHASE_LIST direction
            // on both the primary and recovery purchase blocks.
            if (sig.market === 'over_under') {
                const side = sig.direction.trim().toUpperCase().split(/\s+/)[0];
                const ct   = side === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
                payload.contractType         = ct;
                payload.recoveryContractType = ct === 'DIGITUNDER' ? 'DIGITOVER' : 'DIGITUNDER';
            }
            localStorage.setItem(key, JSON.stringify(payload));
        };
        push('fb_signal_matches',    topMatch);
        push('fb_signal_differs',    topDiffer);
        push('fb_signal_even_odd',   topEO);
        push('fb_signal_over_under', topOU);
        window.dispatchEvent(new Event('fb_signal_update'));
    }, [signals]);

    // Sort signals: highest confidence first, cap at 6
    const displaySignals = [...signals]
        .sort((a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt)
        .slice(0, 6);

    const liveCount = ALL_SYMBOLS.filter(s => scanStatus[s] === 'live').length;

    const selBuf    = bufsRef.current.get(selectedSym);
    const selDigits = selBuf?.digits ?? [];
    const selTs     = selBuf?.ts     ?? [];

    return (
        <>
        <div className='ez-root se-root'>
        <div className='se-main-card'>

            {/* ══ HEADER ══════════════════════════════════════════════════ */}
            <div className='se-hd'>
                {/* row 1 — title + live badge */}
                <div className='se-hd__top'>
                    <div className='se-hd__title-block'>
                        <span className='se-hd__icon' aria-hidden='true'>⚡</span>
                        <div>
                            <h2 className='se-hd__title'>Signal Engine</h2>
                            <p className='se-hd__sub'>
                                Scanning all 10 volatility indices&nbsp;·&nbsp;{tickCount} ticks
                            </p>
                        </div>
                    </div>
                    <div className={`se-hd__live-badge ${liveCount === ALL_SYMBOLS.length ? 'se-hd__live-badge--full' : ''}`}>
                        <span className='se-hd__live-dot' />
                        {liveCount}/{ALL_SYMBOLS.length} LIVE
                    </div>
                </div>

                {/* row 2 — market selector */}
                <div className='se-hd__selector-row'>
                    <span className='se-hd__selector-label'>Display market</span>
                    <div className='se-hd__selector-wrap'>
                        <select
                            className='se-hd__selector-select'
                            value={selectedSym}
                            onChange={e => setSelectedSym(e.target.value)}
                        >
                            {DISPLAY_MARKETS.map(g => (
                                <optgroup key={g.group} label={g.group}>
                                    {g.items.map(s => (
                                        <option key={s} value={s}>{SYM_LONG[s]}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                        <ChevronDown className='se-hd__selector-chevron' size={14} />
                    </div>
                </div>

                {/* row 3 — scan dots */}
                <ScanStatusRow statuses={scanStatus} />
            </div>

            {/* Regime change alert banner */}
            {regimeMap.get(selectedSym)?.changed && (
                <div className='se-regime-alert'>
                    <span className='se-regime-alert__icon'>⚠️</span>
                    <div className='se-regime-alert__body'>
                        <strong>Regime shift detected — {SYM_SHORT[selectedSym]}</strong>
                        <p>{regimeMap.get(selectedSym)!.summary}</p>
                    </div>
                </div>
            )}

            {/* ══ SINGLE DISTRIBUTION CARD (price + digits + χ²) ══════════ */}
            <div className='se-dist-card'>
                {/* Price row */}
                <div className='se-dist-card__price-row'>
                    <LivePriceDisplay
                        livePrice={livePrice} prevPrice={prevPrice}
                        liveDigit={liveDigit} pipSize={pipSize} status={status}
                    />
                    <div className='se-digit-pill'>
                        {liveDigit !== null ? (
                            <>
                                <span className='se-digit-pill__label'>Last digit</span>
                                <AnimatePresence mode='wait'>
                                    <motion.span
                                        key={liveDigit}
                                        className='se-digit-pill__value'
                                        style={{ color: D_COLORS[liveDigit], textShadow: `0 0 18px ${D_COLORS[liveDigit]}99` }}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.15, ease: 'easeOut' }}
                                    >
                                        {liveDigit}
                                    </motion.span>
                                </AnimatePresence>
                            </>
                        ) : status === 'connecting' ? (
                            <Loader2 size={18} className='se-digit-pill__spin' />
                        ) : status === 'error' ? (
                            <WifiOff size={16} className='se-digit-pill__err' />
                        ) : (
                            <Wifi size={16} className='se-digit-pill__wifi' />
                        )}
                    </div>
                </div>

                {/* Digit distribution grid */}
                <div className='ez-quadrants'>
                    <QuadrantRow
                        digits={[0,1,2,3,4,5,6,7,8,9]}
                        distribution={distribution}
                        ranks={ranks}
                        liveDigit={liveDigit}
                    />
                </div>

                {/* χ² row (inside same card, conditionally shown) */}
            {tickCount >= 30 && (() => {
                const n   = tickCount;
                const exp = n / 10;
                const chiSq = distribution.reduce((acc, pct) => {
                    const obs  = (pct / 100) * n;
                    const diff = obs - exp;
                    return acc + diff * diff / exp;
                }, 0);
                const tier =
                    chiSq >= 21.67 ? { stars: '★★★', text: 'Highly biased distribution — strong systemic edge (p<0.01)', color: '#dc2626' } :
                    chiSq >= 16.92 ? { stars: '★★',  text: 'Significant digit bias — real distributional edge (p<0.05)', color: '#ea580c' } :
                    chiSq >= 14.68 ? { stars: '★',   text: 'Marginal digit bias detected (p<0.10)',                      color: '#ca8a04' } :
                                     { stars: '',    text: 'Near-uniform spread — no strong systemic bias',               color: '#64748b' };
                return (
                    <div className='se-chisq'>
                        <div className='se-chisq__row'>
                            <span className='se-chisq__label'>χ² goodness-of-fit</span>
                            <span className='se-chisq__val'>{chiSq.toFixed(2)}</span>
                            {tier.stars && <span className='se-chisq__stars' style={{ color: tier.color }}>{tier.stars}</span>}
                        </div>
                        <div className='se-chisq__verdict' style={{ color: tier.color }}>{tier.text}</div>
                    </div>
                );
            })()}
            </div>{/* end se-dist-card */}

        </div>{/* end se-main-card */}
        </div>
        </>
    );
};

export default SignalEngine;

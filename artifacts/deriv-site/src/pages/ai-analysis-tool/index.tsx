import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import TradeAnimation from '@/components/trade-animation';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import './ai-analysis-tool.scss';

// ─── Bot Redirector ───────────────────────────────────────────────────────────
// Watches the run_panel store reactively; when the bot starts it jumps to the
// Bot Builder tab so the user sees the live run progress + transactions.
const BotRedirector: React.FC<{ setActiveTab: (t: number) => void }> = observer(({ setActiveTab }) => {
    const { run_panel } = useStore();
    const { is_stop_button_visible } = run_panel;
    const prevRef = useRef(false);
    useEffect(() => {
        if (is_stop_button_visible && !prevRef.current) {
            setActiveTab(DBOT_TABS.BOT_BUILDER);
        }
        prevRef.current = is_stop_button_visible;
    }, [is_stop_button_visible, setActiveTab]);
    return null;
});

// ─── Markets ──────────────────────────────────────────────────────────────────
const MARKETS = [
    { code: 'R_10',    label: 'Volatility 10',       short: 'V10'      },
    { code: 'R_25',    label: 'Volatility 25',       short: 'V25'      },
    { code: 'R_50',    label: 'Volatility 50',       short: 'V50'      },
    { code: 'R_75',    label: 'Volatility 75',       short: 'V75'      },
    { code: 'R_100',   label: 'Volatility 100',      short: 'V100'     },
    { code: '1HZ10V',  label: 'Volatility 10 (1s)',  short: 'V10(1s)'  },
    { code: '1HZ25V',  label: 'Volatility 25 (1s)',  short: 'V25(1s)'  },
    { code: '1HZ50V',  label: 'Volatility 50 (1s)',  short: 'V50(1s)'  },
    { code: '1HZ75V',  label: 'Volatility 75 (1s)',  short: 'V75(1s)'  },
    { code: '1HZ100V', label: 'Volatility 100 (1s)', short: 'V100(1s)' },
    { code: 'JD10',    label: 'Jump 10',             short: 'J10'      },
    { code: 'JD25',    label: 'Jump 25',             short: 'J25'      },
    { code: 'JD50',    label: 'Jump 50',             short: 'J50'      },
    { code: 'JD75',    label: 'Jump 75',             short: 'J75'      },
    { code: 'JD100',   label: 'Jump 100',            short: 'J100'     },
];

const ANALYSIS_TYPES = [
    { value: 'even_odd',        label: 'Even / Odd'        },
    { value: 'matches_differs', label: 'Matches / Differs'  },
    { value: 'rise_fall',       label: 'Rise / Fall'        },
    { value: 'higher_lower',    label: 'Higher / Lower'     },
    { value: 'over_under',      label: 'Over / Under'       },
    { value: 'only_ups',        label: 'Only Ups'           },
    { value: 'only_downs',      label: 'Only Downs'         },
    { value: 'asians_high',     label: 'Asians High'        },
    { value: 'asians_low',      label: 'Asians Low'         },
];

const TICK_WINDOWS = [100, 500, 1000, 5000];
const DERIV_WS     = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const SPARKLINE_N  = 60;
const PATTERN_MAX  = 30;

type AnalysisType = typeof ANALYSIS_TYPES[number]['value'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const lastDigitOf = (q: number, pip: number): number => {
    const s = q.toFixed(pip);
    return parseInt(s[s.length - 1], 10);
};

const patternLabel = (
    prices: number[],
    idx: number,
    pip: number,
    type: AnalysisType,
    barrier: number,
    matchTarget: number,
): { label: string; win: boolean } => {
    const p = prices[idx];
    const d = lastDigitOf(p, pip);

    switch (type) {
        case 'even_odd':
            return d % 2 === 0
                ? { label: 'E', win: true }
                : { label: 'O', win: false };
        case 'matches_differs':
            return d === matchTarget
                ? { label: 'M', win: true }
                : { label: 'D', win: false };
        case 'over_under':
            return d > barrier
                ? { label: 'O', win: true }
                : { label: 'U', win: false };
        case 'rise_fall':
        case 'higher_lower':
        case 'only_ups':
        case 'only_downs': {
            if (idx === 0) return { label: '-', win: false };
            const up = p > prices[idx - 1];
            if (type === 'rise_fall') return up ? { label: 'R', win: true } : { label: 'F', win: false };
            if (type === 'higher_lower') return up ? { label: 'H', win: true } : { label: 'L', win: false };
            if (type === 'only_ups') return up ? { label: '↑', win: true } : { label: '↓', win: false };
            return up ? { label: '↑', win: false } : { label: '↓', win: true };
        }
        case 'asians_high':
        case 'asians_low': {
            const avg = prices.slice(Math.max(0, idx - 4), idx + 1).reduce((s, v) => s + v, 0) / Math.min(5, idx + 1);
            const isHigh = p > avg;
            return { label: isHigh ? 'AH' : 'AL', win: type === 'asians_high' ? isHigh : !isHigh };
        }
        default: return { label: '?', win: false };
    }
};

// ─── AI Engine (3 models) ─────────────────────────────────────────────────────
interface ModelOut { name: string; vote: boolean; pct: number; detail: string; }
interface AIResult {
    recommendation: string;
    confidence:     number;
    strength:       string;
    models:         ModelOut[];
    winSide:        string;
    loseSide:       string;
    winPct:         number;
}

function runAI(prices: number[], pip: number, type: AnalysisType, barrier: number): AIResult | null {
    if (prices.length < 50) return null;

    const digits   = prices.map(p => lastDigitOf(p, pip));
    const N        = digits.length;
    const freq     = new Array(10).fill(0);
    for (const d of digits) freq[d]++;
    const freqPct  = freq.map(f => f / N);

    const mostFreq = freqPct.indexOf(Math.max(...freqPct));
    const leastFreq = freqPct.indexOf(Math.min(...freqPct));

    let winFn: (i: number) => boolean;
    let winSide = '', loseSide = '', basePct = 0;

    switch (type) {
        case 'even_odd': {
            const evenCt = digits.filter(d => d % 2 === 0).length;
            const oddCt  = N - evenCt;
            if (evenCt >= oddCt) { winFn = i => digits[i] % 2 === 0; winSide = 'EVEN'; loseSide = 'ODD'; basePct = evenCt / N; }
            else                 { winFn = i => digits[i] % 2 !== 0; winSide = 'ODD';  loseSide = 'EVEN'; basePct = oddCt / N; }
            break;
        }
        case 'matches_differs': {
            const differCt = N - freq[leastFreq];
            if (freq[mostFreq] / N >= (1 - freq[leastFreq] / N)) {
                winFn = i => digits[i] === mostFreq; winSide = `MATCHES ${mostFreq}`; loseSide = `DIFFERS ${mostFreq}`; basePct = freq[mostFreq] / N;
            } else {
                winFn = i => digits[i] !== leastFreq; winSide = `DIFFERS ${leastFreq}`; loseSide = `MATCHES ${leastFreq}`; basePct = differCt / N;
            }
            break;
        }
        case 'over_under': {
            const overCt  = digits.filter(d => d > barrier).length;
            const underCt = digits.filter(d => d < barrier).length;
            if (overCt >= underCt) { winFn = i => digits[i] > barrier; winSide = `OVER ${barrier}`; loseSide = `UNDER ${barrier}`; basePct = overCt / N; }
            else                   { winFn = i => digits[i] < barrier; winSide = `UNDER ${barrier}`; loseSide = `OVER ${barrier}`; basePct = underCt / N; }
            break;
        }
        case 'rise_fall':
        case 'higher_lower':
        case 'only_ups':
        case 'only_downs': {
            const upCt = prices.slice(1).filter((p, i) => p > prices[i]).length;
            const dnCt = (prices.length - 1) - upCt;
            if (type === 'only_ups')   { winFn = i => i > 0 && prices[i] > prices[i - 1]; winSide = 'ONLY UPS';   loseSide = 'ONLY DOWNS'; basePct = upCt / (N - 1); }
            else if (type === 'only_downs') { winFn = i => i > 0 && prices[i] < prices[i - 1]; winSide = 'ONLY DOWNS'; loseSide = 'ONLY UPS'; basePct = dnCt / (N - 1); }
            else if (upCt >= dnCt) { winFn = i => i > 0 && prices[i] > prices[i - 1]; winSide = type === 'rise_fall' ? 'RISE' : 'HIGHER'; loseSide = type === 'rise_fall' ? 'FALL' : 'LOWER'; basePct = upCt / (N - 1); }
            else { winFn = i => i > 0 && prices[i] < prices[i - 1]; winSide = type === 'rise_fall' ? 'FALL' : 'LOWER'; loseSide = type === 'rise_fall' ? 'RISE' : 'HIGHER'; basePct = dnCt / (N - 1); }
            break;
        }
        case 'asians_high':
        case 'asians_low': {
            const aboveAvg = prices.filter((p, i) => {
                const avg = prices.slice(Math.max(0, i - 4), i + 1).reduce((s, v) => s + v, 0) / Math.min(5, i + 1);
                return p > avg;
            }).length;
            if (type === 'asians_high') { winFn = i => { const avg = prices.slice(Math.max(0,i-4),i+1).reduce((s,v)=>s+v,0)/Math.min(5,i+1); return prices[i]>avg; }; winSide = 'ASIANS HIGH'; loseSide = 'ASIANS LOW'; basePct = aboveAvg / N; }
            else { winFn = i => { const avg = prices.slice(Math.max(0,i-4),i+1).reduce((s,v)=>s+v,0)/Math.min(5,i+1); return prices[i]<avg; }; winSide = 'ASIANS LOW'; loseSide = 'ASIANS HIGH'; basePct = (N - aboveAvg) / N; }
            break;
        }
        default:
            winFn = () => false; winSide = '?'; loseSide = '?'; basePct = 0.5;
    }

    // ── Model 1: Pattern Momentum (last 30 ticks trend) ──
    const last30 = Array.from({ length: Math.min(30, N) }, (_, i) => N - 30 + i).filter(i => i >= 0);
    const m1WinRate = last30.filter(i => winFn(i)).length / Math.max(1, last30.length);
    const threshold = type === 'even_odd' ? 0.51 : type.includes('asian') ? 0.51 : 0.55;
    const m1Vote = m1WinRate >= threshold;
    const m1: ModelOut = {
        name: 'Pattern Momentum',
        vote: m1Vote,
        pct: Math.round(m1WinRate * 100),
        detail: `Last 30 ticks: ${Math.round(m1WinRate * 100)}% win rate`,
    };

    // ── Model 2: Digit Distribution ──
    const m2WinRate = basePct;
    const m2Vote = m2WinRate >= threshold;
    const m2: ModelOut = {
        name: 'Digit Distribution',
        vote: m2Vote,
        pct: Math.round(m2WinRate * 100),
        detail: `${N} ticks: ${Math.round(m2WinRate * 100)}% historical rate`,
    };

    // ── Model 3: Trend Persistence (recent 20% vs older 80%) ──
    const split = Math.floor(N * 0.2);
    const recentWin = Array.from({ length: split }, (_, i) => N - split + i).filter(i => winFn(i)).length / Math.max(1, split);
    const olderWin  = Array.from({ length: N - split }, (_, i) => i).filter(i => winFn(i)).length / Math.max(1, N - split);
    const m3Vote = recentWin >= threshold && recentWin >= olderWin - 0.05;
    const m3: ModelOut = {
        name: 'Trend Persistence',
        vote: m3Vote,
        pct: Math.round(recentWin * 100),
        detail: `Recent: ${Math.round(recentWin * 100)}% vs older: ${Math.round(olderWin * 100)}%`,
    };

    const votes = [m1, m2, m3].filter(m => m.vote).length;
    if (votes < 2) {
        // flip to losing side if 2+ vote against
        const flippedSide = loseSide;
        const confidence = Math.round(((1 - basePct) * 100 + (1 - m1WinRate) * 100 + (1 - recentWin) * 100) / 3);
        const strength = confidence >= 80 ? 'VERY STRONG' : confidence >= 70 ? 'STRONG' : confidence >= 60 ? 'MODERATE' : 'WEAK';
        return {
            recommendation: flippedSide,
            confidence: Math.min(99, Math.max(50, confidence)),
            strength,
            models: [m1, m2, m3],
            winSide: flippedSide,
            loseSide: winSide,
            winPct: Math.round((1 - basePct) * 100),
        };
    }

    const rawConf = Math.round((m1WinRate * 100 + m2WinRate * 100 + recentWin * 100) / 3);
    const confidence = Math.min(99, Math.max(50, rawConf));
    const strength = confidence >= 80 ? 'VERY STRONG' : confidence >= 70 ? 'STRONG' : confidence >= 60 ? 'MODERATE' : 'WEAK';

    return { recommendation: winSide, confidence, strength, models: [m1, m2, m3], winSide, loseSide, winPct: Math.round(basePct * 100) };
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ prices: number[] }> = ({ prices }) => {
    if (prices.length < 2) return null;
    const W = 90, H = 30;
    const mn = Math.min(...prices), mx = Math.max(...prices);
    const range = mx - mn || 1;
    const pts = prices.map((p, i) => {
        const x = (i / (prices.length - 1)) * W;
        const y = H - ((p - mn) / range) * (H - 2) - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className='aat-sparkline'>
            <defs>
                <linearGradient id='spkGrad' x1='0' y1='0' x2='1' y2='0'>
                    <stop offset='0%' stopColor='#00e676' stopOpacity='0.4' />
                    <stop offset='100%' stopColor='#00e676' />
                </linearGradient>
            </defs>
            <polyline points={pts} fill='none' stroke='url(#spkGrad)' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
    );
};

// ─── Confidence Gauge ─────────────────────────────────────────────────────────
const ConfidenceGauge: React.FC<{ pct: number; strength: string }> = ({ pct, strength }) => {
    const R = 32, C = 2 * Math.PI * R;
    const fill = (pct / 100) * C;
    const col = pct >= 80 ? '#00e676' : pct >= 65 ? '#ffd600' : '#ff3d57';
    return (
        <div className='aat-gauge'>
            <svg width='78' height='78' viewBox='0 0 78 78'>
                <circle cx='39' cy='39' r={R} fill='none' stroke='rgba(255,255,255,0.07)' strokeWidth='6' />
                <circle cx='39' cy='39' r={R} fill='none' stroke={col} strokeWidth='6'
                    strokeLinecap='round'
                    strokeDasharray={`${fill} ${C}`}
                    strokeDashoffset={C * 0.25}
                    transform='rotate(-90 39 39)'
                    style={{ transition: 'stroke-dasharray 0.8s ease' }}
                />
                <text x='39' y='36' textAnchor='middle' dominantBaseline='middle' fill='#fff' fontSize='14' fontWeight='900'>{pct}%</text>
                <text x='39' y='50' textAnchor='middle' fill={col} fontSize='6' fontWeight='800' letterSpacing='0.5'>{strength}</text>
            </svg>
            <span className='aat-gauge__lbl' style={{ color: col }}>Confidence</span>
        </div>
    );
};

// ─── Component ────────────────────────────────────────────────────────────────
const AiAnalysisTool: React.FC = () => {
    const { dashboard } = useStore();
    const { setActiveTab } = dashboard;

    const [sym,          setSym]          = useState('1HZ25V');
    const [analysisType, setAnalysisType] = useState<AnalysisType>('even_odd');
    const [tickWindow,   setTickWindow]   = useState(1000);
    const [overBarrier,  setOverBarrier]  = useState(4);

    const [prices,       setPrices]       = useState<number[]>([]);
    const [pipSize,      setPipSize]      = useState(2);
    const [livePrice,    setLivePrice]    = useState<number | null>(null);
    const [prevPrice,    setPrevPrice]    = useState<number | null>(null);
    const [sparkPrices,  setSparkPrices]  = useState<number[]>([]);
    const [connected,    setConnected]    = useState<'connecting' | 'live' | 'error'>('connecting');
    const [patternStream, setPatternStream] = useState<{ label: string; win: boolean }[]>([]);
    const [currentDigit, setCurrentDigit] = useState<number | null>(null);
    const [arrowKey,     setArrowKey]     = useState(0); // increments on each tick to retrigger animation

    const wsRef   = useRef<WebSocket | null>(null);
    const subRef  = useRef<number | null>(null); // subscription id
    const pricesRef = useRef<number[]>([]);
    const pipRef    = useRef(2);

    // ── Build pattern stream from prices ────────────────────────────────────
    const buildPattern = useCallback((prices: number[], pip: number, type: AnalysisType) => {
        if (prices.length < 2) return [];
        const digits = prices.map(p => lastDigitOf(p, pip));
        const freq   = new Array(10).fill(0);
        for (const d of digits) freq[d]++;
        const mostFreq = freq.indexOf(Math.max(...freq));
        const last = prices.slice(-PATTERN_MAX);
        return last.map((_, i) => {
            const realIdx = prices.length - PATTERN_MAX + i;
            return patternLabel(prices, Math.max(0, realIdx), pip, type, overBarrier, mostFreq);
        }).reverse().slice(0, 20);
    }, [overBarrier]);

    // ── WebSocket ────────────────────────────────────────────────────────────
    useEffect(() => {
        setConnected('connecting');
        setPrices([]);
        pricesRef.current = [];
        setLivePrice(null);
        setPrevPrice(null);
        setSparkPrices([]);
        setPatternStream([]);

        const ws = new WebSocket(DERIV_WS);
        wsRef.current = ws;
        let historyLoaded = false;

        ws.onopen = () => {
            // Fetch tick history
            ws.send(JSON.stringify({
                ticks_history: sym,
                end:           'latest',
                count:         Math.max(tickWindow, 200),
                style:         'ticks',
                req_id:        1,
            }));
            // Subscribe to live ticks
            ws.send(JSON.stringify({ ticks: sym, subscribe: 1, req_id: 2 }));
        };

        ws.onmessage = (ev) => {
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }

            if (msg.msg_type === 'history' && msg.req_id === 1) {
                const raw: number[] = (msg.history?.prices ?? []).map((x: any) =>
                    typeof x === 'string' ? parseFloat(x) : x).filter(Number.isFinite);
                const pip = msg.pip_size ?? 2;
                pipRef.current = pip;
                setPipSize(pip);
                const trimmed = raw.slice(-tickWindow);
                pricesRef.current = trimmed;
                setPrices([...trimmed]);
                setPatternStream(buildPattern(trimmed, pip, analysisType));
                if (raw.length > 0) {
                    const lastP = raw[raw.length - 1];
                    setLivePrice(lastP);
                    setSparkPrices(raw.slice(-SPARKLINE_N));
                    setCurrentDigit(lastDigitOf(lastP, pip));
                    setArrowKey(k => k + 1);
                }
                historyLoaded = true;
                setConnected('live');
            }

            if (msg.msg_type === 'tick' && msg.req_id === 2) {
                if (msg.subscription?.id) subRef.current = msg.subscription.id;
                const tick = parseFloat(msg.tick?.quote);
                if (!Number.isFinite(tick)) return;
                if (!historyLoaded) setConnected('live');

                setLivePrice(prev => { setPrevPrice(prev); return tick; });
                setSparkPrices(prev => [...prev.slice(-(SPARKLINE_N - 1)), tick]);
                setCurrentDigit(lastDigitOf(tick, pipRef.current));
                setArrowKey(k => k + 1);

                const updated = [...pricesRef.current.slice(-(tickWindow - 1)), tick];
                pricesRef.current = updated;
                setPrices([...updated]);
                setPatternStream(buildPattern(updated, pipRef.current, analysisType));
            }

            if (msg.error) { console.warn('Deriv WS error:', msg.error.message); }
        };

        ws.onerror = () => setConnected('error');
        ws.onclose = () => { if (wsRef.current === ws) setConnected('error'); };

        return () => {
            wsRef.current = null;
            if (subRef.current !== null) {
                try { ws.send(JSON.stringify({ forget: subRef.current })); } catch { /* */ }
            }
            try { ws.close(); } catch { /* */ }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sym, tickWindow]);

    // Rebuild pattern stream when analysis type changes (no reconnect needed)
    useEffect(() => {
        if (pricesRef.current.length > 0) {
            setPatternStream(buildPattern(pricesRef.current, pipRef.current, analysisType));
        }
    }, [analysisType, overBarrier, buildPattern]);

    // ── Computed ─────────────────────────────────────────────────────────────
    const { digitFreq, evenPct, oddPct, mostFreqDigit, leastFreqDigit } = useMemo(() => {
        if (prices.length < 10) return { digitFreq: new Array(10).fill(0), evenPct: 50, oddPct: 50, mostFreqDigit: 0, leastFreqDigit: 9 };
        const digits = prices.map(p => lastDigitOf(p, pipSize));
        const freq   = new Array(10).fill(0);
        for (const d of digits) freq[d]++;
        const pcts     = freq.map(f => parseFloat(((f / digits.length) * 100).toFixed(1)));
        const evenCt   = digits.filter(d => d % 2 === 0).length;
        const mostF    = pcts.indexOf(Math.max(...pcts));
        const leastF   = pcts.indexOf(Math.min(...pcts));
        return {
            digitFreq:     pcts,
            evenPct:       parseFloat(((evenCt / digits.length) * 100).toFixed(1)),
            oddPct:        parseFloat((((digits.length - evenCt) / digits.length) * 100).toFixed(1)),
            mostFreqDigit: mostF,
            leastFreqDigit: leastF,
        };
    }, [prices, pipSize]);

    const aiResult = useMemo(
        () => runAI(prices, pipSize, analysisType, overBarrier),
        [prices, pipSize, analysisType, overBarrier],
    );

    const priceChange  = livePrice !== null && prevPrice !== null ? livePrice - prevPrice : 0;
    const pricePct     = prevPrice ? Math.abs(priceChange / prevPrice) * 100 : 0;
    const priceUp      = priceChange >= 0;
    const market       = MARKETS.find(m => m.code === sym) ?? MARKETS[0];

    return (
        <div className='aat'>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className='aat__hd'>
                <div className='aat__hd-left'>
                    <span className='aat__hd-title'>AI <span className='aat__hd-accent'>ANALYSIS</span> TOOL</span>
                    <span className='aat__hd-sub'>Live Deriv Digit Analysis</span>
                </div>
                <div className={`aat__status aat__status--${connected}`}>
                    <span className='aat__status-dot' />
                    {connected === 'live' ? 'Live' : connected === 'connecting' ? 'Connecting' : 'Error'}
                </div>
            </div>

            {/* ── 3 Dropdowns ────────────────────────────────────────────── */}
            <div className='aat__droprows'>
                <div className='aat__drop-card'>
                    <span className='aat__drop-lbl'>Volatility</span>
                    <select className='aat__drop' value={sym} onChange={e => setSym(e.target.value)}>
                        {MARKETS.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                    </select>
                </div>
                <div className='aat__drop-card'>
                    <span className='aat__drop-lbl'>Analysis Type</span>
                    <select className='aat__drop' value={analysisType} onChange={e => setAnalysisType(e.target.value as AnalysisType)}>
                        {ANALYSIS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>
                <div className='aat__drop-card'>
                    <span className='aat__drop-lbl'>Ticks Analysed</span>
                    <select className='aat__drop' value={tickWindow} onChange={e => setTickWindow(Number(e.target.value))}>
                        {TICK_WINDOWS.map(w => <option key={w} value={w}>{w.toLocaleString()}</option>)}
                    </select>
                </div>
            </div>

            {/* Over/Under barrier selector */}
            {analysisType === 'over_under' && (
                <div className='aat__barrier-row'>
                    <span className='aat__barrier-lbl'>Barrier</span>
                    <div className='aat__barrier-btns'>
                        {[0,1,2,3,4,5,6,7,8].map(b => (
                            <button key={b} className={`aat__barrier-btn${overBarrier === b ? ' aat__barrier-btn--sel' : ''}`} onClick={() => setOverBarrier(b)}>
                                {b}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Live Price ─────────────────────────────────────────────── */}
            <div className='aat__price-card'>
                <div className='aat__price-left'>
                    <div className='aat__price-hd'>
                        <span className='aat__price-label'>Live Price</span>
                        <span className={`aat__price-dot aat__price-dot--${connected}`} />
                        <span className='aat__price-streaming'>{connected === 'live' ? 'Streaming' : connected === 'connecting' ? 'Connecting…' : 'Offline'}</span>
                    </div>
                    <div className={`aat__price-val aat__price-val--${priceUp ? 'up' : 'down'}`}>
                        {livePrice !== null ? livePrice.toFixed(pipSize) : '—'}
                    </div>
                    <div className='aat__price-change'>
                        <span className={priceUp ? 'aat__price-change--up' : 'aat__price-change--dn'}>
                            {priceChange !== 0 ? `${priceUp ? '+' : ''}${priceChange.toFixed(pipSize)} (${pricePct.toFixed(2)}%)` : ''}
                        </span>
                    </div>
                </div>
                <div className='aat__price-right'>
                    <Sparkline prices={sparkPrices} />
                </div>
            </div>

            {/* ── Live Pattern Stream ────────────────────────────────────── */}
            <div className='aat__pattern-card'>
                <div className='aat__pattern-hd'>
                    <span className='aat__pattern-title'>⚡ Live Pattern Stream</span>
                    <span className='aat__pattern-sub'>Last {Math.min(patternStream.length, 20)} Ticks</span>
                </div>
                <div className='aat__pattern-stream'>
                    {patternStream.slice(0, 20).map((p, i) => (
                        <span key={i} className={`aat__pattern-block aat__pattern-block--${p.win ? 'win' : 'lose'}`}>
                            {p.label}
                        </span>
                    ))}
                    {patternStream.length > 0 && <span className='aat__pattern-more'>›</span>}
                </div>
            </div>

            {/* ── AI Recommendation + Confidence ─────────────────────────── */}
            <div className='aat__ai-row'>
                <div className='aat__rec-card'>
                    <div className='aat__rec-hd'>
                        <span className='aat__rec-icon'>🎯</span>
                        <span className='aat__rec-title'>AI Recommendation</span>
                    </div>
                    {aiResult ? (
                        <>
                            <div className='aat__rec-val'>
                                {aiResult.recommendation}
                                <span className={`aat__rec-badge aat__rec-badge--${aiResult.strength.toLowerCase().replace(' ','-')}`}>
                                    {aiResult.strength}
                                </span>
                            </div>
                            <div className='aat__rec-prob-lbl'>Probability</div>
                            <div className='aat__rec-prob-val'>{aiResult.winPct}%</div>
                            <div className='aat__rec-prob-bar'>
                                <div className='aat__rec-prob-fill' style={{ width: `${aiResult.winPct}%` }} />
                            </div>
                            <div className='aat__model-votes'>
                                {aiResult.models.map((m, i) => (
                                    <div key={i} className={`aat__model-chip aat__model-chip--${m.vote ? 'yes' : 'no'}`}>
                                        <span className='aat__model-chip-dot' />
                                        <span className='aat__model-chip-name'>{m.name}</span>
                                        <span className='aat__model-chip-pct'>{m.pct}%</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className='aat__rec-loading'>Collecting data…</div>
                    )}
                </div>
                <div className='aat__conf-card'>
                    <div className='aat__conf-hd'>
                        <span className='aat__conf-icon'>🛡</span>
                        <span className='aat__conf-title'>Confidence</span>
                    </div>
                    {aiResult ? (
                        <ConfidenceGauge pct={aiResult.confidence} strength={aiResult.strength} />
                    ) : (
                        <div className='aat__rec-loading'>—</div>
                    )}
                </div>
            </div>

            {/* ── Run Bot (real TradeAnimation button) ─────────────────── */}
            <div className='aat__run-bar'>
                <BotRedirector setActiveTab={setActiveTab} />
                <TradeAnimation should_show_overlay />
            </div>

            {/* ── Digit Distribution ────────────────────────────────────── */}
            <div className='aat__dist-card'>
                <div className='aat__dist-hd'>
                    <span className='aat__dist-title'>📊 Digit Distribution <span className='aat__dist-sub'>(Last {prices.length.toLocaleString()} Ticks)</span></span>
                </div>
                <div className='aat__dist-grid'>
                    {digitFreq.map((pct, d) => {
                        const isMost   = d === mostFreqDigit;
                        const isLeast  = d === leastFreqDigit;
                        const isActive = d === currentDigit;
                        const cls = isMost ? 'most' : isLeast ? 'least' : 'normal';
                        return (
                            <div
                                key={d}
                                className={`aat__dist-cell aat__dist-cell--${cls}${isActive ? ' aat__dist-cell--active' : ''}`}
                            >
                                {isActive && (
                                    <span
                                        key={arrowKey}
                                        className='aat__dist-arrow'
                                    >▼</span>
                                )}
                                <span className='aat__dist-digit'>{d}</span>
                                <span className='aat__dist-pct'>{pct}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Stats Footer ─────────────────────────────────────────── */}
            <div className='aat__stats-row'>
                <div className='aat__stat-card'>
                    <span className='aat__stat-lbl'>Most Frequent</span>
                    <span className='aat__stat-val aat__stat-val--green'>{mostFreqDigit}</span>
                    <span className='aat__stat-sub'>{digitFreq[mostFreqDigit]}% ↑</span>
                </div>
                <div className='aat__stat-card'>
                    <span className='aat__stat-lbl'>Least Frequent</span>
                    <span className='aat__stat-val aat__stat-val--red'>{leastFreqDigit}</span>
                    <span className='aat__stat-sub'>{digitFreq[leastFreqDigit]}% ↓</span>
                </div>
                <div className='aat__stat-card'>
                    <span className='aat__stat-lbl'>Even %</span>
                    <span className='aat__stat-val aat__stat-val--green'>{evenPct}%</span>
                    <span className='aat__stat-sub'>(0,2,4,6,8)</span>
                </div>
                <div className='aat__stat-card'>
                    <span className='aat__stat-lbl'>Odd %</span>
                    <span className='aat__stat-val aat__stat-val--red'>{oddPct}%</span>
                    <span className='aat__stat-sub'>(1,3,5,7,9)</span>
                </div>
            </div>

            <div className='aat__disclaimer'>
                ⚠️ Statistical analysis only. Deriv synthetic indices are random — past data does not guarantee future results. Trade responsibly.
            </div>
        </div>
    );
};

export default AiAnalysisTool;

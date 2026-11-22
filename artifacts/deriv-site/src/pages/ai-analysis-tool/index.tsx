import React, { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { useApiBase } from '@/hooks/useApiBase';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { AnalysisApiClient, subscribeToAnalysisFeed } from './ai-analysis-feed';
import {
    DERIV_CONTINUOUS_VOLATILITIES,
    DERIV_STANDARD_VOLATILITIES,
} from '@/utils/deriv-volatilities';
import {
    matchesEvenOddEntryPattern,
    matchesRiseFallEntryPattern,
} from './analysis-entry-patterns';
import AnalysisMarketCard from './AnalysisMarketCard';
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
// Sourced from the same canonical list used by the Charts section (advanced-dtrader).
// Order: continuous (1s) → standard (2s) → jump → crash → boom
const JUMP_MARKETS: { code: string; label: string; short: string }[] = [
    { code: 'JD10',  label: 'Jump 10',  short: 'J10'  },
    { code: 'JD25',  label: 'Jump 25',  short: 'J25'  },
    { code: 'JD50',  label: 'Jump 50',  short: 'J50'  },
    { code: 'JD75',  label: 'Jump 75',  short: 'J75'  },
    { code: 'JD100', label: 'Jump 100', short: 'J100' },
];

const MARKETS: { code: string; label: string; short: string }[] = [
    // Continuous (1-second tick) volatility indices
    ...DERIV_CONTINUOUS_VOLATILITIES.map(v => ({ code: v.code, label: v.label.replace(' Index', ''), short: v.short })),
    // Standard (2-second tick) volatility indices
    ...DERIV_STANDARD_VOLATILITIES.map(v => ({ code: v.code, label: v.label.replace(' Index', ''), short: v.short })),
    // Jump indices
    ...JUMP_MARKETS,
    // Crash indices
    { code: 'CRASH300N', label: 'Crash 300',  short: 'C300'  },
    { code: 'CRASH500',  label: 'Crash 500',  short: 'C500'  },
    { code: 'CRASH1000', label: 'Crash 1000', short: 'C1000' },
    // Boom indices
    { code: 'BOOM300N',  label: 'Boom 300',   short: 'B300'  },
    { code: 'BOOM500',   label: 'Boom 500',   short: 'B500'  },
    { code: 'BOOM1000',  label: 'Boom 1000',  short: 'B1000' },
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

const WIDE_EYE_GROUPS = [
    {
        id: 'continuous',
        label: 'Continuous Indices',
        markets: DERIV_CONTINUOUS_VOLATILITIES.map(market => ({
            code: market.code,
            label: market.label.replace(' Index', ''),
        })),
    },
    {
        id: 'jump',
        label: 'Jump Indices',
        markets: JUMP_MARKETS.map(({ code, label }) => ({ code, label })),
    },
] as const;

const WIDE_EYE_MARKETS = WIDE_EYE_GROUPS.flatMap(group => group.markets);

type AnalysisType = typeof ANALYSIS_TYPES[number]['value'];
type AnalysisView = 'normal' | 'wide-eye';
type WideMarketSnapshot = {
    prices: number[];
    pipSize: number;
    livePrice: number | null;
    connected: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const lastDigitOf = (q: number, pip: number): number => {
    const s = q.toFixed(pip);
    return parseInt(s[s.length - 1], 10);
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

// ─── Component ────────────────────────────────────────────────────────────────
const AiAnalysisTool: React.FC = observer(() => {
    const { dashboard, client } = useStore();
    const { setActiveTab } = dashboard;
    const { connectionStatus } = useApiBase();
    const accountId = client?.loginid ?? '';

    const [sym,          setSym]          = useState('1HZ25V');
    const [analysisType, setAnalysisType] = useState<AnalysisType>('even_odd');
    const [tickWindow,   setTickWindow]   = useState(120);
    const [tickWindowDraft, setTickWindowDraft] = useState('120');
    const [analysisView, setAnalysisView] = useState<AnalysisView>('normal');
    const [overBarrier,  setOverBarrier]  = useState(4);
    const [wideMarketData, setWideMarketData] = useState<Record<string, WideMarketSnapshot>>({});

    const [prices,       setPrices]       = useState<number[]>([]);
    const [pipSize,      setPipSize]      = useState(2);
    const [livePrice,    setLivePrice]    = useState<number | null>(null);
    const [connected,    setConnected]    = useState<'connecting' | 'live' | 'error'>('connecting');
    const [connectionError, setConnectionError] = useState('');
    const [retry, setRetry] = useState(0);
    const retryTimerRef = useRef<number | null>(null);
    const retryAttemptRef = useRef(0);
    const pricesRef = useRef<number[]>([]);
    const pipRef    = useRef(2);
    const livePriceRef = useRef<number | null>(null);

    // Only the site owns the socket, heartbeat, authorization and reconnect.
    useEffect(() => {
        setConnected('connecting');
        setConnectionError('');
        setPrices([]);
        pricesRef.current = [];
        pipRef.current = 2;
        livePriceRef.current = null;
        setPipSize(2);
        setLivePrice(null);

        const api = api_base.api as unknown as AnalysisApiClient | null;
        let freshnessTimer: number | undefined;
        const clearAutoRetry = () => {
            if (retryTimerRef.current !== null) {
                window.clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };
        if (analysisView === 'wide-eye') {
            return () => clearAutoRetry();
        }
        const retryForFeedError = (message: string) => {
            if (retryTimerRef.current !== null) return;
            window.clearTimeout(timer);
            window.clearTimeout(freshnessTimer);
            const retryDelay = Math.min(2_000 * 2 ** retryAttemptRef.current, 30_000);
            retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 5);
            setConnected('error');
            setConnectionError(`${message} Retrying automatically in ${Math.ceil(retryDelay / 1_000)}s.`);
            retryTimerRef.current = window.setTimeout(() => {
                retryTimerRef.current = null;
                setRetry(value => value + 1);
            }, retryDelay);
        };
        const timer = window.setTimeout(() => {
            retryForFeedError('No live data arrived from the site connection. Check your connection.');
        }, 12_000);
        if (connectionStatus !== 'opened' || !api) {
            if (connectionStatus === 'closed') {
                window.clearTimeout(timer);
                clearAutoRetry();
                setConnected('error');
                setConnectionError('The site connection was interrupted. Analysis will resume when it reconnects.');
            }
            return () => {
                window.clearTimeout(timer);
                clearAutoRetry();
            };
        }
        const cleanup = subscribeToAnalysisFeed({
            api,
            symbol: sym,
            count: Math.max(tickWindow, 200),
            onHistory: (raw, pip) => {
                pipRef.current = pip;
                setPipSize(pip);
                const trimmed = raw.slice(-tickWindow);
                pricesRef.current = trimmed;
                setPrices([...trimmed]);
                const last = raw[raw.length - 1];
                livePriceRef.current = last;
                setLivePrice(last);
            },
            onTick: (tick, tickPipSize) => {
                if (tickPipSize !== undefined && tickPipSize !== pipRef.current) {
                    pipRef.current = tickPipSize;
                    setPipSize(tickPipSize);
                }
                livePriceRef.current = tick;
                setLivePrice(tick);
                const updated = [...pricesRef.current.slice(-(tickWindow - 1)), tick];
                pricesRef.current = updated;
                setPrices(updated);
            },
            onStatus: (status, message) => {
                if (status === 'live') {
                    setConnected('live');
                    setConnectionError('');
                    window.clearTimeout(timer);
                    window.clearTimeout(freshnessTimer);
                    clearAutoRetry();
                    retryAttemptRef.current = 0;
                    freshnessTimer = window.setTimeout(() => {
                        livePriceRef.current = null;
                        setLivePrice(null);
                        retryForFeedError('Live ticks stopped arriving. Check the site connection.');
                    }, 12_000);
                } else {
                    livePriceRef.current = null;
                    setLivePrice(null);
                    retryForFeedError(message ?? 'The site connection could not load market data.');
                }
            },
        });
        return () => {
            window.clearTimeout(timer);
            window.clearTimeout(freshnessTimer);
            clearAutoRetry();
            cleanup();
        };
    }, [sym, tickWindow, connectionStatus, accountId, retry, analysisView]);

    useEffect(() => {
        if (analysisView !== 'wide-eye') return;

        setWideMarketData(Object.fromEntries(WIDE_EYE_MARKETS.map(market => [market.code, {
            prices: [],
            pipSize: 2,
            livePrice: null,
            connected: false,
        }])));
        const api = api_base.api as unknown as AnalysisApiClient | null;
        if (connectionStatus !== 'opened' || !api) return;

        const cleanups = WIDE_EYE_MARKETS.map(market => subscribeToAnalysisFeed({
            api,
            symbol: market.code,
            count: Math.max(tickWindow, 200),
            onHistory: (raw, pip) => {
                const prices = raw.slice(-tickWindow);
                setWideMarketData(current => ({
                    ...current,
                    [market.code]: {
                        prices,
                        pipSize: pip,
                        livePrice: prices[prices.length - 1] ?? null,
                        connected: false,
                    },
                }));
            },
            onTick: (price, pip) => {
                setWideMarketData(current => {
                    const existing = current[market.code];
                    const nextPrices = [...(existing?.prices ?? []).slice(-(tickWindow - 1)), price];
                    return {
                        ...current,
                        [market.code]: {
                            prices: nextPrices,
                            pipSize: pip ?? existing?.pipSize ?? 2,
                            livePrice: price,
                            connected: true,
                        },
                    };
                });
            },
            onStatus: status => {
                setWideMarketData(current => {
                    const existing = current[market.code];
                    return {
                        ...current,
                        [market.code]: {
                            prices: existing?.prices ?? [],
                            pipSize: existing?.pipSize ?? 2,
                            livePrice: existing?.livePrice ?? null,
                            connected: status === 'live',
                        },
                    };
                });
            },
        }));

        return () => cleanups.forEach(cleanup => cleanup());
    }, [analysisView, connectionStatus, accountId, tickWindow, retry]);

    const aiResult = useMemo(
        () => runAI(prices, pipSize, analysisType, overBarrier),
        [prices, pipSize, analysisType, overBarrier],
    );
    const market       = MARKETS.find(m => m.code === sym) ?? MARKETS[0];
    const effectiveConnection = analysisView === 'wide-eye'
        ? connectionStatus !== 'opened'
            ? 'error'
            : Object.values(wideMarketData).some(feed => feed.connected)
                ? 'live'
                : 'connecting'
        : connected;
    const retryAnalysis = () => {
        if (retryTimerRef.current !== null) {
            window.clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
        retryAttemptRef.current = 0;
        setRetry(value => value + 1);
    };
    const commitTickWindow = () => {
        const parsed = Number(tickWindowDraft);
        const next = Number.isFinite(parsed) && parsed >= 10
            ? Math.min(5000, Math.floor(parsed))
            : 120;
        setTickWindow(next);
        setTickWindowDraft(String(next));
    };

    return (
        <div className='aat'>
            <div className='aat__hd'>
                <div className='aat__hd-left'>
                    <span className='aat__hd-title'>AI <span className='aat__hd-accent'>ANALYSIS</span> TOOL</span>
                    <span className='aat__hd-sub'>Live Deriv Digit Analysis</span>
                </div>
                <div className={`aat__status aat__status--${effectiveConnection}`} role='status' data-testid='status-analysis-connection'>
                    <span className='aat__status-dot' />
                    {effectiveConnection === 'live' ? 'Live' : effectiveConnection === 'connecting' ? 'Connecting' : 'Offline'}
                </div>
            </div>

            <div className='aat__view-switch' role='group' aria-label='Analysis view'>
                <button
                    type='button'
                    className={`aat__view-button${analysisView === 'normal' ? ' aat__view-button--active' : ''}`}
                    aria-pressed={analysisView === 'normal'}
                    data-testid='button-normal-tool'
                    onClick={() => setAnalysisView('normal')}
                >
                    Normal Tool
                </button>
                <button
                    type='button'
                    className={`aat__view-button${analysisView === 'wide-eye' ? ' aat__view-button--active' : ''}`}
                    aria-pressed={analysisView === 'wide-eye'}
                    data-testid='button-wide-eye'
                    onClick={() => setAnalysisView('wide-eye')}
                >
                    <svg className='aat__view-eye' viewBox='0 0 20 20' aria-hidden='true'>
                        <path d='M1.5 10s3.1-5 8.5-5 8.5 5 8.5 5-3.1 5-8.5 5-8.5-5-8.5-5Z' />
                        <circle cx='10' cy='10' r='2.4' />
                    </svg>
                    Wide Eye
                </button>
            </div>

            {connectionError && analysisView === 'normal' && (
                <div className='aat__connection-error' role='status'>
                    {connectionError}{' '}
                    <button type='button' data-testid='button-retry-analysis' onClick={retryAnalysis}>Retry analysis</button>
                </div>
            )}
            {analysisView === 'wide-eye' && effectiveConnection !== 'live' && (
                <div className='aat__connection-error' role='status'>
                    {connectionStatus === 'opened' ? 'Loading the live 1-second volatility feeds.' : 'The site connection is unavailable.'}{' '}
                    <button type='button' data-testid='button-retry-wide-eye' onClick={retryAnalysis}>Retry Wide Eye</button>
                </div>
            )}

            <div className={`aat__droprows${analysisView === 'wide-eye' ? ' aat__droprows--wide' : ''}`}>
                {analysisView === 'normal' && (
                    <div className='aat__drop-card'>
                        <label className='aat__drop-lbl' htmlFor='aat-market-select'>Volatility</label>
                        <select id='aat-market-select' className='aat__drop' value={sym} onChange={e => setSym(e.target.value)} data-testid='select-volatility'>
                            {MARKETS.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                        </select>
                    </div>
                )}
                <div className='aat__drop-card'>
                    <label className='aat__drop-lbl' htmlFor='aat-analysis-select'>Analysis Type</label>
                    <select id='aat-analysis-select' className='aat__drop' value={analysisType} onChange={e => setAnalysisType(e.target.value as AnalysisType)} data-testid='select-analysis-type'>
                        {ANALYSIS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>
                <div className='aat__drop-card aat__tick-control'>
                    <label className='aat__drop-lbl' htmlFor='aat-tick-window'>Ticks Analysed</label>
                    <input
                        id='aat-tick-window'
                        className='aat__tick-input'
                        type='number'
                        inputMode='numeric'
                        min={10}
                        max={5000}
                        step={1}
                        value={tickWindowDraft}
                        aria-label='Number of ticks to analyze'
                        data-testid='input-tick-window'
                        onChange={event => setTickWindowDraft(event.currentTarget.value)}
                        onBlur={commitTickWindow}
                        onKeyDown={event => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                commitTickWindow();
                            }
                        }}
                    />
                </div>
            </div>

            {analysisType === 'over_under' && (
                <div className='aat__barrier-row'>
                    <span className='aat__barrier-lbl'>Barrier</span>
                    <div className='aat__barrier-btns'>
                        {[0,1,2,3,4,5,6,7,8,9].map(b => (
                            <button key={b} type='button' aria-pressed={overBarrier === b} data-testid={`button-barrier-${b}`} className={`aat__barrier-btn${overBarrier === b ? ' aat__barrier-btn--sel' : ''}`} onClick={() => setOverBarrier(b)}>
                                {b}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {analysisView === 'normal' ? (
                <AnalysisMarketCard
                    marketLabel={market.label}
                    livePrice={connected === 'live' ? livePrice : null}
                    pipSize={pipSize}
                    prices={prices}
                    tickWindow={tickWindow}
                    connected={connected === 'live'}
                    aiResult={connected === 'live' ? aiResult : null}
                    riseFallEntryValid={connected === 'live' && matchesRiseFallEntryPattern(prices)}
                    evenOddEntryValid={connected === 'live' && matchesEvenOddEntryPattern(prices, pipSize)}
                />
            ) : (
                <>
                    <div className='aat__wide-summary' data-testid='text-wide-eye-market-summary'>
                        {WIDE_EYE_MARKETS.length} markets · {WIDE_EYE_GROUPS[0].markets.length} continuous · {WIDE_EYE_GROUPS[1].markets.length} jump
                    </div>
                    <div className='aat__wide-list' data-testid='list-wide-eye-markets'>
                        {WIDE_EYE_GROUPS.map(group => (
                            <section
                                className='aat__wide-group'
                                key={group.id}
                                aria-label={`${group.label}, ${group.markets.length} markets`}
                                data-testid={`section-wide-eye-${group.id}`}
                            >
                                <header className='aat__wide-group-heading'>
                                    <h2>{group.label}</h2>
                                    <span>{group.markets.length} markets</span>
                                </header>
                                {group.markets.map(wideMarket => {
                                    const feed = wideMarketData[wideMarket.code] ?? {
                                        prices: [],
                                        pipSize: 2,
                                        livePrice: null,
                                        connected: false,
                                    };
                                    const result = feed.connected
                                        ? runAI(feed.prices, feed.pipSize, analysisType, overBarrier)
                                        : null;

                                    return (
                                        <AnalysisMarketCard
                                            key={wideMarket.code}
                                            marketLabel={wideMarket.label}
                                            livePrice={feed.connected ? feed.livePrice : null}
                                            pipSize={feed.pipSize}
                                            prices={feed.prices}
                                            tickWindow={tickWindow}
                                            connected={feed.connected}
                                            aiResult={result}
                                            riseFallEntryValid={feed.connected && matchesRiseFallEntryPattern(feed.prices)}
                                            evenOddEntryValid={feed.connected && matchesEvenOddEntryPattern(feed.prices, feed.pipSize)}
                                        />
                                    );
                                })}
                            </section>
                        ))}
                    </div>
                </>
            )}

            <p className='aat__disclaimer'>Pattern checks and recommendations are analysis only; review before trading.</p>

            <BotRedirector setActiveTab={setActiveTab} />
        </div>
    );
});

export default AiAnalysisTool;

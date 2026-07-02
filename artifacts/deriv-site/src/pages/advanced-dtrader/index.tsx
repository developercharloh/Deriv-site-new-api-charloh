import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useStore } from '@/hooks/useStore';
import {
    DTraderEngine,
    type DTBuyFeedback,
    type DTConfig,
    type DTContractType,
    type DTDurationUnit,
    type DTLog,
    type DTPosition,
    type DTProposal,
    type DTStatus,
    type DTContractEvent,
} from '@/utils/dtrader-engine';
import {
    DERIV_CONTINUOUS_VOLATILITIES,
    DERIV_STANDARD_VOLATILITIES,
} from '../../utils/deriv-volatilities';
import './dtrader.scss';

// ─── Symbol categories — full Deriv manual-trading universe ──────────────────
//
// Synthetic indices work for ALL contract types incl. digits/ACCU/MULT.
// Forex / Stock indices / Cryptos / Commodities work for binary contracts
// (Rise/Fall, Higher/Lower, Touch/No-Touch) — the API will reject if you try
// digits/ACCU/MULT on them, and our error toast will surface that.
type SymbolEntry = { value: string; label: string; group: string };

const FALLBACK_SYMBOLS: SymbolEntry[] = [
    // ── Volatility indices — sourced from canonical deriv-volatilities ──
    ...DERIV_CONTINUOUS_VOLATILITIES.map(v => ({
        value: v.code, label: v.label.replace(' Index', ''), group: 'Volatility (1s)',
    })),
    ...DERIV_STANDARD_VOLATILITIES.map(v => ({
        value: v.code, label: v.label.replace(' Index', ''), group: 'Volatility',
    })),
    // Boom/Crash
    { value: 'BOOM300N', label: 'Boom 300',  group: 'Boom & Crash' },
    { value: 'BOOM500',  label: 'Boom 500',  group: 'Boom & Crash' },
    { value: 'BOOM1000', label: 'Boom 1000', group: 'Boom & Crash' },
    { value: 'CRASH300N',label: 'Crash 300', group: 'Boom & Crash' },
    { value: 'CRASH500', label: 'Crash 500', group: 'Boom & Crash' },
    { value: 'CRASH1000',label: 'Crash 1000',group: 'Boom & Crash' },
    // Jump indices
    { value: 'JD10',  label: 'Jump 10',  group: 'Jump' },
    { value: 'JD25',  label: 'Jump 25',  group: 'Jump' },
    { value: 'JD50',  label: 'Jump 50',  group: 'Jump' },
    { value: 'JD75',  label: 'Jump 75',  group: 'Jump' },
    { value: 'JD100', label: 'Jump 100', group: 'Jump' },
    // Step
    { value: 'stpRNG', label: 'Step Index', group: 'Step' },
    // Forex majors (binary only)
    { value: 'frxAUDJPY', label: 'AUD/JPY', group: 'Forex' },
    { value: 'frxAUDUSD', label: 'AUD/USD', group: 'Forex' },
    { value: 'frxEURGBP', label: 'EUR/GBP', group: 'Forex' },
    { value: 'frxEURJPY', label: 'EUR/JPY', group: 'Forex' },
    { value: 'frxEURUSD', label: 'EUR/USD', group: 'Forex' },
    { value: 'frxGBPJPY', label: 'GBP/JPY', group: 'Forex' },
    { value: 'frxGBPUSD', label: 'GBP/USD', group: 'Forex' },
    { value: 'frxUSDCAD', label: 'USD/CAD', group: 'Forex' },
    { value: 'frxUSDCHF', label: 'USD/CHF', group: 'Forex' },
    { value: 'frxUSDJPY', label: 'USD/JPY', group: 'Forex' },
    // Cryptos (binary only)
    { value: 'cryBTCUSD', label: 'BTC/USD', group: 'Cryptocurrencies' },
    { value: 'cryETHUSD', label: 'ETH/USD', group: 'Cryptocurrencies' },
    // Commodities
    { value: 'frxXAUUSD', label: 'Gold/USD',   group: 'Commodities' },
    { value: 'frxXAGUSD', label: 'Silver/USD', group: 'Commodities' },
];

// ─── Contract category model ─────────────────────────────────────────────────
type CategoryKey =
    | 'rise_fall' | 'higher_lower' | 'touch' | 'matches_diff' | 'over_under' | 'even_odd'
    | 'accumulators' | 'multipliers';

interface CategoryDef {
    key:        CategoryKey;
    label:      string;
    emoji:      string;
    /** Pair of (label → contract type). Used for the direction toggle.
     *  ACCU has only one option (no direction). */
    options:    Array<{ label: string; type: DTContractType }>;
    needsBarrier:     boolean;        // relative barrier '+0.001'
    needsPrediction:  boolean;        // single digit
    needsDuration:    boolean;        // false for ACCU/MULT
    needsGrowthRate:  boolean;        // ACCU
    needsMultiplier:  boolean;        // MULT
    canSell:          boolean;        // user can close early (ACCU/MULT)
    barrierDefault?: string;
    units:           DTDurationUnit[];
    minDuration:     Partial<Record<DTDurationUnit, number>>;
    maxDuration:     Partial<Record<DTDurationUnit, number>>;
}

// Convenience: every binary category shares the same baseline flags
const BIN = {
    needsDuration:   true,
    needsGrowthRate: false,
    needsMultiplier: false,
    canSell:         false,
} as const;

const CATEGORIES: CategoryDef[] = [
    {
        key: 'rise_fall',  label: 'Rise / Fall', emoji: '📈',
        options: [{ label: 'Rise', type: 'CALL' }, { label: 'Fall', type: 'PUT' }],
        needsBarrier: false, needsPrediction: false, ...BIN,
        units: ['t', 's', 'm'],
        minDuration: { t: 1, s: 15, m: 1 }, maxDuration: { t: 10, s: 3600, m: 60 },
    },
    {
        key: 'higher_lower', label: 'Higher / Lower', emoji: '↕️',
        options: [{ label: 'Higher', type: 'CALL' }, { label: 'Lower', type: 'PUT' }],
        needsBarrier: true, needsPrediction: false, barrierDefault: '+0.001', ...BIN,
        units: ['s', 'm'],
        minDuration: { s: 15, m: 1 }, maxDuration: { s: 3600, m: 60 },
    },
    {
        key: 'touch', label: 'Touch / No Touch', emoji: '🎯',
        options: [{ label: 'Touch', type: 'ONETOUCH' }, { label: 'No Touch', type: 'NOTOUCH' }],
        needsBarrier: true, needsPrediction: false, barrierDefault: '+0.001', ...BIN,
        units: ['s', 'm'],
        minDuration: { s: 15, m: 1 }, maxDuration: { s: 3600, m: 60 },
    },
    {
        key: 'matches_diff', label: 'Matches / Differs', emoji: '🎲',
        options: [{ label: 'Matches', type: 'DIGITMATCH' }, { label: 'Differs', type: 'DIGITDIFF' }],
        needsBarrier: false, needsPrediction: true, ...BIN,
        units: ['t'], minDuration: { t: 1 }, maxDuration: { t: 10 },
    },
    {
        key: 'over_under', label: 'Over / Under', emoji: '⚖️',
        options: [{ label: 'Over', type: 'DIGITOVER' }, { label: 'Under', type: 'DIGITUNDER' }],
        needsBarrier: false, needsPrediction: true, ...BIN,
        units: ['t'], minDuration: { t: 1 }, maxDuration: { t: 10 },
    },
    {
        key: 'even_odd', label: 'Even / Odd', emoji: '🔢',
        options: [{ label: 'Even', type: 'DIGITEVEN' }, { label: 'Odd', type: 'DIGITODD' }],
        needsBarrier: false, needsPrediction: false, ...BIN,
        units: ['t'], minDuration: { t: 1 }, maxDuration: { t: 10 },
    },
    {
        key: 'accumulators', label: 'Accumulators', emoji: '📊',
        options: [{ label: 'Accumulator', type: 'ACCU' }],
        needsBarrier: false, needsPrediction: false,
        needsDuration: false, needsGrowthRate: true, needsMultiplier: false, canSell: true,
        units: [], minDuration: {}, maxDuration: {},
    },
    {
        key: 'multipliers', label: 'Multipliers', emoji: '🚀',
        options: [{ label: 'Up', type: 'MULTUP' }, { label: 'Down', type: 'MULTDOWN' }],
        needsBarrier: false, needsPrediction: false,
        needsDuration: false, needsGrowthRate: false, needsMultiplier: true, canSell: true,
        units: [], minDuration: {}, maxDuration: {},
    },
];

// ACCU/MULT preset choices
const GROWTH_RATES = [0.01, 0.02, 0.03, 0.04, 0.05];
const MULTIPLIERS  = [50, 100, 200, 300, 400, 500];

const UNIT_LABEL: Record<DTDurationUnit, string> = { t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours' };

// ─── Component ───────────────────────────────────────────────────────────────

const DTraderPage = observer(() => {
    // Engine instance lives across renders
    const engineRef = useRef<DTraderEngine | null>(null);
    if (engineRef.current === null) engineRef.current = new DTraderEngine();
    const engine = engineRef.current;

    // ── UI state ─────────────────────────────────────────────────────────────
    const [symbol, setSymbol] = useState<string>(() => {
        try { return localStorage.getItem('chart_active_symbol') || '1HZ100V'; } catch { return '1HZ100V'; }
    });
    const [categoryKey,   setCategoryKey]   = useState<CategoryKey>('rise_fall');
    const [contractType,  setContractType]  = useState<DTContractType>('CALL');
    const [durationUnit,  setDurationUnit]  = useState<DTDurationUnit>('t');
    const [durationValue, setDurationValue] = useState<number>(5);
    const [stake,         setStake]         = useState<number>(1);
    const [barrierOffset, setBarrierOffset] = useState<string>('+0.001');
    const [prediction,    setPrediction]    = useState<number>(5);
    const [growthRate,    setGrowthRate]    = useState<number>(0.03);
    const [multiplier,    setMultiplier]    = useState<number>(100);
    const [takeProfit,    setTakeProfit]    = useState<string>('');   // empty = none
    const [stopLoss,      setStopLoss]      = useState<string>('');

    // Symbol list: prefer live api_base.active_symbols (filtered to tradeable),
    // fall back to hand-curated list below.
    const symbols = useMemo<SymbolEntry[]>(() => {
        const live = (api_base as any)?.active_symbols as Array<any> | undefined;
        if (live && Array.isArray(live) && live.length > 0) {
            const mapped = live
                .filter(s => s && !s.is_trading_suspended && s.exchange_is_open !== 0)
                .map(s => ({
                    value: String(s.symbol),
                    label: String(s.display_name || s.symbol),
                    group: String(s.market_display_name || s.submarket_display_name || 'Other'),
                }));
            if (mapped.length) return mapped;
        }
        return FALLBACK_SYMBOLS;
    }, []);

    // Group symbols for the optgroup dropdown
    const groupedSymbols = useMemo(() => {
        const groups: Record<string, SymbolEntry[]> = {};
        for (const s of symbols) (groups[s.group] = groups[s.group] || []).push(s);
        return groups;
    }, [symbols]);

    // ── Live data ────────────────────────────────────────────────────────────
    const [status,    setStatus]    = useState<DTStatus>('idle');
    const [spot,      setSpot]      = useState<string>('—');
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [proposal,    setProposal]    = useState<DTProposal | null>(null);
    const [logs,        setLogs]        = useState<DTLog[]>([]);
    const [positions,   setPositions]   = useState<DTPosition[]>([]);
    const [feedback,    setFeedback]    = useState<DTBuyFeedback | null>(null);
    const [digitCounts, setDigitCounts] = useState<number[]>(() => new Array(10).fill(0));
    /** Rolling raw-price window — drives the live ACCU/MULT chart. */
    const [priceWindow, setPriceWindow] = useState<number[]>([]);
    /** Last settled digit contract — drives the ✅ / ❌ overlay on the
     *  exit-tick's circle in the digit analyzer. Auto-dismisses after 6s. */
    const [lastSettlement, setLastSettlement] =
        useState<{ digit: number; isWin: boolean } | null>(null);
    /** Full-screen popup for TP reached / SL hit / Cash-out successful. */
    const [popup, setPopup] =
        useState<(DTContractEvent & { seq: number }) | null>(null);
    const popupSeqRef     = useRef(0);
    // Tracks consecutive same-digit runs. Updated in onTick without causing
    // a full re-render on every tick — only triggers setState when the streak
    // starts (≥3) or resets.
    const streakRef       = useRef<{ digit: number | null; count: number }>({ digit: null, count: 0 });
    const [sameDigitStreak, setSameDigitStreak] =
        useState<{ digit: number; count: number } | null>(null);

    const category = useMemo(() => CATEGORIES.find(c => c.key === categoryKey)!, [categoryKey]);

    // Use reactive MobX store values — api_base.is_authorized and
    // api_base.account_info are plain fields (not observable), so reading
    // them directly inside an observer() component yields a stale snapshot.
    // client.is_logged_in and client.currency ARE observable and get updated
    // by CoreStoreProvider once auth completes, triggering a re-render here.
    const { client } = useStore();
    const isLoggedIn = client?.is_logged_in ?? false;
    const currency = client?.currency || 'USD';

    // ── Sync symbol from Charts tab whenever it changes ──────────────────────
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === 'chart_active_symbol' && e.newValue) {
                setSymbol(e.newValue);
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    // ── Wire engine callbacks once ───────────────────────────────────────────
    useEffect(() => {
        engine.onStatus   = setStatus;
        engine.onTick     = (s, d) => {
            setSpot(s);
            setLastDigit(d);
            if (d !== null) {
                const prev = streakRef.current;
                const next = { digit: d, count: prev.digit === d ? prev.count + 1 : 1 };
                streakRef.current = next;
                // Only trigger a render when crossing the ≥3 threshold or resetting
                setSameDigitStreak(prev => {
                    const show = next.count >= 3;
                    if (!show && prev === null) return null;
                    if (show && prev?.digit === next.digit && prev?.count === next.count) return prev;
                    return show ? { digit: next.digit!, count: next.count } : null;
                });
            }
        };
        engine.onProposal = p => setProposal(p);
        engine.onLog      = l => setLogs(prev => [...prev.slice(-99), l]);
        engine.onPosition = p => {
            setPositions(prev => {
                const idx = prev.findIndex(x => x.contractId === p.contractId);
                if (idx === -1) return [p, ...prev].slice(0, 30);
                const copy = prev.slice();
                copy[idx] = p;
                return copy;
            });
            // When a digit contract settles, surface the exit-tick digit in
            // the analyzer with a ✅ Won / ❌ Lost badge.
            if (!p.isOpen && p.isWin !== null && isDigitContract(p.contractType)) {
                const exitDigit = parseLastDigitFromSpot(p.exitSpot);
                if (exitDigit !== null) {
                    setLastSettlement({ digit: exitDigit, isWin: p.isWin });
                }
            }
        };
        engine.onBuyFeedback = f => setFeedback(f);
        engine.onDigitStats  = c => setDigitCounts(c);
        engine.onPriceWindow = p => setPriceWindow(p);
        engine.onContractEvent = e => {
            popupSeqRef.current += 1;
            setPopup({ ...e, seq: popupSeqRef.current });
        };

        return () => { engine.stop(); };
    }, [engine]);

    // Auto-dismiss popup after 8s so it never blocks the trader from
    // placing the next trade.
    useEffect(() => {
        if (!popup) return;
        const t = setTimeout(() => setPopup(null), 8_000);
        return () => clearTimeout(t);
    }, [popup]);

    // Find the first open ACCU/MULT position so we can render a big,
    // unmissable CASH OUT NOW button right above BUY.
    const sellableOpen = useMemo(
        () => positions.find(p => p.isOpen && canSellType(p.contractType)) || null,
        [positions],
    );

    // ── Barrier proximity (ACCU only) ─────────────────────────────────────
    // Returns 0–100 where 100 = price dead-centre, 0 = touching a barrier.
    // Used to drive the buy/cashout alert banner below the chart.
    const barrierProximity = useMemo((): number | null => {
        if (categoryKey !== 'accumulators') return null;
        const spotNum = parseFloat(spot);
        if (!isFinite(spotNum)) return null;

        // Live contract: real barriers
        if (sellableOpen && sellableOpen.highBarrier !== null && sellableOpen.lowBarrier !== null) {
            const hb = sellableOpen.highBarrier;
            const lb = sellableOpen.lowBarrier;
            const band = hb - lb;
            if (band <= 0) return null;
            const distNearest = Math.min(hb - spotNum, spotNum - lb);
            return Math.max(0, Math.min(100, (distNearest / (band / 2)) * 100));
        }

        // No open contract: use preview barriers from proposal
        if (proposal?.previewHighBarrier && proposal?.previewLowBarrier) {
            const hb = proposal.previewHighBarrier;
            const lb = proposal.previewLowBarrier;
            const band = hb - lb;
            if (band <= 0) return null;
            const distNearest = Math.min(hb - spotNum, spotNum - lb);
            return Math.max(0, Math.min(100, (distNearest / (band / 2)) * 100));
        }

        return null;
    }, [categoryKey, spot, sellableOpen, proposal]);

    // ── Tick-size analysis (ACCU only, from priceWindow) ─────────────────
    // Computes average absolute move per tick over the last 10 ticks, plus
    // the magnitude of the most recent tick. Used for countdown + spike logic.
    const tickAnalysis = useMemo(() => {
        if (categoryKey !== 'accumulators') return null;
        if (priceWindow.length < 2) return null;
        const slice = priceWindow.slice(-11);
        const moves: number[] = [];
        for (let i = 1; i < slice.length; i++) moves.push(Math.abs(slice[i] - slice[i - 1]));
        if (moves.length === 0) return null;
        const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
        return { avgTickMove: avg, lastTickMove: moves[moves.length - 1] };
    }, [categoryKey, priceWindow]);

    // ── Raw price distance to nearest barrier ─────────────────────────────
    const barrierDistPrice = useMemo((): number | null => {
        if (categoryKey !== 'accumulators') return null;
        const spotNum = parseFloat(spot);
        if (!isFinite(spotNum)) return null;
        let hb: number | null = null, lb: number | null = null;
        if (sellableOpen?.highBarrier != null && sellableOpen?.lowBarrier != null) {
            hb = sellableOpen.highBarrier; lb = sellableOpen.lowBarrier;
        } else if (proposal?.previewHighBarrier && proposal?.previewLowBarrier) {
            hb = proposal.previewHighBarrier; lb = proposal.previewLowBarrier;
        }
        if (hb === null || lb === null) return null;
        return Math.min(hb - spotNum, spotNum - lb);
    }, [categoryKey, spot, sellableOpen, proposal]);

    // ── Estimated ticks remaining before barrier breach ───────────────────
    // ticksToBarrier = distance ÷ average tick size.
    // Null if we don't have enough price history yet.
    const ticksToBarrier = useMemo((): number | null => {
        if (barrierDistPrice === null || !tickAnalysis) return null;
        if (tickAnalysis.avgTickMove <= 0) return null;
        return barrierDistPrice / tickAnalysis.avgTickMove;
    }, [barrierDistPrice, tickAnalysis]);

    // ── Spike detector ────────────────────────────────────────────────────
    // A "spike toward barrier" is when the last tick was ≥2× the recent
    // average AND it moved the price closer to the nearest barrier.
    // Uses priceWindow directly — no ref needed.
    const isSpikeTowardBarrier = useMemo((): boolean => {
        if (categoryKey !== 'accumulators') return false;
        if (!tickAnalysis || tickAnalysis.avgTickMove <= 0) return false;
        if (tickAnalysis.lastTickMove < tickAnalysis.avgTickMove * 2) return false;
        if (priceWindow.length < 2) return false;
        const spotNow  = priceWindow[priceWindow.length - 1];
        const spotPrev = priceWindow[priceWindow.length - 2];
        let hb: number | null = null, lb: number | null = null;
        if (sellableOpen?.highBarrier != null && sellableOpen?.lowBarrier != null) {
            hb = sellableOpen.highBarrier; lb = sellableOpen.lowBarrier;
        } else if (proposal?.previewHighBarrier && proposal?.previewLowBarrier) {
            hb = proposal.previewHighBarrier; lb = proposal.previewLowBarrier;
        }
        if (hb === null || lb === null) return false;
        const distNow  = Math.min(hb - spotNow,  spotNow  - lb);
        const distPrev = Math.min(hb - spotPrev, spotPrev - lb);
        return distNow < distPrev;
    }, [categoryKey, tickAnalysis, priceWindow, sellableOpen, proposal]);

    // ── Combined alert level ──────────────────────────────────────────────
    // Priority order:
    //   1. Spike toward barrier → instant danger (regardless of distance)
    //   2. Tick countdown ≤ 3  → danger
    //   3. Tick countdown ≤ 7  → warn
    //   4. Position fallback   → danger <45%, warn <65%, safe otherwise
    const barrierAlertLevel = useMemo((): 'safe' | 'warn' | 'danger' | null => {
        if (barrierProximity === null) return null;
        if (isSpikeTowardBarrier) return 'danger';
        if (ticksToBarrier !== null) {
            if (ticksToBarrier <= 3) return 'danger';
            if (ticksToBarrier <= 7) return 'warn';
            return barrierProximity < 65 ? 'warn' : 'safe';
        }
        // Fallback when priceWindow is too short to compute tick size
        if (barrierProximity < 45) return 'danger';
        if (barrierProximity < 65) return 'warn';
        return 'safe';
    }, [barrierProximity, ticksToBarrier, isSpikeTowardBarrier]);

    // Whether the current contract category cares about last-digit frequencies
    const showsDigitCard = category.needsPrediction || categoryKey === 'even_odd';

    // Rank-based color shading for the digit circles, recomputed only when
    // the counts actually change. Returns one of:
    //   'best'   — green  (most-frequent over the 1000 window)
    //   'good'   — blue   (second-most)
    //   'bad'    — yellow (second-least)
    //   'worst'  — red    (least-frequent)
    //   'plain'  — neutral
    const digitShades = useMemo<Array<'best'|'good'|'bad'|'worst'|'plain'>>(() => {
        const total = digitCounts.reduce((a, b) => a + b, 0);
        if (total === 0) return new Array(10).fill('plain');
        // Rank digits 0-9 by count, descending. Tie-break by digit so result
        // is stable when several digits have identical counts (early in
        // history seeding, that's likely).
        const ranked = digitCounts
            .map((c, d) => ({ d, c }))
            .sort((a, b) => b.c - a.c || a.d - b.d);
        const out: Array<'best'|'good'|'bad'|'worst'|'plain'> = new Array(10).fill('plain');
        out[ranked[0].d] = 'best';
        if (ranked.length > 1) out[ranked[1].d] = 'good';
        out[ranked[ranked.length - 1].d] = 'worst';
        if (ranked.length > 1) out[ranked[ranked.length - 2].d] = 'bad';
        return out;
    }, [digitCounts]);

    const digitTotal   = useMemo(() => digitCounts.reduce((a, b) => a + b, 0), [digitCounts]);
    const digitPercent = (d: number) =>
        digitTotal === 0 ? 0 : (digitCounts[d] / digitTotal) * 100;

    // ── Chi-square goodness-of-fit (df = 9) ──────────────────────────────────
    // Tests whether the observed digit distribution differs significantly from
    // a perfectly uniform distribution (10% per digit).
    //
    // χ² = Σ (observed − expected)² / expected,  expected = N/10 per digit
    //
    // Critical values for df = 9 (standard table):
    //   χ² ≥ 21.67  →  p < 0.01   (highly significant — strong edge)
    //   χ² ≥ 16.92  →  p < 0.05   (significant — real bias)
    //   χ² ≥ 14.68  →  p < 0.10   (marginal)
    //   χ² <  14.68 →  no detectable bias (uniform)
    //
    // Requires at least 30 ticks so the "expected ≥ 5 per cell" rule holds
    // with high probability (expected = 30/10 = 3 is borderline; 50+ is ideal).
    const chiSqStats = useMemo(() => {
        if (digitTotal < 30) return null;
        const expected = digitTotal / 10;
        const chiSq    = digitCounts.reduce((acc, obs) => {
            const diff = obs - expected;
            return acc + (diff * diff) / expected;
        }, 0);
        if (chiSq >= 21.67)
            return { chiSq, label: 'Highly biased — strong edge exists (p<0.01) ★★★', color: '#dc2626' };
        if (chiSq >= 16.92)
            return { chiSq, label: 'Significant bias — real edge (p<0.05) ★★',         color: '#ea580c' };
        if (chiSq >= 14.68)
            return { chiSq, label: 'Marginal bias detected (p<0.10) ★',                color: '#ca8a04' };
        return         { chiSq, label: 'Near-uniform — no detectable bias',             color: '#64748b' };
    }, [digitCounts, digitTotal]);

    // Winning-side digits for any currently OPEN digit contract — drives the
    // green ring around qualifying circles. Union across contracts in case
    // the user has stacked multiple open trades. Cleared automatically the
    // moment every open digit contract has settled.
    const winningDigits = useMemo<Set<number>>(() => {
        const set = new Set<number>();
        for (const p of positions) {
            if (!p.isOpen) continue;
            for (const d of digitsThatWin(p.contractType, p.barrier)) set.add(d);
        }
        return set;
    }, [positions]);

    // Auto-dismiss feedback after a few seconds (success faster than error)
    useEffect(() => {
        if (!feedback) return;
        const ms = feedback.kind === 'success' ? 3500 : 5500;
        const t = setTimeout(() => setFeedback(null), ms);
        return () => clearTimeout(t);
    }, [feedback]);

    // Auto-dismiss the settlement badge after 6s so the next contract has a
    // clean slate. Cleared sooner when the user fires a new tap-to-buy.
    useEffect(() => {
        if (!lastSettlement) return;
        const t = setTimeout(() => setLastSettlement(null), 6000);
        return () => clearTimeout(t);
    }, [lastSettlement]);

    // ── Build current config & start / patch engine ──────────────────────────
    const buildConfig = useCallback((): DTConfig => {
        const barrier = category.needsBarrier
            ? barrierOffset
            : category.needsPrediction
                ? String(prediction)
                : null;
        const tpNum = takeProfit.trim() ? parseFloat(takeProfit) : null;
        const slNum = stopLoss.trim()   ? parseFloat(stopLoss)   : null;
        return {
            symbol,
            contractType,
            durationValue,
            durationUnit,
            stake,
            barrier,
            currency,
            growthRate: category.needsGrowthRate ? growthRate : undefined,
            multiplier: category.needsMultiplier ? multiplier : undefined,
            takeProfit: (category.needsGrowthRate || category.needsMultiplier) ? tpNum : null,
            stopLoss:   category.needsMultiplier ? slNum : null,
        };
    }, [symbol, contractType, durationValue, durationUnit, stake, barrierOffset, prediction,
        growthRate, multiplier, takeProfit, stopLoss, category, currency]);

    // Start engine when logged in
    useEffect(() => {
        if (!isLoggedIn) return;
        if (status === 'idle') {
            engine.start(buildConfig());
        }
        // We intentionally don't restart on every cfg change — we patch instead.
    }, [isLoggedIn, engine, status, buildConfig]);

    // Push config patches whenever any input changes — only once the engine
    // is fully ready (avoids racing against the in-flight tick subscription
    // that is still being established during 'subscribing').
    useEffect(() => {
        if (status !== 'ready') return;
        engine.updateConfig(buildConfig());
    }, [engine, status, buildConfig]);

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleCategoryChange = (key: CategoryKey) => {
        const def = CATEGORIES.find(c => c.key === key)!;
        setCategoryKey(key);
        setContractType(def.options[0].type);
        // Reset SL/TP between contract types — leftover values are usually wrong
        setTakeProfit('');
        setStopLoss('');
        if (def.needsDuration) {
            const unit = def.units[0];
            setDurationUnit(unit);
            setDurationValue(def.minDuration[unit] ?? 1);
        }
        if (def.needsBarrier && def.barrierDefault) setBarrierOffset(def.barrierDefault);
    };

    const handleBuy   = () => engine.buy();
    const handleSell  = (contractId: string) => engine.sellContract(contractId);
    const handleClear    = () => { setLogs([]); setPositions(prev => prev.filter(p => p.isOpen)); };
    const handleClearAll = () => { setLogs([]); setPositions([]); };

    /**
     * Tap-to-buy for digit contracts. Switches contract type AND fires the
     * trade in one shot — the user clicks "Even" and we buy Even. For
     * Over/Under and Matches/Differs, the prediction digit is already part
     * of buildConfig so the engine sends e.g. `{contract_type: DIGITOVER,
     * barrier: '7'}` automatically.
     */
    const handleDirectionBuy = (type: DTContractType) => {
        setContractType(type);
        // Clear the previous contract's settlement badge — fresh slate.
        setLastSettlement(null);
        // Engine receives the new type + all current inputs (stake, barrier,
        // etc.) and arms the auto-buy on the next fresh proposal.
        const cfg = { ...buildConfig(), contractType: type };
        engine.placeBuyNow(cfg);
    };

    // ── Totals ───────────────────────────────────────────────────────────────
    const totals = useMemo(() => {
        let realised = 0, openPnl = 0, wins = 0, losses = 0, openCount = 0;
        for (const p of positions) {
            if (p.isOpen) {
                openCount += 1;
                openPnl   += p.profit ?? 0;
            } else {
                realised += p.profit ?? 0;
                if (p.isWin === true)  wins   += 1;
                if (p.isWin === false) losses += 1;
            }
        }
        return { realised, openPnl, wins, losses, openCount, total: realised + openPnl };
    }, [positions]);

    const [pnlAnim, setPnlAnim] = useState(false);
    const prevTotalRef = useRef<number>(0);
    useEffect(() => {
        if (totals.total !== prevTotalRef.current) {
            prevTotalRef.current = totals.total;
            setPnlAnim(true);
            const t = setTimeout(() => setPnlAnim(false), 320);
            return () => clearTimeout(t);
        }
    }, [totals.total]);

    // ── Rendering helpers ────────────────────────────────────────────────────

    const minDur = category.minDuration[durationUnit] ?? 1;
    const maxDur = category.maxDuration[durationUnit] ?? 10;

    const hasOpen = positions.some(p => p.isOpen);

    if (!isLoggedIn) {
        return (
            <div className='dtp__login-prompt'>
                <div className='dtp__login-icon'>🔐</div>
                <div className='dtp__login-title'>DTrader</div>
                <div className='dtp__login-msg'>
                    Log in to your account to place manual trades.
                </div>
            </div>
        );
    }

    return (
        <div className='dtp'>
            {/* ── Header: symbol + spot ───────────────────────────────────── */}
            <div className='dtp__header'>
                <div className='dtp__sym-wrap'>
                    <label className='dtp__lbl'>Symbol</label>
                    <select
                        className='dtp__sym-select'
                        value={symbol}
                        onChange={e => {
                            // Full engine stop → React batches this setStatus('idle')
                            // with setSymbol so the start effect restarts cleanly on
                            // the new market instead of racing through updateConfig.
                            engine.stop();
                            setSymbol(e.target.value);
                        }}
                    >
                        {Object.entries(groupedSymbols).map(([group, items]) => (
                            <optgroup key={group} label={group}>
                                {items.map(s => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </div>
                <div className='dtp__spot-wrap'>
                    <div className='dtp__spot-label'>Spot</div>
                    <div className='dtp__spot-value'>{spot}</div>
                    {lastDigit !== null && (
                        <div className='dtp__spot-digit'>{lastDigit}</div>
                    )}
                </div>

                {/* ── Session Total P/L chip ── */}
                <div className={`dtp__pnl-chip dtp__pnl-chip--${totals.total > 0 ? 'pos' : totals.total < 0 ? 'neg' : 'zero'}`}>
                    <span className='dtp__pnl-chip-label'>Session P/L</span>
                    <span className={`dtp__pnl-chip-val${pnlAnim ? ' dtp__pnl-chip-val--anim' : ''}`}>
                        {totals.total > 0 ? '+' : ''}{totals.total === 0 && positions.length === 0 ? '—' : `$${totals.total.toFixed(2)}`}
                    </span>
                </div>
            </div>

            {/* ── Body: form on left, ticket on right (stacks on mobile) ──── */}
            <div className='dtp__body'>
                <div className='dtp__form'>
                    {/* ── Digit-frequency analyzer — lives inside the form column
                        on desktop so it never pushes the buy ticket off-screen. ── */}
                    {showsDigitCard && (
                        <div className='dtp__digits-card'>
                            <div className='dtp__digits-head'>
                                <span>Last-digit frequency</span>
                                <span className='dtp__digits-sub'>over last {digitTotal || 0} ticks</span>
                            </div>
                            <div className='dtp__digits-grid'>
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => {
                                    const isSettleDigit = lastSettlement?.digit === d;
                                    return (
                                        <div
                                            key={d}
                                            className={`dtp__digit-cell dtp__digit-cell--${digitShades[d]} ${lastDigit === d ? 'dtp__digit-cell--current' : ''} ${winningDigits.has(d) ? 'dtp__digit-cell--winning' : ''}`}
                                            title={`${digitCounts[d]} of ${digitTotal} ticks ended in ${d}`}
                                        >
                                            <span className='dtp__digit-num'>{d}</span>
                                            <span className='dtp__digit-pct'>{digitPercent(d).toFixed(1)}%</span>
                                            {isSettleDigit && (
                                                <span className={`dtp__digit-result dtp__digit-result--${lastSettlement!.isWin ? 'win' : 'loss'}`}>
                                                    {lastSettlement!.isWin ? '✅ Won' : '❌ Lost'}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                                {lastDigit !== null && (
                                    <span
                                        className='dtp__digit-cursor'
                                        style={{
                                            ['--col' as any]: lastDigit % 5,
                                            ['--row' as any]: Math.floor(lastDigit / 5),
                                        }}
                                    />
                                )}
                            </div>
                            <div className='dtp__digits-legend'>
                                <span><span className='dtp__legend-dot dtp__legend-dot--best'/>most</span>
                                <span><span className='dtp__legend-dot dtp__legend-dot--good'/>2nd most</span>
                                <span><span className='dtp__legend-dot dtp__legend-dot--bad'/>2nd least</span>
                                <span><span className='dtp__legend-dot dtp__legend-dot--worst'/>least</span>
                            </div>
                            {chiSqStats ? (
                                <div className='dtp__chisq'>
                                    <span className='dtp__chisq-label'>χ² = {chiSqStats.chiSq.toFixed(2)}</span>
                                    <span className='dtp__chisq-verdict' style={{ color: chiSqStats.color }}>
                                        {chiSqStats.label}
                                    </span>
                                </div>
                            ) : digitTotal > 0 ? (
                                <div className='dtp__chisq dtp__chisq--waiting'>
                                    Collecting ticks for χ² significance test ({digitTotal}/30)…
                                </div>
                            ) : null}
                            {sameDigitStreak && (
                                <div className='dtp__streak'>
                                    🔥 Digit <strong>{sameDigitStreak.digit}</strong> repeated{' '}
                                    <strong>{sameDigitStreak.count}×</strong> in a row
                                </div>
                            )}
                        </div>
                    )}

                    {/* Category dropdown — replaces the old grid */}
                    <div className='dtp__field'>
                        <label className='dtp__lbl'>Trade type</label>
                        <select
                            className='dtp__cat-select'
                            value={categoryKey}
                            onChange={e => handleCategoryChange(e.target.value as CategoryKey)}
                        >
                            {CATEGORIES.map(c => (
                                <option key={c.key} value={c.key}>
                                    {c.emoji}  {c.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Direction toggle. For digit contracts (Over/Under,
                        Matches/Differs, Even/Odd), each direction button is a
                        one-tap BUY — there's no separate BUY button below.
                        For binary contracts, it's a normal toggle that just
                        sets contract type, with BUY at the bottom. */}
                    {category.options.length > 1 ? (
                        <div className='dtp__dir-row'>
                            {category.options.map(opt => {
                                const tapBuy = showsDigitCard;
                                const disabled = tapBuy && (status !== 'ready' || !isLoggedIn);
                                return (
                                    <button
                                        key={opt.type}
                                        className={`dtp__dir dtp__dir--${isUpType(opt.type) ? 'up' : 'down'} ${!tapBuy && contractType === opt.type ? 'dtp__dir--active' : ''} ${tapBuy ? 'dtp__dir--tap-buy' : ''}`}
                                        onClick={() => tapBuy ? handleDirectionBuy(opt.type) : setContractType(opt.type)}
                                        disabled={disabled}
                                    >
                                        <span className='dtp__dir-label'>{opt.label}</span>
                                        {tapBuy && (
                                            <span className='dtp__dir-stake'>
                                                ${stake.toFixed(2)}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className='dtp__dir-row'>
                            <div className='dtp__dir dtp__dir--up dtp__dir--active' style={{ cursor: 'default' }}>
                                {category.options[0].label}
                            </div>
                        </div>
                    )}

                    {/* Inputs grid */}
                    <div className='dtp__inputs'>
                        {/* Duration (binary only) */}
                        {category.needsDuration && (
                            <div className='dtp__field'>
                                <label className='dtp__lbl'>Duration</label>
                                <div className='dtp__field-row'>
                                    {durationUnit === 't' ? (
                                        /* Tick range: show a clean 1–10 dropdown */
                                        <select
                                            className='dtp__dur-select'
                                            value={durationValue}
                                            onChange={e => setDurationValue(Number(e.target.value))}
                                        >
                                            {Array.from({ length: maxDur - minDur + 1 }, (_, i) => i + minDur).map(n => (
                                                <option key={n} value={n}>
                                                    {n} {n === 1 ? 'tick' : 'ticks'}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        /* Seconds / minutes: keep free-form number input */
                                        <input
                                            type='number'
                                            className='dtp__input'
                                            value={durationValue}
                                            min={minDur}
                                            max={maxDur}
                                            onChange={e => {
                                                const v = parseInt(e.target.value, 10);
                                                if (!isNaN(v)) setDurationValue(Math.min(maxDur, Math.max(minDur, v)));
                                            }}
                                        />
                                    )}
                                    {/* Unit selector — hidden when only ticks available */}
                                    {category.units.length > 1 && (
                                        <select
                                            className='dtp__unit-select'
                                            value={durationUnit}
                                            onChange={e => {
                                                const u = e.target.value as DTDurationUnit;
                                                setDurationUnit(u);
                                                const lo = category.minDuration[u] ?? 1;
                                                const hi = category.maxDuration[u] ?? 10;
                                                setDurationValue(v => Math.min(hi, Math.max(lo, v)));
                                            }}
                                        >
                                            {category.units.map(u => (
                                                <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                <div className='dtp__hint'>{minDur}–{maxDur} {UNIT_LABEL[durationUnit]}</div>
                            </div>
                        )}

                        {/* Stake */}
                        <div className='dtp__field'>
                            <label className='dtp__lbl'>Stake ({currency})</label>
                            <input
                                type='number'
                                className='dtp__input'
                                step='0.01'
                                min={0.35}
                                value={stake}
                                onChange={e => {
                                    const v = parseFloat(e.target.value);
                                    if (!isNaN(v)) setStake(v);
                                }}
                            />
                            <div className='dtp__hint'>min 0.35</div>
                        </div>

                        {/* Barrier (Higher/Lower, Touch) */}
                        {category.needsBarrier && (
                            <div className='dtp__field'>
                                <label className='dtp__lbl'>Barrier (offset)</label>
                                <input
                                    type='text'
                                    className='dtp__input'
                                    value={barrierOffset}
                                    onChange={e => setBarrierOffset(e.target.value)}
                                />
                                <div className='dtp__hint'>e.g. +0.001 above spot, -0.001 below</div>
                            </div>
                        )}

                        {/* Growth rate (Accumulators) */}
                        {category.needsGrowthRate && (
                            <div className='dtp__field'>
                                <label className='dtp__lbl'>Growth rate</label>
                                <select
                                    className='dtp__input'
                                    value={growthRate}
                                    onChange={e => setGrowthRate(parseFloat(e.target.value))}
                                >
                                    {GROWTH_RATES.map(g => (
                                        <option key={g} value={g}>{(g * 100).toFixed(0)}%</option>
                                    ))}
                                </select>
                                <div className='dtp__hint'>Stake compounds every tick within range</div>
                            </div>
                        )}

                        {/* Multiplier (Multipliers) */}
                        {category.needsMultiplier && (
                            <div className='dtp__field'>
                                <label className='dtp__lbl'>Multiplier</label>
                                <select
                                    className='dtp__input'
                                    value={multiplier}
                                    onChange={e => setMultiplier(parseInt(e.target.value, 10))}
                                >
                                    {MULTIPLIERS.map(m => (
                                        <option key={m} value={m}>x{m}</option>
                                    ))}
                                </select>
                                <div className='dtp__hint'>Higher = more leverage, more risk</div>
                            </div>
                        )}

                        {/* Take profit (ACCU + MULT) */}
                        {(category.needsGrowthRate || category.needsMultiplier) && (
                            <div className='dtp__field'>
                                <label className='dtp__lbl'>Take profit ({currency}) — optional</label>
                                <input
                                    type='number'
                                    className='dtp__input'
                                    step='0.01'
                                    min={0}
                                    placeholder='leave empty for none'
                                    value={takeProfit}
                                    onChange={e => setTakeProfit(e.target.value)}
                                />
                            </div>
                        )}

                        {/* Stop loss (MULT only) */}
                        {category.needsMultiplier && (
                            <div className='dtp__field'>
                                <label className='dtp__lbl'>Stop loss ({currency}) — optional</label>
                                <input
                                    type='number'
                                    className='dtp__input'
                                    step='0.01'
                                    min={0}
                                    placeholder='leave empty for none'
                                    value={stopLoss}
                                    onChange={e => setStopLoss(e.target.value)}
                                />
                            </div>
                        )}

                        {/* ── Over / Under barrier selector ───────────────── */}
                        {categoryKey === 'over_under' && (() => {
                            const isOver = contractType === 'DIGITOVER';
                            const winCount = isOver ? (9 - prediction) : prediction;
                            const winPct   = winCount * 10;
                            return (
                                <div className='dtp__field dtp__field--full'>
                                    <label className='dtp__lbl'>Barrier digit</label>
                                    <div className='dtp__barrier-wrap'>
                                        <div className='dtp__barrier-pills'>
                                            {[0,1,2,3,4,5,6,7,8,9].map(d => {
                                                const isBarrier = d === prediction;
                                                const isWin = isOver ? d > prediction : d < prediction;
                                                return (
                                                    <button
                                                        key={d}
                                                        className={[
                                                            'dtp__barrier-pill',
                                                            isBarrier ? 'dtp__barrier-pill--barrier' : '',
                                                            !isBarrier && isWin  ? 'dtp__barrier-pill--win'  : '',
                                                            !isBarrier && !isWin ? 'dtp__barrier-pill--lose' : '',
                                                        ].join(' ')}
                                                        onClick={() => setPrediction(d)}
                                                        title={
                                                            isBarrier ? 'Barrier (not counted)' :
                                                            isWin ? `Digit ${d} → WIN` : `Digit ${d} → LOSE`
                                                        }
                                                    >
                                                        <span className='dtp__barrier-pill-num'>{d}</span>
                                                        {isBarrier && <span className='dtp__barrier-pill-tag'>barrier</span>}
                                                        {!isBarrier && <span className='dtp__barrier-pill-tag'>{isWin ? 'win' : 'lose'}</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className='dtp__barrier-zone'>
                                            <div className='dtp__barrier-win-bar'>
                                                <span style={{ width: `${winPct}%` }} />
                                            </div>
                                            <span className='dtp__barrier-prob'>
                                                {winCount} digit{winCount !== 1 ? 's' : ''} win · {winPct}%
                                            </span>
                                        </div>
                                        <div className='dtp__barrier-legend'>
                                            <span className='dtp__barrier-legend-item dtp__barrier-legend-item--win'>● win zone</span>
                                            <span className='dtp__barrier-legend-item dtp__barrier-legend-item--barrier'>● barrier</span>
                                            <span className='dtp__barrier-legend-item dtp__barrier-legend-item--lose'>● lose zone</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ── Matches / Differs digit picker ───────────────── */}
                        {categoryKey === 'matches_diff' && (
                            <div className='dtp__field dtp__field--full'>
                                <label className='dtp__lbl'>
                                    {contractType === 'DIGITMATCH' ? 'Match digit (last digit must equal)' : 'Differ digit (last digit must not equal)'}
                                </label>
                                <div className='dtp__digit-row'>
                                    {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                        <button
                                            key={d}
                                            className={`dtp__digit ${prediction === d ? 'dtp__digit--active' : ''}`}
                                            onClick={() => setPrediction(d)}
                                        >
                                            {d}
                                        </button>
                                    ))}
                                </div>
                                <div className='dtp__hint'>
                                    {contractType === 'DIGITMATCH'
                                        ? `Wins if last digit = ${prediction} · 10% chance`
                                        : `Wins if last digit ≠ ${prediction} · 90% chance`}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Live price chart with barrier overlay (ACCU + MULT) ── */}
                {(category.needsGrowthRate || category.needsMultiplier) && (
                    <AccuChart
                        prices={priceWindow}
                        position={sellableOpen}
                        proposal={proposal}
                        contractType={contractType}
                        multiplier={multiplier}
                        currency={currency}
                    />
                )}

                {/* ── Barrier proximity alert (ACCU only) ───────────────── */}
                {category.needsGrowthRate && barrierProximity !== null && barrierAlertLevel !== null && (
                    <div className={`dtp__barrier-alert dtp__barrier-alert--${barrierAlertLevel}`}>
                        <span className='dtp__barrier-alert-icon'>
                            {barrierAlertLevel === 'safe' ? '🟢' : barrierAlertLevel === 'warn' ? '🟡' : '🔴'}
                        </span>
                        <div className='dtp__barrier-alert-body'>
                            {/* Spike banner — shown above the normal message when detected */}
                            {isSpikeTowardBarrier && (
                                <span className='dtp__barrier-alert-spike'>
                                    ⚡ SPIKE toward barrier detected!
                                </span>
                            )}
                            <span className='dtp__barrier-alert-title'>
                                {barrierAlertLevel === 'safe' && (sellableOpen
                                    ? 'Price well centred — safe to hold'
                                    : '✅ Good time to BUY — price stable in safe zone')}
                                {barrierAlertLevel === 'warn' && (sellableOpen
                                    ? '⚠️ Barrier approaching — consider cashing out soon'
                                    : '⚠️ Price moving toward barrier — avoid buying now')}
                                {barrierAlertLevel === 'danger' && (sellableOpen
                                    ? '🚨 CASH OUT NOW — barrier breach imminent!'
                                    : '🚨 Do NOT buy — price too close to barrier!')}
                            </span>
                            {/* Tick countdown — the most actionable number */}
                            <span className='dtp__barrier-countdown'>
                                {ticksToBarrier !== null
                                    ? (ticksToBarrier <= 1
                                        ? '⚠️ Less than 1 tick to barrier!'
                                        : `~${Math.round(ticksToBarrier)} tick${Math.round(ticksToBarrier) === 1 ? '' : 's'} to barrier at current pace`)
                                    : `${barrierProximity.toFixed(0)}% gap remaining`}
                                {sellableOpen && barrierAlertLevel === 'danger' && ' — tap CASH OUT ↓'}
                                {!sellableOpen && barrierAlertLevel === 'safe' && ' — tap BUY ↓'}
                            </span>
                            <div className='dtp__barrier-bar'>
                                <div
                                    className='dtp__barrier-bar-fill'
                                    style={{ width: `${barrierProximity}%` }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Ticket (proposal + buy) ────────────────────────────── */}
                <div className='dtp__ticket'>
                    <div className='dtp__ticket-title'>Ticket</div>
                    <div className='dtp__ticket-row'>
                        <span className='dtp__ticket-key'>Payout</span>
                        <span className='dtp__ticket-val dtp__ticket-val--big'>
                            {proposal ? `${proposal.payout.toFixed(2)} ${currency}` : '—'}
                        </span>
                    </div>
                    <div className='dtp__ticket-row'>
                        <span className='dtp__ticket-key'>Profit</span>
                        <span className='dtp__ticket-val' style={{ color: '#10b981' }}>
                            {proposal
                                ? `+${proposal.profit.toFixed(2)} (${proposal.profitPct.toFixed(1)}%)`
                                : '—'}
                        </span>
                    </div>
                    <div className='dtp__ticket-row'>
                        <span className='dtp__ticket-key'>Cost</span>
                        <span className='dtp__ticket-val'>
                            {proposal ? `${proposal.askPrice.toFixed(2)} ${currency}` : '—'}
                        </span>
                    </div>
                    {proposal?.longcode && (
                        <div className='dtp__ticket-longcode'>{proposal.longcode}</div>
                    )}

                    {/* Prominent buy feedback — sits right above BUY so it's
                        impossible to miss on mobile, even with the log offscreen */}
                    {feedback && (
                        <div
                            key={feedback.seq}
                            className={`dtp__buy-feedback dtp__buy-feedback--${feedback.kind}`}
                            onClick={() => setFeedback(null)}
                        >
                            <span className='dtp__buy-feedback-icon'>
                                {feedback.kind === 'success' ? '✅' : '⚠️'}
                            </span>
                            <span className='dtp__buy-feedback-msg'>{feedback.message}</span>
                        </div>
                    )}

                    {/* Big prominent CASH OUT for any open ACCU/MULT — sits
                        right above BUY so it's impossible to miss. Shows the
                        live bid so the trader knows what they'd realize. */}
                    {sellableOpen && (
                        <button
                            className='dtp__cashout-btn'
                            onClick={() => handleSell(sellableOpen.contractId)}
                        >
                            <span className='dtp__cashout-icon'>💰</span>
                            <span className='dtp__cashout-text'>CASH OUT NOW</span>
                            <span className='dtp__cashout-amount'>
                                {sellableOpen.currentBid !== null
                                    ? `$${sellableOpen.currentBid.toFixed(2)}`
                                    : ''}
                                {sellableOpen.profit !== null && (
                                    <span
                                        className='dtp__cashout-pnl'
                                        style={{ color: sellableOpen.profit >= 0 ? '#bbf7d0' : '#fecaca' }}
                                    >
                                        {sellableOpen.profit >= 0 ? ' +' : ' '}
                                        ${sellableOpen.profit.toFixed(2)}
                                    </span>
                                )}
                            </span>
                        </button>
                    )}

                    {/* For digit contracts, BUY is replaced by the tap-to-buy
                        Even/Odd/Over/Under/Matches/Differs buttons above —
                        no extra BUY button needed. */}
                    {!showsDigitCard && (
                        <button
                            className='dtp__buy-btn'
                            onClick={handleBuy}
                            disabled={!proposal || status !== 'ready'}
                        >
                            {status === 'subscribing' && !proposal
                                ? 'Loading proposal…'
                                : `BUY  ${proposal ? `$${proposal.askPrice.toFixed(2)}` : ''}`}
                        </button>
                    )}
                    {showsDigitCard && (
                        <div className='dtp__tap-hint'>
                            Tap a direction button above to buy instantly
                        </div>
                    )}
                    {status === 'error' && (
                        <div className='dtp__ticket-err'>Engine error — see log</div>
                    )}
                </div>
            </div>

            {/* ── Totals row ────────────────────────────────────────────── */}
            <div className='dtp__totals'>
                <div className='dtp__totals-cell'>
                    <span className='dtp__totals-key'>Total P/L</span>
                    <span
                        className='dtp__totals-val dtp__totals-val--big'
                        style={{ color: totals.total >= 0 ? '#10b981' : '#ef4444' }}
                    >
                        {totals.total >= 0 ? '+' : ''}${totals.total.toFixed(2)}
                    </span>
                </div>
                <div className='dtp__totals-cell'>
                    <span className='dtp__totals-key'>Realised</span>
                    <span
                        className='dtp__totals-val'
                        style={{ color: totals.realised >= 0 ? '#10b981' : '#ef4444' }}
                    >
                        {totals.realised >= 0 ? '+' : ''}${totals.realised.toFixed(2)}
                    </span>
                </div>
                <div className='dtp__totals-cell'>
                    <span className='dtp__totals-key'>Open ({totals.openCount})</span>
                    <span
                        className='dtp__totals-val'
                        style={{ color: totals.openPnl >= 0 ? '#10b981' : '#ef4444' }}
                    >
                        {totals.openPnl >= 0 ? '+' : ''}${totals.openPnl.toFixed(2)}
                    </span>
                </div>
                <div className='dtp__totals-cell'>
                    <span className='dtp__totals-key'>W / L</span>
                    <span className='dtp__totals-val'>
                        <span style={{ color: '#10b981' }}>{totals.wins}</span>
                        {' / '}
                        <span style={{ color: '#ef4444' }}>{totals.losses}</span>
                    </span>
                </div>
            </div>

            {/* ── Positions + log ────────────────────────────────────────── */}
            <div className='dtp__lower'>
                <div className='dtp__positions'>
                    <div className='dtp__section-head'>
                        <span>Positions {hasOpen && <span className='dtp__live-dot'>● live</span>}</span>
                        <div className='dtp__clear-row'>
                            <button className='dtp__clear-btn' onClick={handleClear}>Clear settled</button>
                            <button className='dtp__clear-btn dtp__clear-btn--all' onClick={handleClearAll}>🗑 Clear all</button>
                        </div>
                    </div>
                    {positions.length === 0 ? (
                        <div className='dtp__empty'>No positions yet — pick a contract and press BUY.</div>
                    ) : (
                        <div className='dtp__pos-list'>
                            {positions.map(p => {
                                const cls = !p.isOpen
                                    ? (p.isWin ? 'dtp__pos--win' : 'dtp__pos--loss')
                                    : 'dtp__pos--open';
                                return (
                                    <div key={p.contractId} className={`dtp__pos ${cls}`}>
                                        <div className='dtp__pos-row1'>
                                            <span className='dtp__pos-type'>{shortLabel(p.contractType)}</span>
                                            <span className='dtp__pos-sym'>{p.symbol}</span>
                                            <span className='dtp__pos-stake'>${p.stake.toFixed(2)}</span>
                                        </div>
                                        <div className='dtp__pos-row2'>
                                            {p.entrySpot && (
                                                <span className='dtp__pos-prices'>
                                                    {p.entrySpot} {(p.exitSpot || p.currentSpot) && '→ '}
                                                    {p.exitSpot ?? p.currentSpot ?? ''}
                                                </span>
                                            )}
                                            <span
                                                className='dtp__pos-pnl'
                                                style={{
                                                    color: (p.profit ?? 0) >= 0 ? '#10b981' : '#ef4444',
                                                }}
                                            >
                                                {p.profit !== null
                                                    ? `${(p.profit) >= 0 ? '+' : ''}$${p.profit.toFixed(2)}`
                                                    : '…'}
                                            </span>
                                        </div>
                                        <div className='dtp__pos-row3'>
                                            <span className='dtp__pos-time'>{p.purchaseTime}</span>
                                            <span className='dtp__pos-status'>
                                                {p.isOpen
                                                    ? (canSellType(p.contractType)
                                                        ? <button
                                                            className='dtp__sell-btn'
                                                            onClick={() => handleSell(p.contractId)}
                                                          >Sell</button>
                                                        : 'open')
                                                    : (p.isWin ? '✅ won' : '❌ lost')}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className='dtp__log'>
                    <div className='dtp__section-head'><span>Activity log</span></div>
                    {logs.length === 0 ? (
                        <div className='dtp__empty'>No activity yet.</div>
                    ) : (
                        <div className='dtp__log-list'>
                            {logs.slice().reverse().map(l => (
                                <div key={l.seq} className={`dtp__log-line dtp__log-line--${l.type}`}>
                                    <span className='dtp__log-time'>{l.time}</span>
                                    <span className='dtp__log-msg'>{l.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Full-screen popup: TP reached / SL hit / Cash-out 🏆 ── */}
            {popup && (
                <div
                    className='dtp__popup-backdrop'
                    onClick={() => setPopup(null)}
                    role='dialog'
                    aria-modal='true'
                >
                    <div
                        className={`dtp__popup dtp__popup--${popup.kind}`}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className='dtp__popup-emoji'>
                            {popup.kind === 'cashout' ? '🏆💪'
                              : popup.kind === 'tp'   ? '🎯'
                              :                          '🛑'}
                        </div>
                        <div className='dtp__popup-title'>
                            {popup.kind === 'cashout' ? 'Cash out successful'
                              : popup.kind === 'tp'   ? 'Take Profit reached'
                              :                          'Stop Loss hit'}
                        </div>
                        <div className='dtp__popup-subtitle'>
                            {shortLabel(popup.contractType)} · #{popup.contractId}
                        </div>
                        <div
                            className='dtp__popup-profit'
                            style={{ color: popup.profit >= 0 ? '#10b981' : '#ef4444' }}
                        >
                            {popup.profit >= 0 ? 'Total profit' : 'Total loss'}
                            <div className='dtp__popup-amount'>
                                {popup.profit >= 0 ? '+' : ''}
                                ${popup.profit.toFixed(2)} {currency}
                            </div>
                        </div>
                        <button
                            className='dtp__popup-btn'
                            onClick={() => setPopup(null)}
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

// ─── Live price chart with Accumulators-style barrier overlay ────────────
// Renders the rolling price window as an SVG line. When an ACCU contract
// is open we overlay the upper / lower barrier lines, tint the safe band
// in light blue, and flash a red "BARRIER BROKEN" badge the moment a
// tick steps outside the band. Profit / loss appears on the right rail.
const AccuChart: React.FC<{
    prices:       number[];
    position:     DTPosition | null;
    proposal:     DTProposal | null;
    contractType: DTContractType;
    multiplier:   number;
    currency:     string;
}> = React.memo(({ prices, position, proposal, contractType, multiplier, currency }) => {
    const W = 320, H = 160, PAD_L = 8, PAD_R = 56, PAD_T = 10, PAD_B = 14;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;

    // Pull last N points so the chart never gets too dense
    const data = prices.length > 80 ? prices.slice(prices.length - 80) : prices;
    const last = data.length > 0 ? data[data.length - 1] : null;

    const hasContract = !!position;
    const isAccuType  = contractType === 'ACCU';
    const isMultType  = contractType === 'MULTUP' || contractType === 'MULTDOWN';

    // ── PREVIEW barriers (shown when no contract is open so the trader
    //    can see exactly where ACCU walls / MULT stop-out will sit at
    //    entry, and time their buy on a quiet candle).
    //    Falls back to a synthetic ±0.04% band on the live spot when the
    //    proposal hasn't returned contract_details yet, so SOMETHING is
    //    always visible — never an empty rectangle.
    let previewHi: number | null = null;
    let previewLo: number | null = null;
    let previewSO: number | null = null;
    if (!hasContract) {
        const refSpot = proposal?.spotNum ?? last;
        if (isAccuType) {
            previewHi = proposal?.previewHighBarrier ?? (refSpot !== null ? refSpot * 1.0004 : null);
            previewLo = proposal?.previewLowBarrier  ?? (refSpot !== null ? refSpot * 0.9996 : null);
        } else if (isMultType) {
            // Stop-out ≈ 1/multiplier away from entry, opposite to direction
            const mult = multiplier > 0 ? multiplier : 100;
            if (proposal?.previewStopOut !== null && proposal?.previewStopOut !== undefined) {
                previewSO = proposal.previewStopOut;
            } else if (refSpot !== null) {
                const dist = refSpot * (1 / mult) * 0.95; // ~stake-out distance
                previewSO = contractType === 'MULTUP' ? refSpot - dist : refSpot + dist;
            }
        }
    }

    // Y-axis range — include barriers, entry spot, stop-out, TP/SL so
    // they're never clipped off-screen. Includes preview values too.
    const candidates: number[] = data.slice();
    const pushIf = (v: number | null | undefined) => {
        if (v !== null && v !== undefined && Number.isFinite(v)) candidates.push(v);
    };
    pushIf(position?.highBarrier);
    pushIf(position?.lowBarrier);
    pushIf(position?.entrySpotNum);
    pushIf(position?.stopOutLevel);
    pushIf(position?.takeProfitLevel);
    pushIf(position?.stopLossLevel);
    pushIf(previewHi);
    pushIf(previewLo);
    pushIf(previewSO);
    const minV = candidates.length ? Math.min(...candidates) : 0;
    const maxV = candidates.length ? Math.max(...candidates) : 1;
    // 8% padding above/below so the line never hugs the edge
    const span = (maxV - minV) || Math.max(1, Math.abs(maxV) * 0.0001);
    const lo   = minV - span * 0.08;
    const hi   = maxV + span * 0.08;
    const range = hi - lo || 1;

    const yOf = (v: number) => PAD_T + (1 - (v - lo) / range) * innerH;
    const xOf = (i: number) => PAD_L + (data.length <= 1 ? innerW : (i / (data.length - 1)) * innerW);

    const linePath = data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(p).toFixed(2)}`).join(' ');
    const areaPath = data.length
        ? `${linePath} L ${xOf(data.length - 1).toFixed(2)} ${(PAD_T + innerH).toFixed(2)} L ${PAD_L.toFixed(2)} ${(PAD_T + innerH).toFixed(2)} Z`
        : '';

    const hb = position?.highBarrier ?? null;
    const lb = position?.lowBarrier  ?? null;
    const es = position?.entrySpotNum ?? null;
    const so = position?.stopOutLevel ?? null;
    const tp = position?.takeProfitLevel ?? null;
    const sl = position?.stopLossLevel   ?? null;
    const isMult = position?.contractType === 'MULTUP' || position?.contractType === 'MULTDOWN';
    const broken    = position?.barrierBroken ?? false;
    const profit    = position?.profit ?? null;
    const inProfit  = profit !== null && profit >= 0;

    // ── HIGH-CONTRAST PALETTE ───────────────────────────────────────
    // Chart background is dark navy (#0b1220 via SCSS); previously the
    // line was rendered in #0f172a which made it nearly invisible.
    // These colors are tuned for both dark and light themes.
    const COL_GRID    = 'rgba(148,163,184,0.35)';   // slate, low-emphasis
    const COL_LINE    = '#fbbf24';                  // amber — pops on dark
    const COL_AREA    = 'rgba(251,191,36,0.18)';
    const COL_BARRIER = broken ? '#f87171' : '#60a5fa';   // bright blue / red
    const COL_PREVIEW = '#94a3b8';                  // dashed slate (preview)
    const COL_ENTRY   = '#cbd5e1';
    const COL_SO      = '#f87171';
    const COL_TP      = '#34d399';
    const COL_SL      = '#fbbf24';
    const COL_DOT     = broken ? '#f87171' : (inProfit ? '#34d399' : '#fbbf24');

    // Y-axis tick labels (top, mid, bottom)
    const ticks = [hi, (hi + lo) / 2, lo];
    const decimals = Math.max(2, Math.min(5, Math.round(-Math.log10(Math.max(span, 1e-9))) + 2));
    const fmt = (v: number) => v.toFixed(decimals);

    return (
        <div className={`dtp__accu-chart ${broken ? 'dtp__accu-chart--broken' : ''}`}>
            <div className='dtp__accu-chart-head'>
                <span className='dtp__accu-chart-title'>📈 Live price</span>
                {hasContract ? (
                    <span
                        className='dtp__accu-chart-pnl'
                        style={{ color: inProfit ? '#34d399' : '#f87171' }}
                    >
                        {inProfit ? '+' : ''}${(profit ?? 0).toFixed(2)} {currency}
                    </span>
                ) : (
                    <span className='dtp__accu-chart-hint'>
                        {isAccuType ? '👀 Preview barriers (live)' : isMultType ? '👀 Preview stop-out (live)' : 'Live price'}
                    </span>
                )}
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className='dtp__accu-chart-svg' preserveAspectRatio='none'>
                {/* gridlines */}
                {ticks.map((t, i) => (
                    <line
                        key={`g${i}`}
                        x1={PAD_L} x2={W - PAD_R}
                        y1={yOf(t)} y2={yOf(t)}
                        stroke={COL_GRID} strokeWidth={1} strokeDasharray='2 4'
                    />
                ))}

                {/* PREVIEW band — visible BEFORE buying so the trader sees
                    where ACCU walls / MULT stop-out will sit at entry */}
                {!hasContract && previewHi !== null && previewLo !== null && (
                    <rect
                        x={PAD_L} width={innerW}
                        y={yOf(previewHi)} height={Math.max(0, yOf(previewLo) - yOf(previewHi))}
                        fill='rgba(96,165,250,0.10)'
                        stroke='rgba(96,165,250,0.35)'
                        strokeDasharray='3 3'
                    />
                )}

                {/* safe band between barriers (live contract) */}
                {hasContract && hb !== null && lb !== null && (
                    <rect
                        x={PAD_L} width={innerW}
                        y={yOf(hb)} height={Math.max(0, yOf(lb) - yOf(hb))}
                        fill={broken ? 'rgba(248,113,113,0.18)' : 'rgba(96,165,250,0.16)'}
                    />
                )}

                {/* price area + line — bright amber, pops on dark navy bg */}
                {data.length > 0 && (
                    <>
                        <path d={areaPath} fill={COL_AREA} />
                        <path
                            d={linePath} stroke={COL_LINE} strokeWidth={2}
                            fill='none' strokeLinecap='round' strokeLinejoin='round'
                        />
                    </>
                )}

                {/* PREVIEW barrier lines (dashed slate, no contract yet) */}
                {!hasContract && previewHi !== null && (
                    <>
                        <line
                            x1={PAD_L} x2={W - PAD_R}
                            y1={yOf(previewHi)} y2={yOf(previewHi)}
                            stroke={COL_PREVIEW} strokeWidth={1.5} strokeDasharray='5 4'
                        />
                        <text x={W - PAD_R + 4} y={yOf(previewHi) + 3}
                            fontSize='10' fill={COL_PREVIEW} fontWeight='700'>
                            ↑{fmt(previewHi)}
                        </text>
                    </>
                )}
                {!hasContract && previewLo !== null && (
                    <>
                        <line
                            x1={PAD_L} x2={W - PAD_R}
                            y1={yOf(previewLo)} y2={yOf(previewLo)}
                            stroke={COL_PREVIEW} strokeWidth={1.5} strokeDasharray='5 4'
                        />
                        <text x={W - PAD_R + 4} y={yOf(previewLo) + 3}
                            fontSize='10' fill={COL_PREVIEW} fontWeight='700'>
                            ↓{fmt(previewLo)}
                        </text>
                    </>
                )}
                {!hasContract && previewSO !== null && (
                    <>
                        <line
                            x1={PAD_L} x2={W - PAD_R}
                            y1={yOf(previewSO)} y2={yOf(previewSO)}
                            stroke={COL_SO} strokeWidth={1.5} strokeDasharray='4 3' opacity={0.7}
                        />
                        <text x={W - PAD_R + 4} y={yOf(previewSO) + 3}
                            fontSize='10' fill={COL_SO} fontWeight='800' opacity={0.85}>
                            SO {fmt(previewSO)}
                        </text>
                    </>
                )}

                {/* entry spot marker */}
                {hasContract && es !== null && (
                    <line
                        x1={PAD_L} x2={W - PAD_R}
                        y1={yOf(es)} y2={yOf(es)}
                        stroke={COL_ENTRY} strokeWidth={1} strokeDasharray='1 3'
                    />
                )}

                {/* barrier lines (live contract) */}
                {hasContract && hb !== null && (
                    <>
                        <line
                            x1={PAD_L} x2={W - PAD_R}
                            y1={yOf(hb)} y2={yOf(hb)}
                            stroke={COL_BARRIER} strokeWidth={2}
                        />
                        <text x={W - PAD_R + 4} y={yOf(hb) + 3}
                            fontSize='10' fill={COL_BARRIER} fontWeight='700'>
                            {fmt(hb)}
                        </text>
                    </>
                )}
                {hasContract && lb !== null && (
                    <>
                        <line
                            x1={PAD_L} x2={W - PAD_R}
                            y1={yOf(lb)} y2={yOf(lb)}
                            stroke={COL_BARRIER} strokeWidth={2}
                        />
                        <text x={W - PAD_R + 4} y={yOf(lb) + 3}
                            fontSize='10' fill={COL_BARRIER} fontWeight='700'>
                            {fmt(lb)}
                        </text>
                    </>
                )}

                {/* MULT live overlays: stop-out, take-profit, stop-loss */}
                {hasContract && isMult && so !== null && (
                    <>
                        <line
                            x1={PAD_L} x2={W - PAD_R}
                            y1={yOf(so)} y2={yOf(so)}
                            stroke={COL_SO} strokeWidth={2} strokeDasharray='4 3'
                        />
                        <text x={W - PAD_R + 4} y={yOf(so) + 3}
                            fontSize='10' fill={COL_SO} fontWeight='800'>
                            SO {fmt(so)}
                        </text>
                    </>
                )}
                {hasContract && isMult && tp !== null && (
                    <>
                        <line
                            x1={PAD_L} x2={W - PAD_R}
                            y1={yOf(tp)} y2={yOf(tp)}
                            stroke={COL_TP} strokeWidth={2} strokeDasharray='4 3'
                        />
                        <text x={W - PAD_R + 4} y={yOf(tp) + 3}
                            fontSize='10' fill={COL_TP} fontWeight='800'>
                            TP {fmt(tp)}
                        </text>
                    </>
                )}
                {hasContract && isMult && sl !== null && (
                    <>
                        <line
                            x1={PAD_L} x2={W - PAD_R}
                            y1={yOf(sl)} y2={yOf(sl)}
                            stroke={COL_SL} strokeWidth={2} strokeDasharray='4 3'
                        />
                        <text x={W - PAD_R + 4} y={yOf(sl) + 3}
                            fontSize='10' fill={COL_SL} fontWeight='800'>
                            SL {fmt(sl)}
                        </text>
                    </>
                )}

                {/* live price dot + right-rail label */}
                {last !== null && data.length > 0 && (
                    <>
                        <circle
                            cx={xOf(data.length - 1)} cy={yOf(last)} r={4}
                            fill={COL_DOT}
                            stroke='#0b1220' strokeWidth={1.5}
                        />
                        <rect
                            x={W - PAD_R + 1} y={yOf(last) - 8}
                            width={PAD_R - 4} height={16}
                            rx={3}
                            fill='#0b1220' stroke={COL_LINE} strokeWidth={1}
                        />
                        <text
                            x={W - PAD_R + (PAD_R - 4) / 2 + 1} y={yOf(last) + 4}
                            fontSize='10' fill={COL_LINE} fontWeight='800'
                            textAnchor='middle'
                        >
                            {fmt(last)}
                        </text>
                    </>
                )}
            </svg>

            {/* Breach banner — flashes the moment a tick falls outside the band */}
            {hasContract && broken && (
                <div className='dtp__accu-chart-breach'>
                    🛑 BARRIER BROKEN — contract will close as a loss
                </div>
            )}
        </div>
    );
});
AccuChart.displayName = 'AccuChart';

function shortLabel(t: DTContractType): string {
    switch (t) {
        case 'CALL':       return 'RISE / HIGHER';
        case 'PUT':        return 'FALL / LOWER';
        case 'ONETOUCH':   return 'TOUCH';
        case 'NOTOUCH':    return 'NO TOUCH';
        case 'DIGITMATCH': return 'MATCHES';
        case 'DIGITDIFF':  return 'DIFFERS';
        case 'DIGITOVER':  return 'OVER';
        case 'DIGITUNDER': return 'UNDER';
        case 'DIGITEVEN':  return 'EVEN';
        case 'DIGITODD':   return 'ODD';
        case 'ACCU':       return 'ACCUMULATOR';
        case 'MULTUP':     return 'MULTIPLIER UP';
        case 'MULTDOWN':   return 'MULTIPLIER DOWN';
        default:           return t;
    }
}

// "Up" direction (green) vs "Down" (red) for the direction toggle styling
function isUpType(t: DTContractType): boolean {
    return t === 'CALL' || t === 'ONETOUCH' || t === 'DIGITMATCH'
        || t === 'DIGITOVER' || t === 'DIGITEVEN' || t === 'ACCU' || t === 'MULTUP';
}

// Contracts the user can close early (everything else settles automatically)
function canSellType(t: DTContractType): boolean {
    return t === 'ACCU' || t === 'MULTUP' || t === 'MULTDOWN';
}

// Digit-based contracts — drive the analyzer card + tap-to-buy direction row
function isDigitContract(t: DTContractType): boolean {
    return t === 'DIGITMATCH' || t === 'DIGITDIFF'
        || t === 'DIGITOVER'  || t === 'DIGITUNDER'
        || t === 'DIGITEVEN'  || t === 'DIGITODD';
}

// Pull the last digit out of an exit-spot display string (e.g. "1379.55" → 5)
function parseLastDigitFromSpot(spot: string | null | undefined): number | null {
    if (!spot) return null;
    const m = String(spot).match(/(\d)\D*$/);
    return m ? parseInt(m[1], 10) : null;
}

// Which last-digits would WIN this digit contract — used to ring the
// winning-side circles in green while the contract is open.
//   OVER  7 → {8, 9}
//   UNDER 7 → {0..6}
//   MATCH 5 → {5}
//   DIFF  5 → {0,1,2,3,4,6,7,8,9}
//   EVEN    → {0,2,4,6,8}
//   ODD     → {1,3,5,7,9}
function digitsThatWin(t: DTContractType, barrier: string | null): number[] {
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const b   = barrier !== null && barrier !== '' ? parseInt(barrier, 10) : NaN;
    switch (t) {
        case 'DIGITOVER':  return Number.isFinite(b) ? all.filter(d => d > b) : [];
        case 'DIGITUNDER': return Number.isFinite(b) ? all.filter(d => d < b) : [];
        case 'DIGITMATCH': return Number.isFinite(b) ? [b] : [];
        case 'DIGITDIFF':  return Number.isFinite(b) ? all.filter(d => d !== b) : [];
        case 'DIGITEVEN':  return [0, 2, 4, 6, 8];
        case 'DIGITODD':   return [1, 3, 5, 7, 9];
        default: return [];
    }
}

DTraderPage.displayName = 'DTraderPage';
export default DTraderPage;

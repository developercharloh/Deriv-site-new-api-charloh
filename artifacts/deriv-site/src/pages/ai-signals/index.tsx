// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X, Zap, RefreshCw, PlayCircle } from '@/utils/lucide-shim';
import { DERIV_VOLATILITIES, type DerivVolatility } from '@/utils/deriv-volatilities';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { destroyerBotIdFromDirection, fetchAndPatchBot, type BotSignal } from '@/utils/bot-patch';
import '@/components/ai-signal-orb/ai-signal-orb.scss';
import './ai-signals-page.scss';

const ORB_RUN_CFG_KEY = 'orb_destroyer_cfg';
interface OrbRunConfig { stake: string; takeProfit: string; stopLoss: string; martingale: string; martingaleOn: boolean; eoRecovery: boolean; }
const DEFAULT_RUN_CFG: OrbRunConfig = { stake: '0.5', takeProfit: '10', stopLoss: '30', martingale: '1.5', martingaleOn: true, eoRecovery: false };
type RunState = 'idle' | 'launching' | 'no-ws' | 'error';

// ─── Constants ────────────────────────────────────────────────────────────────
const DERIV_WS         = 'wss://ws.derivws.com/websockets/v3?app_id=1';
const TICK_COUNT_LONG  = 5000;
const ALL_SYMS         = DERIV_VOLATILITIES;
const MIN_VOTES        = 6;
const WATCH_INTERVAL_S = 90;

function getSymbolMinVotes(symCode: string): number {
    if (symCode.includes('75') || symCode.includes('100')) return 7;
    if (symCode.endsWith('10V') || symCode.endsWith('25V') ||
        symCode.includes('_10') || symCode.includes('_25')) return 5;
    return 6;
}
const MIN_WIN_PROB_OU  = 0.60;
const DERIV_STATUS_URL = 'https://status.deriv.systems/api/v2/status.json';
const STATUS_POLL_MS   = 60_000;
const GAP_THRESHOLD_S  = 120;
const REGIME_DIV_LIMIT = 0.08;
const SPIKE_SIGMA      = 3.0;
const SPIKE_LOOKBACK   = 200;

type TradeType = 'over_under' | 'even_odd' | 'matches_differs';
type ScanState = 'idle' | 'scanning' | 'done' | 'no-signal';
type StatusIndicator = 'none' | 'minor' | 'major' | 'critical';
type TrendDir = 'rising' | 'flat' | 'falling';

interface ModelResult { name: string; vote: boolean; score: number; }
interface ModelVotes {
    chiSquared: ModelResult; bayesian: ModelResult; momentum: ModelResult;
    stability: ModelResult; recentEdge: ModelResult;
    markov: ModelResult; linearTrend: ModelResult; entropy: ModelResult;
    ngram: ModelResult; quartile: ModelResult;
    yesCount: number; totalScore: number;
}

// ─── New stats-driven checks (replace model voting) ──────────────────────────
interface StatsChecks {
    rawWinRate:   { pass: boolean; rate30: number; rate60: number; rate100: number; }
    crossWindow:  { pass: boolean; rate500: number; rate1k: number; rate3k: number; }
    streak:       { pass: boolean; length: number; }
    autocorr:     { pass: boolean; acf1: number; }
    stability:    { pass: boolean; windowsAbove: number; trend: TrendDir; }
    entryOverdue: { pass: boolean; overdueRatio: number; }
    leadDigit:    { pass: boolean; topWinDigit: number; margin: number; stableBands: number; } | null;
    sideMomentum: { pass: boolean; bandRates: number[]; trend: TrendDir; longTermOk: boolean; } | null;
    freqAlignment: { pass: boolean; windows: { size: number; winPct: number; dominant: boolean }[]; allAgree: boolean; alignScore: number } | null;
    microConfirm:  { pass: boolean; last2Wins: number; last2: boolean[] } | null;
    /** Check 11 — digit position dominance (EO + OU only) */
    digitDominance: {
        pass: boolean;
        mostOnWin: boolean;   // most-appearing digit is on winning side
        leastOnWin: boolean;  // least OR 2nd-least appearing digit is on winning side
        secondOnWin: boolean; // 2nd most-appearing digit is on winning side (EO)
        losingCapOk: boolean; // every losing-side digit stays below 10% / 10.3% cap
        winTrend: TrendDir;   // winning-side freq trend across time bands (OU)
        lossTrend: TrendDir;  // losing-side freq trend across time bands (OU)
    } | null;
    passCount: number; totalChecks: number; isSignal: boolean;
}

interface RecoveryOption {
    side: 'OVER' | 'UNDER';
    barrier: number;
    /** Win rate across the 1 000-tick window (most representative for display) */
    winPct: number;
    theoExp: number;
    /** Number of the four windows (50/100/500/1 000) that beat theoretical expectation */
    windowsPass: number;
    safety: 'safe' | 'marginal' | 'unsafe';
    isAiPick: boolean;
}

interface MarketResult {
    sym: DerivVolatility; direction: string; contractType: string;
    barrier: number | null; recoveryBarrier: number | null;
    recoveryContractType: string | null; recoveryDirection: string | null;
    winProb: number; sampleSize: number; votes: ModelVotes;
    recoveryOptions: RecoveryOption[]; noRecoveryRecommended: boolean;
    entryDigits: { digit: number; recommended: boolean; conditional: number; freqPct: number; avgWaitTicks: number; skipAdjustedWait: number }[];
    segmentAgrees: boolean; signalStrength: number; pip: number;
    regimeScore: number; regimeOk: boolean; gapDetected: boolean; tfAgreement: number;
    statsChecks: StatsChecks;
    recentDominance: {
        last20WinPct: number; last50WinPct: number;
        winsLast20: number; winsLast50: number; last20Results: boolean[];
        isHot: boolean; isCold: boolean;
        label: 'DOMINANT' | 'ACTIVE' | 'NEUTRAL' | 'COOLING' | 'REVERSED';
    };
}
interface OrbHistoryEntry { market: string; direction: string; votes: number; strength: number; time: number; }
interface SpikeInfo { code: string; label: string; sigma: number; }
interface DerivStatusResult { indicator: StatusIndicator; description: string; fetchedAt: number; }

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function jsDiv(pA: number[], pB: number[]): number {
    const m = pA.map((p, i) => (p + pB[i]) / 2);
    let jsd = 0;
    for (let i = 0; i < 10; i++) {
        if (pA[i] > 0 && m[i] > 0) jsd += pA[i] * Math.log2(pA[i] / m[i]);
        if (pB[i] > 0 && m[i] > 0) jsd += pB[i] * Math.log2(pB[i] / m[i]);
    }
    return jsd / 2;
}
function detectGap(times: number[]): { gapDetected: boolean; maxGapSecs: number } {
    if (times.length < 2) return { gapDetected: false, maxGapSecs: 0 };
    const recent = times.slice(-500);
    let maxGap = 0;
    for (let i = 1; i < recent.length; i++) { const gap = recent[i] - recent[i - 1]; if (gap > maxGap) maxGap = gap; }
    return { gapDetected: maxGap >= GAP_THRESHOLD_S, maxGapSecs: maxGap };
}
async function fetchDerivStatus(): Promise<DerivStatusResult> {
    try {
        const res = await fetch(DERIV_STATUS_URL, { cache: 'no-store' });
        const json = await res.json();
        return { indicator: (json?.status?.indicator ?? 'none') as StatusIndicator, description: json?.status?.description ?? 'Unknown', fetchedAt: Date.now() };
    } catch { return { indicator: 'none', description: 'Status check failed', fetchedAt: Date.now() }; }
}
function digitFreqArr(prices: number[], pip: number): number[] {
    const f = new Array(10).fill(0);
    for (const p of prices) f[lastDigitOf(p, pip)]++;
    return f.map(v => v / prices.length);
}
function detectSpike(prices: number[]): { spiked: boolean; sigma: number } {
    if (prices.length < 20) return { spiked: false, sigma: 0 };
    const win = prices.slice(-Math.min(SPIKE_LOOKBACK, prices.length));
    const returns = win.slice(1).map((p, i) => Math.abs(p - win[i]));
    if (returns.length < 10) return { spiked: false, sigma: 0 };
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const std = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length);
    if (std === 0) return { spiked: false, sigma: 0 };
    const maxSigma = Math.max(...returns.slice(-5).map(r => (r - mean) / std));
    return { spiked: maxSigma >= SPIKE_SIGMA, sigma: maxSigma };
}
const lastDigitOf = (q: number, pip: number): number => { const s = q.toFixed(pip); return parseInt(s[s.length - 1], 10); };
const wilsonLower = (wins: number, total: number, z = 1.96): number => {
    if (total === 0) return 0;
    const p = wins / total, z2 = z * z, den = 1 + z2 / total;
    const ctr = p + z2 / (2 * total);
    const mrg = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
    return (ctr - mrg) / den;
};
/** Autocorrelation at lag 1 — positive = digits cluster, negative = alternating */
function acf1Fn(arr: number[]): number {
    const n = arr.length; if (n < 20) return 0;
    const mean = arr.reduce((s, x) => s + x, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n - 1; i++) num += (arr[i] - mean) * (arr[i + 1] - mean);
    for (let i = 0; i < n; i++) den += (arr[i] - mean) ** 2;
    return den === 0 ? 0 : num / den;
}
/** Fit a line to an array of rates; return whether slope is rising / flat / falling */
function computeTrendDir(rates: number[]): TrendDir {
    if (rates.length < 2) return 'flat';
    const n = rates.length, mx = (n - 1) / 2, my = rates.reduce((s, r) => s + r, 0) / n;
    let num = 0, den = 0;
    rates.forEach((r, i) => { num += (i - mx) * (r - my); den += (i - mx) ** 2; });
    const slope = den === 0 ? 0 : num / den;
    return slope > 0.005 ? 'rising' : slope < -0.005 ? 'falling' : 'flat';
}
/** How many ticks ago did `target` digit last appear? Returns array.length if never. */
function ticksSinceDigit(digits: number[], target: number): number {
    for (let i = digits.length - 1; i >= 0; i--) if (digits[i] === target) return digits.length - 1 - i;
    return digits.length;
}

// DBot takes 1–3 ticks between contract settlement and the next before_purchase.
// All entry-point timing calculations add this midpoint offset so the signal
// reflects when the bot can ACTUALLY place the trade, not the current tick.
const BOT_SKIP_TICKS = 2;   // midpoint of 1-3 tick bot delay
const BOT_SKIP_MAX   = 3;   // maximum skip; used to blend lags in conditional

// ─── EO Recovery recommendation ───────────────────────────────────────────────
// Based purely on market structure — not a guess:
//   acf1 < 0  → digits ALTERNATE (EVEN→ODD→EVEN…) → recovery benefits from the flip
//   acf1 > 0  → digits STREAK (EVEN→EVEN→EVEN…) → recovery fights the cluster and loses more
//   streak    → current run of consecutive wins on the signal side
//   momentum  → whether the win rate is accelerating or decelerating
function eoRecoveryRec(s: StatsChecks): { recommended: boolean; neutral: boolean; label: string; reason: string } {
    const acf1   = s.autocorr.acf1;
    const streak = s.streak.length;
    const trend  = s.sideMomentum?.trend ?? 'flat';

    // Positive score → recovery helps. Negative → recovery hurts.
    let score = 0;
    if (acf1 < -0.06) score += 3;       // strong alternation
    else if (acf1 < -0.03) score += 2;  // moderate alternation
    if (acf1 > 0.06) score -= 3;        // strong streaking
    else if (acf1 > 0.03) score -= 2;   // moderate streaking
    if (streak >= 4) score -= 2;        // momentum clearly on same side
    else if (streak >= 3) score -= 1;
    else if (streak <= 1) score += 1;   // no current momentum
    if (trend === 'rising') score -= 1; // current side accelerating

    if (score >= 2) {
        const acfStr = (acf1 * 100).toFixed(1);
        return {
            recommended: true, neutral: false,
            label: 'Recommended',
            reason: `Market alternates (acf=${acfStr}%)${streak <= 1 ? ', no streak' : ''}. After a loss the opposite side is statistically more likely.`,
        };
    }
    if (score <= -1) {
        const acfStr = (acf1 * 100).toFixed(1);
        const streakNote = streak >= 3 ? `, ${streak}-tick streak on this side` : '';
        const acfNote = acf1 > 0.03 ? `Market clusters (acf=${acfStr}%)` : 'Momentum on current side';
        return {
            recommended: false, neutral: false,
            label: 'Not Recommended',
            reason: `${acfNote}${streakNote}. Flipping after a loss risks compounding losses against the streak.`,
        };
    }
    return {
        recommended: false, neutral: true,
        label: 'Neutral',
        reason: 'No clear alternating or streaking pattern. Recovery adds risk without a statistical edge.',
    };
}

// ─── Stats-driven signal analysis (replaces 10-model voting) ─────────────────
function runModels(prices: number[], pip: number, sym: DerivVolatility, tradeType: TradeType): MarketResult {
    const N = prices.length;
    const digits = prices.map(p => lastDigitOf(p, pip));
    const freq = new Array(10).fill(0);
    for (const d of digits) freq[d]++;
    const freqPct = freq.map(f => f / N);

    // ── Direction determination ──────────────────────────────────────────────
    let direction = '', contractType = '', barrier: number | null = null,
        recoveryBarrier: number | null = null, recoveryContractType: string | null = null,
        recoveryDirection: string | null = null, winProb = 0;
    let winFn: (d: number) => boolean;

    if (tradeType === 'even_odd') {
        const evenCt = digits.filter(d => d % 2 === 0).length;
        const oddCt  = N - evenCt;
        // Trade WITH the dominant side — direction follows actual dominance
        if (evenCt >= oddCt) {
            direction = 'EVEN'; contractType = 'DIGITEVEN';
            winProb = evenCt / N; winFn = d => d % 2 === 0;
        } else {
            direction = 'ODD'; contractType = 'DIGITODD';
            winProb = oddCt / N; winFn = d => d % 2 !== 0;
        }
    } else if (tradeType === 'matches_differs') {
        const exp2 = N / 10;
        const chiContribs = freq.map(f => (f - exp2) ** 2 / exp2);
        let matchDig = 0, differDig = 0;
        for (let d = 1; d < 10; d++) { if (freq[d] > freq[matchDig]) matchDig = d; if (freq[d] < freq[differDig]) differDig = d; }
        if (chiContribs[matchDig] >= chiContribs[differDig]) {
            barrier = matchDig; direction = `MATCHES ${matchDig}`; contractType = 'DIGITMATCH';
            winProb = freq[matchDig] / N; winFn = d => d === matchDig;
        } else {
            barrier = differDig; direction = `DIFFERS ${differDig}`; contractType = 'DIGITDIFF';
            winProb = 1 - freq[differDig] / N; winFn = d => d !== differDig;
        }
    } else {
        const allOptions: { side: 'OVER' | 'UNDER'; b: number; prob: number; edge: number }[] = [];
        for (let b = 1; b <= 8; b++) {
            const ovP = digits.filter(d => d > b).length / N;
            const unP = digits.filter(d => d < b).length / N;
            allOptions.push({ side: 'OVER',  b, prob: ovP, edge: ovP - (9 - b) / 10 });
            allOptions.push({ side: 'UNDER', b, prob: unP, edge: unP - b / 10 });
        }
        allOptions.sort((a, b2) => b2.edge - a.edge || b2.prob - a.prob);
        const best = allOptions[0];
        const recovery = allOptions.filter(o => o.side !== best.side)[0] ?? allOptions[1] ?? best;
        barrier = best.b; recoveryBarrier = recovery.b;
        recoveryContractType = recovery.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
        recoveryDirection    = `${recovery.side} ${recovery.b}`;
        direction = `${best.side} ${best.b}`; contractType = best.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
        winProb = best.prob; winFn = d => best.side === 'OVER' ? d > best.b : d < best.b;
    }

    // Theoretical expected win rate at this barrier (50 % for EO, barrier-dependent for OU)
    const theorExp = tradeType === 'even_odd' ? 0.50
        : tradeType === 'over_under' && barrier !== null
            ? (contractType === 'DIGITOVER' ? (9 - barrier) / 10 : barrier / 10)
            : 0.10;

    // ── Recent dominance (for UI + watchdog) ────────────────────────────────
    const last20d = digits.slice(-20); const last50d = digits.slice(-50);
    const last20R = last20d.map(d => winFn(d));
    const wins20  = last20R.filter(Boolean).length;
    const wins50  = last50d.filter(d => winFn(d)).length;
    const dom20   = wins20 / Math.max(1, last20d.length);
    const dom50   = wins50 / Math.max(1, last50d.length);
    const recentDominance = {
        last20WinPct: dom20, last50WinPct: dom50, winsLast20: wins20, winsLast50: wins50, last20Results: last20R,
        isHot: dom20 >= 0.65, isCold: dom20 <= 0.35,
        label: (dom20 >= 0.70 ? 'DOMINANT' : dom20 >= 0.55 ? 'ACTIVE' : dom20 >= 0.45 ? 'NEUTRAL' : dom20 >= 0.30 ? 'COOLING' : 'REVERSED') as 'DOMINANT' | 'ACTIVE' | 'NEUTRAL' | 'COOLING' | 'REVERSED',
    };

    // ── Entry digits (conditional probability + frequency weight) ────────────
    // Bot takes 1–3 ticks between contracts — blend lags 1, 2, 3 so entry digits
    // score well at the actual tick the bot places the next contract, not just lag-1.
    const cond = new Array(10).fill(null).map(() => ({ wins: 0, total: 0 }));
    for (let lag = 1; lag <= BOT_SKIP_MAX; lag++) {
        for (let i = 0; i < digits.length - lag; i++) {
            cond[digits[i]].total++;
            if (winFn(digits[i + lag])) cond[digits[i]].wins++;
        }
    }
    const minSmp  = Math.max(50, Math.floor(N / 50));

    // Per-digit frequency trend across 4 equal time bands (oldest → newest).
    // Used by OU entry scoring: rising winning-side digits get a bonus so the
    // best entry point aligns with current momentum, not just historical frequency.
    const entryBandSz = Math.max(1, Math.floor(N / 4));
    const digitBandTrend = Array.from({ length: 10 }, (_, d) => {
        const rates = Array.from({ length: 4 }, (_, b) => {
            const band = digits.slice(b * entryBandSz, (b + 1) * entryBandSz);
            return band.filter(x => x === d).length / Math.max(1, band.length);
        });
        return computeTrendDir(rates);
    });

    const scored  = cond.map((c, d) => {
        const conditional = c.total > 0 ? c.wins / c.total : 0;
        const lb = wilsonLower(c.wins, c.total);
        // OU only: reward winning-side digits whose frequency is actively rising.
        // This ensures the entry point is in sync with the momentum the user described.
        const trendBonus = (tradeType === 'over_under' && winFn(d) && digitBandTrend[d] === 'rising') ? 0.04 : 0;
        return { digit: d, conditional, lowerBound: lb, total: c.total,
            freqScore: lb * Math.sqrt(Math.max(0.3, freqPct[d] / 0.10)) + trendBonus, freqPct: freqPct[d] };
    });
    let entryRaw = scored.filter(c => c.total >= minSmp && c.lowerBound >= winProb + 0.01).sort((a, b) => b.freqScore - a.freqScore || b.lowerBound - a.lowerBound).slice(0, 3);
    if (entryRaw.length < 3) { const used = new Set(entryRaw.map(e => e.digit)); const fb = scored.filter(c => !used.has(c.digit) && c.total >= minSmp).sort((a, b) => b.freqScore - a.freqScore || b.lowerBound - a.lowerBound); while (entryRaw.length < 3 && fb.length > 0) entryRaw.push(fb.shift()!); }
    while (entryRaw.length < 3) { const used = new Set(entryRaw.map(e => e.digit)); const fb2 = scored.filter(e => !used.has(e.digit)).sort((a, b) => b.freqPct - a.freqPct)[0]; if (!fb2) break; entryRaw.push(fb2); }
    const entryDigits = entryRaw.map((e, i) => {
        const avgWaitT = Math.max(1, Math.round(1 / Math.max(0.01, e.freqPct)));
        const gapNow = ticksSinceDigit(digits, e.digit);
        // After the bot's skip, estimate remaining ticks until this digit appears
        const skipAdjustedWait = Math.max(0, avgWaitT - (gapNow + BOT_SKIP_TICKS));
        return { digit: e.digit, recommended: i === 0, conditional: e.conditional, freqPct: e.freqPct, avgWaitTicks: avgWaitT, skipAdjustedWait };
    });

    // ══ STATS CHECKS (replace model voting) ══════════════════════════════════

    // CHECK 1 — Raw win rate across 30 / 60 / 100 recent ticks
    const safe = (n: number) => Math.min(n, N);
    const r30  = digits.slice(-safe(30) ).filter(winFn).length / safe(30);
    const r60  = digits.slice(-safe(60) ).filter(winFn).length / safe(60);
    const r100 = digits.slice(-safe(100)).filter(winFn).length / safe(100);
    const isEO = tradeType === 'even_odd';
    // Thresholds: modest margin above theoretical; 2-of-3 windows must pass (handles short-window noise)
    const rawT30 = theorExp + 0.04;
    const rawT60 = theorExp + 0.03;
    const rawT100= theorExp + 0.02;
    const rawWinRatePass = [r30 >= rawT30, r60 >= rawT60, r100 >= rawT100].filter(Boolean).length >= 2;

    // CHECK 2 — Cross-window consistency (500 / 1k / 3k ticks all above floor)
    const sl500  = digits.slice(-safe(500));  const r500 = sl500.filter(winFn).length / sl500.length;
    const sl1k   = digits.slice(-safe(1000)); const r1k  = sl1k .filter(winFn).length / sl1k.length;
    const sl3k   = digits.slice(-safe(3000)); const r3k  = sl3k .filter(winFn).length / sl3k.length;
    const cwFloor = theorExp + (isEO ? 0.02 : 0.02);
    const crossWindowPass = r500 >= cwFloor && r1k >= cwFloor && r3k >= cwFloor;

    // CHECK 3 — Current streak on winning side
    let streakLen = 0;
    for (let i = digits.length - 1; i >= 0; i--) { if (winFn(digits[i])) streakLen++; else break; }
    const streakPass = streakLen >= (isEO ? 2 : 3);

    // CHECK 4 — Autocorrelation at lag 1 (sticky market)
    const a1 = acf1Fn(digits.slice(-safe(500)));
    const autocorrPass = Math.abs(a1) > 0.03;

    // CHECK 5 — Stability: win rate in 5 equal bands, trend not falling
    const wSz       = Math.floor(N / 5);
    const stabFloor  = theorExp + (isEO ? 0.01 : 0.02);
    const stabRates  = Array.from({ length: 5 }, (_, w) => digits.slice(w * wSz, (w + 1) * wSz).filter(winFn).length / wSz);
    const stabAbove  = stabRates.filter(r => r >= stabFloor).length;
    const stabTrend  = computeTrendDir(stabRates);
    const stabilityPass = stabAbove >= 3 && stabTrend !== 'falling';

    // CHECK 6 — Best entry digit is overdue (≥ 1.3× its average gap)
    const bestEntry    = entryDigits[0];
    const avgWait      = bestEntry?.avgWaitTicks ?? 10;
    const lastGap      = bestEntry ? ticksSinceDigit(digits, bestEntry.digit) : 0;
    // Credit the bot's skip: by the time it resumes scanning, BOT_SKIP_TICKS more
    // ticks will have passed — so the entry digit is effectively more overdue.
    const effectiveGap = lastGap + BOT_SKIP_TICKS;
    const overdueRatio = avgWait > 0 ? effectiveGap / avgWait : 0;
    const entryOverduePass = overdueRatio >= 1.3;

    // ── CHECKS 7 & 8 — Lead digit + Side momentum (all trade types) ─────────
    // Build win-side digit array for this trade type and barrier
    const allDigits = [0,1,2,3,4,5,6,7,8,9];
    const winSideArr  = allDigits.filter(d => winFn(d));
    const lossSideArr = allDigits.filter(d => !winFn(d));

    const recent1k = digits.slice(-safe(1000));
    const cntArr   = new Array(10).fill(0) as number[];
    recent1k.forEach(d => cntArr[d]++);

    const winSidePct  = winSideArr .reduce((s, d) => s + cntArr[d], 0) / recent1k.length;
    const lossSidePct = lossSideArr.reduce((s, d) => s + cntArr[d], 0) / recent1k.length;

    // CHECK 7 — Lead digit: the most-appearing digit from the win side must
    // hold its top-win-side position across 3+ of the 4 equal time bands.
    // For MATCHES X / DIFFERS X the "lead digit" is the target digit itself.
    const bandSz = Math.floor(N / 4);

    let topWinDigit: number;
    if (tradeType === 'matches_differs') {
        // For M/D the signal digit IS the barrier
        topWinDigit = barrier ?? 0;
    } else {
        // EO and OU: most-appearing digit from the winning side (recent 1k)
        topWinDigit = winSideArr.reduce((best, d) => cntArr[d] > cntArr[best] ? d : best, winSideArr[0]);
    }

    let stableBands = 0;
    for (let b = 0; b < 4; b++) {
        const band = digits.slice(b * bandSz, (b + 1) * bandSz);
        const bc   = new Array(10).fill(0) as number[];
        band.forEach(d => bc[d]++);
        if (tradeType === 'matches_differs') {
            // MATCHES: target digit consistently above expected; DIFFERS: below expected
            const bandPct = bc[topWinDigit] / band.length;
            if (contractType === 'DIGITMATCH' ? bandPct > 0.12 : bandPct < 0.09) stableBands++;
        } else {
            // EO / OU: lead digit stays the top win-side digit in this band
            const topInBand = winSideArr.reduce((best, d) => bc[d] > bc[best] ? d : best, winSideArr[0]);
            if (topInBand === topWinDigit) stableBands++;
        }
    }

    // Margin: win-side lead over loss side (EO/OU) or digit freq deviation (M/D)
    const margin = tradeType === 'matches_differs'
        ? Math.abs(cntArr[topWinDigit] / recent1k.length - theorExp)
        : winSidePct - lossSidePct;

    const leadDigitPass = stableBands >= 3 && margin >= 0.02;
    const leadDigit: StatsChecks['leadDigit'] = { pass: leadDigitPass, topWinDigit, margin, stableBands };

    // CHECK 8 — Side momentum: win rate across 4 equal time bands must be
    // flat or rising (not falling), and recent half must not be worse than old half.
    const bandRates = Array.from({ length: 4 }, (_, b) => {
        const band = digits.slice(b * bandSz, (b + 1) * bandSz);
        return band.filter(winFn).length / band.length;
    });
    const momTrend  = computeTrendDir(bandRates);
    const halfN       = Math.floor(N / 2);
    const oldHalfRate = digits.slice(0, halfN).filter(winFn).length / halfN;
    const newHalfRate = digits.slice(halfN).filter(winFn).length / (N - halfN);
    const longTermOk  = newHalfRate >= oldHalfRate - 0.01;
    // Recent band must still be above type-specific floor
    const recentBandFloor = theorExp + (isEO ? 0.02 : 0.01);
    const sideMomPass = momTrend !== 'falling' && bandRates[3] >= recentBandFloor && longTermOk;
    const sideMomentum: StatsChecks['sideMomentum'] = { pass: sideMomPass, bandRates, trend: momTrend, longTermOk };

    // CHECK 9 — Multi-window frequency alignment
    // All tick windows must agree that the winning side dominates (winPct > 50%).
    // This blocks entries during neutral/opposing regimes — the #1 cause of bad-day losses.
    const freqWinSizes = [50, 100, 500, 1000];
    const freqWinWindows = freqWinSizes.map(sz => {
        const sl = digits.slice(-Math.min(sz, N));
        const winPct = sl.filter(winFn).length / sl.length;
        return { size: sz, winPct, dominant: winPct > 0.50 };
    });
    // 3 of 4 windows must agree — the 50-tick window is too small (only 5 ticks
    // per digit on average) to reliably reflect true dominance; requiring all 4
    // causes ~55% of genuinely good EO signals to be silently killed by noise.
    const freqWinPass = freqWinWindows.filter(w => w.dominant).length;
    const freqAlignPass = freqWinPass >= 3;
    const freqAlignScore = Math.round((freqWinPass / freqWinWindows.length) * 100);
    const freqAlignment = { pass: freqAlignPass, windows: freqWinWindows, allAgree: freqWinPass === 4, alignScore: freqAlignScore };

    // CHECK 10 — Micro-confirmation entry gate
    // Last 2 ticks must be on the winning side — confirms the market is actively moving
    // in the signal direction right now, not just historically.
    const last2digits = digits.slice(-2);
    const last2Results = last2digits.map(winFn);
    const microConfirmPass = last2Results.length >= 2 && last2Results.every(Boolean);
    const microConfirm = { pass: microConfirmPass, last2Wins: last2Results.filter(Boolean).length, last2: last2Results };

    // CHECK 11 — Digit Position Dominance
    // EO:  most, 2nd-most, and least appearing digits must all land on the winning
    //      side; ≥3 of the 5 winning-side digits must hold >10% in ALL 4 freq
    //      windows; losing-side digits must be weak (below 10% in ≥3 of 4 windows).
    // OU:  most and least appearing digits must be on the winning side; every
    //      losing-side digit must be below 10.3% in ALL 4 windows; winning-side
    //      combined frequency must be flat/rising across time bands; losing-side
    //      must be flat/falling.
    // MD:  skipped (pass by default — different market structure).
    const dpWinSizes = [50, 100, 500, 1000];
    const dpWindows  = dpWinSizes.map(sz => {
        const sl  = digits.slice(-Math.min(sz, N));
        const cnt = new Array(10).fill(0) as number[];
        sl.forEach(d => cnt[d]++);
        return cnt.map(c => c / sl.length);  // per-digit frequency fraction
    });
    // Rank digits by frequency in the 1 000-tick window (dpWindows[3])
    const freqRanked          = [0,1,2,3,4,5,6,7,8,9].sort((a, b) => dpWindows[3][b] - dpWindows[3][a]);
    const mostFreqDigit       = freqRanked[0];
    const secondFreqDigit     = freqRanked[1];
    const leastFreqDigit      = freqRanked[9];
    const secondLeastFreqDigit = freqRanked[8];

    let digitDomPass: boolean;
    let digitDomDetails: StatsChecks['digitDominance'];

    if (tradeType === 'even_odd') {
        const mostOnWin   = winFn(mostFreqDigit);
        // 2nd most-appearing digit is NOT required on the winning side — it can fall anywhere
        const secondOnWin = true;
        // Either the least OR the 2nd-least appearing digit must be on the winning side
        const leastOnWin = winFn(leastFreqDigit) || winFn(secondLeastFreqDigit);
        // Most appearing digit must hold above 11% in the 1 000-tick window
        const mostAbove11 = dpWindows[3][mostFreqDigit] > 0.11;
        // ≥3 winning-side digits must hold above 10% in the 1 000-tick window
        const winDigitsAbove10 = winSideArr.filter(d => dpWindows[3][d] > 0.10).length;
        // Each losing-side digit should be below 10% in ≥3 of 4 windows
        const losingCapOk = lossSideArr.every(d =>
            dpWindows.filter(w => w[d] < 0.10).length >= 3
        );
        digitDomPass    = mostOnWin && leastOnWin && mostAbove11 && winDigitsAbove10 >= 3;
        digitDomDetails = { pass: digitDomPass, mostOnWin, leastOnWin, secondOnWin, losingCapOk, winTrend: 'flat', lossTrend: 'flat' };

    } else if (tradeType === 'over_under') {
        const mostOnWin  = winFn(mostFreqDigit);
        // Either the least OR the 2nd-least appearing digit must be on the winning side
        const leastOnWin = winFn(leastFreqDigit) || winFn(secondLeastFreqDigit);
        // Every losing-side digit must be below 10.3% in the 1 000-tick window.
        // Multi-window was too noisy on the 50-tick slice.
        const losingCapOk = lossSideArr.every(d => dpWindows[3][d] < 0.103);
        // Winning-side and losing-side frequency trend across 5 time bands
        const dp5Sz = Math.max(1, Math.floor(N / 5));
        const winBandFreqs  = Array.from({ length: 5 }, (_, b) => {
            const band = digits.slice(b * dp5Sz, (b + 1) * dp5Sz);
            return band.filter(d => winFn(d)).length / Math.max(1, band.length);
        });
        const lossBandFreqs = Array.from({ length: 5 }, (_, b) => {
            const band = digits.slice(b * dp5Sz, (b + 1) * dp5Sz);
            return band.filter(d => !winFn(d)).length / Math.max(1, band.length);
        });
        const winTrend  = computeTrendDir(winBandFreqs);
        const lossTrend = computeTrendDir(lossBandFreqs);
        digitDomPass    = mostOnWin && leastOnWin && losingCapOk
                          && winTrend !== 'falling' && lossTrend !== 'rising';
        digitDomDetails = { pass: digitDomPass, mostOnWin, leastOnWin, secondOnWin: true, losingCapOk, winTrend, lossTrend };

    } else {
        // Matches/Differs: different market structure — pass unconditionally
        digitDomPass    = true;
        digitDomDetails = { pass: true, mostOnWin: true, leastOnWin: true, secondOnWin: true, losingCapOk: true, winTrend: 'flat', lossTrend: 'flat' };
    }

    // ── Recovery options — all barriers on both sides with safety ratings ───
    // Each option is rated using the SAME 4-window alignment check as Check 9:
    //   windows: 50 / 100 / 500 / 1 000 ticks — all must beat theoretical expectation.
    //   safe    = all 4 windows pass  (> theoExp)
    //   marginal= 3 of 4 windows pass
    //   unsafe  = ≤ 2 windows pass
    // winPct displayed is from the 1 000-tick window (most representative).
    const recWinSizes = [50, 100, 500, 1000];
    const recoveryOptions: RecoveryOption[] = [];
    for (let rb = 1; rb <= 8; rb++) {
        const ovTheo = (9 - rb) / 10;
        const unTheo = rb / 10;
        let ovPassCount = 0, unPassCount = 0;
        let ovPct1k = 0, unPct1k = 0;
        for (const sz of recWinSizes) {
            const sl = digits.slice(-Math.min(sz, N));
            const ovPct = sl.filter(d => d > rb).length / sl.length;
            const unPct = sl.filter(d => d < rb).length / sl.length;
            if (ovPct > ovTheo) ovPassCount++;
            if (unPct > unTheo) unPassCount++;
            if (sz === 1000) { ovPct1k = ovPct; unPct1k = unPct; }
        }
        const ovSafety: RecoveryOption['safety'] = ovPassCount === 4 ? 'safe' : ovPassCount === 3 ? 'marginal' : 'unsafe';
        const unSafety: RecoveryOption['safety'] = unPassCount === 4 ? 'safe' : unPassCount === 3 ? 'marginal' : 'unsafe';
        recoveryOptions.push({ side: 'OVER',  barrier: rb, winPct: ovPct1k, theoExp: ovTheo, windowsPass: ovPassCount, safety: ovSafety, isAiPick: false });
        recoveryOptions.push({ side: 'UNDER', barrier: rb, winPct: unPct1k, theoExp: unTheo, windowsPass: unPassCount, safety: unSafety, isAiPick: false });
    }
    // Mark the AI-picked recovery (already determined above)
    if (recoveryBarrier !== null && recoveryContractType !== null) {
        const aiSide = recoveryContractType === 'DIGITOVER' ? 'OVER' : 'UNDER';
        const aiOpt = recoveryOptions.find(o => o.side === aiSide && o.barrier === recoveryBarrier);
        if (aiOpt) aiOpt.isAiPick = true;
    }
    // Recommend "No Recovery" when primary market is very strong AND all recovery options are weak
    const safeRecoveries = recoveryOptions.filter(o => o.safety === 'safe').length;
    const noRecoveryRecommended = tradeType === 'over_under' && r1k >= theorExp + 0.06 && safeRecoveries <= 2;

    // ── Recovery market viability (OU only) ─────────────────────────────────
    // Recovery is the opposite-side trade taken after a loss.
    // Require its long-run win rate to be at or within 2pp of its theoretical floor.
    let recoveryMarketOk = true;
    if (tradeType === 'over_under' && recoveryBarrier !== null && recoveryContractType !== null) {
        const rb = recoveryBarrier as number;
        const recWinFn: (d: number) => boolean = recoveryContractType === 'DIGITOVER'
            ? d => d > rb : d => d < rb;
        const recTheoExp = recoveryContractType === 'DIGITOVER' ? (9 - rb) / 10 : rb / 10;
        const recWinRate = digits.filter(recWinFn).length / N;
        recoveryMarketOk = recWinRate >= recTheoExp - 0.02;
    }

    // ── Aggregate & gate ─────────────────────────────────────────────────────
    const checkArr = [rawWinRatePass, crossWindowPass, streakPass, autocorrPass,
                      stabilityPass, entryOverduePass, leadDigitPass, sideMomPass,
                      freqAlignPass, microConfirmPass, digitDomPass];
    const passCount  = checkArr.filter(Boolean).length;
    const totalChecks = 11;

    let isSignal: boolean;
    if (tradeType === 'even_odd') {
        // EO: rawWinRate + crossWindow + freqAlignment + digitDominance all mandatory.
        // 6/11 overall — adding Check 11 as mandatory already tightened the gate;
        // keeping threshold at 6 avoids double-tightening that blocks valid signals.
        isSignal = rawWinRatePass && crossWindowPass && freqAlignPass && digitDomPass && passCount >= 6;
    } else if (tradeType === 'over_under') {
        // OU: all core checks + digit dominance mandatory.
        // 6/11 overall — same rationale as EO.
        isSignal = rawWinRatePass && crossWindowPass && freqAlignPass && stabilityPass
            && recoveryMarketOk && winProb >= MIN_WIN_PROB_OU && digitDomPass
            && passCount >= 6;
    } else {
        // MD: core mandatory + freq alignment + ≥ 6/11 total
        isSignal = rawWinRatePass && crossWindowPass && freqAlignPass && passCount >= 6;
    }

    const statsChecks: StatsChecks = {
        rawWinRate:   { pass: rawWinRatePass,   rate30: r30, rate60: r60, rate100: r100 },
        crossWindow:  { pass: crossWindowPass,  rate500: r500, rate1k: r1k, rate3k: r3k },
        streak:       { pass: streakPass,       length: streakLen },
        autocorr:     { pass: autocorrPass,     acf1: a1 },
        stability:    { pass: stabilityPass,    windowsAbove: stabAbove, trend: stabTrend },
        entryOverdue: { pass: entryOverduePass, overdueRatio },
        leadDigit, sideMomentum, freqAlignment, microConfirm,
        digitDominance: digitDomDetails,
        passCount, totalChecks, isSignal,
    };

    // ── Backwards-compat ModelVotes shell (UI uses yesCount for colour) ──────
    const fakeVote = (pass: boolean, score: number): ModelResult => ({ name: '', vote: pass, score });
    const votes: ModelVotes = {
        chiSquared:  fakeVote(rawWinRatePass,  r100),
        bayesian:    fakeVote(crossWindowPass, r1k),
        momentum:    fakeVote(streakPass,      streakLen / 10),
        stability:   fakeVote(stabilityPass,   stabAbove / 5),
        recentEdge:  fakeVote(rawWinRatePass && crossWindowPass, r100),
        markov:      fakeVote(autocorrPass,    Math.abs(a1)),
        linearTrend: fakeVote(stabilityPass,   stabAbove / 5),
        entropy:     fakeVote(entryOverduePass,overdueRatio / 2),
        ngram:       fakeVote(leadDigitPass,   margin),
        quartile:    fakeVote(sideMomPass,     0),
        yesCount: passCount, totalScore: (passCount / totalChecks) * 10,
    };

    const signalStrength = Math.round((passCount / totalChecks) * 100);
    const regimeScore    = Math.round(Math.min(100, Math.max(0, (r1k - theorExp) / 0.15 * 100)));

    return {
        sym, direction, contractType, barrier, recoveryBarrier, recoveryContractType, recoveryDirection,
        winProb, sampleSize: N, votes, entryDigits, pip,
        segmentAgrees: stabilityPass || crossWindowPass,
        signalStrength, recentDominance,
        regimeScore, regimeOk: crossWindowPass && stabilityPass,
        gapDetected: false, tfAgreement: Math.min(4, Math.round(passCount / 2)),
        statsChecks, recoveryOptions, noRecoveryRecommended,
    };
}

// ─── Scan all markets ─────────────────────────────────────────────────────────
async function scanAllMarkets(tradeType: TradeType, onProgress: (received: number) => void): Promise<{ best: MarketResult | null; noVotesBest: MarketResult | null; allResults: MarketResult[]; spikedMarkets: SpikeInfo[] }> {
    return new Promise(resolve => {
        const ws = new WebSocket(DERIV_WS);
        const priceMap = new Map<number, { prices: number[]; times: number[]; pip: number; sym: DerivVolatility }>();
        let received = 0, closed = false;
        const finish = () => {
            if (closed) return; closed = true;
            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
            try { ws.close(); } catch { /* */ }
            const results: MarketResult[] = []; const detectedSpikes: SpikeInfo[] = [];
            priceMap.forEach(({ prices, times, pip, sym }) => {
                if (prices.length < 100) return;
                const { spiked, sigma } = detectSpike(prices);
                if (spiked) detectedSpikes.push({ code: sym.code, label: sym.short, sigma: Math.round(sigma * 10) / 10 });
                const { gapDetected } = detectGap(times);
                const tfMicro = prices.slice(-200); const tfShort = prices.slice(-1000); const tfMedium = prices.length >= 3000 ? prices.slice(-3000) : prices; const tfLong = prices;
                const full = runModels(tfShort, pip, sym, tradeType);
                if (tfShort.length >= 1600) { const seg = runModels(tfShort.slice(-1500), pip, sym, tradeType); full.segmentAgrees = seg.direction === full.direction && seg.statsChecks.passCount >= 3; }
                const rMicro = runModels(tfMicro, pip, sym, tradeType); const rMedium = runModels(tfMedium, pip, sym, tradeType); const rLong = runModels(tfLong, pip, sym, tradeType);
                const mainDir = full.direction; const tfAgreement = [rMicro, full, rMedium, rLong].filter(r => r.direction === mainDir).length;
                const regimeOk = rMedium.direction === mainDir && rLong.direction === mainDir;
                const divergence = jsDiv(digitFreqArr(tfMicro, pip), digitFreqArr(tfLong, pip));
                const regimeScore = Math.max(0, Math.round((1 - divergence / Math.max(divergence, REGIME_DIV_LIMIT)) * 100));
                results.push({ ...full, regimeScore, regimeOk, gapDetected, tfAgreement });
            });
            results.sort((a, b) => b.statsChecks.passCount - a.statsChecks.passCount || b.winProb - a.winProb);
            const spikedCodes = new Set(detectedSpikes.map(s => s.code));
            const best = results.find(r => !spikedCodes.has(r.sym.code) && !r.gapDetected && r.statsChecks.isSignal && !r.recentDominance.isCold) ?? null;
            const noVotesBest = best ? null : (results.find(r => !spikedCodes.has(r.sym.code)) ?? results[0] ?? null);
            resolve({ best, noVotesBest, allResults: results, spikedMarkets: detectedSpikes });
        };
        ws.onopen = () => { ALL_SYMS.forEach((sym, i) => setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) return; ws.send(JSON.stringify({ ticks_history: sym.code, count: TICK_COUNT_LONG, end: 'latest', style: 'ticks', req_id: i + 1 })); }, i * 80)); };
        ws.onmessage = (ev: MessageEvent) => {
            let msg: any; try { msg = JSON.parse(ev.data as string); } catch { return; }
            if (msg.msg_type !== 'history') return;
            const reqId = msg.req_id as number; const sym = ALL_SYMS[reqId - 1]; if (!sym) return;
            priceMap.set(reqId, { prices: msg.history?.prices ?? [], times: msg.history?.times ?? [], pip: msg.pip_size ?? 2, sym });
            onProgress(++received);
            if (received >= ALL_SYMS.length) finish();
        };
        ws.onerror = () => finish(); ws.onclose = () => { if (!closed) finish(); };
        setTimeout(() => { if (!closed) finish(); }, 40_000);
    });
}

// ─── Watchdog ─────────────────────────────────────────────────────────────────
interface WatchdogEntry { status: 'warming' | 'holding' | 'weakening' | 'reversed'; winPct: number; ticks: number; }

/** Derive a win-test function directly from a MarketResult */
function makeWinFn(r: MarketResult): (digit: number) => boolean {
    switch (r.contractType) {
        case 'DIGITOVER':  return d => d > (r.barrier ?? 5);
        case 'DIGITUNDER': return d => d < (r.barrier ?? 5);
        case 'DIGITODD':   return d => d % 2 !== 0;
        case 'DIGITEVEN':  return d => d % 2 === 0;
        case 'DIGITMATCH': return d => d === (r.barrier ?? 0);
        case 'DIGITDIFF':  return d => d !== (r.barrier ?? 0);
        default:           return () => false;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function calcRecRuns(yesCount: number, winProb: number): number {
    const edge = Math.max(0.02, winProb - 0.50); const raw = Math.round(1.5 / edge);
    const cap = yesCount >= 9 ? 8 : yesCount >= 7 ? 12 : 19;
    return Math.max(2, Math.min(cap, raw));
}
const voteColor = (v: number): string => v >= 9 ? '#10b981' : v >= 7 ? '#6366f1' : v >= 5 ? '#f59e0b' : '#ef4444';
const voteLabel = (v: number): string => v >= 10 ? 'UNANIMOUS' : v >= 9 ? 'STRONG' : v >= 8 ? 'SOLID' : v >= 7 ? 'GOOD' : v >= 5 ? 'FAIR' : 'WEAK';

// ─── Component ────────────────────────────────────────────────────────────────
const AiSignalsPage: React.FC = () => {
    const [tradeType,  setTradeType]  = useState<TradeType>('over_under');
    const [scanState,  setScanState]  = useState<ScanState>('idle');
    const [progress,   setProgress]   = useState(0);
    const [result,     setResult]     = useState<MarketResult | null>(null);
    const [noSigBest,  setNoSigBest]  = useState<MarketResult | null>(null);
    const [hasSignal,  setHasSignal]  = useState(false);
    const [spikedMarkets, setSpikedMarkets] = useState<SpikeInfo[]>([]);

    const [editDir,    setEditDir]    = useState<'OVER' | 'UNDER' | 'EVEN' | 'ODD'>('OVER');
    const [editBarrier,setEditBarrier]= useState<number>(5);
    const [editRecoveryBarrier, setEditRecoveryBarrier] = useState<number | null>(null);
    const [editRecoveryMode,    setEditRecoveryMode]    = useState<'none' | 'over' | 'under'>('under');
    const [editMatchesSide, setEditMatchesSide] = useState<'MATCHES' | 'DIFFERS'>('MATCHES');
    const [editTargetDigit, setEditTargetDigit] = useState<number>(0);
    const [sessionCount, setSessionCount] = useState<number>(0);
    const [editEntryPoint, setEditEntryPoint] = useState<number>(0);

    const resultPanelRef = useRef<HTMLDivElement | null>(null);
    const entryWsRef    = useRef<WebSocket | null>(null);
    const watchdogWsRef = useRef<Map<string, WebSocket>>(new Map());
    const [watchdogMap, setWatchdogMap] = useState<Map<string, WatchdogEntry>>(new Map());
    const [ticksSinceScan, setTicksSinceScan] = useState(0);
    const [digitLastSeen, setDigitLastSeen]   = useState<number[]>(new Array(10).fill(-1));

    const store = useStore();
    const [runState, setRunState] = useState<RunState>('idle');
    const [runErr,   setRunErr]   = useState('');
    const [showRunConfig, setShowRunConfig] = useState(false);
    const [cfgStake,        setCfgStake]        = useState(DEFAULT_RUN_CFG.stake);
    const [cfgTakeProfit,   setCfgTakeProfit]   = useState(DEFAULT_RUN_CFG.takeProfit);
    const [cfgStopLoss,     setCfgStopLoss]     = useState(DEFAULT_RUN_CFG.stopLoss);
    const [cfgMartingale,   setCfgMartingale]   = useState(DEFAULT_RUN_CFG.martingale);
    const [cfgMartingaleOn, setCfgMartingaleOn] = useState(DEFAULT_RUN_CFG.martingaleOn);
    const [cfgEoRecovery,   setCfgEoRecovery]   = useState(DEFAULT_RUN_CFG.eoRecovery);

    // Live Market Watch — starts automatically on mount
    const [watchActive,    setWatchActive]    = useState(true);
    const [watchResults,   setWatchResults]   = useState<MarketResult[]>([]);
    const [watchSpikes,    setWatchSpikes]    = useState<Set<string>>(new Set());
    const [watchCountdown, setWatchCountdown] = useState(WATCH_INTERVAL_S);
    const [watchScanning,  setWatchScanning]  = useState(false);
    const watchCdRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [orbHistory, setOrbHistory] = useState<OrbHistoryEntry[]>(() => {
        try { return JSON.parse(localStorage.getItem('orb-signal-history') ?? '[]'); } catch { return []; }
    });

    const [derivStatus,   setDerivStatus]   = useState<DerivStatusResult | null>(null);
    const [statusChecked, setStatusChecked] = useState(false);
    const maintenanceActive = derivStatus !== null && derivStatus.indicator !== 'none';

    // Sync editable state when result arrives
    useEffect(() => {
        if (!result) return;
        if (tradeType === 'over_under') {
            const parts = result.direction.split(' ');
            setEditDir((parts[0] as 'OVER' | 'UNDER') ?? 'OVER');
            setEditBarrier(result.barrier ?? 5);
            // Set recovery mode from AI recommendation
            if (result.noRecoveryRecommended) {
                setEditRecoveryMode('none');
                setEditRecoveryBarrier(null);
            } else if (result.recoveryContractType === 'DIGITOVER') {
                setEditRecoveryMode('over');
                setEditRecoveryBarrier(result.recoveryBarrier);
            } else {
                setEditRecoveryMode('under');
                setEditRecoveryBarrier(result.recoveryBarrier);
            }
        } else if (tradeType === 'matches_differs') {
            const parts = result.direction.split(' ');
            setEditMatchesSide((parts[0] as 'MATCHES' | 'DIFFERS') ?? 'MATCHES');
            setEditTargetDigit(Number(parts[1]) || 0);
        } else {
            setEditDir((result.direction as 'EVEN' | 'ODD') ?? 'EVEN');
        }
        setEditEntryPoint(result.entryDigits[0]?.digit ?? 0);
        setHasSignal(true);
    }, [result, tradeType]);

    // Reset on trade type change
    useEffect(() => {
        setResult(null); setNoSigBest(null); setScanState('idle'); setHasSignal(false);
        setSpikedMarkets([]); setRunState('idle'); setRunErr('');
    }, [tradeType]);

    // Live Market Watch loop
    useEffect(() => {
        if (!watchActive || maintenanceActive) {
            if (watchCdRef.current) { clearInterval(watchCdRef.current); watchCdRef.current = null; }
            return;
        }
        let mounted = true, busy = false;
        const startCountdown = (from: number) => {
            if (watchCdRef.current) clearInterval(watchCdRef.current);
            let cd = from; setWatchCountdown(cd);
            watchCdRef.current = setInterval(() => {
                if (!mounted) return; cd--; setWatchCountdown(cd);
                if (cd <= 0) { clearInterval(watchCdRef.current!); watchCdRef.current = null; doScan(); }
            }, 1000);
        };
        const doScan = async () => {
            if (busy || !mounted) return; busy = true; setWatchScanning(true);
            let foundSignal = false;
            try {
                const { allResults, spikedMarkets: spikes } = await scanAllMarkets(tradeType, () => {});
                if (!mounted) return;
                const spikeSet = new Set(spikes.map(s => s.code));
                setWatchResults(allResults); setWatchSpikes(spikeSet);
                foundSignal = allResults.some(r =>
                    !spikeSet.has(r.sym.code) && !r.gapDetected &&
                    r.statsChecks.isSignal && !r.recentDominance.isCold
                );
            } catch { /* ignore */ } finally {
                busy = false;
                if (mounted) {
                    setWatchScanning(false);
                    // Signal found → re-validate after 90 s
                    // No signal → rescan immediately after a 3 s breath
                    startCountdown(foundSignal ? WATCH_INTERVAL_S : 3);
                }
            }
        };
        doScan();
        return () => { mounted = false; if (watchCdRef.current) { clearInterval(watchCdRef.current); watchCdRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchActive, tradeType, maintenanceActive]);

    // Live tick feed — tracks entry digit freshness (no longer gated on `open`)
    useEffect(() => {
        if (!result) {
            if (entryWsRef.current) { try { entryWsRef.current.close(); } catch { /* */ } entryWsRef.current = null; }
            setTicksSinceScan(0); setDigitLastSeen(new Array(10).fill(-1)); return;
        }
        if (entryWsRef.current) { try { entryWsRef.current.close(); } catch { /* */ } }
        let destroyed = false, localTicks = 0; const lastSeen = new Array(10).fill(-1);
        const ws = new WebSocket(DERIV_WS); entryWsRef.current = ws;
        ws.onopen = () => { ws.send(JSON.stringify({ ticks: result.sym.code, subscribe: 1, req_id: 998 })); };
        ws.onmessage = (ev: MessageEvent) => {
            if (destroyed) return; let msg: any; try { msg = JSON.parse(ev.data as string); } catch { return; }
            if (msg.msg_type !== 'tick') return; const price = parseFloat(msg.tick?.quote ?? '0'); if (!price) return;
            localTicks++; for (let d = 0; d < 10; d++) { if (lastSeen[d] >= 0) lastSeen[d]++; } lastSeen[lastDigitOf(price, result.pip)] = 0;
            setTicksSinceScan(localTicks); setDigitLastSeen([...lastSeen]);
        };
        ws.onerror = () => { /* */ }; ws.onclose = () => { if (entryWsRef.current === ws) entryWsRef.current = null; };
        return () => { destroyed = true; if (entryWsRef.current === ws) entryWsRef.current = null; try { ws.close(); } catch { /* */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result]);

    // ── Watchdog — live tick monitor per valid signal ─────────────────────────
    useEffect(() => {
        const validSigs = watchResults.filter(r =>
            !watchSpikes.has(r.sym.code) && !r.gapDetected &&
            r.statsChecks.isSignal && !r.recentDominance.isCold
        );
        const validCodes = new Set(validSigs.map(r => r.sym.code));

        // Close watchdogs for markets that are no longer valid
        watchdogWsRef.current.forEach((ws, code) => {
            if (!validCodes.has(code)) {
                try { ws.close(); } catch { /* */ }
                watchdogWsRef.current.delete(code);
            }
        });

        // Open watchdog for each newly-valid market
        validSigs.forEach(r => {
            if (watchdogWsRef.current.has(r.sym.code)) return;
            const winFn = makeWinFn(r);
            const buf: number[] = [];
            const code = r.sym.code;
            const ws = new WebSocket(DERIV_WS);
            ws.onopen = () => ws.send(JSON.stringify({ ticks: code, subscribe: 1, req_id: 997 }));
            ws.onmessage = (ev: MessageEvent) => {
                let msg: any; try { msg = JSON.parse(ev.data as string); } catch { return; }
                if (msg.msg_type !== 'tick') return;
                const price = parseFloat(msg.tick?.quote ?? '0'); if (!price) return;
                const digit = lastDigitOf(price, r.pip);
                buf.push(digit); if (buf.length > 40) buf.shift();
                if (buf.length < 5) return; // warm up — need a few ticks first
                const win = buf.slice(-Math.min(20, buf.length));
                const winPct = win.filter(winFn).length / win.length;
                const status: WatchdogEntry['status'] =
                    buf.length < 10 ? 'warming' :
                    winPct >= 0.60  ? 'holding' :
                    winPct >= 0.40  ? 'weakening' : 'reversed';
                setWatchdogMap(prev => { const m = new Map(prev); m.set(code, { status, winPct, ticks: buf.length }); return m; });
            };
            ws.onerror = ws.onclose = () => { watchdogWsRef.current.delete(code); };
            watchdogWsRef.current.set(code, ws);
        });

        // Remove stale watchdog state for markets no longer valid
        setWatchdogMap(prev => {
            const m = new Map(prev);
            m.forEach((_, code) => { if (!validCodes.has(code)) m.delete(code); });
            return m;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchResults, watchSpikes, tradeType]);

    // Cleanup all watchdog WebSockets on unmount
    useEffect(() => () => {
        watchdogWsRef.current.forEach(ws => { try { ws.close(); } catch { /* */ } });
        watchdogWsRef.current.clear();
    }, []);

    // Poll Deriv system status every 60 s
    useEffect(() => {
        let destroyed = false;
        const poll = async () => { if (destroyed) return; const s = await fetchDerivStatus(); if (!destroyed) { setDerivStatus(s); setStatusChecked(true); } };
        poll(); const id = setInterval(poll, STATUS_POLL_MS);
        return () => { destroyed = true; clearInterval(id); };
    }, []);

    // ── Scan ──────────────────────────────────────────────────────────────────
    const handleScan = useCallback(async () => {
        if (maintenanceActive) return;
        setScanState('scanning'); setProgress(0); setResult(null); setNoSigBest(null);
        setHasSignal(false); setSessionCount(0); setSpikedMarkets([]);
        try {
            const { best, noVotesBest, spikedMarkets: spikes } = await scanAllMarkets(tradeType, n => setProgress(n));
            setSpikedMarkets(spikes);
            if (best) {
                setResult(best); setScanState('done');
                try {
                    const entry: OrbHistoryEntry = { market: best.sym.short, direction: best.direction, votes: best.statsChecks.passCount, strength: best.signalStrength, time: Date.now() };
                    const prev: OrbHistoryEntry[] = JSON.parse(localStorage.getItem('orb-signal-history') ?? '[]');
                    const next = [entry, ...prev].slice(0, 5);
                    localStorage.setItem('orb-signal-history', JSON.stringify(next)); setOrbHistory(next);
                } catch { /* */ }
            } else { setNoSigBest(noVotesBest); setScanState('no-signal'); }
        } catch { setScanState('idle'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tradeType, maintenanceActive]);

    // ── Watch signal helpers ──────────────────────────────────────────────────
    const isWatchSignal = useCallback((r: MarketResult): boolean => {
        if (watchSpikes.has(r.sym.code) || r.gapDetected) return false;
        return r.statsChecks.isSignal && !r.recentDominance.isCold;
    }, [watchSpikes]);

    const openRunConfigDirect = useCallback(() => {
        let cfg: OrbRunConfig = DEFAULT_RUN_CFG;
        try { const raw = localStorage.getItem(ORB_RUN_CFG_KEY); if (raw) cfg = { ...DEFAULT_RUN_CFG, ...JSON.parse(raw) }; } catch { /* */ }
        setCfgStake(cfg.stake); setCfgTakeProfit(cfg.takeProfit); setCfgStopLoss(cfg.stopLoss); setCfgMartingale(cfg.martingale); setCfgMartingaleOn(cfg.martingaleOn); setCfgEoRecovery(cfg.eoRecovery ?? false);
        setRunState('idle'); setRunErr(''); setShowRunConfig(true);
    }, []);

    const loadWatchSignal = useCallback((r: MarketResult) => {
        setResult(r); setScanState('done'); setHasSignal(true); setSpikedMarkets([]);
        // Show the detail panel (don't skip straight to overlay) — scroll it into view
        setTimeout(() => {
            resultPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
    }, []);

    const openRunConfig = useCallback(() => {
        if (!result) return;
        let cfg: OrbRunConfig = DEFAULT_RUN_CFG;
        try { const raw = localStorage.getItem(ORB_RUN_CFG_KEY); if (raw) cfg = { ...DEFAULT_RUN_CFG, ...JSON.parse(raw) }; } catch { /* */ }
        setCfgStake(cfg.stake); setCfgTakeProfit(cfg.takeProfit); setCfgStopLoss(cfg.stopLoss); setCfgMartingale(cfg.martingale); setCfgMartingaleOn(cfg.martingaleOn); setCfgEoRecovery(cfg.eoRecovery ?? false);
        setRunState('idle'); setRunErr(''); setShowRunConfig(true);
    }, [result]);

    const handleExecuteTrade = useCallback(async () => {
        if (!result) return;
        setRunState('launching'); setRunErr('');
        try {
            const cfg: OrbRunConfig = { stake: cfgStake, takeProfit: cfgTakeProfit, stopLoss: cfgStopLoss, martingale: cfgMartingale, martingaleOn: cfgMartingaleOn, eoRecovery: cfgEoRecovery };
            try { localStorage.setItem(ORB_RUN_CFG_KEY, JSON.stringify(cfg)); } catch { /* */ }
            let direction: string, botId: string;
            if (tradeType === 'over_under') { direction = `${editDir} ${editBarrier}`; botId = destroyerBotIdFromDirection(direction); }
            else if (tradeType === 'matches_differs') { direction = `${editMatchesSide} ${editTargetDigit}`; botId = editMatchesSide === 'DIFFERS' ? 'differ-v2' : 'matches-signal'; }
            else { direction = editDir; botId = cfgEoRecovery ? 'even-odd-recovery' : 'even-odd-scanner'; }

            // ── Resolve recovery direction & contract type ───────────────────
            // 'none'  → retrade same direction (no flip); primary contractType reused
            // 'over'  → recover with DIGITOVER at chosen barrier
            // 'under' → recover with DIGITUNDER at chosen barrier
            const primaryCt = tradeType === 'over_under'
                ? (editDir === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER') : undefined;
            let recoveryBarrierFinal: number | undefined;
            let recoveryCt: string | undefined;
            if (tradeType === 'over_under') {
                if (editRecoveryMode === 'none') {
                    // Same direction = no flip — bot retrades primary side
                    recoveryBarrierFinal = editBarrier;
                    recoveryCt = primaryCt;
                } else {
                    recoveryBarrierFinal = editRecoveryBarrier ?? result.recoveryBarrier ?? editBarrier;
                    recoveryCt = editRecoveryMode === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
                }
            }

            const signal: BotSignal = {
                symbol: result.sym.code, symbolLabel: result.sym.label, direction,
                entryPoint: `Digit ${editEntryPoint}`, confidence: result.signalStrength, market: tradeType,
                recoveryBarrier: recoveryBarrierFinal,
                contractType: primaryCt,
                recoveryContractType: recoveryCt,
            };
            const stake = parseFloat(cfgStake) || 0.5, takeProfit = parseFloat(cfgTakeProfit) || 10, stopLoss = parseFloat(cfgStopLoss) || 30, martingale = cfgMartingaleOn ? (parseFloat(cfgMartingale) || 1.5) : 0;
            const doc = await fetchAndPatchBot(botId, signal, stake, takeProfit, stopLoss, martingale);
            const xmlStr = new XMLSerializer().serializeToString(doc.documentElement);
            const Blockly = (window as any).Blockly;
            if (!Blockly?.derivWorkspace) { setRunState('no-ws'); return; }
            const dom = Blockly.utils.xml.textToDom(xmlStr);
            Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
            Blockly.derivWorkspace.cleanUp(); Blockly.derivWorkspace.clearUndo();
            store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            setTimeout(() => { if (!store.run_panel.is_running) store.run_panel.onRunButtonClick(); setRunState('idle'); setShowRunConfig(false); }, 500);
        } catch (e: any) { setRunState('error'); setRunErr(e?.message || 'Failed to launch bot.'); }
    }, [result, tradeType, editDir, editBarrier, editRecoveryBarrier, editRecoveryMode, editMatchesSide, editTargetDigit, editEntryPoint, cfgStake, cfgTakeProfit, cfgStopLoss, cfgMartingale, cfgMartingaleOn, cfgEoRecovery, store]);

    // ── Derived display values ────────────────────────────────────────────────
    const vc = result ? voteColor(result.statsChecks.passCount) : '#6366f1';
    const recRuns = result ? calcRecRuns(result.statsChecks.passCount, result.winProb) : 5;
    const sessionOver = sessionCount >= recRuns;
    const runTargetLabel = tradeType === 'over_under' ? (editDir === 'UNDER' ? 'Under Destroyer' : 'Over Destroyer') : tradeType === 'matches_differs' ? (editMatchesSide === 'DIFFERS' ? 'Differ V2' : 'Matches') : 'Even Odd Scanner';
    const models: ModelResult[] = [];

    return (
        <div className='aisig-page'>
            <div className='aisig-page__inner'>

                {/* Page header */}
                <div className='aisig-page__hd'>
                    <div className='aisig-page__hd-left'>
                        <div className='ai-panel__hd-icon'><Zap size={14} /></div>
                        <div>
                            <span className='aisig-page__title'>AI Signals</span>
                            <span className='aisig-page__subtitle'>
                                {tradeType === 'even_odd' ? '4-Model Reversal Scanner' : '10-Model Consensus Scanner'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Deriv system status */}
                {statusChecked && (
                    <div className={`ai-panel__status-bar ai-panel__status-bar--${derivStatus?.indicator ?? 'none'}`}>
                        <span className='ai-panel__status-dot' />
                        <span className='ai-panel__status-msg'>
                            {maintenanceActive
                                ? `⛔ Deriv ${derivStatus!.indicator.toUpperCase()} — ${derivStatus!.description}. Scanning blocked until resolved.`
                                : `✅ Deriv Systems Operational`}
                        </span>
                        <span className='ai-panel__status-time'>
                            {derivStatus ? new Date(derivStatus.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                    </div>
                )}

                {/* Trade type */}
                <div className='ai-panel__type-row'>
                    {([
                        { t: 'over_under'      as TradeType, icon: '📈', label: 'Over / Under'     },
                        { t: 'even_odd'        as TradeType, icon: '⚖️', label: 'Even / Odd'       },
                        { t: 'matches_differs' as TradeType, icon: '🎯', label: 'Matches / Differs' },
                    ]).map(({ t, icon, label }) => (
                        <button key={t} className={`ai-panel__type-btn${tradeType === t ? ' ai-panel__type-btn--active' : ''}`} onClick={() => setTradeType(t)}>
                            <span className='ai-panel__type-icon'>{icon}</span>{label}
                        </button>
                    ))}
                </div>

                {/* ── Live Signal Feed — valid signals only ─────────────────── */}
                {(() => {
                    const eoMode      = tradeType === 'even_odd';
                    const maxVotes    = eoMode ? 4 : 10;
                    const validSigs   = watchResults.filter(r => isWatchSignal(r));
                    const hasResults  = watchResults.length > 0;

                    return (
                        <div className='aisig-feed'>
                            {/* Feed header */}
                            <div className='aisig-feed__hd'>
                                <div className='aisig-feed__hd-left'>
                                    <span className={`aisig-feed__pulse${watchScanning ? ' aisig-feed__pulse--scan' : validSigs.length > 0 ? ' aisig-feed__pulse--live' : ''}`} />
                                    <span className='aisig-feed__hd-title'>
                                        {watchScanning ? 'Scanning markets…' : validSigs.length > 0 ? `${validSigs.length} Active Signal${validSigs.length !== 1 ? 's' : ''}` : 'Scanning continuously…'}
                                    </span>
                                    {/* Only show countdown when a signal exists (re-validation timer) */}
                                    {!watchScanning && validSigs.length > 0 && (
                                        <span className='aisig-feed__cd'>↺ {watchCountdown}s</span>
                                    )}
                                </div>
                                <button
                                    className={`aisig-feed__toggle${watchActive ? ' aisig-feed__toggle--on' : ''}`}
                                    disabled={maintenanceActive}
                                    onClick={() => { setWatchActive(p => !p); if (watchActive) { setWatchResults([]); setWatchSpikes(new Set()); } }}
                                >
                                    {watchActive ? 'Pause' : 'Resume'}
                                </button>
                            </div>

                            {/* Scanning skeleton */}
                            {watchScanning && watchResults.length === 0 && (
                                <div className='aisig-feed__scanning'>
                                    <Loader2 size={16} className='ai-panel__spin' />
                                    <span>Analysing {ALL_SYMS.length} markets across 4 timeframes…</span>
                                </div>
                            )}

                            {/* Paused empty */}
                            {!watchActive && !watchScanning && watchResults.length === 0 && (
                                <div className='aisig-feed__paused'>Scanner paused — tap Resume to start.</div>
                            )}

                            {/* No valid signals found */}
                            {!watchScanning && hasResults && validSigs.length === 0 && (
                                <div className='aisig-feed__nosig'>
                                    <span className='aisig-feed__nosig-icon'>🔍</span>
                                    <div>
                                        <div className='aisig-feed__nosig-title'>No qualifying signals yet</div>
                                        <div className='aisig-feed__nosig-sub'>Scanning all markets continuously until a signal is found…</div>
                                    </div>
                                </div>
                            )}

                            {/* Valid signal cards */}
                            {validSigs.length > 0 && (
                                <div className='aisig-feed__cards'>
                                    {validSigs.map(r => {
                                        const vc2 = voteColor(r.statsChecks.passCount);
                                        const bestEntry = r.entryDigits[0];
                                        const domLabel = r.recentDominance.label;
                                        return (
                                            <div key={r.sym.code} className='aisig-card'>
                                                {/* Card top row: market */}
                                                <div className='aisig-card__top'>
                                                    <div className='aisig-card__market'>
                                                        <span className='aisig-card__live-dot' />
                                                        <span className='aisig-card__sym'>{r.sym.short}</span>
                                                        <span className='aisig-card__label'>{r.sym.label}</span>
                                                    </div>
                                                </div>

                                                {/* Direction */}
                                                <div className='aisig-card__dir' style={{ color: vc2 }}>
                                                    {r.direction}
                                                </div>

                                                {/* Stats grid */}
                                                <div className='aisig-card__stats'>
                                                    <div className='aisig-card__stat'>
                                                        <span className='aisig-card__stat-lbl'>Confidence</span>
                                                        <span className='aisig-card__stat-val' style={{ color: vc2 }}>{r.signalStrength}%</span>
                                                    </div>
                                                    <div className='aisig-card__stat'>
                                                        <span className='aisig-card__stat-lbl'>Win Prob</span>
                                                        <span className='aisig-card__stat-val'>{(r.winProb * 100).toFixed(1)}%</span>
                                                    </div>
                                                    <div className='aisig-card__stat'>
                                                        <span className='aisig-card__stat-lbl'>Entry Digit</span>
                                                        <span className='aisig-card__stat-val aisig-card__entry'>
                                                            {bestEntry != null ? bestEntry.digit : '—'}
                                                            {bestEntry != null && <span className='aisig-card__entry-wait'>~{bestEntry.avgWaitTicks}t</span>}
                                                        </span>
                                                    </div>
                                                    <div className='aisig-card__stat'>
                                                        <span className='aisig-card__stat-lbl'>Momentum</span>
                                                        <span className={`aisig-card__dom aisig-card__dom--${domLabel.toLowerCase()}`}>{domLabel}</span>
                                                    </div>
                                                </div>

                                                {/* TF agreement bar */}
                                                <div className='aisig-card__tf'>
                                                    {[0,1,2,3].map(i => (
                                                        <span key={i} className={`aisig-card__tf-seg${i < r.tfAgreement ? ' aisig-card__tf-seg--on' : ''}`} />
                                                    ))}
                                                    <span className='aisig-card__tf-lbl'>{r.tfAgreement}/4 timeframes agree</span>
                                                </div>

                                                {/* Watchdog status */}
                                                {(() => {
                                                    const wd = watchdogMap.get(r.sym.code);
                                                    if (!wd || wd.status === 'warming') return (
                                                        <div className='aisig-card__watchdog aisig-card__watchdog--warming'>
                                                            <span className='aisig-card__watchdog-dot' />
                                                            <span>Watchdog warming up…</span>
                                                        </div>
                                                    );
                                                    return (
                                                        <div className={`aisig-card__watchdog aisig-card__watchdog--${wd.status}`}>
                                                            <span className='aisig-card__watchdog-dot' />
                                                            <span className='aisig-card__watchdog-label'>
                                                                {wd.status === 'holding'   ? '● HOLDING'            : ''}
                                                                {wd.status === 'weakening' ? '◐ WEAKENING — caution': ''}
                                                                {wd.status === 'reversed'  ? '● REVERSED — STOP'    : ''}
                                                            </span>
                                                            <span className='aisig-card__watchdog-pct'>{(wd.winPct * 100).toFixed(0)}% live</span>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Load & Run */}
                                                <button className='aisig-card__run' onClick={() => loadWatchSignal(r)}>
                                                    <PlayCircle size={14} />
                                                    Load &amp; Run
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Spike warning */}
                {spikedMarkets.length > 0 && scanState !== 'scanning' && (
                    <div className='ai-panel__spike-banner'>
                        <span className='ai-panel__spike-icon'>⚡</span>
                        <div className='ai-panel__spike-content'>
                            <span className='ai-panel__spike-title'>Spike Detected — Markets Skipped</span>
                            <span className='ai-panel__spike-mkts'>{spikedMarkets.map(s => `${s.label} (${s.sigma}σ)`).join(' · ')}</span>
                            <span className='ai-panel__spike-hint'>Signal generated from clean markets only.</span>
                        </div>
                    </div>
                )}

                {/* Progress dots */}
                {scanState === 'scanning' && (
                    <div className='ai-panel__dots'>
                        {ALL_SYMS.map((s, i) => (
                            <span key={s.code} className={`ai-panel__dot${i < progress ? ' ai-panel__dot--done' : ' ai-panel__dot--wait'}`} title={s.short} />
                        ))}
                    </div>
                )}

                {/* No signal */}
                {scanState === 'no-signal' && (
                    <div className='ai-panel__nosig'>
                        <div className='ai-panel__nosig-hd'><span className='ai-panel__nosig-icon'>⚠️</span><span className='ai-panel__nosig-txt'>No strong signal found</span></div>
                        {noSigBest && (<div className='ai-panel__nosig-best'><span>Best: <strong>{noSigBest.sym.short}</strong></span><span className='ai-panel__nosig-votes' style={{ color: voteColor(noSigBest.statsChecks.passCount) }}>{noSigBest.statsChecks.passCount}/{noSigBest.statsChecks.totalChecks} checks</span></div>)}
                        {noSigBest && noSigBest.recentDominance?.isCold && (<div className='ai-panel__nosig-dom-warn'>⛔ Best candidate blocked — last 20 ticks only {noSigBest.recentDominance.winsLast20}/20 on win side. Market recently reversed. Wait for momentum to recover.</div>)}
                        <span className='ai-panel__nosig-hint'>Try again in a few minutes or switch trade type.</span>
                    </div>
                )}

                {/* Signal result */}
                {scanState === 'done' && result && (
                    <div className='ai-panel__result' ref={resultPanelRef}>

                        {/* Market header */}
                        <div className='ai-panel__mkt' style={{ '--vc': vc } as React.CSSProperties}>
                            <div className='ai-panel__mkt-left'>
                                <button
                                    className='aisig-back-btn'
                                    onClick={() => { setResult(null); setScanState('idle'); setHasSignal(false); }}
                                >
                                    ← Back
                                </button>
                                <span className='ai-panel__mkt-short'>{result.sym.short}</span>
                                <span className='ai-panel__mkt-label'>{result.sym.label}</span>
                                <span className='ai-panel__mkt-samples'>{(result.sampleSize / 1000).toFixed(1)}k ticks analysed</span>
                            </div>
                            <div className='ai-panel__mkt-right'>
                                <div className='ai-panel__strength-badge' style={{ background: `${vc}18`, borderColor: `${vc}50`, color: vc }}>
                                    <span className='ai-panel__strength-votes'>{result.signalStrength}%</span>
                                    <span className='ai-panel__strength-label'>Confidence</span>
                                </div>
                                <div className={`ai-panel__regime-badge ai-panel__regime-badge--${result.tfAgreement >= 3 ? 'ok' : 'warn'}`}>
                                    <span>{result.tfAgreement}/4 TF</span>
                                    <span className='ai-panel__regime-score'>{result.regimeScore}%</span>
                                </div>
                            </div>
                        </div>

                        {/* Watchdog alert on detail panel */}
                        {(() => {
                            const wd = watchdogMap.get(result.sym.code);
                            if (!wd || wd.status === 'warming') return null;
                            return (
                                <div className={`ai-watchdog-alert ai-watchdog-alert--${wd.status}`}>
                                    <div className='ai-watchdog-alert__top'>
                                        <span className='ai-watchdog-alert__dot' />
                                        <span className='ai-watchdog-alert__title'>
                                            {wd.status === 'holding'   && '🟢 Dominance Holding'}
                                            {wd.status === 'weakening' && '🟡 Dominance Weakening'}
                                            {wd.status === 'reversed'  && '🔴 Dominance Reversed'}
                                        </span>
                                        <span className='ai-watchdog-alert__pct'>{(wd.winPct * 100).toFixed(0)}% win rate (live)</span>
                                    </div>
                                    {wd.status === 'weakening' && (
                                        <p className='ai-watchdog-alert__msg'>Winning pattern is fading on live ticks. Reduce stake or pause until dominance recovers.</p>
                                    )}
                                    {wd.status === 'reversed' && (
                                        <p className='ai-watchdog-alert__msg'>⛔ The winning side has flipped on live ticks. Stop trading this signal — wait for a fresh scan.</p>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Direction call */}
                        <div className='ai-panel__call' style={{ borderColor: `${vc}40` }}>
                            <span className='ai-panel__call-lbl'>Signal Direction</span>
                            <span className='ai-panel__call-val' style={{ color: vc }}>{result.direction}</span>
                        </div>

                        {/* ── Frequency Alignment Monitor ─────────────────────────────── */}
                        {result.statsChecks.freqAlignment && (() => {
                            const fa = result.statsChecks.freqAlignment!;
                            const mc = result.statsChecks.microConfirm;
                            const allGreen = fa.allAgree;
                            return (
                                <div className={`ai-freq-monitor ai-freq-monitor--${allGreen ? 'ok' : 'warn'}`}>
                                    <div className='ai-freq-monitor__hd'>
                                        <span className='ai-freq-monitor__title'>📊 Frequency Alignment</span>
                                        <span className={`ai-freq-monitor__badge ai-freq-monitor__badge--${allGreen ? 'ok' : 'warn'}`}>
                                            {allGreen ? '✓ All aligned' : `${fa.alignScore}% aligned`}
                                        </span>
                                    </div>
                                    <div className='ai-freq-monitor__hint'>
                                        Win-side % must be &gt;50% across ALL windows before a signal fires.
                                    </div>
                                    <div className='ai-freq-monitor__table'>
                                        {fa.windows.map(w => {
                                            const pct = (w.winPct * 100).toFixed(1);
                                            const ok = w.dominant;
                                            return (
                                                <div key={w.size} className='ai-freq-monitor__row'>
                                                    <span className='ai-freq-monitor__window'>{w.size}t</span>
                                                    <div className='ai-freq-monitor__bar-wrap'>
                                                        <div className='ai-freq-monitor__bar-fill'
                                                            style={{ width: `${Math.min(100, w.winPct * 100)}%`, background: ok ? '#10b981' : '#ef4444' }} />
                                                        <div className='ai-freq-monitor__bar-mid' />
                                                    </div>
                                                    <span className='ai-freq-monitor__pct' style={{ color: ok ? '#34d399' : '#fca5a5' }}>{pct}%</span>
                                                    <span className='ai-freq-monitor__status'>{ok ? '✓' : '✗'}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {!allGreen && (
                                        <div className='ai-freq-monitor__block-warn'>
                                            ⛔ Regime not fully aligned — signal blocked. Wait for all windows to agree.
                                        </div>
                                    )}
                                    {/* Micro-confirmation entry status */}
                                    {mc && (
                                        <div className={`ai-freq-monitor__micro ai-freq-monitor__micro--${mc.pass ? 'ok' : 'pending'}`}>
                                            <span className='ai-freq-monitor__micro-lbl'>Entry micro-confirm (last 2 ticks):</span>
                                            <span className='ai-freq-monitor__micro-ticks'>
                                                {mc.last2.map((win, i) => (
                                                    <span key={i} className={`ai-freq-monitor__micro-tick ai-freq-monitor__micro-tick--${win ? 'win' : 'loss'}`}>
                                                        {win ? '●' : '○'}
                                                    </span>
                                                ))}
                                            </span>
                                            <span className={`ai-freq-monitor__micro-status ai-freq-monitor__micro-status--${mc.pass ? 'ok' : 'pending'}`}>
                                                {mc.pass ? '⚡ Enter now' : 'Wait…'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Recent Dominance */}
                        <div className={`ai-panel__dom ai-panel__dom--${result.recentDominance.label.toLowerCase()}`}>
                            <div className='ai-panel__dom-hd'>
                                <div className='ai-panel__dom-title-row'><span className='ai-panel__dom-title'>Digit Dominance</span><span className='ai-panel__dom-sub'>last 20 ticks</span></div>
                                <span className={`ai-panel__dom-pill ai-panel__dom-pill--${result.recentDominance.label.toLowerCase()}`}>{result.recentDominance.label}</span>
                            </div>
                            <div className='ai-panel__dom-pips'>{result.recentDominance.last20Results.map((win, idx) => (<span key={idx} className={`ai-panel__dom-pip${win ? ' ai-panel__dom-pip--win' : ' ai-panel__dom-pip--loss'}`} />))}</div>
                            <div className='ai-panel__dom-bar-track'>
                                <div className='ai-panel__dom-bar-fill' style={{ width: `${result.recentDominance.last20WinPct * 100}%` }} />
                                <div className='ai-panel__dom-mark ai-panel__dom-mark--cold' style={{ left: '35%' }}><span className='ai-panel__dom-mark-label'>Block</span></div>
                                <div className='ai-panel__dom-mark ai-panel__dom-mark--hot' style={{ left: '65%' }}><span className='ai-panel__dom-mark-label'>Hot</span></div>
                            </div>
                            <div className='ai-panel__dom-stats'>
                                <span className='ai-panel__dom-stat'><strong style={{ color: result.recentDominance.last20WinPct >= 0.65 ? '#10b981' : result.recentDominance.last20WinPct <= 0.35 ? '#ef4444' : '#f59e0b' }}>{result.recentDominance.winsLast20}/20</strong>{' '}win side</span>
                                <span className='ai-panel__dom-stat'><strong>{result.recentDominance.winsLast50}/50</strong>{' '}(50 ticks)</span>
                                <span className='ai-panel__dom-stat'>{(result.recentDominance.last20WinPct * 100).toFixed(0)}%</span>
                            </div>
                            {result.recentDominance.isHot && (<div className='ai-panel__dom-hot-msg'>🔥 Market is HOT on this signal — enter on next entry digit</div>)}
                        </div>

                        {/* Win prob */}
                        <div className='ai-panel__prob-row'><span className='ai-panel__prob-lbl'>Win Probability</span><span className='ai-panel__prob-val' style={{ color: vc }}>{(result.winProb * 100).toFixed(1)}%</span></div>
                        <div className='ai-panel__prob-bar'><div className='ai-panel__prob-fill' style={{ width: `${result.winProb * 100}%`, background: `linear-gradient(90deg, ${vc}88, ${vc})` }} /><div className='ai-panel__prob-mid' /></div>

                        {/* Prediction */}
                        <div className='ai-panel__pred'>
                            <span className='ai-panel__section-lbl'>Prediction</span>
                            {tradeType === 'even_odd' ? (
                                <>
                                <div className='ai-panel__seg'>{(['EVEN', 'ODD'] as const).map(d => (<button key={d} className={`ai-panel__seg-btn${editDir === d ? ' ai-panel__seg-btn--active' : ''}`} onClick={() => setEditDir(d)}>{d}</button>))}</div>
                                {(() => {
                                    const rec = eoRecoveryRec(result.statsChecks);
                                    const cls = rec.recommended ? 'yes' : rec.neutral ? 'neutral' : 'no';
                                    const icon = rec.recommended ? '✅' : rec.neutral ? '⚠️' : '🚫';
                                    return (
                                        <div className={`ai-panel__eo-rec ai-panel__eo-rec--${cls}`}>
                                            <div className='ai-panel__eo-rec-hd'>
                                                <span className='ai-panel__eo-rec-icon'>{icon}</span>
                                                <span className='ai-panel__eo-rec-title'>Recovery after loss</span>
                                                <span className={`ai-panel__eo-rec-pill ai-panel__eo-rec-pill--${cls}`}>{rec.label}</span>
                                            </div>
                                            <p className='ai-panel__eo-rec-reason'>{rec.reason}</p>
                                        </div>
                                    );
                                })()}
                                </>
                            ) : tradeType === 'matches_differs' ? (
                                <div className='ai-panel__pred-md'>
                                    <div className='ai-panel__seg' style={{ marginBottom: 8 }}>{(['MATCHES', 'DIFFERS'] as const).map(s => (<button key={s} className={`ai-panel__seg-btn${editMatchesSide === s ? ' ai-panel__seg-btn--active' : ''}`} onClick={() => setEditMatchesSide(s)}>{s}</button>))}</div>
                                    <div className='ai-panel__barrier'><span className='ai-panel__barrier-lbl'>Target digit <span className='ai-panel__barrier-rec'>(AI: {result.barrier ?? '?'}★)</span></span><div className='ai-panel__barrier-grid ai-panel__barrier-grid--10'>{[0,1,2,3,4,5,6,7,8,9].map(b => (<button key={b} className={`ai-panel__barrier-btn${editTargetDigit === b ? ' ai-panel__barrier-btn--sel' : ''}${result.barrier === b ? ' ai-panel__barrier-btn--rec' : ''}`} onClick={() => setEditTargetDigit(b)}>{b}</button>))}</div></div>
                                </div>
                            ) : (
                                <div className='ai-panel__pred-ou'>
                                    <div className='ai-panel__seg' style={{ marginBottom: 8 }}>{(['OVER', 'UNDER'] as const).map(d => (<button key={d} className={`ai-panel__seg-btn${editDir === d ? ' ai-panel__seg-btn--active' : ''}`} onClick={() => setEditDir(d)}>{d}</button>))}</div>
                                    <div className='ai-panel__barrier'><span className='ai-panel__barrier-lbl'>Barrier <span className='ai-panel__barrier-rec'>(AI: {result.barrier ?? '?'}★)</span></span><div className='ai-panel__barrier-grid'>{[1,2,3,4,5,6,7,8].map(b => (<button key={b} className={`ai-panel__barrier-btn${editBarrier === b ? ' ai-panel__barrier-btn--sel' : ''}${result.barrier === b ? ' ai-panel__barrier-btn--rec' : ''}`} onClick={() => setEditBarrier(b)}>{b}</button>))}</div></div>
                                    <div className='ai-rec-panel'>
                                        <div className='ai-rec-panel__hd'>
                                            <span className='ai-rec-panel__title'>🔄 Recovery after loss</span>
                                            <span className='ai-rec-panel__hint'>Choose your recovery direction &amp; barrier</span>
                                        </div>

                                        {/* No Recovery */}
                                        <button
                                            className={`ai-rec-none${editRecoveryMode === 'none' ? ' ai-rec-none--active' : ''}`}
                                            onClick={() => setEditRecoveryMode('none')}
                                        >
                                            <span className='ai-rec-none__icon'>🚫</span>
                                            <span className='ai-rec-none__lbl'>No Recovery — trade straight only</span>
                                            {result.noRecoveryRecommended && (
                                                <span className='ai-rec-badge ai-rec-badge--ai'>★ AI Recommended</span>
                                            )}
                                            {editRecoveryMode === 'none' && (
                                                <span className='ai-rec-badge ai-rec-badge--sel'>Selected</span>
                                            )}
                                        </button>

                                        {/* Recovery grid — OVER options */}
                                        <div className='ai-rec-section-lbl'>Recover with OVER</div>
                                        <div className='ai-rec-grid'>
                                            {[1,2,3,4,5,6,7,8].map(b => {
                                                const opt = result.recoveryOptions.find(o => o.side === 'OVER' && o.barrier === b)!;
                                                const sel = editRecoveryMode === 'over' && editRecoveryBarrier === b;
                                                return (
                                                    <button
                                                        key={`ov-${b}`}
                                                        className={`ai-rec-opt ai-rec-opt--${opt?.safety ?? 'marginal'}${sel ? ' ai-rec-opt--sel' : ''}`}
                                                        onClick={() => { setEditRecoveryMode('over'); setEditRecoveryBarrier(b); }}
                                                    >
                                                        <span className='ai-rec-opt__dir'>OVER {b}</span>
                                                        <span className='ai-rec-opt__wins'>{opt?.windowsPass ?? 0}/4</span>
                                                        <span className='ai-rec-opt__safety'>
                                                            {opt?.safety === 'safe' ? '✅' : opt?.safety === 'marginal' ? '⚠️' : '⛔'}
                                                        </span>
                                                        {opt?.isAiPick && <span className='ai-rec-opt__ai'>★</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Recovery grid — UNDER options */}
                                        <div className='ai-rec-section-lbl'>Recover with UNDER</div>
                                        <div className='ai-rec-grid'>
                                            {[1,2,3,4,5,6,7,8].map(b => {
                                                const opt = result.recoveryOptions.find(o => o.side === 'UNDER' && o.barrier === b)!;
                                                const sel = editRecoveryMode === 'under' && editRecoveryBarrier === b;
                                                return (
                                                    <button
                                                        key={`un-${b}`}
                                                        className={`ai-rec-opt ai-rec-opt--${opt?.safety ?? 'marginal'}${sel ? ' ai-rec-opt--sel' : ''}`}
                                                        onClick={() => { setEditRecoveryMode('under'); setEditRecoveryBarrier(b); }}
                                                    >
                                                        <span className='ai-rec-opt__dir'>UNDER {b}</span>
                                                        <span className='ai-rec-opt__wins'>{opt?.windowsPass ?? 0}/4</span>
                                                        <span className='ai-rec-opt__safety'>
                                                            {opt?.safety === 'safe' ? '✅' : opt?.safety === 'marginal' ? '⚠️' : '⛔'}
                                                        </span>
                                                        {opt?.isAiPick && <span className='ai-rec-opt__ai'>★</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Current selection summary */}
                                        <div className={`ai-rec-summary ai-rec-summary--${editRecoveryMode === 'none' ? 'none' : (result.recoveryOptions.find(o => o.side === editRecoveryMode.toUpperCase() && o.barrier === editRecoveryBarrier)?.safety ?? 'marginal')}`}>
                                            {editRecoveryMode === 'none'
                                                ? '🚫 No recovery — bot retrades same direction after a loss'
                                                : (() => {
                                                    const opt = result.recoveryOptions.find(o => o.side === editRecoveryMode.toUpperCase() as 'OVER'|'UNDER' && o.barrier === editRecoveryBarrier);
                                                    const safety = opt?.safety ?? 'marginal';
                                                    const icon = safety === 'safe' ? '✅' : safety === 'marginal' ? '⚠️' : '⛔';
                                                    const msg = safety === 'safe' ? 'Safe recovery market' : safety === 'marginal' ? 'Marginal — acceptable risk' : 'Unsafe — consider a different option';
                                                    return `${icon} ${editRecoveryMode.toUpperCase()} ${editRecoveryBarrier} — ${msg}`;
                                                })()
                                            }
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Entry points */}
                        {result.entryDigits.length > 0 && (
                            <div className='ai-panel__entries'>
                                <div className='ai-panel__entries-hd'>
                                    <span className='ai-panel__section-lbl'>Entry Points<em className='ai-panel__section-hint'> — wait for this digit; timing accounts for bot delay</em></span>
                                    {ticksSinceScan > 0 && (<span className='ai-panel__entry-tick-ctr'>{ticksSinceScan} tick{ticksSinceScan !== 1 ? 's' : ''} live</span>)}
                                </div>
                                <div className='ai-panel__entry-grid ai-panel__entry-grid--3'>
                                    {result.entryDigits.map((e, i) => {
                                        const selected = editEntryPoint === e.digit; const lastSeen = digitLastSeen[e.digit];
                                        const stale = ticksSinceScan > 0 && lastSeen > e.avgWaitTicks * 2; const fresh = lastSeen === 0;
                                        const tagLabel = i === 0 ? '★ Best' : i === 1 ? '◎ Alt 1' : '◎ Alt 2';
                                        const waitColor = e.skipAdjustedWait === 0 ? '#10b981' : e.skipAdjustedWait <= 5 ? '#f59e0b' : '#ef4444';
                                        return (
                                            <div key={e.digit} className={['ai-panel__entry-card', i === 0 ? 'ai-panel__entry-card--rec' : '', selected ? 'ai-panel__entry-card--selected' : '', fresh ? 'ai-panel__entry-card--fresh' : '', stale ? 'ai-panel__entry-card--stale' : ''].join(' ').trim()} role='button' style={{ cursor: 'pointer', outline: selected ? `2px solid ${vc}` : 'none' }} onClick={() => setEditEntryPoint(e.digit)}>
                                                {fresh && <span className='ai-panel__entry-now'>NOW</span>}
                                                {stale && !fresh && <span className='ai-panel__entry-stale-badge'>STALE</span>}
                                                <div className='ai-panel__entry-digit' style={{ color: i === 0 ? vc : '#e2e8f0' }}>{e.digit}</div>
                                                <div className='ai-panel__entry-meta'><span className='ai-panel__entry-tag'>{tagLabel}</span><span className='ai-panel__entry-pct' style={{ color: i === 0 ? vc : '#94a3b8' }}>{(e.conditional * 100).toFixed(1)}%</span></div>
                                                <div className='ai-panel__entry-wait' style={{ color: waitColor }}>{e.skipAdjustedWait === 0 ? '⚡ due after skip' : `~${e.skipAdjustedWait}t after skip`}</div>
                                                {lastSeen >= 0 && !fresh && (<div className={`ai-panel__entry-seen${stale ? ' ai-panel__entry-seen--stale' : ''}`}>{lastSeen}t ago</div>)}
                                                {lastSeen < 0 && ticksSinceScan > 0 && (<div className='ai-panel__entry-seen ai-panel__entry-seen--waiting'>waiting…</div>)}
                                            </div>
                                        );
                                    })}
                                </div>
                                {result.entryDigits.some(e => digitLastSeen[e.digit] > e.avgWaitTicks * 2 && ticksSinceScan > 0) && (<div className='ai-panel__entry-stale-warn'>⚠️ Entry condition is stale — market may have shifted. Consider re-scanning.</div>)}
                            </div>
                        )}

                        {/* Session discipline */}
                        <div className={`ai-panel__session${sessionOver ? ' ai-panel__session--over' : ''}`}>
                            <div className='ai-panel__session-top'>
                                <div className='ai-panel__session-left'><span className='ai-panel__session-icon'>🎯</span><div><span className='ai-panel__session-title'>Session Limit</span><span className='ai-panel__session-sub'>Max contracts recommended</span></div></div>
                                <div className='ai-panel__session-num' style={{ color: sessionOver ? '#ef4444' : '#10b981' }}>{recRuns}</div>
                            </div>
                            <div className='ai-panel__session-bar-track'><div className='ai-panel__session-bar-fill' style={{ width: `${Math.min(100, (sessionCount / recRuns) * 100)}%`, background: sessionOver ? 'linear-gradient(90deg,#ef444499,#ef4444)' : sessionCount >= recRuns * 0.75 ? 'linear-gradient(90deg,#f59e0b99,#f59e0b)' : 'linear-gradient(90deg,#10b98199,#10b981)' }} /></div>
                            <div className='ai-panel__session-counter'><div className='ai-panel__session-tally'><button className='ai-panel__session-adj' onClick={() => setSessionCount(p => Math.max(0, p - 1))}>−</button><span className='ai-panel__session-count'><span style={{ color: sessionOver ? '#ef4444' : '#e2e8f0' }}>{sessionCount}</span><span className='ai-panel__session-of'>/ {recRuns}</span></span><button className='ai-panel__session-adj' onClick={() => setSessionCount(p => p + 1)}>+</button><button className='ai-panel__session-reset' onClick={() => setSessionCount(0)} title='Reset counter'>↺</button></div><span className='ai-panel__session-trades-lbl'>contracts run</span></div>
                            {sessionOver && (<div className='ai-panel__session-warn'>🛑 Limit reached — stop trading this session</div>)}
                            {!sessionOver && sessionCount >= Math.ceil(recRuns * 0.75) && (<div className='ai-panel__session-caution'>⚠️ Approaching limit — consider stopping soon</div>)}
                            {sessionCount === 0 && (<div className='ai-panel__session-hint'>Tap + after each contract · tap ↺ to reset</div>)}
                        </div>

                        {/* Signal history */}
                        {orbHistory.length > 0 && (
                            <div className='ai-panel__history'>
                                <span className='ai-panel__section-lbl'>Recent Signals</span>
                                {orbHistory.map((h, i) => (
                                    <div key={i} className='ai-panel__history-row'>
                                        <span className='ai-panel__history-market'>{h.market}</span>
                                        <span className='ai-panel__history-dir'>{h.direction}</span>
                                        <span className='ai-panel__history-str'>{h.strength}%</span>
                                        <span className='ai-panel__history-time'>{new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* bottom spacer so sticky bar doesn't cover last card */}
                        <div style={{ height: 80 }} />

                    </div>
                )}

            </div>

            {/* ── Sticky Save & Run bar ──────────────────────────────────────── */}
            {scanState === 'done' && result && !showRunConfig && (
                <div className='aisig-sticky-bar'>
                    <button className='aisig-sticky-bar__btn' disabled={runState === 'launching'} onClick={openRunConfig}>
                        <PlayCircle size={17} />
                        Save &amp; Run
                    </button>
                </div>
            )}

            {/* ── Run-config overlay ─────────────────────────────────────────── */}
            {showRunConfig && (
                <div className='ai-runcfg__overlay' onClick={() => runState !== 'launching' && setShowRunConfig(false)}>
                    <div className='ai-runcfg' onClick={e => e.stopPropagation()}>
                        <div className='ai-runcfg__header'>
                            <span>Set Trade Parameters</span>
                            <button className='ai-runcfg__close' disabled={runState === 'launching'} onClick={() => setShowRunConfig(false)}><X size={16} /></button>
                        </div>
                        <div className='ai-runcfg__sub'>Deploying to <strong>{runTargetLabel}</strong> — market, prediction and entry point are already set from the AI signal.</div>
                        <label className='ai-runcfg__field'><span>Stake</span><input type='number' min='0' step='0.01' value={cfgStake} onChange={e => setCfgStake(e.target.value)} /></label>
                        <label className='ai-runcfg__field'><span>Target Profit</span><input type='number' min='0' step='0.01' value={cfgTakeProfit} onChange={e => setCfgTakeProfit(e.target.value)} /></label>
                        <label className='ai-runcfg__field'><span>Stop Loss</span><input type='number' min='0' step='0.01' value={cfgStopLoss} onChange={e => setCfgStopLoss(e.target.value)} /></label>
                        <div className='ai-runcfg__mart'>
                            <label className='ai-runcfg__mart-toggle'><input type='checkbox' checked={cfgMartingaleOn} onChange={e => setCfgMartingaleOn(e.target.checked)} /><span>Martingale</span></label>
                            <input type='number' min='0' step='0.1' value={cfgMartingale} disabled={!cfgMartingaleOn} onChange={e => setCfgMartingale(e.target.value)} className='ai-runcfg__mart-input' />
                        </div>
                        <span className='ai-runcfg__mart-hint'>{cfgMartingaleOn ? 'Stake multiplies by this factor after a loss.' : 'Off — martingale is reset to 0, stake stays flat after a loss.'}</span>

                        {/* ── Recovery picker (Over/Under only) ──────────────── */}
                        {tradeType === 'over_under' && result && (() => {
                            const aiRec = result.noRecoveryRecommended
                                ? '🚫 No Recovery'
                                : result.recoveryContractType === 'DIGITOVER'
                                    ? `OVER ${result.recoveryBarrier}`
                                    : `UNDER ${result.recoveryBarrier}`;
                            const selOpt = editRecoveryMode !== 'none'
                                ? result.recoveryOptions.find(o => o.side === editRecoveryMode.toUpperCase() as 'OVER'|'UNDER' && o.barrier === editRecoveryBarrier)
                                : null;
                            return (
                                <div className='ai-runcfg__rec'>
                                    <div className='ai-runcfg__rec-hd'>
                                        <span className='ai-runcfg__rec-title'>Recovery after loss</span>
                                        <span className='ai-runcfg__rec-ai'>AI: {aiRec} ★</span>
                                    </div>

                                    {/* No Recovery toggle */}
                                    <button
                                        className={`ai-runcfg__rec-none${editRecoveryMode === 'none' ? ' ai-runcfg__rec-none--on' : ''}`}
                                        onClick={() => setEditRecoveryMode('none')}
                                    >
                                        <span>🚫 No Recovery</span>
                                        <span className='ai-runcfg__rec-none__sub'>Bot retrades same direction after a loss</span>
                                        {editRecoveryMode === 'none' && <span className='ai-runcfg__rec-pill ai-runcfg__rec-pill--on'>ON</span>}
                                    </button>

                                    {/* OVER / UNDER direction */}
                                    <div className='ai-runcfg__rec-dirs'>
                                        {(['over', 'under'] as const).map(dir => (
                                            <button
                                                key={dir}
                                                className={`ai-runcfg__rec-dir${editRecoveryMode === dir ? ' ai-runcfg__rec-dir--on' : ''}`}
                                                onClick={() => setEditRecoveryMode(dir)}
                                            >
                                                {dir.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Barrier grid — shown when direction chosen */}
                                    {editRecoveryMode !== 'none' && (
                                        <div className='ai-runcfg__rec-grid'>
                                            {[1,2,3,4,5,6,7,8].map(b => {
                                                const opt = result.recoveryOptions.find(o => o.side === editRecoveryMode.toUpperCase() as 'OVER'|'UNDER' && o.barrier === b);
                                                const sel = editRecoveryBarrier === b;
                                                const s = opt?.safety ?? 'marginal';
                                                return (
                                                    <button
                                                        key={b}
                                                        className={`ai-runcfg__rec-cell ai-runcfg__rec-cell--${s}${sel ? ' ai-runcfg__rec-cell--sel' : ''}`}
                                                        onClick={() => setEditRecoveryBarrier(b)}
                                                    >
                                                        <span className='ai-runcfg__rec-cell__num'>{b}</span>
                                                        <span className='ai-runcfg__rec-cell__icon'>
                                                            {s === 'safe' ? '✅' : s === 'marginal' ? '⚠️' : '⛔'}
                                                        </span>
                                                        <span className='ai-runcfg__rec-cell__wins'>{opt?.windowsPass ?? 0}/4</span>
                                                        {opt?.isAiPick && <span className='ai-runcfg__rec-cell__star'>★</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Summary line */}
                                    {selOpt && (
                                        <div className={`ai-runcfg__rec-summary ai-runcfg__rec-summary--${selOpt.safety}`}>
                                            {selOpt.safety === 'safe'
                                                ? `✅ ${editRecoveryMode.toUpperCase()} ${editRecoveryBarrier} — safe (${selOpt.windowsPass}/4 windows)`
                                                : selOpt.safety === 'marginal'
                                                    ? `⚠️ ${editRecoveryMode.toUpperCase()} ${editRecoveryBarrier} — marginal (${selOpt.windowsPass}/4 windows)`
                                                    : `⛔ ${editRecoveryMode.toUpperCase()} ${editRecoveryBarrier} — unsafe (${selOpt.windowsPass}/4 windows) — consider another barrier`}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {tradeType === 'even_odd' && (
                            <div className='ai-runcfg__field'>
                                <span>EO Recovery Mode</span>
                                <select
                                    className='ai-runcfg__select'
                                    value={cfgEoRecovery ? 'yes' : 'no'}
                                    onChange={e => setCfgEoRecovery(e.target.value === 'yes')}
                                >
                                    <option value='no'>No — stay on same side</option>
                                    <option value='yes'>Yes — flip on loss, return on win</option>
                                </select>
                            </div>
                        )}
                        <button className='ai-runcfg__execute' disabled={runState === 'launching'} onClick={handleExecuteTrade}>
                            {runState === 'launching' ? <><Loader2 size={16} className='ai-panel__spin' /> Launching…</> : <><PlayCircle size={16} /> Execute Trades</>}
                        </button>
                        {runState === 'no-ws' && (<div className='ai-panel__run-err'>Open the <strong>Bot Builder</strong> tab once first, then try again.</div>)}
                        {runState === 'error'  && (<div className='ai-panel__run-err'>{runErr}</div>)}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AiSignalsPage;

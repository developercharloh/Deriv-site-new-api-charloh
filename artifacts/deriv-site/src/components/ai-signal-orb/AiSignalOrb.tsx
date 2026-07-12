import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X, Zap, RefreshCw, PlayCircle } from '@/utils/lucide-shim';
import { DERIV_VOLATILITIES, type DerivVolatility } from '@/utils/deriv-volatilities';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { destroyerBotIdFromDirection, fetchAndPatchBot, type BotSignal } from '@/utils/bot-patch';
import './ai-signal-orb.scss';

const ORB_RUN_CFG_KEY = 'orb_destroyer_cfg';
interface OrbRunConfig { stake: string; takeProfit: string; stopLoss: string; martingale: string; martingaleOn: boolean; }
const DEFAULT_RUN_CFG: OrbRunConfig = { stake: '0.5', takeProfit: '10', stopLoss: '30', martingale: '1.5', martingaleOn: true };
type RunState = 'idle' | 'launching' | 'no-ws' | 'error';

// ─── Constants ────────────────────────────────────────────────────────────────

const DERIV_WS        = 'wss://ws.derivws.com/websockets/v3?app_id=1';
// Capped at 1000 ticks to match Deriv's own digit-analysis window — using
// more history risks basing signals on a market regime that has already
// shifted (reversals happen gradually and old ticks stop being relevant).
const TICK_COUNT      = 1000;
const ALL_SYMS        = DERIV_VOLATILITIES;
const MIN_VOTES       = 6;

function getSymbolMinVotes(symCode: string): number {
    if (symCode.includes('75') || symCode.includes('100')) return 7;
    if (symCode.endsWith('10V') || symCode.endsWith('25V') ||
        symCode.includes('_10') || symCode.includes('_25')) return 5;
    return 6;
}
const MIN_WIN_PROB_OU  = 0.60;
const TICK_COUNT_LONG  = 5000;    // fetch 5 k ticks; sliced into sub-windows below
const DERIV_STATUS_URL = 'https://status.deriv.systems/api/v2/status.json';
const STATUS_POLL_MS   = 60_000;  // re-check maintenance status every 60 s
const GAP_THRESHOLD_S  = 120;     // timestamp gap > 2 min → possible maintenance window
const REGIME_DIV_LIMIT = 0.08;    // Jensen-Shannon divergence limit (micro vs long)

type TradeType = 'over_under' | 'even_odd' | 'matches_differs';
type ScanState = 'idle' | 'scanning' | 'done' | 'no-signal';

// ─── Analysis types ───────────────────────────────────────────────────────────

interface ModelResult { name: string; vote: boolean; score: number; }
interface ModelVotes  {
    chiSquared:  ModelResult; bayesian:    ModelResult; momentum:    ModelResult;
    stability:   ModelResult; recentEdge:  ModelResult;
    markov:      ModelResult; linearTrend: ModelResult; entropy:     ModelResult;
    ngram:       ModelResult; quartile:    ModelResult;
    yesCount: number; totalScore: number;
}
interface MarketResult {
    sym:                  DerivVolatility;
    direction:            string;
    contractType:         string;
    barrier:              number | null;
    recoveryBarrier:      number | null;
    recoveryContractType: string | null;
    recoveryDirection:    string | null;
    winProb:              number;
    sampleSize:           number;
    votes:                ModelVotes;
    entryDigits:          { digit: number; recommended: boolean; conditional: number; freqPct: number; avgWaitTicks: number }[];
    segmentAgrees:        boolean;
    signalStrength:       number;
    pip:                  number;   // decimal precision for lastDigitOf on live ticks
    regimeScore:          number;   // 0–100: cross-timeframe distribution consistency
    regimeOk:             boolean;  // medium + long windows agree with signal direction
    gapDetected:          boolean;  // recent timestamp gap > 2 min (maintenance indicator)
    tfAgreement:          number;   // 0–4 timeframes pointing same direction
    // Recent Dominance — short-window momentum check (last 20 & 50 ticks)
    // PRIMARY guard against consecutive losses: if market reversed recently, block the signal.
    recentDominance: {
        last20WinPct:  number;   // fraction of last 20 ticks on win side (0–1)
        last50WinPct:  number;   // fraction of last 50 ticks on win side (0–1)
        winsLast20:    number;   // raw count
        winsLast50:    number;
        last20Results: boolean[]; // per-tick win(true)/loss(false) — for pip display
        isHot:         boolean;  // ≥65% of last 20 on win side → strong momentum
        isCold:        boolean;  // ≤35% of last 20 on win side → market reversed, BLOCK trade
        label:         'DOMINANT' | 'ACTIVE' | 'NEUTRAL' | 'COOLING' | 'REVERSED';
    };
}

interface OrbHistoryEntry {
    market:    string;
    direction: string;
    votes:     number;
    strength:  number;
    time:      number;
}

interface SpikeInfo { code: string; label: string; sigma: number; }

// ─── Deriv system status ──────────────────────────────────────────────────────
type StatusIndicator = 'none' | 'minor' | 'major' | 'critical';
interface DerivStatusResult {
    indicator:   StatusIndicator;
    description: string;
    fetchedAt:   number;
}

// ─── Jensen-Shannon divergence between two digit distributions ────────────────
function jsDiv(pA: number[], pB: number[]): number {
    const m = pA.map((p, i) => (p + pB[i]) / 2);
    let jsd = 0;
    for (let i = 0; i < 10; i++) {
        if (pA[i] > 0 && m[i] > 0) jsd += pA[i] * Math.log2(pA[i] / m[i]);
        if (pB[i] > 0 && m[i] > 0) jsd += pB[i] * Math.log2(pB[i] / m[i]);
    }
    return jsd / 2;
}

// ─── Detect maintenance gap in tick timestamps ────────────────────────────────
function detectGap(times: number[]): { gapDetected: boolean; maxGapSecs: number } {
    if (times.length < 2) return { gapDetected: false, maxGapSecs: 0 };
    const recent = times.slice(-500);
    let maxGap = 0;
    for (let i = 1; i < recent.length; i++) {
        const gap = recent[i] - recent[i - 1];
        if (gap > maxGap) maxGap = gap;
    }
    return { gapDetected: maxGap >= GAP_THRESHOLD_S, maxGapSecs: maxGap };
}

// ─── Fetch Deriv system status from status.deriv.systems ─────────────────────
async function fetchDerivStatus(): Promise<DerivStatusResult> {
    try {
        const res  = await fetch(DERIV_STATUS_URL, { cache: 'no-store' });
        const json = await res.json();
        return {
            indicator:   (json?.status?.indicator  ?? 'none') as StatusIndicator,
            description:  json?.status?.description ?? 'Unknown',
            fetchedAt:   Date.now(),
        };
    } catch {
        // Network error — don't block, surface as unknown
        return { indicator: 'none', description: 'Status check failed', fetchedAt: Date.now() };
    }
}

// ─── Digit frequency array from prices ───────────────────────────────────────
function digitFreqArr(prices: number[], pip: number): number[] {
    const f = new Array(10).fill(0);
    for (const p of prices) f[lastDigitOf(p, pip)]++;
    return f.map(v => v / prices.length);
}

// ─── Spike detection ──────────────────────────────────────────────────────────

const SPIKE_SIGMA    = 3.0;   // σ threshold — jumps above this are flagged
const SPIKE_LOOKBACK = 200;   // ticks used to build the baseline distribution

function detectSpike(prices: number[]): { spiked: boolean; sigma: number } {
    if (prices.length < 20) return { spiked: false, sigma: 0 };
    const win     = prices.slice(-Math.min(SPIKE_LOOKBACK, prices.length));
    const returns = win.slice(1).map((p, i) => Math.abs(p - win[i]));
    if (returns.length < 10) return { spiked: false, sigma: 0 };
    const mean    = returns.reduce((s, r) => s + r, 0) / returns.length;
    const std     = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length);
    if (std === 0) return { spiked: false, sigma: 0 };
    // Centered z-score: (move - baseline_mean) / std
    const maxSigma = Math.max(...returns.slice(-5).map(r => (r - mean) / std));
    return { spiked: maxSigma >= SPIKE_SIGMA, sigma: maxSigma };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const lastDigitOf = (q: number, pip: number): number => {
    const s = q.toFixed(pip);
    return parseInt(s[s.length - 1], 10);
};
const wilsonLower = (wins: number, total: number, z = 1.96): number => {
    if (total === 0) return 0;
    const p = wins / total, z2 = z * z, den = 1 + z2 / total;
    const ctr = p + z2 / (2 * total);
    const mrg = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
    return (ctr - mrg) / den;
};

// ─── 10-model analysis ────────────────────────────────────────────────────────

function runModels(prices: number[], pip: number, sym: DerivVolatility, tradeType: TradeType): MarketResult {
    const N      = prices.length;
    const digits = prices.map(p => lastDigitOf(p, pip));
    const freq   = new Array(10).fill(0);
    for (const d of digits) freq[d]++;
    const freqPct = freq.map(f => f / N);

    let direction = '', contractType = '', barrier: number | null = null,
        recoveryBarrier: number | null = null, recoveryContractType: string | null = null,
        recoveryDirection: string | null = null, winProb = 0;
    let winFn: (d: number) => boolean;

    if (tradeType === 'even_odd') {
        const evenCt = digits.filter(d => d % 2 === 0).length;
        const oddCt  = N - evenCt;
        // REVERSAL MODE: models evaluate the DOMINANT side; signal fires on the OPPOSITE.
        // winFn/winProb stay on the dominant side so all 4 models can confirm the edge.
        if (evenCt >= oddCt) {
            direction = 'ODD';  contractType = 'DIGITODD';  // bet ODD — fading EVEN dominance
            winProb = evenCt / N; winFn = d => d % 2 === 0; // models check EVEN edge
        } else {
            direction = 'EVEN'; contractType = 'DIGITEVEN'; // bet EVEN — fading ODD dominance
            winProb = oddCt / N; winFn = d => d % 2 !== 0;  // models check ODD edge
        }
    } else if (tradeType === 'matches_differs') {
        const exp2        = N / 10;
        const chiContribs = freq.map(f => (f - exp2) ** 2 / exp2);
        let matchDig = 0, differDig = 0;
        for (let d = 1; d < 10; d++) {
            if (freq[d] > freq[matchDig])  matchDig  = d;
            if (freq[d] < freq[differDig]) differDig = d;
        }
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
        // Sort by statistical edge (actual − expected), raw prob as tie-break
        allOptions.sort((a, b2) => b2.edge - a.edge || b2.prob - a.prob);
        const best = allOptions[0];
        const oppositeOptions = allOptions.filter(o => o.side !== best.side);
        const recovery = oppositeOptions[0] ?? allOptions[1] ?? best;
        barrier              = best.b;
        recoveryBarrier      = recovery.b;
        recoveryContractType = recovery.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
        recoveryDirection    = `${recovery.side} ${recovery.b}`;
        direction    = `${best.side} ${best.b}`;
        contractType = best.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
        winProb      = best.prob;
        winFn        = d => best.side === 'OVER' ? d > best.b : d < best.b;
    }

    // ── Recent Dominance — the #1 guard against consecutive losses ───────────
    // Consecutive losses happen when the long-term signal says "OVER 5" but the
    // market has already reversed in the last 15–20 ticks. This model detects
    // that reversal by checking what fraction of the last 20 ticks fell on the
    // WIN side of the signal. If ≤35%, the signal is blocked regardless of votes.
    const last20digits  = digits.slice(-20);
    const last50digits  = digits.slice(-50);
    const last20Results = last20digits.map(d => winFn(d));
    const wins20        = last20Results.filter(Boolean).length;
    const wins50        = last50digits.filter(d => winFn(d)).length;
    const dom20         = wins20 / Math.max(1, last20digits.length);
    const dom50         = wins50 / Math.max(1, last50digits.length);
    const recentDominance = {
        last20WinPct:  dom20,
        last50WinPct:  dom50,
        winsLast20:    wins20,
        winsLast50:    wins50,
        last20Results,
        isHot:  dom20 >= 0.65,   // 13/20+ on win side — hot streak, enter
        isCold: dom20 <= 0.35,   // ≤7/20 on win side — reversed, BLOCK
        label:  (dom20 >= 0.70 ? 'DOMINANT' : dom20 >= 0.55 ? 'ACTIVE' : dom20 >= 0.45 ? 'NEUTRAL' : dom20 >= 0.30 ? 'COOLING' : 'REVERSED') as
                'DOMINANT' | 'ACTIVE' | 'NEUTRAL' | 'COOLING' | 'REVERSED',
    };

    // ── Entry digits — frequency-weighted scoring ─────────────────────────────
    // Problem: picking purely by conditional win-rate can select rare digits
    // (e.g. digit 2 at 8% frequency → ~12 tick wait) so the signal is already
    // stale by the time the entry condition arrives.
    // Fix: score = wilsonLower × sqrt(digitFreq / 0.10)
    //   — digits appearing MORE than average get a boost (shorter wait)
    //   — digits appearing LESS than average get penalised (longer wait)
    // avgWaitTicks = round(1 / freqPct) tells the trader how long to expect.
    const cond = new Array(10).fill(null).map(() => ({ wins: 0, total: 0 }));
    for (let i = 0; i < digits.length - 1; i++) { cond[digits[i]].total++; if (winFn(digits[i + 1])) cond[digits[i]].wins++; }
    const minSmp = Math.max(50, Math.floor(N / 50));

    const scored = cond.map((c, d) => {
        const conditional  = c.total > 0 ? c.wins / c.total : 0;
        const lb           = wilsonLower(c.wins, c.total);
        // Frequency weight: 1.0 at 10% (uniform), >1 for common digits, <1 for rare
        const freqWeight   = Math.sqrt(Math.max(0.3, freqPct[d] / 0.10));
        const freqScore    = lb * freqWeight;
        return { digit: d, conditional, lowerBound: lb, total: c.total, freqScore, freqPct: freqPct[d] };
    });

    // Primary list: good statistical edge AND frequency-weighted score
    let entryRaw = scored
        .filter(c => c.total >= minSmp && c.lowerBound >= winProb + 0.01)
        .sort((a, b) => b.freqScore - a.freqScore || b.lowerBound - a.lowerBound)
        .slice(0, 3);

    // Fallback: any digit with enough samples, still sorted by freqScore
    if (entryRaw.length < 3) {
        const used = new Set(entryRaw.map(e => e.digit));
        const fb   = scored
            .filter(c => !used.has(c.digit) && c.total >= minSmp)
            .sort((a, b) => b.freqScore - a.freqScore || b.lowerBound - a.lowerBound);
        while (entryRaw.length < 3 && fb.length > 0) entryRaw.push(fb.shift()!);
    }
    // Last resort: pick by raw digit frequency (most common digits = shortest wait)
    while (entryRaw.length < 3) {
        const used = new Set(entryRaw.map(e => e.digit));
        const fb2  = scored
            .filter(e => !used.has(e.digit))
            .sort((a, b) => b.freqPct - a.freqPct)[0];
        if (!fb2) break;
        entryRaw.push(fb2);
    }

    const entryDigits = entryRaw.map((e, i) => ({
        digit:        e.digit,
        recommended:  i === 0,
        conditional:  e.conditional,
        freqPct:      e.freqPct,
        avgWaitTicks: Math.max(1, Math.round(1 / Math.max(0.01, e.freqPct))),
    }));

    // Model 1 — Chi²/Z-test
    let m1: ModelResult;
    if (tradeType === 'even_odd') {
        const zStat = (winProb - 0.5) / Math.sqrt(0.25 / N);
        const vote  = Math.abs(zStat) >= 1.65 && winProb >= 0.51;
        m1 = { name: 'Stat. Significance', vote, score: Math.min(1, Math.abs(zStat) / 4) };
    } else {
        const exp = N / 10; const chiSq = freq.reduce((acc, f) => acc + (f - exp) ** 2 / exp, 0);
        const vote = chiSq >= 16.92 && winProb >= 0.62;
        m1 = { name: 'Stat. Significance', vote, score: Math.min(1, chiSq / 30) };
    }

    // Model 2 — Bayesian
    const best2  = entryDigits[0];
    const m2Vote = best2 ? best2.conditional >= winProb + 0.05 : false;
    const m2: ModelResult = { name: 'Bayesian', vote: m2Vote, score: best2 ? Math.min(1, Math.max(0, (best2.conditional - winProb) / 0.20)) : 0 };

    // Model 3 — 3-Window Trend
    const w3A = Math.floor(N * 0.10), w3B = Math.floor(N * 0.30), w3C = Math.floor(N * 0.60);
    const winR = digits.slice(-w3A).filter(winFn).length / w3A;
    const winM = digits.slice(-(w3A + w3B), -w3A).filter(winFn).length / w3B;
    const winO = digits.slice(-(w3A + w3B + w3C), -(w3A + w3B)).filter(winFn).length / w3C;
    const m3Vote = winR >= winProb - 0.01 && winM >= winProb - 0.02 && winO >= winProb - 0.03 && winR >= winM - 0.03;
    const m3: ModelResult = { name: '3-Window Trend', vote: m3Vote, score: Math.min(1, Math.max(0, ((winR - winProb) + (winM - winProb) + (winO - winProb) + 0.06) / 0.18)) };

    // Model 4 — Stability
    const wSz = Math.floor(N / 5), wThr = tradeType === 'even_odd' ? 0.50 : 0.60;
    let wAbove = 0;
    for (let w = 0; w < 5; w++) { const wr = digits.slice(w * wSz, (w + 1) * wSz).filter(winFn).length / wSz; if (wr >= wThr) wAbove++; }
    const m4: ModelResult = { name: 'Stability', vote: wAbove >= (tradeType === 'even_odd' ? 3 : 4), score: wAbove / 5 };

    // Model 5 — Recent Edge
    const rSlice100 = digits.slice(-100), rSlice500 = digits.slice(-500);
    const rWin100 = rSlice100.filter(winFn).length / rSlice100.length;
    const rWin500 = rSlice500.filter(winFn).length / rSlice500.length;
    const eThr100 = tradeType === 'even_odd' ? 0.52 : 0.61, eThr500 = tradeType === 'even_odd' ? 0.51 : 0.60;
    const m5Vote  = rWin100 >= eThr100 && rWin500 >= eThr500 && rWin100 >= rWin500 - 0.05;
    const m5: ModelResult = { name: 'Recent Edge', vote: m5Vote, score: Math.min(1, Math.max(0, (Math.min(rWin100, rWin500) - (eThr500 - 0.05)) / 0.15)) };

    // Model 6 — Markov-2 Chain
    const markovMap = new Map<string, { wins: number; total: number }>();
    for (let i = 0; i < digits.length - 2; i++) {
        const key = `${digits[i]},${digits[i + 1]}`;
        if (!markovMap.has(key)) markovMap.set(key, { wins: 0, total: 0 });
        const e = markovMap.get(key)!; e.total++;
        if (winFn(digits[i + 2])) e.wins++;
    }
    const lastTwo    = `${digits[digits.length - 2]},${digits[digits.length - 1]}`;
    const markovEntry = markovMap.get(lastTwo) ?? { wins: 0, total: 0 };
    const markovProb  = markovEntry.total >= 20 ? markovEntry.wins / markovEntry.total : winProb;
    const m6Vote = markovEntry.total >= 20 && markovProb >= winProb + 0.03;
    const m6: ModelResult = { name: 'Markov-2 Chain', vote: m6Vote, score: Math.min(1, Math.max(0, (markovProb - winProb + 0.05) / 0.15)) };

    // Model 7 — Linear Trend
    const linWindows = 10, linSz = Math.floor(N / linWindows);
    const linRates = Array.from({ length: linWindows }, (_, wi) => {
        const sl = digits.slice(wi * linSz, (wi + 1) * linSz);
        return sl.length > 0 ? sl.filter(winFn).length / sl.length : winProb;
    });
    const linN = linRates.length, linMeanX = (linN - 1) / 2;
    const linMeanY = linRates.reduce((s, r) => s + r, 0) / linN;
    let linNum = 0, linDen = 0;
    linRates.forEach((r, i) => { linNum += (i - linMeanX) * (r - linMeanY); linDen += (i - linMeanX) ** 2; });
    const linSlope = linDen > 0 ? linNum / linDen : 0;
    const m7Vote = linSlope >= -0.001 && linRates[linN - 1] >= winProb - 0.02;
    const m7: ModelResult = { name: 'Linear Trend', vote: m7Vote, score: Math.min(1, Math.max(0, (linSlope + 0.005) / 0.015)) };

    // Model 8 — Entropy Guard
    const entSum  = freqPct.reduce((s, p) => s + (p > 0 ? -p * Math.log2(p) : 0), 0);
    const maxEnt  = Math.log2(10);
    const normEnt = entSum / maxEnt;
    const m8Vote  = normEnt >= 0.80 && normEnt <= 0.99 && winProb >= (tradeType === 'even_odd' ? 0.51 : 0.60);
    const m8: ModelResult = { name: 'Entropy Guard', vote: m8Vote, score: Math.min(1, Math.max(0, 1 - Math.abs(normEnt - 0.88) / 0.12)) };

    // Model 9 — N-Gram Memory
    const ngramMap = new Map<string, { wins: number; total: number }>();
    for (let i = 0; i < digits.length - 4; i++) {
        const key = digits.slice(i, i + 4).join(',');
        if (!ngramMap.has(key)) ngramMap.set(key, { wins: 0, total: 0 });
        const e2 = ngramMap.get(key)!; e2.total++;
        if (winFn(digits[i + 4])) e2.wins++;
    }
    const recentNgram = digits.slice(-4).join(',');
    const ngramEntry  = ngramMap.get(recentNgram) ?? { wins: 0, total: 0 };
    const ngramProb   = ngramEntry.total >= 10 ? ngramEntry.wins / ngramEntry.total : winProb;
    const m9Vote = ngramEntry.total >= 10 && ngramProb >= winProb + 0.02;
    const m9: ModelResult = { name: 'N-Gram Memory', vote: m9Vote, score: Math.min(1, Math.max(0, (ngramProb - winProb + 0.04) / 0.12)) };

    // Model 10 — Quartile Persistence
    const qSz    = Math.floor(N / 4);
    const qThr   = tradeType === 'even_odd' ? 0.50 : 0.58;
    const qRates = Array.from({ length: 4 }, (_, qi) => digits.slice(qi * qSz, (qi + 1) * qSz).filter(winFn).length / qSz);
    const m10Vote = qRates.every(r => r >= qThr);
    const m10: ModelResult = { name: 'Quartile Persistence', vote: m10Vote, score: qRates.filter(r => r >= qThr).length / 4 };

    // Even/Odd reversal: only the 4 core models vote — strip the other 6.
    const eoModels   = tradeType === 'even_odd' ? [m1, m2, m3, m4] : [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10];
    const yesCount   = eoModels.filter(m => m.vote).length;
    const totalScore = m1.score + m2.score + m3.score + m4.score + m5.score + m6.score + m7.score + m8.score + m9.score + m10.score;
    const votes: ModelVotes = {
        chiSquared: m1, bayesian: m2, momentum: m3, stability: m4, recentEdge: m5,
        markov: m6, linearTrend: m7, entropy: m8, ngram: m9, quartile: m10,
        yesCount, totalScore,
    };
    return {
        sym, direction, contractType, barrier, recoveryBarrier, recoveryContractType,
        recoveryDirection, winProb, sampleSize: N, votes, entryDigits, pip,
        segmentAgrees:  true,
        signalStrength: Math.round((totalScore / 10) * 100),
        recentDominance,
        // Regime fields — overridden by scanAllMarkets spread; defaults for direct calls
        regimeScore: 100, regimeOk: true, gapDetected: false, tfAgreement: 4,
    };
}

// ─── Scan all markets ─────────────────────────────────────────────────────────

async function scanAllMarkets(
    tradeType:  TradeType,
    onProgress: (received: number) => void,
): Promise<{ best: MarketResult | null; noVotesBest: MarketResult | null; allResults: MarketResult[]; spikedMarkets: SpikeInfo[] }> {
    return new Promise(resolve => {
        const ws = new WebSocket(DERIV_WS);
        const priceMap = new Map<number, { prices: number[]; times: number[]; pip: number; sym: DerivVolatility }>();
        let received = 0, closed = false;

        const finish = () => {
            if (closed) return;
            closed = true;
            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
            try { ws.close(); } catch { /* */ }
            const results: MarketResult[] = [];
            const detectedSpikes: SpikeInfo[] = [];

            priceMap.forEach(({ prices, times, pip, sym }) => {
                if (prices.length < 100) return;

                // ── Spike detection ───────────────────────────────────────────
                const { spiked, sigma } = detectSpike(prices);
                if (spiked) detectedSpikes.push({ code: sym.code, label: sym.short, sigma: Math.round(sigma * 10) / 10 });

                // ── Maintenance gap detection ─────────────────────────────────
                const { gapDetected } = detectGap(times);

                // ── Timeframe windows ─────────────────────────────────────────
                const tfMicro  = prices.slice(-200);
                const tfShort  = prices.slice(-1000);             // primary window
                const tfMedium = prices.length >= 3000 ? prices.slice(-3000) : prices;
                const tfLong   = prices;                          // full 5 k ticks

                // ── Primary analysis (1 000-tick window) ──────────────────────
                const full = runModels(tfShort, pip, sym, tradeType);

                // ── Segment agreement (existing logic) ────────────────────────
                if (tfShort.length >= 1600) {
                    const seg = runModels(tfShort.slice(-1500), pip, sym, tradeType);
                    full.segmentAgrees = seg.direction === full.direction && seg.votes.yesCount >= 4;
                }

                // ── Cross-timeframe regime analysis ───────────────────────────
                const rMicro  = runModels(tfMicro,  pip, sym, tradeType);
                const rMedium = runModels(tfMedium, pip, sym, tradeType);
                const rLong   = runModels(tfLong,   pip, sym, tradeType);

                const mainDir     = full.direction;
                const tfAgreement = [rMicro, full, rMedium, rLong].filter(r => r.direction === mainDir).length;
                const regimeOk    = rMedium.direction === mainDir && rLong.direction === mainDir;

                // JS divergence between micro and long digit distributions
                const divergence  = jsDiv(digitFreqArr(tfMicro, pip), digitFreqArr(tfLong, pip));
                const regimeScore = Math.max(0, Math.round((1 - divergence / Math.max(divergence, REGIME_DIV_LIMIT)) * 100));

                results.push({
                    ...full,
                    regimeScore,
                    regimeOk,
                    gapDetected,
                    tfAgreement,
                });
            });

            results.sort((a, b) => b.votes.yesCount - a.votes.yesCount || b.votes.totalScore - a.votes.totalScore || b.winProb - a.winProb);
            const spikedCodes = new Set(detectedSpikes.map(s => s.code));

            // Even/Odd reversal: needs 3/4 core models + dominant side must be HOT (≥65% in last 20).
            // Other markets: standard 6/10 threshold + recentEdge + regime checks.
            const eoMode = tradeType === 'even_odd';
            const best = results.find(r =>
                !spikedCodes.has(r.sym.code) &&
                r.votes.yesCount >= (eoMode ? 3 : getSymbolMinVotes(r.sym.code)) &&
                r.segmentAgrees &&
                (eoMode ? r.recentDominance.isHot : r.votes.recentEdge.vote) &&
                r.regimeOk &&                      // ← cross-timeframe consistency required
                !r.gapDetected &&                  // ← no maintenance gap allowed
                (eoMode ? !r.recentDominance.isCold : !r.recentDominance.isCold) &&
                (tradeType !== 'over_under' || r.winProb >= MIN_WIN_PROB_OU)
            ) ?? null;

            const noVotesBest = best ? null : (results.find(r => !spikedCodes.has(r.sym.code)) ?? results[0] ?? null);
            resolve({ best, noVotesBest, allResults: results, spikedMarkets: detectedSpikes });
        };

        ws.onopen = () => {
            ALL_SYMS.forEach((sym, i) => setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) return;
                // Fetch 5 000 ticks — sliced into micro/short/medium/long windows in finish()
                ws.send(JSON.stringify({ ticks_history: sym.code, count: TICK_COUNT_LONG, end: 'latest', style: 'ticks', req_id: i + 1 }));
            }, i * 80));
        };
        ws.onmessage = (ev: MessageEvent) => {
            let msg: any; try { msg = JSON.parse(ev.data as string); } catch { return; }
            if (msg.msg_type !== 'history') return;
            const reqId = msg.req_id as number; const sym = ALL_SYMS[reqId - 1]; if (!sym) return;
            priceMap.set(reqId, {
                prices: msg.history?.prices ?? [],
                times:  msg.history?.times  ?? [],
                pip:    msg.pip_size ?? 2,
                sym,
            });
            onProgress(++received);
            if (received >= ALL_SYMS.length) finish();
        };
        ws.onerror = () => finish();
        ws.onclose = () => { if (!closed) finish(); };
        setTimeout(() => { if (!closed) finish(); }, 40_000); // extra time for 5 k ticks
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcRecRuns(yesCount: number, winProb: number): number {
    const edge = Math.max(0.02, winProb - 0.50);
    const raw  = Math.round(1.5 / edge);
    const cap  = yesCount >= 9 ? 8 : yesCount >= 7 ? 12 : 19;
    return Math.max(2, Math.min(cap, raw));
}

const voteColor = (v: number): string =>
    v >= 9 ? '#10b981' : v >= 7 ? '#6366f1' : v >= 5 ? '#f59e0b' : '#ef4444';

const voteLabel = (v: number): string =>
    v >= 10 ? 'UNANIMOUS' : v >= 9 ? 'STRONG' : v >= 8 ? 'SOLID' : v >= 7 ? 'GOOD' : v >= 5 ? 'FAIR' : 'WEAK';

// ─── Component ────────────────────────────────────────────────────────────────

const AiSignalOrb: React.FC = () => {
    // Draggable orb
    const [dragged, setDragged] = useState(false);
    const [orbPos,  setOrbPos]  = useState({ x: 0, y: 0 });
    const dragRef = useRef({ active: false, startX: 0, startY: 0, initX: 0, initY: 0, moved: false });
    const orbRef  = useRef<HTMLDivElement>(null);

    // Panel / scan state
    const [open,       setOpen]       = useState(false);
    const [tradeType,  setTradeType]  = useState<TradeType>('over_under');
    const [scanState,  setScanState]  = useState<ScanState>('idle');
    const [progress,   setProgress]   = useState(0);
    const [result,     setResult]     = useState<MarketResult | null>(null);
    const [noSigBest,  setNoSigBest]  = useState<MarketResult | null>(null);
    const [hasSignal,  setHasSignal]  = useState(false);
    const [spikedMarkets, setSpikedMarkets] = useState<SpikeInfo[]>([]);

    // Editable prediction (for reference display)
    const [editDir,    setEditDir]    = useState<'OVER' | 'UNDER' | 'EVEN' | 'ODD'>('OVER');
    const [editBarrier,setEditBarrier]= useState<number>(5);
    const [editRecoveryBarrier, setEditRecoveryBarrier] = useState<number | null>(null);
    const [editMatchesSide, setEditMatchesSide] = useState<'MATCHES' | 'DIFFERS'>('MATCHES');
    const [editTargetDigit, setEditTargetDigit] = useState<number>(0);

    // Session discipline counter
    const [sessionCount, setSessionCount] = useState<number>(0);

    // Selected entry point digit (defaults to AI-recommended digit on new result)
    const [editEntryPoint, setEditEntryPoint] = useState<number>(0);

    // Live tick feed — tracks entry digit freshness after a scan result arrives
    const entryWsRef      = useRef<WebSocket | null>(null);
    const [ticksSinceScan, setTicksSinceScan] = useState(0);
    // digitLastSeen[d] = ticks since digit d was last seen (-1 = not yet seen this session)
    const [digitLastSeen,  setDigitLastSeen]  = useState<number[]>(new Array(10).fill(-1));

    // Save & Run — pushes the current signal straight into the Over/Under Destroyer bot
    const store = useStore();
    const [runState, setRunState] = useState<RunState>('idle');
    const [runErr,   setRunErr]   = useState('');

    // Run-config banner (Stake / Take Profit / Stop Loss / Martingale on-off)
    const [showRunConfig, setShowRunConfig] = useState(false);
    const [cfgStake,        setCfgStake]        = useState(DEFAULT_RUN_CFG.stake);
    const [cfgTakeProfit,   setCfgTakeProfit]   = useState(DEFAULT_RUN_CFG.takeProfit);
    const [cfgStopLoss,     setCfgStopLoss]     = useState(DEFAULT_RUN_CFG.stopLoss);
    const [cfgMartingale,   setCfgMartingale]   = useState(DEFAULT_RUN_CFG.martingale);
    const [cfgMartingaleOn, setCfgMartingaleOn] = useState(DEFAULT_RUN_CFG.martingaleOn);

    // Signal history log
    const [orbHistory, setOrbHistory] = useState<OrbHistoryEntry[]>(() => {
        try { return JSON.parse(localStorage.getItem('orb-signal-history') ?? '[]'); } catch { return []; }
    });

    // ── Deriv system status — polled every 60 s ───────────────────────────────
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
            setEditRecoveryBarrier(result.recoveryBarrier);
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

    // Live tick feed — tracks how many ticks ago each entry digit last appeared
    // Opens a fresh subscription whenever the result or panel-open state changes.
    // Closes automatically when the panel is shut or a new scan starts.
    useEffect(() => {
        if (!result || !open) {
            if (entryWsRef.current) { try { entryWsRef.current.close(); } catch { /* */ } entryWsRef.current = null; }
            setTicksSinceScan(0);
            setDigitLastSeen(new Array(10).fill(-1));
            return;
        }
        if (entryWsRef.current) { try { entryWsRef.current.close(); } catch { /* */ } }

        let destroyed = false;
        let localTicks = 0;
        const lastSeen = new Array(10).fill(-1);

        const ws = new WebSocket(DERIV_WS);
        entryWsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ ticks: result.sym.code, subscribe: 1, req_id: 998 }));
        };
        ws.onmessage = (ev: MessageEvent) => {
            if (destroyed) return;
            let msg: any; try { msg = JSON.parse(ev.data as string); } catch { return; }
            if (msg.msg_type !== 'tick') return;
            const price = parseFloat(msg.tick?.quote ?? '0');
            if (!price) return;

            localTicks++;
            // Age every digit by 1 tick
            for (let d = 0; d < 10; d++) { if (lastSeen[d] >= 0) lastSeen[d]++; }
            // Mark the current digit as just-seen (0 ticks ago)
            lastSeen[lastDigitOf(price, result.pip)] = 0;

            setTicksSinceScan(localTicks);
            setDigitLastSeen([...lastSeen]);
        };
        ws.onerror = () => { /* onclose fires after */ };
        ws.onclose = () => { if (entryWsRef.current === ws) entryWsRef.current = null; };

        return () => {
            destroyed = true;
            if (entryWsRef.current === ws) entryWsRef.current = null;
            try { ws.close(); } catch { /* */ }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result, open]);

    // Poll Deriv system status every 60 s — keeps itself alive via setInterval
    useEffect(() => {
        let destroyed = false;
        const poll = async () => {
            if (destroyed) return;
            const s = await fetchDerivStatus();
            if (!destroyed) { setDerivStatus(s); setStatusChecked(true); }
        };
        poll();
        const id = setInterval(poll, STATUS_POLL_MS);
        return () => { destroyed = true; clearInterval(id); };
    }, []);

    // ── Drag handlers ─────────────────────────────────────────────────────────
    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const el = orbRef.current; if (!el) return;
        const rect = el.getBoundingClientRect();
        dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, initX: rect.left, initY: rect.top, moved: false };
        el.setPointerCapture(e.pointerId);
    }, []);
    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current.active) return;
        const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY;
        if (!dragRef.current.moved && Math.sqrt(dx * dx + dy * dy) > 5) { dragRef.current.moved = true; setDragged(true); }
        if (dragRef.current.moved) {
            setOrbPos({ x: Math.max(0, Math.min(window.innerWidth - 64, dragRef.current.initX + dx)), y: Math.max(0, Math.min(window.innerHeight - 64, dragRef.current.initY + dy)) });
        }
    }, []);
    const onPointerUp = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current.active) return;
        dragRef.current.active = false;
        if (!dragRef.current.moved) setOpen(p => !p);
        orbRef.current?.releasePointerCapture(e.pointerId);
    }, []);

    // ── Scan ──────────────────────────────────────────────────────────────────
    const handleScan = useCallback(async () => {
        // Hard block during active maintenance — signals from a degraded system are unreliable
        if (maintenanceActive) return;
        // eslint-disable-next-line react-hooks/exhaustive-deps
        setScanState('scanning'); setProgress(0); setResult(null); setNoSigBest(null);
        setHasSignal(false); setSessionCount(0); setSpikedMarkets([]);
        try {
            const { best, noVotesBest, spikedMarkets: spikes } = await scanAllMarkets(tradeType, n => setProgress(n));
            setSpikedMarkets(spikes);
            if (best) {
                setResult(best);
                setScanState('done');
                try {
                    const entry: OrbHistoryEntry = {
                        market:    best.sym.short,
                        direction: best.direction,
                        votes:     best.votes.yesCount,
                        strength:  best.signalStrength,
                        time:      Date.now(),
                    };
                    const prev: OrbHistoryEntry[] = JSON.parse(localStorage.getItem('orb-signal-history') ?? '[]');
                    const next = [entry, ...prev].slice(0, 5);
                    localStorage.setItem('orb-signal-history', JSON.stringify(next));
                    setOrbHistory(next);
                } catch { /* ignore */ }
            } else { setNoSigBest(noVotesBest); setScanState('no-signal'); }
        } catch { setScanState('idle'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tradeType, maintenanceActive]);

    // ── Open the run-config banner — loads the last-used Stake / Take Profit /
    //    Stop Loss / Martingale values (or defaults) so the trader can review
    //    or adjust them before actually deploying the bot ─────────────────────
    const openRunConfig = useCallback(() => {
        if (!result) return;
        let cfg: OrbRunConfig = DEFAULT_RUN_CFG;
        try {
            const raw = localStorage.getItem(ORB_RUN_CFG_KEY);
            if (raw) cfg = { ...DEFAULT_RUN_CFG, ...JSON.parse(raw) };
        } catch { /* ignore */ }
        setCfgStake(cfg.stake);
        setCfgTakeProfit(cfg.takeProfit);
        setCfgStopLoss(cfg.stopLoss);
        setCfgMartingale(cfg.martingale);
        setCfgMartingaleOn(cfg.martingaleOn);
        setRunState('idle'); setRunErr('');
        setShowRunConfig(true);
    }, [result]);

    // ── Execute Trades — writes the AI-selected parameters plus the trader's
    //    Stake / Take Profit / Stop Loss / Martingale straight into the
    //    matching bot for the current trade type and auto-starts it ───────────
    //    over_under      → Over Destroyer / Under Destroyer
    //    even_odd        → Even Odd Entry Scanner Bot
    //    matches_differs → Matches Bot / Differ V2 Bot
    const handleExecuteTrade = useCallback(async () => {
        if (!result) return;
        setRunState('launching'); setRunErr('');
        try {
            const cfg: OrbRunConfig = {
                stake: cfgStake, takeProfit: cfgTakeProfit, stopLoss: cfgStopLoss,
                martingale: cfgMartingale, martingaleOn: cfgMartingaleOn,
            };
            try { localStorage.setItem(ORB_RUN_CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }

            let direction: string;
            let botId: string;
            if (tradeType === 'over_under') {
                direction = `${editDir} ${editBarrier}`;
                botId = destroyerBotIdFromDirection(direction);
            } else if (tradeType === 'matches_differs') {
                direction = `${editMatchesSide} ${editTargetDigit}`;
                botId = editMatchesSide === 'DIFFERS' ? 'differ-v2' : 'matches-signal';
            } else {
                direction = editDir;
                botId = 'even-odd-scanner';
            }

            const signal: BotSignal = {
                symbol:           result.sym.code,
                symbolLabel:      result.sym.label,
                direction,
                entryPoint:       `Digit ${editEntryPoint}`,
                confidence:       result.signalStrength,
                market:           tradeType,
                recoveryBarrier:  tradeType === 'over_under' ? (editRecoveryBarrier ?? result.recoveryBarrier ?? editBarrier) : undefined,
            };

            const stake      = parseFloat(cfgStake)      || 0.5;
            const takeProfit = parseFloat(cfgTakeProfit) || 10;
            const stopLoss   = parseFloat(cfgStopLoss)   || 30;
            // Martingale OFF → reset the martingale block to 0 (no stake increase after a loss).
            const martingale = cfgMartingaleOn ? (parseFloat(cfgMartingale) || 1.5) : 0;

            const doc    = await fetchAndPatchBot(botId, signal, stake, takeProfit, stopLoss, martingale);
            const xmlStr = new XMLSerializer().serializeToString(doc.documentElement);

            const Blockly = (window as any).Blockly;
            if (!Blockly?.derivWorkspace) { setRunState('no-ws'); return; }

            const dom = Blockly.utils.xml.textToDom(xmlStr);
            Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
            Blockly.derivWorkspace.cleanUp();
            Blockly.derivWorkspace.clearUndo();

            store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

            setTimeout(() => {
                if (!store.run_panel.is_running) store.run_panel.onRunButtonClick();
                setRunState('idle');
                setShowRunConfig(false);
                setOpen(false);
            }, 500);
        } catch (e: any) {
            setRunState('error');
            setRunErr(e?.message || 'Failed to launch bot.');
        }
    }, [result, tradeType, editDir, editBarrier, editRecoveryBarrier, editMatchesSide, editTargetDigit, editEntryPoint,
        cfgStake, cfgTakeProfit, cfgStopLoss, cfgMartingale, cfgMartingaleOn, store]);

    // ── Layout helpers ────────────────────────────────────────────────────────
    const orbStyle: React.CSSProperties = dragged
        ? { position: 'fixed', left: orbPos.x, top: orbPos.y, bottom: 'auto', right: 'auto' }
        : { position: 'fixed', right: 24, bottom: 80 };

    const panelStyle: React.CSSProperties = dragged
        ? { position: 'fixed', left: Math.max(8, orbPos.x - 320), top: Math.max(8, orbPos.y - 560), bottom: 'auto' }
        : { position: 'fixed', right: 16, bottom: 156 };

    const vc       = result ? voteColor(result.votes.yesCount) : '#6366f1';
    const recRuns  = result ? calcRecRuns(result.votes.yesCount, result.winProb) : 5;
    const sessionOver = sessionCount >= recRuns;
    const runTargetLabel = tradeType === 'over_under'
        ? (editDir === 'UNDER' ? 'Under Destroyer' : 'Over Destroyer')
        : tradeType === 'matches_differs'
            ? (editMatchesSide === 'DIFFERS' ? 'Differ V2' : 'Matches')
            : 'Even Odd Scanner';
    const models   = result
        ? tradeType === 'even_odd'
            ? [result.votes.chiSquared, result.votes.bayesian, result.votes.momentum, result.votes.stability]
            : [result.votes.chiSquared, result.votes.bayesian, result.votes.momentum, result.votes.stability, result.votes.recentEdge,
               result.votes.markov, result.votes.linearTrend, result.votes.entropy, result.votes.ngram, result.votes.quartile]
        : [];

    return (
        <>
            {/* ── Orb ── */}
            <div ref={orbRef}
                className={`ai-orb${open ? ' ai-orb--open' : ''}${hasSignal && !open ? ' ai-orb--signal' : ''}`}
                style={orbStyle}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            >
                <div className='ai-orb__ring' />
                <div className='ai-orb__glow' />
                <div className='ai-orb__btn'>
                    <div className='ai-orb__inner-glow' />
                    <Zap size={24} className='ai-orb__icon' />
                    <span className='ai-orb__label'>AI</span>
                </div>
                {scanState === 'scanning' && (
                    <div className='ai-orb__prog-ring'>
                        <svg viewBox='0 0 36 36' className='ai-orb__ring-svg'>
                            <circle cx='18' cy='18' r='15' fill='none' stroke='rgba(99,102,241,0.15)' strokeWidth='2.5' />
                            <circle cx='18' cy='18' r='15' fill='none' stroke='url(#orbGrad)' strokeWidth='2.5'
                                strokeLinecap='round' strokeDasharray={`${(progress / ALL_SYMS.length) * 94} 94`}
                                strokeDashoffset='23.5' transform='rotate(-90 18 18)' />
                            <defs>
                                <linearGradient id='orbGrad' x1='0' y1='0' x2='1' y2='1'>
                                    <stop offset='0%' stopColor='#818cf8' />
                                    <stop offset='100%' stopColor='#ec4899' />
                                </linearGradient>
                            </defs>
                        </svg>
                    </div>
                )}
                {!open && spikedMarkets.length > 0 && <span className='ai-orb__badge ai-orb__badge--spike' />}
                {!open && hasSignal && spikedMarkets.length === 0 && <span className='ai-orb__badge' />}
            </div>

            {/* ── Panel ── */}
            {open && (
                <div className='ai-panel' style={panelStyle} onClick={e => e.stopPropagation()}>

                    {/* Header */}
                    <div className='ai-panel__hd'>
                        <div className='ai-panel__hd-left'>
                            <div className='ai-panel__hd-icon'>
                                <Zap size={13} />
                            </div>
                            <div>
                                <span className='ai-panel__title'>AI Signals</span>
                                <span className='ai-panel__subtitle'>
                                    {tradeType === 'even_odd' ? '4-Model Reversal Scanner' : '10-Model Consensus Scanner'}
                                </span>
                            </div>
                        </div>
                        <button className='ai-panel__close' onClick={() => setOpen(false)}><X size={13} /></button>
                    </div>

                    {/* ── Deriv System Status banner ── */}
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
                            <button key={t}
                                className={`ai-panel__type-btn${tradeType === t ? ' ai-panel__type-btn--active' : ''}`}
                                onClick={() => setTradeType(t)}
                            >
                                <span className='ai-panel__type-icon'>{icon}</span>
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Scan button */}
                    <div className='ai-panel__scan-wrap'>
                        <button
                            className={`ai-panel__scan-btn${scanState === 'scanning' ? ' ai-panel__scan-btn--loading' : ''}${maintenanceActive ? ' ai-panel__scan-btn--blocked' : ''}`}
                            onClick={handleScan}
                            disabled={scanState === 'scanning' || maintenanceActive}
                            title={maintenanceActive ? 'Deriv is under maintenance — scanning blocked' : undefined}
                        >
                            {maintenanceActive
                                ? <><span>⛔ Scanning Blocked — Maintenance Active</span></>
                                : scanState === 'scanning'
                                    ? <><Loader2 size={14} className='ai-panel__spin' /><span>Scanning {progress}/{ALL_SYMS.length} markets…</span></>
                                    : <><RefreshCw size={14} /><span>{scanState === 'idle' ? 'Scan All 10 Markets (5k ticks · 4 timeframes)' : 'Re-Scan Markets'}</span></>
                            }
                        </button>
                    </div>

                    {/* Spike warning banner */}
                    {spikedMarkets.length > 0 && scanState !== 'scanning' && (
                        <div className='ai-panel__spike-banner'>
                            <span className='ai-panel__spike-icon'>⚡</span>
                            <div className='ai-panel__spike-content'>
                                <span className='ai-panel__spike-title'>Spike Detected — Markets Skipped</span>
                                <span className='ai-panel__spike-mkts'>
                                    {spikedMarkets.map(s => `${s.label} (${s.sigma}σ)`).join(' · ')}
                                </span>
                                <span className='ai-panel__spike-hint'>Signal generated from clean markets only.</span>
                            </div>
                        </div>
                    )}

                    {/* Progress dots */}
                    {scanState === 'scanning' && (
                        <div className='ai-panel__dots'>
                            {ALL_SYMS.map((s, i) => (
                                <span key={s.code}
                                    className={`ai-panel__dot${i < progress ? ' ai-panel__dot--done' : ' ai-panel__dot--wait'}`}
                                    title={s.short}
                                />
                            ))}
                        </div>
                    )}

                    {/* No signal */}
                    {scanState === 'no-signal' && (
                        <div className='ai-panel__nosig'>
                            <div className='ai-panel__nosig-hd'>
                                <span className='ai-panel__nosig-icon'>⚠️</span>
                                <span className='ai-panel__nosig-txt'>No strong signal found</span>
                            </div>
                            {noSigBest && (
                                <div className='ai-panel__nosig-best'>
                                    <span>Best: <strong>{noSigBest.sym.short}</strong></span>
                                    <span className='ai-panel__nosig-votes' style={{ color: voteColor(noSigBest.votes.yesCount) }}>
                                        {noSigBest.votes.yesCount}/{tradeType === 'even_odd' ? 4 : 10} votes
                                    </span>
                                    <span className='ai-panel__nosig-need'>(need {tradeType === 'even_odd' ? '3/4' : `${MIN_VOTES}/10`})</span>
                                </div>
                            )}
                            {noSigBest && noSigBest.recentDominance?.isCold && (
                                <div className='ai-panel__nosig-dom-warn'>
                                    ⛔ Best candidate blocked — last 20 ticks only {noSigBest.recentDominance.winsLast20}/20 on win side.
                                    Market recently reversed. Wait for momentum to recover.
                                </div>
                            )}
                            <span className='ai-panel__nosig-hint'>Try again in a few minutes or switch trade type.</span>
                        </div>
                    )}

                    {/* Signal result */}
                    {scanState === 'done' && result && (
                        <div className='ai-panel__result'>

                            {/* Market header */}
                            <div className='ai-panel__mkt' style={{ '--vc': vc } as React.CSSProperties}>
                                <div className='ai-panel__mkt-left'>
                                    <span className='ai-panel__mkt-short'>{result.sym.short}</span>
                                    <span className='ai-panel__mkt-label'>{result.sym.label}</span>
                                    <span className='ai-panel__mkt-samples'>{(result.sampleSize / 1000).toFixed(1)}k ticks analysed</span>
                                </div>
                                <div className='ai-panel__mkt-right'>
                                    <div className='ai-panel__strength-badge' style={{ background: `${vc}18`, borderColor: `${vc}50`, color: vc }}>
                                        <span className='ai-panel__strength-votes'>{result.votes.yesCount}/{tradeType === 'even_odd' ? 4 : 10}</span>
                                        <span className='ai-panel__strength-label'>{voteLabel(result.votes.yesCount)}</span>
                                    </div>
                                    <div className={`ai-panel__regime-badge ai-panel__regime-badge--${result.tfAgreement >= 3 ? 'ok' : 'warn'}`}>
                                        <span>{result.tfAgreement}/4 TF</span>
                                        <span className='ai-panel__regime-score'>{result.regimeScore}%</span>
                                    </div>
                                </div>
                            </div>

                            {/* Direction call */}
                            <div className='ai-panel__call' style={{ borderColor: `${vc}40` }}>
                                <span className='ai-panel__call-lbl'>Signal Direction</span>
                                <span className='ai-panel__call-val' style={{ color: vc }}>{result.direction}</span>
                            </div>

                            {/* ── Recent Dominance Gauge ── */}
                            {/* This is the PRIMARY anti-loss guard: shows how many of the last 20 ticks */}
                            {/* landed on the WIN side. If reversed (≤7/20), the signal is blocked.    */}
                            <div className={`ai-panel__dom ai-panel__dom--${result.recentDominance.label.toLowerCase()}`}>
                                <div className='ai-panel__dom-hd'>
                                    <div className='ai-panel__dom-title-row'>
                                        <span className='ai-panel__dom-title'>Digit Dominance</span>
                                        <span className='ai-panel__dom-sub'>last 20 ticks</span>
                                    </div>
                                    <span className={`ai-panel__dom-pill ai-panel__dom-pill--${result.recentDominance.label.toLowerCase()}`}>
                                        {result.recentDominance.label}
                                    </span>
                                </div>

                                {/* Per-tick pip row — green = win tick, red = loss tick */}
                                <div className='ai-panel__dom-pips'>
                                    {result.recentDominance.last20Results.map((win, idx) => (
                                        <span key={idx} className={`ai-panel__dom-pip${win ? ' ai-panel__dom-pip--win' : ' ai-panel__dom-pip--loss'}`} />
                                    ))}
                                </div>

                                {/* Bar track with hot/cold threshold markers */}
                                <div className='ai-panel__dom-bar-track'>
                                    <div className='ai-panel__dom-bar-fill'
                                        style={{ width: `${result.recentDominance.last20WinPct * 100}%` }} />
                                    {/* Cold threshold at 35% — below = BLOCKED */}
                                    <div className='ai-panel__dom-mark ai-panel__dom-mark--cold' style={{ left: '35%' }}>
                                        <span className='ai-panel__dom-mark-label'>Block</span>
                                    </div>
                                    {/* Hot threshold at 65% — above = strong entry */}
                                    <div className='ai-panel__dom-mark ai-panel__dom-mark--hot' style={{ left: '65%' }}>
                                        <span className='ai-panel__dom-mark-label'>Hot</span>
                                    </div>
                                </div>

                                <div className='ai-panel__dom-stats'>
                                    <span className='ai-panel__dom-stat'>
                                        <strong style={{ color: result.recentDominance.last20WinPct >= 0.65 ? '#10b981' : result.recentDominance.last20WinPct <= 0.35 ? '#ef4444' : '#f59e0b' }}>
                                            {result.recentDominance.winsLast20}/20
                                        </strong>
                                        {' '}win side
                                    </span>
                                    <span className='ai-panel__dom-stat'>
                                        <strong>{result.recentDominance.winsLast50}/50</strong>
                                        {' '}(50 ticks)
                                    </span>
                                    <span className='ai-panel__dom-stat'>
                                        {(result.recentDominance.last20WinPct * 100).toFixed(0)}%
                                    </span>
                                </div>

                                {result.recentDominance.isHot && (
                                    <div className='ai-panel__dom-hot-msg'>
                                        🔥 Market is HOT on this signal — enter on next entry digit
                                    </div>
                                )}
                            </div>

                            {/* Win prob bar */}
                            <div className='ai-panel__prob-row'>
                                <span className='ai-panel__prob-lbl'>Win Probability</span>
                                <span className='ai-panel__prob-val' style={{ color: vc }}>{(result.winProb * 100).toFixed(1)}%</span>
                            </div>
                            <div className='ai-panel__prob-bar'>
                                <div className='ai-panel__prob-fill' style={{ width: `${result.winProb * 100}%`, background: `linear-gradient(90deg, ${vc}88, ${vc})` }} />
                                <div className='ai-panel__prob-mid' />
                            </div>

                            {/* Model vote grid */}
                            <div className='ai-panel__models'>
                                <span className='ai-panel__section-lbl'>
                                    Model Consensus — {result.votes.yesCount}/{tradeType === 'even_odd' ? 4 : 10}
                                    &nbsp;·&nbsp;Strength: <strong style={{ color: vc }}>{result.signalStrength}%</strong>
                                    &nbsp;·&nbsp;Segment: <strong style={{ color: result.segmentAgrees ? '#22c55e' : '#ef4444' }}>✓</strong>
                                </span>
                                <div className='ai-panel__model-grid'>
                                    {models.map(m => (
                                        <div key={m.name} className={`ai-panel__model-chip${m.vote ? ' ai-panel__model-chip--yes' : ' ai-panel__model-chip--no'}`}>
                                            <span className='ai-panel__model-chip-icon'>{m.vote ? '✓' : '✗'}</span>
                                            <span className='ai-panel__model-chip-name'>{m.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Prediction display */}
                            <div className='ai-panel__pred'>
                                <span className='ai-panel__section-lbl'>Prediction</span>
                                {tradeType === 'even_odd' ? (
                                    <div className='ai-panel__seg'>
                                        {(['EVEN', 'ODD'] as const).map(d => (
                                            <button key={d}
                                                className={`ai-panel__seg-btn${editDir === d ? ' ai-panel__seg-btn--active' : ''}`}
                                                onClick={() => setEditDir(d)}
                                            >{d}</button>
                                        ))}
                                    </div>
                                ) : tradeType === 'matches_differs' ? (
                                    <div className='ai-panel__pred-md'>
                                        <div className='ai-panel__seg' style={{ marginBottom: 8 }}>
                                            {(['MATCHES', 'DIFFERS'] as const).map(s => (
                                                <button key={s}
                                                    className={`ai-panel__seg-btn${editMatchesSide === s ? ' ai-panel__seg-btn--active' : ''}`}
                                                    onClick={() => setEditMatchesSide(s)}
                                                >{s}</button>
                                            ))}
                                        </div>
                                        <div className='ai-panel__barrier'>
                                            <span className='ai-panel__barrier-lbl'>
                                                Target digit <span className='ai-panel__barrier-rec'>(AI: {result.barrier ?? '?'}★)</span>
                                            </span>
                                            <div className='ai-panel__barrier-grid ai-panel__barrier-grid--10'>
                                                {[0,1,2,3,4,5,6,7,8,9].map(b => (
                                                    <button key={b}
                                                        className={`ai-panel__barrier-btn${editTargetDigit === b ? ' ai-panel__barrier-btn--sel' : ''}${result.barrier === b ? ' ai-panel__barrier-btn--rec' : ''}`}
                                                        onClick={() => setEditTargetDigit(b)}
                                                    >{b}</button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className='ai-panel__pred-ou'>
                                        <div className='ai-panel__seg' style={{ marginBottom: 8 }}>
                                            {(['OVER', 'UNDER'] as const).map(d => (
                                                <button key={d}
                                                    className={`ai-panel__seg-btn${editDir === d ? ' ai-panel__seg-btn--active' : ''}`}
                                                    onClick={() => setEditDir(d)}
                                                >{d}</button>
                                            ))}
                                        </div>
                                        <div className='ai-panel__barrier'>
                                            <span className='ai-panel__barrier-lbl'>
                                                Barrier <span className='ai-panel__barrier-rec'>(AI: {result.barrier ?? '?'}★)</span>
                                            </span>
                                            <div className='ai-panel__barrier-grid'>
                                                {[1,2,3,4,5,6,7,8].map(b => (
                                                    <button key={b}
                                                        className={`ai-panel__barrier-btn${editBarrier === b ? ' ai-panel__barrier-btn--sel' : ''}${result.barrier === b ? ' ai-panel__barrier-btn--rec' : ''}`}
                                                        onClick={() => setEditBarrier(b)}
                                                    >{b}</button>
                                                ))}
                                            </div>
                                        </div>
                                        {tradeType === 'over_under' && (
                                            <div className='ai-panel__recovery'>
                                                <div className='ai-panel__recovery-hd'>
                                                    <span className='ai-panel__recovery-icon'>🔄</span>
                                                    <span className='ai-panel__recovery-lbl'>Recovery barrier (after loss)</span>
                                                    {result.recoveryBarrier !== null && (
                                                        <span className='ai-panel__recovery-rec'>
                                                            AI: {result.recoveryDirection ?? (editDir === 'OVER' ? `UNDER ${result.recoveryBarrier}` : `OVER ${result.recoveryBarrier}`)} ★
                                                        </span>
                                                    )}
                                                </div>
                                                <select
                                                    className='ai-panel__recovery-select'
                                                    value={editRecoveryBarrier ?? result.recoveryBarrier ?? ''}
                                                    onChange={e => setEditRecoveryBarrier(Number(e.target.value))}
                                                >
                                                    {editDir === 'OVER'
                                                        ? [8,7,6,5,4,3,2,1].map(v => (
                                                            <option key={v} value={v}>
                                                                UNDER {v}{result.recoveryBarrier === v ? ' ★ Recommended' : ''}
                                                            </option>
                                                        ))
                                                        : [0,1,2,3,4,5,6,7,8].map(v => (
                                                            <option key={v} value={v}>
                                                                OVER {v}{result.recoveryBarrier === v ? ' ★ Recommended' : ''}
                                                            </option>
                                                        ))
                                                    }
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Entry points */}
                            {result.entryDigits.length > 0 && (
                                <div className='ai-panel__entries'>
                                    <div className='ai-panel__entries-hd'>
                                        <span className='ai-panel__section-lbl'>
                                            Entry Points
                                            <em className='ai-panel__section-hint'> — wait for this last digit, then trade</em>
                                        </span>
                                        {ticksSinceScan > 0 && (
                                            <span className='ai-panel__entry-tick-ctr'>
                                                {ticksSinceScan} tick{ticksSinceScan !== 1 ? 's' : ''} live
                                            </span>
                                        )}
                                    </div>
                                    <div className='ai-panel__entry-grid ai-panel__entry-grid--3'>
                                        {result.entryDigits.map((e, i) => {
                                            const selected  = editEntryPoint === e.digit;
                                            const lastSeen  = digitLastSeen[e.digit]; // -1 = not seen yet
                                            const stale     = ticksSinceScan > 0 && lastSeen > e.avgWaitTicks * 2;
                                            const fresh     = lastSeen === 0; // appeared this tick
                                            const tagLabel  = i === 0 ? '★ Best' : i === 1 ? '◎ Alt 1' : '◎ Alt 2';
                                            const waitColor = e.avgWaitTicks <= 8 ? '#10b981' : e.avgWaitTicks <= 13 ? '#f59e0b' : '#ef4444';
                                            return (
                                                <div
                                                    key={e.digit}
                                                    className={[
                                                        'ai-panel__entry-card',
                                                        i === 0 ? 'ai-panel__entry-card--rec' : '',
                                                        selected ? 'ai-panel__entry-card--selected' : '',
                                                        fresh   ? 'ai-panel__entry-card--fresh'    : '',
                                                        stale   ? 'ai-panel__entry-card--stale'    : '',
                                                    ].join(' ').trim()}
                                                    role='button'
                                                    style={{ cursor: 'pointer', outline: selected ? `2px solid ${vc}` : 'none' }}
                                                    onClick={() => setEditEntryPoint(e.digit)}
                                                >
                                                    {fresh && <span className='ai-panel__entry-now'>NOW</span>}
                                                    {stale && !fresh && <span className='ai-panel__entry-stale-badge'>STALE</span>}
                                                    <div className='ai-panel__entry-digit' style={{ color: i === 0 ? vc : '#e2e8f0' }}>{e.digit}</div>
                                                    <div className='ai-panel__entry-meta'>
                                                        <span className='ai-panel__entry-tag'>{tagLabel}</span>
                                                        <span className='ai-panel__entry-pct' style={{ color: i === 0 ? vc : '#94a3b8' }}>
                                                            {(e.conditional * 100).toFixed(1)}%
                                                        </span>
                                                    </div>
                                                    <div className='ai-panel__entry-wait' style={{ color: waitColor }}>
                                                        ~{e.avgWaitTicks}t wait
                                                    </div>
                                                    {lastSeen >= 0 && !fresh && (
                                                        <div className={`ai-panel__entry-seen${stale ? ' ai-panel__entry-seen--stale' : ''}`}>
                                                            {lastSeen}t ago
                                                        </div>
                                                    )}
                                                    {lastSeen < 0 && ticksSinceScan > 0 && (
                                                        <div className='ai-panel__entry-seen ai-panel__entry-seen--waiting'>
                                                            waiting…
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {result.entryDigits.some(e => digitLastSeen[e.digit] > e.avgWaitTicks * 2 && ticksSinceScan > 0) && (
                                        <div className='ai-panel__entry-stale-warn'>
                                            ⚠️ Entry condition is stale — market may have shifted. Consider re-scanning.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Session discipline */}
                            <div className={`ai-panel__session${sessionOver ? ' ai-panel__session--over' : ''}`}>
                                <div className='ai-panel__session-top'>
                                    <div className='ai-panel__session-left'>
                                        <span className='ai-panel__session-icon'>🎯</span>
                                        <div>
                                            <span className='ai-panel__session-title'>Session Limit</span>
                                            <span className='ai-panel__session-sub'>Max contracts recommended</span>
                                        </div>
                                    </div>
                                    <div className='ai-panel__session-num' style={{ color: sessionOver ? '#ef4444' : '#10b981' }}>
                                        {recRuns}
                                    </div>
                                </div>
                                <div className='ai-panel__session-bar-track'>
                                    <div className='ai-panel__session-bar-fill' style={{
                                        width: `${Math.min(100, (sessionCount / recRuns) * 100)}%`,
                                        background: sessionOver
                                            ? 'linear-gradient(90deg,#ef444499,#ef4444)'
                                            : sessionCount >= recRuns * 0.75
                                                ? 'linear-gradient(90deg,#f59e0b99,#f59e0b)'
                                                : 'linear-gradient(90deg,#10b98199,#10b981)',
                                    }} />
                                </div>
                                <div className='ai-panel__session-counter'>
                                    <div className='ai-panel__session-tally'>
                                        <button className='ai-panel__session-adj' onClick={() => setSessionCount(p => Math.max(0, p - 1))}>−</button>
                                        <span className='ai-panel__session-count'>
                                            <span style={{ color: sessionOver ? '#ef4444' : '#e2e8f0' }}>{sessionCount}</span>
                                            <span className='ai-panel__session-of'>/ {recRuns}</span>
                                        </span>
                                        <button className='ai-panel__session-adj' onClick={() => setSessionCount(p => p + 1)}>+</button>
                                        <button className='ai-panel__session-reset' onClick={() => setSessionCount(0)} title='Reset counter'>↺</button>
                                    </div>
                                    <span className='ai-panel__session-trades-lbl'>contracts run</span>
                                </div>
                                {sessionOver && (
                                    <div className='ai-panel__session-warn'>🛑 Limit reached — stop trading this session</div>
                                )}
                                {!sessionOver && sessionCount >= Math.ceil(recRuns * 0.75) && (
                                    <div className='ai-panel__session-caution'>⚠️ Approaching limit — consider stopping soon</div>
                                )}
                                {sessionCount === 0 && (
                                    <div className='ai-panel__session-hint'>Tap + after each contract · tap ↺ to reset</div>
                                )}
                            </div>

                            {/* Signal history */}
                            {orbHistory.length > 0 && (
                                <div className='ai-panel__history'>
                                    <span className='ai-panel__section-lbl'>Recent Signals</span>
                                    {orbHistory.map((h, i) => (
                                        <div key={i} className='ai-panel__history-row'>
                                            <span className='ai-panel__history-market'>{h.market}</span>
                                            <span className='ai-panel__history-dir'>{h.direction}</span>
                                            <span className='ai-panel__history-votes'>{h.votes}/10</span>
                                            <span className='ai-panel__history-str'>{h.strength}%</span>
                                            <span className='ai-panel__history-time'>
                                                {new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Execute */}
                            <div className='ai-panel__run-cta'>
                                <button
                                    className='ai-panel__run-btn'
                                    disabled={runState === 'launching'}
                                    onClick={openRunConfig}
                                >
                                    <PlayCircle size={16} /> Save &amp; Run on {runTargetLabel}
                                </button>
                                <span className='ai-panel__run-hint'>
                                    {tradeType === 'over_under'
                                        ? `Saves market, barrier ${editBarrier}, recovery ${editRecoveryBarrier ?? editBarrier}, entry digit ${editEntryPoint} and volatility into the bot, then lets you set stake/profit/loss/martingale before running it.`
                                        : tradeType === 'matches_differs'
                                            ? `Saves market, ${editMatchesSide.toLowerCase()} digit ${editTargetDigit}, entry digit ${editEntryPoint} and volatility into the bot, then lets you set stake/profit/loss/martingale before running it.`
                                            : `Saves market, ${editDir.toLowerCase()} prediction, entry digit ${editEntryPoint} and volatility into the bot, then lets you set stake/profit/loss/martingale before running it.`
                                    }
                                </span>
                            </div>

                        </div>
                    )}
                </div>
            )}

            {/* ── Run-config banner: Stake / Take Profit / Stop Loss / Martingale ── */}
            {showRunConfig && (
                <div className='ai-runcfg__overlay' onClick={() => runState !== 'launching' && setShowRunConfig(false)}>
                    <div className='ai-runcfg' onClick={e => e.stopPropagation()}>
                        <div className='ai-runcfg__header'>
                            <span>Set Trade Parameters</span>
                            <button
                                className='ai-runcfg__close'
                                disabled={runState === 'launching'}
                                onClick={() => setShowRunConfig(false)}
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className='ai-runcfg__sub'>
                            Deploying to <strong>{runTargetLabel}</strong> — market, prediction and entry point are already set from the AI signal.
                        </div>

                        <label className='ai-runcfg__field'>
                            <span>Stake</span>
                            <input
                                type='number' min='0' step='0.01'
                                value={cfgStake}
                                onChange={e => setCfgStake(e.target.value)}
                            />
                        </label>

                        <label className='ai-runcfg__field'>
                            <span>Target Profit</span>
                            <input
                                type='number' min='0' step='0.01'
                                value={cfgTakeProfit}
                                onChange={e => setCfgTakeProfit(e.target.value)}
                            />
                        </label>

                        <label className='ai-runcfg__field'>
                            <span>Stop Loss</span>
                            <input
                                type='number' min='0' step='0.01'
                                value={cfgStopLoss}
                                onChange={e => setCfgStopLoss(e.target.value)}
                            />
                        </label>

                        <div className='ai-runcfg__mart'>
                            <label className='ai-runcfg__mart-toggle'>
                                <input
                                    type='checkbox'
                                    checked={cfgMartingaleOn}
                                    onChange={e => setCfgMartingaleOn(e.target.checked)}
                                />
                                <span>Martingale</span>
                            </label>
                            <input
                                type='number' min='0' step='0.1'
                                value={cfgMartingale}
                                disabled={!cfgMartingaleOn}
                                onChange={e => setCfgMartingale(e.target.value)}
                                className='ai-runcfg__mart-input'
                            />
                        </div>
                        <span className='ai-runcfg__mart-hint'>
                            {cfgMartingaleOn
                                ? 'Stake multiplies by this factor after a loss.'
                                : 'Off — martingale is reset to 0, stake stays flat after a loss.'}
                        </span>

                        <button
                            className='ai-runcfg__execute'
                            disabled={runState === 'launching'}
                            onClick={handleExecuteTrade}
                        >
                            {runState === 'launching'
                                ? <><Loader2 size={16} className='ai-panel__spin' /> Launching…</>
                                : <><PlayCircle size={16} /> Execute Trades</>
                            }
                        </button>

                        {runState === 'no-ws' && (
                            <div className='ai-panel__run-err'>Open the <strong>Bot Builder</strong> tab once first, then try again.</div>
                        )}
                        {runState === 'error' && (
                            <div className='ai-panel__run-err'>{runErr}</div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default AiSignalOrb;

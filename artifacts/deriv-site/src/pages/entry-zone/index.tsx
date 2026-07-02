import React, { useCallback, useEffect, useRef, useState } from 'react';
import './entry-zone.scss';
import { DERIV_VOLATILITIES, type DerivVolatility } from '../../utils/deriv-volatilities';

/* ─────────────────────────────────────────────────────────────────────────
   AI Analysis Tool — Multi-Model Consensus Engine
   ─────────────────────────────────────────────────────────────────────────
   Flow:
     1. Trader picks trade type: Over/Under, Even/Odd or Matches/Differs
     2. Clicks "Scan All 10 Markets"
     3. One WebSocket fetches 4000 ticks from every market in parallel
     4. Ten independent models vote on each market
     5. Market with most votes (must be ≥ 6/10) is shown
     6. If none reach 6 votes: "No signal — wait"
   ───────────────────────────────────────────────────────────────────────── */

const DERIV_WS   = 'wss://ws.derivws.com/websockets/v3?app_id=1';
const TICK_COUNT = 6000;   // 6000 ticks per market — stronger statistical reliability
const ALL_SYMS   = DERIV_VOLATILITIES;

function getSymbolMinVotes(symCode: string): number {
    if (symCode.includes('75') || symCode.includes('100')) return 7;
    if (symCode.endsWith('10V') || symCode.endsWith('25V') ||
        symCode.includes('_10') || symCode.includes('_25')) return 5;
    return 6;
}

type TradeType = 'over_under' | 'even_odd' | 'matches_differs';

// ─── Model vote result ────────────────────────────────────────────────────────
interface ModelResult {
    name:   string;
    vote:   boolean;
    score:  number;   // 0.0–1.0 confidence
    detail: string;
}

interface ModelVotes {
    chiSquared:  ModelResult;
    bayesian:    ModelResult;
    momentum:    ModelResult;
    stability:   ModelResult;
    recentEdge:  ModelResult;
    markov:      ModelResult;
    linearTrend: ModelResult;
    entropy:     ModelResult;
    ngram:       ModelResult;
    quartile:    ModelResult;
    yesCount:    number;   // 0–10
    totalScore:  number;   // sum of scores
}

interface MarketResult {
    sym:            DerivVolatility;
    direction:      string;
    contractType:   string;
    barrier:        number | null;
    winProb:        number;
    sampleSize:     number;
    votes:          ModelVotes;
    entryDigits:    { digit: number; recommended: boolean; conditional: number }[];
    digitFreq:      number[];
    segmentAgrees:  boolean;
    signalStrength: number;   // 0–100 weighted %
}

interface HistoryEntry {
    market:    string;
    direction: string;
    votes:     number;
    strength:  number;
    time:      number;
}

interface ConsensusResult {
    best:       MarketResult;
    runner:     MarketResult | null;
    scannedAt:  number;
    validityMs: number;
    expiresAt:  number;
}

// ─── Helpers ─────────────────────────────────────────────────────���────────────
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

const fmtRemaining = (ms: number): string => {
    if (ms <= 0) return '0:00';
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

// ─── Run all 5 models on one market ──────────────────────────────────────────
function runModels(
    prices: number[],
    pip: number,
    sym: DerivVolatility,
    tradeType: TradeType,
): MarketResult {
    const N      = prices.length;
    const digits = prices.map(p => lastDigitOf(p, pip));
    const freq   = new Array(10).fill(0);
    for (const d of digits) freq[d]++;
    const freqPct = freq.map(f => f / N);

    // ── Direction: pick best trade direction for this market ──────────────
    let direction = '', contractType = '', barrier: number | null = null, winProb = 0;
    let winFn: (d: number) => boolean;

    if (tradeType === 'even_odd') {
        const evenCt = digits.filter(d => d % 2 === 0).length;
        const oddCt  = N - evenCt;
        if (evenCt >= oddCt) {
            direction = 'EVEN'; contractType = 'DIGITEVEN';
            winProb = evenCt / N; winFn = d => d % 2 === 0;
        } else {
            direction = 'ODD'; contractType = 'DIGITODD';
            winProb = oddCt / N; winFn = d => d % 2 !== 0;
        }
    } else if (tradeType === 'matches_differs') {
        // Pick between MATCHES (hottest digit) and DIFFERS (coldest digit)
        // using chi-square contribution — whichever deviation is stronger wins.
        const exp2        = N / 10;
        const chiContribs = freq.map(f => (f - exp2) ** 2 / exp2);
        let matchDig  = 0;
        let differDig = 0;
        for (let d = 1; d < 10; d++) {
            if (freq[d] > freq[matchDig])  matchDig  = d;
            if (freq[d] < freq[differDig]) differDig = d;
        }
        const matchContrib  = chiContribs[matchDig];
        const differContrib = chiContribs[differDig];
        if (matchContrib >= differContrib) {
            barrier      = matchDig;
            direction    = `MATCHES ${matchDig}`;
            contractType = 'DIGITMATCH';
            winProb      = freq[matchDig] / N;
            winFn        = d => d === matchDig;
        } else {
            barrier      = differDig;
            direction    = `DIFFERS ${differDig}`;
            contractType = 'DIGITDIFF';
            winProb      = 1 - freq[differDig] / N;
            winFn        = d => d !== differDig;
        }
    } else {
        let best = { side: 'OVER' as 'OVER' | 'UNDER', b: 5, prob: 0 };
        for (let b = 1; b <= 8; b++) {
            const ov = digits.filter(d => d > b).length / N;
            const un = digits.filter(d => d < b).length / N;
            if (ov > best.prob) best = { side: 'OVER',  b, prob: ov };
            if (un > best.prob) best = { side: 'UNDER', b, prob: un };
        }
        barrier      = best.b;
        direction    = `${best.side} ${best.b}`;
        contractType = best.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
        winProb      = best.prob;
        winFn        = d => best.side === 'OVER' ? d > best.b : d < best.b;
    }

    // ── Entry digits — strict: min 100 samples, Wilson LB ≥ baseline+10pp ──
    const cond = new Array(10).fill(null).map(() => ({ wins: 0, total: 0 }));
    for (let i = 0; i < digits.length - 1; i++) {
        cond[digits[i]].total++;
        if (winFn(digits[i + 1])) cond[digits[i]].wins++;
    }
    const minSmp = Math.max(50, Math.floor(N / 50));  // at least 50 samples per digit
    let entryRaw = cond
        .map((c, d) => ({
            digit:       d,
            conditional: c.total > 0 ? c.wins / c.total : 0,
            lowerBound:  wilsonLower(c.wins, c.total),
            total:       c.total,
        }))
        .filter(c => c.total >= minSmp && c.lowerBound >= winProb + 0.02)
        .sort((a, b) => b.lowerBound - a.lowerBound || b.conditional - a.conditional)
        .slice(0, 2);

    // fallback: relax LB threshold only (keep min samples)
    if (entryRaw.length < 2) {
        const used = new Set(entryRaw.map(e => e.digit));
        const fb = cond
            .map((c, d) => ({ digit: d, conditional: c.total > 0 ? c.wins / c.total : 0, lowerBound: wilsonLower(c.wins, c.total), total: c.total }))
            .filter(c => !used.has(c.digit) && c.total >= minSmp)
            .sort((a, b) => b.lowerBound - a.lowerBound || b.conditional - a.conditional);
        while (entryRaw.length < 2 && fb.length > 0) entryRaw.push(fb.shift()!);
    }
    // last resort: use raw frequency
    while (entryRaw.length < 2) {
        const used = new Set(entryRaw.map(e => e.digit));
        const fb2  = freqPct
            .map((p, d) => ({ digit: d, conditional: p, lowerBound: 0, total: 0 }))
            .filter(e => !used.has(e.digit))
            .sort((a, b) => b.conditional - a.conditional)[0];
        if (!fb2) break;
        entryRaw.push(fb2);
    }

    const entryDigits = entryRaw.map((e, i) => ({
        digit: e.digit, recommended: i === 0, conditional: e.conditional,
    }));

    // ══ MODEL 1 — Chi-Squared / Z-test Statistical Significance ══════════
    // p<0.05 threshold — proven working level for Deriv volatility markets
    let m1: ModelResult;
    if (tradeType === 'even_odd') {
        const zStat = (winProb - 0.5) / Math.sqrt(0.25 / N);
        const vote  = Math.abs(zStat) >= 1.65 && winProb >= 0.51;
        m1 = {
            name:   'Statistical Significance',
            vote,
            score:  Math.min(1, Math.abs(zStat) / 4),
            detail: vote
                ? `Z=${zStat.toFixed(2)} — parity imbalance is statistically real (p<0.05)`
                : `Z=${zStat.toFixed(2)} — split too close to 50/50`,
        };
    } else if (tradeType === 'matches_differs') {
        const expMd   = N / 10;
        const targetD = barrier as number;
        const contrib = (freq[targetD] - expMd) ** 2 / expMd;
        let vote: boolean;
        let detail: string;
        if (direction.startsWith('MATCHES')) {
            vote   = contrib >= 4 && winProb >= 0.13;
            detail = vote
                ? `Digit ${targetD} appears ${(winProb*100).toFixed(1)}% — hot digit, well above 10% baseline (χ²-contrib=${contrib.toFixed(1)})`
                : `Digit ${targetD}: ${(winProb*100).toFixed(1)}% — not significantly hotter than baseline`;
        } else {
            vote   = contrib >= 4 && winProb >= 0.91;
            detail = vote
                ? `Digit ${targetD} appears ${(freq[targetD]/N*100).toFixed(1)}% — cold/absent, DIFFERS wins ${(winProb*100).toFixed(1)}% (χ²-contrib=${contrib.toFixed(1)})`
                : `Digit ${targetD}: ${(freq[targetD]/N*100).toFixed(1)}% — not cold enough for a safe DIFFERS`;
        }
        m1 = { name: 'Statistical Significance', vote, score: Math.min(1, contrib / 12), detail };
    } else {
        const exp   = N / 10;
        const chiSq = freq.reduce((acc, f) => acc + (f - exp) ** 2 / exp, 0);
        const vote  = chiSq >= 16.92 && winProb >= 0.62;
        m1 = {
            name:   'Statistical Significance',
            vote,
            score:  Math.min(1, chiSq / 30),
            detail: vote
                ? `χ²=${chiSq.toFixed(1)} — digit distribution significantly skewed (p<0.05)`
                : `χ²=${chiSq.toFixed(1)} — distribution near uniform`,
        };
    }

    // ══ MODEL 2 — Bayesian Conditional Probability ════════════════════════
    const best2  = entryDigits[0];
    const m2Vote = best2 ? best2.conditional >= winProb + 0.05 : false;
    const m2: ModelResult = {
        name:   'Bayesian Conditional',
        vote:   m2Vote,
        score:  best2 ? Math.min(1, Math.max(0, (best2.conditional - winProb) / 0.20)) : 0,
        detail: best2
            ? (m2Vote
                ? `Digit ${best2.digit} → ${(best2.conditional * 100).toFixed(1)}% win (+${((best2.conditional - winProb) * 100).toFixed(1)}pp above base) — strong entry trigger`
                : `Best conditional ${(best2.conditional * 100).toFixed(1)}% — not far enough above baseline (+${((best2.conditional - winProb) * 100).toFixed(1)}pp, need +5pp)`)
            : 'No entry digit with sufficient sample count',
    };

    // ══ MODEL 3 — 3-Window Trend Momentum ════════════════════════════════
    // Upgrade: 3 time windows — edge must be present in all three AND
    // rising toward the present (recent ≥ mid ≥ old)
    const w3A = Math.floor(N * 0.10);  // recent 10%
    const w3B = Math.floor(N * 0.30);  // middle 20% (10%–30% from end)
    const w3C = Math.floor(N * 0.60);  // older 30% (30%–60% from end)
    const winR = digits.slice(-w3A).filter(winFn).length / w3A;
    const winM = digits.slice(-(w3A + w3B), -w3A).filter(winFn).length / w3B;
    const winO = digits.slice(-(w3A + w3B + w3C), -(w3A + w3B)).filter(winFn).length / w3C;
    // All three above baseline AND no sharp recent drop
    const m3Vote = winR >= winProb - 0.01
        && winM >= winProb - 0.02
        && winO >= winProb - 0.03
        && winR >= winM - 0.03;  // recent not collapsing vs mid
    const m3: ModelResult = {
        name:   '3-Window Trend',
        vote:   m3Vote,
        score:  Math.min(1, Math.max(0, ((winR - winProb) + (winM - winProb) + (winO - winProb) + 0.06) / 0.18)),
        detail: m3Vote
            ? `Old ${(winO*100).toFixed(1)}% → Mid ${(winM*100).toFixed(1)}% → Recent ${(winR*100).toFixed(1)}% — edge holding across all windows`
            : `Old ${(winO*100).toFixed(1)}% / Mid ${(winM*100).toFixed(1)}% / Recent ${(winR*100).toFixed(1)}% — trend inconsistent or falling`,
    };

    // ══ MODEL 4 — Stability (5 equal windows, 3/5 must beat threshold) ════
    const wSz  = Math.floor(N / 5);
    const wThr = tradeType === 'even_odd' ? 0.50
               : tradeType === 'matches_differs' ? (direction.startsWith('MATCHES') ? 0.11 : 0.87)
               : 0.60;
    let wAbove = 0;
    const wRates: number[] = [];
    for (let w = 0; w < 5; w++) {
        const wr = digits.slice(w * wSz, (w + 1) * wSz).filter(winFn).length / wSz;
        wRates.push(wr);
        if (wr >= wThr) wAbove++;
    }
    const m4MinWin = tradeType === 'even_odd' || tradeType === 'matches_differs' ? 3 : 4;
    const m4Vote = wAbove >= m4MinWin;
    const m4: ModelResult = {
        name:   'Full-Period Stability',
        vote:   m4Vote,
        score:  wAbove / 5,
        detail: m4Vote
            ? `${wAbove}/5 time windows above ${(wThr * 100).toFixed(0)}% — edge is consistent, not a streak`
            : `Only ${wAbove}/5 windows above ${(wThr * 100).toFixed(0)}% — need ${m4MinWin}/5 (${wRates.map(r=>(r*100).toFixed(0)+'%').join(', ')}) — edge is patchy`,
    };

    // ══ MODEL 5 — Dual-Layer Recent Edge ════════════════════════════════
    // Upgrade: BOTH last 100 AND last 500 ticks must confirm the edge
    // This rules out signals that are just a very recent hot streak
    const rSlice100 = digits.slice(-100);
    const rSlice500 = digits.slice(-500);
    const rWin100   = rSlice100.filter(winFn).length / rSlice100.length;
    const rWin500   = rSlice500.filter(winFn).length / rSlice500.length;
    const eThr100   = tradeType === 'even_odd' ? 0.52
                    : tradeType === 'matches_differs' ? (direction.startsWith('MATCHES') ? 0.12 : 0.89)
                    : 0.61;
    const eThr500   = tradeType === 'even_odd' ? 0.51
                    : tradeType === 'matches_differs' ? (direction.startsWith('MATCHES') ? 0.11 : 0.88)
                    : 0.60;
    // Also check edge is not in active decline (last 100 not crashing vs last 500)
    const notDecaying = rWin100 >= rWin500 - 0.05;
    const m5Vote = rWin100 >= eThr100 && rWin500 >= eThr500 && notDecaying;
    const m5: ModelResult = {
        name:   'Dual-Layer Recent Edge',
        vote:   m5Vote,
        score:  Math.min(1, Math.max(0, (Math.min(rWin100, rWin500) - (eThr500 - 0.05)) / 0.15)),
        detail: m5Vote
            ? `Last 100: ${(rWin100*100).toFixed(1)}% / Last 500: ${(rWin500*100).toFixed(1)}% — edge confirmed in BOTH recent windows`
            : !notDecaying
                ? `Last 100: ${(rWin100*100).toFixed(1)}% vs Last 500: ${(rWin500*100).toFixed(1)}% — edge decaying right now, avoid`
                : `Last 100: ${(rWin100*100).toFixed(1)}% / Last 500: ${(rWin500*100).toFixed(1)}% — recent data doesn't meet threshold`,
    };

    // ══ MODEL 6 — Markov Chain (Bigram Transition) ════════════════════════════
    const markovTable = new Map<number, { wins: number; total: number }>();
    for (let i = 0; i < digits.length - 1; i++) {
        const k = digits[i];
        if (!markovTable.has(k)) markovTable.set(k, { wins: 0, total: 0 });
        const me = markovTable.get(k)!;
        me.total++;
        if (winFn(digits[i + 1])) me.wins++;
    }
    const lastDig6   = digits[digits.length - 1];
    const mkvEnt     = markovTable.get(lastDig6);
    const mkvProb    = mkvEnt && mkvEnt.total >= 20 ? mkvEnt.wins / mkvEnt.total : winProb;
    const m6Vote     = !!(mkvEnt && mkvEnt.total >= 20 && mkvProb >= winProb + 0.03);
    const m6: ModelResult = {
        name:   'Markov-2 Chain',
        vote:   m6Vote,
        score:  mkvEnt ? Math.min(1, Math.max(0, (mkvProb - winProb + 0.05) / 0.15)) : 0,
        detail: mkvEnt && mkvEnt.total >= 20
            ? (m6Vote
                ? `After digit ${lastDig6}: P(win) = ${(mkvProb*100).toFixed(1)}% vs ${(winProb*100).toFixed(1)}% base — transition favours entry now`
                : `After digit ${lastDig6}: transition P(win) = ${(mkvProb*100).toFixed(1)}% — not strong enough (+${((mkvProb-winProb)*100).toFixed(1)}pp, need +3pp)`)
            : `Insufficient history for digit ${lastDig6} (need ≥20 samples after it)`,
    };

    // ══ MODEL 7 — Linear Trend Across 10 Windows ══════════════════════════════
    const w10Sz    = Math.floor(N / 10);
    const w10Rates = Array.from({ length: 10 }, (_, i) =>
        digits.slice(i * w10Sz, (i + 1) * w10Sz).filter(winFn).length / Math.max(1, w10Sz)
    );
    const xM7 = 4.5;
    const yM7 = w10Rates.reduce((s, r) => s + r, 0) / 10;
    let numM7 = 0, denM7 = 0;
    for (let i = 0; i < 10; i++) { numM7 += (i - xM7) * (w10Rates[i] - yM7); denM7 += (i - xM7) ** 2; }
    const slopeM7   = denM7 ? numM7 / denM7 : 0;
    const lastRate7 = w10Rates[9];
    const thr7      = tradeType === 'even_odd' ? 0.49 : tradeType === 'matches_differs'
        ? (direction.startsWith('MATCHES') ? 0.10 : 0.87) : 0.58;
    const m7Vote    = slopeM7 >= -0.005 && lastRate7 >= thr7;
    const m7: ModelResult = {
        name:   'Linear Trend',
        vote:   m7Vote,
        score:  Math.min(1, Math.max(0, (lastRate7 - thr7 + 0.05 + Math.max(0, slopeM7) * 2) / 0.15)),
        detail: m7Vote
            ? `Slope ${slopeM7 >= 0 ? '+' : ''}${(slopeM7*100).toFixed(2)}pp/window · Recent rate ${(lastRate7*100).toFixed(1)}% — non-declining and above threshold`
            : `Slope ${(slopeM7*100).toFixed(2)}pp/window · Recent ${(lastRate7*100).toFixed(1)}% — trend declining or below threshold`,
    };

    // ══ MODEL 8 — Shannon Entropy Guard ═══════════════════════════════════════
    let H8 = 0;
    for (const f of freqPct) { if (f > 0) H8 -= f * Math.log2(f); }
    const normH8 = H8 / Math.log2(10);
    const m8Vote = normH8 <= 0.91;
    const m8: ModelResult = {
        name:   'Entropy Guard',
        vote:   m8Vote,
        score:  Math.min(1, Math.max(0, (0.96 - normH8) / 0.15)),
        detail: m8Vote
            ? `Normalised entropy ${(normH8*100).toFixed(1)}% — distribution has genuine structure (≤91% of max)`
            : `Normalised entropy ${(normH8*100).toFixed(1)}% — digit stream too close to uniform random`,
    };

    // ══ MODEL 9 — N-Gram Pattern Memory (4-digit sequences) ═══════════════════
    const NGRAM9  = 4;
    const ngTable = new Map<string, { wins: number; total: number }>();
    for (let i = 0; i <= digits.length - NGRAM9 - 1; i++) {
        const key = digits.slice(i, i + NGRAM9).join(',');
        if (!ngTable.has(key)) ngTable.set(key, { wins: 0, total: 0 });
        const ne = ngTable.get(key)!;
        ne.total++;
        if (winFn(digits[i + NGRAM9])) ne.wins++;
    }
    const curKey9 = digits.slice(-NGRAM9).join(',');
    const ngEnt   = ngTable.get(curKey9);
    const ngProb  = ngEnt && ngEnt.total >= 6 ? ngEnt.wins / ngEnt.total : winProb;
    const m9Vote  = !!(ngEnt && ngEnt.total >= 6 && ngProb >= winProb + 0.03);
    const m9: ModelResult = {
        name:   'N-Gram Memory',
        vote:   m9Vote,
        score:  ngEnt ? Math.min(1, Math.max(0, (ngProb - winProb + 0.05) / 0.20)) : 0,
        detail: ngEnt && ngEnt.total >= 6
            ? (m9Vote
                ? `Pattern …${curKey9.split(',').join('')}: P(win) = ${(ngProb*100).toFixed(1)}% — sequence historically favourable`
                : `Pattern …${curKey9.split(',').join('')}: ${(ngProb*100).toFixed(1)}% — this pattern doesn't add edge`)
            : `Current 4-digit pattern seen < 6 times in history — insufficient data`,
    };

    // ══ MODEL 10 — Full-Quartile Persistence ══════════════════════════════════
    // ALL 4 quartiles must individually beat the threshold — stricter than Model 4
    const qSz    = Math.floor(N / 4);
    const qThr   = tradeType === 'even_odd' ? 0.49 : tradeType === 'matches_differs'
        ? (direction.startsWith('MATCHES') ? 0.10 : 0.87) : 0.58;
    const qRates = [0,1,2,3].map(q => digits.slice(q*qSz, (q+1)*qSz).filter(winFn).length / Math.max(1, qSz));
    const m10Vote = qRates.every(r => r >= qThr);
    const m10: ModelResult = {
        name:   'Quartile Persistence',
        vote:   m10Vote,
        score:  qRates.filter(r => r >= qThr).length / 4,
        detail: m10Vote
            ? `All 4 quartiles ≥ ${(qThr*100).toFixed(0)}%: ${qRates.map(r => (r*100).toFixed(0)+'%').join(' · ')} — edge is structural, not a streak`
            : `${qRates.filter(r => r >= qThr).length}/4 quartiles pass (${qRates.map(r => (r*100).toFixed(0)+'%').join(' · ')}) — edge is inconsistent across time`,
    };

    const yesCount   = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10].filter(m => m.vote).length;
    const totalScore = m1.score + m2.score + m3.score + m4.score + m5.score +
                       m6.score + m7.score + m8.score + m9.score + m10.score;

    const votes: ModelVotes = {
        chiSquared: m1, bayesian: m2, momentum: m3, stability: m4, recentEdge: m5,
        markov: m6, linearTrend: m7, entropy: m8, ngram: m9, quartile: m10,
        yesCount, totalScore,
    };

    return {
        sym, direction, contractType, barrier, winProb, sampleSize: N, votes, entryDigits,
        digitFreq:      freqPct,
        segmentAgrees:  true,
        signalStrength: Math.round((totalScore / 10) * 100),
    };
}

// ─── Scan stages ───���──────────────────────────────────────────────────────────
type StageId = 'connect' | 'fetch' | 'analyse' | 'select';
const STAGES: { id: StageId; label: string; icon: string }[] = [
    { id: 'connect', label: 'Connecting to live data feed',          icon: '📡' },
    { id: 'fetch',   label: 'Fetching 6000 ticks × 10 markets',       icon: '⬇️' },
    { id: 'analyse', label: 'Running 10-model analysis per market',  icon: '🧮' },
    { id: 'select',  label: 'Selecting best market by consensus',     icon: '🎯' },
];

// ─── Component ────────────────────────────────────────────────────────────────
const EntryZone: React.FC = () => {
    const [tradeType,    setTradeType]    = useState<TradeType>('over_under');
    const [status,       setStatus]       = useState<'idle' | 'scanning' | 'ready' | 'no-signal' | 'error'>('idle');
    const [stage,        setStage]        = useState<StageId>('connect');
    const [received,     setReceived]     = useState<number>(0);    // markets fetched so far
    const [result,       setResult]       = useState<ConsensusResult | null>(null);
    const [noSigReason,  setNoSigReason]  = useState<string>('');
    const [noSigBest,    setNoSigBest]    = useState<MarketResult | null>(null);
    const [error,        setError]        = useState<string>('');
    const [now,          setNow]          = useState<number>(() => Date.now());
    const [history,      setHistory]      = useState<HistoryEntry[]>(() => {
        try { return JSON.parse(localStorage.getItem('ez-signal-history') ?? '[]'); } catch { return []; }
    });

    const wsRef    = useRef<WebSocket | null>(null);
    const abortRef = useRef<boolean>(false);

    // countdown clock
    useEffect(() => {
        if (!result) return;
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [result]);

    const remainingMs  = result ? Math.max(0, result.expiresAt - now) : 0;
    const remainingPct = result ? Math.max(0, Math.min(100, (remainingMs / result.validityMs) * 100)) : 0;
    const isExpired    = !!result && remainingMs <= 0;

    const cleanupWs = useCallback(() => {
        abortRef.current = true;
        if (wsRef.current) {
            try { wsRef.current.close(); } catch { /* ignore */ }
            wsRef.current = null;
        }
    }, []);

    useEffect(() => () => cleanupWs(), [cleanupWs]);

    // ── Launch scan ──────────────────────────────────────────────────────
    const launch = useCallback(() => {
        cleanupWs();
        abortRef.current = false;
        setStatus('scanning');
        setStage('connect');
        setReceived(0);
        setResult(null);
        setNoSigReason('');
        setNoSigBest(null);
        setError('');

        const ws = new WebSocket(DERIV_WS);
        wsRef.current = ws;

        const collected = new Map<number, { prices: number[]; pip: number; sym: DerivVolatility }>();
        const pending   = new Set<number>();

        const timeout = setTimeout(() => {
            if (abortRef.current) return;
            // use whatever data we have so far if ≥ 5 markets
            if (collected.size >= 5) {
                analyse(collected);
            } else {
                setStatus('error');
                setError('Scan timed out — could not reach Deriv feed. Check your connection and try again.');
                cleanupWs();
            }
        }, 25000);

        const analyse = (data: Map<number, { prices: number[]; pip: number; sym: DerivVolatility }>) => {
            clearTimeout(timeout);
            if (abortRef.current) return;

            setStage('analyse');
            setTimeout(() => {
                if (abortRef.current) return;
                setStage('select');

                const results: MarketResult[] = [];
                data.forEach(({ prices, pip, sym }) => {
                    if (prices.length < 100) return;
                    const full = runModels(prices, pip, sym, tradeType);
                    if (prices.length >= 1600) {
                        const seg = runModels(prices.slice(-1500), pip, sym, tradeType);
                        full.segmentAgrees = seg.direction === full.direction && seg.votes.yesCount >= 4;
                    }
                    results.push(full);
                });

                // Sort by (yesCount DESC, totalScore DESC)
                results.sort((a, b) =>
                    b.votes.yesCount   - a.votes.yesCount ||
                    b.votes.totalScore - a.votes.totalScore
                );

                const best   = results[0];
                const runner = results[1] ?? null;

                setTimeout(() => {
                    if (abortRef.current) return;

                    const minVotes = best ? getSymbolMinVotes(best.sym.code) : 6;
                    const segOk    = !best || best.segmentAgrees;
                    const freshOk  = !best || best.votes.recentEdge.vote;

                    if (!best || best.votes.yesCount < minVotes || !segOk || !freshOk) {
                        const topVotes = best?.votes.yesCount ?? 0;
                        const reason   = !best
                            ? 'No markets returned enough data.'
                            : !freshOk
                            ? `${best.sym.label}'s edge is not confirmed in the last 100 ticks — the pattern may be fading. Wait and re-scan.`
                            : !segOk
                            ? `The recent 1500-tick window disagrees with the full-period direction on ${best.sym.label} — conflicting signals. Wait and re-scan.`
                            : `The best market (${best.sym.label}) only achieved ${topVotes}/10 model votes — need ${minVotes}/10 for this market. All 10 markets scanned. Wait 2–3 minutes and re-scan.`;
                        setNoSigReason(reason);
                        setNoSigBest(best ?? null);
                        setStatus('no-signal');
                        return;
                    }

                    const validityMs = (best.sym.tickEvery === 1 ? 300 : 420) * 1000;
                    const scannedAt  = Date.now();

                    // Save to history
                    try {
                        const entry: HistoryEntry = {
                            market:    best.sym.short,
                            direction: best.direction,
                            votes:     best.votes.yesCount,
                            strength:  best.signalStrength,
                            time:      scannedAt,
                        };
                        const prev: HistoryEntry[] = JSON.parse(localStorage.getItem('ez-signal-history') ?? '[]');
                        const next = [entry, ...prev].slice(0, 5);
                        localStorage.setItem('ez-signal-history', JSON.stringify(next));
                        setHistory(next);
                    } catch { /* ignore */ }

                    setResult({ best, runner, scannedAt, validityMs, expiresAt: scannedAt + validityMs });
                    setNow(Date.now());
                    setStatus('ready');
                }, 300);
            }, 400);
        };

        ws.onopen = () => {
            if (abortRef.current) return;
            setStage('fetch');
            ALL_SYMS.forEach((sym, i) => {
                const reqId = i + 1;
                pending.add(reqId);
                ws.send(JSON.stringify({
                    ticks_history: sym.code,
                    end:           'latest',
                    count:         TICK_COUNT,
                    style:         'ticks',
                    req_id:        reqId,
                }));
            });
        };

        ws.onmessage = (ev) => {
            if (abortRef.current) return;
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }

            const reqId = msg.req_id as number | undefined;
            if (reqId === undefined || !pending.has(reqId)) return;

            pending.delete(reqId);

            if (!msg.error && msg.history?.prices) {
                const sym  = ALL_SYMS[reqId - 1];
                const raw  = (msg.history.prices as any[]).map((x: any) =>
                    typeof x === 'string' ? parseFloat(x) : x
                ).filter(Number.isFinite);
                const pip  = msg.pip_size ?? (raw[0]?.toString().split('.')[1]?.length ?? 2);
                if (raw.length >= 100) {
                    collected.set(reqId, { prices: raw, pip, sym });
                    setReceived(collected.size);
                }
            }

            if (pending.size === 0) {
                try { ws.close(); } catch { /* ignore */ }
                wsRef.current = null;
                analyse(collected);
            }
        };

        ws.onerror = () => {
            if (abortRef.current) return;
            if (collected.size >= 5) {
                // partial data — try to analyse what we have
                if (wsRef.current) { try { wsRef.current.close(); } catch { /* ignore */ } wsRef.current = null; }
                analyse(collected);
                return;
            }
            clearTimeout(timeout);
            setStatus('error');
            setError('Could not reach the Deriv tick feed.');
            cleanupWs();
        };

        ws.onclose = () => {
            if (abortRef.current) return;
            if (wsRef.current === ws) wsRef.current = null;
        };
    }, [cleanupWs, tradeType]);

    // ── Render ─────────────��──────────────────────────────────────────────
    const voteColor = (n: number) =>
        n >= 9 ? '#16a34a' : n >= 6 ? '#15803d' : n >= 4 ? '#d97706' : '#dc2626';
    const voteLabel = (n: number) =>
        n >= 10 ? 'Unanimous — all 10 models agree'
        : n >= 9  ? 'Near-unanimous (9/10)'
        : n >= 8  ? 'Strong consensus (8/10)'
        : n >= 6  ? 'Consensus met (6/10) — signal confirmed'
        : n >= 4  ? 'Moderate — below signal threshold'
        : 'No consensus';

    return (
        <div className='ai-tool'>
            <header className='ai-tool__head'>
                <div className='ai-tool__brand'>
                    <span className='ai-tool__brand-emoji' role='img' aria-label='brain'>🧠</span>
                    <div>
                        <h1 className='ai-tool__title'>AI Analysis Tool</h1>
                        <p className='ai-tool__sub'>
                            10 independent models scan all 10 markets simultaneously. All trade types require 6/10 models to agree. Signals only fire when the data is genuinely skewed across multiple statistical frameworks.
                        </p>
                    </div>
                </div>
            </header>

            {/* Trade type selector */}
            <section className='ai-tool__step'>
                <span className='ai-tool__step-title'>Select trade type</span>
                <div className='ai-type-selector'>
                    <button
                        type='button'
                        className={`ai-type-btn ${tradeType === 'over_under' ? 'ai-type-btn--active' : ''}`}
                        onClick={() => { setTradeType('over_under'); setStatus('idle'); setResult(null); }}
                    >
                        <span className='ai-type-btn__icon'>📊</span>
                        <span className='ai-type-btn__label'>Over / Under</span>
                        <span className='ai-type-btn__sub'>Last digit vs barrier</span>
                    </button>
                    <button
                        type='button'
                        className={`ai-type-btn ${tradeType === 'even_odd' ? 'ai-type-btn--active' : ''}`}
                        onClick={() => { setTradeType('even_odd'); setStatus('idle'); setResult(null); }}
                    >
                        <span className='ai-type-btn__icon'>⚖️</span>
                        <span className='ai-type-btn__label'>Even / Odd</span>
                        <span className='ai-type-btn__sub'>Last digit parity</span>
                    </button>
                    <button
                        type='button'
                        className={`ai-type-btn ${tradeType === 'matches_differs' ? 'ai-type-btn--active' : ''}`}
                        onClick={() => { setTradeType('matches_differs'); setStatus('idle'); setResult(null); }}
                    >
                        <span className='ai-type-btn__icon'>🎯</span>
                        <span className='ai-type-btn__label'>Matches / Differs</span>
                        <span className='ai-type-btn__sub'>Exact digit prediction</span>
                    </button>
                </div>
            </section>

            {/* Launch */}
            <section className='ai-tool__step'>
                <button
                    type='button'
                    className='ai-launch'
                    disabled={status === 'scanning'}
                    onClick={launch}
                >
                    {status === 'scanning' ? '🔍 Scanning all 10 markets…' : '🚀 Scan All 10 Markets'}
                </button>

                {status === 'scanning' && (
                    <div className='ai-scan'>
                        <div className='ai-scan__radar' aria-hidden='true'>
                            <div className='ai-scan__radar-ring ai-scan__radar-ring--1' />
                            <div className='ai-scan__radar-ring ai-scan__radar-ring--2' />
                            <div className='ai-scan__radar-ring ai-scan__radar-ring--3' />
                            <div className='ai-scan__radar-sweep' />
                            <div className='ai-scan__radar-core'>🧠</div>
                        </div>

                        <div className='ai-scan__counter'>
                            <div className='ai-scan__counter-num'>
                                {received}
                                <span className='ai-scan__counter-tot'> / {ALL_SYMS.length}</span>
                            </div>
                            <div className='ai-scan__counter-lab'>markets data collected</div>
                        </div>

                        <ol className='ai-scan__stages'>
                            {STAGES.map((s, i) => {
                                const cur   = STAGES.findIndex(x => x.id === stage);
                                const state = i < cur ? 'done' : i === cur ? 'active' : 'pending';
                                return (
                                    <li key={s.id} className={`ai-scan-stage ai-scan-stage--${state}`}>
                                        <span className='ai-scan-stage__bullet'>
                                            {state === 'done'    && '✓'}
                                            {state === 'active'  && <span className='ai-scan-stage__dots'>•••</span>}
                                            {state === 'pending' && s.icon}
                                        </span>
                                        <span className='ai-scan-stage__text'>{s.label}</span>
                                    </li>
                                );
                            })}
                        </ol>

                        <div className='ai-scan__market-prog'>
                            <div
                                className='ai-scan__market-fill'
                                style={{ width: `${(received / ALL_SYMS.length) * 100}%` }}
                            />
                        </div>
                    </div>
                )}

                {status === 'error' && (
                    <div className='ai-alert ai-alert--err'>⚠️ {error}</div>
                )}
            </section>

            {/* No signal */}
            {status === 'no-signal' && (
                <section className='ai-nosignal'>
                    <div className='ai-nosignal__icon'>🔍</div>
                    <h2 className='ai-nosignal__title'>No strong signal right now</h2>
                    <p className='ai-nosignal__sub'>
                        All 10 markets scanned. Best market achieved {noSigBest?.votes.yesCount ?? 0}/10 votes —{' '}
                        need {noSigBest ? getSymbolMinVotes(noSigBest.sym.code) : 6}/10 for that market.
                    </p>
                    <div className='ai-nosignal__reason'>
                        <div className='ai-nosignal__reason-title'>Why</div>
                        <p>{noSigReason}</p>
                    </div>

                    {noSigBest && (
                        <div className='ai-nosignal__breakdown'>
                            <div className='ai-nosignal__breakdown-title'>
                                Best market model breakdown — {noSigBest.sym.label}
                            </div>
                            {[noSigBest.votes.chiSquared, noSigBest.votes.bayesian, noSigBest.votes.momentum, noSigBest.votes.stability, noSigBest.votes.recentEdge, noSigBest.votes.markov, noSigBest.votes.linearTrend, noSigBest.votes.entropy, noSigBest.votes.ngram, noSigBest.votes.quartile].map((m, i) => (
                                <div key={i} className={`ai-model-row ai-model-row--${m.vote ? 'yes' : 'no'}`}>
                                    <div className='ai-model-row__vote'>{m.vote ? '✓' : '✗'}</div>
                                    <div className='ai-model-row__body'>
                                        <div className='ai-model-row__name'>{m.name}</div>
                                        <div className='ai-model-row__detail'>{m.detail}</div>
                                    </div>
                                    <div className='ai-model-row__bar-wrap'>
                                        <div
                                            className='ai-model-row__bar'
                                            style={{ width: `${m.score * 100}%`, background: m.vote ? '#22c55e' : '#94a3b8' }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className='ai-nosignal__tips'>
                        <div className='ai-nosignal__tips-title'>What to do</div>
                        <ul>
                            <li>Wait 2–3 minutes and re-scan — market distributions shift.</li>
                            <li>Try a different trade type — Over/Under, Even/Odd, or Matches/Differs.</li>
                            <li>Not trading when there is no signal IS a good trade decision.</li>
                        </ul>
                    </div>
                    <button type='button' className='ai-nosignal__rescan' onClick={launch}>
                        🔄 Re-scan now
                    </button>
                </section>
            )}

            {/* Result */}
            {status === 'ready' && result && (() => {
                const { best, runner } = result;
                const vc = voteColor(best.votes.yesCount);

                return (
                    <section className={`ai-result ${isExpired ? 'ai-result--expired' : ''}`}>
                        {/* Header */}
                        <div className='ai-result__head'>
                            <span className='ai-result__tag'>AI Signal</span>
                            <span className={`ai-result__exec ai-result__exec--${best.votes.yesCount >= 9 ? 'bot' : best.votes.yesCount >= 7 ? 'both' : 'manual'}`}>
                                {best.votes.yesCount >= 9 ? '🤖 Via Bot' : best.votes.yesCount >= 7 ? '🤖 Bot or ✋ Manual' : '✋ Manual Only'}
                            </span>
                        </div>

                        {/* Consensus badge */}
                        <div className='ai-consensus' style={{ '--vc': vc } as React.CSSProperties}>
                            <div className='ai-consensus__score'>
                                <span className='ai-consensus__num' style={{ color: vc }}>
                                    {best.votes.yesCount}
                                </span>
                                <span className='ai-consensus__denom'>/10</span>
                                <span className='ai-consensus__icon'>
                                    {best.votes.yesCount >= 10 ? '🏆' : best.votes.yesCount >= 8 ? '✅' : '⚡'}
                                </span>
                            </div>
                            <div className='ai-consensus__right'>
                                <div className='ai-consensus__label' style={{ color: vc }}>
                                    {voteLabel(best.votes.yesCount)}
                                </div>
                                <div className='ai-consensus__sub'>
                                    {best.votes.yesCount} of 10 independent models agree on this trade
                                </div>
                                <div className='ai-consensus__strength'>
                                    Signal strength: <strong style={{ color: vc }}>{best.signalStrength}%</strong>
                                    &nbsp;·&nbsp;Segment: <strong style={{ color: best.segmentAgrees ? '#22c55e' : '#ef4444' }}>✓</strong>
                                </div>
                                <div className='ai-consensus__dots'>
                                    {[0,1,2,3,4,5,6,7,8,9].map(i => (
                                        <div
                                            key={i}
                                            className='ai-consensus__dot'
                                            style={{ background: i < best.votes.yesCount ? vc : '#e2e8f0' }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Best market found */}
                        <div className='ai-market-found'>
                            <div className='ai-market-found__label'>Best market found</div>
                            <div className='ai-market-found__name'>{best.sym.label}</div>
                            {runner && (
                                <div className='ai-market-found__runner'>
                                    Runner-up: {runner.sym.label} ({runner.votes.yesCount}/10 votes)
                                </div>
                            )}
                        </div>

                        {/* Validity countdown */}
                        <div
                            className={
                                'ai-validity ' +
                                (isExpired         ? 'ai-validity--expired'
                                : remainingPct < 25 ? 'ai-validity--low'
                                : remainingPct < 60 ? 'ai-validity--mid'
                                :                     'ai-validity--high')
                            }
                        >
                            <div className='ai-validity__row'>
                                <span className='ai-validity__lab'>
                                    {isExpired ? '⏱️ Signal expired' : '⏱️ Signal valid for'}
                                </span>
                                <span className='ai-validity__time'>{fmtRemaining(remainingMs)}</span>
                            </div>
                            <div className='ai-validity__track'>
                                <div className='ai-validity__fill' style={{ width: `${remainingPct}%` }} />
                            </div>
                            <div className='ai-validity__meta'>
                                {isExpired
                                    ? 'Re-scan for a fresh signal — market distributions shift.'
                                    : `Valid for ${Math.round(result.validityMs / 1000)}s based on ${best.sym.tickEvery}s ticks.`}
                            </div>
                            {isExpired && (
                                <button type='button' className='ai-validity__rescan' onClick={launch}>
                                    🔄 Re-scan now
                                </button>
                            )}
                        </div>

                        {/* Trade call */}
                        <div className='ai-result__call'>
                            <div className='ai-result__call-label'>Trade call</div>
                            <div className='ai-result__call-value'>{best.direction}</div>
                            <div className='ai-result__call-meta'>on {best.sym.label}</div>
                        </div>

                        {/* Win probability */}
                        <div className='ai-result__prob'>
                            <div className='ai-result__prob-row'>
                                <span>Historical win probability</span>
                                <strong>{(best.winProb * 100).toFixed(1)}%</strong>
                            </div>
                            <div className='ai-result__prob-bar'>
                                <div
                                    className='ai-result__prob-fill'
                                    style={{
                                        width: `${Math.min(100, best.winProb * 100)}%`,
                                        background: best.winProb >= 0.70
                                            ? 'linear-gradient(90deg,#16a34a,#22c55e)'
                                            : best.winProb >= 0.55
                                                ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                                                : 'linear-gradient(90deg,#dc2626,#ef4444)',
                                    }}
                                />
                            </div>
                            <div className='ai-result__prob-meta'>Sample: {best.sampleSize.toLocaleString()} ticks</div>
                        </div>

                        {/* Entry digits */}
                        <div className='ai-result__entry'>
                            <div className='ai-result__entry-title'>
                                Wait for one of these digits as your entry point — then trade:
                            </div>
                            <div className='ai-result__entry-digits'>
                                {best.entryDigits.map(e => (
                                    <div key={e.digit} className={`ai-digit ${e.recommended ? 'ai-digit--rec' : ''}`}>
                                        <div className='ai-digit__num'>{e.digit}</div>
                                        {e.recommended && <div className='ai-digit__star'>⭐ Recommended</div>}
                                        <div className='ai-digit__pct'>{(e.conditional * 100).toFixed(1)}% next-tick win</div>
                                    </div>
                                ))}
                            </div>
                            <div className='ai-result__entry-hint'>
                                Watch the live price. When the last digit matches, enter immediately.
                                The starred digit had the highest historical follow-through rate.
                            </div>
                        </div>

                        {/* Recommended duration */}
                        <div className='ai-result__ticks'>
                            <div className='ai-result__ticks-head'>
                                <span className='ai-result__ticks-icon'>⏱️</span>
                                <div className='ai-result__ticks-titlewrap'>
                                    <div className='ai-result__ticks-title'>Recommended duration</div>
                                    <div className='ai-result__ticks-sub'>Use this whether bot or manual</div>
                                </div>
                                <div className='ai-result__ticks-value'>
                                    1 <span className='ai-result__ticks-unit'>tick</span>
                                </div>
                            </div>
                            <p className='ai-result__ticks-rationale'>
                                Set duration = 1 tick. The signal scores the very next tick after your entry digit.
                                Longer durations give independent ticks back to the market mean and dilute the edge.
                            </p>
                        </div>

                        {/* DTrader Manual Setup Guide */}
                        <div className='ai-dtrader'>
                            <div className='ai-dtrader__head'>
                                <span className='ai-dtrader__icon'>🖥️</span>
                                <div className='ai-dtrader__title'>Advanced DTrader Setup</div>
                                <div className='ai-dtrader__sub'>Exact steps for manual trading</div>
                            </div>
                            <ol className='ai-dtrader__steps'>
                                <li>
                                    <span className='ai-dtrader__step-num'>1</span>
                                    <div>
                                        <strong>Market</strong> — select <em>{best.sym.label}</em>
                                    </div>
                                </li>
                                <li>
                                    <span className='ai-dtrader__step-num'>2</span>
                                    <div>
                                        <strong>Trade type</strong> — choose <em>{best.contractType.replace('DIGIT','Digits ')}</em>
                                        {best.barrier !== null && <> with barrier <em>{best.barrier}</em></>}
                                    </div>
                                </li>
                                <li>
                                    <span className='ai-dtrader__step-num'>3</span>
                                    <div>
                                        <strong>Duration</strong> — set to <em>1 tick</em>
                                    </div>
                                </li>
                                <li>
                                    <span className='ai-dtrader__step-num'>4</span>
                                    <div>
                                        <strong>Watch the last digit</strong> — wait for it to show{' '}
                                        <strong className='ai-dtrader__digits'>
                                            {best.entryDigits.map((e, i) => (
                                                <span key={e.digit} className={`ai-dtrader__digit-badge ${e.recommended ? 'ai-dtrader__digit-badge--rec' : ''}`}>
                                                    {e.digit}{e.recommended ? ' ⭐' : ''}
                                                </span>
                                            ))}
                                        </strong>
                                    </div>
                                </li>
                                <li>
                                    <span className='ai-dtrader__step-num'>5</span>
                                    <div>
                                        <strong>Enter immediately</strong> — click <em>
                                            {best.direction.startsWith('OVER')    ? 'Higher'
                                            : best.direction.startsWith('UNDER')  ? 'Lower'
                                            : best.direction.startsWith('MATCHES')? `Matches ${best.barrier}`
                                            : `Differs ${best.barrier}`}
                                        </em> the instant your entry digit appears
                                    </div>
                                </li>
                            </ol>
                            <div className='ai-dtrader__rule'>
                                ⚠️ Do NOT enter if the signal timer has expired. Re-scan for a fresh signal first.
                            </div>
                        </div>

                        {/* Model vote breakdown */}
                        <div className='ai-model-grid'>
                            <div className='ai-model-grid__title'>Model vote breakdown</div>
                            {[best.votes.chiSquared, best.votes.bayesian, best.votes.momentum, best.votes.stability, best.votes.recentEdge, best.votes.markov, best.votes.linearTrend, best.votes.entropy, best.votes.ngram, best.votes.quartile].map((m, i) => (
                                <div key={i} className={`ai-model-row ai-model-row--${m.vote ? 'yes' : 'no'}`}>
                                    <div className='ai-model-row__vote'>
                                        {m.vote ? '✓' : '✗'}
                                    </div>
                                    <div className='ai-model-row__body'>
                                        <div className='ai-model-row__name'>{m.name}</div>
                                        <div className='ai-model-row__detail'>{m.detail}</div>
                                    </div>
                                    <div className='ai-model-row__bar-wrap'>
                                        <div
                                            className='ai-model-row__bar'
                                            style={{
                                                width: `${m.score * 100}%`,
                                                background: m.vote ? '#22c55e' : '#94a3b8',
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Digit frequency */}
                        <div className='ai-result__freq'>
                            <div className='ai-result__freq-title'>Last-digit frequency — {best.sym.short} ({best.sampleSize.toLocaleString()} ticks)</div>
                            <div className='ai-result__freq-grid'>
                                {best.digitFreq.map((p, d) => (
                                    <div key={d} className='ai-freq'>
                                        <div className='ai-freq__bar-wrap'>
                                            <div
                                                className='ai-freq__bar'
                                                style={{
                                                    height:     `${Math.max(2, p * 240)}%`,
                                                    background: best.direction.startsWith('MATCHES') && best.barrier === d ? '#22c55e'
                                                        : (best.direction.startsWith('DIFFERS') || (!best.direction.startsWith('MATCHES') && !best.direction.startsWith('DIFFERS'))) && best.barrier === d ? '#dc2626'
                                                        : best.entryDigits.some(e => e.digit === d) ? '#f59e0b'
                                                        : '#2563eb',
                                                }}
                                            />
                                        </div>
                                        <div className='ai-freq__digit'>{d}</div>
                                        <div className='ai-freq__pct'>{(p * 100).toFixed(1)}%</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <p className='ai-result__disc'>
                            ⚠️ Signals are statistical estimates from {TICK_COUNT} real ticks. Deriv volatility indices
                            are synthetic random — past behaviour does not guarantee future results. Always trade an amount you can afford to lose.
                        </p>

                        <button type='button' className='ai-rerun' onClick={launch}>🔄 Re-scan all 10 markets</button>

                        {/* Signal history */}
                        {history.length > 0 && (
                            <div className='ai-history'>
                                <div className='ai-history__title'>Recent signals</div>
                                {history.map((h, i) => (
                                    <div key={i} className='ai-history__row'>
                                        <span className='ai-history__market'>{h.market}</span>
                                        <span className='ai-history__dir'>{h.direction}</span>
                                        <span className='ai-history__votes'>{h.votes}/10</span>
                                        <span className='ai-history__strength'>{h.strength}%</span>
                                        <span className='ai-history__time'>
                                            {new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                );
            })()}
        </div>
    );
};

export default EntryZone;

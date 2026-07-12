// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketType = 'over_under' | 'even_odd' | 'matches_differs';
export type VolatilityStatus = 'ALLOW' | 'BLOCK';

export interface Signal {
    id:             string;
    symbol:         string;
    symbolLabel:    string;
    market:         MarketType;
    direction:      string;
    modelsAgreeing: string[];
    confidence:     number;
    entryPoint:     string;
    createdAt:      number;
    expiresAt:      number;
    sampleSize:     number;   // ticks used for analysis (100)
    recentScore:    number;   // agreeing ticks in last 20
    recentTotal:    number;   // always 20
    recommendedTicks: number; // suggested contract duration in ticks (1–10)
    recommendedEngine: 'v1' | 'v2'; // suggested execution engine for this signal
}

export interface MLWeights { w: number[]; b: number; }
export const initialMLWeights = (): MLWeights => ({ w: [0, 0, 0, 0, 0], b: 0 });

interface Vote { model: string; market: MarketType; direction: string; confidence: number; }

// ─── Thresholds ───────────────────────────────────────────────────────────────
// 10-model consensus system — all markets require 6/10 models to agree.
// Confidence minimums per market type:
//   MATCHES : 6/10 models, ≥ 70 % avg conf.
//   DIFFERS : 6/10 models, ≥ 65 % avg conf.
//   EVEN/ODD: 6/10 models, ≥ 65 % avg conf.
//   OVR/UND : 6/10 models, ≥ 62 % avg conf  (only safe barriers used).
// Recency gate: last 20 ticks must also confirm direction.
// TTL: 60 s for 1HZ* (1-second) indices, 120 s for R_* (standard) indices.
function getThresholds(market: MarketType, prefix: string): { minAgree: number; minConf: number } {
    if (market === 'matches_differs') {
        if (prefix === 'MATCHES') return { minAgree: 6, minConf: 70 };
        return { minAgree: 6, minConf: 65 };
    }
    // Even/Odd uses reversal mode with only 4 models — require 3/4 (75 % consensus).
    if (market === 'even_odd') return { minAgree: 3, minConf: 65 };
    return { minAgree: 6, minConf: 62 };     // over_under
}
const EDGE_PCT     = 0.06;       // 6 pp above expected = model detection threshold
const RECENCY_EDGE = 0.06;       // lowered 0.10 → 0.06 — recency gate was killing valid signals
// Safe barrier sets — only barriers with ≥ 60 % expected baseline win rate.
//   OVER  1..3  → wins on 8/7/6 of 10 digits (80 / 70 / 60 % expected)
//   UNDER 6..8  → wins on 6/7/8 of 10 digits (60 / 70 / 80 % expected)
// Excludes risky barriers like OVER 5 (40 %) or UNDER 4 (40 %).
const SAFE_OVER_BARRIERS  = [3, 2, 1] as const;   // tightest first
const SAFE_UNDER_BARRIERS = [6, 7, 8] as const;   // tightest first

// ─── Math helpers ─────────────────────────────────────────────────────────────

const clamp   = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function barrierConf(observed: number, expected: number): number {
    return clamp((observed - expected) * 500);
}

function streakOf(digits: number[], pred: (d: number) => boolean): number {
    let n = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        if (pred(digits[i])) n++; else break;
    }
    return n;
}

// ─── Recency check ────────────────────────────────────────────────────────────
// Verifies the pattern is still active in the last 20 ticks.
// Returns score (agreeing count), total (20), and whether it passes the gate.

interface RecencyResult { score: number; total: number; passing: boolean; }

function checkRecency(digits: number[], direction: string, market: MarketType): RecencyResult {
    const last20 = digits.slice(-20);
    const n      = last20.length;
    if (n < 10) return { score: n, total: n, passing: true }; // too few — pass through

    let agreeing: number;
    let minRequired: number;

    if (market === 'over_under') {
        const b = Number(direction.split(' ')[1]);
        if (direction.startsWith('OVER')) {
            const expected = (9 - b) / 10;
            agreeing    = last20.filter(d => d > b).length;
            minRequired = Math.ceil(n * (expected + RECENCY_EDGE));
        } else {
            const expected = b / 10;
            agreeing    = last20.filter(d => d < b).length;
            minRequired = Math.ceil(n * (expected + RECENCY_EDGE));
        }
    } else if (market === 'even_odd') {
        agreeing    = direction === 'EVEN'
            ? last20.filter(d => d % 2 === 0).length
            : last20.filter(d => d % 2 !== 0).length;
        minRequired = Math.ceil(n * (0.50 + RECENCY_EDGE));
    } else {
        // matches_differs
        const dig = Number(direction.split(' ')[1]);
        if (direction.startsWith('MATCHES')) {
            agreeing    = last20.filter(d => d === dig).length;
            minRequired = 3; // 15%+ in 20 ticks (expected 10%)
        } else {
            agreeing    = last20.filter(d => d !== dig).length;
            // Tightened DIFFERS recency: require ≥88% non-target in last 20
            // (was 0.90 - RECENCY_EDGE = 84%) — the digit being avoided must
            // be genuinely cold, not just slightly below baseline.
            minRequired = Math.ceil(n * 0.88);
        }
    }

    return { score: agreeing, total: n, passing: agreeing >= minRequired };
}

// ─── Barrier helpers ──────────────────────────────────────────────────────────

interface BarrierHit { barrier: number; ratio: number; conf: number; }

// Confidence threshold used inside the barrier scanners themselves — kept low
// here because the FINAL gate (per-prefix MIN_CONF + multi-model consensus)
// is the real filter.  Was previously the global MIN_CONF constant.
const BARRIER_DETECT_CONF = 50;

function bestOverBarrier(d: number[]): BarrierHit | null {
    const n = d.length || 1;
    for (const b of SAFE_OVER_BARRIERS) {           // tightest first: 3 → 2 → 1
        const expected = (9 - b) / 10;
        const r        = d.filter(x => x > b).length / n;
        const conf     = barrierConf(r, expected);
        if (conf >= BARRIER_DETECT_CONF) return { barrier: b, ratio: r, conf };
    }
    return null;
}

function bestUnderBarrier(d: number[]): BarrierHit | null {
    const n = d.length || 1;
    for (const b of SAFE_UNDER_BARRIERS) {          // tightest first: 6 → 7 → 8
        const expected = b / 10;
        const r        = d.filter(x => x < b).length / n;
        const conf     = barrierConf(r, expected);
        if (conf >= BARRIER_DETECT_CONF) return { barrier: b, ratio: r, conf };
    }
    return null;
}

function bayesOverBarrier(d: number[]): BarrierHit | null {
    const n = d.length || 1;
    for (const b of SAFE_OVER_BARRIERS) {
        const expected = (9 - b) / 10;
        const PRIOR    = expected * 8;
        const rawCount = d.filter(x => x > b).length;
        const post     = (rawCount + PRIOR) / (n + 8);
        const conf     = barrierConf(post, expected);
        if (conf >= BARRIER_DETECT_CONF) return { barrier: b, ratio: post, conf };
    }
    return null;
}

function bayesUnderBarrier(d: number[]): BarrierHit | null {
    const n = d.length || 1;
    for (const b of SAFE_UNDER_BARRIERS) {
        const expected = b / 10;
        const PRIOR    = expected * 8;
        const rawCount = d.filter(x => x < b).length;
        const post     = (rawCount + PRIOR) / (n + 8);
        const conf     = barrierConf(post, expected);
        if (conf >= BARRIER_DETECT_CONF) return { barrier: b, ratio: post, conf };
    }
    return null;
}

// ─── Conditional Probability (Anchor Digit) ───────────────────────────────────
// For each anchor digit X (0..9), compute P(next digit ∈ winning_set | last digit = X)
// across the recent history. Returns the anchor with the highest probability,
// using the Wilson lower bound for a conservative estimate (penalises small samples).
//
// This integrates probability + statistical analysis into a single Markov-chain-
// style model used across every market.

interface AnchorResult { anchor: number | null; condProb: number; sampleSize: number; }

function findAnchorDigit(
    digits:    number[],
    isWin:     (next: number) => boolean,
    baseline:  number,
    minSample: number = 8,
): AnchorResult {
    if (digits.length < 60) return { anchor: null, condProb: baseline, sampleSize: 0 };
    const d       = digits.slice(-300);
    const buckets = Array.from({ length: 10 }, () => ({ wins: 0, total: 0 }));
    for (let i = 0; i < d.length - 1; i++) {
        const cur = d[i];
        const nxt = d[i + 1];
        buckets[cur].total++;
        if (isWin(nxt)) buckets[cur].wins++;
    }

    let bestAnchor: number | null = null;
    let bestLower                 = baseline;
    let bestSample                = 0;

    for (let a = 0; a < 10; a++) {
        const { wins, total } = buckets[a];
        if (total < minSample) continue;
        const p = wins / total;
        // Wilson lower bound (z = 1.0 ≈ 84 % one-sided confidence)
        const z      = 1.0;
        const denom  = 1 + (z * z) / total;
        const center = p + (z * z) / (2 * total);
        const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
        const lower  = (center - margin) / denom;
        if (lower > bestLower) {
            bestLower  = lower;
            bestAnchor = a;
            bestSample = total;
        }
    }
    return { anchor: bestAnchor, condProb: bestLower, sampleSize: bestSample };
}

function topDigitOf(digits: number[]): number {
    const c = Array(10).fill(0) as number[];
    digits.forEach(d => c[d]++);
    return c.indexOf(Math.max(...c));
}

function leastDigitOf(digits: number[]): number {
    const c = Array(10).fill(0) as number[];
    digits.forEach(d => c[d]++);
    return c.indexOf(Math.min(...c));
}

// ─── MODEL 1 — Statistical Frequency ─────────────────────────────────────────

function modelStatistical(digits: number[]): Vote[] {
    const d = digits.slice(-100);
    if (d.length < 30) return [];
    const votes: Vote[] = [];
    const n = d.length;

    const over = bestOverBarrier(d);
    if (over) votes.push({ model: 'Statistical', market: 'over_under',
        direction: `OVER ${over.barrier}`, confidence: over.conf });

    const under = bestUnderBarrier(d);
    if (under) votes.push({ model: 'Statistical', market: 'over_under',
        direction: `UNDER ${under.barrier}`, confidence: under.conf });

    const evenR = d.filter(x => x % 2 === 0).length / n;
    if (evenR > 0.50 + EDGE_PCT)
        votes.push({ model: 'Statistical', market: 'even_odd', direction: 'EVEN', confidence: barrierConf(evenR, 0.50) });
    else if (evenR < 0.50 - EDGE_PCT)
        votes.push({ model: 'Statistical', market: 'even_odd', direction: 'ODD',  confidence: barrierConf(1 - evenR, 0.50) });

    const cnt  = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    const maxR = Math.max(...cnt) / n;
    const minR = Math.min(...cnt) / n;
    if (maxR > 0.16) votes.push({ model: 'Statistical', market: 'matches_differs',
        direction: `MATCHES ${topDigitOf(d)}`,   confidence: clamp((maxR - 0.10) * 600) });
    if (minR < 0.06) votes.push({ model: 'Statistical', market: 'matches_differs',
        direction: `DIFFERS ${leastDigitOf(d)}`, confidence: clamp((0.10 - minR) * 600) });

    return votes;
}

// ─── MODEL 2 — Bayesian Probability ──────────────────────────────────────────

function modelBayesian(digits: number[]): Vote[] {
    const d = digits.slice(-100);
    if (d.length < 30) return [];
    const n = d.length;
    const votes: Vote[] = [];

    const over = bayesOverBarrier(d);
    if (over) votes.push({ model: 'Bayesian', market: 'over_under',
        direction: `OVER ${over.barrier}`, confidence: over.conf });

    const under = bayesUnderBarrier(d);
    if (under) votes.push({ model: 'Bayesian', market: 'over_under',
        direction: `UNDER ${under.barrier}`, confidence: under.conf });

    const PRIOR_EO = 4;
    const evenC    = d.filter(x => x % 2 === 0).length;
    const pEven    = (evenC + PRIOR_EO) / (n + 2 * PRIOR_EO);
    if (pEven > 0.50 + EDGE_PCT)
        votes.push({ model: 'Bayesian', market: 'even_odd', direction: 'EVEN', confidence: barrierConf(pEven, 0.50) });
    else if (pEven < 0.50 - EDGE_PCT)
        votes.push({ model: 'Bayesian', market: 'even_odd', direction: 'ODD',  confidence: barrierConf(1 - pEven, 0.50) });

    const DIGIT_PA = 1, DIGIT_PB = 9;
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    let maxPost = 0, maxDig = -1, minPost = 1, minDig = -1;
    for (let dig = 0; dig < 10; dig++) {
        const post = (cnt[dig] + DIGIT_PA) / (n + DIGIT_PA + DIGIT_PB);
        if (post > maxPost) { maxPost = post; maxDig = dig; }
        if (post < minPost) { minPost = post; minDig = dig; }
    }
    if (maxPost > 0.17 && maxDig >= 0)
        votes.push({ model: 'Bayesian', market: 'matches_differs',
            direction: `MATCHES ${maxDig}`, confidence: clamp((maxPost - 0.10) * 600) });
    if (minPost < 0.06 && minDig >= 0)
        votes.push({ model: 'Bayesian', market: 'matches_differs',
            direction: `DIFFERS ${minDig}`, confidence: clamp((0.10 - minPost) * 600) });

    return votes;
}

// ─── MODEL 3 — ML Classifier (Online Logistic Regression) ────────────────────

function featuresAt(digits: number[], endIdx: number): number[] {
    const w = digits.slice(Math.max(0, endIdx - 20), endIdx);
    if (w.length < 5) return [0.5, 0.5, 0.5, 0.5, 0.5];
    const highR = w.filter(d => d >= 5).length / w.length;
    const evenR = w.filter(d => d % 2 === 0).length / w.length;
    const strk  = Math.min(streakOf(w, d => (d >= 5) === (w[w.length - 1] >= 5)) / 10, 1);
    const mean  = w.reduce((a, b) => a + b, 0) / w.length;
    const vari  = Math.min(Math.sqrt(w.reduce((a, d) => a + (d - mean) ** 2, 0) / w.length) / 3, 1);
    const cntW  = Array(10).fill(0) as number[];
    w.forEach(d => cntW[d]++);
    const freqDev = Math.max(0, Math.max(...cntW) / w.length - 0.10);
    return [highR, evenR, strk, vari, freqDev];
}

export function trainMLWeights(digits: number[], wts: MLWeights): MLWeights {
    if (digits.length < 50) return wts;
    const lr = 0.02;
    const w  = [...wts.w];
    let b    = wts.b;
    const data = digits.slice(-300);
    for (let i = 20; i < data.length; i++) {
        const feat  = featuresAt(data, i);
        const label = data[i] >= 5 ? 1 : 0;
        const z     = feat.reduce((s, f, j) => s + w[j] * f, 0) + b;
        const err   = sigmoid(z) - label;
        feat.forEach((f, j) => { w[j] -= lr * err * f; });
        b -= lr * err;
    }
    return { w, b };
}

function modelML(digits: number[], wts: MLWeights): Vote[] {
    if (digits.length < 50) return [];
    const d100 = digits.slice(-100);
    const feat  = featuresAt(digits, digits.length);
    const z     = feat.reduce((s, f, j) => s + wts.w[j] * f, 0) + wts.b;
    const pHigh = sigmoid(z);
    const votes: Vote[] = [];

    if (pHigh > 0.50 + EDGE_PCT) {
        const over = bestOverBarrier(d100);
        if (over) votes.push({ model: 'ML Classifier', market: 'over_under',
            direction: `OVER ${over.barrier}`, confidence: clamp(pHigh * 100) });
    } else if (pHigh < 0.50 - EDGE_PCT) {
        const under = bestUnderBarrier(d100);
        if (under) votes.push({ model: 'ML Classifier', market: 'over_under',
            direction: `UNDER ${under.barrier}`, confidence: clamp((1 - pHigh) * 100) });
    }

    const pEven = feat[1];
    if (pEven > 0.50 + EDGE_PCT)
        votes.push({ model: 'ML Classifier', market: 'even_odd', direction: 'EVEN', confidence: clamp(pEven * 100) });
    else if (pEven < 0.50 - EDGE_PCT)
        votes.push({ model: 'ML Classifier', market: 'even_odd', direction: 'ODD',  confidence: clamp((1 - pEven) * 100) });

    const fDev = feat[4];
    if (fDev > 0.08) {
        const recent = digits.slice(-20);
        const cntR   = Array(10).fill(0) as number[];
        recent.forEach(d => cntR[d]++);
        const maxCnt = Math.max(...cntR);
        const topD   = cntR.indexOf(maxCnt);
        if (maxCnt / recent.length > 0.18)
            votes.push({ model: 'ML Classifier', market: 'matches_differs',
                direction: `MATCHES ${topD}`, confidence: clamp(maxCnt / recent.length * 350) });
    }

    // DIFFERS: if a digit appears rarely in last 100 ticks, vote to avoid it
    const cntD100 = Array(10).fill(0) as number[];
    d100.forEach(d => cntD100[d]++);
    const minCnt = Math.min(...cntD100);
    const minDig = cntD100.indexOf(minCnt);
    if (minCnt / d100.length < 0.07) {
        votes.push({ model: 'ML Classifier', market: 'matches_differs',
            direction: `DIFFERS ${minDig}`,
            confidence: clamp((0.10 - minCnt / d100.length) * 600) });
    }

    return votes;
}

// ─── MODEL 5 — Frequency Bias (wide-window distribution) ─────────────────────
// Uses a 200-tick window with a Z-score test to detect digits that are
// statistically over-represented (MATCHES) or under-represented (DIFFERS).
// Always picks the GLOBAL rarest/most-frequent digit so it converges with
// the other models on the same digit.

function modelFrequency(digits: number[]): Vote[] {
    if (digits.length < 80) return [];
    const d = digits.slice(-200);
    const n = d.length;
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);

    const expected = n / 10;
    const sigma    = Math.sqrt(n * 0.1 * 0.9); // binomial std dev

    let maxC = -1, maxD = 0;
    let minC = n + 1, minD = 0;
    for (let i = 0; i < 10; i++) {
        if (cnt[i] > maxC) { maxC = cnt[i]; maxD = i; }
        if (cnt[i] < minC) { minC = cnt[i]; minD = i; }
    }

    const votes: Vote[] = [];
    const maxZ = (maxC - expected) / sigma;
    const minZ = (expected - minC) / sigma;

    // ~1.5σ ≈ top/bottom ~7% of normal distribution — detectable bias
    if (maxZ > 1.5) {
        votes.push({ model: 'Frequency Bias', market: 'matches_differs',
            direction: `MATCHES ${maxD}`, confidence: clamp(60 + maxZ * 8) });
    }
    if (minZ > 1.5) {
        votes.push({ model: 'Frequency Bias', market: 'matches_differs',
            direction: `DIFFERS ${minD}`, confidence: clamp(60 + minZ * 8) });
    }

    // Also vote on Even/Odd if there's a strong wide-window parity bias
    const evenR = d.filter(x => x % 2 === 0).length / n;
    if (Math.abs(evenR - 0.5) > 0.07) {
        votes.push({ model: 'Frequency Bias', market: 'even_odd',
            direction: evenR > 0.5 ? 'EVEN' : 'ODD',
            confidence: barrierConf(Math.max(evenR, 1 - evenR), 0.50) });
    }

    return votes;
}

// ─── MODEL 6 — Conditional Probability (Anchor Digit / Markov) ───────────────
// Scans 1st-order conditional distributions to detect anchor digits whose
// FOLLOWING tick lands disproportionately on the prediction side. Voted across
// every market (Over/Under, Even/Odd, Matches/Differs). The anchor itself is
// surfaced in the entry instructions (see buildEntry below).

function modelConditional(digits: number[]): Vote[] {
    if (digits.length < 80) return [];
    const votes: Vote[] = [];

    // Over/Under — only safe barriers
    for (const b of SAFE_OVER_BARRIERS) {
        const baseline = (9 - b) / 10;
        const r = findAnchorDigit(digits, n => n > b, baseline);
        if (r.anchor !== null && r.condProb >= baseline + 0.08) {
            votes.push({ model: 'Conditional Probability', market: 'over_under',
                direction: `OVER ${b}`,
                confidence: clamp(50 + (r.condProb - baseline) * 350) });
        }
    }
    for (const b of SAFE_UNDER_BARRIERS) {
        const baseline = b / 10;
        const r = findAnchorDigit(digits, n => n < b, baseline);
        if (r.anchor !== null && r.condProb >= baseline + 0.08) {
            votes.push({ model: 'Conditional Probability', market: 'over_under',
                direction: `UNDER ${b}`,
                confidence: clamp(50 + (r.condProb - baseline) * 350) });
        }
    }

    // Even / Odd
    const rEven = findAnchorDigit(digits, n => n % 2 === 0, 0.5);
    if (rEven.anchor !== null && rEven.condProb >= 0.58) {
        votes.push({ model: 'Conditional Probability', market: 'even_odd',
            direction: 'EVEN', confidence: clamp(50 + (rEven.condProb - 0.5) * 350) });
    }
    const rOdd = findAnchorDigit(digits, n => n % 2 !== 0, 0.5);
    if (rOdd.anchor !== null && rOdd.condProb >= 0.58) {
        votes.push({ model: 'Conditional Probability', market: 'even_odd',
            direction: 'ODD', confidence: clamp(50 + (rOdd.condProb - 0.5) * 350) });
    }

    // Matches — for each candidate target digit X
    for (let x = 0; x < 10; x++) {
        const r = findAnchorDigit(digits, n => n === x, 0.10);
        if (r.anchor !== null && r.condProb >= 0.18) { // ≥ 1.8× baseline
            votes.push({ model: 'Conditional Probability', market: 'matches_differs',
                direction: `MATCHES ${x}`,
                confidence: clamp(50 + (r.condProb - 0.10) * 400) });
        }
    }

    // Differs — for each candidate avoid digit X
    for (let x = 0; x < 10; x++) {
        const r = findAnchorDigit(digits, n => n !== x, 0.90);
        if (r.anchor !== null && r.condProb >= 0.95) {
            votes.push({ model: 'Conditional Probability', market: 'matches_differs',
                direction: `DIFFERS ${x}`,
                confidence: clamp(50 + (r.condProb - 0.90) * 600) });
        }
    }

    return votes;
}

// ─── MODEL 6 — Markov Chain Order-2 ───────────────────────────────────────────
// Looks at the last TWO digits as a pair to predict the next digit's distribution.
// Catches longer-range dependencies that Order-1 (Conditional Probability) misses.
function modelMarkov2(digits: number[]): Vote[] {
    if (digits.length < 30) return [];
    const d     = digits.slice(-200);
    const votes: Vote[] = [];
    const table = new Map<string, number[]>();
    for (let i = 0; i < d.length - 2; i++) {
        const key = `${d[i]},${d[i + 1]}`;
        if (!table.has(key)) table.set(key, Array(10).fill(0) as number[]);
        table.get(key)![d[i + 2]]++;
    }
    const key  = `${d[d.length - 2]},${d[d.length - 1]}`;
    const dist = table.get(key);
    if (!dist) return [];
    const total = dist.reduce((s, c) => s + c, 0);
    if (total < 6) return [];

    for (const b of SAFE_OVER_BARRIERS) {
        const cnt = dist.slice(b + 1).reduce((s, c) => s + c, 0);
        const p = cnt / total; const exp = (9 - b) / 10;
        if (p > exp + EDGE_PCT) { votes.push({ model: 'Markov-2', market: 'over_under', direction: `OVER ${b}`, confidence: barrierConf(p, exp) }); break; }
    }
    for (const b of SAFE_UNDER_BARRIERS) {
        const cnt = dist.slice(0, b).reduce((s, c) => s + c, 0);
        const p = cnt / total; const exp = b / 10;
        if (p > exp + EDGE_PCT) { votes.push({ model: 'Markov-2', market: 'over_under', direction: `UNDER ${b}`, confidence: barrierConf(p, exp) }); break; }
    }
    const pEven = [0, 2, 4, 6, 8].reduce((s, i) => s + dist[i], 0) / total;
    if (pEven > 0.5 + EDGE_PCT) votes.push({ model: 'Markov-2', market: 'even_odd', direction: 'EVEN', confidence: barrierConf(pEven, 0.5) });
    else if ((1 - pEven) > 0.5 + EDGE_PCT) votes.push({ model: 'Markov-2', market: 'even_odd', direction: 'ODD', confidence: barrierConf(1 - pEven, 0.5) });
    const maxIdx = dist.indexOf(Math.max(...dist)); const maxProb = dist[maxIdx] / total;
    const minIdx = dist.indexOf(Math.min(...dist)); const minProb = dist[minIdx] / total;
    if (maxProb > 0.16) votes.push({ model: 'Markov-2', market: 'matches_differs', direction: `MATCHES ${maxIdx}`, confidence: clamp((maxProb - 0.10) * 500) });
    if (minProb < 0.06) votes.push({ model: 'Markov-2', market: 'matches_differs', direction: `DIFFERS ${minIdx}`, confidence: clamp((0.10 - minProb) * 500) });
    return votes;
}

// ─── MODEL 7 — Chi-Square Bias Test ───────────────────────────────────────────
// Rigorous statistical significance test — only votes when chi² ≥ 10.
function modelChiSquare(digits: number[]): Vote[] {
    if (digits.length < 50) return [];
    const d = digits.slice(-100); const n = d.length; const exp = n / 10;
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    const chi2 = cnt.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
    if (chi2 < 10) return [];
    const votes: Vote[] = [];

    for (const b of SAFE_OVER_BARRIERS) {
        const p = cnt.slice(b + 1).reduce((s, c) => s + c, 0) / n; const expP = (9 - b) / 10;
        if (p > expP + EDGE_PCT) { votes.push({ model: 'Chi-Square', market: 'over_under', direction: `OVER ${b}`, confidence: barrierConf(p, expP) }); break; }
    }
    for (const b of SAFE_UNDER_BARRIERS) {
        const p = cnt.slice(0, b).reduce((s, c) => s + c, 0) / n; const expP = b / 10;
        if (p > expP + EDGE_PCT) { votes.push({ model: 'Chi-Square', market: 'over_under', direction: `UNDER ${b}`, confidence: barrierConf(p, expP) }); break; }
    }
    const pEven = [0, 2, 4, 6, 8].reduce((s, i) => s + cnt[i], 0) / n;
    if (pEven > 0.5 + EDGE_PCT) votes.push({ model: 'Chi-Square', market: 'even_odd', direction: 'EVEN', confidence: barrierConf(pEven, 0.5) });
    else if ((1 - pEven) > 0.5 + EDGE_PCT) votes.push({ model: 'Chi-Square', market: 'even_odd', direction: 'ODD', confidence: barrierConf(1 - pEven, 0.5) });
    const maxIdx = cnt.indexOf(Math.max(...cnt)); const maxProb = cnt[maxIdx] / n;
    const minIdx = cnt.indexOf(Math.min(...cnt)); const minProb = cnt[minIdx] / n;
    if (maxProb > 0.16) votes.push({ model: 'Chi-Square', market: 'matches_differs', direction: `MATCHES ${maxIdx}`, confidence: clamp(((cnt[maxIdx] - exp) ** 2 / exp) * 5 + 50) });
    if (minProb < 0.06) votes.push({ model: 'Chi-Square', market: 'matches_differs', direction: `DIFFERS ${minIdx}`, confidence: clamp(((cnt[minIdx] - exp) ** 2 / exp) * 5 + 50) });
    return votes;
}

// ─── MODEL 8 — Momentum (Linear Regression) ───────────────────────────────────
// Fits a straight line through the last 30 digit values to detect trend.
// Positive slope → OVER, negative → UNDER. Parity clustering → same parity continues.
function modelMomentum(digits: number[]): Vote[] {
    if (digits.length < 20) return [];
    const d = digits.slice(-30); const n = d.length;
    const xMean = (n - 1) / 2;
    const yMean = d.reduce((s, v) => s + v, 0) / n;
    let num = 0; let den = 0;
    for (let i = 0; i < n; i++) { num += (i - xMean) * (d[i] - yMean); den += (i - xMean) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    const votes: Vote[] = [];

    if (slope > 0.15) {
        const over = bestOverBarrier(digits.slice(-100));
        if (over) votes.push({ model: 'Momentum', market: 'over_under', direction: `OVER ${over.barrier}`, confidence: clamp(50 + slope * 100) });
    }
    if (slope < -0.15) {
        const under = bestUnderBarrier(digits.slice(-100));
        if (under) votes.push({ model: 'Momentum', market: 'over_under', direction: `UNDER ${under.barrier}`, confidence: clamp(50 + Math.abs(slope) * 100) });
    }
    let altCount = 0;
    for (let i = 1; i < d.length; i++) { if ((d[i] % 2) !== (d[i - 1] % 2)) altCount++; }
    const altRate = altCount / (d.length - 1);
    if (altRate < 0.38) {
        const dir = d[d.length - 1] % 2 === 0 ? 'EVEN' : 'ODD';
        votes.push({ model: 'Momentum', market: 'even_odd', direction: dir, confidence: clamp((0.5 - altRate) * 300 + 50) });
    }
    return votes;
}

// ─── MODEL 9 — Shannon Entropy Guard ──────────────────────────────────────────
// Measures information entropy of the digit stream.
// Abstains when entropy > 92% of max (truly random). Otherwise votes proportional
// to how predictable the distribution is.
function modelEntropy(digits: number[]): Vote[] {
    if (digits.length < 50) return [];
    const d = digits.slice(-100); const n = d.length;
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    let H = 0;
    for (const c of cnt) { if (c === 0) continue; const p = c / n; H -= p * Math.log2(p); }
    if (H / Math.log2(10) > 0.92) return [];
    const conf = clamp((1 - H / Math.log2(10)) * 150);
    const votes: Vote[] = [];

    const highCnt = cnt.slice(5).reduce((s, c) => s + c, 0);
    if (highCnt / n > 0.5 + EDGE_PCT) {
        const over = bestOverBarrier(d);
        if (over) votes.push({ model: 'Entropy', market: 'over_under', direction: `OVER ${over.barrier}`, confidence: clamp(conf * over.conf / 100) });
    } else if ((n - highCnt) / n > 0.5 + EDGE_PCT) {
        const under = bestUnderBarrier(d);
        if (under) votes.push({ model: 'Entropy', market: 'over_under', direction: `UNDER ${under.barrier}`, confidence: clamp(conf * under.conf / 100) });
    }
    const pEven = [0, 2, 4, 6, 8].reduce((s, i) => s + cnt[i], 0) / n;
    if (pEven > 0.5 + EDGE_PCT) votes.push({ model: 'Entropy', market: 'even_odd', direction: 'EVEN', confidence: clamp(conf + barrierConf(pEven, 0.5)) });
    else if ((1 - pEven) > 0.5 + EDGE_PCT) votes.push({ model: 'Entropy', market: 'even_odd', direction: 'ODD', confidence: clamp(conf + barrierConf(1 - pEven, 0.5)) });
    const maxIdx = cnt.indexOf(Math.max(...cnt)); const maxProb = cnt[maxIdx] / n;
    const minIdx = cnt.indexOf(Math.min(...cnt)); const minProb = cnt[minIdx] / n;
    if (maxProb > 0.16) votes.push({ model: 'Entropy', market: 'matches_differs', direction: `MATCHES ${maxIdx}`, confidence: clamp(conf + (maxProb - 0.10) * 500) });
    if (minProb < 0.06) votes.push({ model: 'Entropy', market: 'matches_differs', direction: `DIFFERS ${minIdx}`, confidence: clamp(conf + (0.10 - minProb) * 500) });
    return votes;
}

// ─── MODEL 10 — N-Gram Pattern Memory ─────────────────────────────────────────
// Maintains a lookup table of the last 4-digit sequences and their historical
// next-digit outcomes. Predicts based on what followed matching sequences.
function modelNGram(digits: number[]): Vote[] {
    if (digits.length < 40) return [];
    const d = digits.slice(-200); const NGRAM = 4;
    if (d.length < NGRAM + 5) return [];
    const table = new Map<string, number[]>();
    for (let i = 0; i <= d.length - NGRAM - 1; i++) {
        const key = d.slice(i, i + NGRAM).join(',');
        if (!table.has(key)) table.set(key, Array(10).fill(0) as number[]);
        table.get(key)![d[i + NGRAM]]++;
    }
    const dist = table.get(d.slice(-NGRAM).join(','));
    if (!dist) return [];
    const total = dist.reduce((s, c) => s + c, 0);
    if (total < 4) return [];
    const votes: Vote[] = [];

    for (const b of SAFE_OVER_BARRIERS) {
        const p = dist.slice(b + 1).reduce((s, c) => s + c, 0) / total; const exp = (9 - b) / 10;
        if (p > exp + EDGE_PCT) { votes.push({ model: 'N-Gram', market: 'over_under', direction: `OVER ${b}`, confidence: barrierConf(p, exp) }); break; }
    }
    for (const b of SAFE_UNDER_BARRIERS) {
        const p = dist.slice(0, b).reduce((s, c) => s + c, 0) / total; const exp = b / 10;
        if (p > exp + EDGE_PCT) { votes.push({ model: 'N-Gram', market: 'over_under', direction: `UNDER ${b}`, confidence: barrierConf(p, exp) }); break; }
    }
    const pEven = [0, 2, 4, 6, 8].reduce((s, i) => s + dist[i], 0) / total;
    if (pEven > 0.5 + EDGE_PCT) votes.push({ model: 'N-Gram', market: 'even_odd', direction: 'EVEN', confidence: barrierConf(pEven, 0.5) });
    else if ((1 - pEven) > 0.5 + EDGE_PCT) votes.push({ model: 'N-Gram', market: 'even_odd', direction: 'ODD', confidence: barrierConf(1 - pEven, 0.5) });
    const maxIdx = dist.indexOf(Math.max(...dist)); const maxProb = dist[maxIdx] / total;
    const minIdx = dist.indexOf(Math.min(...dist)); const minProb = dist[minIdx] / total;
    if (maxProb > 0.16) votes.push({ model: 'N-Gram', market: 'matches_differs', direction: `MATCHES ${maxIdx}`, confidence: clamp((maxProb - 0.10) * 500) });
    if (minProb < 0.06) votes.push({ model: 'N-Gram', market: 'matches_differs', direction: `DIFFERS ${minIdx}`, confidence: clamp((0.10 - minProb) * 500) });
    return votes;
}

// ─── MODEL 5 — Volatility Filter ─────────────────────────────────────────────

export interface VolatilityResult { status: VolatilityStatus; reason: string; }

export function modelVolatility(digits: number[], tickTimes: number[]): VolatilityResult {
    if (digits.length < 25) return { status: 'BLOCK', reason: 'Collecting data…' };

    const d   = digits.slice(-100);
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    const exp  = d.length / 10;
    const chi2 = cnt.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
    if (chi2 > 50) return { status: 'BLOCK', reason: 'Severely skewed distribution' };

    const last   = digits[digits.length - 1];
    const hlStrk = streakOf(digits.slice(-30), x => (x >= 5) === (last >= 5));
    if (hlStrk >= 8) return { status: 'BLOCK', reason: `Extreme streak: ${hlStrk}` };

    if (tickTimes.length >= 5) {
        const recent = tickTimes.slice(-5);
        const gaps   = recent.slice(1).map((t, i) => t - recent[i]);
        if (Math.max(...gaps) > 8000) return { status: 'BLOCK', reason: 'Irregular tick intervals' };
    }

    return { status: 'ALLOW', reason: 'Market stable' };
}

// ─── Consensus Engine ─────────────────────────────────────────────────────────

const MARKETS: MarketType[] = ['over_under', 'even_odd', 'matches_differs'];

function buildConsensus(votes: Vote[], volStatus: VolatilityStatus) {
    if (volStatus === 'BLOCK') return [];
    const results: Array<{ market: MarketType; direction: string; models: string[]; confidence: number }> = [];

    for (const market of MARKETS) {
        const mv = votes.filter(v => v.market === market);

        if (market === 'over_under') {
            for (const prefix of ['OVER', 'UNDER'] as const) {
                const { minAgree, minConf } = getThresholds(market, prefix);
                const group = mv.filter(v => v.direction.startsWith(prefix));
                if (group.length < minAgree) continue;
                const dirCounts = new Map<string, Vote[]>();
                group.forEach(v => {
                    const arr = dirCounts.get(v.direction) ?? [];
                    arr.push(v);
                    dirCounts.set(v.direction, arr);
                });
                let best: Vote[] = []; let bestDir = '';
                dirCounts.forEach((vs, dir) => {
                    if (vs.length > best.length || (vs.length === best.length && dir > bestDir)) {
                        best = vs; bestDir = dir;
                    }
                });
                if (best.length < minAgree) {
                    best    = group;
                    bestDir = [...dirCounts.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? group[0].direction;
                }
                const avgConf = group.reduce((s, v) => s + v.confidence, 0) / group.length;
                if (avgConf < minConf) continue;
                results.push({ market, direction: bestDir, models: group.map(v => v.model), confidence: Math.round(avgConf) });
            }
            continue;
        }

        if (market === 'matches_differs') {
            // Split into MATCHES vs DIFFERS prefixes (just like OVER/UNDER), then
            // within each prefix find the digit most models converged on. This
            // lets DIFFERS actually fire even when models pick slightly different
            // rare digits, by counting per-digit consensus inside the prefix.
            for (const prefix of ['MATCHES', 'DIFFERS'] as const) {
                const { minAgree, minConf } = getThresholds(market, prefix);
                const group = mv.filter(v => v.direction.startsWith(prefix));
                if (group.length < minAgree) continue;
                const digCounts = new Map<string, Vote[]>();
                group.forEach(v => {
                    const arr = digCounts.get(v.direction) ?? [];
                    arr.push(v);
                    digCounts.set(v.direction, arr);
                });
                let best: Vote[] = []; let bestDir = '';
                digCounts.forEach((vs, dir) => {
                    if (vs.length > best.length) { best = vs; bestDir = dir; }
                });
                // For matches_differs, the overall prefix must have minAgree votes,
                // but the specific digit only needs a plurality (≥35% of prefix voters).
                // This allows signals to fire when models agree on MATCHES/DIFFERS
                // direction but split slightly on which exact digit.
                const digitMinAgree = Math.max(3, Math.ceil(group.length * 0.35));
                if (best.length < digitMinAgree) continue;
                const avgConf = best.reduce((s, v) => s + v.confidence, 0) / best.length;
                if (avgConf < minConf) continue;
                results.push({ market, direction: bestDir, models: best.map(v => v.model), confidence: Math.round(avgConf) });
            }
            continue;
        }

        // even_odd — single-prefix path
        const { minAgree, minConf } = getThresholds(market, 'EVEN');
        const groups = new Map<string, Vote[]>();
        mv.forEach(v => { const g = groups.get(v.direction) ?? []; g.push(v); groups.set(v.direction, g); });
        let best: Vote[] = []; let bestDir = '';
        groups.forEach((vs, dir) => { if (vs.length > best.length) { best = vs; bestDir = dir; } });
        if (best.length < minAgree) continue;
        const avgConf = best.reduce((s, v) => s + v.confidence, 0) / best.length;
        if (avgConf < minConf) continue;
        results.push({ market, direction: bestDir, models: best.map(v => v.model), confidence: Math.round(avgConf) });
    }
    return results;
}

// ─── Entry Point builder ──────────────────────────────────────────────────────

function buildEntry(market: MarketType, direction: string, digits: number[]): string {
    // Try to find the anchor digit with the highest conditional win probability.
    // The first integer in the returned string is consumed by parseDigitFrom() in
    // the V2 engine as the entry-trigger digit, so the anchor MUST appear first.
    if (market === 'over_under') {
        const b        = Number(direction.split(' ')[1]);
        const baseline = direction.startsWith('OVER') ? (9 - b) / 10 : b / 10;
        const isWin    = direction.startsWith('OVER')
            ? (n: number) => n > b
            : (n: number) => n < b;
        const r        = findAnchorDigit(digits, isWin, baseline);
        const winSide  = direction.startsWith('OVER')
            ? `${b + 1}–9 (${9 - b} digits)`
            : `0–${b - 1} (${b} digits)`;
        if (r.anchor !== null) {
            return `Wait digit ${r.anchor} → P(win | ${r.anchor}) ≈ ${(r.condProb * 100).toFixed(0)}%  ·  wins on ${winSide}`;
        }
        return direction.startsWith('OVER')
            ? `Last digit > ${b}  (wins on ${b + 1}–9,  ${9 - b} digits)`
            : `Last digit < ${b}  (wins on 0–${b - 1},  ${b} digits)`;
    }

    if (market === 'even_odd') {
        const isEven    = direction === 'EVEN';
        const winDigits = isEven ? '0 2 4 6 8' : '1 3 5 7 9';
        const isWin     = isEven ? (n: number) => n % 2 === 0 : (n: number) => n % 2 !== 0;
        const r         = findAnchorDigit(digits, isWin, 0.5);
        if (r.anchor !== null) {
            return `Wait digit ${r.anchor} → wins on: ${winDigits}`;
        }
        // fallback: most-frequent digit of the target parity in last 100 ticks
        const d100       = digits.slice(-100);
        const parityDigs = isEven ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9];
        const cnt        = Array(10).fill(0) as number[];
        d100.forEach(d => cnt[d]++);
        const entryDig   = parityDigs.reduce((best, d) => cnt[d] > cnt[best] ? d : best, parityDigs[0]);
        return `Entry digit: ${entryDig} · wins on: ${winDigits}`;
    }

    // matches_differs — anchor still helps trigger the trade after the right precursor
    const targetDigit = Number(direction.split(' ')[1]);
    if (direction.startsWith('MATCHES')) {
        const r = findAnchorDigit(digits, n => n === targetDigit, 0.10);
        if (r.anchor !== null) {
            return `Wait digit ${r.anchor} → P(next = ${targetDigit} | ${r.anchor}) ≈ ${(r.condProb * 100).toFixed(0)}%`;
        }
        return `Entry digit: ${targetDigit}`;
    }
    // DIFFERS
    const r = findAnchorDigit(digits, n => n !== targetDigit, 0.90);
    if (r.anchor !== null) {
        return `Wait digit ${r.anchor} → P(next ≠ ${targetDigit} | ${r.anchor}) ≈ ${(r.condProb * 100).toFixed(0)}%  ·  avoid ${targetDigit}`;
    }
    return `Avoid digit ${targetDigit}  (any other digit wins)`;
}

// ─── Model: Regime Change Detector ───────────────────────────────────────────
// Compares the digit distribution in the OLDER half of the tick buffer versus
// the NEWER half using a chi-square test (df = 9, threshold ≈ p < 0.02).
// A significant shift means Deriv may have updated their RNG parameters or the
// market has entered a new statistical regime.
//
// When regime is STABLE  → casts confirming votes for all markets where BOTH
//                           halves independently agree on the same direction.
// When regime CHANGED    → returns empty (no confirming votes), which raises
//                           the bar for consensus and suppresses stale signals.
//
// The exported checkRegimeChange() lets the UI show a real-time alert banner.
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeStatus {
    changed:  boolean;
    chiSq:    number;
    summary:  string;
}

export function checkRegimeChange(digits: number[]): RegimeStatus {
    const N = digits.length;
    if (N < 200) return { changed: false, chiSq: 0, summary: 'Not enough ticks to assess regime (need ≥200)' };

    const half    = Math.floor(N / 2);
    const older   = digits.slice(0, half);
    const newer   = digits.slice(half);
    const freqOld = new Array(10).fill(0) as number[];
    const freqNew = new Array(10).fill(0) as number[];
    for (const d of older) freqOld[d]++;
    for (const d of newer) freqNew[d]++;

    // Chi-square distance: newer vs scaled-older
    const scale = newer.length / older.length;
    let chiSq   = 0;
    for (let d = 0; d < 10; d++) {
        const exp = freqOld[d] * scale;
        if (exp > 0) chiSq += (freqNew[d] - exp) ** 2 / exp;
    }

    // df=9 critical: χ²>16.92 = p<0.05  χ²>21.67 = p<0.01
    const THRESHOLD = 19.0;  // between 0.05 and 0.01 — sensitive but not noisy
    const changed   = chiSq > THRESHOLD;

    return {
        changed,
        chiSq: Math.round(chiSq * 10) / 10,
        summary: changed
            ? `⚠️ Regime shift detected (χ²=${chiSq.toFixed(1)} > ${THRESHOLD}). ` +
              `Digit distribution has changed between the older and newer ticks. ` +
              `All models are being recalibrated against the new pattern. ` +
              `Wait for at least 100 fresh ticks before trading.`
            : `Market stable (χ²=${chiSq.toFixed(1)} < ${THRESHOLD}) — digit distribution consistent across both halves of the tick buffer.`,
    };
}

function modelRegimeVotes(digits: number[]): Vote[] {
    const regime = checkRegimeChange(digits);
    if (regime.changed) return []; // Suppress: stale pattern in old data

    const N    = digits.length;
    const half = Math.floor(N / 2);
    const old  = digits.slice(0, half);
    const nw   = digits.slice(half);
    const votes: Vote[] = [];

    // over_under: direction must hold in BOTH halves
    for (const prefix of ['OVER', 'UNDER'] as const) {
        const barriers = prefix === 'OVER' ? SAFE_OVER_BARRIERS : SAFE_UNDER_BARRIERS;
        for (const b of barriers) {
            const pOld = prefix === 'OVER'
                ? old.filter(d => d > b).length / old.length
                : old.filter(d => d < b).length / old.length;
            const pNew = prefix === 'OVER'
                ? nw.filter(d => d > b).length / nw.length
                : nw.filter(d => d < b).length / nw.length;
            const exp  = prefix === 'OVER' ? (9 - b) / 10 : b / 10;
            if (pOld > exp + EDGE_PCT && pNew > exp + EDGE_PCT) {
                votes.push({ model: 'RegimeDetect', market: 'over_under',
                    direction: `${prefix} ${b}`,
                    confidence: Math.round(Math.min(pOld, pNew) * 100) });
                break;
            }
        }
    }

    // even_odd: parity bias must hold in both halves
    const pEOld = old.filter(d => d % 2 === 0).length / old.length;
    const pENew = nw.filter(d => d % 2 === 0).length  / nw.length;
    if (pEOld > 0.5 + EDGE_PCT && pENew > 0.5 + EDGE_PCT)
        votes.push({ model: 'RegimeDetect', market: 'even_odd', direction: 'EVEN',
            confidence: Math.round(Math.min(pEOld, pENew) * 100) });
    else if (pEOld < 0.5 - EDGE_PCT && pENew < 0.5 - EDGE_PCT)
        votes.push({ model: 'RegimeDetect', market: 'even_odd', direction: 'ODD',
            confidence: Math.round((1 - Math.max(pEOld, pENew)) * 100) });

    // matches_differs: same hot/cold digit in both halves
    const fOld = new Array(10).fill(0) as number[];
    const fNew = new Array(10).fill(0) as number[];
    for (const d of old) fOld[d]++; for (const d of nw) fNew[d]++;
    const fpOld = fOld.map(f => f / old.length);
    const fpNew = fNew.map(f => f / nw.length);
    for (let d = 0; d < 10; d++) {
        if (fpOld[d] > 0.12 && fpNew[d] > 0.12) {
            votes.push({ model: 'RegimeDetect', market: 'matches_differs',
                direction: `MATCHES ${d}`,
                confidence: Math.round(Math.min(fpOld[d], fpNew[d]) * 100) });
            break;
        }
    }
    for (let d = 0; d < 10; d++) {
        if (fpOld[d] < 0.06 && fpNew[d] < 0.06) {
            votes.push({ model: 'RegimeDetect', market: 'matches_differs',
                direction: `DIFFERS ${d}`,
                confidence: Math.round((1 - Math.max(fpOld[d], fpNew[d])) * 100) });
            break;
        }
    }

    return votes;
}

// ─── Even/Odd reversal entry ──────────────────────────────────────────────────
// dominantDir = the side that has been appearing MORE (e.g. 'EVEN').
// We wait for a digit from that dominant side to appear, then buy the OPPOSITE.
// Entry digit = the most frequent dominant-side digit in the last 50 ticks.
function buildEvenOddReversalEntry(dominantDir: string, digits: number[]): string {
    const isEvenDom    = dominantDir === 'EVEN';
    const domDigits    = isEvenDom ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9];
    const winDigits    = isEvenDom ? '1 3 5 7 9' : '0 2 4 6 8';
    const d50          = digits.slice(-50);
    const cnt          = Array(10).fill(0) as number[];
    d50.forEach(d => cnt[d]++);
    const entryDig     = domDigits.reduce((best, d) => cnt[d] > cnt[best] ? d : best, domDigits[0]);
    return `Wait digit ${entryDig} → wins on: ${winDigits}`;
}

// ─── Multi-window Even/Odd convergence gate ───────────────────────────────────
// For Even/Odd we require the SAME direction to dominate across every available
// window in [20, 50, 100, 500, 1000] ticks.  A single window dissenting means
// the pattern is not reliable enough — suppress the signal.
// Returns 'EVEN', 'ODD', or null (no consensus).
function multiWindowEvenOddGate(digits: number[]): 'EVEN' | 'ODD' | null {
    const windows = [20, 50, 100, 500, 1000] as const;
    let agreed: 'EVEN' | 'ODD' | null = null;
    for (const w of windows) {
        const slice = digits.slice(-w);
        if (slice.length < 15) continue;   // not enough data for this window — skip
        const evenR = slice.filter(d => d % 2 === 0).length / slice.length;
        const dir: 'EVEN' | 'ODD' = evenR > 0.5 ? 'EVEN' : 'ODD';
        if (agreed === null) {
            agreed = dir;
        } else if (agreed !== dir) {
            return null;   // windows disagree — no convergence
        }
    }
    return agreed;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyzeSignals(
    digits:        number[],
    tickTimes:     number[],
    symbol:        string,
    symbolLabel:   string,
    weights:       MLWeights,
    activeMarkets: Set<MarketType>,
): Signal[] {
    if (digits.length < 50) return [];

    const allVotes: Vote[] = [
        ...modelStatistical(digits),
        ...modelBayesian(digits),
        ...modelML(digits, weights),
        ...modelRegimeVotes(digits),
        ...modelFrequency(digits),
        ...modelConditional(digits),
        ...modelMarkov2(digits),
        ...modelChiSquare(digits),
        ...modelMomentum(digits),
        ...modelEntropy(digits),
        ...modelNGram(digits),
    ];

    // Even/Odd reversal uses only 4 core models — strip Even/Odd votes from
    // the other 7 to keep the consensus clean and avoid false agreement.
    const EO_ALLOWED = new Set(['Statistical', 'Bayesian', 'Momentum', 'RegimeDetect']);
    const filteredVotes = allVotes.filter(v =>
        v.market !== 'even_odd' || EO_ALLOWED.has(v.model)
    );

    const { status: volStatus } = modelVolatility(digits, tickTimes);
    const agreed                = buildConsensus(filteredVotes, volStatus);

    // Split TTL: 60 s for 1-second indices (1HZ*), 120 s for standard (R_*)
    const ttl = symbol.startsWith('1HZ') ? 60_000 : 120_000;
    const now = Date.now();

    // Multi-window convergence gate for Even/Odd: run once, reuse per signal.
    const eoGate = multiWindowEvenOddGate(digits);

    return agreed
        .filter(r => !activeMarkets.has(r.market))
        .map(r => {
            if (r.market === 'even_odd') {
                // r.direction = DOMINANT side (what the 4 models detected as over-represented).
                // Multi-window gate: all windows must confirm this dominance.
                if (eoGate !== r.direction) return null;

                // Recency: confirm the dominant bias is still active in last 20 ticks
                // (we need it to still be happening so there's something to fade).
                const rec = checkRecency(digits, r.direction, 'even_odd');
                if (!rec.passing) return null;

                // Reversal: bet the OPPOSITE of what's been dominant.
                const signalDir = r.direction === 'EVEN' ? 'ODD' : 'EVEN';

                return {
                    id:               `sig_${now}_${symbol}_${r.market}`,
                    symbol,
                    symbolLabel,
                    market:           r.market,
                    direction:        signalDir,
                    modelsAgreeing:   r.models,
                    confidence:       r.confidence,
                    entryPoint:       buildEvenOddReversalEntry(r.direction, digits),
                    createdAt:        now,
                    expiresAt:        now + ttl,
                    sampleSize:       Math.min(digits.length, 1000),
                    recentScore:      rec.score,
                    recentTotal:      rec.total,
                    recommendedTicks: 1,
                    recommendedEngine: recommendEngine(r.market, r.confidence, symbol),
                };
            }

            const rec = checkRecency(digits, r.direction, r.market);
            if (!rec.passing) return null;
            return {
                id:             `sig_${now}_${symbol}_${r.market}`,
                symbol,
                symbolLabel,
                market:         r.market,
                direction:      r.direction,
                modelsAgreeing: r.models,
                confidence:     r.confidence,
                entryPoint:     buildEntry(r.market, r.direction, digits),
                createdAt:      now,
                expiresAt:      now + ttl,
                sampleSize:     Math.min(digits.length, 100),
                recentScore:    rec.score,
                recentTotal:    rec.total,
                recommendedTicks:  recommendTicks(r.market, r.direction),
                recommendedEngine: recommendEngine(r.market, r.confidence, symbol),
            };
        })
        .filter((s): s is Signal => s !== null);
}

// ─── Recommended execution engine per signal ──────────────────────────────────
// V2 (Advanced) buys on every tick after the entry digit — best for fast,
// high-confidence signals and digit-strict markets where speed matters.
// V1 (Bot Builder) loads the prebuilt Blockly XML bot — better for slower,
// barrier-based markets where the proven XML logic outperforms.
//
// Rules:
//   • matches_differs  → V2 (per-tick firing fits digit-strict trades)
//   • 1-second indices with confidence ≥ 70 → V2 (speed advantage matters)
//   • Everything else  → V1 (conservative, tested XML path)
function recommendEngine(market: MarketType, confidence: number, symbol: string): 'v1' | 'v2' {
    if (market === 'matches_differs') return 'v2';
    if (symbol.startsWith('1HZ') && confidence >= 70) return 'v2';
    return 'v1';
}

// ─── Recommended tick duration per signal ─────────────────────────────────────
// MATCHES / DIFFERS / EVEN / ODD: 1 tick — single-shot resolution is cleanest.
// OVER / UNDER: scales with barrier safety. Wider safe margin = more room
// for a longer hold. (1-tick contracts are always safe; this is just the
// pre-fill the user can override 1–10.)
function recommendTicks(market: MarketType, direction: string): number {
    if (market === 'matches_differs' || market === 'even_odd') return 1;
    // over_under
    const b = Number(direction.split(' ')[1]);
    if (direction.startsWith('OVER')) {
        if (b === 1) return 3;       // wins on 8 digits
        if (b === 2) return 2;       // wins on 7 digits
        return 1;                    // OVER 3 — wins on 6 digits
    }
    // UNDER
    if (b === 8) return 3;           // wins on 8 digits
    if (b === 7) return 2;           // wins on 7 digits
    return 1;                        // UNDER 6 — wins on 6 digits
}

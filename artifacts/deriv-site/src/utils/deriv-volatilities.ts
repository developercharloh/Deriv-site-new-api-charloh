/* ─────────────────────────────────────────────────────────────────────────
   Deriv Volatility Indices — single source of truth
   ──────────────────────────────────────────────────────────────────────────
   This is THE canonical list of Deriv's synthetic volatility symbols used
   everywhere a user picks a market: AI Analysis Tool, DTrader, Speed Bots
   (Dollar Flow / Tri / Apollo), Signal Engine, etc.

   Two families:
     • Continuous (1-second tick) indices — 1HZxV codes (16 symbols)
     • Standard (2-second tick) indices    — R_x codes  (5 symbols)

   When Deriv adds new volatility indices, add them here ONLY and every
   picker across the app updates automatically.
───────────────────────────────────────────────────────────────────────── */

export interface DerivVolatility {
    /** API symbol code, e.g. "1HZ100V" or "R_100" */
    code:      string;
    /** Full human label, e.g. "Volatility 100 (1s) Index" */
    label:     string;
    /** Compact label for UI badges, e.g. "V100s" or "V100" */
    short:     string;
    /** Tick cadence in seconds (1 = continuous, 2 = standard) */
    tickEvery: 1 | 2;
}

const cont = (n: number): DerivVolatility => ({
    code:      `1HZ${n}V`,
    label:     `Volatility ${n} (1s) Index`,
    short:     `V${n}s`,
    tickEvery: 1,
});
const std = (n: number): DerivVolatility => ({
    code:      `R_${n}`,
    label:     `Volatility ${n} Index`,
    short:     `V${n}`,
    tickEvery: 2,
});

/** Continuous (1-second) volatility indices — verified working on DBot/DTrader.
 *  Only 5 exist on the live Deriv platform (10, 25, 50, 75, 100). */
export const DERIV_CONTINUOUS_VOLATILITIES: DerivVolatility[] = [
    cont(10), cont(25), cont(50), cont(75), cont(100),
];

/** Standard (2-second) volatility indices — full Deriv lineup. */
export const DERIV_STANDARD_VOLATILITIES: DerivVolatility[] = [
    std(10), std(25), std(50), std(75), std(100),
];

/** Combined flat list — continuous first (most popular), then standard. */
export const DERIV_VOLATILITIES: DerivVolatility[] = [
    ...DERIV_CONTINUOUS_VOLATILITIES,
    ...DERIV_STANDARD_VOLATILITIES,
];

/** Optgroup-friendly grouping for native <select> dropdowns. */
export const DERIV_VOLATILITY_GROUPS: { label: string; items: DerivVolatility[] }[] = [
    { label: 'Continuous (1s ticks)', items: DERIV_CONTINUOUS_VOLATILITIES },
    { label: 'Standard (2s ticks)',   items: DERIV_STANDARD_VOLATILITIES   },
];

/** Quick lookup: code → short label (for badges, log lines, sparklines). */
export const DERIV_VOL_SHORT: Record<string, string> = Object.fromEntries(
    DERIV_VOLATILITIES.map(v => [v.code, v.short]),
);

/** Quick lookup: code → full human label. */
export const DERIV_VOL_LONG: Record<string, string> = Object.fromEntries(
    DERIV_VOLATILITIES.map(v => [v.code, v.label]),
);

/** All API codes as a const tuple — handy for narrow types. */
export const DERIV_VOL_CODES: string[] = DERIV_VOLATILITIES.map(v => v.code);

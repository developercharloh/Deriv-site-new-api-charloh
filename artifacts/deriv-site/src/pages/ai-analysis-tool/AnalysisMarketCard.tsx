import './analysis-market-card.scss';
import {
    EVEN_ODD_ENTRY_PATTERN,
    OVER_UNDER_ENTRY_PATTERN,
    RISE_FALL_ENTRY_PATTERN,
    getEvenOddSequence,
    getOverUnderSequence,
    getRiseFallSequence,
} from './analysis-entry-patterns';

export interface AnalysisMarketModel {
    name: string;
    vote: boolean;
    pct: number;
}

export interface AnalysisMarketAIResult {
    recommendation: string;
    confidence: number;
    strength: string;
    winPct: number;
    models: AnalysisMarketModel[];
}

export interface AnalysisMarketCardProps {
    marketLabel: string;
    livePrice: number | null;
    pipSize: number;
    prices: number[];
    tickWindow: number;
    connected: boolean;
    aiResult: AnalysisMarketAIResult | null;
    overUnderBarrier: number;
    overUnderEntryValid: boolean;
    riseFallEntryValid: boolean;
    evenOddEntryValid: boolean;
}

interface Distribution {
    counts: number[];
    percentages: number[];
    recent: number[];
    currentDigit: number | null;
    even: number;
    odd: number;
    rise: number;
    fall: number;
    flat: number;
    over: number | null;
    under: number | null;
    atBarrier: number;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

function getLastDigit(price: number, pipSize: number): number {
    const precision = Math.max(0, Math.min(12, Math.floor(pipSize)));
    const fixedPrice = Math.abs(price).toFixed(precision);
    const lastCharacter = fixedPrice.charAt(fixedPrice.length - 1);
    return /^\d$/.test(lastCharacter) ? Number(lastCharacter) : 0;
}

function getDistribution(prices: number[], pipSize: number, barrier: number): Distribution {
    const digits = prices.map(price => getLastDigit(price, pipSize));
    const counts = Array.from({ length: 10 }, () => 0);
    digits.forEach(digit => { counts[digit] += 1; });
    const total = digits.length;
    const percentages = counts.map(count => total ? (count / total) * 100 : 0);
    const evenCount = digits.filter(digit => digit % 2 === 0).length;
    const riseCount = prices.slice(1).reduce((count, price, index) => count + (price > prices[index] ? 1 : 0), 0);
    const fallCount = prices.slice(1).reduce((count, price, index) => count + (price < prices[index] ? 1 : 0), 0);
    const comparisons = Math.max(0, prices.length - 1);
    const overCount = digits.filter(digit => digit > barrier).length;
    const underCount = digits.filter(digit => digit < barrier).length;
    const equalCount = digits.filter(digit => digit === barrier).length;
    const overBarrierValid = barrier >= 0 && barrier <= 8;
    const underBarrierValid = barrier >= 1 && barrier <= 9;

    return {
        counts,
        percentages,
        recent: digits.slice(-10),
        currentDigit: digits.length ? digits[digits.length - 1] : null,
        even: total ? (evenCount / total) * 100 : 50,
        odd: total ? ((total - evenCount) / total) * 100 : 50,
        rise: comparisons ? (riseCount / comparisons) * 100 : 50,
        fall: comparisons ? (fallCount / comparisons) * 100 : 50,
        flat: comparisons ? ((comparisons - riseCount - fallCount) / comparisons) * 100 : 0,
        over: total && overBarrierValid ? (overCount / total) * 100 : overBarrierValid ? 0 : null,
        under: total && underBarrierValid ? (underCount / total) * 100 : underBarrierValid ? 0 : null,
        atBarrier: total ? (equalCount / total) * 100 : 0,
    };
}

function getRankClasses(counts: number[]): string[] {
    const levels = [...new Set(counts)].sort((a, b) => a - b);
    if (levels.length < 4) {
        return counts.map(() => 'aat-market-card__digit--neutral');
    }

    const least = levels[0];
    const secondLeast = levels[1];
    const most = levels[levels.length - 1];
    const secondMost = levels[levels.length - 2];

    return counts.map(count => {
        if (count === most) return 'aat-market-card__digit--most';
        if (count === secondMost) return 'aat-market-card__digit--second-most';
        if (count === least) return 'aat-market-card__digit--least';
        if (count === secondLeast) return 'aat-market-card__digit--second-least';
        return 'aat-market-card__digit--neutral';
    });
}

function ShareBar({ label, leftLabel, leftValue, rightLabel, rightValue, testId }: {
    label: string;
    leftLabel: string;
    leftValue: number | null;
    rightLabel: string;
    rightValue: number | null;
    testId: string;
}) {
    const left = clampPercent(leftValue ?? 0);
    const right = clampPercent(rightValue ?? 0);

    return (
        <div className="aat-market-card__bar-row" role="group" aria-label={`${label} proportions`} data-testid={testId}>
            <div className="aat-market-card__bar">
                <div
                    className="aat-market-card__bar-side aat-market-card__bar-side--left"
                    style={{ width: `${left}%` }}
                    aria-hidden="true"
                />
                <div
                    className="aat-market-card__bar-side aat-market-card__bar-side--right"
                    style={{ width: `${right}%` }}
                    aria-hidden="true"
                />
                <span className="aat-market-card__bar-label aat-market-card__bar-label--left">
                    {leftLabel}: {leftValue === null ? 'N/A' : `${left.toFixed(1)}%`}
                </span>
                <span className="aat-market-card__bar-label aat-market-card__bar-label--right">
                    {rightLabel}: {rightValue === null ? 'N/A' : `${right.toFixed(1)}%`}
                </span>
            </div>
        </div>
    );
}

function EntryCheck({ label, sequence, pattern, valid, testId }: {
    label: string;
    sequence: string;
    pattern: string;
    valid: boolean;
    testId: string;
}) {
    return (
        <div
            className={`aat-market-card__entry aat-market-card__entry--${valid ? 'valid' : 'invalid'}`}
            role="status"
            aria-label={`${label} ${valid ? 'entry point detected' : 'waiting for entry point'}; latest sequence ${sequence || 'not available'}; target ${pattern}`}
            data-testid={testId}
        >
            <span className="aat-market-card__entry-mark" aria-hidden="true">{valid ? '✓' : '×'}</span>
            <span className="aat-market-card__entry-label">{label}</span>
            <code data-testid={`${testId}-sequence`}>{sequence || '—'}</code>
            <span className="aat-market-card__entry-pattern">Target: {pattern}</span>
            <span className="aat-market-card__entry-state">{valid ? 'Entry' : 'Wait'}</span>
        </div>
    );
}

export default function AnalysisMarketCard({
    marketLabel,
    livePrice,
    pipSize,
    prices,
    tickWindow,
    connected,
    aiResult,
    overUnderBarrier,
    overUnderEntryValid,
    riseFallEntryValid,
    evenOddEntryValid,
}: AnalysisMarketCardProps) {
    const safeWindow = Math.max(0, Math.floor(tickWindow));
    const safePrices = safeWindow > 0 ? prices.slice(-safeWindow) : [];
    const distribution = getDistribution(safePrices, pipSize, overUnderBarrier);
    const rankClasses = getRankClasses(distribution.counts);
    const precision = Math.max(0, Math.min(12, Math.floor(pipSize)));
    const marketId = marketLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const overUnderSequence = getOverUnderSequence(safePrices, pipSize, overUnderBarrier);
    const evenOddSequence = getEvenOddSequence(safePrices, pipSize);
    const riseFallSequence = getRiseFallSequence(safePrices);

    return (
        <article
            className="aat-market-card"
            aria-label={`${marketLabel} live market analysis`}
            tabIndex={0}
            data-testid={`card-market-${marketId}`}
        >
            <header className="aat-market-card__header">
                <div className="aat-market-card__identity">
                    <h2 className="aat-market-card__title" data-testid={`text-market-label-${marketId}`}>{marketLabel}</h2>
                    <span
                        className="aat-market-card__price"
                        data-testid={`text-live-price-${marketId}`}
                        aria-label={livePrice === null ? 'Live price unavailable' : `Live price ${livePrice.toFixed(precision)}`}
                    >
                        {livePrice === null ? '—' : livePrice.toFixed(precision)}
                    </span>
                </div>
                <div className={`aat-market-card__connection${connected ? ' aat-market-card__connection--live' : ''}`}
                    role="status" data-testid={`status-market-connection-${marketId}`}>
                    <span className="aat-market-card__connection-dot" aria-hidden="true" />
                    {connected ? 'Live' : 'Offline'}
                </div>
            </header>

            <section className="aat-market-card__distribution" aria-label="Digit distribution">
                <div className="aat-market-card__section-heading">
                    <h3>Digit frequency</h3>
                    <span>
                        {safePrices.length >= tickWindow
                            ? `Last ${tickWindow.toLocaleString()}`
                            : `Last ${safePrices.length.toLocaleString()} / ${tickWindow.toLocaleString()}`}
                    </span>
                </div>
                <div className="aat-market-card__digit-grid" data-testid={`grid-digit-distribution-${marketId}`}>
                    {distribution.percentages.map((percentage, digit) => {
                        const active = digit === distribution.currentDigit;
                        return (
                            <div
                                className={`aat-market-card__digit ${rankClasses[digit]}${active ? ' aat-market-card__digit--active' : ''}`}
                                key={digit}
                                data-testid={`digit-frequency-${marketId}-${digit}`}
                                aria-label={`Digit ${digit}, ${percentage.toFixed(1)} percent${active ? ', current digit' : ''}`}
                            >
                                {active && <span className="aat-market-card__pointer" aria-hidden="true" />}
                                <span className="aat-market-card__digit-number">{digit}</span>
                                <span className="aat-market-card__digit-percent">{percentage.toFixed(1)}%</span>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="aat-market-card__recent" aria-label="Most recent digits">
                <div className="aat-market-card__section-heading">
                    <h3>Recent ticks</h3>
                    <span>Oldest to newest</span>
                </div>
                <div className="aat-market-card__recent-list" data-testid={`list-recent-digits-${marketId}`}>
                    {distribution.recent.length ? distribution.recent.map((digit, index) => (
                        <span className={`aat-market-card__recent-digit${digit % 2 === 0 ? ' aat-market-card__recent-digit--even' : ''}`}
                            key={`${index}-${digit}`} data-testid={`recent-digit-${marketId}-${index}`}>
                            {digit}
                        </span>
                    )) : <span className="aat-market-card__no-data" data-testid={`text-no-recent-digits-${marketId}`}>Waiting for ticks</span>}
                </div>
            </section>

            <section className="aat-market-card__shares" aria-label="Market proportions">
                <ShareBar
                    label={`Over ${overUnderBarrier} and Under ${overUnderBarrier}`}
                    leftLabel={`Over ${overUnderBarrier}`}
                    leftValue={distribution.over}
                    rightLabel={`Under ${overUnderBarrier}`}
                    rightValue={distribution.under}
                    testId={`bar-over-under-${marketId}`}
                />
                <span className="aat-market-card__neutral-note" data-testid={`text-over-under-equal-${marketId}`}>
                    At barrier: {distribution.atBarrier.toFixed(1)}% · {safePrices.length.toLocaleString()} ticks
                </span>
                <ShareBar label="Even and odd" leftLabel="Even" leftValue={distribution.even} rightLabel="Odd" rightValue={distribution.odd} testId={`bar-even-odd-${marketId}`} />
                <ShareBar label="Rise and fall" leftLabel="Rise" leftValue={distribution.rise} rightLabel="Fall" rightValue={distribution.fall} testId={`bar-rise-fall-${marketId}`} />
                <span className="aat-market-card__neutral-note" data-testid={`text-rise-fall-flat-${marketId}`}>
                    Flat: {distribution.flat.toFixed(1)}% of price comparisons
                </span>
            </section>

            <section className="aat-market-card__footer" aria-label="AI analysis and valid entries">
                <div className="aat-market-card__ai" data-testid={`panel-ai-recommendation-${marketId}`}>
                    <div className="aat-market-card__ai-heading">
                            <h3>AI recommendation</h3>
                        {aiResult && <span className="aat-market-card__strength">{aiResult.strength}</span>}
                    </div>
                    {aiResult ? (
                        <>
                            <div className="aat-market-card__recommendation" data-testid={`text-ai-recommendation-${marketId}`}>{aiResult.recommendation}</div>
                            <div className="aat-market-card__confidence" data-testid={`text-ai-confidence-${marketId}`}>
                                <span>Confidence</span>
                                <strong>{clampPercent(aiResult.confidence).toFixed(1)}%</strong>
                            </div>
                            <div className="aat-market-card__confidence-track" aria-label={`Win probability ${clampPercent(aiResult.winPct).toFixed(1)} percent`}>
                                <span style={{ width: `${clampPercent(aiResult.winPct)}%` }} />
                            </div>
                            {aiResult.models.length > 0 && (
                                <ul className="aat-market-card__models" aria-label="Model votes" data-testid={`list-ai-models-${marketId}`}>
                                    {aiResult.models.map((model, index) => (
                                        <li key={`${model.name}-${index}`} className={model.vote ? 'aat-market-card__model--yes' : 'aat-market-card__model--no'}
                                            data-testid={`ai-model-${marketId}-${index}`}>
                                            <span>{model.name}</span>
                                            <strong>{clampPercent(model.pct).toFixed(0)}%</strong>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    ) : (
                        <p className="aat-market-card__pending" role="status" data-testid={`status-ai-pending-${marketId}`}>Collecting signal…</p>
                    )}
                </div>
                <div className="aat-market-card__entries" aria-label="Latest-tick entry point patterns">
                    <div className="aat-market-card__entries-heading">Entry point · latest ticks</div>
                    <EntryCheck
                        label="Over / Under"
                        sequence={overUnderSequence}
                        pattern={OVER_UNDER_ENTRY_PATTERN}
                        valid={overUnderEntryValid}
                        testId={`status-over-under-entry-${marketId}`}
                    />
                    <EntryCheck
                        label="Even / Odd"
                        sequence={evenOddSequence}
                        pattern={EVEN_ODD_ENTRY_PATTERN}
                        valid={evenOddEntryValid}
                        testId={`status-even-odd-entry-${marketId}`}
                    />
                    <EntryCheck
                        label="Rise / Fall"
                        sequence={riseFallSequence}
                        pattern={RISE_FALL_ENTRY_PATTERN}
                        valid={riseFallEntryValid}
                        testId={`status-rise-fall-entry-${marketId}`}
                    />
                </div>
            </section>
        </article>
    );
}

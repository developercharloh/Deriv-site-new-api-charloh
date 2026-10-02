import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';

const AlphaScanAI = lazy(() => import('../alpha-scan-ai'));

type NexusStats = { trades: number; wins: number; losses: number };
type NexusProfitLoss = { realized: number; openPositions: Record<string, number | null> };
type NexusJournalEntry = {
    contractId: string;
    purchaseTime?: string;
    symbol: string;
    leg: 'primary' | 'recovery';
    strategy: string;
    market: string;
    isOpen?: boolean;
    isWin?: boolean | null;
    currentSpot?: string | null;
    entrySpot?: string | null;
    exitSpot?: string | null;
    profit?: number;
};
type NexusSessionState = { active?: boolean; message?: string };
type NexusScanStatus = { busy?: boolean; status?: string; complete?: boolean; hasPlan?: boolean };
type NumericValue = number | '';

type NumberSettingProps = {
    label: string;
    hint: string;
    prefix?: string;
    value: NumericValue;
    onChange: React.Dispatch<React.SetStateAction<NumericValue>>;
    minimum?: number;
    testId: string;
};

const NumberSetting: React.FC<NumberSettingProps> = ({
    label, hint, prefix, value, onChange, minimum = 1, testId,
}) => (
    <label className='nexus-ai__setting' data-testid={`setting-${testId}`}>
        <span className='nexus-ai__setting-copy'>
            <strong>{label}</strong>
            <small>{hint}</small>
        </span>
        <span className='nexus-ai__input-wrap'>
            {prefix && <span className='nexus-ai__prefix' aria-hidden='true'>{prefix}</span>}
            <input
                type='number'
                min={minimum}
                step='1'
                inputMode='decimal'
                value={value}
                aria-label={label}
                data-testid={`input-${testId}`}
                onChange={event => {
                    const raw = event.currentTarget.value;
                    onChange(raw === '' ? '' : Number(raw));
                }}
                onBlur={() => onChange(current => {
                    if (current === '' || !Number.isFinite(current)) return minimum;
                    return Math.max(minimum, current);
                })}
            />
        </span>
    </label>
);

const setNativeControlValue = (
    element: HTMLInputElement | HTMLSelectElement | null,
    value: string
): void => {
    if (!element || element.value === value) return;
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    if (element instanceof HTMLInputElement) element.dispatchEvent(new Event('change', { bubbles: true }));
};

const NexusAIComingSoon: React.FC = () => {
    const controllerRef = useRef<HTMLDivElement | null>(null);
    const launchTimerRef = useRef<number | null>(null);
    const seenContractsRef = useRef(new Set<string>());
    const settledContractsRef = useRef(new Set<string>());
    const fixtureQuery = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : null;
    const fixtureNumber = (key: string, fallback: number): number => {
        if (fixtureQuery?.get('alpha_scan_execution_fixture') !== '1') return fallback;
        const value = Number(fixtureQuery.get(key));
        return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    const [isLaunched, setIsLaunched] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanComplete, setScanComplete] = useState(false);
    const [hasEligiblePlan, setHasEligiblePlan] = useState(false);
    const [isRecoveryEnabled, setIsRecoveryEnabled] = useState(true);
    const [stake, setStake] = useState<NumericValue>(() => fixtureNumber('alpha_scan_fixture_stake', 1));
    const [takeProfit, setTakeProfit] = useState<NumericValue>(() => fixtureNumber('alpha_scan_fixture_target_profit', 10));
    const [stopLoss, setStopLoss] = useState<NumericValue>(() => fixtureNumber('alpha_scan_fixture_stop_loss', 50));
    const [multiplier, setMultiplier] = useState<NumericValue>(() => fixtureNumber('alpha_scan_fixture_martingale', 2));
    const [launchMessage, setLaunchMessage] = useState('Run a market scan before launching. No purchase can be staged until an eligible plan is ready.');
    const [stats, setStats] = useState<NexusStats>({ trades: 0, wins: 0, losses: 0 });
    const [profitLoss, setProfitLoss] = useState<NexusProfitLoss>({ realized: 0, openPositions: {} });
    const [journal, setJournal] = useState<NexusJournalEntry[]>([]);

    const syncHiddenSettings = (): void => {
        const root = controllerRef.current;
        if (!root) return;
        setNativeControlValue(root.querySelector('input[aria-label="Stake"]'), `$${stake || 1}`);
        setNativeControlValue(root.querySelector('select[aria-label="Target profit"]'), String(takeProfit || 1));
        setNativeControlValue(root.querySelector('select[aria-label="Stop loss"]'), String(stopLoss || 1));
        setNativeControlValue(root.querySelector('select[aria-label="Martingale"]'), String(multiplier || 1));
    };

    useEffect(() => {
        syncHiddenSettings();
    }, [stake, takeProfit, stopLoss, multiplier]);

    useEffect(() => {
        const handleFeedback = (event: Event) => {
            const feedback = (event as CustomEvent).detail as { kind?: string; message?: string } | undefined;
            if (feedback?.message) setLaunchMessage(feedback.message);
            if (feedback?.kind === 'error') setIsLaunched(false);
        };
        const handleSession = (event: Event) => {
            const session = (event as CustomEvent).detail as NexusSessionState | undefined;
            if (!session) return;
            setIsLaunched(Boolean(session.active));
            if (session.message) setLaunchMessage(session.message);
        };
        const handleScanStatus = (event: Event) => {
            const scan = (event as CustomEvent).detail as NexusScanStatus | undefined;
            if (!scan) return;
            setIsScanning(Boolean(scan.busy));
            if (scan.busy) {
                setScanComplete(false);
                setHasEligiblePlan(false);
                setLaunchMessage('Scanning live volatility markets…');
                return;
            }
            const complete = Boolean(scan.complete);
            const eligible = Boolean(scan.hasPlan);
            setScanComplete(complete);
            setHasEligiblePlan(eligible);
            if (complete && eligible) {
                setLaunchMessage('Scan complete. An eligible market plan is ready for review.');
            } else if (scan.status && scan.status !== 'idle') {
                setLaunchMessage(scan.status === 'ready'
                    ? 'Scan complete. No eligible market found; no purchase was staged.'
                    : `Market scan ${scan.status.replace(/-/g, ' ')}. No purchase was staged.`);
            }
        };
        const handleJournal = (event: Event) => {
            const entry = (event as CustomEvent).detail as NexusJournalEntry | undefined;
            if (!entry?.contractId || !entry.symbol) return;
            setJournal(current => {
                const existingIndex = current.findIndex(item => item.contractId === entry.contractId);
                if (existingIndex < 0) return [entry, ...current].slice(0, 20);
                const next = current.slice();
                next[existingIndex] = { ...next[existingIndex], ...entry };
                return next;
            });
            if (entry.isOpen) {
                setLaunchMessage(`${entry.leg === 'recovery' ? 'Recovery' : 'Primary'} contract open · ${entry.strategy}`);
            } else {
                setLaunchMessage(`${entry.isWin ? 'Contract won' : 'Contract settled'} · ${entry.entrySpot || '—'} → ${entry.exitSpot || '—'}`);
            }
        };
        window.addEventListener('nexus-ai-feedback', handleFeedback);
        window.addEventListener('nexus-ai-session', handleSession);
        window.addEventListener('nexus-ai-scan-status', handleScanStatus);
        window.addEventListener('nexus-ai-journal', handleJournal);
        const scanStatusRequest = window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('nexus-ai-scan-status-request'));
        }, 0);
        return () => {
            window.clearTimeout(scanStatusRequest);
            if (launchTimerRef.current !== null) window.clearTimeout(launchTimerRef.current);
            window.removeEventListener('nexus-ai-feedback', handleFeedback);
            window.removeEventListener('nexus-ai-session', handleSession);
            window.removeEventListener('nexus-ai-scan-status', handleScanStatus);
            window.removeEventListener('nexus-ai-journal', handleJournal);
        };
    }, []);

    useEffect(() => {
        const handlePosition = (event: Event) => {
            const position = (event as CustomEvent).detail as {
                contractId?: string;
                isOpen?: boolean;
                isWin?: boolean | null;
                profit?: number | null;
            } | undefined;
            if (!position?.contractId) return;
            if (position.isOpen) {
                if (!seenContractsRef.current.has(position.contractId)) {
                    seenContractsRef.current.add(position.contractId);
                    setStats(current => ({ ...current, trades: current.trades + 1 }));
                }
                setProfitLoss(current => ({
                    ...current,
                    openPositions: {
                        ...current.openPositions,
                        [position.contractId as string]: typeof position.profit === 'number' && Number.isFinite(position.profit)
                            ? position.profit
                            : null,
                    },
                }));
                return;
            }
            if (settledContractsRef.current.has(position.contractId)) return;
            settledContractsRef.current.add(position.contractId);
            const wasSeenOpen = seenContractsRef.current.has(position.contractId);
            if (!wasSeenOpen) seenContractsRef.current.add(position.contractId);
            setStats(current => ({
                trades: wasSeenOpen ? current.trades : current.trades + 1,
                wins: current.wins + (position.isWin ? 1 : 0),
                losses: current.losses + (position.isWin === false ? 1 : 0),
            }));
            setProfitLoss(current => {
                const openPositions = { ...current.openPositions };
                delete openPositions[position.contractId as string];
                const settledProfit = typeof position.profit === 'number' && Number.isFinite(position.profit)
                    ? position.profit
                    : 0;
                return { realized: current.realized + settledProfit, openPositions };
            });
        };
        window.addEventListener('nexus-ai-position', handlePosition);
        return () => window.removeEventListener('nexus-ai-position', handlePosition);
    }, []);

    const launchAI = (): void => {
        syncHiddenSettings();
        if (!controllerRef.current) {
            setLaunchMessage('Connecting to live market controls.');
            return;
        }
        if (isLaunched) {
            if (launchTimerRef.current !== null) {
                window.clearTimeout(launchTimerRef.current);
                launchTimerRef.current = null;
            }
            setLaunchMessage('Stopping Nexus AI and cancelling any pending launch.');
            window.dispatchEvent(new CustomEvent('nexus-ai-stop'));
            return;
        }
        if (!scanComplete || !hasEligiblePlan || isScanning) {
            setLaunchMessage('Launch is locked until a complete scan returns an eligible market plan.');
            return;
        }
        setIsLaunched(true);
        setLaunchMessage('Plan approved · connecting to the selected live market.');
        launchTimerRef.current = window.setTimeout(() => {
            launchTimerRef.current = null;
            window.dispatchEvent(new CustomEvent('nexus-ai-launch'));
        }, 0);
    };

    const scanMarkets = (): void => {
        if (!controllerRef.current || isScanning || isLaunched) return;
        setScanComplete(false);
        setHasEligiblePlan(false);
        setIsScanning(true);
        setLaunchMessage('Scanning live volatility markets…');
        window.dispatchEvent(new CustomEvent('nexus-ai-scan'));
    };

    const toggleRecovery = (): void => {
        const nextValue = !isRecoveryEnabled;
        setIsRecoveryEnabled(nextValue);
        const recoveryButton = controllerRef.current?.querySelector<HTMLButtonElement>('[data-testid="toggle-recovery"]');
        if (recoveryButton && recoveryButton.getAttribute('aria-pressed') !== String(nextValue)) recoveryButton.click();
    };

    const winRate = stats.trades ? Math.round((stats.wins / stats.trades) * 100) : 0;
    const openContractIds = Object.keys(profitLoss.openPositions);
    const hasOpenContracts = openContractIds.length > 0;
    const hasPendingOpenProfit = hasOpenContracts &&
        openContractIds.some(contractId => profitLoss.openPositions[contractId] === null);
    const openProfitLoss = hasOpenContracts && !hasPendingOpenProfit
        ? openContractIds.reduce((total, contractId) => total + (profitLoss.openPositions[contractId] || 0), 0)
        : hasOpenContracts ? null : 0;
    const totalProfitLoss = profitLoss.realized + (openProfitLoss ?? 0);
    const formatMoney = (value: number): string =>
        `${value < 0 ? '-$' : '$'}${Math.abs(value).toFixed(2)}`;
    const pnlTone = totalProfitLoss >= 0 ? 'positive' : 'negative';
    const canLaunch = isLaunched || (scanComplete && hasEligiblePlan && !isScanning);

    return (
        <section className='ai-analysis-coming-soon nexus-ai' aria-labelledby='nexus-ai-title' data-testid='nexus-interface'>
            <div className='nexus-ai__layout'>
                <header className='nexus-ai__masthead'>
                    <div className='nexus-ai__identity'>
                        <span className='nexus-ai__mark' aria-hidden='true'>N</span>
                        <div>
                            <p className='nexus-ai__eyebrow'>Deriv · Live trading tool</p>
                            <h1 id='nexus-ai-title'>Nexus <span>AI</span></h1>
                        </div>
                    </div>
                    <div className={`nexus-ai__live-state${isLaunched ? ' is-live' : ''}`} aria-live='polite'>
                        <span className='nexus-ai__state-dot' />
                        <span>{isLaunched ? 'SESSION ACTIVE' : isScanning ? 'SCANNING MARKETS' : 'ENGINE STANDBY'}</span>
                    </div>
                </header>

                <section className='nexus-ai__overview' aria-label='Session overview'>
                    <div className='nexus-ai__overview-copy'>
                        <span className='nexus-ai__kicker'>Synthetic volatility · guarded execution</span>
                        <h2>Make the plan.<br /><em>Then let it run.</em></h2>
                        <p>Scan live markets, review the eligible plan, then launch with session limits in place.</p>
                    </div>
                    <div className='nexus-ai__telemetry' aria-label='Session results' aria-live='polite'>
                        <div><span>Contracts</span><strong>{stats.trades}</strong></div>
                        <div><span>Wins</span><strong className='is-positive'>{stats.wins}</strong></div>
                        <div><span>Losses</span><strong className='is-negative'>{stats.losses}</strong></div>
                        <div><span>Win rate</span><strong>{winRate}<small>%</small></strong></div>
                    </div>
                    <div
                        className={`nexus-ai__pnl-summary nexus-ai__pnl-summary--${pnlTone}`}
                        data-testid='nexus-total-pnl'
                        data-realized-profit-loss={profitLoss.realized.toFixed(2)}
                        data-open-profit-loss={hasPendingOpenProfit ? 'pending' : (openProfitLoss ?? 0).toFixed(2)}
                        data-total-profit-loss={hasPendingOpenProfit ? '' : totalProfitLoss.toFixed(2)}
                        data-open-contracts={openContractIds.length}
                        data-contract-count={stats.trades}
                        role='group'
                        aria-label='Total profit or loss since Nexus opened'
                        aria-live='polite'
                    >
                        <div className='nexus-ai__pnl-primary'>
                            <span>Total Profit / Loss</span>
                            <strong>{hasPendingOpenProfit ? 'Pending' : formatMoney(totalProfitLoss)}</strong>
                        </div>
                        <p>
                            <span>Realized {formatMoney(profitLoss.realized)}</span>
                            <span>Open {hasPendingOpenProfit ? 'Pending' : formatMoney(openProfitLoss ?? 0)}</span>
                            <span>Since Nexus opened</span>
                        </p>
                    </div>
                </section>

                <div className='nexus-ai__workspace'>
                    <section className='nexus-ai__panel nexus-ai__controls' aria-labelledby='nexus-settings-title'>
                        <div className='nexus-ai__panel-heading'>
                            <div><span className='nexus-ai__step-label'>01 / Configure</span><h2 id='nexus-settings-title'>Session risk</h2></div>
                            <span className='nexus-ai__panel-mark'>LIMITS</span>
                        </div>
                        <div className='nexus-ai__settings-grid'>
                            <NumberSetting label='Stake' hint='Per contract' prefix='$' value={stake} onChange={setStake} testId='stake' />
                            <NumberSetting label='Take profit' hint='Stop session at' prefix='$' value={takeProfit} onChange={setTakeProfit} testId='take-profit' />
                            <NumberSetting label='Stop loss' hint='Stop session at' prefix='$' value={stopLoss} onChange={setStopLoss} testId='stop-loss' />
                            <NumberSetting label='Recovery multiplier' hint='Next recovery stake' value={multiplier} onChange={setMultiplier} testId='recovery-multiplier' />
                        </div>
                        <div className='nexus-ai__recovery-row'>
                            <span className='nexus-ai__recovery-symbol' aria-hidden='true'>R</span>
                            <span className='nexus-ai__setting-copy'><strong>Recovery mode</strong><small>Allow a guarded recovery leg after a loss</small></span>
                            <button
                                type='button'
                                className='nexus-ai__switch'
                                role='switch'
                                aria-checked={isRecoveryEnabled}
                                aria-label='Recovery mode'
                                data-testid='toggle-recovery-mode'
                                onClick={toggleRecovery}
                            ><span /></button>
                        </div>
                        <p className='nexus-ai__safety-note'><span aria-hidden='true'>!</span> Risk limits are applied to the session. Scan and eligible-plan checks remain required before launch.</p>
                    </section>

                    <section className='nexus-ai__panel nexus-ai__execution' aria-labelledby='nexus-execution-title'>
                        <div className='nexus-ai__panel-heading'>
                            <div><span className='nexus-ai__step-label'>02 / Execute</span><h2 id='nexus-execution-title'>Market control</h2></div>
                            <span className={`nexus-ai__plan-chip${hasEligiblePlan && scanComplete ? ' is-ready' : ''}`}>
                                <span />{hasEligiblePlan && scanComplete ? 'PLAN READY' : 'PLAN REQUIRED'}
                            </span>
                        </div>
                        <div className='nexus-ai__market-readout'>
                            <span className='nexus-ai__readout-orbit' aria-hidden='true'><i /><i /><i /></span>
                            <div><span>MARKET SELECTION</span><strong>{hasEligiblePlan && scanComplete ? 'Eligible volatility market' : 'Awaiting market scan'}</strong><small>{hasEligiblePlan && scanComplete ? 'Plan confirmed by live scan' : 'No market selected yet'}</small></div>
                        </div>
                        <div className='nexus-ai__status-message' role='status' aria-live='polite'>
                            <span className='nexus-ai__status-icon' aria-hidden='true'>i</span>{launchMessage}
                        </div>
                        <div className='nexus-ai__action-row'>
                            <button
                                type='button'
                                className='nexus-ai__scan-button'
                                data-testid='nexus-scan-button'
                                disabled={isScanning || isLaunched}
                                onClick={scanMarkets}
                            ><span className={isScanning ? 'nexus-ai__scan-glyph is-spinning' : 'nexus-ai__scan-glyph'} aria-hidden='true'>↻</span>{isScanning ? 'Scanning markets' : 'Scan markets'}</button>
                            <button
                                type='button'
                                className={`nexus-ai__launch-button${isLaunched ? ' is-stop' : ''}`}
                                data-testid='nexus-launch-button'
                                aria-pressed={isLaunched}
                                disabled={!canLaunch}
                                onClick={launchAI}
                            ><span className='nexus-ai__launch-indicator' aria-hidden='true' />{isLaunched ? 'Stop session' : 'Launch AI'}</button>
                        </div>
                        <p className='nexus-ai__guard-copy'>Launch unlocks only after a complete scan finds an eligible plan.</p>
                    </section>
                </div>

                <section className='nexus-ai__panel nexus-ai__journal' aria-labelledby='nexus-ai-journal-title'>
                    <div className='nexus-ai__panel-heading'>
                        <div><span className='nexus-ai__step-label'>03 / Observe</span><h2 id='nexus-ai-journal-title'>Contract journal</h2></div>
                        <span className='nexus-ai__journal-count'>{journal.length} {journal.length === 1 ? 'contract' : 'contracts'}</span>
                    </div>
                    {journal.length ? (
                        <div className='nexus-ai__journal-table-wrap'>
                            <table className='nexus-ai__journal-table'>
                                <thead><tr><th>Time</th><th>Market / strategy</th><th>Leg</th><th>Entry</th><th>Current</th><th>Exit</th><th>Price path</th><th>Result</th></tr></thead>
                                <tbody>{journal.map(entry => {
                                    const result = entry.isOpen ? 'OPEN' : entry.isWin ? 'WON' : 'LOST';
                                    return <tr key={entry.contractId} data-testid={`journal-entry-${entry.contractId}`}>
                                        <td>{entry.purchaseTime || '—'}</td>
                                        <td><strong>{entry.market}</strong><small>{entry.symbol} · {entry.strategy}</small></td>
                                        <td><span className={`nexus-ai__leg nexus-ai__leg--${entry.leg}`}>{entry.leg}</span></td>
                                        <td>{entry.entrySpot || '—'}</td><td>{entry.currentSpot || '—'}</td><td>{entry.exitSpot || '—'}</td>
                                        <td className='nexus-ai__price-path'>{entry.entrySpot || '—'} <span>→</span> {entry.exitSpot || entry.currentSpot || 'LIVE'}</td>
                                        <td><span className={`nexus-ai__result nexus-ai__result--${result.toLowerCase()}`}>{result}</span>{typeof entry.profit === 'number' && <small className={entry.profit >= 0 ? 'is-positive' : 'is-negative'}>{entry.profit >= 0 ? '+' : ''}{entry.profit.toFixed(2)}</small>}</td>
                                    </tr>;
                                })}</tbody>
                            </table>
                        </div>
                    ) : (
                        <div className='nexus-ai__empty-journal' data-testid='journal-empty'>
                            <span className='nexus-ai__empty-mark' aria-hidden='true'>—</span>
                            <div><strong>No contracts recorded</strong><p>Completed and open contracts will appear here as the live session reports them.</p></div>
                        </div>
                    )}
                </section>
                <footer className='nexus-ai__footer'><span>DERIV / NEXUS AI</span><span>Live market data · session controls</span></footer>
            </div>

            <div ref={controllerRef} className='nexus-ai__engine' aria-hidden='true'>
                <Suspense fallback={null}><AlphaScanAI /></Suspense>
            </div>
        </section>
    );
};

export default NexusAIComingSoon;
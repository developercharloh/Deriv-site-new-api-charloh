import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';

const AlphaScanAI = lazy(() => import('../alpha-scan-ai'));

type NexusStats = {
    trades: number;
    wins: number;
    losses: number;
};

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

type NexusSessionState = {
    active?: boolean;
    message?: string;
};

type EditableNumberProps = {
    value: number | '';
    setValue: React.Dispatch<React.SetStateAction<number | ''>>;
    label: string;
    className: string;
    minimum?: number;
};

const EditableNumber: React.FC<EditableNumberProps> = ({
    value,
    setValue,
    label,
    className,
    minimum = 1,
}) => (
    <input
        type='text'
        inputMode='numeric'
        pattern='[0-9]*'
        className={`nexus-ai__editable-value ${className}`}
        aria-label={label}
        value={value}
        onChange={event => {
            const rawValue = event.currentTarget.value.replace(/[^\d]/g, '');
            setValue(rawValue === '' ? '' : Number(rawValue));
        }}
        onBlur={() => {
            setValue(current => {
                if (current === '' || !Number.isFinite(current)) return minimum;
                return Math.max(minimum, current);
            });
        }}
    />
);

const setNativeControlValue = (element: HTMLInputElement | HTMLSelectElement | null, value: string): void => {
    if (!element || element.value === value) return;
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    if (element instanceof HTMLInputElement) element.dispatchEvent(new Event('change', { bubbles: true }));
};

const NexusAIComingSoon: React.FC = () => {
    const controllerRef = useRef<HTMLDivElement | null>(null);
    const seenContractsRef = useRef(new Set<string>());
    const settledContractsRef = useRef(new Set<string>());
    const [isLaunched, setIsLaunched] = useState(false);
    const [isRecoveryEnabled, setIsRecoveryEnabled] = useState(true);
    const [stake, setStake] = useState<number | ''>(1);
    const [takeProfit, setTakeProfit] = useState<number | ''>(10);
    const [stopLoss, setStopLoss] = useState<number | ''>(50);
    const [multiplier, setMultiplier] = useState<number | ''>(2);
    const [launchMessage, setLaunchMessage] = useState('');
    const [stats, setStats] = useState<NexusStats>({ trades: 0, wins: 0, losses: 0 });
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
        const timer = window.setInterval(syncHiddenSettings, 250);
        return () => window.clearInterval(timer);
    }, []);

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
                setLaunchMessage(`${entry.leg === 'recovery' ? 'Recovery' : 'Primary'} open · ${entry.strategy}`);
            } else {
                const result = entry.isWin ? 'Won' : 'Lost';
                setLaunchMessage(`${result} · ${entry.entrySpot || '—'} → ${entry.exitSpot || '—'}`);
            }
        };
        window.addEventListener('nexus-ai-feedback', handleFeedback);
        window.addEventListener('nexus-ai-session', handleSession);
        window.addEventListener('nexus-ai-journal', handleJournal);
        return () => {
            window.removeEventListener('nexus-ai-feedback', handleFeedback);
            window.removeEventListener('nexus-ai-session', handleSession);
            window.removeEventListener('nexus-ai-journal', handleJournal);
        };
    }, []);

    useEffect(() => {
        syncHiddenSettings();
    }, [stake, takeProfit, stopLoss, multiplier]);

    useEffect(() => {
        const handlePosition = (event: Event) => {
            const position = (event as CustomEvent).detail as {
                contractId?: string;
                isOpen?: boolean;
                isWin?: boolean | null;
            } | undefined;
            if (!position || !position.contractId) return;
            if (position.isOpen) {
                if (seenContractsRef.current.has(position.contractId)) return;
                seenContractsRef.current.add(position.contractId);
                setStats(current => ({ ...current, trades: current.trades + 1 }));
                return;
            }
            if (settledContractsRef.current.has(position.contractId)) return;
            settledContractsRef.current.add(position.contractId);
            const wasSeenOpen = seenContractsRef.current.has(position.contractId);
            if (!wasSeenOpen) {
                seenContractsRef.current.add(position.contractId);
            }
            setStats(current => ({
                trades: wasSeenOpen ? current.trades : current.trades + 1,
                wins: current.wins + (position.isWin ? 1 : 0),
                losses: current.losses + (position.isWin === false ? 1 : 0),
            }));
        };
        window.addEventListener('nexus-ai-position', handlePosition);
        return () => window.removeEventListener('nexus-ai-position', handlePosition);
    }, []);

    const launchAI = (): void => {
        syncHiddenSettings();
        if (!controllerRef.current) {
            setLaunchMessage('Connecting to live market');
            return;
        }
        if (isLaunched) {
            setLaunchMessage('Stopping Nexus AI');
            window.dispatchEvent(new CustomEvent('nexus-ai-stop'));
            return;
        }
        setIsLaunched(true);
        setLaunchMessage('LIVE · Selecting the best market');
        // Let the hidden Alpha controls consume the latest Nexus values before
        // the launch handler snapshots its runtime configuration.
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('nexus-ai-launch')), 0);
    };

    const toggleRecovery = (): void => {
        const nextValue = !isRecoveryEnabled;
        setIsRecoveryEnabled(nextValue);
        const recoveryButton = controllerRef.current?.querySelector<HTMLButtonElement>('[data-testid="toggle-recovery"]');
        if (recoveryButton && recoveryButton.getAttribute('aria-pressed') !== String(nextValue)) {
            recoveryButton.click();
        }
    };

    const adjust = (
        setter: React.Dispatch<React.SetStateAction<number | ''>>,
        amount: number,
        minimum = 1
    ): void => {
        setter(current => Math.max(minimum, (typeof current === 'number' ? current : minimum) + amount));
    };

    const winRate = stats.trades ? Math.round((stats.wins / stats.trades) * 100) : 0;

    return (
        <section className='ai-analysis-coming-soon nexus-ai' aria-labelledby='nexus-ai-title'>
            <div className='nexus-ai__reference-surface'>
                <img
                    src='/assets/nexus-ai-reference.jpg'
                    alt='Nexus AI adaptive trading engine with trading parameters, recovery mode, Launch AI, and trading statistics'
                />

                <div className='nexus-ai__control-layer' aria-label='Nexus AI live controls'>
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--stake-minus' aria-label='Decrease stake' onClick={() => adjust(setStake, -1)} />
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--stake-plus' aria-label='Increase stake' onClick={() => adjust(setStake, 1)} />
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--profit-minus' aria-label='Decrease take profit' onClick={() => adjust(setTakeProfit, -1)} />
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--profit-plus' aria-label='Increase take profit' onClick={() => adjust(setTakeProfit, 1)} />
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--loss-minus' aria-label='Decrease stop loss' onClick={() => adjust(setStopLoss, -1)} />
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--loss-plus' aria-label='Increase stop loss' onClick={() => adjust(setStopLoss, 1)} />
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--multiplier-minus' aria-label='Decrease recovery multiplier' onClick={() => adjust(setMultiplier, -1)} />
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--multiplier-plus' aria-label='Increase recovery multiplier' onClick={() => adjust(setMultiplier, 1)} />
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--recovery' aria-label='Toggle recovery mode' aria-pressed={isRecoveryEnabled} onClick={toggleRecovery} />
                    <button
                        type='button'
                        className='nexus-ai__hitbox nexus-ai__hitbox--launch'
                        aria-label={isLaunched ? 'Stop Nexus AI' : 'Launch AI'}
                        aria-pressed={isLaunched}
                        onClick={launchAI}
                    />
                </div>

                <EditableNumber value={stake} setValue={setStake} label='Stake amount' className='nexus-ai__editable-value--stake' />
                <EditableNumber value={takeProfit} setValue={setTakeProfit} label='Take profit' className='nexus-ai__editable-value--profit' />
                <EditableNumber value={stopLoss} setValue={setStopLoss} label='Stop loss' className='nexus-ai__editable-value--loss' />
                <EditableNumber value={multiplier} setValue={setMultiplier} label='Recovery multiplier' className='nexus-ai__editable-value--multiplier' />
                {!isRecoveryEnabled && <span className='nexus-ai__toggle-overlay' aria-hidden='true'><span /></span>}
                {isLaunched && <span className='nexus-ai__launch-state' aria-hidden='true'>STOP AI</span>}
                {launchMessage && <span className='nexus-ai__status-overlay' role='status'>{launchMessage}</span>}

                {stats.trades > 0 && (
                    <div className='nexus-ai__stats-overlay' aria-live='polite'>
                        <strong>{stats.trades}</strong>
                        <strong>{stats.wins}</strong>
                        <strong>{stats.losses}</strong>
                        <strong>{winRate}%</strong>
                    </div>
                )}
            </div>

            <section className='nexus-ai__journal' aria-labelledby='nexus-ai-journal-title'>
                <div className='nexus-ai__journal-heading'>
                    <div>
                        <span>Live execution</span>
                        <h2 id='nexus-ai-journal-title'>Journal</h2>
                    </div>
                    <small>Entry / exit price action</small>
                </div>
                <div className='nexus-ai__journal-table-wrap'>
                    <table className='nexus-ai__journal-table'>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Market</th>
                                <th>Leg</th>
                                <th>Entry</th>
                                <th>Current</th>
                                <th>Exit</th>
                                <th>Price action</th>
                                <th>Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {journal.length ? journal.map(entry => {
                                const result = entry.isOpen ? 'OPEN' : entry.isWin ? 'WON' : 'LOST';
                                return (
                                    <tr key={entry.contractId}>
                                        <td>{entry.purchaseTime || '—'}</td>
                                        <td><strong>{entry.market}</strong><small>{entry.symbol} · {entry.strategy}</small></td>
                                        <td>{entry.leg}</td>
                                        <td>{entry.entrySpot || '—'}</td>
                                        <td>{entry.currentSpot || '—'}</td>
                                        <td>{entry.exitSpot || '—'}</td>
                                        <td className='nexus-ai__journal-action'>
                                            {entry.entrySpot || '—'} <span>→</span> {entry.exitSpot || entry.currentSpot || 'LIVE'}
                                        </td>
                                        <td className={`nexus-ai__journal-result nexus-ai__journal-result--${result.toLowerCase()}`}>{result}</td>
                                    </tr>
                                );
                            }) : (
                                <tr><td colSpan={8} className='nexus-ai__journal-empty'>No contracts yet. Launch AI to record the selected market and its price action.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <div ref={controllerRef} className='nexus-ai__engine' aria-hidden='true'>
                <Suspense fallback={null}>
                    <AlphaScanAI />
                </Suspense>
            </div>
            <h1 id='nexus-ai-title' className='sr-only'>Nexus AI</h1>
        </section>
    );
};

export default NexusAIComingSoon;
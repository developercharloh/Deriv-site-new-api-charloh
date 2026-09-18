import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';

const AlphaScanAI = lazy(() => import('../alpha-scan-ai'));

type NexusStats = {
    trades: number;
    wins: number;
    losses: number;
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
            setIsLaunched(false);
            setLaunchMessage('');
        };
        window.addEventListener('nexus-ai-position', handlePosition);
        return () => window.removeEventListener('nexus-ai-position', handlePosition);
    }, []);

    const launchAI = (): void => {
        syncHiddenSettings();
        const runButton = controllerRef.current?.querySelector<HTMLButtonElement>('[data-testid="button-run-trade"]');
        if (!runButton) {
            setLaunchMessage('Connecting to live market');
            return;
        }
        if (runButton.disabled) {
            setLaunchMessage('Log in or wait for a ready market');
            return;
        }
        setIsLaunched(true);
        setLaunchMessage('LIVE · Contract requested');
        runButton.click();
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
                    <button type='button' className='nexus-ai__hitbox nexus-ai__hitbox--launch' aria-label='Launch AI' aria-pressed={isLaunched} onClick={launchAI} />
                </div>

                <EditableNumber value={stake} setValue={setStake} label='Stake amount' className='nexus-ai__editable-value--stake' />
                <EditableNumber value={takeProfit} setValue={setTakeProfit} label='Take profit' className='nexus-ai__editable-value--profit' />
                <EditableNumber value={stopLoss} setValue={setStopLoss} label='Stop loss' className='nexus-ai__editable-value--loss' />
                <EditableNumber value={multiplier} setValue={setMultiplier} label='Recovery multiplier' className='nexus-ai__editable-value--multiplier' />
                <span
                    className={`nexus-ai__toggle-overlay${isRecoveryEnabled ? ' nexus-ai__toggle-overlay--on' : ''}`}
                    aria-hidden='true'
                >
                    <span />
                </span>
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
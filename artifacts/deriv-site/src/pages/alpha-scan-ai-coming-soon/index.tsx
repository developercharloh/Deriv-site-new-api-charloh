import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';

const AlphaScanAI = lazy(() => import('../alpha-scan-ai'));

type NexusStats = {
    trades: number;
    wins: number;
    losses: number;
};

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
    const [stake, setStake] = useState(1);
    const [takeProfit, setTakeProfit] = useState(10);
    const [stopLoss, setStopLoss] = useState(50);
    const [multiplier, setMultiplier] = useState(2);
    const [launchMessage, setLaunchMessage] = useState('');
    const [stats, setStats] = useState<NexusStats>({ trades: 0, wins: 0, losses: 0 });

    const syncHiddenSettings = (): void => {
        const root = controllerRef.current;
        if (!root) return;
        setNativeControlValue(root.querySelector('input[aria-label="Stake"]'), `$${stake}`);
        setNativeControlValue(root.querySelector('select[aria-label="Target profit"]'), String(takeProfit));
        setNativeControlValue(root.querySelector('select[aria-label="Stop loss"]'), String(stopLoss));
        setNativeControlValue(root.querySelector('select[aria-label="Martingale"]'), String(multiplier));
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

    const adjust = (setter: React.Dispatch<React.SetStateAction<number>>, amount: number, minimum = 1): void => {
        setter(current => Math.max(minimum, current + amount));
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

                {stake !== 1 && <span className='nexus-ai__value-overlay nexus-ai__value-overlay--stake'>{stake}</span>}
                {takeProfit !== 10 && <span className='nexus-ai__value-overlay nexus-ai__value-overlay--profit'>{takeProfit}</span>}
                {stopLoss !== 50 && <span className='nexus-ai__value-overlay nexus-ai__value-overlay--loss'>{stopLoss}</span>}
                {multiplier !== 2 && <span className='nexus-ai__value-overlay nexus-ai__value-overlay--multiplier'>{multiplier}</span>}
                {!isRecoveryEnabled && <span className='nexus-ai__toggle-overlay' aria-hidden='true'><span /></span>}
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
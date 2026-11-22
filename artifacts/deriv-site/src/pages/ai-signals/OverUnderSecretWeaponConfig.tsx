import React, { useState } from 'react';
import { X } from '@/utils/lucide-shim';
import type { OverUnderSignalSelection } from './over-under-signal-board';

export interface SecretWeaponRunSettings {
    side: 'OVER' | 'UNDER';
    barrier: number;
    stake: number;
    takeProfit: number;
    stopLoss: number;
    martingale: number;
    maxTrades: number;
}

interface Props {
    selection: OverUnderSignalSelection;
    loading: boolean;
    error: string;
    onClose: () => void;
    onSave: (settings: SecretWeaponRunSettings) => void;
}

const STORAGE_KEY = 'fb_cfg_over-under-secret-weapon';
const OVER_BARRIERS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const UNDER_BARRIERS = [9, 8, 7, 6, 5, 4, 3, 2, 1];
const barriersForSide = (side: 'OVER' | 'UNDER') => side === 'OVER' ? OVER_BARRIERS : UNDER_BARRIERS;

function savedSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        return {
            side: saved?.side === 'OVER' || saved?.side === 'UNDER' ? saved.side : undefined,
            stake: typeof saved?.stake === 'string' ? saved.stake : '0.35',
            takeProfit: typeof saved?.takeProfit === 'string' ? saved.takeProfit : '15',
            stopLoss: typeof saved?.stopLoss === 'string' ? saved.stopLoss : '50',
            martingale: typeof saved?.martingale === 'string' ? saved.martingale : '2',
            barrier: Number.isInteger(Number(saved?.barrier)) ? Number(saved.barrier) : undefined,
            maxTrades: typeof saved?.maxTrades === 'string' ? saved.maxTrades : '50',
        };
    } catch {
        return {
            side: undefined,
            stake: '0.35',
            takeProfit: '15',
            stopLoss: '50',
            martingale: '2',
            barrier: undefined,
            maxTrades: '50',
        };
    }
}

export function OverUnderSecretWeaponConfig({
    selection,
    loading,
    error,
    onClose,
    onSave,
}: Props) {
    const initial = savedSettings();
    const initialSide = initial.side ?? selection.setup.side;
    const [side, setSide] = useState<'OVER' | 'UNDER'>(initialSide);
    const barriers = barriersForSide(side);
    const [barrier, setBarrier] = useState(
        initial.barrier !== undefined && barriers.includes(initial.barrier)
            ? initial.barrier
            : selection.setup.side === initialSide
                ? selection.setup.barrier
                : initialSide === 'OVER' ? 4 : 5,
    );
    const [stake, setStake] = useState(initial.stake);
    const [takeProfit, setTakeProfit] = useState(initial.takeProfit);
    const [stopLoss, setStopLoss] = useState(initial.stopLoss);
    const [martingale, setMartingale] = useState(initial.martingale);
    const [maxTrades, setMaxTrades] = useState(initial.maxTrades);

    const changeSide = (nextSide: 'OVER' | 'UNDER') => {
        setSide(nextSide);
        if (!barriersForSide(nextSide).includes(barrier)) {
            setBarrier(selection.setup.side === nextSide
                ? selection.setup.barrier
                : nextSide === 'OVER' ? 4 : 5);
        }
    };

    const submit = () => onSave({
        side,
        barrier,
        stake: Number(stake),
        takeProfit: Number(takeProfit),
        stopLoss: Number(stopLoss),
        martingale: Number(martingale),
        maxTrades: Number(maxTrades),
    });

    return (
        <div
            className='ai-runcfg__overlay'
            onClick={() => { if (!loading) onClose(); }}
            data-testid='secret-weapon-config-overlay'
        >
            <section
                className='ai-runcfg ai-runcfg--secret-weapon'
                role='dialog'
                aria-modal='true'
                aria-labelledby='secret-weapon-config-title'
                onClick={event => event.stopPropagation()}
            >
                <header className='ai-runcfg__header'>
                    <span id='secret-weapon-config-title'>Configure #21 — Over Under Secret Weapon</span>
                    <button
                        type='button'
                        className='ai-runcfg__close'
                        aria-label='Close setup'
                        disabled={loading}
                        onClick={onClose}
                    >
                        <X size={16} />
                    </button>
                </header>

                <div className='ai-runcfg__sub'>
                    Source signal: <strong>{selection.setup.indicator} · {selection.setup.side} {selection.setup.barrier}</strong>
                    <br />
                    Market: <strong>{selection.symbol.label} ({selection.symbol.code})</strong>
                </div>
                <p className='ou-secret-weapon__note'>
                    Signal conditions stay on the source board. Save & Run starts #21 on the connected Demo or Real account
                    for the selected market, with no entry-point wait. It buys on the next normal bot cycle and continues
                    until you stop it or a saved risk limit is reached. Choose either trade direction; the bot stops after
                    the selected number of completed trades. Confirm your account and settings before starting.
                </p>

                <label className='ai-runcfg__field'>
                    <span>Trade direction</span>
                    <select
                        className='ai-runcfg__select'
                        value={side}
                        onChange={event => changeSide(event.target.value as 'OVER' | 'UNDER')}
                        disabled={loading}
                        data-testid='secret-weapon-side'
                    >
                        <option value='OVER'>Over</option>
                        <option value='UNDER'>Under</option>
                    </select>
                </label>
                <label className='ai-runcfg__field'>
                    <span>{side} barrier digit</span>
                    <select
                        className='ai-runcfg__select'
                        value={barrier}
                        onChange={event => setBarrier(Number(event.target.value))}
                        disabled={loading}
                        data-testid='secret-weapon-barrier'
                    >
                        {barriers.map(value => <option key={value} value={value}>{side} {value}</option>)}
                    </select>
                </label>

                <label className='ai-runcfg__field'>
                    <span>Stake ($)</span>
                    <input type='number' min='0.01' step='0.01' value={stake} onChange={event => setStake(event.target.value)} disabled={loading} />
                </label>
                <label className='ai-runcfg__field'>
                    <span>Take Profit ($)</span>
                    <input type='number' min='0.01' step='0.01' value={takeProfit} onChange={event => setTakeProfit(event.target.value)} disabled={loading} />
                </label>
                <label className='ai-runcfg__field'>
                    <span>Stop Loss ($)</span>
                    <input type='number' min='0.01' step='0.01' value={stopLoss} onChange={event => setStopLoss(event.target.value)} disabled={loading} />
                </label>
                <label className='ai-runcfg__field'>
                    <span>Martingale multiplier</span>
                    <input type='number' min='1' step='0.1' value={martingale} onChange={event => setMartingale(event.target.value)} disabled={loading} />
                </label>
                <label className='ai-runcfg__field'>
                    <span>Maximum trades</span>
                    <input
                        type='number'
                        min='1'
                        max='10000'
                        step='1'
                        value={maxTrades}
                        onChange={event => setMaxTrades(event.target.value)}
                        disabled={loading}
                        data-testid='secret-weapon-max-trades'
                    />
                </label>

                {error && <div className='ai-panel__run-err' role='alert'>{error}</div>}
                <button
                    type='button'
                    className='ai-runcfg__execute'
                    disabled={loading}
                    onClick={submit}
                    data-testid='secret-weapon-save'
                >
                    {loading ? 'Saving settings and starting #21…' : 'Save & Run #21 now'}
                </button>
            </section>
        </div>
    );
}

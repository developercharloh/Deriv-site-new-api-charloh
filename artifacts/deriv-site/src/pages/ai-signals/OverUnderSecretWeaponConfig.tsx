import React, { useState } from 'react';
import { X } from '@/utils/lucide-shim';
import type { OverUnderSignalSelection } from './over-under-signal-board';

export interface SecretWeaponRunSettings {
    barrier: number;
    stake: number;
    takeProfit: number;
    stopLoss: number;
    martingale: number;
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

function savedSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        return {
            stake: typeof saved?.stake === 'string' ? saved.stake : '0.35',
            takeProfit: typeof saved?.takeProfit === 'string' ? saved.takeProfit : '15',
            stopLoss: typeof saved?.stopLoss === 'string' ? saved.stopLoss : '50',
            martingale: typeof saved?.martingale === 'string' ? saved.martingale : '2',
            barrier: Number.isInteger(Number(saved?.barrier)) ? Number(saved.barrier) : undefined,
        };
    } catch {
        return { stake: '0.35', takeProfit: '15', stopLoss: '50', martingale: '2', barrier: undefined };
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
    const barriers = selection.setup.side === 'OVER' ? OVER_BARRIERS : UNDER_BARRIERS;
    const [barrier, setBarrier] = useState(
        initial.barrier !== undefined && barriers.includes(initial.barrier)
            ? initial.barrier
            : selection.setup.barrier,
    );
    const [stake, setStake] = useState(initial.stake);
    const [takeProfit, setTakeProfit] = useState(initial.takeProfit);
    const [stopLoss, setStopLoss] = useState(initial.stopLoss);
    const [martingale, setMartingale] = useState(initial.martingale);

    const submit = () => onSave({
        barrier,
        stake: Number(stake),
        takeProfit: Number(takeProfit),
        stopLoss: Number(stopLoss),
        martingale: Number(martingale),
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
                    Signal conditions stay on the source board. This bot uses the saved market and contract and has no
                    entry-point wait: after you press Run, it buys immediately on its normal bot cycle and continues
                    until you stop it or a saved risk limit is reached. It loads stopped in DBot Builder.
                </p>

                <label className='ai-runcfg__field'>
                    <span>{selection.setup.side} barrier digit</span>
                    <select
                        className='ai-runcfg__select'
                        value={barrier}
                        onChange={event => setBarrier(Number(event.target.value))}
                        disabled={loading}
                        data-testid='secret-weapon-barrier'
                    >
                        {barriers.map(value => <option key={value} value={value}>{selection.setup.side} {value}</option>)}
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

                {error && <div className='ai-panel__run-err' role='alert'>{error}</div>}
                <button
                    type='button'
                    className='ai-runcfg__execute'
                    disabled={loading}
                    onClick={submit}
                    data-testid='secret-weapon-save'
                >
                    {loading ? 'Saving #21 to DBot Builder…' : 'Save & Load #21 Stopped'}
                </button>
            </section>
        </div>
    );
}

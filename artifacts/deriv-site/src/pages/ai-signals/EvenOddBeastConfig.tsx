import React, { useState } from 'react';
import { X } from '@/utils/lucide-shim';
import type { EvenOddBeastSignalSelection } from './even-odd-beast-signal-board';

export interface EvenOddBeastRunSettings {
    stake: number;
    takeProfit: number;
    stopLoss: number;
    martingale: number;
    maxTrades: number;
}

interface Props {
    selection: EvenOddBeastSignalSelection;
    loading: boolean;
    error: string;
    onClose: () => void;
    onSave: (settings: EvenOddBeastRunSettings) => void;
}

const STORAGE_KEY = 'ai-signals-even-odd-beast-config';
const DEFAULT_SETTINGS = {
    stake: '0.7',
    takeProfit: '10',
    stopLoss: '50',
    martingale: '2',
    maxTrades: '50',
};

function loadSavedSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        return {
            stake: typeof saved?.stake === 'string' ? saved.stake : DEFAULT_SETTINGS.stake,
            takeProfit: typeof saved?.takeProfit === 'string' ? saved.takeProfit : DEFAULT_SETTINGS.takeProfit,
            stopLoss: typeof saved?.stopLoss === 'string' ? saved.stopLoss : DEFAULT_SETTINGS.stopLoss,
            martingale: typeof saved?.martingale === 'string' ? saved.martingale : DEFAULT_SETTINGS.martingale,
            maxTrades: typeof saved?.maxTrades === 'string' ? saved.maxTrades : DEFAULT_SETTINGS.maxTrades,
        };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

export function EvenOddBeastConfig({ selection, loading, error, onClose, onSave }: Props) {
    const [initial] = useState(loadSavedSettings);
    const [stake, setStake] = useState(initial.stake);
    const [takeProfit, setTakeProfit] = useState(initial.takeProfit);
    const [stopLoss, setStopLoss] = useState(initial.stopLoss);
    const [martingale, setMartingale] = useState(initial.martingale);
    const [maxTrades, setMaxTrades] = useState(initial.maxTrades);
    const [validationError, setValidationError] = useState('');

    const submit = () => {
        const settings = {
            stake: Number(stake),
            takeProfit: Number(takeProfit),
            stopLoss: Number(stopLoss),
            martingale: Number(martingale),
            maxTrades: Number(maxTrades),
        };
        if (
            Object.entries(settings)
                .filter(([key]) => key !== 'maxTrades')
                .some(([, value]) => !Number.isFinite(value) || value <= 0)
        ) {
            setValidationError('Stake, take profit, stop loss, and Martingale must be greater than zero.');
            return;
        }
        if (settings.martingale < 1) {
            setValidationError('Martingale must be at least 1×.');
            return;
        }
        if (!Number.isInteger(settings.maxTrades) || settings.maxTrades < 1 || settings.maxTrades > 10000) {
            setValidationError('Maximum trades must be a whole number from 1 to 10,000.');
            return;
        }
        setValidationError('');
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                stake,
                takeProfit,
                stopLoss,
                martingale,
                maxTrades,
            }));
        } catch { /* preferences are optional */ }
        onSave(settings);
    };

    return (
        <div
            className='ai-runcfg__overlay'
            data-testid='even-odd-beast-config-overlay'
            onClick={() => { if (!loading) onClose(); }}
        >
            <section
                className='ai-runcfg ai-runcfg--secret-weapon'
                role='dialog'
                aria-modal='true'
                aria-labelledby='even-odd-beast-config-title'
                onClick={event => event.stopPropagation()}
            >
                <header className='ai-runcfg__header'>
                    <span id='even-odd-beast-config-title'>Configure Even Odd Beast</span>
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
                    Signal side: <strong>{selection.side}</strong>
                    <br />
                    Market: <strong>{selection.symbol.label} ({selection.symbol.code})</strong>
                </div>
                <p className='ou-secret-weapon__note'>
                    The signal supplies the market and side. Even Odd Beast waits for its internal entry trigger,
                    then repeats the selected side while that setup remains active. Take profit and stop loss stop the run.
                </p>

                {([
                    { label: 'Stake ($)', key: 'stake' as const, min: '0.01', max: undefined, step: '0.01' },
                    { label: 'Take Profit ($)', key: 'takeProfit' as const, min: '0.01', max: undefined, step: '0.5' },
                    { label: 'Stop Loss ($)', key: 'stopLoss' as const, min: '0.01', max: undefined, step: '0.5' },
                    { label: 'Martingale multiplier (×)', key: 'martingale' as const, min: '1', max: undefined, step: '0.1' },
                    { label: 'Maximum trades', key: 'maxTrades' as const, min: '1', max: '10000', step: '1' },
                ]).map(field => (
                    <label key={field.key} className='ai-runcfg__field'>
                        <span>{field.label}</span>
                        <input
                            type='number'
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            value={{ stake, takeProfit, stopLoss, martingale, maxTrades }[field.key]}
                            onChange={event => {
                                const value = event.target.value;
                                if (field.key === 'stake') setStake(value);
                                else if (field.key === 'takeProfit') setTakeProfit(value);
                                else if (field.key === 'stopLoss') setStopLoss(value);
                                else if (field.key === 'martingale') setMartingale(value);
                                else setMaxTrades(value);
                            }}
                            disabled={loading}
                            data-testid={`even-odd-beast-${field.key}`}
                        />
                    </label>
                ))}
                <p className='ou-secret-weapon__note'>The bot stops after this many completed trades.</p>

                {(error || validationError) && (
                    <div className='ai-panel__run-err' role='alert'>{error || validationError}</div>
                )}
                <button
                    type='button'
                    className='ai-runcfg__execute'
                    disabled={loading}
                    onClick={submit}
                    data-testid='even-odd-beast-save-run'
                >
                    {loading ? 'Saving settings and starting…' : 'Save and Run Even Odd Beast'}
                </button>
            </section>
        </div>
    );
}

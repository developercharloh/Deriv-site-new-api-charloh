import React, { useState } from 'react';
import { X } from '@/utils/lucide-shim';
import type { MatchesKingSignalSelection } from './matches-signal-board';
import './matches-king-config.scss';

export interface MatchesKingRunSettings {
    stake: number;
    takeProfit: number;
    stopLoss: number;
    martingale: number;
    digitCount: number;
    digits: number[];
    useVirtualHook: boolean;
    virtualLossThreshold: number;
}

interface Props {
    selection: MatchesKingSignalSelection;
    loading: boolean;
    error: string;
    onClose: () => void;
    onSave: (settings: MatchesKingRunSettings) => void;
}

const STORAGE_KEY = 'ai-signals-matches-king-config';
const DEFAULTS = {
    stake: '0.5',
    takeProfit: '10',
    stopLoss: '30',
    martingale: '2',
    useVirtualHook: true,
    virtualLossThreshold: '2',
};

export function digitsForMatchesKingCount(count: number, setup: MatchesKingSignalSelection['setup']): number[] {
    const start = setup === 'tsi' ? 0 : 6;
    const rangeSize = setup === 'tsi' ? 5 : 4;
    const safeCount = Number.isFinite(count)
        ? Math.max(1, Math.min(rangeSize, Math.floor(count)))
        : 1;
    return Array.from({ length: safeCount }, (_, index) => start + index);
}

function loadSettings(defaultDigitCount: number) {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        return {
            stake: typeof saved?.stake === 'string' ? saved.stake : DEFAULTS.stake,
            takeProfit: typeof saved?.takeProfit === 'string' ? saved.takeProfit : DEFAULTS.takeProfit,
            stopLoss: typeof saved?.stopLoss === 'string' ? saved.stopLoss : DEFAULTS.stopLoss,
            martingale: typeof saved?.martingale === 'string' ? saved.martingale : DEFAULTS.martingale,
            digitCount: typeof saved?.digitCount === 'string' ? saved.digitCount : String(defaultDigitCount),
            useVirtualHook: typeof saved?.useVirtualHook === 'boolean'
                ? saved.useVirtualHook
                : DEFAULTS.useVirtualHook,
            virtualLossThreshold: typeof saved?.virtualLossThreshold === 'string'
                ? saved.virtualLossThreshold
                : DEFAULTS.virtualLossThreshold,
        };
    } catch {
        return { ...DEFAULTS, digitCount: String(defaultDigitCount) };
    }
}

export function MatchesKingConfig({ selection, loading, error, onClose, onSave }: Props) {
    const maxDigitCount = selection.setup === 'tsi' ? 5 : 4;
    const [initial] = useState(() => loadSettings(maxDigitCount));
    const [stake, setStake] = useState(initial.stake);
    const [takeProfit, setTakeProfit] = useState(initial.takeProfit);
    const [stopLoss, setStopLoss] = useState(initial.stopLoss);
    const [martingale, setMartingale] = useState(initial.martingale);
    const savedDigitCount = Number(initial.digitCount);
    const [digitCount, setDigitCount] = useState(
        String(Number.isInteger(savedDigitCount) ? Math.max(1, Math.min(maxDigitCount, savedDigitCount)) : maxDigitCount)
    );
    const [useVirtualHook, setUseVirtualHook] = useState(initial.useVirtualHook);
    const [virtualLossThreshold, setVirtualLossThreshold] = useState(initial.virtualLossThreshold);
    const [validationError, setValidationError] = useState('');
    const count = Number(digitCount);
    const digits = Number.isInteger(count) && count >= 1 && count <= maxDigitCount
        ? digitsForMatchesKingCount(count, selection.setup)
        : [];

    const submit = () => {
        const settings: MatchesKingRunSettings = {
            stake: Number(stake),
            takeProfit: Number(takeProfit),
            stopLoss: Number(stopLoss),
            martingale: Number(martingale),
            digitCount: count,
            digits,
            useVirtualHook,
            virtualLossThreshold: Number(virtualLossThreshold),
        };
        if (
            !Number.isFinite(settings.stake) || settings.stake < 0.35 ||
            !Number.isFinite(settings.takeProfit) || settings.takeProfit <= 0 ||
            !Number.isFinite(settings.stopLoss) || settings.stopLoss <= 0
        ) {
            setValidationError('Stake must be at least $0.35; take profit and stop loss must be greater than zero.');
            return;
        }
        if (!Number.isFinite(settings.martingale) || settings.martingale < 1) {
            setValidationError('Martingale must be at least 1×.');
            return;
        }
        if (!Number.isInteger(count) || count < 1 || count > maxDigitCount) {
            setValidationError(`Choose between 1 and ${maxDigitCount} match digits for this setup.`);
            return;
        }
        if (useVirtualHook && (
            !Number.isInteger(settings.virtualLossThreshold) ||
            settings.virtualLossThreshold < 1 ||
            settings.virtualLossThreshold > 100
        )) {
            setValidationError('Virtual Hook loss threshold must be between 1 and 100.');
            return;
        }

        setValidationError('');
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                stake,
                takeProfit,
                stopLoss,
                martingale,
                digitCount,
                useVirtualHook,
                virtualLossThreshold,
            }));
        } catch { /* saved preferences are optional */ }
        onSave(settings);
    };

    return (
        <div
            className='ai-runcfg__overlay mk-config__overlay'
            data-testid='matches-king-config-overlay'
            onClick={() => { if (!loading) onClose(); }}
        >
            <section
                className='ai-runcfg ai-runcfg--secret-weapon mk-config'
                role='dialog'
                aria-modal='true'
                aria-labelledby='matches-king-config-title'
                onClick={event => event.stopPropagation()}
            >
                <header className='ai-runcfg__header'>
                    <span id='matches-king-config-title'>Configure Bot #19 — Matches King</span>
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
                    Setup: <strong>{selection.setup === 'tsi' ? 'TSI · Matches 0–4' : 'MACD · Matches 6–9'}</strong>
                    <br />
                    Market: <strong>{selection.symbol.label} ({selection.symbol.code})</strong>
                </div>
                <p className='mk-config__note'>
                    After you save and run, Matches King starts selecting entries from incoming live ticks. If
                    Virtual Hook is on, its configured all-loss batches happen before real contracts are bought.
                </p>

                <div className='mk-config__grid'>
                    <label className='ai-runcfg__field'>
                        <span>Stake per digit ($)</span>
                        <input type='number' min='0.35' step='0.01' value={stake} onChange={event => setStake(event.target.value)} disabled={loading} />
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
                        <span>Martingale multiplier (×)</span>
                        <input type='number' min='1' step='0.1' value={martingale} onChange={event => setMartingale(event.target.value)} disabled={loading} />
                    </label>
                </div>

                <label className='ai-runcfg__field'>
                    <span>Number of digits to match</span>
                    <select
                        className='ai-runcfg__select'
                        value={digitCount}
                        onChange={event => setDigitCount(event.target.value)}
                        disabled={loading}
                        data-testid='matches-king-digit-count'
                    >
                        {Array.from({ length: maxDigitCount }, (_, index) => index + 1).map(value => (
                            <option key={value} value={value}>{value}</option>
                        ))}
                    </select>
                </label>
                <div className='mk-config__digit-preview' aria-live='polite' data-testid='matches-king-digit-preview'>
                    <span>Auto-filled digits from this setup</span>
                    <div>{digits.length ? digits.map(digit => <b key={digit}>{digit}</b>) : <em>Choose 1–10 digits</em>}</div>
                </div>

                <label className='mk-config__hook-toggle'>
                    <input
                        type='checkbox'
                        checked={useVirtualHook}
                        onChange={event => setUseVirtualHook(event.target.checked)}
                        disabled={loading}
                        data-testid='matches-king-use-virtual-hook'
                    />
                    <span>Use Virtual Hook</span>
                </label>
                {useVirtualHook && (
                    <label className='ai-runcfg__field'>
                        <span>Start real buys after consecutive all-loss batches</span>
                        <input
                            type='number'
                            min='1'
                            max='100'
                            step='1'
                            value={virtualLossThreshold}
                            onChange={event => setVirtualLossThreshold(event.target.value)}
                            disabled={loading}
                            data-testid='matches-king-virtual-loss-threshold'
                        />
                    </label>
                )}

                {(error || validationError) && <div className='ai-panel__run-err' role='alert'>{error || validationError}</div>}
                <button
                    type='button'
                    className='ai-runcfg__execute'
                    disabled={loading}
                    onClick={submit}
                    data-testid='matches-king-save-run'
                >
                    {loading ? 'Saving settings and starting #19…' : 'Save & Run #19 now'}
                </button>
            </section>
        </div>
    );
}

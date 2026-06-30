import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { parseDigitFrom, fetchAndPatchBot, type BotSignal } from '@/utils/bot-patch';
import { parseXmlV2Config } from '@/utils/xml-v2-parser';
import type { BotConfig } from './types';
import './free-bots.scss';

const V2_CONFIG_KEY = 'free_bots_v2_config';

// ─── Types ────────────────────────────────────────────────────────────────────

type BotStatus = 'idle' | 'loading' | 'loaded' | 'error';
type EngineMode = 'v1' | 'v2';
type LiveSignal = BotSignal;

interface SignalSettings {
    stake:      string;
    takeProfit: string;
    stopLoss:   string;
    martingale: string;
}

// ─── Signal helpers ───────────────────────────────────────────────────────────

const SIGNAL_TTL = 5 * 60 * 1000;

function readSignal(key: string): LiveSignal | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const sig = JSON.parse(raw) as LiveSignal;
        if (Date.now() - sig.savedAt > SIGNAL_TTL) return null;
        return sig;
    } catch { return null; }
}

function useSignal(key: string | undefined): LiveSignal | null {
    const [signal, setSignal] = useState<LiveSignal | null>(() => key ? readSignal(key) : null);

    useEffect(() => {
        if (!key) return;
        const refresh = () => setSignal(readSignal(key));
        window.addEventListener('fb_signal_update', refresh);
        window.addEventListener('storage', refresh);
        const interval = setInterval(refresh, 15_000);
        return () => {
            window.removeEventListener('fb_signal_update', refresh);
            window.removeEventListener('storage', refresh);
            clearInterval(interval);
        };
    }, [key]);

    return signal;
}

function confColor(conf: number): string {
    return conf >= 70 ? '#10b981' : conf >= 60 ? '#eab308' : '#ef4444';
}

// ─── BOTS config ──────────────────────────────────────────────────────────────

const BOTS: BotConfig[] = [
    {
        id: 'rise-fall-master',
        name: 'Rise / Fall Master Bot',
        emoji: '📈📉',
        description:
            'Trades Rise/Fall on Volatility 100 (1s) Index. Starts on Rise — wins keep the same direction and reset stake; losses flip to the opposite direction and apply Martingale. Stops automatically on Take Profit or Stop Loss.',
        market: 'Volatility 100 (1s) Index (1HZ100V)',
        strategy: 'Rise / Fall · Direction Flip on Loss · Martingale',
        params: [
            { label: 'Initial Direction', value: 'Rise (CALL)' },
            { label: 'Initial Stake', value: '$0.35' },
            { label: 'Take Profit', value: '$10' },
            { label: 'Stop Loss', value: '$10' },
            { label: 'Martingale', value: '2×' },
            { label: 'Duration', value: '1 Tick' },
        ],
        xmlPath: '/bots/Rise_Fall_Master_Bot.xml',
        gradient: 'linear-gradient(135deg, #0a2a0a 0%, #1a5c1a 40%, #10b981 70%, #f59e0b 100%)',
    },
    {
        id: 'matches-signal',
        name: 'Matches Bot',
        emoji: '🎯',
        description:
            'Trades Digit Matches on Volatility 75 (1s) Index. Scans every tick — enters only when last digit equals entry point 4, then bets the digit matches exactly. Stops after 6 consecutive losses or Take Profit.',
        market: 'Volatility 75 (1s) Index (1HZ75V)',
        strategy: 'Digit Matches · Entry Point Scanner',
        params: [
            { label: 'Entry Point', value: 'Digit 4' },
            { label: 'Prediction', value: 'Digit 4' },
            { label: 'Stake', value: '$10' },
            { label: 'Take Profit', value: '$15' },
            { label: 'Max Losses', value: '6' },
        ],
        xmlPath: '/bots/Matches_Signal_Bot.xml',
        gradient: 'linear-gradient(135deg, #1a0533 0%, #3b0764 50%, #7c3aed 100%)',
        signalKey: 'fb_signal_matches',
    },
    {
        id: 'differ-v2',
        name: 'Differ V2 Bot',
        emoji: '🔀',
        description:
            'Trades Digit Differs on Volatility 100 Index. Waits for entry point digit 9, then bets the last digit will NOT be 9. Martingale recovery on losses with Take Profit and Stop Loss.',
        market: 'Volatility 100 Index (R_100)',
        strategy: 'Digit Differs · Martingale · Entry Point',
        params: [
            { label: 'Stake', value: '$1' },
            { label: 'Take Profit', value: '$1' },
            { label: 'Stop Loss', value: '$10' },
            { label: 'Martingale', value: '2.5×' },
            { label: 'Entry / Prediction', value: 'Digit 9' },
        ],
        xmlPath: '/bots/BINARYTOOL@_DIFFER_V2.0_(1)_(1)_1765711647662.xml',
        gradient: 'linear-gradient(135deg, #0c1a33 0%, #1e3a5f 50%, #2563eb 100%)',
        signalKey: 'fb_signal_differs',
    },
    {
        id: 'even-odd-scanner',
        name: 'Even Odd Entry Scanner Bot',
        emoji: '⚡',
        description:
            'Trades Digit Even/Odd on Volatility 100 Index. Scans every tick — enters only when last digit matches the signal entry point, then buys the direction (EVEN or ODD) from the signal. 10-level martingale recovery on losses.',
        market: 'Volatility 100 Index (R_100)',
        strategy: 'Digit Even / Odd · Signal Direction · Entry Point Scanner',
        params: [
            { label: 'Entry Point', value: 'Digit 0' },
            { label: 'Stake', value: '$0.55' },
            { label: 'Target Profit', value: '$10' },
            { label: 'Max Loss', value: '$100' },
        ],
        xmlPath: '/bots/BINARYTOOL@EVEN_ODD_THUNDER_AI_PRO_BOT_1765711647662.xml',
        gradient: 'linear-gradient(135deg, #1a1a0a 0%, #3d3d00 50%, #d4ac0d 100%)',
        signalKey: 'fb_signal_even_odd',
    },
    {
        id: 'over-under-signal',
        name: 'Over Under Bot',
        emoji: '📊',
        description:
            'Trades Digit Over/Under using live signal intelligence. Scans every tick — enters only when the last digit equals the signal barrier, then bets OVER or UNDER exactly as the signal directs. Martingale recovery on losses with Take Profit guard.',
        market: 'Signal-driven (any Volatility Index)',
        strategy: 'Digit Over / Under · Signal Direction · Entry Point Scanner',
        params: [
            { label: 'Entry Point', value: 'Barrier digit' },
            { label: 'Direction', value: 'OVER / UNDER (from signal)' },
            { label: 'Stake', value: '$0.5' },
            { label: 'Take Profit', value: '$10' },
            { label: 'Max Losses', value: '6' },
        ],
        xmlPath: '/bots/OverUnder_Signal_Bot.xml',
        gradient: 'linear-gradient(135deg, #0f1f3d 0%, #1a3a6b 50%, #6366f1 100%)',
        signalKey: 'fb_signal_over_under',
    },
    {
        id: 'over-destroyer',
        name: 'Over Destroyer Bot',
        emoji: '📈📉',
        description:
            'Trades Digit Over/Under on Volatility 50 Index. Alternates between Over and Under predictions with a Martingale recovery on losses. Stops automatically on Take Profit or Stop Loss.',
        market: 'Volatility 50 Index (1HZ50V)',
        strategy: 'Digit Over / Under · Martingale',
        params: [
            { label: 'Initial Stake', value: '$5.97' },
            { label: 'Take Profit', value: '$50' },
            { label: 'Stop Loss', value: '$15' },
            { label: 'Martingale', value: '1.5×' },
            { label: 'Over Prediction', value: '1' },
            { label: 'Under Prediction', value: '6' },
        ],
        xmlPath: '/bots/Over_Destroyer_Bot.xml',
        gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    },
    {
        id: 'under-destroyer',
        name: 'Under Destroyer Bot',
        emoji: '📈📉',
        description:
            'Trades Digit Over/Under on Volatility 50 Index. Opens Under on first trade, then switches to Over on a loss (Martingale recovery). Aggressive stop-loss protects the balance.',
        market: 'Volatility 50 Index (1HZ50V)',
        strategy: 'Digit Under / Over · Martingale',
        params: [
            { label: 'Initial Stake', value: '$2.97' },
            { label: 'Take Profit', value: '$5' },
            { label: 'Stop Loss', value: '$45' },
            { label: 'Martingale', value: '1.5×' },
            { label: 'Under Prediction', value: '8' },
            { label: 'Over Prediction', value: '4' },
        ],
        xmlPath: '/bots/Under_Destroyer_Bot.xml',
        gradient: 'linear-gradient(135deg, #0d3b2e 0%, #1a5c42 50%, #27ae60 100%)',
    },
    {
        id: 'elite-default-speed',
        name: 'Elite Default Speed Bot ⚡⚡🤖',
        emoji: '⚡',
        description:
            'Trades Digit Under on Volatility 10 (1s) Index at high speed — 1 tick per contract. On every win, resets stake back to the base. On every loss, increases stake by the contract loss amount (recovery mode). If total loss hits the Loss Limit ($60), resets stake to base immediately. Keeps trading until Target Profit ($60) is reached, then stops automatically.',
        market: 'Volatility 10 (1s) Index (1HZ10V)',
        strategy: 'Digit Under · Auto Loss Recovery · Speed Mode',
        params: [
            { label: 'Stake', value: '$5' },
            { label: 'Target Profit', value: '$60' },
            { label: 'Loss Limit (reset)', value: '$60' },
            { label: 'Duration', value: '1 Tick' },
            { label: 'Contract Type', value: 'Digit Under' },
        ],
        xmlPath: '/bots/Elite_Default_Speed_Bot.xml',
        gradient: 'linear-gradient(135deg, #00001a 0%, #001a4d 50%, #0066ff 100%)',
    },
    {
        id: 'even-odd-manual',
        name: 'Even Odd Manual Trading Bot',
        emoji: '🎲',
        description:
            'Manual entry-digit bot for Even/Odd. Set your Entry Digit (default 4). Bot scans every tick — only buys when last digit equals Entry Digit. If Entry Digit is even → buys EVEN, if odd → buys ODD. Repeats at every Entry Digit appearance until Take Profit or Stop Loss is hit.',
        market: 'Volatility 10 (1s) Index (1HZ10V)',
        strategy: 'Digit Even / Odd · Manual Entry Digit Lock · Martingale',
        params: [
            { label: 'Entry Digit', value: '4 (editable)' },
            { label: 'Direction', value: 'Auto (even→EVEN, odd→ODD)' },
            { label: 'Stake', value: '$1' },
            { label: 'Target Profit', value: '$10' },
            { label: 'Stop Loss', value: '$5' },
            { label: 'Martingale', value: '2× (toggleable)' },
            { label: 'Max Losses', value: '6' },
        ],
        xmlPath: '/bots/Even_Odd_Manual_Trading_Bot.xml',
        gradient: 'linear-gradient(135deg, #0d1a2e 0%, #1a3a5c 50%, #10b981 100%)',
    },
    {
        id: 'over-under-manual',
        name: 'Over Under Manual Trading Bot',
        emoji: '🎯',
        description:
            'Manual entry-digit bot for Over/Under. Set your Entry Digit (default 5). Bot scans every tick — only buys when last digit equals Entry Digit. If Entry Digit ≥5 → buys OVER 4, if ≤4 → buys UNDER 5. Repeats at every Entry Digit appearance until Take Profit or Stop Loss is hit.',
        market: 'Volatility 75 (1s) Index (1HZ75V)',
        strategy: 'Digit Over / Under · Manual Entry Digit Lock · Martingale',
        params: [
            { label: 'Entry Digit', value: '5 (editable)' },
            { label: 'Direction', value: 'Auto (≥5→OVER 4, ≤4→UNDER 5)' },
            { label: 'Stake', value: '$1' },
            { label: 'Target Profit', value: '$15' },
            { label: 'Stop Loss', value: '$50' },
            { label: 'Martingale', value: '2× (toggleable)' },
            { label: 'Max Losses', value: '6' },
        ],
        xmlPath: '/bots/Over_Under_Manual_Trading_Bot.xml',
        gradient: 'linear-gradient(135deg, #1a0a2e 0%, #3b1070 50%, #f59e0b 100%)',
    },
    {
        id: 'over-under-ai-signals',
        name: 'Over Under AI Signals Bot',
        emoji: '🤖',
        description:
            'Trades Digit Over/Under using live AI signal intelligence. Waits for the last digit to match your Entry Point, then fires Prediction 1 (primary direction from AI signal). On a loss, instantly switches to Prediction 2 — the OPPOSITE direction with AI-picked recovery barrier — no entry point wait needed. On win or recovery loss, resets back to Prediction 1. Stops on Take Profit or Stop Loss.',
        market: 'Signal-driven (any Volatility Index)',
        strategy: 'Digit Over / Under · AI Cross-Direction Recovery · Entry Point Scanner',
        params: [
            { label: 'Prediction 1', value: 'AI primary direction + barrier' },
            { label: 'Prediction 2', value: 'AI recovery — OPPOSITE direction' },
            { label: 'Entry Point', value: 'AI-picked digit to wait for' },
            { label: 'Stake', value: 'Set in signal panel' },
            { label: 'Take Profit', value: 'Set in signal panel' },
            { label: 'Stop Loss', value: 'Set in signal panel' },
            { label: 'Martingale', value: 'Applied on Prediction 1 loss' },
        ],
        xmlPath: '/bots/Over_Under_AI_Signals_Bot.xml',
        gradient: 'linear-gradient(135deg, #0a1628 0%, #1a3a6b 40%, #7c3aed 80%, #d4ac0d 100%)',
        signalKey: 'fb_signal_over_under',
    },
    {
        id: 'elite-entry-scanner',
        name: 'Elite Entry Scanner Bot 🔥🔥',
        emoji: '🔥',
        description:
            'Trades Digit Under on Volatility 10 (1s) Index. Scans every tick — enters only when the last digit equals Entry Point 7, then bets UNDER 9. On a win, reverts to prediction 9; on a loss, switches to prediction 6 with smart Martingale recovery (2.55× split). Resets stake to minimum $0.35 floor. Stops automatically on Take Profit ($100) or Stop Loss ($1000).',
        market: 'Volatility 10 (1s) Index (1HZ10V)',
        strategy: 'Digit Under · Entry Point Scanner · Adaptive Martingale',
        params: [
            { label: 'Entry Point', value: 'Digit 7' },
            { label: 'Prediction (normal)', value: 'Under 9' },
            { label: 'Prediction (after loss)', value: 'Under 6' },
            { label: 'Stake', value: '$1' },
            { label: 'Take Profit', value: '$100' },
            { label: 'Stop Loss', value: '$1000' },
            { label: 'Martingale Split', value: '2.55×' },
            { label: 'Min Stake Floor', value: '$0.35' },
        ],
        xmlPath: '/bots/Elite_Entry_Scanner_Bot.xml',
        gradient: 'linear-gradient(135deg, #1a0800 0%, #5c1a00 50%, #ff6b00 100%)',
    },
];

// ─── Engine selector dropdown ─────────────────────────────────────────────────

const ENGINE_KEY = 'free_bots_engine_mode';

const EngineSelector: React.FC<{
    mode:    EngineMode;
    onChange: (m: EngineMode) => void;
}> = ({ mode, onChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const labels: Record<EngineMode, string> = {
        v1: '⚙️ Classic V1',
        v2: '⚡ Advanced V2',
    };

    return (
        <div className='fb-engine-selector' ref={ref}>
            <button
                className={`fb-engine-selector__btn fb-engine-selector__btn--${mode}`}
                onClick={() => setOpen(p => !p)}
            >
                <span>{labels[mode]}</span>
                <span className='fb-engine-selector__arrow'>{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div className='fb-engine-selector__dropdown'>
                    <button
                        className={`fb-engine-selector__option ${mode === 'v1' ? 'fb-engine-selector__option--active' : ''}`}
                        onClick={() => { onChange('v1'); setOpen(false); }}
                    >
                        <div className='fb-engine-selector__opt-title'>⚙️ Classic V1 — DBot</div>
                        <div className='fb-engine-selector__opt-desc'>Loads bot into Deriv's standard DBot engine</div>
                    </button>
                    <button
                        className={`fb-engine-selector__option ${mode === 'v2' ? 'fb-engine-selector__option--active' : ''}`}
                        onClick={() => { onChange('v2'); setOpen(false); }}
                    >
                        <div className='fb-engine-selector__opt-title'>⚡ Advanced V2 — Direct</div>
                        <div className='fb-engine-selector__opt-desc'>Connects directly to Deriv API — zero-overhead execution</div>
                    </button>
                </div>
            )}
        </div>
    );
};

// ─── Signal Trade Modal ───────────────────────────────────────────────────────

const SignalTradeModal: React.FC<{
    botId:      string;
    xmlPath:    string;
    signal:     LiveSignal;
    engineMode: EngineMode;
    onClose:    () => void;
}> = ({ botId, xmlPath, signal, engineMode, onClose }) => {
    const store      = useStore();
    const storageKey = `fb_cfg_${botId}`;

    const [cfg, setCfg] = useState<SignalSettings>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) return JSON.parse(raw) as SignalSettings;
        } catch { /* ignore */ }
        return { stake: '0.5', takeProfit: '10', stopLoss: '30', martingale: '2' };
    });

    const [state,  setState]  = useState<'idle' | 'launching' | 'no-ws' | 'error'>('idle');
    const [errMsg, setErrMsg] = useState('');

    async function handleRun() {
        localStorage.setItem(storageKey, JSON.stringify(cfg));
        setState('launching');
        setErrMsg('');
        try {
            const stake      = parseFloat(cfg.stake)      || 0.5;
            const takeProfit = parseFloat(cfg.takeProfit) || 10;
            const stopLoss   = parseFloat(cfg.stopLoss)   || 30;
            const martingale = parseFloat(cfg.martingale) || 2;

            // Fetch and patch the bot XML with the signal settings
            const doc    = await fetchAndPatchBot(botId, signal, stake, takeProfit, stopLoss, martingale);
            const xmlStr = new XMLSerializer().serializeToString(doc.documentElement);

            if (engineMode === 'v2') {
                // Fix #1: V2 path — parse config, persist, fire autostart. Never touch Blockly.
                const v2Cfg    = parseXmlV2Config(xmlStr);
                const v2CfgStr = JSON.stringify(v2Cfg);
                localStorage.setItem(V2_CONFIG_KEY, v2CfgStr);
                window.dispatchEvent(new StorageEvent('storage', { key: V2_CONFIG_KEY, newValue: v2CfgStr }));
                onClose();
                setTimeout(() => window.dispatchEvent(new CustomEvent('deriv-v2-autostart')), 400);
                return;
            }

            // V1 path — load into Blockly workspace and auto-run
            const Blockly = (window as any).Blockly;
            if (!Blockly?.derivWorkspace) { setState('no-ws'); return; }

            const dom = Blockly.utils.xml.textToDom(xmlStr);
            Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
            Blockly.derivWorkspace.cleanUp();
            Blockly.derivWorkspace.clearUndo();

            store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            onClose();

            setTimeout(() => {
                if (!store.run_panel.is_running) store.run_panel.onRunButtonClick();
            }, 500);
        } catch (e: any) {
            setState('error');
            setErrMsg(e?.message || 'Failed to launch bot.');
        }
    }

    const cc = confColor(signal.confidence);
    const injectedSymbol = signal.symbolLabel.replace('Volatility ', 'V').replace(' Index', '').replace(' (1s)', 's');
    const injectedDigit  = botId === 'even-odd-scanner'
        ? parseDigitFrom(signal.entryPoint)
        : parseDigitFrom(signal.direction);

    return (
        <div className='fb-modal-overlay' onClick={onClose}>
            <div className='fb-modal' onClick={e => e.stopPropagation()}>
                <div className='fb-modal__header'>
                    <div className='fb-modal__signal-info'>
                        <span className='fb-modal__direction'>{signal.direction}</span>
                        <span className='fb-modal__sym'>{signal.symbolLabel}</span>
                        <span className='fb-modal__entry'>{signal.entryPoint}</span>
                        <span className='fb-modal__conf' style={{ color: cc }}>{signal.confidence}% confidence</span>
                    </div>
                    <button className='fb-modal__close' onClick={onClose}>✕</button>
                </div>

                {engineMode === 'v2' && (
                    <div className='fb-modal__v2-badge'>⚡ V2 Engine — runs directly, results in V2 Panel</div>
                )}

                <div className='fb-modal__wire-summary'>
                    <span className='fb-modal__wire-item'>📡 Market: <strong>{injectedSymbol}</strong></span>
                    <span className='fb-modal__wire-item'>🎯 Entry: <strong>Digit {injectedDigit}</strong></span>
                    <span className='fb-modal__wire-item'>⬇️ Will scan ticks until entry digit appears, then trade</span>
                </div>

                <div className='fb-modal__fields'>
                    {([
                        { label: 'Stake ($)',       key: 'stake'      as const, step: '0.01' },
                        { label: 'Take Profit ($)', key: 'takeProfit' as const, step: '0.5'  },
                        { label: 'Stop Loss ($)',   key: 'stopLoss'   as const, step: '0.5'  },
                        { label: 'Martingale (×)',  key: 'martingale' as const, step: '0.1'  },
                    ]).map(f => (
                        <div key={f.key} className='fb-modal__field'>
                            <label>{f.label}</label>
                            <input
                                type='number' step={f.step} min='0'
                                value={cfg[f.key]}
                                onChange={e => setCfg(c => ({ ...c, [f.key]: e.target.value }))}
                                disabled={state === 'launching'}
                            />
                        </div>
                    ))}
                </div>

                {state === 'no-ws' && (
                    <div className='fb-modal__warn'>
                        ⚠️ Open the <strong>Bot Builder</strong> tab once to initialise the workspace, then try again.
                        <button onClick={() => setState('idle')}>OK</button>
                    </div>
                )}
                {state === 'error' && (
                    <div className='fb-modal__error'>{errMsg} <button onClick={() => setState('idle')}>Retry</button></div>
                )}

                <div className='fb-modal__footer'>
                    <button className='fb-modal__btn fb-modal__btn--cancel' onClick={onClose} disabled={state === 'launching'}>Cancel</button>
                    <button className='fb-modal__btn fb-modal__btn--run' onClick={handleRun} disabled={state === 'launching'}>
                        {state === 'launching' ? '⏳ Launching…' : engineMode === 'v2' ? '⚡ Launch V2' : '🚀 Load Signal & Run'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Signal Badge ─────────────────────────────────────────────────────────────

const SignalBadge: React.FC<{ signal: LiveSignal; onClick: () => void }> = ({ signal, onClick }) => {
    const cc = confColor(signal.confidence);
    return (
        <div className='fb-signal-badge' onClick={onClick} title='Live signal — click to wire it to this bot'>
            <span className='fb-signal-badge__dot' style={{ background: cc }} />
            <span className='fb-signal-badge__dir'>{signal.direction}</span>
            <span className='fb-signal-badge__sym'>{signal.symbolLabel.replace('Volatility ', 'V').replace(' Index', '')}</span>
            <span className='fb-signal-badge__conf' style={{ color: cc }}>{signal.confidence}%</span>
            <span className='fb-signal-badge__cta'>Load Signal →</span>
        </div>
    );
};

// ─── Post-load field re-application ──────────────────────────────────────────
// ROOT CAUSE: DURATIONTYPE_LIST and PURCHASE_LIST in DBot Blockly both start
// with options:[['','']] (empty). They are populated ASYNCHRONOUSLY by the
// Deriv API. When XML loads and calls setFieldValue('t') or setFieldValue('CALL'),
// Blockly rejects these values (not in the empty options list). The API cascade
// later sets its own defaults (often wrong). This function waits for the API to
// populate the options, then force-applies the correct XML values.
async function postLoadReapplyFields(botId: string, ws: any): Promise<void> {
    if (botId !== 'rise-fall-master') return;

    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const getDurBlock = (): any =>
        ws.getAllBlocks(true).find((b: any) => b.type === 'trade_definition_tradeoptions');

    const durOptionsReady = (): boolean => {
        const opts: any[][] = getDurBlock()?.getField('DURATIONTYPE_LIST')?.menuGenerator_ ?? [];
        return opts.length > 0 && opts[0][1] !== '';
    };

    // Helper: apply all the critical field values
    const applyFields = () => {
        // Duration = Ticks ('t')
        getDurBlock()?.setFieldValue('t', 'DURATIONTYPE_LIST');

        // Purchase = Rise (CALL) and Fall (PUT)
        // Re-trigger populatePurchaseList first so the dropdown options are built
        // from the current trade type (callput → Rise/Fall options), then set values.
        (ws.getAllBlocks(true) as any[])
            .filter((b: any) => b.type === 'purchase')
            .forEach((pb: any) => pb.populatePurchaseList?.({ group: 'reapply' }));

        // Small tick to let populatePurchaseList resolve synchronously
        ws.getBlockById('bp_call')?.setFieldValue('CALL', 'PURCHASE_LIST');
        ws.getBlockById('bp_put')?.setFieldValue('PUT',  'PURCHASE_LIST');
    };

    // Phase 1 — wait for Deriv API to populate DURATIONTYPE_LIST (up to 15 s).
    // Nudge updateDurationInput on each poll in case the API is ready but hasn't
    // been triggered yet (e.g. the initial load event bailed out because
    // ApiHelpers.instance was null at that moment).
    const POLL_MS = 300;
    let ready = false;
    for (let i = 0; i < 50; i++) {
        if (durOptionsReady()) { ready = true; break; }
        getDurBlock()?.updateDurationInput?.(false, false);
        await delay(POLL_MS);
    }
    if (!ready) return;

    // Apply immediately once the API cascade has populated options
    applyFields();

    // Phase 2 — apply again after 3 s to override any async getDurations()
    // re-sets that were triggered by the SYMBOL_LIST or TRADETYPE_LIST cascade
    // firing after our initial applyFields() call.
    await delay(3000);
    if (durOptionsReady()) applyFields();
}

// ─── Bot Card ─────────────────────────────────────────────────────────────────

const BotCard: React.FC<{ bot: BotConfig; engineMode: EngineMode }> = observer(({ bot, engineMode }) => {
    const store = useStore();
    const [status,     setStatus]     = useState<BotStatus>('idle');
    const [errorMsg,   setErrorMsg]   = useState('');
    const [showSignal, setShowSignal] = useState(false);

    const signal = useSignal(bot.signalKey);

    const loadBot = async () => {
        if (!store) return;
        const { dashboard } = store;
        setStatus('loading');
        setErrorMsg('');
        try {
            const res = await fetch(bot.xmlPath);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const xmlText = await res.text();

            if (engineMode === 'v2') {
                // Fix #2 & #5: V2 path — parse config, persist, fire autostart.
                // Do NOT load into Blockly — that arms DBot's engine and causes V1 to fire.
                const v2Cfg    = parseXmlV2Config(xmlText);
                const v2CfgStr = JSON.stringify(v2Cfg);
                localStorage.setItem(V2_CONFIG_KEY, v2CfgStr);
                window.dispatchEvent(new StorageEvent('storage', { key: V2_CONFIG_KEY, newValue: v2CfgStr }));
                setStatus('loaded');
                dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
                setTimeout(() => window.dispatchEvent(new CustomEvent('deriv-v2-autostart')), 400);
                return;
            }

            // V1 path — navigate to Bot Builder FIRST so the workspace mounts and
            // the Deriv API connects before we load the XML.
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

            // Poll for Blockly.derivWorkspace (workspace mounts asynchronously)
            const waitForWs = async (): Promise<any> => {
                for (let i = 0; i < 50; i++) {
                    const B = (window as any).Blockly;
                    if (B?.derivWorkspace) return B;
                    await new Promise(r => setTimeout(r, 100));
                }
                return null;
            };
            const Blockly = await waitForWs();
            if (!Blockly?.derivWorkspace) {
                throw new Error('Bot Builder workspace not ready — please open the Bot Builder tab once, then try again.');
            }

            const dom = Blockly.utils.xml.textToDom(xmlText);
            Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
            Blockly.derivWorkspace.cleanUp();
            Blockly.derivWorkspace.clearUndo();

            setStatus('loaded');

            // ROOT CAUSE FIX — blank duration/purchase dropdowns:
            void postLoadReapplyFields(bot.id, Blockly.derivWorkspace);
        } catch (err: any) {
            setStatus('error');
            setErrorMsg(err?.message || 'Failed to load bot.');
        }
    };

    const isV2Mode = engineMode === 'v2';

    return (
        <>
            <div className='free-bots__card'>
                <div className='free-bots__card-header' style={{ background: bot.gradient }}>
                    <span className='free-bots__card-emoji'>{bot.emoji}</span>
                    <div className='free-bots__card-header-text'>
                        <h2 className='free-bots__card-name'>{bot.name}</h2>
                        <span className='free-bots__card-strategy'>{bot.strategy}</span>
                    </div>
                </div>

                <div className='free-bots__card-body'>
                    <p className='free-bots__card-desc'>{bot.description}</p>

                    {signal && (
                        <SignalBadge signal={signal} onClick={() => setShowSignal(true)} />
                    )}

                    {status === 'error' && (
                        <div className='free-bots__card-error'>{errorMsg}</div>
                    )}

                    <div className='free-bots__card-actions'>
                        {/* V2 mode: same Load-into-builder flow, also saves parsed config */}
                        {isV2Mode && (
                            <button
                                className={`free-bots__card-btn free-bots__card-btn--v2 ${status === 'loading' ? 'free-bots__card-btn--busy' : ''}`}
                                onClick={loadBot}
                                disabled={status === 'loading'}
                            >
                                {status === 'loading' ? '⏳ Loading…' : status === 'loaded' ? '✅ Loaded — Run V2 in Builder' : '⚡ V2 Load'}
                            </button>
                        )}

                        {/* V1 mode: normal Load Bot button */}
                        {engineMode !== 'v2' && (
                            <button
                                className={`free-bots__card-btn free-bots__card-btn--load ${status === 'loading' ? 'free-bots__card-btn--busy' : ''}`}
                                onClick={loadBot}
                                disabled={status === 'loading'}
                            >
                                {status === 'loading' ? '⏳ Loading…' : status === 'loaded' ? '✅ Loaded' : '📂 Load Bot'}
                            </button>
                        )}

                        {signal && engineMode !== 'v2' && (
                            <button
                                className='free-bots__card-btn free-bots__card-btn--signal'
                                onClick={() => setShowSignal(true)}
                            >
                                ⚡ Trade Signal
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Signal modal — V1 and V2 aware */}
            {showSignal && signal && (
                <SignalTradeModal
                    botId={bot.id}
                    xmlPath={bot.xmlPath}
                    signal={signal}
                    engineMode={engineMode}
                    onClose={() => setShowSignal(false)}
                />
            )}

        </>
    );
});

// ─── Page ─────────────────────────────────────────────────────────────────────

const FreeBots = observer(() => {
    const engineMode: EngineMode = 'v1';

    return (
        <div className='free-bots'>
            <div className='free-bots__grid'>
                {BOTS.map(bot => (
                    <BotCard key={bot.id} bot={bot} engineMode={engineMode} />
                ))}
            </div>

            <div className='free-bots__footer'>
                <p>All bots are provided for educational purposes. Always test with a demo account first.</p>
            </div>
        </div>
    );
});

export default FreeBots;

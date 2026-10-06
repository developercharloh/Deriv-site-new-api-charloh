import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { DBot } from '@/external/bot-skeleton';
import { scheduleWorkspaceReveal } from '@/external/bot-skeleton/scratch/utils';
import {
    acquireBlocklyXmlImportGuard,
    BLOCKLY_XML_IMPORT_SETTLE_MS,
} from '@/external/bot-skeleton/utils/blockly-xml-import-guard';
import ApiHelpers from '@/external/bot-skeleton/services/api/api-helpers';
import { parseDigitFrom, fetchAndPatchBot, loadPatchedBotIntoWorkspace, type BotSignal } from '@/utils/bot-patch';
import { parseXmlV2Config } from '@/utils/xml-v2-parser';
import { setWorkspaceBotTemplateIdentity } from '@/utils/bot-template-scope';
import type { BotConfig, FreeBotSection } from './types';
import { isBotBuilderWorkspaceReady } from './workspace-readiness';
import FreeBotCategoryTabs from './FreeBotCategoryTabs';
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

const openBotBuilderTab = (dashboard: { setActiveTab: (tab: number) => void }) => {
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = 'bot_builder';
    window.history.replaceState(window.history.state, '', nextUrl.toString());
    dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
};

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
        id: 'binary-matrix-ai',
        section: 'premium',
        name: 'Binary Matrix AI',
        emoji: '🧮',
        description:
            'Scans the latest four digits on the Volatility 25 Index and selects a binary-matrix trade direction across Even, Odd, Over 4, and Under 5 conditions. Uses one-tick contracts, 2× stake recovery after losses, stake resets after wins, and re-analyzes after three wins.',
        market: 'Volatility 25 Index (R_25)',
        strategy: 'Digit Even / Odd · Over / Under · Matrix Scanner · Martingale',
        params: [
            { label: 'Initial Stake', value: '$0.50' },
            { label: 'Take Profit', value: '$10' },
            { label: 'Stop Loss', value: '$50' },
            { label: 'Martingale', value: '2×' },
            { label: 'Re-analyse After', value: '3 wins' },
            { label: 'Duration', value: '1 Tick' },
        ],
        xmlPath: '/bots/Binary_Matrix_AI.xml',
        gradient: 'linear-gradient(135deg, #170b3d 0%, #3b176e 42%, #0ea5a8 100%)',
    },
    {
        id: 'rise-fall-master',
        section: 'premium',
        name: 'Rise / Fall Master Bot',
        emoji: '📈📉',
        description:
            'Trades Rise/Fall on Volatility 100 (1s) Index using model direction with ADX, RSI, and MACD confirmation, plus controlled recovery and session risk stops.',
        market: 'Volatility 100 (1s) Index (1HZ100V)',
        strategy: 'Rise / Fall · Model + ADX + RSI + MACD Confirmation · Risk Stops',
        params: [
            { label: 'Indicator Confirmation', value: 'ADX ≥ 20 · CALL RSI > 50 · PUT RSI < 50 · MACD aligned' },
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
        section: 'smart-contract',
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
        section: 'smart-contract',
        name: 'Differs V2 Bot',
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
        section: 'smart-contract',
        name: 'Even / Odd Entry Scanner',
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
        section: 'smart-contract',
        name: 'Over / Under Signal Bot',
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
        id: 'over2-under7-reversal',
        section: 'premium',
        name: 'Over2 / Under7 Reversal',
        emoji: '🔁',
        description:
            'Pattern strategy for Volatility 50 (1s) Index. Choose a 1- through 6-digit lookback, then trade Over 2 when the recent digits are at or below 2 or Under 7 when they are at or above 7. Includes a 3.5× Martingale recovery, four-win take-profit target, and stop-loss protection.',
        market: 'Volatility 50 (1s) Index (1HZ50V)',
        strategy: 'Over 2 / Under 7 · 1–6 Digit Pattern Reversal · Martingale',
        params: [
            { label: 'Lookback', value: '1–6 digits (selectable)' },
            { label: 'Over Trigger', value: '≤2' },
            { label: 'Under Trigger', value: '≥7' },
            { label: 'Initial Stake', value: '$0.50' },
            { label: 'Martingale', value: '3.5×' },
            { label: 'Take Profit', value: '4 wins' },
            { label: 'Stop Loss', value: '$30' },
            { label: 'Duration', value: '1 Tick' },
        ],
        xmlPath: '/bots/Over2_Under7_Reversal.xml',
        gradient: 'linear-gradient(135deg, #1c1033 0%, #4c1d95 48%, #f59e0b 100%)',
    },
    {
        id: 'smart-over-2',
        section: 'premium',
        name: 'Smart Over 2 Bot V1',
        emoji: '🧠',
        description:
            'Keeps the normal Over 2 last-X entry filter. After an Over 2 loss, Virtual Hook simulates Under 5; after the configured consecutive virtual losses, real Under 5 recovery continues with Martingale until a win returns to normal entries. Virtual Hook is enabled by default and its loss limit is adjustable in Run once at start.',
        market: 'Volatility 50 (1s) Index (1HZ50V)',
        strategy: 'Over 2 Entry Gate · Virtual Under 5 → Real Under 5 Recovery',
        params: [
            { label: 'Lookback', value: '4 digits (editable)' },
            { label: 'Entry Window', value: 'Every digit 3–7' },
            { label: 'Skip Rule', value: 'Last 3 all 7–9 or all 0–2' },
            { label: 'Normal Entry', value: 'Over 2 (condition-gated)' },
            { label: 'Virtual Hook', value: 'Enabled by default · Under 5' },
            { label: 'Virtual loss limit', value: '2 consecutive (editable at start)' },
            { label: 'Recovery', value: 'Real Under 5 until a win' },
            { label: 'Base Stake', value: '$0.50 (resets after any win)' },
            { label: 'Martingale', value: '1.2× (editable)' },
            { label: 'Duration', value: '1 Tick' },
        ],
        xmlPath: '/bots/Smart_Over_2_Bot.xml',
        gradient: 'linear-gradient(135deg, #10202f 0%, #155e75 48%, #22c55e 100%)',
    },
    {
        id: 'smart-over-2-v2',
        section: 'premium',
        name: 'Smart Over 2 Bot V2',
        emoji: '🧠',
        description:
            'Uses the same condition-gated Over 2 last-X entry filter as V1. After an Over 2 loss, Virtual Hook simulates Over 4; after the configured consecutive virtual losses, real Over 4 recovery continues with Martingale until a win returns to normal entries. Virtual Hook is enabled by default and its loss limit is adjustable in Run once at start.',
        market: 'Volatility 50 (1s) Index (1HZ50V)',
        strategy: 'Over 2 Entry Gate · Virtual Over 4 → Real Over 4 Recovery',
        params: [
            { label: 'Lookback', value: '4 digits (editable)' },
            { label: 'Entry Window', value: 'Every digit 3–7' },
            { label: 'Skip Rule', value: 'Last 3 all 7–9 or all 0–2' },
            { label: 'Normal Entry', value: 'Over 2 (condition-gated)' },
            { label: 'Virtual Hook', value: 'Enabled by default · Over 4' },
            { label: 'Virtual loss limit', value: '2 consecutive (editable at start)' },
            { label: 'Recovery', value: 'Real Over 4 until a win' },
            { label: 'Base Stake', value: '$0.50 (resets after any win)' },
            { label: 'Martingale', value: '1.2× (editable)' },
            { label: 'Duration', value: '1 Tick' },
        ],
        xmlPath: '/bots/Smart_Over_2_Bot_V2.xml',
        gradient: 'linear-gradient(135deg, #10202f 0%, #155e75 48%, #22c55e 100%)',
    },
    {
        id: 'smart-over-2-v3',
        section: 'premium',
        name: 'Smart Over 2 Bot V3',
        emoji: '🧠',
        description:
            'Trades Over 2 only when all four latest digits are 3–6 inclusive. Virtual Over 2 attempts continue until the configured consecutive-loss limit is reached, then the next qualifying entry is traded live. No Under or recovery contract.',
        market: 'Volatility 50 (1s) Index (1HZ50V)',
        strategy: 'Over 2 Only · Four-Digit 3–6 Entry Filter · Virtual Hook → Live Over 2',
        params: [
            { label: 'Entry Rule', value: 'All four latest digits must be 3–6 inclusive' },
            { label: 'Contract', value: 'Over 2 only' },
            { label: 'Virtual Hook', value: 'Enabled by default · Over 2' },
            { label: 'Virtual loss limit', value: '2 consecutive (editable at start)' },
            { label: 'Base Stake', value: '$0.50' },
            { label: 'Martingale', value: '1.2× (editable)' },
            { label: 'Target Profit', value: '$5' },
            { label: 'Stop Loss', value: '$30' },
            { label: 'Duration', value: '1 Tick' },
        ],
        xmlPath: '/bots/Smart_Over_2_Bot_V3.xml',
        gradient: 'linear-gradient(135deg, #10202f 0%, #155e75 48%, #22c55e 100%)',
    },
    {
        id: 'over-destroyer',
        section: 'smart-contract',
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
        section: 'smart-contract',
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
        section: 'smart-contract',
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
        section: 'smart-contract',
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
        section: 'smart-contract',
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
        id: 'elite-entry-scanner',
        section: 'smart-contract',
        name: 'Elite Over / Under Entry Scanner 🔥🔥',
        emoji: '🔥',
        description:
            'Trades Digit Over/Under on Volatility 10 (1s) Index. Its Blockly strategy includes one Over entry and two Under entries, using Entry Point 7 with adaptive predictions and smart Martingale recovery. Resets stake to a minimum $0.35 floor and stops automatically on Take Profit ($100) or Stop Loss ($1000).',
        market: 'Volatility 10 (1s) Index (1HZ10V)',
        strategy: 'Digit Over / Under · Entry Point Scanner · Adaptive Martingale',
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
    {
        id: 'edging-pro-engine',
        section: 'edging',
        name: 'Edging pro Engine',
        emoji: '⚔️',
        description:
            'When each of the latest X digits is 4 or 5, sends one Over 5 and one Under 4 buy request back-to-back on a 1-tick duration. Deriv handles each request separately, so they may not share an exact entry or exit tick. Virtual Hook switches to real pairs only after the configured number of consecutive virtual pairs where both legs lose; any mixed or winning pair resets the streak.',
        market: 'Volatility 50 (1s) Index (1HZ50V)',
        strategy: 'Digit Over 5 + Digit Under 4 · Last X digits 4–5 · Virtual Hook',
        params: [
            { label: 'Stake', value: '$0.50 per leg' },
            { label: 'Predictions', value: 'Over 5 + Under 4' },
            { label: 'Last X', value: '4 digits (each 4 or 5)' },
            { label: 'Virtual Hook', value: 'On · 2 consecutive both-leg losses' },
            { label: 'Martingale', value: '2×' },
            { label: 'Take Profit / Stop Loss', value: '$10 / $30' },
            { label: 'Duration', value: '1 Tick' },
        ],
        xmlPath: '/bots/Edging_Pro_Engine.xml',
        gradient: 'linear-gradient(135deg, #101628 0%, #244c52 46%, #4a164d 100%)',
    },
    {
        id: 'even-odd-strike-eagle',
        section: 'premium',
        name: 'Even Odd Strike Eagle',
        emoji: '🦅',
        description:
            'One-tick Even/Odd bot for the Volatility 25 (1s) Index. Qualifies each side with consecutive virtual losses, switches sides after the configured number of settled real contracts, resets stake after a win, and doubles it after a loss.',
        market: 'Volatility 25 (1s) Index (1HZ25V)',
        strategy: 'Even / Odd · Virtual Hook · Alternating Side Switch',
        params: [
            { label: 'Initial Stake', value: '$0.70' },
            { label: 'Switch After', value: '3 settled real contracts' },
            { label: 'Virtual Hook', value: '3 consecutive losses per side' },
            { label: 'Martingale', value: '2×' },
            { label: 'Take Profit', value: '$10' },
            { label: 'Stop Loss', value: '$50' },
            { label: 'Duration', value: '1 Tick' },
        ],
        xmlPath: '/bots/Even_Odd_Strike_Eagle.xml',
        gradient: 'linear-gradient(135deg, #07152e 0%, #123b72 45%, #14b881 100%)',
        category: 'EVEN / ODD',
    },
];

const FREE_BOT_SECTIONS: { id: FreeBotSection; title: string; emptyMessage?: string }[] = [
    { id: 'smart-contract', title: 'Smart Contract Bots' },
    { id: 'premium', title: 'Premium Bots' },
    { id: 'edging', title: 'Edging Bots', emptyMessage: 'No bots added here yet.' },
];

// Keep the existing catalog numbering stable even though Smart Contract is now the first tab.
const BOTS_IN_ORDINAL_ORDER = [
    ...BOTS.filter(
        bot => bot.section === 'premium' && !['smart-over-2-v2', 'smart-over-2-v3'].includes(bot.id)
    ),
    ...BOTS.filter(bot => bot.section === 'smart-contract'),
    ...BOTS.filter(bot => bot.section === 'edging'),
    ...BOTS.filter(bot => bot.id === 'smart-over-2-v2'),
    ...BOTS.filter(bot => bot.id === 'smart-over-2-v3'),
];
const BOT_ORDINALS = new Map(BOTS_IN_ORDINAL_ORDER.map((bot, index) => [bot.id, index + 1]));

const CARD_ART: Record<string, string> = {
    'edging-pro-engine': '/assets/free-bots/mega-mind.jpg',
    'binary-matrix-ai': '/assets/free-bots/mega-mind.jpg',
    'rise-fall-master': '/assets/free-bots/hitnrun.jpg',
    'matches-signal': '/assets/free-bots/super-bot.jpg',
    'differ-v2': '/assets/free-bots/mentorship.jpg',
    'even-odd-scanner': '/assets/free-bots/odd-autobot.jpg',
    'over-under-signal': '/assets/free-bots/under-autobot.jpg',
    'over2-under7-reversal': '/assets/free-bots/hitnrun.jpg',
    'smart-over-2': '/assets/free-bots/concept-ai.jpg',
    'smart-over-2-v2': '/assets/free-bots/concept-ai.jpg',
    'smart-over-2-v3': '/assets/free-bots/concept-ai.jpg',
    'over-destroyer': '/assets/free-bots/destroyer.jpg',
    'under-destroyer': '/assets/free-bots/mega-mind.jpg',
    'elite-default-speed': '/assets/free-bots/osam-hmr.jpg',
    'even-odd-manual': '/assets/free-bots/odd-myth.jpg',
    'over-under-manual': '/assets/free-bots/digit-switcher.jpg',
    'elite-entry-scanner': '/assets/free-bots/blueprint.jpg',
    'even-odd-strike-eagle': '/assets/free-bots/odd-myth.jpg',
};

const CARD_CATEGORY: Record<string, string> = {
    'edging-pro-engine': 'PAIRED DIGITS',
    'binary-matrix-ai': 'EVEN / ODD · OVER / UNDER',
    'rise-fall-master': 'RISE / FALL',
    'matches-signal': 'MATCHES',
    'differ-v2': 'DIFFERS',
    'even-odd-scanner': 'EVEN / ODD',
    'over-under-signal': 'OVER / UNDER SIGNAL',
    'over2-under7-reversal': 'OVER / UNDER',
    'smart-over-2': 'DIGIT OVER 2',
    'smart-over-2-v2': 'DIGIT OVER 2',
    'over-destroyer': 'OVER / UNDER',
    'under-destroyer': 'OVER / UNDER',
    'elite-default-speed': 'UNDER',
    'even-odd-manual': 'EVEN / ODD',
    'over-under-manual': 'OVER / UNDER',
    'elite-entry-scanner': 'OVER / UNDER SCANNER',
    'even-odd-strike-eagle': 'EVEN / ODD · VIRTUAL HOOK',
};

const CARD_ACCENT: Record<string, string> = {
    'edging-pro-engine': '#32c7a5',
    'binary-matrix-ai': '#178da8',
    'rise-fall-master': '#0d9959',
    'matches-signal': '#7027d0',
    'differ-v2': '#1e6bd0',
    'even-odd-scanner': '#bd8300',
    'over-under-signal': '#d9274c',
    'over2-under7-reversal': '#eb741d',
    'smart-over-2': '#0f9f79',
    'smart-over-2-v2': '#0f9f79',
    'over-destroyer': '#b21c28',
    'under-destroyer': '#4939a3',
    'elite-default-speed': '#126dbd',
    'even-odd-manual': '#15955e',
    'over-under-manual': '#e6315b',
    'elite-entry-scanner': '#ed7439',
    'even-odd-strike-eagle': '#15955e',
};

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

            loadPatchedBotIntoWorkspace(xmlStr, Blockly.derivWorkspace);

            openBotBuilderTab(store.dashboard);
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
type ImportedTradeFields = {
    market?: string;
    submarket?: string;
    symbol?: string;
    tradeTypeCategory?: string;
    tradeType?: string;
    contractType?: string;
    durationType?: string;
    purchaseTypes?: string[];
};

const POST_LOAD_EVENT_GROUP = 'dbot-post-load';

function withPostLoadBlocklyEventGroup<T>(callback: () => T): T {
    const events = (window as any).Blockly?.Events;
    if (!events) return callback();

    const previousGroup = events.getGroup();
    events.setGroup(POST_LOAD_EVENT_GROUP);
    try {
        return callback();
    } finally {
        events.setGroup(previousGroup);
    }
}

async function postLoadReapplyFields(
    ws: any,
    desired: ImportedTradeFields
): Promise<void> {
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const getDurBlock = (): any =>
        ws.getAllBlocks(true).find((b: any) => b.type === 'trade_definition_tradeoptions');
    const getMarketBlock = (): any =>
        ws.getAllBlocks(true).find((b: any) => b.type === 'trade_definition_market');
    const getTradeTypeBlock = (): any =>
        ws.getAllBlocks(true).find((b: any) => b.type === 'trade_definition_tradetype');
    const getContractTypeBlock = (): any =>
        ws.getAllBlocks(true).find((b: any) => b.type === 'trade_definition_contracttype');
    const getPurchaseBlocks = (): any[] =>
        ws.getAllBlocks(true).filter((b: any) => b.getField?.('PURCHASE_LIST'));

    const tradeTypeBlock = getTradeTypeBlock();
    const contractTypeBlock = getContractTypeBlock();
    const durationBlock = getDurBlock();

    const optionsContain = (block: any, fieldName: string, value?: string): boolean => {
        if (!value) return false;
        const options: any[][] = block?.getField(fieldName)?.menuGenerator_ ?? [];
        return options.some(option => option?.[1] === value);
    };

    const waitForOption = async (block: any, fieldName: string, value?: string): Promise<boolean> => {
        for (let i = 0; i < 50; i++) {
            if (optionsContain(block, fieldName, value)) return true;
            await delay(300);
        }
        return false;
    };

    const triggerCascade = (block: any, name: string, blockId: string): void => {
        if (!block?.onchange) return;
        block.onchange({
            type: (window as any).Blockly.Events.BLOCK_CHANGE,
            blockId,
            name,
            group: POST_LOAD_EVENT_GROUP,
        });
    };

    // The trade-type onchange handler ignores symbol/category events while the
    // XML lifecycle guard is active. Wait for the importer to release it.
    for (let i = 0; i < 50 && (window as any).__DBOT_LOADING_XML; i++) {
        await delay(200);
    }

    // Seed the market menus directly from active_symbols. Waiting for these
    // options is circular: their own parent-change events are what populate them.
    let activeSymbols: any;
    for (let i = 0; i < 50; i++) {
        activeSymbols = (ApiHelpers as any)?.instance?.active_symbols;
        if (activeSymbols) break;
        await delay(300);
    }

    const marketBlock = getMarketBlock();
    if (marketBlock && activeSymbols) {
        const updateField = (fieldName: string, options: any[][], defaultValue?: string) => {
            marketBlock.getField(fieldName)?.updateOptions?.(options, {
                default_value: defaultValue,
                should_pretend_empty: true,
                event_group: POST_LOAD_EVENT_GROUP,
            });
        };
        updateField('MARKET_LIST', activeSymbols.getMarketDropdownOptions(), desired.market);
        updateField(
            'SUBMARKET_LIST',
            activeSymbols.getSubmarketDropdownOptions(desired.market),
            desired.submarket
        );
        updateField(
            'SYMBOL_LIST',
            activeSymbols.getSymbolDropdownOptions(desired.submarket),
            desired.symbol
        );
    }

    if (marketBlock && tradeTypeBlock) {
        // Ensure contracts_for receives the restored symbol even if Blockly
        // suppresses the automatic event because the value did not change.
        triggerCascade(tradeTypeBlock, 'SYMBOL_LIST', marketBlock.id);
        if (await waitForOption(tradeTypeBlock, 'TRADETYPECAT_LIST', desired.tradeTypeCategory)) {
            withPostLoadBlocklyEventGroup(() =>
                tradeTypeBlock.setFieldValue(desired.tradeTypeCategory, 'TRADETYPECAT_LIST')
            );
            triggerCascade(tradeTypeBlock, 'TRADETYPECAT_LIST', tradeTypeBlock.id);
        }
        if (await waitForOption(tradeTypeBlock, 'TRADETYPE_LIST', desired.tradeType)) {
            withPostLoadBlocklyEventGroup(() =>
                tradeTypeBlock.setFieldValue(desired.tradeType, 'TRADETYPE_LIST')
            );
            triggerCascade(tradeTypeBlock, 'TRADETYPE_LIST', tradeTypeBlock.id);
        }
    }

    // Contract type options depend on the restored trade type. Restore the
    // saved value before rebuilding purchase options so non-callput families
    // (for example digits and accumulators) do not fall back to callput.
    if (contractTypeBlock && (await waitForOption(contractTypeBlock, 'TYPE_LIST', desired.contractType))) {
        withPostLoadBlocklyEventGroup(() =>
            contractTypeBlock.setFieldValue(desired.contractType, 'TYPE_LIST')
        );
        triggerCascade(contractTypeBlock, 'TYPE_LIST', contractTypeBlock.id);
    }

    // Helper: apply all the critical field values
    const applyFields = () =>
        withPostLoadBlocklyEventGroup(() => {
            if (
                desired.durationType &&
                optionsContain(getDurBlock(), 'DURATIONTYPE_LIST', desired.durationType)
            ) {
                getDurBlock()?.setFieldValue(desired.durationType, 'DURATIONTYPE_LIST');
            }

            // Re-trigger populatePurchaseList first so each dropdown is built from
            // the restored contract family, then restore its corresponding XML
            // value. Do not assume the blocks are CALL/PUT purchases.
            getPurchaseBlocks().forEach((purchaseBlock, index) => {
                const purchaseType = desired.purchaseTypes?.[index];
                purchaseBlock.populatePurchaseList?.({ group: POST_LOAD_EVENT_GROUP });
                if (optionsContain(purchaseBlock, 'PURCHASE_LIST', purchaseType)) {
                    purchaseBlock.setFieldValue(purchaseType, 'PURCHASE_LIST');
                }
            });
        });

    // Wait for Deriv API to populate DURATIONTYPE_LIST (up to 15 s).
    // Nudge updateDurationInput on each poll in case the API is ready but hasn't
    // been triggered yet (e.g. the initial load event bailed out because
    // ApiHelpers.instance was null at that moment).
    const POLL_MS = 300;
    let ready = !desired.durationType || !durationBlock;
    for (let i = 0; i < 50 && !ready; i++) {
        if (optionsContain(getDurBlock(), 'DURATIONTYPE_LIST', desired.durationType)) {
            ready = true;
            break;
        }
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
    if (optionsContain(getDurBlock(), 'DURATIONTYPE_LIST', desired.durationType)) applyFields();
}

// ─── Bot Card ─────────────────────────────────────────────────────────────────

const BotCard: React.FC<{ bot: BotConfig; engineMode: EngineMode; ordinal: number }> = observer(
    ({ bot, engineMode, ordinal }) => {
    const store = useStore();
    const [status,     setStatus]     = useState<BotStatus>('idle');
    const [errorMsg,   setErrorMsg]   = useState('');
    const [showSignal, setShowSignal] = useState(false);

    const signal = useSignal(bot.signalKey);
    const isEdgingProBot = bot.id === 'edging-pro-engine';

    const loadBot = async () => {
        if (!store) return;
        if (!bot.xmlPath) {
            setStatus('error');
            setErrorMsg('This bot runs in its own engine and does not have a Blockly template.');
            return;
        }
        const { dashboard } = store;
        setStatus('loading');
        setErrorMsg('');
        try {
            // Built-in bots are versioned by deployment. Always fetch the
            // current template so a browser cannot reload an older XML copy
            // after the bot source has been updated.
            const res = await fetch(bot.xmlPath, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const xmlText = await res.text();
            if (!xmlText.trim()) {
                throw new Error('This bot file is empty and cannot be loaded.');
            }

            if (engineMode === 'v2' && !isEdgingProBot) {
                // Fix #2 & #5: V2 path — parse config, persist, fire autostart.
                // Do NOT load into Blockly — that arms DBot's engine and causes V1 to fire.
                const v2Cfg    = parseXmlV2Config(xmlText);
                const v2CfgStr = JSON.stringify(v2Cfg);
                localStorage.setItem(V2_CONFIG_KEY, v2CfgStr);
                window.dispatchEvent(new StorageEvent('storage', { key: V2_CONFIG_KEY, newValue: v2CfgStr }));
                setWorkspaceBotTemplateIdentity((window as any).Blockly?.derivWorkspace, bot.id);
                store.journal.setActiveBotTemplateId(bot.id);
                store.save_modal.updateBotName(bot.name);
                setStatus('loaded');
                openBotBuilderTab(dashboard);
                setTimeout(() => window.dispatchEvent(new CustomEvent('deriv-v2-autostart')), 400);
                return;
            }

            // V1 path — navigate to Bot Builder FIRST so the workspace mounts and
            // the Deriv API connects before we load the XML.
            openBotBuilderTab(dashboard);

            // Poll for Blockly.derivWorkspace (workspace mounts asynchronously)
            const waitForWs = async (): Promise<any> => {
                for (let i = 0; i < 150; i++) {
                    const B = (window as any).Blockly;
                    const scratchDiv = document.getElementById('scratch_div');
                    const initializationError = store.blockly_store.initialization_error;
                    if (initializationError) throw new Error(initializationError);
                    if (
                        isBotBuilderWorkspaceReady({
                            workspace: B?.derivWorkspace,
                            hasSvg: Boolean(scratchDiv?.querySelector('svg')),
                            isLoading: store.blockly_store.is_loading,
                        })
                    ) {
                        return B;
                    }
                    await new Promise(r => setTimeout(r, 100));
                }
                return null;
            };
            const Blockly = await waitForWs();
            if (!Blockly?.derivWorkspace) {
                throw new Error('Bot Builder workspace did not finish loading. Please try loading this bot again.');
            }

            // Keep the direct loader used by the working Binary Matrix path, but
            // use the same load event group as the normal DBot importer. Several
            // root-block onchange handlers dispose incomplete-looking blocks
            // unless they can identify an in-progress `dbot-load` operation.
            const loadEventGroup = `dbot-load${Date.now()}`;
            const importGuard = acquireBlocklyXmlImportGuard();
            let importCompleted = false;
            let importedTradeFields: ImportedTradeFields = {};
            Blockly.Events.setGroup(loadEventGroup);
            try {
                await Blockly.derivWorkspace.asyncClear();
                setWorkspaceBotTemplateIdentity(Blockly.derivWorkspace, bot.id);
                const dom = Blockly.utils.xml.textToDom(xmlText);
                const importedField = (name: string): string | undefined => {
                    const value = dom.querySelector?.(`field[name="${name}"]`)?.textContent?.trim();
                    return value || undefined;
                };
                importedTradeFields = {
                    market: importedField('MARKET_LIST'),
                    submarket: importedField('SUBMARKET_LIST'),
                    symbol: importedField('SYMBOL_LIST'),
                    tradeTypeCategory: importedField('TRADETYPECAT_LIST'),
                    tradeType: importedField('TRADETYPE_LIST'),
                    contractType: importedField('TYPE_LIST'),
                    durationType: importedField('DURATIONTYPE_LIST'),
                    purchaseTypes: Array.from(dom.querySelectorAll('field[name="PURCHASE_LIST"]') as NodeListOf<Element>)
                        .map(field => field.textContent?.trim())
                        .filter((value): value is string => Boolean(value)),
                };
                // Blockly.Xml.domToVariables expects the <variables> element,
                // not the <xml> root (whose blocks would be misread as variables).
                const variablesXml = Array.from(dom.children).find(
                    (node: any) => node.localName === 'variables' || node.tagName?.toLowerCase() === 'variables'
                );
                if (variablesXml) Blockly.Xml.domToVariables(variablesXml, Blockly.derivWorkspace);
                 // Some browser XML DOM implementations expose the Blockly
                 // namespace inconsistently through localName/tagName. Root
                 // Blockly elements all carry a type attribute, while the
                 // variables container does not; use that stable marker so
                 // uploaded XML keeps every root block.
                 const rootXmlBlocks = Array.from(dom.children).filter(
                     (node: any) =>
                         (node.localName === 'block' || node.tagName?.toLowerCase() === 'block') &&
                         Boolean(node.getAttribute?.('type'))
                 );
                const mandatoryRootTypes = ['trade_definition', 'before_purchase', 'after_purchase'];
                const rootTypes = new Set(rootXmlBlocks.map((node: any) => node.getAttribute('type')));
                const missingRootTypes = mandatoryRootTypes.filter(type => !rootTypes.has(type));
                if (missingRootTypes.length > 0) {
                    throw new Error(
                        `Bot XML is missing mandatory root block(s): ${missingRootTypes.join(', ')}.`
                    );
                }

                // Do not assume every bot has exactly three roots. Valid DBot
                // strategies can also contain during_purchase, tick_analysis,
                // variables, and procedure roots. Binary Matrix happens to
                // have three, which previously hid this loader restriction.
                rootXmlBlocks.forEach((rootXmlBlock: any) => {
                    Blockly.Xml.domToBlock(rootXmlBlock, Blockly.derivWorkspace);
                });
                importCompleted = true;
            } finally {
                Blockly.Events.setGroup(false);
                if (!importCompleted) {
                    importGuard.release();
                } else {
                    importGuard.releaseAfter(BLOCKLY_XML_IMPORT_SETTLE_MS);
                }
            }
            Blockly.derivWorkspace.cleanUp();
            Blockly.derivWorkspace.clearUndo();

            const loadedBlocks = Blockly.derivWorkspace.getAllBlocks(true);
            const loadedTopBlocks = Blockly.derivWorkspace.getTopBlocks(true);
            const loadedTopTypes = new Set(loadedTopBlocks.map((block: any) => block.type));
            const missingLoadedTypes = ['trade_definition', 'before_purchase', 'after_purchase'].filter(
                type => !loadedTopTypes.has(type)
            );
            if (missingLoadedTypes.length > 0 || loadedBlocks.length === 0) {
                throw new Error(
                    `Bot XML loaded incompletely (missing ${missingLoadedTypes.join(', ') || 'all blocks'}; ` +
                        `${loadedTopBlocks.length} root blocks, ${loadedBlocks.length} total blocks).`
                );
            }
            DBot.scheduleLoadedWorkspaceReveal();
            scheduleWorkspaceReveal(Blockly.derivWorkspace);
            // Blockly's option fields can finish validating asynchronously after
            // domToBlock returns. Keep the root-block lifecycle guard alive until
            // those callbacks have settled, otherwise Trade Parameters can dispose
             // itself when its statement stack is briefly observed as empty.
             // Deriv's market/duration cascades can answer several seconds
             // after import, so one second is not enough for uploaded bots.
            window.setTimeout(() => {
                // Async dropdown validation can recalculate Blockly metrics
                // after the first reveal and restore the previous bottom
                // scroll position. Reveal again after the settling window.
                DBot.revealLoadedWorkspace();
                scheduleWorkspaceReveal(Blockly.derivWorkspace);
             }, 6000);

            setStatus('loaded');
            store.journal.setActiveBotTemplateId(bot.id);
            store.save_modal.updateBotName(bot.name);
            setWorkspaceBotTemplateIdentity(Blockly.derivWorkspace, bot.id);

            // ROOT CAUSE FIX — blank duration/purchase dropdowns:
            // Restore can wait longer than the Builder's initial mobile reveal
            // window while the Deriv symbol/contract menus load. Re-anchor the
            // actual imported workspace only after those async field updates
            // finish, so a late Blockly metrics refresh cannot leave the roots
            // scrolled below the mobile viewport.
            void postLoadReapplyFields(Blockly.derivWorkspace, importedTradeFields)
                .then(() => scheduleWorkspaceReveal(Blockly.derivWorkspace))
                .catch(error => {
                    console.error('[Free Bots] Could not finish restoring bot dropdowns.', error);
                    scheduleWorkspaceReveal(Blockly.derivWorkspace);
                });
        } catch (err: any) {
            setStatus('error');
            setErrorMsg(err?.message || 'Failed to load bot.');
        }
    };

    const isV2Mode = engineMode === 'v2' && !isEdgingProBot;

    return (
        <>
            <div className='free-bots__card'>
                <div
                    className='free-bots__card-art'
                    style={{
                        backgroundImage: `url(${CARD_ART[bot.id] || '/assets/free-bots/digit-ticker.jpg'})`,
                    }}
                >
                    <span className='free-bots__card-category'>
                        {bot.category || CARD_CATEGORY[bot.id] || 'BOT'}
                    </span>
                </div>

                <div
                    className='free-bots__card-body'
                    style={{ '--fb-accent': CARD_ACCENT[bot.id] || '#2779bd' } as React.CSSProperties}
                >
                    <span className='free-bots__card-access'>OPEN ACCESS</span>
                    <h2 className='free-bots__card-name'>
                        Bot #{ordinal} — {bot.name}
                    </h2>

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
                        {!isV2Mode && (
                            <button
                                className={`free-bots__card-btn free-bots__card-btn--load ${status === 'loading' ? 'free-bots__card-btn--busy' : ''}`}
                                onClick={loadBot}
                                disabled={status === 'loading'}
                            >
                                <span aria-hidden='true'>⇩</span>
                                {status === 'loading' ? 'Loading…' : status === 'loaded' ? 'Loaded' : 'Load bot'}
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
            {showSignal && signal && bot.xmlPath && (
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
    const [activeSectionId, setActiveSectionId] = useState<FreeBotSection>('smart-contract');
    const sections = FREE_BOT_SECTIONS.map(section => ({
        ...section,
        bots: BOTS.filter(bot => bot.section === section.id),
    }));
    const activeSection = sections.find(section => section.id === activeSectionId) ?? sections[0];

    return (
        <div className='free-bots'>
            <FreeBotCategoryTabs
                tabs={sections.map(section => ({
                    id: section.id,
                    label: section.title,
                    count: section.bots.length,
                }))}
                selectedId={activeSection.id}
                onSelect={setActiveSectionId}
            />
            <section
                className='free-bots__section'
                id={`free-bots-panel-${activeSection.id}`}
                role='tabpanel'
                aria-labelledby={`free-bots-tab-${activeSection.id}`}
                tabIndex={0}
            >
                {activeSection.bots.length > 0 ? (
                    <div className='free-bots__grid'>
                        {activeSection.bots.map(bot => (
                            <BotCard
                                key={bot.id}
                                bot={bot}
                                engineMode={engineMode}
                                ordinal={BOT_ORDINALS.get(bot.id) ?? 0}
                            />
                        ))}
                    </div>
                ) : (
                    <div className='free-bots__empty'>
                        {activeSection.emptyMessage ?? 'No bots added here yet.'}
                    </div>
                )}
            </section>
        </div>
    );
});

export default FreeBots;

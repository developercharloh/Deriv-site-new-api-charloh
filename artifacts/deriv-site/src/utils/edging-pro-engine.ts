import {
    DTraderEngine,
    type DTDigitPairLegConfig,
    type DTLog,
    type DTPosition,
    type DTStatus,
} from './dtrader-engine';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import {
    assessEdgingProEntry,
    calculateEdgingProPairProfit,
    type EdgingProEntryAssessment,
} from './edging-pro-strategy';
import {
    releaseBotContractGate,
    tryAcquireBotContractGate,
} from './bot-contract-gate';

export interface EdgingProConfig {
    symbol: string;
    currency: string;
    accountId?: string;
    initialStake: number;
    martingale: number;
    takeProfit: number;
    stopLoss: number;
    lastX: number;
    overPrediction: number;
    underPrediction: number;
    useVirtualHook: boolean;
    virtualLossThreshold: number;
}

export type EdgingProStatus =
    | 'idle'
    | 'scanning'
    | 'paused'
    | 'virtual'
    | 'buying'
    | 'waiting'
    | 'stopped'
    | 'error';

export interface EdgingProStats {
    profit: number;
    wins: number;
    losses: number;
    currentStake: number;
    consecutiveVirtualLosses: number;
    activeContracts: number;
    lastAnalysis: EdgingProEntryAssessment;
}

export interface EdgingProAnalysis extends EdgingProEntryAssessment {
    tickSerial: number;
}

interface VirtualPair {
    entryTickSerial: number;
    quotes: { over: { askPrice: number; payout: number }; under: { askPrice: number; payout: number } };
    digits: number[];
    entrySpot: string;
    entryEpoch?: number;
}

export interface EdgingProVirtualSettlement {
    outcome: 'win' | 'loss';
    entryTickSerial: number;
    market: string;
    contractType: string;
    prediction: number;
    entryEpoch?: number;
    settlementEpoch?: number;
    entrySpot?: string;
    exitSpot?: string;
}

interface LivePair {
    buyComplete: boolean;
    acceptedIds: string[];
    positions: Map<string, DTPosition>;
    failures: string[];
    partial: boolean;
}

const GLOBAL_ENGINE_KEY = '__DERIV_EDGING_PRO_ENGINE__';
const RUN_LEASE_STORAGE_PREFIX = '__DERIV_EDGING_PRO_ACTIVE_RUN__:';
const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 10_000;

const makeRunLeaseId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const getActiveEngine = (): EdgingProEngine | null =>
    (globalThis as Record<string, unknown>)[GLOBAL_ENGINE_KEY] as EdgingProEngine | null;

const setActiveEngine = (engine: EdgingProEngine | null): void => {
    const state = globalThis as Record<string, unknown>;
    if (engine) state[GLOBAL_ENGINE_KEY] = engine;
    else delete state[GLOBAL_ENGINE_KEY];
};

export class EdgingProEngine {
    private readonly trader = new DTraderEngine();
    private readonly config: EdgingProConfig;
    private running = false;
    private paused = false;
    private stopRequested = false;
    private pendingQuotes = false;
    private tickSerial = 0;
    private digits: number[] = [];
    private pendingVirtualPair: VirtualPair | null = null;
    private activeLivePair: LivePair | null = null;
    private liveEntryUsedForQualification = false;
    private currentStake: number;
    private totalProfit = 0;
    private wins = 0;
    private losses = 0;
    private consecutiveVirtualLosses = 0;
    private latestSpot = '';
    private latestEpoch?: number;
    private lastProcessedTickKey: string | null = null;
    private lastEntryEpochKey: string | null = null;
    private runLeaseTimer: ReturnType<typeof setInterval> | null = null;
    private readonly runLeaseId = makeRunLeaseId();
    private status: EdgingProStatus = 'idle';
    private lastAnalysis: EdgingProEntryAssessment;

    onLog: (log: DTLog) => void = () => {};
    onStatus: (status: EdgingProStatus) => void = () => {};
    onStats: (stats: EdgingProStats) => void = () => {};
    onPosition: (position: DTPosition) => void = () => {};
    onAnalysis: (analysis: EdgingProAnalysis) => void = () => {};
    onVirtualSettlement: (settlement: EdgingProVirtualSettlement) => void = () => {};
    onAlert: (alert: { kind: 'tp' | 'sl'; profit: number }) => void = () => {};

    constructor(config: EdgingProConfig) {
        this.config = config;
        this.currentStake = config.initialStake;
        this.lastAnalysis = assessEdgingProEntry([], config.lastX);
        this.bindTrader();
    }

    start(): boolean {
        if (this.running) return true;
        const active = getActiveEngine();
        if (active && active !== this) {
            this.writeLog('Edging pro Engine is already running in another window.', 'error');
            this.setStatus('error');
            return false;
        }
        if (!api_base.api || !api_base.is_authorized) {
            this.writeLog('Log in to Deriv before starting the runner.', 'error');
            this.setStatus('error');
            return false;
        }
        if (!this.isConfigValid()) {
            this.writeLog('Check the settings: use a positive stake, risk limits, valid predictions, and Last X between 1 and 1000.', 'error');
            this.setStatus('error');
            return false;
        }
        if (!this.acquireRunLease()) {
            this.writeLog(
                'Edging pro is already active in another tab for this Deriv account, or browser storage is unavailable. Stop the other run before starting this one.',
                'error',
            );
            this.setStatus('error');
            return false;
        }

        this.running = true;
        this.stopRequested = false;
        this.lastProcessedTickKey = null;
        this.lastEntryEpochKey = null;
        this.liveEntryUsedForQualification = false;
        setActiveEngine(this);
        this.startRunLeaseHeartbeat();
        this.setStatus('scanning');
        this.emitStats();
        this.trader.start({
            symbol: this.config.symbol,
            currency: this.config.currency,
            contractType: 'DIGITOVER',
            barrier: String(this.config.overPrediction),
            durationValue: 1,
            durationUnit: 't',
            stake: this.currentStake,
        });
        this.writeLog(
            `Started on ${this.config.symbol}. Last ${this.config.lastX} consecutive digits must each be 4 or 5.`,
            'system',
        );
        return true;
    }

    pause(): void {
        if (!this.running || this.paused) return;
        this.paused = true;
        this.writeLog('Paused. Open contracts will still settle; no new pair will be entered.', 'system');
        this.setStatus(this.activeLivePair ? 'waiting' : 'paused');
    }

    resume(): void {
        if (!this.running || !this.paused) return;
        this.paused = false;
        this.writeLog('Resumed entry checks.', 'system');
        this.setStatus(this.activeLivePair ? 'waiting' : 'scanning');
    }

    stop(): void {
        if (!this.running && !this.stopRequested) {
            this.finishStop();
            return;
        }
        this.running = false;
        this.paused = false;
        this.stopRequested = true;
        this.pendingVirtualPair = null;
        this.writeLog('Stopped new entries. Any accepted one-tick contracts will finish and remain tracked.', 'system');
        if (!this.activeLivePair && !this.pendingQuotes) this.finishStop();
        else this.setStatus(this.activeLivePair?.acceptedIds.length ? 'waiting' : 'buying');
    }

    private isConfigValid(): boolean {
        const positive = [this.config.initialStake, this.config.takeProfit, this.config.stopLoss];
        return (
            positive.every(value => Number.isFinite(value) && value > 0) &&
            Number.isFinite(this.config.martingale) &&
            this.config.martingale >= 1 &&
            Number.isInteger(this.config.lastX) &&
            this.config.lastX >= 1 &&
            this.config.lastX <= 1000 &&
            Number.isInteger(this.config.overPrediction) &&
            this.config.overPrediction >= 1 &&
            this.config.overPrediction <= 8 &&
            Number.isInteger(this.config.underPrediction) &&
            this.config.underPrediction >= 0 &&
            this.config.underPrediction <= 8 &&
            this.config.underPrediction < this.config.overPrediction &&
            Number.isInteger(this.config.virtualLossThreshold) &&
            this.config.virtualLossThreshold >= 1
        );
    }

    private bindTrader(): void {
        this.trader.onTick = (spot, digit, epoch, tickId) => this.handleTick(digit, spot, epoch, tickId);
        this.trader.onPosition = position => this.handlePosition(position);
        this.trader.onStatus = status => this.handleTraderStatus(status);
        this.trader.onLog = log => this.onLog(log);
    }

    private handleTick(digit: number, spot = '', epoch?: number, tickId?: string): void {
        if (!this.running || this.status === 'error') return;
        if (!this.refreshRunLease()) {
            this.stopAfterRunLeaseLost();
            return;
        }
        // Treat the epoch as part of identity even when the broker supplies a
        // tick id: some feeds can reuse an id while advancing to new ticks.
        const tickKey = Number.isFinite(epoch)
            ? `${this.config.symbol}:epoch:${epoch}:${tickId ?? spot}`
            : tickId
              ? `${this.config.symbol}:id:${tickId}`
              : null;
        if (tickKey !== null && tickKey === this.lastProcessedTickKey) return;
        if (tickKey !== null) this.lastProcessedTickKey = tickKey;
        const entryEpochKey = Number.isFinite(epoch)
            ? `${this.config.symbol}:${epoch}`
            : tickKey;
        const mayEnterOnEpoch = entryEpochKey === null || entryEpochKey !== this.lastEntryEpochKey;
        if (entryEpochKey !== null) this.lastEntryEpochKey = entryEpochKey;
        this.tickSerial += 1;
        this.latestSpot = spot;
        this.latestEpoch = epoch;
        this.digits = [...this.digits, digit].slice(-this.config.lastX);
        this.lastAnalysis = assessEdgingProEntry(this.digits, this.config.lastX);
        if (this.lastAnalysis.status !== 'MET') this.liveEntryUsedForQualification = false;
        const analysis: EdgingProAnalysis = { ...this.lastAnalysis, tickSerial: this.tickSerial };
        this.onAnalysis(analysis);
        this.publishAnalysis(analysis);
        this.emitStats();

        if (this.pendingVirtualPair && this.tickSerial > this.pendingVirtualPair.entryTickSerial) {
            this.settleVirtualPair(digit, spot, epoch);
            return;
        }
        if (
            this.paused ||
            this.pendingQuotes ||
            this.pendingVirtualPair ||
            this.activeLivePair ||
            !mayEnterOnEpoch ||
            this.liveEntryUsedForQualification ||
            this.lastAnalysis.status !== 'MET'
        ) {
            return;
        }

        if (
            this.config.useVirtualHook &&
            this.consecutiveVirtualLosses < this.config.virtualLossThreshold
        ) {
            void this.beginVirtualPair(this.lastAnalysis);
            return;
        }
        this.liveEntryUsedForQualification = true;
        void this.beginLivePair();
    }

    private publishAnalysis(analysis: EdgingProAnalysis): void {
        const result = analysis.status === 'MET';
        const statusText = analysis.status === 'WAITING' ? 'WAITING FOR X DIGITS' : analysis.status;
        const digitsText = analysis.digits.length ? analysis.digits.join(' ') : '—';
        this.writeLog(
            `Last ${analysis.lookback} consecutive digits: ${digitsText} · 4–5 condition: ${statusText}.`,
            analysis.status === 'MET' ? 'info' : 'system',
        );
        globalObserver.emit('bot.analysis.condition', {
            market: this.config.symbol,
            condition: 'CONSECUTIVE_DIGITS_BETWEEN_4_AND_5',
            count: analysis.lookback,
            compareValue: '4–5 inclusive',
            digits: analysis.digits,
            result,
            status: analysis.status,
            botTemplateId: 'edging-pro-engine',
        });
    }

    private async beginVirtualPair(assessment: EdgingProEntryAssessment): Promise<void> {
        if (this.pendingQuotes || !this.running || this.paused || assessment.status !== 'MET') return;
        this.pendingQuotes = true;
        const triggerTick = this.tickSerial;
        this.setStatus('virtual');
        this.writeLog(
            `Virtual pair pricing · Over ${this.config.overPrediction} + Under ${this.config.underPrediction} · $${this.currentStake.toFixed(2)} per leg.`,
            'info',
        );
        const result = await this.trader.quoteDigitPair(this.pairConfigs(this.currentStake));
        this.pendingQuotes = false;
        if (!this.running || this.stopRequested) {
            this.finishStop();
            return;
        }
        if (this.paused) {
            this.writeLog('Virtual entry cancelled because the runner was paused while pricing.', 'system');
            this.setStatus('paused');
            return;
        }
        const over = result.quotes.find(quote => quote.side === 'over');
        const under = result.quotes.find(quote => quote.side === 'under');
        const stillQualified = this.lastAnalysis.status === 'MET';
        if (result.failed.length || !over || !under) {
            this.writeLog(
                `Virtual pair skipped: ${result.failed.map(item => item.message).join(' · ') || 'Both proposals were not available.'}`,
                'error',
            );
            this.setStatus('scanning');
            this.emitStats();
            return;
        }
        if (!stillQualified) {
            this.writeLog('Virtual entry skipped because the Last X condition changed while proposals were loading.', 'system');
            this.setStatus('scanning');
            return;
        }

        const entryDigits = [...this.lastAnalysis.digits];
        this.pendingVirtualPair = {
            entryTickSerial: Math.max(triggerTick, this.tickSerial),
            quotes: {
                over: { askPrice: over.askPrice, payout: over.payout },
                under: { askPrice: under.askPrice, payout: under.payout },
            },
            digits: entryDigits,
            entrySpot: this.latestSpot,
            entryEpoch: this.latestEpoch,
        };
        this.writeLog(
            `Virtual pair opened after [${entryDigits.join(' ')}]. Waiting for the next tick to score both legs.`,
            'system',
        );
        this.emitStats();
    }

    private settleVirtualPair(settlementDigit: number, settlementSpot = '', settlementEpoch?: number): void {
        const virtualPair = this.pendingVirtualPair;
        if (!virtualPair) return;
        const profit = calculateEdgingProPairProfit(
            settlementDigit,
            this.config.overPrediction,
            this.config.underPrediction,
            virtualPair.quotes.over,
            virtualPair.quotes.under,
        );
        const overWon = settlementDigit > this.config.overPrediction;
        const underWon = settlementDigit < this.config.underPrediction;
        const bothLegsLost = !overWon && !underWon;
        this.pendingVirtualPair = null;
        if (bothLegsLost) {
            this.consecutiveVirtualLosses += 1;
            this.writeLog(
                `Both virtual legs lost on digit ${settlementDigit} · ${this.signedMoney(profit)} · ${this.consecutiveVirtualLosses}/${this.config.virtualLossThreshold} consecutive both-leg losses.`,
                'loss',
            );
        } else {
            this.consecutiveVirtualLosses = 0;
            const resultText = overWon
                ? `Over ${this.config.overPrediction} won, Under ${this.config.underPrediction} lost`
                : `Under ${this.config.underPrediction} won, Over ${this.config.overPrediction} lost`;
            this.writeLog(
                `Mixed virtual pair on digit ${settlementDigit} · ${resultText} · net ${this.signedMoney(profit)} · both-leg loss counter reset.`,
                'system',
            );
        }
        const sharedSettlement = {
            entryTickSerial: virtualPair.entryTickSerial,
            market: this.config.symbol,
            entryEpoch: virtualPair.entryEpoch,
            settlementEpoch,
            entrySpot: virtualPair.entrySpot,
            exitSpot: settlementSpot,
        };
        this.onVirtualSettlement({
            ...sharedSettlement,
            outcome: overWon ? 'win' : 'loss',
            contractType: 'DIGITOVER',
            prediction: this.config.overPrediction,
        });
        this.onVirtualSettlement({
            ...sharedSettlement,
            outcome: underWon ? 'win' : 'loss',
            contractType: 'DIGITUNDER',
            prediction: this.config.underPrediction,
        });
        this.emitStats();
        this.setStatus('scanning');
    }

    private async beginLivePair(): Promise<void> {
        if (!this.running || this.paused || this.activeLivePair || this.pendingQuotes) return;
        const firstLease = tryAcquireBotContractGate(this, undefined, true);
        const secondLease = firstLease && tryAcquireBotContractGate(this, undefined, true);
        if (!firstLease || !secondLease) {
            if (firstLease) releaseBotContractGate(this);
            this.writeLog('Entry skipped: another bot runner owns the live contract gate.', 'system');
            return;
        }

        const pair: LivePair = {
            buyComplete: false,
            acceptedIds: [],
            positions: new Map(),
            failures: [],
            partial: false,
        };
        this.activeLivePair = pair;
        this.setStatus('buying');
        this.writeLog(
            `Submitting best-effort pair · Over ${this.config.overPrediction} + Under ${this.config.underPrediction} · $${this.currentStake.toFixed(2)} each ($${(this.currentStake * 2).toFixed(2)} total stake) · buy requests sent back-to-back; Deriv may accept them on different ticks.`,
            'info',
        );

        const result = await this.trader.buyDigitPairNow(
            this.pairConfigs(this.currentStake),
            () => {
                if (!this.running || this.stopRequested) return 'The runner stopped before both orders could be sent.';
                if (this.paused) return 'The runner was paused before both orders could be sent.';
                return this.lastAnalysis.status === 'MET'
                    ? null
                    : 'The Last X condition expired before both orders could be sent.';
            },
        );

        if (this.activeLivePair !== pair) return;
        pair.buyComplete = true;
        pair.acceptedIds = result.accepted.map(item => item.contractId);
        pair.failures = result.failed.map(item => `${item.side}: ${item.message}`);
        pair.partial = pair.acceptedIds.length > 0 && pair.acceptedIds.length < 2;

        if (!pair.acceptedIds.length) {
            releaseBotContractGate(this);
            this.activeLivePair = null;
            const cancelled = result.failed.every(item =>
                /condition expired|runner stopped|paused/i.test(item.message)
            );
            if (cancelled && this.running && !this.stopRequested) {
                this.writeLog('No real trades sent: the entry condition expired before purchase.', 'system');
                this.setStatus('scanning');
                return;
            }
            if (pair.failures.length) this.writeLog(`Paired order failed: ${pair.failures.join(' · ')}`, 'error');
            if (this.running) {
                this.running = false;
                this.stopRequested = true;
                this.setStatus('error');
            }
            this.finishStop();
            return;
        }

        if (pair.partial) {
            this.writeLog(
                `Only ${pair.acceptedIds.length} of 2 legs were accepted. Tracking the accepted contract, then stopping to avoid an unmatched retry. ${pair.failures.join(' · ')}`,
                'error',
            );
        } else {
            this.writeLog(
                `Both legs accepted · contracts ${pair.acceptedIds.map(id => `#${id}`).join(' + ')} · waiting for settlement.`,
                'info',
            );
        }
        this.setStatus('waiting');
        this.emitStats();
        this.finishLivePairIfSettled(pair);
    }

    private pairConfigs(stake: number): DTDigitPairLegConfig[] {
        const common = {
            symbol: this.config.symbol,
            currency: this.config.currency,
            stake,
            durationValue: 1,
            durationUnit: 't' as const,
        };
        return [
            {
                side: 'over',
                config: {
                    ...common,
                    contractType: 'DIGITOVER',
                    barrier: String(this.config.overPrediction),
                },
            },
            {
                side: 'under',
                config: {
                    ...common,
                    contractType: 'DIGITUNDER',
                    barrier: String(this.config.underPrediction),
                },
            },
        ];
    }

    private handlePosition(position: DTPosition): void {
        const pair = this.activeLivePair;
        if (pair) {
            pair.positions.set(position.contractId, { ...position });
            this.onPosition({ ...position });
            if (!position.isOpen) this.finishLivePairIfSettled(pair);
            else this.emitStats();
            return;
        }
        this.onPosition({ ...position });
    }

    private finishLivePairIfSettled(pair: LivePair): void {
        if (this.activeLivePair !== pair || !pair.buyComplete || pair.acceptedIds.length === 0) return;
        if (pair.acceptedIds.some(id => pair.positions.get(id)?.isOpen !== false)) return;

        const pairProfit = pair.acceptedIds.reduce(
            (sum, id) => sum + (pair.positions.get(id)?.profit ?? 0),
            0,
        );
        this.activeLivePair = null;
        releaseBotContractGate(this);
        this.totalProfit = Number((this.totalProfit + pairProfit).toFixed(2));
        if (pairProfit > 0) {
            this.wins += 1;
            this.currentStake = this.config.initialStake;
            this.writeLog(
                `Real pair win · ${this.signedMoney(pairProfit)} · stake reset to $${this.currentStake.toFixed(2)} per leg.`,
                'win',
            );
        } else if (pairProfit < 0) {
            this.losses += 1;
            this.currentStake = Number((this.currentStake * this.config.martingale).toFixed(2));
            this.writeLog(
                `Real pair loss · ${this.signedMoney(pairProfit)} · next stake $${this.currentStake.toFixed(2)} per leg.`,
                'loss',
            );
        } else {
            this.writeLog(
                `Real pair break-even · ${this.signedMoney(pairProfit)} · stake remains $${this.currentStake.toFixed(2)} per leg.`,
                'system',
            );
        }
        this.consecutiveVirtualLosses = 0;
        this.emitStats();

        if (pair.partial) {
            this.running = false;
            this.stopRequested = true;
            this.writeLog('Runner stopped after the unmatched single-leg settlement. Review the journal before restarting.', 'error');
            this.setStatus('error');
        } else if (this.totalProfit >= this.config.takeProfit) {
            this.running = false;
            this.stopRequested = true;
            this.onAlert({ kind: 'tp', profit: this.totalProfit });
            this.writeLog(`Take Profit reached at ${this.signedMoney(this.totalProfit)}.`, 'win');
            this.setStatus('stopped');
        } else if (this.totalProfit <= -this.config.stopLoss) {
            this.running = false;
            this.stopRequested = true;
            this.onAlert({ kind: 'sl', profit: this.totalProfit });
            this.writeLog(`Stop Loss reached at ${this.signedMoney(this.totalProfit)}.`, 'loss');
            this.setStatus('stopped');
        } else if (this.running && !this.paused) {
            this.setStatus('scanning');
        }

        if (this.stopRequested) this.finishStop();
    }

    private handleTraderStatus(status: DTStatus): void {
        if (!this.running) return;
        if (status === 'error') {
            this.writeLog('Deriv connection reported an error; no further entries will be attempted until it recovers.', 'error');
            this.setStatus('error');
        } else if (status === 'ready') {
            if (!this.paused && !this.activeLivePair && !this.pendingQuotes) this.setStatus('scanning');
        }
    }

    private finishStop(): void {
        if (this.activeLivePair || this.pendingQuotes) return;
        this.pendingVirtualPair = null;
        this.trader.stop();
        releaseBotContractGate(this);
        this.releaseRunLease();
        if (getActiveEngine() === this) setActiveEngine(null);
        this.running = false;
        this.stopRequested = false;
        if (this.status !== 'error') this.setStatus('stopped');
    }

    private getRunLeaseStorageKey(): string | null {
        if (!this.config.accountId || typeof window === 'undefined') return null;
        return `${RUN_LEASE_STORAGE_PREFIX}${encodeURIComponent(this.config.accountId)}`;
    }

    private acquireRunLease(): boolean {
        const key = this.getRunLeaseStorageKey();
        if (!key) return true;
        try {
            const now = Date.now();
            const existing = JSON.parse(window.localStorage.getItem(key) || 'null') as
                | { ownerId?: string; expiresAt?: number }
                | null;
            if (
                existing?.ownerId !== this.runLeaseId &&
                Number(existing?.expiresAt) > now
            ) {
                return false;
            }
            window.localStorage.setItem(
                key,
                JSON.stringify({ ownerId: this.runLeaseId, expiresAt: now + RUN_LEASE_TTL_MS }),
            );
            const confirmed = JSON.parse(window.localStorage.getItem(key) || 'null') as
                | { ownerId?: string }
                | null;
            return confirmed?.ownerId === this.runLeaseId;
        } catch {
            return false;
        }
    }

    private refreshRunLease(): boolean {
        const key = this.getRunLeaseStorageKey();
        if (!key) return true;
        try {
            const current = JSON.parse(window.localStorage.getItem(key) || 'null') as
                | { ownerId?: string; expiresAt?: number }
                | null;
            if (current?.ownerId !== this.runLeaseId) return false;
            const now = Date.now();
            if (Number(current.expiresAt) - now > RUN_LEASE_TTL_MS / 2) return true;
            window.localStorage.setItem(
                key,
                JSON.stringify({ ownerId: this.runLeaseId, expiresAt: now + RUN_LEASE_TTL_MS }),
            );
            const confirmed = JSON.parse(window.localStorage.getItem(key) || 'null') as
                | { ownerId?: string }
                | null;
            return confirmed?.ownerId === this.runLeaseId;
        } catch {
            return false;
        }
    }

    private startRunLeaseHeartbeat(): void {
        if (!this.getRunLeaseStorageKey() || this.runLeaseTimer) return;
        this.runLeaseTimer = setInterval(() => {
            if (!this.refreshRunLease()) this.stopAfterRunLeaseLost();
        }, RUN_LEASE_HEARTBEAT_MS);
    }

    private releaseRunLease(): void {
        if (this.runLeaseTimer) {
            clearInterval(this.runLeaseTimer);
            this.runLeaseTimer = null;
        }
        const key = this.getRunLeaseStorageKey();
        if (!key) return;
        try {
            const current = JSON.parse(window.localStorage.getItem(key) || 'null') as
                | { ownerId?: string }
                | null;
            if (current?.ownerId === this.runLeaseId) window.localStorage.removeItem(key);
        } catch {
            // The lease expires automatically if browser storage is unavailable during shutdown.
        }
    }

    private stopAfterRunLeaseLost(): void {
        if (!this.running) return;
        this.writeLog(
            'Another Edging pro tab now owns this account. No new pairs will be submitted here.',
            'error',
        );
        this.stop();
    }

    private setStatus(status: EdgingProStatus): void {
        if (this.status === status) return;
        this.status = status;
        this.onStatus(status);
    }

    private emitStats(): void {
        this.onStats({
            profit: this.totalProfit,
            wins: this.wins,
            losses: this.losses,
            currentStake: this.currentStake,
            consecutiveVirtualLosses: this.consecutiveVirtualLosses,
            activeContracts: this.activeLivePair?.acceptedIds.length ?? 0,
            lastAnalysis: this.lastAnalysis,
        });
    }

    private signedMoney(value: number): string {
        return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
    }

    private writeLog(message: string, type: DTLog['type']): void {
        this.onLog({
            seq: Date.now(),
            time: new Date().toTimeString().slice(0, 8),
            message,
            type,
        });
    }
}
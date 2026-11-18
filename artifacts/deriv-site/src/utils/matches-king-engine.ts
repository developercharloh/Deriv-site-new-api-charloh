import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { releaseBotContractGate, tryAcquireBotContractGate } from './bot-contract-gate';
import { getDerivRateLimitBackoffMs, isDerivRateLimitError } from './deriv-rate-limit';
import {
    DTraderEngine,
    type DTDigitPairResult,
    type DTLog,
    type DTPosition,
    type DTStatus,
} from './dtrader-engine';
import {
    getMatchesKingVirtualDigitOutcomes,
    getMatchesKingBatchCost,
    matchesKingVirtualBatchWon,
    settleMatchesKingBatch,
} from './matches-king-strategy';

export interface MatchesKingConfig {
    symbol: string;
    currency: string;
    accountId?: string;
    digits: number[];
    stake: number;
    martingale: number;
    takeProfit: number;
    stopLoss: number;
    useVirtualHook?: boolean;
    virtualLossThreshold: number;
    waitForInitialCandleClose?: boolean;
}

export type MatchesKingStatus = 'scanning' | 'timing' | 'virtual' | 'buying' | 'waiting' | 'stopping' | 'paused' | 'stopped' | 'error';

interface VirtualBatch {
    entrySerial: number;
    entryEpoch?: number;
    entrySpot: string;
}

interface LiveBatch {
    acceptedIds: string[];
    positions: Map<string, DTPosition>;
    buyComplete: boolean;
    partial: boolean;
    rateLimited: boolean;
}

type LockManager = {
    request: (
        name: string,
        options: { mode: 'exclusive'; ifAvailable: boolean },
        callback: (lock: unknown | null) => Promise<void>
    ) => Promise<void>;
};

export class MatchesKingEngine {
    private readonly trader = new DTraderEngine({ sharedContractTracking: true });
    private running = false;
    private paused = false;
    private stopping = false;
    private lockPending = false;
    private releaseLock: (() => void) | null = null;
    private tickSerial = 0;
    private lastTickKey: string | null = null;
    private lastEntryEpoch: string | null = null;
    private initialCandleClosePending = false;
    private latestEpoch?: number;
    private latestSpot = '';
    private virtualBatch: VirtualBatch | null = null;
    private liveBatch: LiveBatch | null = null;
    private currentStake: number;
    private totalProfit = 0;
    private virtualLosses = 0;
    private rateLimitAttempts = 0;
    private rateLimitUntil = 0;
    private rateLimitTimer: ReturnType<typeof setTimeout> | null = null;

    onLog: (log: DTLog) => void = () => {};
    onStatus: (status: MatchesKingStatus) => void = () => {};
    onPosition: (position: DTPosition) => void = () => {};
    onVirtualSettlement: (settlement: {
        outcome: 'win' | 'loss';
        market: string;
        contractType: 'DIGITMATCH';
        prediction: number;
        entryEpoch?: number;
        settlementEpoch?: number;
        entrySpot?: string;
        exitSpot?: string;
        tickSerial: number;
    }) => void = () => {};
    onAlert: (kind: 'tp' | 'sl', profit: number) => void = () => {};

    constructor(private readonly config: MatchesKingConfig) {
        this.currentStake = config.stake;
        this.initialCandleClosePending = config.waitForInitialCandleClose === true;
        this.trader.onTick = (spot, digit, epoch, tickId) => this.handleTick(spot, digit, epoch, tickId);
        this.trader.onPosition = position => this.handlePosition(position);
        this.trader.onStatus = status => this.handleTraderStatus(status);
        this.trader.onLog = log => this.onLog(log);
    }

    start(): boolean {
        if (this.running || this.lockPending) return true;
        if (!api_base.api || !api_base.is_authorized) return this.fail('Log in to Deriv before starting Matches King.');
        if (!this.isConfigValid()) return this.fail('Check the digits, stake, risk limits, Martingale, and Virtual Hook threshold.');
        if (!this.config.accountId?.trim()) return this.fail('Cannot verify the active account. No trades were sent.');
        const locks = typeof navigator !== 'undefined' ? (navigator as any).locks as LockManager | undefined : undefined;
        if (!locks?.request) return this.fail('This browser cannot enforce an account-wide run lock. No trades were sent.');

        this.lockPending = true;
        void locks.request(
            `deriv-matches-king:${encodeURIComponent(this.config.accountId.trim())}`,
            { mode: 'exclusive', ifAvailable: true },
            async lock => {
                if (!this.lockPending) return;
                if (!lock) {
                    this.fail('Matches King is already running in another tab for this account.');
                    return;
                }
                this.lockPending = false;
                this.running = true;
                this.stopping = false;
                this.rateLimitAttempts = 0;
                this.rateLimitUntil = 0;
                this.initialCandleClosePending = this.config.waitForInitialCandleClose === true;
                this.setStatus(this.initialCandleClosePending ? 'timing' : 'scanning');
                this.trader.start({
                    symbol: this.config.symbol,
                    currency: this.config.currency,
                    contractType: 'DIGITMATCH',
                    barrier: String(this.config.digits[0]),
                    durationValue: 1,
                    durationUnit: 't',
                    stake: this.currentStake,
                });
                this.log(
                    `Started on ${this.config.symbol}. ${this.config.digits.length} digit contracts at $${this.currentStake.toFixed(2)} each; batch stake $${getMatchesKingBatchCost(this.currentStake, this.config.digits.length).toFixed(2)}.`
                );
                this.log(
                    this.config.useVirtualHook === false
                        ? 'Virtual Hook: OFF for this run; selected contracts will be bought directly on qualifying ticks.'
                        : `Virtual Hook: ON for this run; live purchases wait for ${this.config.virtualLossThreshold} consecutive all-loss batches.`
                );
                if (this.initialCandleClosePending) {
                    this.log('Waiting for 00:02 before the next one-minute candle close for the first entry; later batches will run continuously.');
                }
                await new Promise<void>(resolve => {
                    this.releaseLock = resolve;
                });
            }
        ).catch(() => this.fail('Could not acquire the account-wide run lock.'));
        return true;
    }

    pause(): void {
        if (!this.running || this.paused) return;
        this.paused = true;
        this.log('Paused new entries; open contracts will still settle.');
        this.setStatus(this.liveBatch ? 'waiting' : 'paused');
    }

    resume(): void {
        if (!this.running || !this.paused) return;
        this.paused = false;
        this.setStatus(
            this.initialCandleClosePending
                ? 'timing'
                : this.liveBatch || Date.now() < this.rateLimitUntil
                  ? 'waiting'
                : 'scanning'
        );
    }

    stop(): void {
        if (this.rateLimitTimer) {
            clearTimeout(this.rateLimitTimer);
            this.rateLimitTimer = null;
        }
        if (this.lockPending) {
            this.lockPending = false;
            this.paused = false;
            this.setStatus('stopped');
            return;
        }
        this.running = false;
        this.paused = false;
        this.stopping = true;
        this.virtualBatch = null;
        if (!this.liveBatch) {
            this.finishStop();
            return;
        }
        this.finishLiveBatchIfSettled(this.liveBatch);
        if (this.liveBatch) this.setStatus('stopping');
    }

    private isConfigValid(): boolean {
        return (
            this.config.digits.length >= 1 &&
            this.config.digits.length <= 10 &&
            new Set(this.config.digits).size === this.config.digits.length &&
            this.config.digits.every(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9) &&
            Number.isFinite(this.config.stake) &&
            this.config.stake > 0 &&
            Number.isFinite(this.config.martingale) &&
            this.config.martingale >= 1 &&
            Number.isFinite(this.config.takeProfit) &&
            this.config.takeProfit > 0 &&
            Number.isFinite(this.config.stopLoss) &&
            this.config.stopLoss > 0 &&
            (this.config.useVirtualHook === false ||
                (Number.isInteger(this.config.virtualLossThreshold) &&
                    this.config.virtualLossThreshold >= 1))
        );
    }

    private handleTick(spot: string, digit: number, epoch?: number, tickId?: string): void {
        if (!this.running) return;
        const key = Number.isFinite(epoch) ? `${epoch}:${tickId ?? spot}` : tickId ?? `${this.tickSerial}:${spot}`;
        if (key === this.lastTickKey) return;
        this.lastTickKey = key;
        this.tickSerial += 1;
        this.latestSpot = spot;
        this.latestEpoch = epoch;

        if (this.virtualBatch && this.tickSerial > this.virtualBatch.entrySerial) {
            this.settleVirtualBatch(digit, spot, epoch);
            return;
        }
        if (this.initialCandleClosePending) {
            const elapsedSeconds = Number.isFinite(epoch)
                ? ((Number(epoch) % 60) + 60) % 60
                : null;
            const secondsToClose = elapsedSeconds === null
                ? null
                : Math.ceil(60 - elapsedSeconds);
            if (this.paused || secondsToClose !== 2) {
                if (!this.paused) this.setStatus('timing');
                return;
            }
            this.initialCandleClosePending = false;
            this.log('Initial 00:02 entry point reached; later Matches King batches will run continuously.');
        }
        if (Date.now() < this.rateLimitUntil) {
            this.setStatus('waiting');
            return;
        }
        const entryKey = Number.isFinite(epoch) ? String(epoch) : key;
        if (
            this.paused ||
            this.liveBatch ||
            this.virtualBatch ||
            entryKey === this.lastEntryEpoch
        ) return;
        this.lastEntryEpoch = entryKey;
        if (this.config.useVirtualHook !== false && this.virtualLosses < this.config.virtualLossThreshold) {
            this.virtualBatch = { entrySerial: this.tickSerial, entryEpoch: epoch, entrySpot: spot };
            this.setStatus('virtual');
            this.log(
                `Virtual batch opened: [${this.config.digits.join(', ')}], $${this.currentStake.toFixed(2)} each.`
            );
            return;
        }
        void this.buyLiveBatch(epoch);
    }

    private settleVirtualBatch(digit: number, spot: string, epoch?: number): void {
        const batch = this.virtualBatch;
        if (!batch) return;
        this.virtualBatch = null;
        const batchWon = matchesKingVirtualBatchWon(digit, this.config.digits);
        for (const { prediction, outcome } of getMatchesKingVirtualDigitOutcomes(digit, this.config.digits)) {
            this.onVirtualSettlement({
                outcome,
                market: this.config.symbol,
                contractType: 'DIGITMATCH',
                prediction,
                entryEpoch: batch.entryEpoch,
                settlementEpoch: epoch,
                entrySpot: batch.entrySpot,
                exitSpot: spot,
                tickSerial: batch.entrySerial,
            });
        }
        if (batchWon) {
            this.virtualLosses = 0;
            this.log(`Virtual digit ${digit} matched; Virtual Hook loss streak reset.`);
        } else {
            this.virtualLosses += 1;
            this.log(
                `Virtual batch lost on digit ${digit}: ${this.virtualLosses}/${this.config.virtualLossThreshold} consecutive losses.`
            );
        }
        this.setStatus('scanning');
    }

    private async buyLiveBatch(entryEpoch?: number): Promise<void> {
        if (!this.running || this.paused || this.liveBatch) return;
        let acquiredLeases = 0;
        while (
            acquiredLeases < this.config.digits.length &&
            tryAcquireBotContractGate(this, undefined, true)
        ) {
            acquiredLeases += 1;
        }
        if (acquiredLeases !== this.config.digits.length) {
            if (acquiredLeases) releaseBotContractGate(this);
            this.log('Entry skipped because another bot owns the live contract gate.');
            return;
        }
        const batch: LiveBatch = {
            acceptedIds: [],
            positions: new Map(),
            buyComplete: false,
            partial: false,
            rateLimited: false,
        };
        this.liveBatch = batch;
        this.setStatus('buying');
        const configs = this.config.digits.map(digit => ({
            side: String(digit),
            config: {
                symbol: this.config.symbol,
                currency: this.config.currency,
                contractType: 'DIGITMATCH' as const,
                barrier: String(digit),
                durationValue: 1,
                durationUnit: 't' as const,
                stake: this.currentStake,
            },
        }));
        this.log(
            `Buying digits [${this.config.digits.join(', ')}] once each at $${this.currentStake.toFixed(2)} per contract ($${getMatchesKingBatchCost(this.currentStake, this.config.digits.length).toFixed(2)} total).`
        );
        const result: DTDigitPairResult = await this.trader.buyDigitBatchNow(configs, () =>
            !this.running || this.paused || (Number.isFinite(entryEpoch) && this.latestEpoch !== entryEpoch)
                ? 'The entry tick expired before all digit contracts could be sent.'
                : null
        );
        if (this.liveBatch !== batch) return;
        batch.buyComplete = true;
        batch.acceptedIds = result.accepted.map(item => item.contractId);
        batch.partial = batch.acceptedIds.length > 0 && batch.acceptedIds.length < this.config.digits.length;
        batch.rateLimited =
            result.failed.length > 0 && result.failed.every(item => isDerivRateLimitError(item.message));
        if (!batch.acceptedIds.length) {
            this.liveBatch = null;
            releaseBotContractGate(this);
            const errors = result.failed.map(item => `${item.side}: ${item.message}`).join(' · ');
            this.log(errors || 'No digit contracts were accepted.', 'error');
            if (batch.rateLimited && this.running && !this.stopping) {
                this.applyRateLimitCooldown('buy');
                return;
            }
            this.running = false;
            this.finishStop();
            return;
        }
        if (!result.failed.length) this.rateLimitAttempts = 0;
        const continuingAfterRateLimit = batch.rateLimited && this.running && !this.stopping;
        if (continuingAfterRateLimit) this.applyRateLimitCooldown('buy');
        if (batch.partial) {
            this.log(
                continuingAfterRateLimit
                    ? `Deriv rate-limited part of the batch: ${batch.acceptedIds.length}/${this.config.digits.length} contracts were accepted. Tracking accepted contracts; the run will continue after cooldown without resending them.`
                    : batch.rateLimited && this.stopping
                      ? `Deriv rate-limited part of the batch after Stop was pressed. Tracking only accepted contracts, then finishing the requested Stop.`
                    : `Only ${batch.acceptedIds.length}/${this.config.digits.length} contracts were accepted. Tracking them, then stopping to prevent a duplicate batch.`,
                continuingAfterRateLimit || (batch.rateLimited && this.stopping) ? 'system' : 'error'
            );
        }
        this.setStatus(this.stopping ? 'stopping' : 'waiting');
        for (const item of result.failed) this.log(`Digit ${item.side} was rejected: ${item.message}`, 'error');
        this.finishLiveBatchIfSettled(batch);
    }

    private handlePosition(position: DTPosition): void {
        this.onPosition(position);
        const batch = this.liveBatch;
        if (!batch || (batch.acceptedIds.length && !batch.acceptedIds.includes(position.contractId))) return;
        batch.positions.set(position.contractId, { ...position });
        this.finishLiveBatchIfSettled(batch);
    }

    private finishLiveBatchIfSettled(batch: LiveBatch): void {
        if (this.liveBatch !== batch || !batch.buyComplete || !batch.acceptedIds.length) return;
        if (batch.acceptedIds.some(id => batch.positions.get(id)?.isOpen !== false)) return;
        const positions = batch.acceptedIds.map(id => batch.positions.get(id)!);
        const settlement = settleMatchesKingBatch(
            positions.map(position => Number(position.profit) || 0),
            this.currentStake,
            this.config.stake,
            this.config.martingale
        );
        const batchProfit = settlement.combinedProfit;
        this.totalProfit = Number((this.totalProfit + batchProfit).toFixed(2));
        this.liveBatch = null;
        releaseBotContractGate(this);
        this.virtualLosses = 0;
        if (settlement.result === 'win') {
            this.currentStake = settlement.nextStakePerDigit;
            this.log(`At least one contract won; per-digit stake reset to $${this.currentStake.toFixed(2)}. Batch P/L ${this.money(batchProfit)}.`);
        } else if (settlement.result === 'loss') {
            this.currentStake = settlement.nextStakePerDigit;
            this.log(`All contracts lost; next per-digit stake is $${this.currentStake.toFixed(2)}. Batch P/L ${this.money(batchProfit)}.`, 'loss');
        } else {
            this.log(`Batch had no winning contract; stake unchanged. Batch P/L ${this.money(batchProfit)}.`);
        }
        if (batch.partial && !batch.rateLimited) {
            this.running = false;
            this.stopping = true;
            this.setStatus('error');
            this.log('Stopped after a partial batch. Review the Journal before restarting.', 'error');
        } else {
            if (batch.partial && batch.rateLimited && this.stopping) {
                this.log('Accepted contracts have settled; finishing the Stop you requested.');
            } else if (batch.partial && batch.rateLimited) {
                this.log(
                    `Settled the ${batch.acceptedIds.length} accepted contract(s). Matches King remains active and will resume on a fresh tick after cooldown.`
                );
            }
            if (this.totalProfit >= this.config.takeProfit) {
                this.onAlert('tp', this.totalProfit);
                this.running = false;
                this.stopping = true;
                this.setStatus('stopped');
                this.log(`Take Profit reached at ${this.money(this.totalProfit)}.`);
            } else if (this.totalProfit <= -this.config.stopLoss) {
                this.onAlert('sl', this.totalProfit);
                this.running = false;
                this.stopping = true;
                this.setStatus('stopped');
                this.log(`Stop Loss reached at ${this.money(this.totalProfit)}.`, 'loss');
            } else if (this.running && !this.paused) {
                this.setStatus(Date.now() < this.rateLimitUntil ? 'waiting' : 'scanning');
            }
        }
        if (this.stopping) this.finishStop();
    }

    private handleTraderStatus(status: DTStatus): void {
        if (status === 'error' && this.running) {
            this.log('Deriv reported a connection error; stopping new entries.', 'error');
            this.running = false;
            this.stopping = true;
            if (!this.liveBatch) this.finishStop();
            else this.setStatus('waiting');
        }
    }

    private finishStop(): void {
        if (this.liveBatch) return;
        if (this.rateLimitTimer) {
            clearTimeout(this.rateLimitTimer);
            this.rateLimitTimer = null;
        }
        this.trader.stop();
        releaseBotContractGate(this);
        this.running = false;
        this.stopping = false;
        this.releaseLock?.();
        this.releaseLock = null;
        this.setStatus('stopped');
    }

    private applyRateLimitCooldown(context: string): void {
        this.rateLimitAttempts += 1;
        const delayMs = getDerivRateLimitBackoffMs(this.rateLimitAttempts);
        this.rateLimitUntil = Math.max(this.rateLimitUntil, Date.now() + delayMs);
        if (this.rateLimitTimer) clearTimeout(this.rateLimitTimer);
        const waitMs = Math.max(0, this.rateLimitUntil - Date.now());
        this.log(
            `Deriv rate limit on ${context}. Keeping the run active; new entries are paused for ${Math.ceil(waitMs / 1_000)}s and will resume on a fresh tick.`,
            'error'
        );
        if (!this.paused) this.setStatus('waiting');
        this.rateLimitTimer = setTimeout(() => {
            this.rateLimitTimer = null;
            if (this.running && !this.paused && !this.liveBatch) this.setStatus('scanning');
        }, waitMs);
    }

    private fail(message: string): false {
        this.log(message, 'error');
        this.setStatus('error');
        return false;
    }

    private setStatus(status: MatchesKingStatus): void {
        this.onStatus(status);
    }

    private log(message: string, type: DTLog['type'] = 'system'): void {
        this.onLog({ seq: Date.now(), time: new Date().toTimeString().slice(0, 8), message, type });
    }

    private money(value: number): string {
        return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
    }
}

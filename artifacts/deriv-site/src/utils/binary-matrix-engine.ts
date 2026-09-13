// ─── Binary Matrix AI native execution engine ─────────────────────────────────
//
// Runs the supplied Binary Matrix strategy through DTraderEngine. DTraderEngine owns
// Deriv WebSocket authentication, proposals, buys, and open-contract
// settlement; this class owns only the strategy state machine.

import {
    DTraderEngine,
    type DTLog,
    type DTPosition,
    type DTStatus,
} from './dtrader-engine';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { evaluateBinaryMatrix, type BinaryMatrixDecision } from './binary-matrix-strategy';
import { BinaryMatrixExecutionCore } from './binary-matrix-execution-core';
import {
    releaseBotContractGate,
    setBotContractGateContract,
    tryAcquireBotContractGate,
} from './bot-contract-gate';

export interface BinaryMatrixConfig {
    symbol: string;
    currency: string;
    initialStake: number;
    martingale: number;
    takeProfit: number;
    stopLoss: number;
    reanalyzeAfterWins: number;
}

export type BinaryMatrixStatus =
    | 'idle'
    | 'scanning'
    | 'buying'
    | 'waiting'
    | 'stopped'
    | 'error';

export interface BinaryMatrixStats {
    profit: number;
    wins: number;
    losses: number;
    currentStake: number;
    qualifyingWins: number;
    lastDecision: BinaryMatrixDecision | null;
    openContractId: string | null;
}

export interface BinaryMatrixTrade {
    contractId: string;
    decision: BinaryMatrixDecision;
    stake: number;
    profit: number;
    isWin: boolean;
    totalProfit: number;
}

let activeBinaryMatrixEngine: BinaryMatrixEngine | null = null;
const ACTIVE_ENGINE_KEY = '__DERIV_BINARY_MATRIX_ACTIVE_ENGINE__';

const getGlobalActiveEngine = (): BinaryMatrixEngine | null =>
    (globalThis as Record<string, unknown>)[ACTIVE_ENGINE_KEY] as BinaryMatrixEngine | null;

const setGlobalActiveEngine = (engine: BinaryMatrixEngine | null): void => {
    const globalState = globalThis as Record<string, unknown>;
    if (engine) {
        globalState[ACTIVE_ENGINE_KEY] = engine;
    } else {
        delete globalState[ACTIVE_ENGINE_KEY];
    }
};

export class BinaryMatrixEngine {
    private readonly trader = new DTraderEngine();
    private readonly execution: BinaryMatrixExecutionCore;
    private config: BinaryMatrixConfig;
    private running = false;
    private currentStake: number;
    private totalProfit = 0;
    private wins = 0;
    private losses = 0;
    private qualifyingWins = 0;
    private digits: number[] = [];
    private pendingDecision: BinaryMatrixDecision | null = null;
    private openContractId: string | null = null;
    private settledContracts = new Set<string>();
    private tickSerial = 0;
    private purchaseTickSerial = 0;

    public onLog: (log: DTLog) => void = () => {};
    public onStatus: (status: BinaryMatrixStatus) => void = () => {};
    public onStats: (stats: BinaryMatrixStats) => void = () => {};
    public onPosition: (position: DTPosition) => void = () => {};
    public onTrade: (trade: BinaryMatrixTrade) => void = () => {};
    public onAlert: (alert: { kind: 'tp' | 'sl'; profit: number }) => void = () => {};

    constructor(config: BinaryMatrixConfig) {
        this.config = config;
        this.execution = new BinaryMatrixExecutionCore(config);
        this.currentStake = this.execution.snapshot().currentStake;
        this.bindTrader();
    }

    start(): boolean {
        if (this.running) return true;
        const globalActiveEngine = getGlobalActiveEngine();
        if (
            (activeBinaryMatrixEngine && activeBinaryMatrixEngine !== this)
            || (globalActiveEngine && globalActiveEngine !== this)
        ) {
            this.log({
                seq: Date.now(),
                time: this.nowTime(),
                message: 'Binary Matrix AI is already running. The second runner was blocked to prevent duplicate contracts.',
                type: 'error',
            });
            this.onStatus('error');
            return false;
        }
        if (!api_base.api || !api_base.is_authorized) {
            this.log({
                seq: Date.now(),
                time: this.nowTime(),
                message: 'Log in to a Deriv account before starting Binary Matrix AI.',
                type: 'error',
            });
            this.onStatus('error');
            return false;
        }

        this.running = true;
        this.currentStake = this.config.initialStake;
        this.execution.reset(this.config);
        this.totalProfit = 0;
        this.wins = 0;
        this.losses = 0;
        this.qualifyingWins = 0;
        this.digits = [];
        this.pendingDecision = null;
        this.openContractId = null;
        this.settledContracts.clear();
        this.tickSerial = 0;
        this.purchaseTickSerial = 0;
        this.emitStats();

        activeBinaryMatrixEngine = this;
        setGlobalActiveEngine(this);
        const started = this.trader.start({
            symbol: this.config.symbol,
            contractType: 'DIGITEVEN',
            durationValue: 1,
            durationUnit: 't',
            stake: this.currentStake,
            barrier: null,
            currency: this.config.currency,
        });

        if (!started) {
            this.running = false;
            if (activeBinaryMatrixEngine === this) activeBinaryMatrixEngine = null;
            if (getGlobalActiveEngine() === this) setGlobalActiveEngine(null);
            this.onStatus('error');
            return false;
        }

        this.onStatus('scanning');
        this.writeLog(`Scanning ${this.config.symbol} for the registered matrix conditions.`, 'system');
        return true;
    }

    stop(): void {
        if (activeBinaryMatrixEngine === this) activeBinaryMatrixEngine = null;
        if (getGlobalActiveEngine() === this) setGlobalActiveEngine(null);
        if (!this.running && !this.openContractId) return;
        this.running = false;
        this.pendingDecision = null;
        this.openContractId = null;
        releaseBotContractGate(this);
        this.trader.stop();
        this.onStatus('stopped');
        this.writeLog('Binary Matrix AI stopped. No new contracts will be placed.', 'system');
        this.emitStats();
    }

    updateConfig(config: Partial<BinaryMatrixConfig>): void {
        this.config = { ...this.config, ...config };
        this.execution.updateConfig(config);
        if (!this.openContractId && !this.pendingDecision) {
            this.currentStake = this.execution.snapshot().currentStake;
            this.emitStats();
        }
    }

    private bindTrader(): void {
        this.trader.onTick = (_spot, digit) => {
            if (!this.running) return;
            this.tickSerial += 1;
            this.digits = [...this.digits, digit].slice(-4);
            if (this.openContractId || this.pendingDecision) return;

            this.tryPurchaseFromLatestTick();
        };

        this.trader.onPosition = position => this.handlePosition(position);
        this.trader.onStatus = status => this.handleTraderStatus(status);
        this.trader.onLog = log => this.log(log);
        this.trader.onBuyFeedback = feedback => {
            if (feedback.kind !== 'error') return;
            this.execution.rejectPurchase();
            releaseBotContractGate(this);
            this.pendingDecision = null;
            this.onStatus('error');
            this.writeLog(feedback.message, 'error');
            this.emitStats();
        };
    }

    private tryPurchaseFromLatestTick(): void {
        if (!this.running || this.openContractId || this.pendingDecision) return;

            const decision = evaluateBinaryMatrix(this.digits);
            if (!decision) {
                this.onStatus('scanning');
                return;
            }

            if (!tryAcquireBotContractGate(this)) {
                this.writeLog('A contract is already being handled by another bot runner; signal skipped.', 'system');
                return;
            }

            const purchase = this.execution.beginPurchase(decision);
            if (!purchase) {
                releaseBotContractGate(this);
                return;
            }

            this.pendingDecision = purchase.decision;
            this.purchaseTickSerial = this.tickSerial;
            this.onStatus('buying');
            this.writeLog(
                `${purchase.decision.reason} · ${purchase.decision.label} · stake $${purchase.stake.toFixed(2)}`,
                'info',
            );
            this.emitStats(purchase.decision);

            this.trader.placeBuyNow({
                contractType: purchase.decision.contractType,
                barrier: purchase.decision.barrier,
                stake: purchase.stake,
                durationValue: 1,
                durationUnit: 't',
            });
    }

    private handleTraderStatus(status: DTStatus): void {
        if (!this.running) return;
        if (status === 'error') this.onStatus('error');
        else if (status === 'ready' && !this.openContractId && !this.pendingDecision) this.onStatus('scanning');
    }

    private handlePosition(position: DTPosition): void {
        if (!this.running && !position.isOpen) return;
        if (position.isOpen) {
            if (this.openContractId === null) {
                if (!this.execution.acceptPurchase(position.contractId)) {
                    this.onStatus('error');
                    this.writeLog(`Rejected unexpected contract #${position.contractId}.`, 'error');
                    return;
                }
                this.openContractId = position.contractId;
                setBotContractGateContract(this, position.contractId);
                this.pendingDecision = null;
                this.onStatus('waiting');
                this.writeLog(
                    `Bought #${position.contractId} · ${this.labelFor(position)} · waiting for one-tick settlement.`,
                    'info',
                );
                this.emitStats();
                this.onPosition({ ...position });
            }
            return;
        }

        if (this.settledContracts.has(position.contractId)) return;
        if (this.openContractId !== position.contractId) return;

        this.settledContracts.add(position.contractId);
        const settlement = this.execution.settle({
            contractId: position.contractId,
            profit: position.profit ?? 0,
            isWin: position.isWin === true,
        });
        if (!settlement.accepted) return;

        releaseBotContractGate(this, position.contractId);
        this.openContractId = null;
        this.pendingDecision = null;

        const profit = position.profit ?? 0;
        const isWin = position.isWin === true;
        const snapshot = this.execution.snapshot();
        this.totalProfit = snapshot.totalProfit;
        this.currentStake = snapshot.currentStake;
        this.wins = snapshot.wins;
        this.losses = snapshot.losses;

        if (isWin) {
            this.qualifyingWins += 1;
            this.writeLog(`WIN #${position.contractId} · ${this.signedMoney(profit)} · stake reset.`, 'win');
        } else {
            this.writeLog(
                `LOSS #${position.contractId} · ${this.signedMoney(profit)} · next stake $${this.currentStake.toFixed(2)}.`,
                'loss',
            );
        }

        if (this.qualifyingWins >= this.config.reanalyzeAfterWins) {
            this.qualifyingWins = 0;
            this.digits = [];
            this.writeLog(`Re-analysis threshold reached after ${this.config.reanalyzeAfterWins} wins.`, 'system');
        }

        this.emitStats();
        this.onPosition({ ...position });
        this.onTrade({
            contractId: position.contractId,
            decision: this.lastDecision(position),
            stake: position.stake,
            profit,
            isWin,
            totalProfit: this.totalProfit,
        });

        if (settlement.shouldStop && this.totalProfit >= this.config.takeProfit) {
            this.running = false;
            this.trader.stop();
            this.onAlert({ kind: 'tp', profit: this.totalProfit });
            this.onStatus('stopped');
            this.writeLog(`Take Profit reached at ${this.signedMoney(this.totalProfit)}.`, 'win');
            return;
        }
        if (settlement.shouldStop && this.totalProfit <= -this.config.stopLoss) {
            this.running = false;
            this.trader.stop();
            this.onAlert({ kind: 'sl', profit: this.totalProfit });
            this.onStatus('stopped');
            this.writeLog(`Stop Loss reached at ${this.signedMoney(this.totalProfit)}.`, 'loss');
            return;
        }

        if (this.running) {
            this.onStatus('scanning');
            // A settlement is authoritative before this call. If a fresh
            // broker tick was observed while the contract was open, process
            // it immediately instead of waiting for another UI/browser turn.
            if (this.tickSerial > this.purchaseTickSerial) {
                this.tryPurchaseFromLatestTick();
            }
        }
    }

    private lastDecision(position: DTPosition): BinaryMatrixDecision {
        const contractType = position.contractType;
        if (contractType === 'DIGITEVEN') {
            return {
                direction: 0,
                purchaseType: 'DIGITEVEN',
                contractType,
                barrier: null,
                blockType: 'apollo_purchase2',
                label: 'EVEN',
                reason: 'Purchase mapping',
                scannedDigits: this.digits.slice(-4),
            };
        }
        if (contractType === 'DIGITODD') {
            return {
                direction: 1,
                purchaseType: 'DIGITODD',
                contractType,
                barrier: null,
                blockType: 'apollo_purchase2',
                label: 'ODD',
                reason: 'Purchase mapping',
                scannedDigits: this.digits.slice(-4),
            };
        }
        if (contractType !== 'DIGITOVER' && contractType !== 'DIGITUNDER') {
            return {
                direction: 0,
                purchaseType: 'DIGITEVEN',
                contractType: 'DIGITEVEN',
                barrier: null,
                blockType: 'apollo_purchase2',
                label: 'EVEN',
                reason: 'Purchase mapping',
                scannedDigits: this.digits.slice(-4),
            };
        }
        const barrier = Number(position.barrier ?? (contractType === 'DIGITOVER' ? 4 : 5));
        return {
            direction: contractType === 'DIGITOVER' ? 4 : 5,
            purchaseType: contractType,
            contractType,
            barrier: String(barrier),
            blockType: 'apollo_purchase2',
            label: `${contractType === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${barrier}`,
            reason: 'Purchase mapping',
            scannedDigits: this.digits.slice(-4),
        };
    }

    private labelFor(position: DTPosition): string {
        if (position.contractType === 'DIGITEVEN') return 'EVEN';
        if (position.contractType === 'DIGITODD') return 'ODD';
        return `${position.contractType === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${position.barrier ?? ''}`.trim();
    }

    private emitStats(lastDecision?: BinaryMatrixDecision): void {
        this.onStats({
            profit: this.totalProfit,
            wins: this.wins,
            losses: this.losses,
            currentStake: this.currentStake,
            qualifyingWins: this.qualifyingWins,
            lastDecision: lastDecision ?? null,
            openContractId: this.openContractId,
        });
    }

    private log(log: DTLog): void {
        this.onLog(log);
    }

    private writeLog(message: string, type: DTLog['type']): void {
        this.log({
            seq: Date.now(),
            time: this.nowTime(),
            message,
            type,
        });
    }

    private signedMoney(value: number): string {
        return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
    }

    private nowTime(): string {
        return new Date().toTimeString().slice(0, 8);
    }
}
// ─── Binary Matrix AI native execution engine ─────────────────────────────────
//
// Runs the supplied Binary Matrix strategy through DTraderEngine. DTraderEngine owns
// Deriv WebSocket authentication, proposals, buys, and open-contract
// settlement; this class owns only the strategy state machine.

import {
    DTraderEngine,
    type DTLog,
    type DTPosition,
    type DTProposal,
    type DTStatus,
} from './dtrader-engine';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import {
    analyzeBinaryMatrix,
    type BinaryMatrixAnalysis,
    type BinaryMatrixDecision,
} from './binary-matrix-strategy';
import { BinaryMatrixExecutionCore } from './binary-matrix-execution-core';
import {
    releaseBotContractGate,
    setBotContractGateContract,
    tryAcquireBotContractGate,
} from './bot-contract-gate';
import {
    BinaryMatrixMarketScanner,
    calculateRateOfChange,
    DEFAULT_BINARY_MATRIX_ROC_PERIOD,
    momentumConfirmsDecision,
    rankBinaryMatrixCandidates,
    type BinaryMatrixMarketScanRow,
    type BinaryMatrixScanSnapshot,
} from './binary-matrix-market-scanner';

export type {
    BinaryMatrixMarketScanRow,
    BinaryMatrixScanSnapshot,
} from './binary-matrix-market-scanner';

export interface BinaryMatrixConfig {
    symbol: string;
    currency: string;
    initialStake: number;
    martingale: number;
    takeProfit: number;
    stopLoss: number;
    reanalyzeAfterWins: number;
    autoMarketScan?: boolean;
    momentumPeriod?: number;
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

interface SelectedMarketEvidence {
    symbol: string;
    condition: string;
    lowerConfidenceBound: number;
    sampleCount: number;
    breakEvenWinRate: number | null;
}

let activeBinaryMatrixEngine: BinaryMatrixEngine | null = null;
const ACTIVE_ENGINE_KEY = '__DERIV_BINARY_MATRIX_ACTIVE_ENGINE__';
const MAX_ROC_PERIOD = 50;

const normalizeMomentumPeriod = (period: number | undefined): number =>
    Number.isFinite(period)
        ? Math.max(1, Math.min(MAX_ROC_PERIOD, Math.floor(period as number)))
        : DEFAULT_BINARY_MATRIX_ROC_PERIOD;

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
    private readonly marketScanner: BinaryMatrixMarketScanner;
    private config: BinaryMatrixConfig;
    private running = false;
    private paused = false;
    private stopRequested = false;
    private currentStake: number;
    private totalProfit = 0;
    private wins = 0;
    private losses = 0;
    private qualifyingWins = 0;
    private digits: number[] = [];
    private activeDecision: BinaryMatrixDecision | null = null;
    private pendingDecision: BinaryMatrixDecision | null = null;
    private openContractId: string | null = null;
    private settledContracts = new Set<string>();
    private tickSerial = 0;
    private purchaseTickSerial = 0;
    private scanSnapshot: BinaryMatrixScanSnapshot | null = null;
    private selectedMarket: SelectedMarketEvidence | null = null;
    private proposalApproved = false;
    private candidateSignalCurrent = false;
    private proposalApprovedAtTickSerial = 0;
    private momentumPrices: number[] = [];
    private rejectedCandidates = new Map<string, string>();

    public onLog: (log: DTLog) => void = () => {};
    public onStatus: (status: BinaryMatrixStatus) => void = () => {};
    public onStats: (stats: BinaryMatrixStats) => void = () => {};
    public onPosition: (position: DTPosition) => void = () => {};
    public onTrade: (trade: BinaryMatrixTrade) => void = () => {};
    public onAlert: (alert: { kind: 'tp' | 'sl'; profit: number }) => void = () => {};
    public onMarketScan: (snapshot: BinaryMatrixScanSnapshot) => void = () => {};

    constructor(config: BinaryMatrixConfig) {
        this.config = { ...config, momentumPeriod: normalizeMomentumPeriod(config.momentumPeriod) };
        this.marketScanner = new BinaryMatrixMarketScanner({ momentumPeriod: this.config.momentumPeriod });
        this.execution = new BinaryMatrixExecutionCore(this.config);
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
        this.paused = false;
        this.stopRequested = false;
        this.currentStake = this.config.initialStake;
        this.execution.reset(this.config);
        this.totalProfit = 0;
        this.wins = 0;
        this.losses = 0;
        this.qualifyingWins = 0;
        this.digits = [];
        this.activeDecision = null;
        this.pendingDecision = null;
        this.openContractId = null;
        this.settledContracts.clear();
        this.tickSerial = 0;
        this.purchaseTickSerial = 0;
        this.proposalApprovedAtTickSerial = 0;
        this.momentumPrices = [];
        this.marketScanner.stop();
        this.scanSnapshot = null;
        this.selectedMarket = null;
        this.proposalApproved = false;
        this.candidateSignalCurrent = false;
        this.rejectedCandidates.clear();
        this.emitStats();

        activeBinaryMatrixEngine = this;
        setGlobalActiveEngine(this);
        if (this.config.autoMarketScan) {
            this.onStatus('scanning');
            this.writeLog('Scanning all available volatility markets for validated Binary Matrix conditions.', 'system');
            this.marketScanner.start(
                snapshot => this.handleMarketScan(snapshot),
                message => this.writeLog(message, 'error'),
            );
            return true;
        }

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
        if (!this.running && !this.openContractId && !this.pendingDecision) return;
        if (this.stopRequested) return;
        this.stopRequested = true;
        this.paused = true;
        this.marketScanner.stop();
        this.selectedMarket = null;
        this.proposalApproved = false;
        this.candidateSignalCurrent = false;
        if (this.openContractId || this.pendingDecision) {
            this.onStatus('waiting');
            this.writeLog(
                'Stop requested. The pending purchase or open contract will be tracked to completion; no new entries will be placed.',
                'system',
            );
            this.publishScan('waiting', 'Stop requested; waiting for the current purchase or contract to finish.');
            return;
        }
        this.finishStop();
    }

    pause(): void {
        if (!this.running || this.paused || this.stopRequested) return;
        this.paused = true;
        this.writeLog('Binary Matrix AI paused. The open contract may settle, but no new contracts will be placed.', 'system');
        this.onStatus(this.openContractId ? 'waiting' : 'scanning');
        this.publishScan(this.openContractId ? 'waiting' : 'scanning', 'Runner paused; market monitoring remains active.');
    }

    resume(): void {
        if (!this.running || !this.paused || this.stopRequested) return;
        this.paused = false;
        this.writeLog('Binary Matrix AI resumed.', 'system');
        this.onStatus(this.openContractId ? 'waiting' : 'scanning');
        this.publishScan(this.openContractId ? 'waiting' : 'scanning', 'Runner resumed.');
    }

    updateConfig(config: Partial<BinaryMatrixConfig>): void {
        this.config = {
            ...this.config,
            ...config,
            momentumPeriod: normalizeMomentumPeriod(config.momentumPeriod ?? this.config.momentumPeriod),
        };
        this.execution.updateConfig(config);
        if (!this.openContractId && !this.pendingDecision) {
            this.currentStake = this.execution.snapshot().currentStake;
            this.emitStats();
        }
    }

    private bindTrader(): void {
        this.trader.onTick = (spot, digit) => {
            if (!this.running) return;
            this.tickSerial += 1;
            const quote = Number(spot);
            if (Number.isFinite(quote)) {
                this.momentumPrices = [...this.momentumPrices, quote].slice(
                    -(this.config.momentumPeriod! + 1),
                );
            }
            this.digits = [...this.digits, digit].slice(-4);
            this.publishAnalysis();
            if (this.config.autoMarketScan) {
                this.handleAdaptiveTick();
                return;
            }
            if (this.paused) return;
            if (this.openContractId || this.pendingDecision) return;

            this.tryPurchaseFromLatestTick();
        };

        this.trader.onPosition = position => this.handlePosition(position);
        this.trader.onStatus = status => this.handleTraderStatus(status);
        this.trader.onProposal = proposal => this.handleAdaptiveProposal(proposal);
        this.trader.onLog = log => this.log(log);
        this.trader.onBuyFeedback = feedback => {
            if (feedback.kind !== 'error') return;
            this.execution.rejectPurchase();
            releaseBotContractGate(this);
            this.pendingDecision = null;
            if (this.stopRequested) {
                this.finishStop();
                return;
            }
            if (this.config.autoMarketScan) {
                this.failAdaptiveRun(feedback.message);
                return;
            }
            this.onStatus('error');
            this.writeLog(feedback.message, 'error');
            this.emitStats();
        };
    }

    private handleMarketScan(snapshot: BinaryMatrixScanSnapshot): void {
        if (!this.running) return;
        this.scanSnapshot = snapshot;
        for (const [key] of this.rejectedCandidates) {
            const [symbol, condition] = key.split(':');
            const currentCondition = snapshot.rows.find(row => row.symbol === symbol)?.currentCondition;
            if (currentCondition !== condition) this.rejectedCandidates.delete(key);
        }

        if (snapshot.status === 'error') {
            this.failAdaptiveRun(snapshot.message, false);
            return;
        }

        this.publishScan(
            this.openContractId ? 'waiting' : this.selectedMarket ? 'selected' : snapshot.status,
            this.openContractId ? 'No new entry while the current contract settles.' : snapshot.message,
        );
        if (
            snapshot.status !== 'scanning' ||
            this.paused ||
            this.openContractId ||
            this.pendingDecision ||
            this.selectedMarket
        ) return;

        const candidates = rankBinaryMatrixCandidates(
            snapshot.rows.filter(row =>
                row.status === 'candidate' &&
                row.currentCondition &&
                row.score !== null &&
                row.lowerConfidenceBound !== null &&
                row.lowerConfidenceBound > 0.5 &&
                !this.rejectedCandidates.has(this.candidateKey(row.symbol, row.currentCondition)) &&
                (!this.activeDecision || this.activeDecision.condition === row.currentCondition),
            ),
            'strongest-first',
        );
        const candidate = candidates[0];
        if (candidate) this.beginAdaptiveCandidate(candidate);
    }

    private beginAdaptiveCandidate(row: BinaryMatrixMarketScanRow): void {
        if (
            !this.running ||
            this.paused ||
            this.selectedMarket ||
            this.openContractId ||
            !row.currentCondition ||
            row.lowerConfidenceBound === null
        ) {
            return;
        }

        const analysis = analyzeBinaryMatrix(row.currentDigits, this.activeDecision);
        const decision = analysis?.decision;
        if (!decision || decision.condition !== row.currentCondition) return;

        this.activeDecision = this.activeDecision ?? decision;
        this.selectedMarket = {
            symbol: row.symbol,
            condition: decision.condition ?? row.currentCondition,
            lowerConfidenceBound: row.lowerConfidenceBound,
            sampleCount: row.sampleCount,
            breakEvenWinRate: null,
        };
        this.config.symbol = row.symbol;
        this.digits = row.currentDigits.slice(-4);
        this.momentumPrices = row.recentPrices.slice(-(this.config.momentumPeriod! + 1));
        this.candidateSignalCurrent = false;
        this.proposalApproved = false;
        this.proposalApprovedAtTickSerial = 0;
        this.onStatus('scanning');
        this.writeLog(
            `Checking ${row.symbol} · ${decision.label} · ${row.sampleCount} holdout observations; requesting a live proposal.`,
            'system',
        );
        this.publishScan('selected', `Checking live payout for ${row.symbol} ${decision.label}.`);

        const started = this.trader.start({
            symbol: row.symbol,
            contractType: decision.contractType,
            durationValue: 1,
            durationUnit: 't',
            stake: this.currentStake,
            barrier: decision.barrier,
            currency: this.config.currency,
        });
        if (!started) this.failAdaptiveRun(`Could not start the live feed for ${row.symbol}.`);
    }

    private handleAdaptiveTick(): void {
        if (this.paused || this.openContractId || this.pendingDecision || !this.selectedMarket) return;
        const analysis = analyzeBinaryMatrix(this.digits, this.activeDecision);
        const decision = analysis?.decision;
        const momentumRoc = calculateRateOfChange(
            this.momentumPrices,
            this.config.momentumPeriod,
        );
        const signalMatches = decision?.condition === this.selectedMarket.condition &&
            momentumConfirmsDecision(decision, momentumRoc);
        this.candidateSignalCurrent = signalMatches;

        if (
            signalMatches &&
            this.proposalApproved &&
            this.tickSerial > this.proposalApprovedAtTickSerial
        ) this.tryPurchaseFromLatestTick();
    }

    private handleAdaptiveProposal(proposal: DTProposal | null): void {
        if (
            !this.config.autoMarketScan ||
            !this.running ||
            !this.selectedMarket ||
            !proposal ||
            this.openContractId ||
            this.pendingDecision
        ) {
            return;
        }

        const breakEven = proposal.payout > 0 ? proposal.askPrice / proposal.payout : 1;
        const qualified = Number.isFinite(breakEven) &&
            this.selectedMarket.lowerConfidenceBound > breakEven + 0.01;
        this.selectedMarket.breakEvenWinRate = Number.isFinite(breakEven) ? breakEven : null;

        if (!qualified) {
            const reason =
                `Live proposal needs ${(breakEven * 100).toFixed(1)}% wins; the holdout lower bound is ` +
                `${(this.selectedMarket.lowerConfidenceBound * 100).toFixed(1)}%. No trade.`;
            this.rejectedCandidates.set(
                this.candidateKey(this.selectedMarket.symbol, this.selectedMarket.condition),
                reason,
            );
            this.writeLog(reason, 'system');
            this.abandonAdaptiveCandidate(reason);
            return;
        }

        const wasApproved = this.proposalApproved;
        this.proposalApproved = true;
        if (!wasApproved) this.proposalApprovedAtTickSerial = this.tickSerial;
        this.writeLog(
            `Live proposal clears break-even for ${this.selectedMarket.symbol} ${this.selectedMarket.condition}.`,
            'system',
        );
        this.publishScan(
            'selected',
            `Live payout check passed for ${this.selectedMarket.symbol}; waiting for a fresh matching tick.`,
        );
    }

    private abandonAdaptiveCandidate(reason: string): void {
        this.trader.stop();
        this.selectedMarket = null;
        this.proposalApproved = false;
        this.candidateSignalCurrent = false;
        this.proposalApprovedAtTickSerial = 0;
        this.momentumPrices = [];
        this.onStatus('scanning');
        this.publishScan('scanning', reason);
    }

    private failAdaptiveRun(reason: string, logReason = true): void {
        if (!this.running) return;
        if (this.openContractId || this.pendingDecision) {
            this.stopRequested = true;
            this.paused = true;
            this.marketScanner.stop();
            this.onStatus('waiting');
            if (logReason) {
                this.writeLog(
                    `${reason} The runner is retaining the current contract lock until its outcome can be confirmed.`,
                    'error',
                );
            }
            return;
        }
        this.running = false;
        this.marketScanner.stop();
        this.trader.stop();
        this.selectedMarket = null;
        this.proposalApproved = false;
        this.candidateSignalCurrent = false;
        releaseBotContractGate(this);
        if (activeBinaryMatrixEngine === this) activeBinaryMatrixEngine = null;
        if (getGlobalActiveEngine() === this) setGlobalActiveEngine(null);
        if (logReason) this.writeLog(reason, 'error');
        this.onStatus('error');
        this.publishScan('error', reason);
    }

    private candidateKey(symbol: string, condition: string): string {
        return `${symbol}:${condition}`;
    }

    private publishScan(status: BinaryMatrixScanSnapshot['status'], message: string): void {
        if (!this.scanSnapshot) return;
        const selected = this.selectedMarket;
        const rows = this.scanSnapshot.rows.map(row => {
            if (selected?.symbol === row.symbol) {
                const breakEven = selected.breakEvenWinRate;
                return {
                    ...row,
                    status: this.proposalApproved ? 'qualified' as const : 'candidate' as const,
                    breakEvenWinRate: breakEven,
                    score: breakEven === null ? row.score : selected.lowerConfidenceBound - breakEven,
                    reason: this.proposalApproved
                        ? row.currentCondition === selected.condition
                            ? 'Historical holdout and live payout pass; waiting for a fresh matching tick.'
                            : `Selected ${selected.condition}; waiting for that rule to trigger again.`
                        : row.currentCondition === selected.condition
                            ? 'Historical holdout passed; waiting for a live payout check.'
                            : `Selected ${selected.condition}; waiting for its live payout check and a fresh matching tick.`,
                };
            }

            const rejection = row.currentCondition
                ? this.rejectedCandidates.get(this.candidateKey(row.symbol, row.currentCondition))
                : undefined;
            return rejection
                ? { ...row, status: 'insufficient-data' as const, reason: rejection }
                : row;
        });
        this.onMarketScan({
            ...this.scanSnapshot,
            status: this.openContractId ? 'waiting' : selected ? 'selected' : status,
            selectedSymbol: selected?.symbol ?? null,
            selectedContract: selected
                ? this.activeDecision?.label ?? selected.condition
                : null,
            rows,
            updatedAt: Date.now(),
            message,
        });
    }

    private tryPurchaseFromLatestTick(): void {
        if (!this.running || this.paused || this.openContractId || this.pendingDecision) return;
        if (this.config.autoMarketScan && (!this.proposalApproved || !this.candidateSignalCurrent)) return;

            const analysis = analyzeBinaryMatrix(this.digits, this.activeDecision);
            if (!analysis?.decision) {
                this.onStatus('scanning');
                return;
            }
            const decision = this.activeDecision ?? analysis.decision;
            this.activeDecision = decision;

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
        if (status === 'error' && this.config.autoMarketScan) {
            this.failAdaptiveRun('The selected market feed returned an error; scanning was stopped safely.');
        } else if (status === 'error') this.onStatus('error');
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
                if (this.config.autoMarketScan) {
                    this.publishScan('waiting', `Waiting for ${position.symbol} ${this.labelFor(position)} to settle.`);
                }
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
            const winsToReanalyze = this.config.reanalyzeAfterWins;
            this.qualifyingWins = 0;
            this.activeDecision = null;
            this.digits = [];
            globalObserver.emit('bot.analysis.reanalysis', {
                market: this.config.symbol,
                wins: winsToReanalyze,
            });
            this.writeLog(
                `Re-analysis threshold reached after ${winsToReanalyze} wins — re-analysing until Take Profit is hit.`,
                'system'
            );
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
            this.marketScanner.stop();
            this.trader.stop();
            this.releaseRunnerLease();
            this.onAlert({ kind: 'tp', profit: this.totalProfit });
            this.onStatus('stopped');
            this.writeLog(`Take Profit reached at ${this.signedMoney(this.totalProfit)}.`, 'win');
            return;
        }
        if (settlement.shouldStop && this.totalProfit <= -this.config.stopLoss) {
            this.running = false;
            this.marketScanner.stop();
            this.trader.stop();
            this.releaseRunnerLease();
            this.onAlert({ kind: 'sl', profit: this.totalProfit });
            this.onStatus('stopped');
            this.writeLog(`Stop Loss reached at ${this.signedMoney(this.totalProfit)}.`, 'loss');
            return;
        }

        if (this.stopRequested) {
            this.finishStop();
            return;
        }

        if (this.running) {
            if (this.config.autoMarketScan) {
                this.trader.stop();
                this.selectedMarket = null;
                this.proposalApproved = false;
                this.candidateSignalCurrent = false;
                this.proposalApprovedAtTickSerial = 0;
                this.momentumPrices = [];
                this.onStatus('scanning');
                this.publishScan('scanning', 'Contract settled; comparing current volatility-market evidence again.');
                return;
            }

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

    private releaseRunnerLease(): void {
        if (activeBinaryMatrixEngine === this) activeBinaryMatrixEngine = null;
        if (getGlobalActiveEngine() === this) setGlobalActiveEngine(null);
    }

    private finishStop(): void {
        this.running = false;
        this.paused = false;
        this.stopRequested = false;
        this.marketScanner.stop();
        this.activeDecision = null;
        this.pendingDecision = null;
        this.openContractId = null;
        this.selectedMarket = null;
        this.proposalApproved = false;
        this.candidateSignalCurrent = false;
        this.proposalApprovedAtTickSerial = 0;
        this.momentumPrices = [];
        releaseBotContractGate(this);
        this.trader.stop();
        this.releaseRunnerLease();
        this.publishScan('idle', 'Runner stopped. No new trades will be placed.');
        this.onStatus('stopped');
        this.writeLog('Binary Matrix AI stopped. No new contracts will be placed.', 'system');
        this.emitStats();
    }

    private publishAnalysis(): void {
        const analysis = analyzeBinaryMatrix(this.digits, this.activeDecision);
        if (!analysis) return;

        const payload = {
            market: this.config.symbol,
            condition: analysis.condition,
            count: analysis.count,
            compareValue: analysis.compareValue,
            digits: analysis.digits,
            result: analysis.result,
        };
        globalObserver.emit('bot.analysis.condition', payload);
        this.writeLog(
            `Last Digits Analysis Market: ${this.config.symbol} ` +
            `Condition: ${this.conditionLabel(analysis)} ` +
            `Digits: [${analysis.digits.join(', ')}] ` +
            `Result: ${analysis.result ? '✅ TRUE' : '❌ FALSE'}`,
            'info',
        );
    }

    private conditionLabel(analysis: BinaryMatrixAnalysis): string {
        switch (analysis.condition) {
            case 'ALL_EVEN':
                return 'all even';
            case 'ALL_ODD':
                return 'all odd';
            case 'LESS_OR_EQUAL':
                return `less than or equal to ${analysis.compareValue}`;
            case 'GREATER_OR_EQUAL':
                return `greater than or equal to ${analysis.compareValue}`;
            default:
                return analysis.condition;
        }
    }

    private log(log: DTLog): void {
        this.onLog(log);
    }

    private writeLog(message: string, type: DTLog['type']): void {
        const log = {
            seq: Date.now(),
            time: this.nowTime(),
            message,
            type,
        };
        globalObserver.emit('bot.binary_matrix.log', log);
        this.log(log);
    }

    private signedMoney(value: number): string {
        return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
    }

    private nowTime(): string {
        return new Date().toTimeString().slice(0, 8);
    }
}
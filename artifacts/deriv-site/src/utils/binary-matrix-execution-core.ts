import type { BinaryMatrixDecision } from './binary-matrix-strategy';

export interface BinaryMatrixExecutionConfig {
    initialStake: number;
    martingale: number;
    takeProfit: number;
    stopLoss: number;
}

export interface BinaryMatrixSettlement {
    contractId: string;
    profit: number;
    isWin: boolean;
}

export interface BinaryMatrixExecutionSnapshot {
    currentStake: number;
    totalProfit: number;
    wins: number;
    losses: number;
    pendingStake: number | null;
    openContractId: string | null;
}

export interface BinaryMatrixPurchase {
    decision: BinaryMatrixDecision;
    stake: number;
}

export interface BinaryMatrixSettlementResult {
    accepted: boolean;
    duplicate: boolean;
    nextStake: number;
    totalProfit: number;
    shouldStop: boolean;
}

/**
 * Browser-independent authority for Binary Matrix execution state.
 *
 * The transport can be a browser WebSocket, a server WebSocket, or a test
 * adapter. None of those transports can advance Martingale or settle a
 * contract without passing through this state machine.
 */
export class BinaryMatrixExecutionCore {
    private config: BinaryMatrixExecutionConfig;
    private currentStake: number;
    private totalProfit = 0;
    private wins = 0;
    private losses = 0;
    private pending: BinaryMatrixPurchase | null = null;
    private openContractId: string | null = null;
    private settledContracts = new Set<string>();

    constructor(config: BinaryMatrixExecutionConfig) {
        this.config = { ...config };
        this.currentStake = config.initialStake;
    }

    reset(config: BinaryMatrixExecutionConfig = this.config): void {
        this.config = { ...config };
        this.currentStake = config.initialStake;
        this.totalProfit = 0;
        this.wins = 0;
        this.losses = 0;
        this.pending = null;
        this.openContractId = null;
        this.settledContracts.clear();
    }

    updateConfig(config: Partial<BinaryMatrixExecutionConfig>): void {
        this.config = { ...this.config, ...config };
        if (!this.pending && !this.openContractId) {
            this.currentStake = this.config.initialStake;
        }
    }

    beginPurchase(decision: BinaryMatrixDecision): BinaryMatrixPurchase | null {
        if (this.pending || this.openContractId) return null;

        this.pending = {
            decision,
            stake: this.currentStake,
        };
        return { ...this.pending };
    }

    acceptPurchase(contractId: string | number): boolean {
        if (!this.pending || this.openContractId) return false;

        this.openContractId = String(contractId);
        this.pending = null;
        return true;
    }

    rejectPurchase(): void {
        this.pending = null;
    }

    settle(settlement: BinaryMatrixSettlement): BinaryMatrixSettlementResult {
        const contractId = String(settlement.contractId);
        if (this.settledContracts.has(contractId) || this.openContractId !== contractId) {
            return {
                accepted: false,
                duplicate: this.settledContracts.has(contractId),
                nextStake: this.currentStake,
                totalProfit: this.totalProfit,
                shouldStop: false,
            };
        }

        this.settledContracts.add(contractId);
        this.openContractId = null;
        this.totalProfit += settlement.profit;

        if (settlement.isWin) {
            this.wins += 1;
            this.currentStake = this.config.initialStake;
        } else {
            this.losses += 1;
            this.currentStake *= this.config.martingale;
        }

        return {
            accepted: true,
            duplicate: false,
            nextStake: this.currentStake,
            totalProfit: this.totalProfit,
            shouldStop:
                this.totalProfit >= this.config.takeProfit ||
                this.totalProfit <= -this.config.stopLoss,
        };
    }

    snapshot(): BinaryMatrixExecutionSnapshot {
        return {
            currentStake: this.currentStake,
            totalProfit: this.totalProfit,
            wins: this.wins,
            losses: this.losses,
            pendingStake: this.pending?.stake ?? null,
            openContractId: this.openContractId,
        };
    }
}
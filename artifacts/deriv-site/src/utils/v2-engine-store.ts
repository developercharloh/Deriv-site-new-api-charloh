// ─── V2 Engine shared MobX store ──────────────────────────────────────────────
// Central state holder for the V2 engine. Any component in the tree can
// observe it; the dedicated "V2 Panel" tab page reads from here.
// The store also owns the engine instance so the autostart listener in
// main.tsx can start/stop it without needing a ref inside TradeAnimation.

import { makeAutoObservable, runInAction } from 'mobx';
import {
    DerivV2Engine,
    type V2BotConfig,
    type V2BoundStores,
    type EngineLog,
    type EngineStatus,
    type TradeRecord,
} from './deriv-v2-engine';

export type { TradeRecord };

export interface V2Stats {
    profit: number;
    wins:   number;
    losses: number;
    stake:  number;
}

export interface V2Alert {
    kind:   'tp' | 'sl';
    amount: number;
    profit: number;
    seq:    number;
}

class V2EngineStore {
    status:       EngineStatus = 'idle';
    logs:         EngineLog[]  = [];
    tradeRecords: TradeRecord[] = [];
    stats:        V2Stats      = { profit: 0, wins: 0, losses: 0, stake: 0 };
    running:      boolean      = false;
    alert:        V2Alert | null = null;
    private alertSeq: number   = 0;

    private engine: DerivV2Engine | null = null;

    constructor() {
        makeAutoObservable(this);
    }

    // ── Start a new run ───────────────────────────────────────────────────────

    start(cfg: V2BotConfig, stores: V2BoundStores): void {
        // Tear down any previous run first
        this.engine?.stop();
        this.engine = null;

        this.reset(cfg.initialStake);
        this.running = true; // reflect immediately on the button

        const engine = new DerivV2Engine(cfg);
        engine.bindStores(stores);

        engine.onLog    = log    => runInAction(() => this.pushLog(log));
        engine.onProfit = (p, w, l, s) => runInAction(() => this.setStats(p, w, l, s));
        engine.onStatus = status => runInAction(() => this.setStatus(status));
        engine.onTrade  = record => runInAction(() => this.pushTrade(record));
        engine.onAlert  = a      => runInAction(() => this.setAlert(a.kind, a.amount, a.profit));

        this.engine = engine;
        engine.start();
    }

    // ── Stop the running engine ───────────────────────────────────────────────

    stop(): void {
        this.engine?.stop();
        this.engine  = null;
        this.running = false;
    }

    // ── MobX actions ──────────────────────────────────────────────────────────

    setStatus(s: EngineStatus): void {
        this.status  = s;
        this.running = s === 'connecting' || s === 'scanning' || s === 'trading';
    }

    pushLog(log: EngineLog): void {
        this.logs = [log, ...this.logs].slice(0, 200);
    }

    pushTrade(record: TradeRecord): void {
        this.tradeRecords = [record, ...this.tradeRecords].slice(0, 100);
    }

    setStats(profit: number, wins: number, losses: number, stake: number): void {
        this.stats = { profit, wins, losses, stake };
    }

    setAlert(kind: 'tp' | 'sl', amount: number, profit: number): void {
        this.alert = { kind, amount, profit, seq: ++this.alertSeq };
    }

    dismissAlert(): void {
        this.alert = null;
    }

    clearLogs(): void {
        this.logs = [];
    }

    clearAll(): void {
        this.logs         = [];
        this.tradeRecords = [];
    }

    reset(initialStake = 0): void {
        this.status       = 'idle';
        this.logs         = [];
        this.tradeRecords = [];
        this.stats        = { profit: 0, wins: 0, losses: 0, stake: initialStake };
        this.running      = false;
        this.alert        = null;
    }
}

export const v2EngineStore = new V2EngineStore();

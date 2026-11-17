// ─── Deriv V2 Lightning Engine ────────────────────────────────────────────────
//
// Core principle: EVERY tick = ONE buy. No tick is ever skipped.
//
// V1 behaviour (what this replaces):
//   Tick 1 → buy A → [waiting…] → A settles → Tick 4 → buy B
//   Ticks 2, 3 are completely wasted.
//
// V2 behaviour:
//   Tick 1 → buy A
//   Tick 2 → buy B  (A still open / settling in background)
//   Tick 3 → buy C  (A settled, B still open)
//   Tick 4 → buy D  …
//
// Every tick drives one buy. Settlements happen asynchronously and update
// P&L + martingale stake without ever blocking the next tick's buy.
//
// To avoid "duplicate purchase" API rejection, each buy uses a unique
// proposal_id obtained in advance. The next proposal is pre-fetched as soon
// as a buy ack is received so it is ready before the next tick arrives.

import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { isCandleCloseEntryWindow } from './candle-close-entry';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EngineLogType = 'scan' | 'info' | 'win' | 'loss' | 'error' | 'system';
export interface EngineLog { seq: number; time: string; message: string; type: EngineLogType; }

export type EngineStatus =
    | 'idle' | 'connecting' | 'scanning' | 'trading' | 'stopped' | 'error';

export type ContractKind =
    | 'DIGITMATCH' | 'DIGITDIFF'
    | 'DIGITEVEN'  | 'DIGITODD'
    | 'DIGITOVER'  | 'DIGITUNDER';

export type TradeDirection = 'EVEN' | 'ODD' | 'OVER' | 'UNDER';

export interface V2BotConfig {
    symbol:          string;
    contractKind:    ContractKind;
    direction?:      TradeDirection;
    prediction?:     number;
    barrier?:        number;
    entryPoint:      number;
    initialStake:    number;
    martingale:      number;
    martingaleLevel: number;
    takeProfit:      number;
    stopLoss:        number;
    currency?:       string;
    duration?:       number;   // contract length in ticks (1–10), default 1
    candleCloseEntryWindow?: {
        intervalSeconds: number;
        secondsBeforeClose: number;
    };
}

export interface V2BoundStores {
    run_panel: {
        setIsRunning:      (v: boolean)    => void;
        setContractStage:  (stage: number) => void;
        setHasOpenContract:(v: boolean)    => void;
        toggleDrawer:      (open: boolean) => void;
    };
    transactions: { onBotContractEvent: (data: any) => void; };
    journal: {
        onLogSuccess: (msg: { log_type: string; extra: any }) => void;
        onError:      (msg: string | Error)                   => void;
    };
    summary_card: {
        onBotContractEvent: (data: any) => void;
        clear:              ()           => void;
    };
    setRunId: (id: string) => void;
}

export interface TradeRecord {
    seq:           number;
    time:          string;
    contractLabel: string;     // human-readable: "OVER 5", "MATCH 3", "EVEN"
    entryPoint:    number;     // digit the engine scans for to start buying
    triggerDigit:  number;     // digit when this particular buy was placed
    exitDigit:     number | null; // last digit of the exit tick
    triggerPrice:  string | null; // full price quote at the trigger tick
    exitPrice:     string | null; // full price quote at the exit tick (from Deriv)
    stake:         number;
    profit:        number;
    totalPnl:      number;     // cumulative P&L after this trade settles
    isWin:         boolean;
}

interface OpenContract {
    contractId:   string;
    stake:        number;
    subId:        string | null;
    triggerDigit: number;
    triggerPrice: string | null;
}
interface ReadyProposal { id: string; price: number; stake: number; fetchedAt: number; }

export const isWinningSettlement = (status: unknown, profit: number): boolean =>
    status === 'won' || (Number.isFinite(profit) && profit > 0);

export const nextMartingaleStake = ({
    initialStake,
    currentStake,
    multiplier,
    isWin,
}: {
    initialStake: number;
    currentStake: number;
    multiplier: number;
    isWin: boolean;
}): number =>
    isWin
        ? initialStake
        : parseFloat((currentStake * multiplier).toFixed(2));

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DerivV2Engine {
    private config:  V2BotConfig;
    private stores:  V2BoundStores | null = null;

    // log / trade sequence counters
    private logSeq:   number = 0;
    private tradeSeq: number = 0;

    // req namespace
    private reqBase:    number              = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter: number              = 0;
    private myReqIds:   Map<number, string> = new Map(); // reqId → type hint

    private msgSub:          { unsubscribe: () => void } | null = null;
    private tickSubId:       string | null = null;
    private tickWatchdog:    ReturnType<typeof setTimeout> | null = null;
    private ticksReceivedOk: boolean = false;

    // ── Trading state ─────────────────────────────────────────────────────────
    private isRunning:     boolean = false;
    private chainActive:   boolean = false;
    private lastTickDigit: number  = 0;
    private lastTickQuote: string  = '';   // full price string of the last tick
    private lastTickEpoch: number | null = null;
    private lastEntryWindowCandle: number | null = null;
    private lastProposalRequestedAt: number = 0;
    private currentStake:  number;
    private lossCount:     number  = 1;
    private totalProfit:   number  = 0;
    private wins:          number  = 0;
    private losses:        number  = 0;

    // ── Proposal pre-fetch pipeline ───────────────────────────────────────────
    private readyProposal:    ReadyProposal | null = null;
    private proposalInflight: boolean              = false;
    private proposalStake:    number | null       = null;
    private tickWaiting:      boolean              = false;

    // ── Buy serialisation ─────────────────────────────────────────────────────
    private buyInflight:    boolean = false;
    private lastBuyMs:      number  = 0;
    private readonly MIN_BUY_GAP = 100;

    // ── Open contract tracking ────────────────────────────────────────────────
    private openContracts:    Map<string, OpenContract> = new Map();
    private pocReqToContract: Map<number,  string>      = new Map();

    // Callbacks
    public onLog:    (log: EngineLog)                                        => void = () => {};
    public onProfit: (profit: number, wins: number, losses: number, stake: number) => void = () => {};
    public onStatus: (status: EngineStatus)                                  => void = () => {};
    public onTrade:  (record: TradeRecord)                                   => void = () => {};
    public onAlert:  (alert: { kind: 'tp' | 'sl'; amount: number; profit: number }) => void = () => {};

    constructor(config: V2BotConfig) {
        this.config       = config;
        this.currentStake = config.initialStake;
    }

    bindStores(stores: V2BoundStores): void { this.stores = stores; }

    // ── Public ────────────────────────────────────────────────────────────────

    start(): void {
        if (this.isRunning) return;

        if (!api_base.api) {
            this.addLog('Deriv connection not ready — please log in first.', 'error');
            this.onStatus('error'); return;
        }
        if (!api_base.is_authorized) {
            this.addLog('Not authorized — log in to your account first.', 'error');
            this.onStatus('error'); return;
        }

        this.isRunning         = true;
        this.chainActive       = false;
        this.lastTickDigit     = 0;
        this.lastTickQuote     = '';
        this.lastTickEpoch     = null;
        this.lastEntryWindowCandle = null;
        this.readyProposal     = null;
        this.proposalInflight  = false;
        this.proposalStake     = null;
        this.tickWaiting       = false;
        this.buyInflight       = false;
        this.lastBuyMs         = 0;
        this.currentStake      = this.config.initialStake;
        this.lossCount         = 1;
        this.totalProfit       = 0;
        this.wins              = 0;
        this.losses            = 0;
        this.tradeSeq          = 0;
        this.tickSubId         = null;
        this.ticksReceivedOk   = false;
        if (this.tickWatchdog) { clearTimeout(this.tickWatchdog); this.tickWatchdog = null; }
        this.myReqIds.clear();
        this.openContracts.clear();
        this.pocReqToContract.clear();

        if (this.stores) {
            this.stores.setRunId(`v2-run-${Date.now()}`);
            this.stores.summary_card.clear();
            this.stores.run_panel.setIsRunning(true);
            this.stores.run_panel.toggleDrawer(true);
            this.stores.run_panel.setContractStage(1);
        }

        this.msgSub = (api_base.api as any).onMessage().subscribe((raw: any) => {
            const msg = raw?.data ?? raw;   // .data is already a parsed object
            this.handle(msg);
        });

        this.onStatus('scanning');
        if (this.config.candleCloseEntryWindow) {
            const { intervalSeconds, secondsBeforeClose } = this.config.candleCloseEntryWindow;
            this.addLog(
                `⚡ V2 Engine ready — waiting for the ${intervalSeconds}-second candle close window (${secondsBeforeClose}s before close) on ${this.config.symbol}`,
                'system'
            );
            this.fetchProposal();
        } else {
            this.addLog(
                `⚡ V2 Engine ready — scanning for entry digit ${this.config.entryPoint} on ${this.config.symbol}`,
                'system'
            );
        }
        this.subscribeTicks();
    }

    stop(): void {
        this.isRunning        = false;
        this.chainActive      = false;
        this.proposalInflight = false;
        this.proposalStake    = null;
        this.buyInflight      = false;
        this.tickWaiting      = false;
        this.readyProposal    = null;
        this.lastEntryWindowCandle = null;

        if (this.tickWatchdog) { clearTimeout(this.tickWatchdog); this.tickWatchdog = null; }
        if (this.tickSubId) { this.rawSend({ forget: this.tickSubId }); this.tickSubId = null; }
        this.openContracts.forEach(c => { if (c.subId) this.rawSend({ forget: c.subId }); });
        this.openContracts.clear();
        this.pocReqToContract.clear();

        this.msgSub?.unsubscribe();
        this.msgSub = null;

        if (this.stores) {
            this.stores.run_panel.setIsRunning(false);
            this.stores.run_panel.setContractStage(0);
            this.stores.run_panel.setHasOpenContract(false);
        }

        this.onStatus('stopped');
        this.addLog('Engine stopped.', 'system');
    }

    // ── Private — API ─────────────────────────────────────────────────────────

    private send(payload: Record<string, unknown>, hint = ''): number {
        const reqId = this.reqBase + (++this.reqCounter);
        this.myReqIds.set(reqId, hint);
        this.rawSend({ req_id: reqId, ...payload });
        return reqId;
    }

    private rawSend(payload: Record<string, unknown>): void {
        try { (api_base.api as any).send(payload); } catch { /* ignore */ }
    }

    // ── Private — message routing ─────────────────────────────────────────────

    private handle(msg: Record<string, any>): void {
        if (!this.isRunning || !msg) return;

        const subId = msg?.subscription?.id as string | undefined;
        const reqId = msg?.req_id            as number | undefined;

        const isMyReq      = reqId !== undefined && this.myReqIds.has(reqId);
        const isMyTickSub  = subId !== undefined && subId === this.tickSubId;
        const isMyContract = subId !== undefined &&
            [...this.openContracts.values()].some(c => c.subId === subId);

        if (!isMyReq && !isMyTickSub && !isMyContract) return;

        if (msg.error) {
            const errMsg = msg.error.message ?? 'Unknown error';
            this.addLog(`API error [${msg.msg_type}]: ${errMsg}`, 'error');
            this.stores?.journal.onError(errMsg);

            if (msg.msg_type === 'proposal') {
                this.proposalInflight = false;
                setTimeout(() => this.fetchProposal(), 200);
            }
            if (msg.msg_type === 'buy') {
                this.buyInflight   = false;
                this.readyProposal = null;
                this.addLog('Buy rejected — fetching new proposal', 'system');
                this.fetchProposal();
            }
            return;
        }

        switch (msg.msg_type) {
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleTick(msg.tick);
                break;
            case 'proposal':
                this.handleProposal(msg.proposal);
                break;
            case 'buy':
                this.handleBuyAck(msg.buy);
                break;
            case 'proposal_open_contract':
                this.handleContract(msg.proposal_open_contract, subId, reqId);
                break;
        }
    }

    // ── Private — tick: the heartbeat of V2 ──────────────────────────────────

    private subscribeTicks(): void {
        this.addLog(`Subscribing to ${this.config.symbol} ticks…`, 'system');
        this.send({ ticks: this.config.symbol, subscribe: 1 }, 'tick_sub');
        this.startTickWatchdog();
    }

    private startTickWatchdog(): void {
        if (this.tickWatchdog) clearTimeout(this.tickWatchdog);
        this.tickWatchdog = setTimeout(() => {
            if (!this.isRunning || this.ticksReceivedOk) return;
            this.addLog('No ticks received — resubscribing…', 'system');
            // Forget stale sub and resubscribe
            if (this.tickSubId) { this.rawSend({ forget: this.tickSubId }); this.tickSubId = null; }
            this.myReqIds.forEach((hint, id) => { if (hint === 'tick_sub') this.myReqIds.delete(id); });
            this.send({ ticks: this.config.symbol, subscribe: 1 }, 'tick_sub');
            this.startTickWatchdog(); // arm again until ticks flow
        }, 4000);
    }

    private handleTick(tick: { quote: number; pip_size?: number; epoch?: number } | undefined): void {
        if (!tick) return;
        if (!this.ticksReceivedOk) {
            this.ticksReceivedOk = true;
            if (this.tickWatchdog) { clearTimeout(this.tickWatchdog); this.tickWatchdog = null; }
        }
        const digit = this.lastDigit(tick.quote);
        this.lastTickDigit = digit;
        this.lastTickQuote = this.formatQuote(tick.quote, tick.pip_size);
        const epoch = Number(tick.epoch);
        this.lastTickEpoch = Number.isFinite(epoch) ? Math.floor(epoch) : null;

        if (this.config.candleCloseEntryWindow) {
            this.handleCandleCloseEntryTick(this.lastTickEpoch);
            return;
        }

        if (!this.chainActive) {
            this.addLog(`Digit: ${digit}  |  Waiting for entry: ${this.config.entryPoint}`, 'scan');
            if (digit === this.config.entryPoint) {
                this.chainActive = true;
                this.addLog(`Entry ${digit} hit — ⚡ buying on every tick from now`, 'info');
                this.onStatus('trading');
                this.tradeOnTick();
            }
            return;
        }

        this.tradeOnTick();
    }

    private handleCandleCloseEntryTick(epoch: number | null): void {
        const window = this.config.candleCloseEntryWindow;
        if (!this.isRunning || !window || epoch === null) return;

        // Refresh proposals periodically while waiting, so a long wait cannot
        // leave an expired proposal ID for the next candle.
        if (!this.proposalInflight && !this.buyInflight) {
            const proposalAge = this.readyProposal
                ? Date.now() - this.readyProposal.fetchedAt
                : Number.POSITIVE_INFINITY;
            if (proposalAge >= 10_000 && Date.now() - this.lastProposalRequestedAt >= 10_000) {
                this.readyProposal = null;
                this.fetchProposal();
            }
        }

        if (!isCandleCloseEntryWindow(epoch, window.intervalSeconds, window.secondsBeforeClose)) return;
        const candleKey = Math.floor(epoch / window.intervalSeconds);
        if (this.lastEntryWindowCandle === candleKey) return;

        // Reserve this candle immediately. A slow or rejected buy must not
        // cause the engine to submit another purchase in the same close window.
        this.lastEntryWindowCandle = candleKey;
        this.chainActive = true;
        this.onStatus('trading');
        this.addLog(
            `Candle-close entry window reached — preparing one ${this.config.direction ?? this.config.contractKind} trade.`,
            'info'
        );

        if (this.readyProposal && !this.buyInflight) {
            const proposal = this.readyProposal;
            this.readyProposal = null;
            this.executeBuy(proposal);
            return;
        }

        this.tickWaiting = true;
        if (!this.proposalInflight) this.fetchProposal();
    }

    private isCurrentTickInEntryWindow(): boolean {
        const window = this.config.candleCloseEntryWindow;
        const epoch = this.lastTickEpoch;
        return Boolean(
            window &&
            epoch !== null &&
            this.lastEntryWindowCandle === Math.floor(epoch / window.intervalSeconds) &&
            isCandleCloseEntryWindow(epoch, window.intervalSeconds, window.secondsBeforeClose)
        );
    }

    private tradeOnTick(): void {
        if (!this.isRunning) return;

        if (this.readyProposal && !this.buyInflight) {
            this.executeBuy(this.readyProposal);
        } else {
            this.tickWaiting = true;
            if (!this.proposalInflight && !this.readyProposal) {
                this.fetchProposal();
            }
        }
    }

    // ── Private — proposal pipeline ───────────────────────────────────────────

    private fetchProposal(): void {
        if (!this.isRunning || this.proposalInflight) return;
        this.proposalInflight = true;
        this.lastProposalRequestedAt = Date.now();
        const requestedStake = this.currentStake;
        this.proposalStake = requestedStake;

        const ct = this.resolveContractType();
        const params: Record<string, unknown> = {
            proposal:      1,
            amount:        requestedStake,
            basis:         'stake',
            contract_type: ct,
            currency:      this.config.currency ?? 'USD',
            duration:      Math.max(1, Math.min(10, this.config.duration ?? 1)),
            duration_unit: 't',
            underlying_symbol: this.config.symbol,
        };
        if (ct === 'DIGITMATCH' || ct === 'DIGITDIFF') {
            // Deriv API uses selected_tick + barrier (not "prediction") for digit match/diff
            const digit = this.config.prediction ?? this.config.entryPoint;
            params.selected_tick = digit;
            params.barrier       = digit;
        }
        if (ct === 'DIGITOVER' || ct === 'DIGITUNDER') {
            params.barrier = String(this.config.barrier ?? this.config.entryPoint);
        }
        // DIGITEVEN / DIGITODD: no digit parameter needed

        this.send(params, 'proposal');
    }

    private handleProposal(proposal: Record<string, any> | undefined): void {
        this.proposalInflight = false;
        const proposalStake = this.proposalStake ?? this.currentStake;
        this.proposalStake = null;

        if (!proposal?.id) {
            this.addLog('Empty proposal — retrying', 'error');
            setTimeout(() => this.fetchProposal(), 200);
            return;
        }

        const ready: ReadyProposal = {
            id:    String(proposal.id),
            price: parseFloat(proposal.ask_price ?? proposalStake),
            stake: proposalStake,
            fetchedAt: Date.now(),
        };

        if (this.tickWaiting && !this.buyInflight) {
            this.tickWaiting = false;
            if (!this.config.candleCloseEntryWindow || this.isCurrentTickInEntryWindow()) {
                this.readyProposal = null;
                this.executeBuy(ready);
            } else {
                this.readyProposal = ready;
                this.addLog('Proposal was not ready inside the candle-close window; waiting for the next window.', 'system');
            }
        } else {
            this.readyProposal = ready;
        }
    }

    // ── Private — buy execution ───────────────────────────────────────────────

    private executeBuy(p: ReadyProposal): void {
        if (!this.isRunning || this.buyInflight) return;

        // A settlement may have changed the Martingale stake while this
        // proposal was prefetched. Never buy a stale amount: discard it and
        // request a proposal for the authoritative current stake.
        if (Math.abs(p.stake - this.currentStake) > 0.0000001) {
            this.readyProposal = null;
            this.tickWaiting = true;
            this.fetchProposal();
            return;
        }

        const now  = Date.now();
        const gap  = this.MIN_BUY_GAP - (now - this.lastBuyMs);
        if (gap > 0) {
            setTimeout(() => { if (this.isRunning) this.tradeOnTick(); }, gap);
            return;
        }

        this.readyProposal = null;
        this.buyInflight   = true;
        this.lastBuyMs     = now;
        this.tickWaiting   = false;

        if (this.stores) this.stores.run_panel.setContractStage(3);

        this.addLog(
            this.config.candleCloseEntryWindow
                ? `⚡ Buy  $${this.currentStake.toFixed(2)}  candle-close entry  (${this.openContracts.size} open)`
                : `⚡ Buy  $${this.currentStake.toFixed(2)}  digit:${this.lastTickDigit}  entry:${this.config.entryPoint}  (${this.openContracts.size} open)`,
            'info'
        );
        this.send({ buy: p.id, price: p.price }, 'buy');
    }

    // ── Private — buy acknowledgement ─────────────────────────────────────────

    private handleBuyAck(buy: Record<string, any> | undefined): void {
        this.buyInflight = false;

        if (!buy) {
            this.addLog('Buy ack missing contract — retrying', 'error');
            this.fetchProposal(); return;
        }

        const contractId = String(buy.contract_id);
        const purchasedStake = parseFloat(buy.buy_price ?? '');
        this.openContracts.set(contractId, {
            contractId,
            stake:        Number.isFinite(purchasedStake) ? purchasedStake : this.currentStake,
            subId:        null,
            triggerDigit: this.lastTickDigit,
            triggerPrice: this.lastTickQuote || null,
        });

        if (this.stores) {
            this.stores.run_panel.setContractStage(4);
            this.stores.run_panel.setHasOpenContract(true);
        }

        const pocReqId = this.send(
            { proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 },
            'poc'
        );
        this.pocReqToContract.set(pocReqId, contractId);

        this.fetchProposal();
    }

    // ── Private — settlement (runs in background, never blocks ticks) ─────────

    private handleContract(
        poc:   Record<string, any> | undefined,
        subId: string | undefined,
        reqId: number | undefined,
    ): void {
        if (!poc) return;

        const contractId = String(poc.contract_id);
        if (reqId !== undefined) this.pocReqToContract.delete(reqId);

        const rec = this.openContracts.get(contractId);
        if (rec && subId && !rec.subId) rec.subId = subId;

        if (!poc.is_sold) return;

        const effSubId = subId ?? rec?.subId ?? null;
        if (effSubId) this.rawSend({ forget: effSubId });
        this.openContracts.delete(contractId);

        const profit = parseFloat(poc.profit ?? '0');
        const isWin  = isWinningSettlement(poc.status, profit);
        this.totalProfit += profit;

        // Extract exit digit + full exit price from the exit tick display value
        const exitTickStr  = poc.exit_tick_display_value as string | undefined;
        const exitDigit    = exitTickStr ? this.lastDigit(parseFloat(exitTickStr)) : null;
        const exitPrice    = exitTickStr ?? null;
        const triggerDigit = rec?.triggerDigit ?? 0;
        const triggerPrice = rec?.triggerPrice ?? null;
        const tradeStake   = rec?.stake ?? this.currentStake;

        // Emit a structured trade record for the journal
        const record: TradeRecord = {
            seq:           ++this.tradeSeq,
            time:          this.nowTime(),
            contractLabel: this.formatContractLabel(),
            entryPoint:    this.config.entryPoint,
            triggerDigit,
            exitDigit,
            triggerPrice,
            exitPrice,
            stake:         tradeStake,
            profit,
            totalPnl:      this.totalProfit,
            isWin,
        };
        this.onTrade(record);

        // Feed DBot stores
        if (this.stores) {
            this.stores.transactions.onBotContractEvent(poc);
            this.stores.summary_card.onBotContractEvent(poc);
            this.stores.journal.onLogSuccess({
                log_type: isWin ? 'profit' : 'lost',
                extra:    { currency: poc.currency ?? 'USD', profit },
            });
            if (this.openContracts.size === 0) {
                this.stores.run_panel.setContractStage(6);
                this.stores.run_panel.setHasOpenContract(false);
            }
        }

        // Compact "price → price" string for the text log
        const priceMove = (triggerPrice || exitPrice)
            ? `  ${triggerPrice ?? '?'} → ${exitPrice ?? '?'}`
            : '';

        if (isWin) {
            this.wins++;
            this.addLog(
                `✅ WIN  +$${Math.abs(profit).toFixed(2)}${priceMove}  exit:${exitDigit ?? '?'}  stake:$${tradeStake.toFixed(2)}  P&L:${this.pnlStr()}`,
                'win'
            );
            this.currentStake = nextMartingaleStake({
                initialStake: this.config.initialStake,
                currentStake: this.currentStake,
                multiplier: this.config.martingale,
                isWin,
            });
            this.lossCount    = 1;
            if (this.totalProfit >= this.config.takeProfit) {
                this.addLog(`Take Profit $${this.config.takeProfit.toFixed(2)} reached — stopping`, 'system');
                this.onProfit(this.totalProfit, this.wins, this.losses, this.currentStake);
                this.onAlert({ kind: 'tp', amount: this.config.takeProfit, profit: this.totalProfit });
                this.stop(); return;
            }
        } else {
            this.losses++;
            this.addLog(
                `❌ LOSS -$${Math.abs(profit).toFixed(2)}${priceMove}  exit:${exitDigit ?? '?'}  stake:$${tradeStake.toFixed(2)}  P&L:${this.pnlStr()}`,
                'loss'
            );
            if (this.totalProfit <= -this.config.stopLoss) {
                this.addLog(`Stop Loss $${this.config.stopLoss.toFixed(2)} reached — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses, this.currentStake);
                this.onAlert({ kind: 'sl', amount: this.config.stopLoss, profit: this.totalProfit });
                this.stop(); return;
            }
            if (this.lossCount >= this.config.martingaleLevel) {
                this.addLog(`Max ${this.config.martingaleLevel} consecutive losses — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses, this.currentStake);
                this.stop(); return;
            }
            this.currentStake = nextMartingaleStake({
                initialStake: this.config.initialStake,
                currentStake: this.currentStake,
                multiplier: this.config.martingale,
                isWin,
            });
            this.lossCount++;
        }

        this.onProfit(this.totalProfit, this.wins, this.losses, this.currentStake);
    }

    // ── Private — helpers ─────────────────────────────────────────────────────

    private resolveContractType(): string {
        const { contractKind, direction } = this.config;
        if (contractKind === 'DIGITEVEN' || contractKind === 'DIGITODD') {
            return direction === 'ODD' ? 'DIGITODD' : 'DIGITEVEN';
        }
        if (contractKind === 'DIGITOVER' || contractKind === 'DIGITUNDER') {
            return direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
        }
        return contractKind;
    }

    private formatContractLabel(): string {
        const ct = this.resolveContractType();
        const p  = this.config.prediction ?? this.config.entryPoint;
        const b  = this.config.barrier    ?? this.config.entryPoint;
        switch (ct) {
            case 'DIGITOVER':  return `OVER ${b}`;
            case 'DIGITUNDER': return `UNDER ${b}`;
            case 'DIGITMATCH': return `MATCH ${p}`;
            case 'DIGITDIFF':  return `DIFF ${p}`;
            case 'DIGITEVEN':  return 'EVEN';
            case 'DIGITODD':   return 'ODD';
            default:           return ct;
        }
    }

    private lastDigit(quote: number): number {
        const s = quote.toString().replace(/^.*\./, '');
        return parseInt(s[s.length - 1] ?? '0', 10);
    }

    // Format a tick quote as a fixed-precision string. Deriv volatility indices
    // typically expose pip_size = 2..5; if missing we infer from the quote
    // itself so the string keeps every digit (including the trailing one used
    // for digit contracts).
    private formatQuote(quote: number, pipSize?: number): string {
        if (typeof pipSize === 'number' && pipSize > 0) return quote.toFixed(pipSize);
        const s = quote.toString();
        const dot = s.indexOf('.');
        if (dot === -1) return quote.toFixed(2);
        const decimals = s.length - dot - 1;
        return quote.toFixed(Math.min(Math.max(decimals, 2), 8));
    }

    private pnlStr(): string {
        const sign = this.totalProfit >= 0 ? '+' : '';
        return `${sign}$${this.totalProfit.toFixed(2)}`;
    }

    private nowTime(): string {
        const now = new Date();
        return [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => n.toString().padStart(2, '0')).join(':');
    }

    private addLog(message: string, type: EngineLogType): void {
        this.onLog({ seq: ++this.logSeq, time: this.nowTime(), message, type });
    }
}

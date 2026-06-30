// ─── DTrader Engine ──────────────────────────────────────────────────────────
//
// Lite version of Deriv's DTrader, sized for our app. Handles:
//   • Live tick subscription for spot + last digit
//   • Live proposal subscription (auto-updates payout as inputs change)
//   • Manual buy (one click → one contract)
//   • Manual sell (close open Accumulators / Multipliers at market)
//   • Open-contract tracking → live P&L → settlement record
//
// Supported contract families:
//   Rise / Fall          (CALL / PUT, no barrier)
//   Higher / Lower       (CALL / PUT, with relative barrier  +0.001 / -0.001)
//   Touch / No Touch     (ONETOUCH / NOTOUCH, with relative barrier)
//   Matches / Differs    (DIGITMATCH / DIGITDIFF, prediction digit 0-9)
//   Over / Under         (DIGITOVER  / DIGITUNDER, prediction digit 0-9)
//   Even / Odd           (DIGITEVEN  / DIGITODD,  no barrier / prediction)
//   Accumulators         (ACCU, growth-rate based, no fixed duration)
//   Multipliers          (MULTUP / MULTDOWN, leverage-based, optional SL/TP)

import { api_base } from '@/external/bot-skeleton/services/api/api-base';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DTContractType =
    | 'CALL' | 'PUT'
    | 'ONETOUCH' | 'NOTOUCH'
    | 'DIGITMATCH' | 'DIGITDIFF'
    | 'DIGITOVER'  | 'DIGITUNDER'
    | 'DIGITEVEN'  | 'DIGITODD'
    | 'ACCU'
    | 'MULTUP' | 'MULTDOWN';

export type DTDurationUnit = 't' | 's' | 'm' | 'h';

export type DTStatus = 'idle' | 'subscribing' | 'ready' | 'error';

export type DTLogType = 'info' | 'win' | 'loss' | 'error' | 'system';
export interface DTLog { seq: number; time: string; message: string; type: DTLogType; }

export interface DTBuyFeedback {
    seq:     number;       // monotonic — used by UI to detect new feedback
    kind:    'success' | 'error';
    message: string;
}

export interface DTProposal {
    id:         string;     // proposal id (use this to buy)
    askPrice:   number;     // price the buy will cost
    payout:     number;     // total payout if won
    profit:     number;     // payout - askPrice
    profitPct:  number;     // (profit / askPrice) * 100
    longcode:   string;
    spot:       string;     // current spot price string at last update
    spotNum:    number | null;
    /** ACCU: predicted barriers BEFORE buying. Live values that follow
     *  the spot tick-by-tick — the trader sees exactly where the upper /
     *  lower walls will sit at entry, helping them time the buy. */
    previewHighBarrier:    number | null;
    previewLowBarrier:     number | null;
    /** MULT: predicted stop-out price BEFORE buying. */
    previewStopOut:        number | null;
}

export interface DTPosition {
    contractId:   string;
    contractType: DTContractType;
    /** Snapshot of the barrier/prediction the contract was bought with —
     *  needed to highlight the winning-side digits for open digit contracts
     *  (e.g. UNDER '7' → digits 0-6 win). null for contracts without one. */
    barrier:      string | null;
    symbol:       string;
    stake:        number;
    payout:       number;
    buyPrice:     number;
    currentSpot:  string | null;
    currentBid:   number | null; // sell-back value
    profit:       number | null; // current P&L
    isOpen:       boolean;
    isWin:        boolean | null;
    entrySpot:    string | null;
    exitSpot:     string | null;
    longcode:     string;
    purchaseTime: string;
    /** ACCU only: upper/lower barriers from the open contract (numeric).
     *  Drawn on the live price chart so the trader can see whether the
     *  next tick will keep them in profit or break the barrier. */
    highBarrier:    number | null;
    lowBarrier:     number | null;
    entrySpotNum:   number | null;
    /** Set true the moment a price tick is observed outside [low,high]. */
    barrierBroken:  boolean;
    /** MULT only: auto-liquidation price level (Deriv's stop_out). If the
     *  spot crosses it, the position is closed for the configured loss. */
    stopOutLevel:    number | null;
    /** MULT only: user-set take-profit / stop-loss price levels (Deriv
     *  reports them as `limit_order.take_profit.value` / `.stop_loss.value`). */
    takeProfitLevel: number | null;
    stopLossLevel:   number | null;
}

export type DTContractEventKind = 'cashout' | 'tp' | 'sl';
export interface DTContractEvent {
    kind:         DTContractEventKind;
    profit:       number;
    contractId:   string;
    contractType: DTContractType;
}

export interface DTConfig {
    symbol:        string;
    contractType:  DTContractType;
    /** Binary contracts use duration; ACCU/MULT do not. */
    durationValue: number;
    durationUnit:  DTDurationUnit;
    stake:         number;
    /** '+0.001' / '-0.001' for H/L + Touch, '5' for digits, null otherwise. */
    barrier:       string | null;
    currency:      string;
    // Accumulators
    growthRate?:   number;   // 0.01 .. 0.05 (1%..5%)
    // Multipliers
    multiplier?:   number;   // e.g. 50, 100, 200, 300, 400, 500
    // Optional limit orders (ACCU / MULT)
    takeProfit?:   number | null;
    stopLoss?:     number | null;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DTraderEngine {
    // ── Public callbacks ──────────────────────────────────────────────────────
    public onTick:     (spot: string, digit: number) => void = () => {};
    public onProposal: (p: DTProposal | null)         => void = () => {};
    public onPosition: (p: DTPosition)                => void = () => {};
    public onStatus:   (s: DTStatus)                  => void = () => {};
    public onLog:      (l: DTLog)                     => void = () => {};
    public onBuyFeedback: (f: DTBuyFeedback)          => void = () => {};
    /** Last-digit frequency counts over the rolling 1000-tick window.
     *  Always 10 elements long, indices 0-9 → counts. Emit once on
     *  history seed, then once per new tick. */
    public onDigitStats: (counts: number[])           => void = () => {};
    /** Rolling window of the last ~120 raw price quotes — used to draw the
     *  Accumulators-style live price chart with barrier overlay. Emitted
     *  once on history seed and once per new tick. */
    public onPriceWindow: (prices: number[])          => void = () => {};
    /** Fires once when an open contract reaches a notable end state — used
     *  to drive the full-screen Cash-Out / TP / SL popups. Plain expiry of
     *  binary contracts does NOT fire this event (the position card already
     *  shows the result). */
    public onContractEvent: (e: DTContractEvent)      => void = () => {};

    // ── State ─────────────────────────────────────────────────────────────────
    private cfg: DTConfig | null = null;
    private status: DTStatus = 'idle';

    private msgSub: { unsubscribe: () => void } | null = null;

    private reqBase    = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter = 0;
    private myReqIds   = new Set<number>();

    // Subscriptions we own
    private tickSubId:     string | null = null;
    private proposalSubId: string | null = null;
    private positions:     Map<string, DTPosition> = new Map();
    private posSubIds:     Map<string, string> = new Map(); // contractId → POC sub id
    private posSubIdSet:   Set<string>           = new Set(); // reverse lookup, O(1) per WS msg
    private settledIds:    Set<string>           = new Set(); // ignore further POC updates after settle

    // Debounce for proposal refresh
    private proposalDebounce: ReturnType<typeof setTimeout> | null = null;
    private readonly PROPOSAL_DEBOUNCE_MS = 250;

    // Buy in-flight guard
    private buyInflight = false;
    /** When true, the next live proposal will trigger an automatic buy and
     *  this flag clears. Used by placeBuyNow() so a single button tap can
     *  set the contract type AND fire the trade with one fresh proposal. */
    private pendingBuy = false;
    /** Fingerprint of the config that generated the latest currentProposal.
     *  If placeBuyNow() is called with an identical fingerprint we skip the
     *  proposal refresh entirely and buy in the same network round-trip. */
    private currentProposalCfgKey: string | null = null;

    // ── Connection liveness ──────────────────────────────────────────────
    /** Wall-clock time of the most recent tick. If this gets stale the
     *  health-check timer kicks in to force a tick re-subscribe. */
    private lastTickAt = 0;
    private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
    private visListener: (() => void) | null = null;
    /** Contract ids the user explicitly asked us to sell — used to label
     *  their settlement event as a 'cashout' instead of 'tp'/'sl'. */
    private manuallySold: Set<string> = new Set();

    // Rolling last-digit window for the digit-frequency analyzer
    private readonly DIGIT_WINDOW = 1000;
    private digitBuf: number[] = [];                    // FIFO of last 1000 last-digits
    private digitCounts: number[] = new Array(10).fill(0);

    // Rolling raw-price window for the live ACCU/MULT chart
    private readonly PRICE_WINDOW = 120;
    private priceBuf: number[] = [];
    /** Pip size for the currently-subscribed symbol — needed to compute the
     *  last digit correctly (e.g. V100 has pip_size 2, but the raw quote
     *  string can have trailing zeros stripped). Defaults to undefined until
     *  we get the first tick/history response that includes it. */
    private pipSize: number | undefined = undefined;

    // Engine-owned latest proposal — single source of truth for buy.
    // React state can lag a render behind, which would send a stale id
    // that Deriv has already invalidated. Always buy from this instead.
    private currentProposal: DTProposal | null = null;

    private logSeq      = 0;
    private feedbackSeq = 0;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(initialCfg: DTConfig): void {
        if (!api_base.api) { this.fail('Deriv connection not ready — please log in first.'); return; }
        if (!api_base.is_authorized) { this.fail('Not authorized — log in to your Deriv account first.'); return; }

        this.stop(); // clean any prior state
        this.resetDigitWindow(); // clear stale data from previous market immediately

        this.cfg = { ...initialCfg };
        this.setStatus('subscribing');
        this.log(`DTrader ready on ${this.cfg.symbol}`, 'system');

        this.msgSub = (api_base.api as any).onMessage().subscribe((raw: any) => {
            this.handle(raw?.data ?? raw);
        });

        this.subscribeTick();
        this.scheduleProposal();

        // ── Liveness watchdogs — fix the "page goes to sleep" bug where
        //    backgrounded tabs or idle WS connections stop receiving ticks.
        this.lastTickAt = Date.now();
        // Keep the WS warm so Deriv doesn't idle-close it.
        this.keepAliveTimer = setInterval(() => {
            if (api_base.is_authorized) this.rawSend({ ping: 1 });
        }, 25_000);
        // If no tick in 20s, force a re-subscribe — covers backgrounded tabs,
        // dropped subs, and any silent failure where the WS is up but ticks
        // stopped flowing.
        this.healthCheckTimer = setInterval(() => {
            if (!this.cfg) return;
            if (Date.now() - this.lastTickAt > 20_000) {
                this.log('No ticks for 20s — recovering subscriptions', 'system');
                this.recoverSubscriptions();
            }
        }, 8_000);
        // When the user comes back to the tab, kick everything immediately
        // instead of waiting for the next 8s health-check pass.
        if (typeof document !== 'undefined') {
            this.visListener = () => {
                if (document.visibilityState === 'visible' && this.cfg) {
                    setTimeout(() => this.recoverSubscriptions(), 200);
                }
            };
            document.addEventListener('visibilitychange', this.visListener);
        }
    }

    stop(): void {
        if (this.proposalDebounce) { clearTimeout(this.proposalDebounce); this.proposalDebounce = null; }
        if (this.keepAliveTimer)   { clearInterval(this.keepAliveTimer);   this.keepAliveTimer = null; }
        if (this.healthCheckTimer) { clearInterval(this.healthCheckTimer); this.healthCheckTimer = null; }
        if (this.visListener && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visListener);
            this.visListener = null;
        }
        if (this.tickSubId)     { this.rawSend({ forget: this.tickSubId });     this.tickSubId = null; }
        if (this.proposalSubId) { this.rawSend({ forget: this.proposalSubId }); this.proposalSubId = null; }
        this.posSubIds.forEach(id => this.rawSend({ forget: id }));
        this.posSubIds.clear();
        this.posSubIdSet.clear();
        this.settledIds.clear();
        this.manuallySold.clear();
        this.msgSub?.unsubscribe();
        this.msgSub = null;
        this.myReqIds.clear();
        this.buyInflight = false;
        this.pendingBuy = false;
        this.currentProposal = null;
        this.currentProposalCfgKey = null;
        this.setStatus('idle');
    }

    /** Re-establish tick + proposal subscriptions after a freeze / suspend.
     *  Cheap to call repeatedly — `forget` on null sub-ids is a no-op. */
    private recoverSubscriptions(): void {
        if (!this.cfg) return;
        if (this.tickSubId) { this.rawSend({ forget: this.tickSubId }); this.tickSubId = null; }
        this.subscribeTick();
        this.refreshProposal();
        this.lastTickAt = Date.now(); // reset the watchdog so we don't loop
    }

    // ── Config setters (any change triggers a debounced proposal refresh) ────

    updateConfig(patch: Partial<DTConfig>): void {
        if (!this.cfg) return;
        const oldSymbol = this.cfg.symbol;
        this.cfg = { ...this.cfg, ...patch };
        if (patch.symbol && patch.symbol !== oldSymbol) {
            // Re-subscribe ticks on new symbol + reset the digit window
            if (this.tickSubId) { this.rawSend({ forget: this.tickSubId }); this.tickSubId = null; }
            this.resetDigitWindow();
            this.subscribeTick();
        }
        // Skip the debounced refresh if a buy is armed — placeBuyNow() already
        // kicked off an immediate refresh that will trigger the trade. Hitting
        // scheduleProposal here would create a second redundant subscription.
        if (this.pendingBuy) return;
        this.scheduleProposal();
    }

    /**
     * Apply a config patch AND auto-buy as soon as the resulting fresh
     * proposal arrives. Used by the digit-contract tap-to-buy flow where a
     * single click on "Even" / "Over" / etc. should change the contract
     * type and place the trade in one shot.
     */
    placeBuyNow(patch: Partial<DTConfig>): void {
        if (!this.cfg) {
            this.emitBuyError('Engine not started — try refreshing the page');
            return;
        }
        if (!api_base.is_authorized) {
            this.emitBuyError('Not logged in to Deriv — log in first to place trades');
            return;
        }
        if (this.buyInflight) {
            this.emitBuyError('A buy is already being placed…');
            return;
        }

        const newCfg = { ...this.cfg, ...patch };

        // ── Fast path: instant buy with the existing proposal ──────────────
        // If we already have a fresh proposal that covers exactly this config,
        // skip the network round-trip to refresh and fire the buy right now.
        // This makes 1-tick digit trades execute on the very next tick.
        const newKey = [
            newCfg.contractType,
            newCfg.barrier ?? '',
            newCfg.durationValue,
            newCfg.durationUnit,
            newCfg.symbol,
            newCfg.stake,
            newCfg.currency,
        ].join('|');

        if (
            this.currentProposal !== null &&
            this.currentProposalCfgKey === newKey
        ) {
            this.cfg = newCfg;
            this.pendingBuy = false;
            this.log('⚡ Instant buy — proposal already valid', 'info');
            this.buy();
            return;
        }

        // ── Slow path: refresh proposal then auto-buy ───────────────────────
        this.cfg = newCfg;
        this.pendingBuy = true;
        // Cancel any debounced refresh and fire an immediate one — the user
        // tapped a buy button, they want it to feel snappy.
        if (this.proposalDebounce) { clearTimeout(this.proposalDebounce); this.proposalDebounce = null; }
        this.refreshProposal();
    }

    // ── Buy ───────────────────────────────────────────────────────────────────

    /**
     * Sell an open contract back to Deriv at market price. Used for
     * Accumulators / Multipliers where the user decides when to close.
     */
    sellContract(contractId: string): void {
        if (!api_base.is_authorized) {
            this.emitBuyError('Not logged in to Deriv — log in first to sell positions');
            return;
        }
        this.log(`◀︎ Selling #${contractId} at market`, 'info');
        // Tag this contract so the eventual settlement is classified as a
        // cashout (full-screen 🏆 popup) instead of TP/SL.
        this.manuallySold.add(contractId);
        this.send({ sell: contractId, price: 0 });
    }

    /**
     * Place a buy using the latest proposal pushed by the server (engine-owned,
     * never stale). Returns nothing — feedback is delivered via onBuyFeedback
     * and onLog so the UI can surface it prominently.
     */
    buy(): void {
        if (!this.cfg) {
            this.fail('Engine not started — try refreshing the page', false);
            return;
        }
        if (!api_base.is_authorized) {
            this.emitBuyError('Not logged in to Deriv — log in first to place trades');
            return;
        }
        if (!this.currentProposal) {
            this.emitBuyError('No live price yet — wait a moment and tap BUY again');
            return;
        }
        if (this.buyInflight) {
            this.emitBuyError('A buy is already being placed…');
            return;
        }

        const p = this.currentProposal;
        this.buyInflight = true;
        this.log(
            `▶︎ Buying ${this.formatContractLabel()} on ${this.cfg.symbol}  stake $${this.cfg.stake.toFixed(2)}  (proposal ${p.id.slice(0, 8)}…)`,
            'info'
        );
        this.send({ buy: p.id, price: p.askPrice });
    }

    // ── Internal: subscriptions ───────────────────────────────────────────────

    private subscribeTick(): void {
        if (!this.cfg) return;
        // Use ticks_history with subscribe:1 — Deriv returns the last 1000
        // ticks (used to seed the digit-frequency window) AND opens the
        // tick subscription in a single round-trip.
        this.send({
            ticks_history: this.cfg.symbol,
            adjust_start_time: 1,
            count: this.DIGIT_WINDOW,
            end:   'latest',
            start: 1,
            style: 'ticks',
            subscribe: 1,
        });
    }

    private resetDigitWindow(): void {
        this.digitBuf = [];
        this.digitCounts = new Array(10).fill(0);
        this.priceBuf = [];
        this.pipSize = undefined;
        this.onDigitStats(this.digitCounts.slice());
        this.onPriceWindow([]);
    }

    private pushDigit(d: number): void {
        if (d < 0 || d > 9 || !Number.isInteger(d)) return;
        this.digitBuf.push(d);
        this.digitCounts[d] += 1;
        while (this.digitBuf.length > this.DIGIT_WINDOW) {
            const old = this.digitBuf.shift()!;
            this.digitCounts[old] -= 1;
        }
    }

    private pushPrice(q: number): void {
        if (!Number.isFinite(q)) return;
        this.priceBuf.push(q);
        if (this.priceBuf.length > this.PRICE_WINDOW) {
            this.priceBuf.splice(0, this.priceBuf.length - this.PRICE_WINDOW);
        }
    }

    /** Check every open ACCU position: if the latest tick is outside the
     *  contract's [low,high] barriers, mark it as broken so the chart can
     *  flash a "BARRIER BROKEN" warning even before settlement arrives. */
    private detectBarrierBreach(price: number): void {
        for (const pos of this.positions.values()) {
            if (!pos.isOpen || pos.contractType !== 'ACCU') continue;
            if (pos.barrierBroken) continue;
            if (pos.highBarrier !== null && pos.lowBarrier !== null) {
                if (price > pos.highBarrier || price < pos.lowBarrier) {
                    pos.barrierBroken = true;
                    this.onPosition(pos);
                }
            }
        }
    }

    private scheduleProposal(): void {
        if (this.proposalDebounce) clearTimeout(this.proposalDebounce);
        this.proposalDebounce = setTimeout(() => this.refreshProposal(), this.PROPOSAL_DEBOUNCE_MS);
    }

    private refreshProposal(): void {
        if (!this.cfg) return;
        // Forget previous proposal sub, then ask for a fresh subscribed one.
        if (this.proposalSubId) { this.rawSend({ forget: this.proposalSubId }); this.proposalSubId = null; }
        this.currentProposal = null;
        this.currentProposalCfgKey = null;
        this.onProposal(null); // clear UI while loading

        const ct = this.cfg.contractType;
        const isAccu = ct === 'ACCU';
        const isMult = ct === 'MULTUP' || ct === 'MULTDOWN';

        const payload: Record<string, unknown> = {
            proposal:          1,
            subscribe:         1,
            amount:            this.cfg.stake,
            basis:             'stake',
            contract_type:     ct,
            currency:          this.cfg.currency,
            underlying_symbol: this.cfg.symbol,
        };

        if (isAccu) {
            payload.growth_rate = this.cfg.growthRate ?? 0.03;
            const tp = this.cfg.takeProfit;
            if (tp != null && tp > 0) payload.limit_order = { take_profit: tp };
        } else if (isMult) {
            payload.multiplier = this.cfg.multiplier ?? 100;
            const limit: Record<string, number> = {};
            if (this.cfg.takeProfit != null && this.cfg.takeProfit > 0) limit.take_profit = this.cfg.takeProfit;
            if (this.cfg.stopLoss   != null && this.cfg.stopLoss   > 0) limit.stop_loss   = this.cfg.stopLoss;
            if (Object.keys(limit).length) payload.limit_order = limit;
        } else {
            // Binary contracts — fixed duration + optional barrier
            payload.duration      = this.cfg.durationValue;
            payload.duration_unit = this.cfg.durationUnit;
            if (this.cfg.barrier !== null && this.cfg.barrier !== '') {
                payload.barrier = this.cfg.barrier;
            }
        }
        this.send(payload);
    }

    // ── Internal: message routing ─────────────────────────────────────────────

    private handle(msg: Record<string, any>): void {
        if (!msg) return;

        const subId = msg?.subscription?.id as string | undefined;
        const reqId = msg?.req_id            as number | undefined;

        const isMyReq = reqId !== undefined && this.myReqIds.has(reqId);
        const isMyTick = subId !== undefined && subId === this.tickSubId;
        const isMyProp = subId !== undefined && subId === this.proposalSubId;
        const isMyPos  = subId !== undefined && this.posSubIdSet.has(subId);

        if (!isMyReq && !isMyTick && !isMyProp && !isMyPos) return;

        if (msg.error) {
            const m = msg.error.message ?? 'Unknown error';
            this.log(`API error [${msg.msg_type}]: ${m}`, 'error');
            if (msg.msg_type === 'proposal') {
                this.currentProposal = null;
                this.onProposal(null);
                // If we were waiting to auto-buy, surface the error now —
                // otherwise the user wonders why their tap did nothing.
                if (this.pendingBuy) {
                    this.pendingBuy = false;
                    this.emitBuyError(`Couldn't price your trade: ${m}`);
                }
            }
            if (msg.msg_type === 'buy') {
                this.buyInflight = false;
                this.pendingBuy = false;
                this.emitBuyError(m);
                // Likely a stale proposal id — refresh immediately so the next
                // tap has a fresh price ready.
                if (/proposal|invalid|expired/i.test(m)) this.refreshProposal();
            }
            if (msg.msg_type === 'sell') this.emitBuyError(`Sell failed: ${m}`);
            return;
        }

        switch (msg.msg_type) {
            case 'history':
                // ticks_history response — bulk-seed the rolling digit window
                // and capture the tick subscription id in one go.
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleHistory(msg);
                break;
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleTick(msg.tick);
                break;
            case 'proposal':
                if (subId && !this.proposalSubId) this.proposalSubId = subId;
                this.handleProposal(msg.proposal);
                break;
            case 'buy':
                this.handleBuyAck(msg.buy);
                break;
            case 'sell':
                this.handleSellAck(msg.sell);
                break;
            case 'proposal_open_contract':
                this.handlePOC(msg.proposal_open_contract, subId);
                break;
        }
    }

    private handleHistory(msg: any): void {
        const prices = msg?.history?.prices as Array<number | string> | undefined;
        const pip    = msg?.pip_size as number | undefined;
        if (typeof pip === 'number') this.pipSize = pip;
        if (!prices || !Array.isArray(prices)) return;
        // Seed the rolling window from oldest → newest
        this.digitBuf = [];
        this.digitCounts = new Array(10).fill(0);
        this.priceBuf = [];
        for (const raw of prices) {
            const q = typeof raw === 'string' ? parseFloat(raw) : raw;
            if (!Number.isFinite(q)) continue;
            this.pushDigit(this.lastDigit(q, this.pipSize));
            this.pushPrice(q);
        }
        this.onDigitStats(this.digitCounts.slice());
        this.onPriceWindow(this.priceBuf.slice());
    }

    private handleTick(tick: { quote: number; pip_size?: number } | undefined): void {
        if (!tick) return;
        if (typeof tick.pip_size === 'number') this.pipSize = tick.pip_size;
        this.lastTickAt = Date.now(); // feed the liveness watchdog
        const spot  = this.formatQuote(tick.quote, this.pipSize);
        const digit = this.lastDigit(tick.quote, this.pipSize);
        if (this.status === 'subscribing') this.setStatus('ready');
        this.onTick(spot, digit);
        this.pushDigit(digit);
        this.pushPrice(tick.quote);
        this.detectBarrierBreach(tick.quote);
        this.onDigitStats(this.digitCounts.slice());
        this.onPriceWindow(this.priceBuf.slice());
    }

    private handleProposal(p: any): void {
        if (!p) return;
        const askPrice = parseFloat(p.ask_price ?? '0');
        const payout   = parseFloat(p.payout    ?? '0');
        const profit   = payout - askPrice;

        // ── Preview ACCU barriers from contract_details ─────────────────
        // Deriv's proposal returns contract_details.high_barrier /
        // low_barrier as numeric strings centred on the live spot. They
        // refresh on every tick — the chart uses them so the trader can
        // see *where* their barriers will sit before placing the trade.
        const cd = p.contract_details;
        let pHi: number | null = null, pLo: number | null = null, pSo: number | null = null;
        if (cd) {
            if (cd.high_barrier !== undefined) {
                const v = parseFloat(cd.high_barrier);
                if (Number.isFinite(v)) pHi = v;
            }
            if (cd.low_barrier !== undefined) {
                const v = parseFloat(cd.low_barrier);
                if (Number.isFinite(v)) pLo = v;
            }
            // ACCU sometimes returns barriers under barrier_spot_distance;
            // fall back to spot ± distance when explicit barriers absent.
            if ((pHi === null || pLo === null) && cd.barrier_spot_distance !== undefined) {
                const dist = parseFloat(cd.barrier_spot_distance);
                const sp   = parseFloat(p.spot);
                if (Number.isFinite(dist) && Number.isFinite(sp)) {
                    if (pHi === null) pHi = sp + dist;
                    if (pLo === null) pLo = sp - dist;
                }
            }
        }

        // ── Preview MULT stop-out from limit_order.stop_out.value ───────
        if (p.limit_order?.stop_out?.value !== undefined) {
            const v = parseFloat(p.limit_order.stop_out.value);
            if (Number.isFinite(v)) pSo = v;
        }

        const spotNum = (() => {
            const v = parseFloat(p.spot);
            return Number.isFinite(v) ? v : null;
        })();

        const proposal: DTProposal = {
            id:        p.id,
            askPrice,
            payout,
            profit,
            profitPct: askPrice > 0 ? (profit / askPrice) * 100 : 0,
            longcode:  p.longcode ?? '',
            spot:      String(p.spot ?? ''),
            spotNum,
            previewHighBarrier: pHi,
            previewLowBarrier:  pLo,
            previewStopOut:     pSo,
        };
        // Engine-owned source of truth — used by buy() so we always send the
        // latest id, never one that React state hasn't caught up to.
        this.currentProposal = proposal;
        // Fingerprint the current config so placeBuyNow() can skip a refresh
        // next time the user taps the same direction with the same settings.
        if (this.cfg) {
            this.currentProposalCfgKey = [
                this.cfg.contractType,
                this.cfg.barrier ?? '',
                this.cfg.durationValue,
                this.cfg.durationUnit,
                this.cfg.symbol,
                this.cfg.stake,
                this.cfg.currency,
            ].join('|');
        }
        this.onProposal(proposal);

        // Tap-to-buy completion path: if a buy was armed via placeBuyNow(),
        // fire it as soon as the fresh proposal lands.
        if (this.pendingBuy && !this.buyInflight) {
            this.pendingBuy = false;
            this.buy();
        }
    }

    private handleSellAck(sell: any): void {
        if (!sell?.contract_id) return;
        const profit = parseFloat(sell.sold_for ?? '0') - parseFloat(sell.balance_after ?? '0') * 0; // sold_for is the realized
        const sold   = parseFloat(sell.sold_for ?? '0');
        this.emitBuySuccess(`Sold #${sell.contract_id} for $${sold.toFixed(2)}`);
        // The proposal_open_contract subscription will deliver the final
        // settlement record (profit, exit spot) shortly.
        void profit;
    }

    private handleBuyAck(buy: any): void {
        this.buyInflight = false;
        if (!buy?.contract_id) {
            this.log('Buy ack missing contract_id', 'error');
            this.emitBuyError('Buy failed — no contract returned');
            return;
        }
        const contractId = String(buy.contract_id);
        const buyPrice   = parseFloat(buy.buy_price ?? '0');
        const payout     = parseFloat(buy.payout    ?? '0');
        const stake      = this.cfg?.stake ?? buyPrice;
        this.emitBuySuccess(`Bought #${contractId}  $${buyPrice.toFixed(2)} → payout $${payout.toFixed(2)}`);

        const pos: DTPosition = {
            contractId,
            contractType: this.cfg?.contractType ?? 'CALL',
            barrier:      this.cfg?.barrier ?? null,
            symbol:       this.cfg?.symbol ?? '',
            stake,
            payout,
            buyPrice,
            currentSpot:  null,
            currentBid:   null,
            profit:       null,
            isOpen:       true,
            isWin:        null,
            entrySpot:    null,
            highBarrier:    null,
            lowBarrier:     null,
            entrySpotNum:   null,
            barrierBroken:  false,
            stopOutLevel:    null,
            takeProfitLevel: null,
            stopLossLevel:   null,
            exitSpot:     null,
            longcode:     buy.longcode ?? '',
            purchaseTime: this.nowTime(),
        };
        this.positions.set(contractId, pos);
        this.onPosition(pos);
        this.log(`✅ Bought #${contractId}  stake $${buyPrice.toFixed(2)}  payout $${payout.toFixed(2)}`, 'info');

        // Subscribe to settlement
        this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });

        // CRITICAL: the proposal id we just used is now invalidated on Deriv's
        // side. If the user taps BUY again before the proposal subscription
        // pushes a fresh id, the trade gets rejected with a generic
        // "Refresh the page or relaunch the app" error. Force a refresh now.
        this.refreshProposal();
    }

    private handlePOC(poc: any, subId: string | undefined): void {
        if (!poc?.contract_id) return;
        const contractId = String(poc.contract_id);

        // After settlement, ignore further POC updates so the freed memory
        // doesn't get repopulated by stale messages.
        if (this.settledIds.has(contractId)) return;

        const pos = this.positions.get(contractId);
        if (!pos) return;

        if (subId && !this.posSubIds.has(contractId)) {
            this.posSubIds.set(contractId, subId);
            this.posSubIdSet.add(subId);
        }

        // Live updates while open
        const profit  = poc.profit !== undefined ? parseFloat(poc.profit) : pos.profit;
        const bid     = poc.bid_price !== undefined ? parseFloat(poc.bid_price) : pos.currentBid;
        const spot    = poc.current_spot_display_value as string | undefined;
        const entry   = poc.entry_tick_display_value   as string | undefined;
        const exit    = poc.exit_tick_display_value    as string | undefined;

        const settled = !!(poc.is_sold || poc.status === 'won' || poc.status === 'lost');

        // Skip noisy no-op updates while open (same profit + same spot) — they
        // would otherwise trigger a React re-render of every position card
        // every tick, which is the main cause of the tab freezing under load.
        if (!settled
            && profit === pos.profit
            && bid    === pos.currentBid
            && (!spot || spot === pos.currentSpot)
        ) {
            return;
        }

        pos.profit      = profit;
        pos.currentBid  = bid;
        if (spot) pos.currentSpot = spot;
        if (entry && !pos.entrySpot) pos.entrySpot = entry;

        // ACCU contracts carry barrier prices on every POC — capture them so
        // the chart can render the upper/lower lines and the breach band.
        if (poc.high_barrier !== undefined) {
            const hb = parseFloat(poc.high_barrier);
            if (Number.isFinite(hb)) pos.highBarrier = hb;
        }
        if (poc.low_barrier !== undefined) {
            const lb = parseFloat(poc.low_barrier);
            if (Number.isFinite(lb)) pos.lowBarrier = lb;
        }
        if (poc.entry_spot !== undefined && pos.entrySpotNum === null) {
            const es = parseFloat(poc.entry_spot);
            if (Number.isFinite(es)) pos.entrySpotNum = es;
        }
        // MULT: pull stop-out + take-profit / stop-loss price levels from
        // limit_order so the chart can draw the auto-liquidation line + any
        // user-configured TP/SL targets.
        const lo = poc.limit_order;
        if (lo) {
            if (lo.stop_out?.value !== undefined) {
                const v = parseFloat(lo.stop_out.value);
                if (Number.isFinite(v)) pos.stopOutLevel = v;
            }
            if (lo.take_profit?.value !== undefined) {
                const v = parseFloat(lo.take_profit.value);
                if (Number.isFinite(v)) pos.takeProfitLevel = v;
            } else if (lo.take_profit === null) {
                pos.takeProfitLevel = null;
            }
            if (lo.stop_loss?.value !== undefined) {
                const v = parseFloat(lo.stop_loss.value);
                if (Number.isFinite(v)) pos.stopLossLevel = v;
            } else if (lo.stop_loss === null) {
                pos.stopLossLevel = null;
            }
        }

        if (settled) {
            pos.isOpen   = false;
            pos.isWin    = poc.status === 'won';
            pos.exitSpot = exit ?? pos.currentSpot;
            const sign   = (pos.profit ?? 0) >= 0 ? '+' : '';
            const move   = (pos.entrySpot || pos.exitSpot)
                ? `  ${pos.entrySpot ?? '?'} → ${pos.exitSpot ?? '?'}`
                : '';
            this.log(
                pos.isWin
                    ? `✅ WIN  ${sign}$${(pos.profit ?? 0).toFixed(2)}${move}  #${contractId}`
                    : `❌ LOSS ${sign}$${(pos.profit ?? 0).toFixed(2)}${move}  #${contractId}`,
                pos.isWin ? 'win' : 'loss',
            );

            // Classify settle reason for the full-screen popup. Manual
            // sells we initiated take priority — if user clicked CASH OUT
            // even at a profit that would also satisfy take-profit, it's
            // still a cashout from their perspective.
            const finalProfit = pos.profit ?? 0;
            const sellReason  = (poc.sell_reason ?? '') as string;
            let kind: DTContractEventKind | null = null;
            if (this.manuallySold.has(contractId)) {
                kind = 'cashout';
                this.manuallySold.delete(contractId);
            } else if (sellReason === 'take_profit') {
                kind = 'tp';
            } else if (sellReason === 'stop_loss') {
                kind = 'sl';
            }
            if (kind) {
                this.onContractEvent({
                    kind,
                    profit:       finalProfit,
                    contractId,
                    contractType: pos.contractType,
                });
            }
            // Cleanup subscription + drop from in-engine maps. The UI keeps its
            // own copy in React state so the settled card stays visible.
            const sid = this.posSubIds.get(contractId);
            if (sid) {
                this.rawSend({ forget: sid });
                this.posSubIds.delete(contractId);
                this.posSubIdSet.delete(sid);
            }
            this.settledIds.add(contractId);
            this.positions.delete(contractId);
        }
        this.onPosition({ ...pos });
    }

    // ── Internal: WS helpers ──────────────────────────────────────────────────

    private send(payload: Record<string, unknown>): number {
        const reqId = this.reqBase + (++this.reqCounter);
        this.myReqIds.add(reqId);
        this.rawSend({ req_id: reqId, ...payload });
        return reqId;
    }

    private rawSend(payload: Record<string, unknown>): void {
        try { (api_base.api as any).send(payload); } catch { /* ignore */ }
    }

    // ── Internal: helpers ────────────────────────────────────────────────────

    private setStatus(s: DTStatus): void {
        if (this.status === s) return;
        this.status = s;
        this.onStatus(s);
    }

    private fail(msg: string, hardFail = true): void {
        this.log(msg, 'error');
        if (hardFail) this.setStatus('error');
    }

    private emitBuyError(message: string): void {
        this.log(message, 'error');
        this.onBuyFeedback({ seq: ++this.feedbackSeq, kind: 'error', message });
    }

    private emitBuySuccess(message: string): void {
        this.onBuyFeedback({ seq: ++this.feedbackSeq, kind: 'success', message });
    }

    private log(message: string, type: DTLogType = 'info'): void {
        this.onLog({ seq: ++this.logSeq, time: this.nowTime(), message, type });
    }

    private nowTime(): string {
        const d = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    private lastDigit(q: number, pipSize?: number): number {
        // Use pip_size when available — otherwise V100's "1379.5" trailing
        // zero gets stripped and we'd misread "5" as the last digit when
        // really the contract sees "1379.55" (last digit 5) or "1379.50"
        // (last digit 0). pip_size guarantees the correct decimal width.
        if (typeof pipSize === 'number' && pipSize > 0) {
            const fixed = q.toFixed(pipSize);
            return parseInt(fixed[fixed.length - 1] ?? '0', 10);
        }
        const s = q.toString().replace(/^.*\./, '');
        return parseInt(s[s.length - 1] ?? '0', 10);
    }

    private formatQuote(quote: number, pipSize?: number): string {
        if (typeof pipSize === 'number' && pipSize > 0) return quote.toFixed(pipSize);
        const s = quote.toString();
        const dot = s.indexOf('.');
        if (dot === -1) return quote.toFixed(2);
        return quote.toFixed(Math.min(Math.max(s.length - dot - 1, 2), 8));
    }

    private formatContractLabel(): string {
        if (!this.cfg) return '';
        const t = this.cfg.contractType;
        switch (t) {
            case 'CALL':       return this.cfg.barrier ? 'HIGHER' : 'RISE';
            case 'PUT':        return this.cfg.barrier ? 'LOWER'  : 'FALL';
            case 'ONETOUCH':   return 'TOUCH';
            case 'NOTOUCH':    return 'NO TOUCH';
            case 'DIGITMATCH': return `MATCH ${this.cfg.barrier ?? ''}`;
            case 'DIGITDIFF':  return `DIFFER ${this.cfg.barrier ?? ''}`;
            case 'DIGITOVER':  return `OVER ${this.cfg.barrier ?? ''}`;
            case 'DIGITUNDER': return `UNDER ${this.cfg.barrier ?? ''}`;
            case 'DIGITEVEN':  return 'EVEN';
            case 'DIGITODD':   return 'ODD';
            default:           return t;
        }
    }
}

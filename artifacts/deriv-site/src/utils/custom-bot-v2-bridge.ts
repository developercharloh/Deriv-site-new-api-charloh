// ─── Custom Speed Bot ⇄ V2 Engine Bridge ──────────────────────────────────────
// When the user selects V2 in the Speed Bots engine selector, the four custom
// Speed Bots (Virtual Hook, Dollar Flow, Over/Under 2-7, Tri-Market) keep their
// own self-contained trading engines but their live stats, run state, and TP/SL
// alerts get mirrored into v2EngineStore so everything appears unified inside
// the V2 Advanced Engine panel.
//
// The custom engines are not config-driven and can't be replaced by V2's
// generic execution loop, so this bridge gives V2 mode meaning for them
// without rewriting their strategies.

import { runInAction } from 'mobx';
import { v2EngineStore }    from './v2-engine-store';

const _noopEngine = {
    is_running: false, total_profit: 0, wins: 0, losses: 0,
    current_stake: 0, last_event: null as null,
    subscribe: (_fn: () => void) => () => {},
};
const apolloEngine     = _noopEngine;
const dollarFlowEngine = _noopEngine;
const ouEngine         = _noopEngine;
const triEngine        = _noopEngine;

const ENGINE_KEY = 'free_bots_engine_mode';

interface CustomEngineLike {
    is_running:    boolean;
    total_profit:  number;
    wins:          number;
    losses:        number;
    current_stake: number;
    last_event:    { kind: string; message?: string } | null;
    subscribe:     (fn: () => void) => () => void;
}

interface BridgeEntry {
    name:  string;
    e:     CustomEngineLike;
}

// All four singleton engines wrapped uniformly. Tri-engine has aggregate fields
// computed across its three markets — we pull those when reporting.
const ENGINES: BridgeEntry[] = [
    { name: 'Virtual Hook',     e: apolloEngine     as unknown as CustomEngineLike },
    { name: 'Dollar Flow',      e: dollarFlowEngine as unknown as CustomEngineLike },
    { name: 'Over/Under 2-7',   e: ouEngine         as unknown as CustomEngineLike },
    { name: 'Tri-Market',       e: triEngine        as unknown as CustomEngineLike },
];

let activeEntry:    BridgeEntry | null = null;
let lastEventRef:   unknown            = null;
let initialized                        = false;

function isV2Mode(): boolean {
    try { return localStorage.getItem(ENGINE_KEY) === 'v2'; } catch { return false; }
}

function nowTime(): string {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
}

function pushBridgeLog(message: string, type: 'info' | 'win' | 'loss' | 'system' = 'system'): void {
    runInAction(() => {
        v2EngineStore.pushLog({
            seq:     Date.now(),
            time:    nowTime(),
            message,
            type,
        });
    });
}

// Pull aggregate stats from a custom engine. Tri-Market exposes per-slot stats
// instead of flat totals, so we look at its summary fields if present.
function readStats(entry: BridgeEntry): { profit: number; wins: number; losses: number; stake: number } {
    const e = entry.e as any;

    // Tri engine: sum across three markets
    if (entry.name === 'Tri-Market' && e.states) {
        const m = e.states;
        const profit = (m.M1?.profit ?? 0) + (m.M2?.profit ?? 0) + (m.M3?.profit ?? 0);
        const wins   = (m.M1?.wins   ?? 0) + (m.M2?.wins   ?? 0) + (m.M3?.wins   ?? 0);
        const losses = (m.M1?.losses ?? 0) + (m.M2?.losses ?? 0) + (m.M3?.losses ?? 0);
        const stake  = (m.M1?.current_stake ?? 0) + (m.M2?.current_stake ?? 0) + (m.M3?.current_stake ?? 0);
        return { profit, wins, losses, stake };
    }

    return {
        profit: e.total_profit  ?? 0,
        wins:   e.wins          ?? 0,
        losses: e.losses        ?? 0,
        stake:  e.current_stake ?? 0,
    };
}

function syncEntry(entry: BridgeEntry): void {
    if (!isV2Mode()) return;

    const e = entry.e;

    // Take ownership of the V2 store when this engine starts running
    if (e.is_running && activeEntry?.e !== e) {
        // If another bot was active, release it first
        if (activeEntry) {
            pushBridgeLog(`${activeEntry.name} replaced by ${entry.name}`);
        }
        activeEntry  = entry;
        lastEventRef = null;

        runInAction(() => {
            v2EngineStore.reset(0);
            v2EngineStore.setStatus('trading');
        });
        pushBridgeLog(`⚡ V2 mirror started for ${entry.name}`, 'info');
    }

    // While this engine is the active one, mirror its data into v2EngineStore
    if (activeEntry?.e === e) {
        const stats = readStats(entry);

        runInAction(() => {
            v2EngineStore.setStats(stats.profit, stats.wins, stats.losses, stats.stake);
        });

        // Engine just stopped — release ownership
        if (!e.is_running && v2EngineStore.running) {
            runInAction(() => {
                v2EngineStore.setStatus('stopped');
            });
            pushBridgeLog(`${entry.name} stopped (final P/L ${stats.profit.toFixed(2)})`,
                stats.profit > 0 ? 'win' : stats.profit < 0 ? 'loss' : 'info');
            activeEntry  = null;
            lastEventRef = null;
            return;
        }

        // Mirror TP/SL alerts (each event object identity is unique per emit)
        const ev = e.last_event as any;
        if (ev && ev !== lastEventRef && (ev.kind === 'tp' || ev.kind === 'sl')) {
            lastEventRef = ev;
            runInAction(() => {
                v2EngineStore.setAlert(ev.kind, Math.abs(stats.profit), stats.profit);
            });
            pushBridgeLog(
                ev.kind === 'tp'
                    ? `🎯 Take Profit hit: +${stats.profit.toFixed(2)}`
                    : `🛑 Stop Loss hit: ${stats.profit.toFixed(2)}`,
                ev.kind === 'tp' ? 'win' : 'loss'
            );
        }
        if (!ev) lastEventRef = null;
    }
}

// Called once at app boot. Subscribes to every custom engine; the per-engine
// listener is a no-op when V2 mode is off.
export function initCustomBotV2Bridge(): void {
    if (initialized) return;
    initialized = true;
    for (const entry of ENGINES) {
        try {
            entry.e.subscribe(() => syncEntry(entry));
        } catch {
            /* engine missing subscribe — skip */
        }
    }
}

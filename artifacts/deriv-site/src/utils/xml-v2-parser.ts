// ─── XML → V2BotConfig parser ─────────────────────────────────────────────────
// Reads a Deriv DBot Blockly XML file and extracts the numeric / text values
// that the V2 engine needs. The XML is only parsed once at load time — the fast
// execution engine never touches it again.

import type { V2BotConfig, ContractKind, TradeDirection } from './deriv-v2-engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fieldText(doc: Document, attrName: string): string | null {
    const els = doc.querySelectorAll(`field[name="${attrName}"]`);
    for (const el of els) {
        const v = el.textContent?.trim();
        if (v) return v;
    }
    return null;
}

/** Walk all `variables_set` blocks, match by variable display-name, read NUM child. */
function varNum(doc: Document, displayName: string): number | null {
    const blocks = doc.querySelectorAll('block[type="variables_set"]');
    for (const b of blocks) {
        const varField = b.querySelector(':scope > field[name="VAR"]');
        if (!varField || varField.textContent?.trim() !== displayName) continue;
        const numEl = b.querySelector('block[type="math_number"] > field[name="NUM"]');
        if (numEl?.textContent) return parseFloat(numEl.textContent.trim());
    }
    return null;
}

/** Same but for `text` (string) values — e.g. Direction = "OVER". */
function varText(doc: Document, displayName: string): string | null {
    const blocks = doc.querySelectorAll('block[type="variables_set"]');
    for (const b of blocks) {
        const varField = b.querySelector(':scope > field[name="VAR"]');
        if (!varField || varField.textContent?.trim() !== displayName) continue;
        const textEl = b.querySelector('block[type="text"] > field[name="TEXT"]');
        if (textEl?.textContent) return textEl.textContent.trim();
    }
    return null;
}

/** Try several display-name aliases and return the first match. Fix #9. */
function varNumAny(doc: Document, ...names: string[]): number | null {
    for (const name of names) {
        const v = varNum(doc, name);
        if (v !== null) return v;
    }
    return null;
}

function varTextAny(doc: Document, ...names: string[]): string | null {
    for (const name of names) {
        const v = varText(doc, name);
        if (v !== null) return v;
    }
    return null;
}

// ── Contract kind mapping ─────────────────────────────────────────────────────

function resolveKind(typeList: string, direction: TradeDirection): ContractKind {
    const t = typeList.toUpperCase();
    if (t === 'DIGITMATCH')  return 'DIGITMATCH';
    if (t === 'DIGITDIFF')   return 'DIGITDIFF';
    if (t === 'DIGITEVEN')   return 'DIGITEVEN';
    if (t === 'DIGITODD')    return 'DIGITODD';
    if (t === 'DIGITOVER')   return 'DIGITOVER';
    if (t === 'DIGITUNDER')  return 'DIGITUNDER';
    // 'both' → over/under family; 'evenodd' / 'digitodd' → even/odd family
    if (t === 'BOTH' || t === 'OVERUNDER') {
        return direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
    }
    if (t === 'EVENODD') {
        return direction === 'ODD' ? 'DIGITODD' : 'DIGITEVEN';
    }
    // Fallback
    return 'DIGITMATCH';
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parseXmlV2Config(xmlText: string): V2BotConfig {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlText, 'application/xml');

    const symbol      = fieldText(doc, 'SYMBOL_LIST')  ?? 'R_100';
    const typeList    = fieldText(doc, 'TYPE_LIST')     ?? 'DIGITMATCH';

    const dirRaw      = varTextAny(doc, 'Direction', 'direction', 'dir') ?? 'OVER';
    const direction   = (['OVER','UNDER','EVEN','ODD'].includes(dirRaw.toUpperCase())
                         ? dirRaw.toUpperCase()
                         : 'OVER') as TradeDirection;

    const direction_kind = resolveKind(typeList, direction);

    const prediction      = varNumAny(doc, 'Prediction', 'prediction')                           ?? 4;
    const barrier         = varNumAny(doc, 'Barrier',    'barrier')                               ?? 5;

    // entry point: bots use varied names — try them all
    const entryPoint      = varNumAny(doc,
        'entry point', 'Entry Point', 'EntryPoint', 'entry_point', 'entrypoint'
    ) ?? prediction;

    const initialStake    = varNumAny(doc,
        'Stake', 'stake', 'InitialStake', 'initial_stake'
    ) ?? 1;

    const takeProfit      = varNumAny(doc,
        'TakeProfit', 'take_profit', 'TargetProfit', 'Target Profit', 'takeProfit', 'Take Profit'
    ) ?? 10;

    const stopLoss        = varNumAny(doc,
        'StopLoss', 'stop_loss', 'MaxLoss', 'Max Loss', 'stopLoss', 'Stop Loss'
    ) ?? 50;

    const martingale      = varNumAny(doc,
        'Martingale', 'martingale', 'martingale_factor', 'MartingaleFactor'
    ) ?? 2;

    const martingaleLevel = varNumAny(doc,
        'MartingaleLevel', 'martingale_level', 'MaxLosses', 'Max Losses', 'maxLosses'
    ) ?? 6;

    return {
        symbol,
        contractKind:    direction_kind,
        direction,
        prediction,
        barrier,
        entryPoint,
        initialStake,
        takeProfit,
        stopLoss,
        martingale,
        martingaleLevel,
    };
}

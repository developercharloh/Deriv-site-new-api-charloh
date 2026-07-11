// ─── Shared bot XML patching utilities ────────────────────────────────────────
// Used by both Free Bots and Signal Engine pages so both always load and patch
// the same real XML files.

export interface BotSignal {
    symbol:           string;
    symbolLabel:      string;
    direction:        string;   // e.g. "MATCHES 4", "DIFFERS 9", "EVEN", "ODD"
    entryPoint:       string;   // e.g. "Digit 4", "Digit 0"
    confidence:       number;
    market:           string;   // 'matches_differs' | 'even_odd' | 'over_under'
    savedAt?:         number;
    recoveryBarrier?:      number;   // Over/Under: AI-picked fallback barrier after a loss
    contractType?:         string;   // e.g. "DIGITOVER", "DIGITUNDER" — for Elite bot (primary)
    recoveryContractType?: string;   // OPPOSITE contract type for recovery (e.g. DIGITUNDER when primary is DIGITOVER)
}

export interface BlockPatch {
    blockId:    string;
    numValue?:  number;   // patches math_number → field[NUM]
    textValue?: string;   // patches text        → field[TEXT]
}

// ─── Bot ID → XML path mapping ────────────────────────────────────────────────

export const BOT_XML_PATHS: Record<string, string> = {
    'matches-signal':           '/bots/Matches_Signal_Bot.xml',
    'differ-v2':                '/bots/BINARYTOOL@_DIFFER_V2.0_(1)_(1)_1765711647662.xml',
    'even-odd-scanner':         '/bots/BINARYTOOL@EVEN_ODD_THUNDER_AI_PRO_BOT_1765711647662.xml',
    'over-under-signal':        '/bots/OverUnder_Signal_Bot.xml',
    'elite-entry-scanner':      '/bots/Elite_Entry_Scanner_Bot.xml',
    'over-under-ai-signals':    '/bots/Over_Under_AI_Signals_Bot.xml',
    'over-destroyer':           '/bots/Over_Destroyer_Bot.xml',
    'under-destroyer':          '/bots/Under_Destroyer_Bot.xml',
};

// Resolve which Destroyer bot to use from an OVER/UNDER direction string
// (e.g. "OVER 1", "UNDER 6"). Used by the AI Signal Orb's "Save and Run" flow.
export function destroyerBotIdFromDirection(direction: string): string {
    return direction.trim().toUpperCase().startsWith('UNDER') ? 'under-destroyer' : 'over-destroyer';
}

// Resolve which bot to use from a signal's market + direction
export function botIdFromSignal(signal: Pick<BotSignal, 'market' | 'direction'>): string {
    // Over/Under uses the dedicated Over Under AI Signals Bot — cross-direction recovery built in.
    if (signal.market === 'over_under')      return 'over-under-ai-signals';
    if (signal.market === 'matches_differs') {
        return signal.direction.toUpperCase().startsWith('DIFFERS')
            ? 'differ-v2'
            : 'matches-signal';
    }
    return 'even-odd-scanner';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseDigitFrom(str: string): number {
    const m = str.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
}

// ─── DOM patcher ──────────────────────────────────────────────────────────────
// Walks the bot XML by block ID and updates math_number/text values in-place.

export function patchBotXml(
    xmlText:               string,
    symbol:                string,
    patches:               BlockPatch[],
    duration?:             number,
    contractType?:         string,
    recoveryContractType?: string,
    symbolLabel?:          string,
): Document {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

    // 0. Patch TYPE_LIST (DIGITOVER / DIGITUNDER / DIGITEVEN / DIGITODD)
    if (contractType) {
        const allFieldsCt = doc.getElementsByTagName('field');
        for (let i = 0; i < allFieldsCt.length; i++) {
            if (allFieldsCt[i].getAttribute('name') === 'TYPE_LIST') {
                allFieldsCt[i].textContent = contractType;
                break;
            }
        }
    }

    // 0b. Patch PURCHASE_LIST blocks for cross-direction recovery (Elite Entry Scanner).
    //     Primary purchase path   (Analysis == "analysis") → contractType
    //     Recovery purchase paths (Analysis == "gk" + else "Mkorean SV7") → recoveryContractType
    //     Block IDs sourced directly from Elite_Entry_Scanner_Bot.xml.
    if (contractType || recoveryContractType) {
        const primaryIds  = new Set([':Nx^]Pu__xj[_w$h8*VZ', 'ouai_primary_buy']);
        const recoveryIds = new Set(['zOCam5W}Z-j~)}t9XOPF', 'BvzdHe]!O+GD=E;c7NS6', 'ouai_recovery_buy']);
        const allPurchaseBlocks = doc.getElementsByTagName('block');
        for (let i = 0; i < allPurchaseBlocks.length; i++) {
            const bid = allPurchaseBlocks[i].getAttribute('id') ?? '';
            let targetType: string | undefined;
            if (primaryIds.has(bid)  && contractType)         targetType = contractType;
            if (recoveryIds.has(bid) && recoveryContractType) targetType = recoveryContractType;
            if (!targetType) continue;
            const pFields = allPurchaseBlocks[i].getElementsByTagName('field');
            for (let j = 0; j < pFields.length; j++) {
                if (pFields[j].getAttribute('name') === 'PURCHASE_LIST') {
                    pFields[j].textContent = targetType;
                }
            }
        }
    }

    // 1. Patch SYMBOL_LIST (first match = market block)
    const allFields = doc.getElementsByTagName('field');
    for (let i = 0; i < allFields.length; i++) {
        if (allFields[i].getAttribute('name') === 'SYMBOL_LIST') {
            allFields[i].textContent = symbol;
            break;
        }
    }

    // 1b. Patch DURATION values across the whole bot.
    //
    // Strategy: for every <value name="DURATION"> we do THREE things so the
    // correct tick count wins regardless of Blockly shadow/block precedence:
    //
    //   a) Patch the NUM field of any existing <shadow> or <block> child
    //      (keeps backward-compat; also patches the existing shadow in-place).
    //   b) INSERT a new explicit <block type="math_number"> as a child of the
    //      value element.  In Blockly XML, a <block> always takes precedence
    //      over a <shadow>, so this is the definitive override. Mobile Chrome
    //      DOMParser quirks cannot affect a freshly-created element.
    //   c) Also patch any variables_set block whose VAR is "duration"
    //      (case-insensitive) in case the bot uses a dedicated variable.
    //
    // NOTE: querySelectorAll() is unreliable on XML documents (DOMParser
    // 'text/xml') in mobile Chrome — it silently returns empty NodeLists.
    // We use explicit getElementsByTagName() + createElement() instead.
    if (typeof duration === 'number' && duration >= 1) {
        const ticks    = Math.max(1, Math.min(10, Math.round(duration)));
        const numTypes = new Set(['math_number', 'math_number_positive']);
        const allValues = doc.getElementsByTagName('value');

        for (let i = 0; i < allValues.length; i++) {
            if (allValues[i].getAttribute('name') !== 'DURATION') continue;
            const valueEl = allValues[i];

            // a) Patch NUM field in existing shadow/block children
            const tagNames = ['shadow', 'block'] as const;
            for (const tag of tagNames) {
                const hosts = valueEl.getElementsByTagName(tag);
                for (let j = 0; j < hosts.length; j++) {
                    const host = hosts[j];
                    if (!numTypes.has(host.getAttribute('type') ?? '')) continue;
                    const numFields = host.getElementsByTagName('field');
                    for (let k = 0; k < numFields.length; k++) {
                        if (numFields[k].getAttribute('name') === 'NUM') {
                            numFields[k].textContent = String(ticks);
                        }
                    }
                }
            }

            // b) Insert an explicit <block type="math_number"> as a direct child
            //    of <value name="DURATION">. In Blockly XML a <block> always
            //    takes precedence over a <shadow>, so this is the definitive
            //    override that ensures the correct tick count is used no matter
            //    what the shadow says or how the runtime reads it.
            //    Remove any pre-existing explicit blocks first to avoid doubles.
            const existingBlocks = valueEl.getElementsByTagName('block');
            for (let j = existingBlocks.length - 1; j >= 0; j--) {
                existingBlocks[j].parentNode?.removeChild(existingBlocks[j]);
            }
            const overrideBlock = doc.createElement('block');
            overrideBlock.setAttribute('type', 'math_number');
            const overrideField = doc.createElement('field');
            overrideField.setAttribute('name', 'NUM');
            overrideField.textContent = String(ticks);
            overrideBlock.appendChild(overrideField);
            valueEl.appendChild(overrideBlock);

        }

        // Also patch any variables_set block whose VAR is named "duration"
        //    (case-insensitive). Some bot XMLs initialise a duration variable
        //    separately from the DURATION value slot.
        const allBlocks2 = doc.getElementsByTagName('block');
        for (let i = 0; i < allBlocks2.length; i++) {
            if (allBlocks2[i].getAttribute('type') !== 'variables_set') continue;
            const vfields = allBlocks2[i].getElementsByTagName('field');
            let isDur = false;
            for (let f = 0; f < vfields.length; f++) {
                if (vfields[f].getAttribute('name') !== 'VAR') continue;
                if ((vfields[f].textContent ?? '').trim().toLowerCase() === 'duration') {
                    isDur = true; break;
                }
            }
            if (!isDur) continue;
            const inner = allBlocks2[i].getElementsByTagName('block');
            for (let b = 0; b < inner.length; b++) {
                if (!numTypes.has(inner[b].getAttribute('type') ?? '')) continue;
                const nf = inner[b].getElementsByTagName('field');
                for (let k = 0; k < nf.length; k++) {
                    if (nf[k].getAttribute('name') === 'NUM') {
                        nf[k].textContent = String(ticks);
                    }
                }
                break;
            }
        }
    }

    // 2. Patch initialisation blocks by variables_set block ID
    const allBlocks = doc.getElementsByTagName('block');
    for (let i = 0; i < allBlocks.length; i++) {
        const block = allBlocks[i];
        const bid   = block.getAttribute('id') ?? '';
        const patch = patches.find(p => p.blockId === bid);
        if (!patch) continue;

        const children = block.childNodes;
        for (let j = 0; j < children.length; j++) {
            const node = children[j] as Element;
            if (node.nodeType !== 1) continue;
            if (node.getAttribute('name') !== 'VALUE') continue;

            const innerBlocks = node.getElementsByTagName('block');
            for (let k = 0; k < innerBlocks.length; k++) {
                const btype = innerBlocks[k].getAttribute('type');

                if (btype === 'math_number' && patch.numValue !== undefined) {
                    const numFields = innerBlocks[k].getElementsByTagName('field');
                    for (let m = 0; m < numFields.length; m++) {
                        if (numFields[m].getAttribute('name') === 'NUM') {
                            numFields[m].textContent = String(patch.numValue);
                        }
                    }
                    break;
                }

                if (btype === 'text' && patch.textValue !== undefined) {
                    const txtFields = innerBlocks[k].getElementsByTagName('field');
                    for (let m = 0; m < txtFields.length; m++) {
                        if (txtFields[m].getAttribute('name') === 'TEXT') {
                            txtFields[m].textContent = patch.textValue;
                        }
                    }
                    break;
                }
            }
            break;
        }
    }

    // 2b. Patch shadow elements by ID.
    // Some bots (e.g. even-odd-scanner) encode adjustable values like martingale
    // multiplier in <shadow> elements rather than <block> elements. The step-2
    // block walker skips shadows, so we do a dedicated shadow pass here.
    const allShadows = doc.getElementsByTagName('shadow');
    for (let i = 0; i < allShadows.length; i++) {
        const shadow = allShadows[i];
        const sid    = shadow.getAttribute('id') ?? '';
        const patch  = patches.find(p => p.blockId === sid);
        if (!patch) continue;
        const sFields = shadow.getElementsByTagName('field');
        for (let j = 0; j < sFields.length; j++) {
            if (patch.numValue  !== undefined && sFields[j].getAttribute('name') === 'NUM')
                sFields[j].textContent = String(patch.numValue);
            if (patch.textValue !== undefined && sFields[j].getAttribute('name') === 'TEXT')
                sFields[j].textContent = patch.textValue;
        }
    }

    // 3. Replace hardcoded market names in notify shadow TEXT fields.
    //
    // Some bots (e.g. even-odd-scanner) have notify messages like
    // "Contract bought: Volatility 100 Index — EVEN" baked into <shadow> elements.
    // <shadow> elements can't be targeted by block-id patches, so we scan every
    // TEXT field inside a <shadow> and replace any known default with the real label.
    if (symbolLabel) {
        const knownDefaults = ['Volatility 100 Index', 'Volatility 25 Index', 'Volatility 10 Index',
                               'Volatility 50 Index', 'Volatility 75 Index', 'Volatility 10 (1s) Index',
                               'Volatility 25 (1s) Index', 'Volatility 50 (1s) Index',
                               'Volatility 100 (1s) Index', 'Volatility 75 (1s) Index'];
        const shadowEls = doc.getElementsByTagName('shadow');
        for (let i = 0; i < shadowEls.length; i++) {
            if (shadowEls[i].getAttribute('type') !== 'text') continue;
            const fields = shadowEls[i].getElementsByTagName('field');
            for (let f = 0; f < fields.length; f++) {
                if (fields[f].getAttribute('name') !== 'TEXT') continue;
                const cur = fields[f].textContent ?? '';
                for (const def of knownDefaults) {
                    if (cur.includes(def)) {
                        fields[f].textContent = cur.replace(def, symbolLabel);
                        break;
                    }
                }
            }
        }
    }

    return doc;
}

// ─── Per-bot patch maps ───────────────────────────────────────────────────────
// Block IDs sourced directly from each bot's INITIALIZATION chain.

export function getBotPatches(
    botId:      string,
    signal:     BotSignal,
    stake:      number,
    takeProfit: number,
    stopLoss:   number,
    martingale: number,
): BlockPatch[] {
    const digit = parseDigitFrom(signal.direction);   // prediction / entry for matches & differs
    const entry = parseDigitFrom(signal.entryPoint);  // entry point digit (Even Odd uses entryPoint)
    const martingaleLevel = Math.max(3, Math.min(10, Math.round(stopLoss / stake)));

    switch (botId) {
        case 'matches-signal':
            return [
                { blockId: '!BDtc{tIb5~vb#O@Ogky', numValue: digit },           // Prediction
                { blockId: 'Dww98I}prRuVxr_mn~}k',  numValue: stake },           // Stake
                { blockId: 'P@g)b:jeg|/F)mD8%X,w',  numValue: stake },           // InitialStake
                { blockId: 't0b1vxY9xaXc@*IwT7C{',  numValue: takeProfit },      // TakeProfit
                { blockId: 'tuMdgDH=EiDY~j.b%n;]',  numValue: martingaleLevel }, // MartingaleLevel
                { blockId: 'zHWiC2`O-~qH2R`7]FaG',  numValue: martingale },      // Martingale
                { blockId: 'ep_matches_init',         numValue: digit },           // entry point
            ];

        case 'differ-v2':
            return [
                { blockId: '%,Z?it?u3w,4)WTx2Hq:',  numValue: stake },      // stake
                { blockId: '/a.5Q3QDR2c)VR/XZvD-',  numValue: digit },      // entry point
                { blockId: 'ij(6Iu2cn[H}M;H3Y%9[',  numValue: digit },      // prediction
                { blockId: 's;EQ~zMi)cPYPc-kzha`',  numValue: martingale }, // martingale
                { blockId: ';N@3iS.2#]xK[5,E{gCO',  numValue: takeProfit }, // take profit
                { blockId: 'h~GA!H78SVi}._e5N:ur',   numValue: stopLoss },  // stop loss
            ];

        case 'even-odd-scanner': {
            // The bot uses: Stake += ABS(Stake) * B at each loss level.
            // So multiplier M corresponds to B = M - 1.
            // Block IDs eo_s2_b … eo_s10_b are <shadow> elements (patched via step 2b).
            const eoB = Math.max(0, martingale - 1);
            return [
                { blockId: 'eo_dir_init',            textValue: signal.direction.trim().toUpperCase() }, // Direction: EVEN or ODD
                { blockId: 'Wa]y_n3s-T4*h(bmYz+k',  numValue: stake },      // Stake
                { blockId: 'Z:R@MLC*=N3%meT)IuPt',   numValue: stopLoss },  // Max Loss
                { blockId: ':Vn+w]Y.(QKzgKKENIfo',   numValue: takeProfit }, // Target Profit
                { blockId: 'eo_ep_init_fixed',         numValue: entry },     // Entry point
                // Martingale multiplier — patched into shadow B values at each loss level
                { blockId: 'eo_s2_b',  numValue: eoB },
                { blockId: 'eo_s3_b',  numValue: eoB },
                { blockId: 'eo_s4_b',  numValue: eoB },
                { blockId: 'eo_s5_b',  numValue: eoB },
                { blockId: 'eo_s6_b',  numValue: eoB },
                { blockId: 'eo_s7_b',  numValue: eoB },
                { blockId: 'eo_s8_b',  numValue: eoB },
                { blockId: 'eo_s9_b',  numValue: eoB },
                { blockId: 'eo_s10_b', numValue: eoB },
            ];
        }

        case 'over-under-signal': {
            const dirText  = signal.direction.split(' ')[0].toUpperCase();
            const barrier  = parseDigitFrom(signal.direction);
            const entryPt  = parseDigitFrom(signal.entryPoint);
            return [
                { blockId: 'ou_dir_init',         textValue: dirText },
                { blockId: 'ou_barrier_init',      numValue: barrier },
                { blockId: 'ou_stake_init',        numValue: stake },
                { blockId: 'ou_initial_stake_init',numValue: stake },
                { blockId: 'ou_tp_init',           numValue: takeProfit },
                { blockId: 'ou_mart_level_init',   numValue: martingaleLevel },
                { blockId: 'ou_mart_init',         numValue: martingale },
                { blockId: 'ou_ep_init',           numValue: entryPt },
            ];
        }

        case 'over-under-ai-signals': {
            // Over Under AI Signals Bot — cross-direction recovery
            // Prediction 1 = primary barrier, Prediction 2 = recovery barrier (opposite direction)
            const primaryBarrier  = parseDigitFrom(signal.direction);
            const recoveryBarrier = signal.recoveryBarrier ?? primaryBarrier;
            const entryPt         = parseDigitFrom(signal.entryPoint);
            return [
                { blockId: 'ouai_pred1_init', numValue: primaryBarrier  }, // Prediction 1
                { blockId: 'ouai_pred2_init', numValue: recoveryBarrier }, // Prediction 2
                { blockId: 'ouai_ep_init',    numValue: entryPt          }, // Entry Point
                { blockId: 'ouai_stake_init', numValue: stake            }, // Stake
                { blockId: 'ouai_tp_init',    numValue: takeProfit       }, // Take Profit
                { blockId: 'ouai_sl_init',    numValue: stopLoss         }, // Stop Loss
                { blockId: 'ouai_mart_init',  numValue: martingale       }, // Martingale
            ];
        }

        case 'elite-entry-scanner': {
            // Elite Entry Scanner Bot:
            //   - "Prediction before loss" = primary AI barrier (e.g. 1 for OVER 1)
            //   - "Prediction after loss"  = recovery barrier picked by AI from 2nd-best analysis
            //   - Contract type (DIGITOVER/DIGITUNDER) is patched separately via contractType param
            const primaryBarrier  = parseDigitFrom(signal.direction);
            const recoveryBarrier = signal.recoveryBarrier ?? primaryBarrier;
            const entryPt         = parseDigitFrom(signal.entryPoint);
            return [
                { blockId: '4$5m(H*{`c4#S-)o=;aV', numValue: primaryBarrier  }, // Prediction before loss
                { blockId: 'f;c!1^-bb9K7rQ{#3/l0', numValue: recoveryBarrier }, // Prediction after loss
                { blockId: '_aSBe^/).nS{bwLbiE9n',  numValue: entryPt         }, // Entrypoint-Digit
                { blockId: 'y-?,og][*D.g)z`wz~sr',  numValue: stake           }, // Stake
                { blockId: '9.jN~btog59cUwf8:lPl',  numValue: takeProfit      }, // Expected Profit
                { blockId: 'MpN0,W8A;joH2n#IXF@!',  numValue: stopLoss        }, // Stop Loss
                { blockId: ':y8AYtv{x`8LFslg8@Pc',  numValue: martingale      }, // Martingale Split
            ];
        }

        case 'over-destroyer': {
            // Over Destroyer Bot — PREDICTION 1 = "OVER" (primary barrier),
            // "UNDER PREDICTION" = recovery barrier used after the first loss.
            const primaryBarrier  = parseDigitFrom(signal.direction);
            const recoveryBarrier = signal.recoveryBarrier ?? primaryBarrier;
            const entryPt         = parseDigitFrom(signal.entryPoint);
            return [
                { blockId: 'Gg%p@Y?OHMC(yjmQxovG', numValue: primaryBarrier  }, // OVER (primary)
                { blockId: 'b+#U5h8+OZ)rLx{!tpHW', numValue: recoveryBarrier }, // UNDER PREDICTION (recovery)
                { blockId: 'dest_ep_init',          numValue: entryPt         }, // Entry Point
                { blockId: ']~SrY@L1iu:F3H)e`G@.',  numValue: stake           }, // Stake
                { blockId: 'p84`5MQ~#2$;K~tmMi/Z',  numValue: stake           }, // Initial Stake
                { blockId: 'm|-pU=u@u#bdSa{:i4`M',  numValue: takeProfit      }, // Take Profit
                { blockId: 'HhFFo1CV-bJ!l|0*]9xP',  numValue: stopLoss        }, // Stop Loss
                { blockId: 'mFGMZRBBZt[SYAEOxi|F',  numValue: martingale      }, // Matingale
                { blockId: 'dest_symlabel_init',    textValue: signal.symbolLabel }, // Journal: symbol label
            ];
        }

        case 'under-destroyer': {
            // Under Destroyer Bot — "UNDER PREDICTION" = primary barrier,
            // "OVER PREDICTION 2" = recovery barrier used after the first loss.
            const primaryBarrier  = parseDigitFrom(signal.direction);
            const recoveryBarrier = signal.recoveryBarrier ?? primaryBarrier;
            const entryPt         = parseDigitFrom(signal.entryPoint);
            return [
                { blockId: 'Gg%p@Y?OHMC(yjmQxovG', numValue: primaryBarrier  }, // UNDER PREDICTION (primary)
                { blockId: 'b+#U5h8+OZ)rLx{!tpHW', numValue: recoveryBarrier }, // OVER PREDICTION 2 (recovery)
                { blockId: 'dest_ep_init',          numValue: entryPt         }, // Entry Point
                { blockId: ']~SrY@L1iu:F3H)e`G@.',  numValue: stake           }, // Stake
                { blockId: 'p84`5MQ~#2$;K~tmMi/Z',  numValue: stake           }, // Initial Stake
                { blockId: 'm|-pU=u@u#bdSa{:i4`M',  numValue: takeProfit      }, // Take Profit
                { blockId: 'HhFFo1CV-bJ!l|0*]9xP',  numValue: stopLoss        }, // Stop Loss
                { blockId: 'mFGMZRBBZt[SYAEOxi|F',  numValue: martingale      }, // Matingale
                { blockId: 'dest_symlabel_init',    textValue: signal.symbolLabel }, // Journal: symbol label
            ];
        }

        default:
            return [];
    }
}

// ─── Raw XML cache ────────────────────────────────────────────────────────────
// Bot XML files are static assets (~50–200 KB each) served from /bots/. The
// HTTP round-trip + DOMParser pass costs 200–500 ms cold. Caching the raw text
// in memory makes every subsequent fetchAndPatchBot call effectively
// instantaneous — patching itself is sub-millisecond.

const rawXmlCache:    Map<string, string>          = new Map();
const inflightFetches: Map<string, Promise<string>> = new Map();

async function loadRawXml(botId: string): Promise<string> {
    const cached = rawXmlCache.get(botId);
    if (cached) return cached;

    const inflight = inflightFetches.get(botId);
    if (inflight) return inflight;

    const xmlPath = BOT_XML_PATHS[botId];
    if (!xmlPath) throw new Error(`Unknown bot id: ${botId}`);

    const p = (async () => {
        const res = await fetch(xmlPath);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching bot XML (${xmlPath})`);
        const text = await res.text();
        rawXmlCache.set(botId, text);
        return text;
    })();

    inflightFetches.set(botId, p);
    try { return await p; }
    finally { inflightFetches.delete(botId); }
}

// Public — call this when the user opens the Save & Run modal (or earlier)
// so the XML is warm in memory by the time they click Run.
export function prefetchBotXml(botId: string): void {
    if (!BOT_XML_PATHS[botId]) return;
    if (rawXmlCache.has(botId) || inflightFetches.has(botId)) return;
    void loadRawXml(botId).catch(() => { /* silent — Run-time will surface errors */ });
}

// ─── Fetch, patch, and load into Blockly workspace ────────────────────────────
// Returns the patched Document so the caller can load it however it needs.

export async function fetchAndPatchBot(
    botId:      string,
    signal:     BotSignal,
    stake:      number,
    takeProfit: number,
    stopLoss:   number,
    martingale: number,
    duration:   number = 1,
): Promise<Document> {
    const rawXml  = await loadRawXml(botId);
    const patches = getBotPatches(botId, signal, stake, takeProfit, stopLoss, martingale);

    // Safety-net: for over_under signals that were saved without recoveryContractType
    // (e.g. from signal-engine before the fix), auto-derive the opposite direction.
    const effectiveCt    = signal.contractType;
    const effectiveRecCt = signal.recoveryContractType
        ?? (effectiveCt === 'DIGITUNDER' ? 'DIGITOVER'
          : effectiveCt === 'DIGITOVER'  ? 'DIGITUNDER'
          : undefined);

    const doc = patchBotXml(rawXml, signal.symbol, patches, duration, effectiveCt, effectiveRecCt, signal.symbolLabel);

    if (doc.querySelector('parsererror')) throw new Error('Bot XML parse error — check the bot file.');
    return doc;
}

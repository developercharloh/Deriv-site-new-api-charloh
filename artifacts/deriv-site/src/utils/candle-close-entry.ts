export const ONE_MINUTE_CANDLE_SECONDS = 60;
export const CANDLE_CLOSE_ENTRY_SECONDS = 2;
export const CANDLE_CLOSE_ENTRY_BLOCK = 'candle_close_entry_window';

export function isCandleCloseEntryWindow(
    epoch: unknown,
    intervalSeconds = ONE_MINUTE_CANDLE_SECONDS,
    secondsBeforeClose = CANDLE_CLOSE_ENTRY_SECONDS,
): boolean {
    const timestamp = Number(epoch);
    const interval = Math.floor(Number(intervalSeconds));
    const offset = Math.floor(Number(secondsBeforeClose));

    if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(interval) ||
        !Number.isFinite(offset) ||
        interval < 2 ||
        offset < 1 ||
        offset >= interval
    ) {
        return false;
    }

    const epochSecond = Math.floor(timestamp);
    const secondInCandle = ((epochSecond % interval) + interval) % interval;
    return secondInCandle === interval - offset;
}

function createXmlElement(doc: Document, tagName: string): Element {
    const namespace = doc.documentElement.namespaceURI;
    return namespace ? doc.createElementNS(namespace, tagName) : doc.createElement(tagName);
}

function directChild(parent: Element, tagName: string, name?: string): Element | null {
    return Array.from(parent.children).find(child =>
        child.localName === tagName && (name === undefined || child.getAttribute('name') === name),
    ) ?? null;
}

function clearChildren(element: Element): void {
    while (element.firstChild) element.removeChild(element.firstChild);
}

function createCandleCloseBlock(doc: Document): Element {
    const block = createXmlElement(doc, 'block');
    block.setAttribute('type', CANDLE_CLOSE_ENTRY_BLOCK);
    block.setAttribute('id', `ai_candle_close_${Date.now()}`);

    const intervalField = createXmlElement(doc, 'field');
    intervalField.setAttribute('name', 'INTERVAL_SECONDS');
    intervalField.textContent = String(ONE_MINUTE_CANDLE_SECONDS);

    const offsetField = createXmlElement(doc, 'field');
    offsetField.setAttribute('name', 'SECONDS_BEFORE_CLOSE');
    offsetField.textContent = String(CANDLE_CLOSE_ENTRY_SECONDS);

    block.append(intervalField, offsetField);
    return block;
}

function replaceEntryDigitLogValues(doc: Document): void {
    const replacements: Record<string, string> = {
        dest_var_ep: '00:02 before 1-minute candle close',
        dest_var_tick1: 'candle-close trigger',
    };
    let replacementIndex = 0;

    Array.from(doc.querySelectorAll('block[type="variables_get"]')).forEach(block => {
        const variableField = directChild(block, 'field', 'VAR');
        const replacementText = variableField?.getAttribute('id')
            ? replacements[variableField.getAttribute('id')!]
            : undefined;
        if (!replacementText || !block.parentNode) return;

        const replacement = createXmlElement(doc, 'block');
        replacement.setAttribute('type', 'text');
        replacement.setAttribute('id', `ai_candle_log_${replacementIndex++}`);
        const textField = createXmlElement(doc, 'field');
        textField.setAttribute('name', 'TEXT');
        textField.textContent = replacementText;
        replacement.appendChild(textField);
        block.parentNode.replaceChild(replacement, block);
    });

    Array.from(doc.querySelectorAll('field[name="TEXT"]')).forEach(field => {
        const value = field.textContent?.toLowerCase() ?? '';
        if (value.includes('last digit')) field.textContent = ' | Candle entry: ';
    });
}

function setOneMinuteCandleInterval(doc: Document): void {
    const intervalField = doc.querySelector(
        'block[type="trade_definition_candleinterval"] field[name="CANDLEINTERVAL_LIST"]',
    );
    if (!intervalField) {
        throw new Error('This Over/Under bot template is missing its candle interval setting.');
    }
    intervalField.textContent = String(ONE_MINUTE_CANDLE_SECONDS);
}

function setBeforePurchaseWindow(doc: Document): Element {
    const beforePurchase = doc.querySelector('block[type="before_purchase"]');
    const stack = beforePurchase ? directChild(beforePurchase, 'statement', 'BEFOREPURCHASE_STACK') : null;
    const gate = stack ? directChild(stack, 'block') : null;
    if (!gate) {
        throw new Error('This Over/Under bot template is missing its before-purchase gate.');
    }

    const condition = directChild(gate, 'value', 'IF0');
    if (!condition) {
        throw new Error('This Over/Under bot template has no entry condition to update.');
    }
    clearChildren(condition);
    condition.appendChild(createCandleCloseBlock(doc));
    return gate;
}

/** Applies the fixed broker-tick entry rule to a Destroyer template. */
export function applyCandleCloseEntryGate(doc: Document): Document {
    setOneMinuteCandleInterval(doc);
    setBeforePurchaseWindow(doc);
    replaceEntryDigitLogValues(doc);
    return doc;
}

#!/usr/bin/env node

import { createServer } from 'node:net';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const appUrl = process.env.BINARY_MATRIX_BASE_URL || `http://127.0.0.1:${process.env.PORT || 22438}`;
const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const xmlPath = join(projectDir, 'public', 'bots', 'Binary_Matrix_AI.xml');
const chromiumPath = process.env.CHROMIUM_PATH || 'chromium';
const rootLabels = {
    trade_definition: 'Trade Parameters',
    before_purchase: 'Purchase Conditions',
    after_purchase: 'Restart Trading Conditions',
};

const browserApiMock = String.raw`
(() => {
    const accountId = 'VRTC-BINARY-MATRIX';
    localStorage.setItem('active_loginid', accountId);
    localStorage.setItem('account_type', 'demo');
    sessionStorage.setItem('deriv_accounts', JSON.stringify([{
        account_id: accountId,
        account_type: 'demo',
        balance: 1000,
        currency: 'USD',
        status: 'active'
    }]));

    class BrowserApiWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor(url) {
            this.url = url;
            this.readyState = BrowserApiWebSocket.CONNECTING;
            this.listeners = {};
            setTimeout(() => {
                this.readyState = BrowserApiWebSocket.OPEN;
                this.dispatch('open', {});
            }, 0);
        }

        addEventListener(type, listener) {
            (this.listeners[type] ||= []).push(listener);
        }

        removeEventListener(type, listener) {
            this.listeners[type] = (this.listeners[type] || []).filter(item => item !== listener);
        }

        dispatch(type, event) {
            (this.listeners[type] || []).forEach(listener => listener(event));
            if (typeof this['on' + type] === 'function') this['on' + type](event);
        }

        send(payload) {
            const request = JSON.parse(payload);
            const response = { req_id: request.req_id, msg_type: Object.keys(request).find(key => key !== 'req_id') || 'ping' };
            if (request.balance) {
                response.balance = { balance: 1000, currency: 'USD', loginid: accountId };
            } else if (request.active_symbols) {
                response.active_symbols = [
                    { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index', submarket: 'random_index' }
                ];
            } else if (request.time) {
                response.time = Math.floor(Date.now() / 1000);
            } else if (request.ticks) {
                response.tick = { symbol: request.ticks, quote: 1000, epoch: Math.floor(Date.now() / 1000) };
                response.subscription = { id: 'binary-matrix-test-ticks' };
            } else if (request.proposal) {
                response.proposal = { id: 'binary-matrix-test-proposal', ask_price: 1, payout: 1.96 };
            } else if (request.buy) {
                response.buy = { contract_id: 1, buy_price: 1, payout: 1.96 };
            } else if (request.portfolio) {
                response.portfolio = { contracts: [] };
            }
            setTimeout(() => this.dispatch('message', { data: JSON.stringify(response) }), 0);
        }

        close() {
            this.readyState = BrowserApiWebSocket.CLOSED;
            this.dispatch('close', {});
        }
    }

    window.WebSocket = BrowserApiWebSocket;
})();
`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const getFreePort = async () =>
    new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });

class DevToolsWebSocket {
    constructor(url) {
        const { hostname, port, pathname } = new URL(url);
        this.listeners = new Map();
        this.buffer = Buffer.alloc(0);
        this.socket = createConnection({ host: hostname, port: Number(port) });
        this.socket.on('data', chunk => this.handleData(chunk));
        this.socket.on('error', error => this.emit('error', error));
        this.socket.on('close', () => this.emit('close'));
        this.socket.once('connect', () => {
            const key = randomBytes(16).toString('base64');
            this.socket.write(
                `GET ${pathname} HTTP/1.1\r\nHost: ${hostname}:${port}\r\n` +
                    `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n` +
                    'Sec-WebSocket-Version: 13\r\n\r\n'
            );
        });
        this.handshakeComplete = false;
    }

    addEventListener(type, listener, options = {}) {
        const listeners = this.listeners.get(type) || [];
        listeners.push({ listener, once: options.once });
        this.listeners.set(type, listeners);
    }

    emit(type, value) {
        const listeners = this.listeners.get(type) || [];
        for (const entry of [...listeners]) {
            entry.listener(value);
            if (entry.once) {
                const current = this.listeners.get(type) || [];
                this.listeners.set(
                    type,
                    current.filter(candidate => candidate !== entry)
                );
            }
        }
    }

    handleData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (!this.handshakeComplete) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;
            const headers = this.buffer.subarray(0, headerEnd).toString();
            if (!headers.startsWith('HTTP/1.1 101')) {
                this.emit('error', new Error(`DevTools WebSocket handshake failed: ${headers.split('\r\n')[0]}`));
                return;
            }
            this.handshakeComplete = true;
            this.buffer = this.buffer.subarray(headerEnd + 4);
            this.emit('open');
        }

        while (this.buffer.length >= 2) {
            const firstByte = this.buffer[0];
            const secondByte = this.buffer[1];
            const opcode = firstByte & 0x0f;
            const isMasked = (secondByte & 0x80) !== 0;
            let payloadLength = secondByte & 0x7f;
            let headerLength = 2;

            if (payloadLength === 126) {
                if (this.buffer.length < 4) return;
                payloadLength = this.buffer.readUInt16BE(2);
                headerLength = 4;
            } else if (payloadLength === 127) {
                if (this.buffer.length < 10) return;
                const longLength = Number(this.buffer.readBigUInt64BE(2));
                if (!Number.isSafeInteger(longLength)) throw new Error('DevTools frame is too large.');
                payloadLength = longLength;
                headerLength = 10;
            }

            const maskLength = isMasked ? 4 : 0;
            if (this.buffer.length < headerLength + maskLength + payloadLength) return;
            const maskStart = headerLength;
            const payloadStart = headerLength + maskLength;
            const payload = Buffer.from(this.buffer.subarray(payloadStart, payloadStart + payloadLength));
            if (isMasked) {
                const mask = this.buffer.subarray(maskStart, payloadStart);
                for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
            }
            this.buffer = this.buffer.subarray(payloadStart + payloadLength);

            if (opcode === 0x1) this.emit('message', { data: payload.toString() });
            else if (opcode === 0x8) this.close();
            else if (opcode === 0x9) this.writeFrame(payload, 0xA);
        }
    }

    writeFrame(payload, opcode = 0x1) {
        const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        const mask = randomBytes(4);
        let header;
        if (body.length < 126) {
            header = Buffer.from([0x80 | opcode, 0x80 | body.length]);
        } else if (body.length < 65_536) {
            header = Buffer.alloc(4);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(body.length, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(body.length), 2);
        }
        const maskedBody = Buffer.from(body);
        for (let index = 0; index < maskedBody.length; index++) maskedBody[index] ^= mask[index % 4];
        this.socket.write(Buffer.concat([header, mask, maskedBody]));
    }

    send(data) {
        this.writeFrame(data);
    }

    close() {
        if (!this.socket.destroyed) this.socket.end();
    }
}

class CdpClient {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 0;
        this.pending = new Map();
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.method === 'Runtime.exceptionThrown') {
                console.error(`Browser exception: ${message.params.exceptionDetails?.exception?.description || 'unknown'}`);
            } else if (message.method === 'Log.entryAdded') {
                console.error(`Browser log: ${message.params.entry?.text || 'unknown'}`);
            }
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message));
            else pending.resolve(message.result);
        });
        socket.addEventListener('close', () => {
            for (const { reject } of this.pending.values()) reject(new Error('Chrome DevTools connection closed.'));
            this.pending.clear();
        });
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.nextId;
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }
}

const connectToPage = async debugPort => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    const targets = await response.json();
    let target = targets.find(item => item.type === 'page' && item.url === 'about:blank');
    if (!target) {
        const newTargetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
            method: 'PUT',
        });
        if (newTargetResponse.ok) target = await newTargetResponse.json();
    }
    if (!target?.webSocketDebuggerUrl) throw new Error('Could not find the Chromium page target.');

    const socket = new DevToolsWebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    return new CdpClient(socket);
};

const evaluate = async (cdp, expression) => {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed.');
    }
    return result.result?.value;
};

const waitFor = async (cdp, expression, label, timeout = 30_000) => {
    const result = await evaluate(
        cdp,
        `new Promise((resolve, reject) => {
            const started = Date.now();
            const poll = () => {
                let value = false;
                try { value = Boolean(${expression}); } catch {}
                if (value) return resolve(true);
                if (Date.now() - started > ${timeout}) return reject(new Error(${JSON.stringify(`Timed out waiting for ${label}`)}));
                setTimeout(poll, 100);
            };
            poll();
        })`
    );
    if (!result) throw new Error(`Timed out waiting for ${label}`);
};

const clickButtonContaining = async (cdp, text) => {
    try {
        await waitFor(
            cdp,
            `Array.from(document.querySelectorAll('button')).some(button => button.getClientRects().length > 0 && button.textContent.includes(${JSON.stringify(text)}))`,
            `visible button containing "${text}"`
        );
    } catch (error) {
        const pageState = await evaluate(
            cdp,
            `JSON.stringify({
                url: location.href,
                title: document.title,
                body: document.body?.innerText?.slice(0, 1200),
                buttons: Array.from(document.querySelectorAll('button')).map(button => button.textContent.trim()).slice(0, 40)
            })`
        );
        throw new Error(`${error.message}; page state: ${pageState}`);
    }
    const buttonRect = await evaluate(
        cdp,
        `(() => {
            const button = Array.from(document.querySelectorAll('button')).find(
                candidate => candidate.getClientRects().length > 0 && candidate.textContent.includes(${JSON.stringify(text)})
            );
            if (!button) return null;
            button.scrollIntoView({ block: 'center', inline: 'center' });
            const rect = button.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`
    );
    if (!buttonRect) throw new Error(`Could not locate visible button containing "${text}" after waiting.`);
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: buttonRect.x,
        y: buttonRect.y,
        button: 'left',
        clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: buttonRect.x,
        y: buttonRect.y,
        button: 'left',
        clickCount: 1,
    });
};

const workspaceSnapshot = async cdp => {
    return evaluate(
        cdp,
        `(() => {
            const workspace = window.Blockly?.derivWorkspace;
            if (!workspace) return null;
            const roots = workspace.getTopBlocks(true).map(block => {
                const xy = block.getRelativeToSurfaceXY?.() || { x: 0, y: 0 };
                return { type: block.type, x: xy.x, y: xy.y };
            });
            const metrics = workspace.getMetrics?.() || {};
            return {
                roots,
                scrollY: workspace.scrollbar?.getY?.() ?? null,
                viewTop: metrics.viewTop ?? null,
                contentTop: metrics.contentTop ?? null,
            };
        })()`
    );
};

const assertBinaryMatrixWorkspace = async (cdp, flowName) => {
    try {
        await waitFor(
            cdp,
            `(() => {
                const roots = window.Blockly?.derivWorkspace?.getTopBlocks?.(true) || [];
                return ['trade_definition', 'before_purchase', 'after_purchase'].every(type =>
                    roots.some(block => block.type === type)
                );
            })()`,
            `${flowName} root blocks`
        );
    } catch (error) {
        const snapshot = await workspaceSnapshot(cdp);
        const body = await evaluate(cdp, 'document.body?.innerText?.slice(-1200)');
        throw new Error(`${error.message}; ${flowName} snapshot=${JSON.stringify(snapshot)}; body=${JSON.stringify(body)}`);
    }
    await evaluate(
        cdp,
        `document.querySelector('#scratch_div')?.scrollIntoView({ block: 'start', inline: 'nearest' })`
    );
    await sleep(1_400);

    const snapshot = await workspaceSnapshot(cdp);
    if (!snapshot) throw new Error(`${flowName}: Blockly workspace is unavailable.`);

    const expectedTypes = Object.keys(rootLabels);
    const actualTypes = snapshot.roots.map(root => root.type);
    for (const type of expectedTypes) {
        if (!actualTypes.includes(type)) {
            throw new Error(`${flowName}: missing ${rootLabels[type]} (${type}); roots were ${actualTypes.join(', ')}`);
        }
    }

    const mobileScroll = snapshot.scrollY ?? snapshot.viewTop;
    const firstRoot = snapshot.roots.find(root => root.type === 'trade_definition');
    const topmostRootY = Math.min(...snapshot.roots.map(root => root.y));
    if (
        mobileScroll === null ||
        mobileScroll > 1 ||
        !firstRoot ||
        firstRoot.y !== topmostRootY
    ) {
        throw new Error(
            `${flowName}: mobile workspace did not start at the first root ` +
                `(scrollY=${mobileScroll}, viewTop=${snapshot.viewTop}, contentTop=${snapshot.contentTop}, ` +
                `firstRootY=${firstRoot?.y ?? 'missing'}, roots=${JSON.stringify(snapshot.roots)})`
        );
    }

    console.log(
        `✓ ${flowName}: ${expectedTypes.map(type => rootLabels[type]).join(', ')}; ` +
            `mobile scrollY=${mobileScroll}, firstRootY=${firstRoot.y}`
    );
};

const setFileInput = async (cdp, file) => {
    const documentResult = await cdp.send('DOM.getDocument', { depth: -1 });
    const queryResult = await cdp.send('DOM.querySelector', {
        nodeId: documentResult.root.nodeId,
        selector: 'input[data-testid="dt-load-strategy-file-input"]',
    });
    if (!queryResult.nodeId) throw new Error('Could not find the standard XML loader file input.');
    await cdp.send('DOM.setFileInputFiles', { nodeId: queryResult.nodeId, files: [file] });
};

const run = async () => {
    const xml = await readFile(xmlPath, 'utf8');
    if ((xml.match(/<block\b/g) || []).length < 3) throw new Error(`Binary Matrix XML is unexpectedly small: ${xmlPath}`);

    const debugPort = await getFreePort();
    const userDataDir = await mkdtemp(join(tmpdir(), 'binary-matrix-browser-'));
    const browser = spawn(
        chromiumPath,
        [
            '--headless=new',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--no-first-run',
            '--no-default-browser-check',
            `--remote-debugging-port=${debugPort}`,
            `--user-data-dir=${userDataDir}`,
            'about:blank',
        ],
        { stdio: 'ignore' }
    );

    let cdp;
    try {
        for (let attempt = 0; attempt < 50; attempt++) {
            try {
                cdp = await connectToPage(debugPort);
                break;
            } catch {
                await sleep(100);
            }
        }
        if (!cdp) throw new Error('Chromium did not expose a DevTools page target.');

        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 1,
            mobile: true,
        });
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: browserApiMock });
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Page.navigate', { url: `${appUrl}/#free_bots` });
        await waitFor(cdp, `document.readyState === 'complete'`, 'Deriv Site page');

        const hasAppGate = await evaluate(
            cdp,
            `Array.from(document.querySelectorAll('button')).some(
                button => button.getClientRects().length > 0 && button.textContent.includes('Continue to App')
            )`
        );
        if (hasAppGate) await clickButtonContaining(cdp, 'Continue to App');

        await clickButtonContaining(cdp, 'Load in DBot Builder');
        await assertBinaryMatrixWorkspace(cdp, 'Free Bots loader');

        await evaluate(cdp, `document.querySelector('#db-toolbar__import-button')?.click()`);
        await waitFor(cdp, `document.querySelector('input[data-testid="dt-load-strategy-file-input"]')`, 'standard XML loader');
        await setFileInput(cdp, xmlPath);
        await waitFor(cdp, `document.querySelector('#load-strategy__blockly-container')`, 'XML preview');
        await clickButtonContaining(cdp, 'Open');
        await assertBinaryMatrixWorkspace(cdp, 'standard XML loader');
    } finally {
        cdp?.socket.close();
        browser.kill('SIGTERM');
    }
};

run().catch(error => {
    console.error(`Binary Matrix browser regression failed: ${error.message}`);
    process.exitCode = 1;
});
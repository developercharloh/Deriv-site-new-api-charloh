import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';

const TARGET_URL = process.env.ALPHA_SCAN_URL || 'https://www.mrcharlohfx.site/#alpha_scan_ai';
const SAMPLE_WINDOWS = [600, 1200];
const MODEL_VERSION = 'feature-logistic-causal-denoise-v1';
const findOpenPort = async () => {
    const server = await new Promise((resolve, reject) => {
        const candidate = createServer();
        candidate.once('error', reject);
        candidate.listen(0, '127.0.0.1', () => resolve(candidate));
    });
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
};

const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

const waitForJson = async (url, timeout = 15000) => {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < timeout) {
        try {
            const response = await fetch(url);
            if (response.ok) return response.json();
        } catch (error) {
            lastError = error;
        }
        await sleep(250);
    }
    throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}`);
};

const createCdpClient = async port => {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target.');

    const websocketUrl = new URL(page.webSocketDebuggerUrl);
    const socket = createConnection({
        host: websocketUrl.hostname,
        port: Number(websocketUrl.port),
    });
    let receiveBuffer = Buffer.alloc(0);
    let handshakeComplete = false;
    let resolveHandshake;
    let rejectHandshake;
    const handshake = new Promise((resolve, reject) => {
        resolveHandshake = resolve;
        rejectHandshake = reject;
    });
    let nextId = 0;
    const pending = new Map();
    const sendFrame = (opcode, payload = Buffer.alloc(0)) => {
        const mask = randomBytes(4);
        const maskedPayload = Buffer.from(payload.map((value, index) => value ^ mask[index % 4]));
        let header;
        if (maskedPayload.length < 126) {
            header = Buffer.from([0x80 | opcode, 0x80 | maskedPayload.length]);
        } else if (maskedPayload.length < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(maskedPayload.length, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(maskedPayload.length), 2);
        }
        socket.write(Buffer.concat([header, mask, maskedPayload]));
    };

    const processFrames = () => {
        while (receiveBuffer.length >= 2) {
            const first = receiveBuffer[0];
            const second = receiveBuffer[1];
            const opcode = first & 0x0f;
            const masked = Boolean(second & 0x80);
            let payloadLength = second & 0x7f;
            let headerLength = 2;

            if (payloadLength === 126) {
                if (receiveBuffer.length < 4) return;
                payloadLength = receiveBuffer.readUInt16BE(2);
                headerLength = 4;
            } else if (payloadLength === 127) {
                if (receiveBuffer.length < 10) return;
                payloadLength = Number(receiveBuffer.readBigUInt64BE(2));
                headerLength = 10;
            }

            const maskLength = masked ? 4 : 0;
            const frameLength = headerLength + maskLength + payloadLength;
            if (receiveBuffer.length < frameLength) return;

            const maskStart = headerLength;
            const payloadStart = headerLength + maskLength;
            const frameMask = masked ? receiveBuffer.subarray(maskStart, payloadStart) : null;
            const payload = Buffer.from(receiveBuffer.subarray(payloadStart, frameLength));
            receiveBuffer = receiveBuffer.subarray(frameLength);

            if (frameMask) {
                payload.forEach((value, index) => {
                    payload[index] = value ^ frameMask[index % 4];
                });
            }
            if (opcode === 0x9) {
                sendFrame(0xA, payload);
            } else if (opcode === 0x1) {
                const message = JSON.parse(payload.toString('utf8'));
                if (message.id && pending.has(message.id)) {
                    const { resolve, reject } = pending.get(message.id);
                    pending.delete(message.id);
                    if (message.error) reject(new Error(message.error.message));
                    else resolve(message);
                }
            }
        }
    };

    socket.on('data', chunk => {
        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
        if (!handshakeComplete) {
            const headerEnd = receiveBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;
            const handshakeResponse = receiveBuffer.subarray(0, headerEnd).toString();
            if (!handshakeResponse.includes('101')) {
                rejectHandshake(new Error(`Chrome DevTools WebSocket handshake failed: ${handshakeResponse}`));
                return;
            }
            handshakeComplete = true;
            receiveBuffer = receiveBuffer.subarray(headerEnd + 4);
            resolveHandshake();
        }
        if (handshakeComplete) processFrames();
    });
    socket.once('error', error => {
        if (!handshakeComplete) rejectHandshake(error);
        for (const { reject } of pending.values()) reject(error);
        pending.clear();
    });
    socket.once('connect', () => {
        const key = randomBytes(16).toString('base64');
        socket.write([
            `GET ${websocketUrl.pathname}${websocketUrl.search} HTTP/1.1`,
            `Host: ${websocketUrl.host}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${key}`,
            'Sec-WebSocket-Version: 13',
            '',
            '',
        ].join('\r\n'));
    });
    await handshake;

    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        sendFrame(0x1, Buffer.from(JSON.stringify({ id, method, params })));
    });

    const evaluate = async expression => {
        const result = await call('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        const remote = result.result?.result;
        if (remote?.subtype === 'error' || remote?.description?.startsWith('Error:')) {
            throw new Error(remote.description);
        }
        return remote?.value;
    };

    return {
        call,
        evaluate,
        close: () => socket.end(),
    };
};

const waitFor = async (condition, description, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        const value = await condition();
        if (value) return value;
        await sleep(500);
    }
    throw new Error(`Timed out waiting for ${description}.`);
};

const getSnapshot = evaluate => evaluate(`(() => {
    const root = document.querySelector('[data-testid="alpha-tool"]');
    const modelPick = document.querySelector('[data-testid="tool-model-pick"]')?.getAttribute('data-symbol') || '';
    return {
        status: root?.dataset.status || '',
        coverage: (root?.dataset.modelRowCount || 0) + ' / ' + (root?.dataset.discoveredCount || 0),
        sample: root?.dataset.sampleSize || '',
        model: document.querySelector('[data-testid="tool-model-status"]')?.innerText || '',
        modelVersion: root?.dataset.modelVersion || '',
        modelPick,
        digitWindow: root?.dataset.digitWindow || '',
        recoveryDigitWindow: root?.dataset.recoveryDigitWindow || '',
        primaryCondition: root?.dataset.primaryCondition || '',
        primaryMarket: root?.dataset.primaryMarket || '',
        recoveryCondition: root?.dataset.recoveryCondition || '',
        recoveryMarket: root?.dataset.recoveryMarket || '',
        marketControls: Boolean(document.querySelector('[data-testid="select-primary-market"]')) &&
            Boolean(document.querySelector('[data-testid="select-recovery-market"]')) &&
            Boolean(document.querySelector('[data-testid="toggle-multi-market"]')),
        purchaseControls: Boolean(document.querySelector('[data-testid="button-live-execute"]')) &&
            Boolean(document.querySelector('[data-testid="button-recovery-execute"]')),
        purchaseSelections: Boolean(document.querySelector('[data-testid="select-primary-purchase"]')) &&
            Boolean(document.querySelector('[data-testid="select-recovery-purchase"]')),
        legacyExecutionRules: [...document.querySelectorAll('body *')].some(element => element.textContent?.trim() === 'Execution Rules'),
        primaryOptions: [...document.querySelectorAll('[data-testid="select-primary-market"] option')].map(option => option.textContent?.trim() || ''),
        multiMarketScanning: document.querySelector('[data-testid="toggle-multi-market"]')?.getAttribute('aria-pressed') || '',
        loading: ['discovering', 'collecting'].includes(root?.dataset.status || ''),
        errorState: ['empty', 'timeout', 'connection-error'].includes(root?.dataset.status || ''),
    };
})()`);

const assertScan = (snapshot, sampleSize) => {
    if (!['ready', 'partial-data'].includes(snapshot.status)) {
        throw new Error(`Expected a completed scan for ${sampleSize}, received: ${snapshot.status}`);
    }
    if (snapshot.loading || snapshot.errorState) {
        throw new Error(`Scan ended in an invalid state for ${sampleSize}.`);
    }
    if (snapshot.sample.replace(/,/g, '') !== String(sampleSize)) {
        throw new Error(`Expected ${sampleSize} observations, received ${snapshot.sample}.`);
    }
    const [covered, discovered] = snapshot.coverage.split('/').map(value => Number(value.trim()));
    const minimumCovered = discovered ? Math.max(1, Math.ceil(discovered * 0.8)) : 0;
    if (!covered || !discovered || covered < minimumCovered) {
        throw new Error(`Expected usable coverage for ${sampleSize}, received ${snapshot.coverage}.`);
    }
    if (!snapshot.modelPick) {
        throw new Error('The model scan completed without selecting a best volatility symbol.');
    }
    if (!snapshot.modelVersion.includes(MODEL_VERSION)) {
        throw new Error(`Expected model version ${MODEL_VERSION}, received: ${snapshot.modelVersion}`);
    }
    if (!['SKIP', 'PARTIAL', 'ACTIVE'].includes(snapshot.model)) {
        throw new Error(`Unexpected model status: ${snapshot.model}`);
    }
    if (!snapshot.primaryCondition || !snapshot.primaryMarket) {
        throw new Error(`Primary Market 1 did not select exactly one qualifying market: ${snapshot.primaryCondition} / ${snapshot.primaryMarket}`);
    }
    if (!snapshot.recoveryCondition || !snapshot.recoveryMarket) {
        throw new Error(`Recovery Market 2 did not select exactly one qualifying market: ${snapshot.recoveryCondition} / ${snapshot.recoveryMarket}`);
    }
    if (!snapshot.marketControls) {
        throw new Error('Market 1, Market 2, or multi-market scanning controls are missing.');
    }
    if (!snapshot.purchaseControls) {
        throw new Error('Market 1 and Market 2 purchase controls are missing from their rule cards.');
    }
    if (!snapshot.purchaseSelections) {
        throw new Error('Market 1 and Recovery Market purchase dropdowns are missing.');
    }
    if (snapshot.legacyExecutionRules) {
        throw new Error('The separate Execution Rules block should be removed.');
    }
    for (const option of ['All Even', 'All Odd', 'All Same', 'Over 1', 'Over 8', 'Under 9', 'Under 1', 'Rise', 'Fall', 'Matches 1', 'Matches 9']) {
        if (!snapshot.primaryOptions.includes(option)) {
            throw new Error(`Market selector is missing ${option}.`);
        }
    }
    if (!['1', '2', '3', '4', '5', '6', '7', '8'].includes(snapshot.digitWindow)) {
        throw new Error(`Digit window is outside the 1–8 range: ${snapshot.digitWindow}`);
    }
    if (!['1', '2', '3', '4', '5', '6', '7', '8'].includes(snapshot.recoveryDigitWindow)) {
        throw new Error(`Recovery digit window is outside the 1–8 range: ${snapshot.recoveryDigitWindow}`);
    }
    if (!['true', 'false'].includes(snapshot.multiMarketScanning)) {
        throw new Error(`Multi-market scanning toggle is not exposed: ${snapshot.multiMarketScanning}`);
    }
};

const run = async () => {
    const port = await findOpenPort();
    const browser = spawn(chromiumPath, [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        `--remote-debugging-port=${port}`,
        'about:blank',
    ], { stdio: 'ignore' });

    let client;
    try {
        await waitForJson(`http://127.0.0.1:${port}/json/version`);
        client = await createCdpClient(port);
        await client.call('Page.enable');
        await client.call('Network.enable');
        await client.call('Runtime.enable');
        await client.call('Page.navigate', { url: TARGET_URL });
        await client.evaluate(`document.querySelector('.slx-popup__dismiss')?.click()`);
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
            'model-powered Alpha tool',
        );

        const results = [];
        for (const sampleSize of SAMPLE_WINDOWS) {
            const sampleUrl = new URL(TARGET_URL);
            sampleUrl.searchParams.set('alpha_scan_sample', String(sampleSize));
            await client.call('Page.navigate', { url: sampleUrl.toString() });
            await waitFor(
                () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
                `${sampleSize}-observation Alpha Tool`,
            );
            const snapshot = await waitFor(
                async () => {
                    const next = await getSnapshot(client.evaluate);
                    return ['ready', 'partial-data'].includes(next.status) ? next : false;
                },
                `live ${sampleSize}-observation scan`,
                90000,
            );
            assertScan(snapshot, sampleSize);
            if (sampleSize === 600) {
                for (const windowSize of [1, 2, 4, 8]) {
                    await client.evaluate(`(() => {
                        const select = document.querySelector('[data-testid="select-digit-window"]');
                        if (!select) return false;
                        select.value = '${windowSize}';
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    })()`);
                    const windowSnapshot = await waitFor(
                        async () => {
                            const next = await getSnapshot(client.evaluate);
                            return next.digitWindow === String(windowSize) ? next : false;
                        },
                        `digit window ${windowSize}`,
                    );
                    if ((windowSnapshot.primaryCondition && !windowSnapshot.primaryMarket) ||
                        (windowSnapshot.recoveryCondition && !windowSnapshot.recoveryMarket) ||
                        (!windowSnapshot.primaryCondition && windowSnapshot.primaryMarket) ||
                        (!windowSnapshot.recoveryCondition && windowSnapshot.recoveryMarket)) {
                        throw new Error(`Digit window ${windowSize} produced an incomplete market decision.`);
                    }
                }
            }
            results.push({
                sampleSize,
                coverage: snapshot.coverage,
                modelPick: Boolean(snapshot.modelPick),
                journalRows: 0,
                model: snapshot.model,
                modelVersion: MODEL_VERSION,
                primaryMarket: snapshot.primaryMarket,
                recoveryMarket: snapshot.recoveryMarket,
            });
        }

        await client.evaluate(`(() => {
            class FailingWebSocket {
                static OPEN = 1;
                readyState = 0;
                constructor() {
                    setTimeout(() => {
                        this.readyState = 3;
                        this.onerror?.(new Event('error'));
                        this.onclose?.(new Event('close'));
                    }, 50);
                }
                close() {
                    this.readyState = 3;
                }
                send() {}
            }
            window.WebSocket = FailingWebSocket;
        })()`);
        await client.evaluate('document.querySelector("[data-testid=\\"button-run-scan\\"]")?.click()');
        const failedSnapshot = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return ['empty', 'timeout', 'connection-error', 'partial-data'].includes(next.status) && !next.modelPick ? next : false;
            },
            'blocked-feed error state',
            45000,
        );
        if (Number(failedSnapshot.coverage.split('/')[0].trim()) !== 0 || failedSnapshot.modelPick) {
            throw new Error('A failed scan retained previous rows or coverage.');
        }
        console.log(JSON.stringify({
            ok: true,
            target: TARGET_URL,
            surface: 'model-powered-tool',
            scans: results,
            blockedFeed: {
                status: failedSnapshot.status,
                rows: 0,
            },
        }, null, 2));
    } finally {
        client?.close();
        browser.kill('SIGTERM');
    }
};

run().catch(error => {
    console.error(`[alpha-scan-regression] ${error.message}`);
    process.exitCode = 1;
});
import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const TARGET_URL = process.env.ALPHA_SCAN_URL || 'https://www.mrcharlohfx.site/#alpha_scan_ai';
const SAMPLE_WINDOWS = [600, 1200];
const MODEL_VERSION = 'feature-logistic-causal-denoise-v1';
const RUN_LIVE = process.env.ALPHA_SCAN_LIVE === '1';
const RESULT_PATH = resolve(
    process.env.ALPHA_SCAN_RESULT_PATH ||
        fileURLToPath(new URL('../.alpha-scan-regression/latest.json', import.meta.url)),
);
const RUN_STARTED_AT = new Date().toISOString();
const RUN_ID = `${RUN_STARTED_AT.replace(/[^0-9]/g, '')}-${process.pid}`;
let phase = 'fixture';

const runReport = {
    schemaVersion: 1,
    runId: RUN_ID,
    startedAt: RUN_STARTED_AT,
    target: TARGET_URL,
    mode: RUN_LIVE ? 'live' : 'fixture',
    status: 'running',
    ok: false,
    phase,
    failureClassification: null,
    failure: null,
    fixture: {
        status: 'pending',
        scans: [],
    },
    externalFeed: RUN_LIVE
        ? {
              status: 'pending',
              scans: [],
          }
        : {
              status: 'skipped',
              reason: 'Set ALPHA_SCAN_LIVE=1 to run public-feed integration coverage.',
          },
};

const persistReport = async report => {
    await mkdir(dirname(RESULT_PATH), { recursive: true });
    const temporaryPath = `${RESULT_PATH}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, RESULT_PATH);
};

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

const waitFor = async (condition, description, timeout = 30000, pollInterval = 500) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        const value = await condition();
        if (value) return value;
        await sleep(pollInterval);
    }
    throw new Error(`Timed out waiting for ${description}.`);
};

const getSnapshot = evaluate => evaluate(`(() => {
    const root = document.querySelector('[data-testid="alpha-tool"]');
    const modelPick = document.querySelector('[data-testid="tool-model-pick"]')?.getAttribute('data-symbol') || '';
    let failedSymbols = [];
    try {
        failedSymbols = JSON.parse(root?.dataset.failedSymbols || '[]');
    } catch {
        failedSymbols = [];
    }
    return {
        status: root?.dataset.status || '',
        scanSource: root?.dataset.scanSource || '',
        coverage: (root?.dataset.modelRowCount || 0) + ' / ' + (root?.dataset.discoveredCount || 0),
        sample: root?.dataset.sampleSize || '',
        error: root?.dataset.error || '',
        failedSymbols,
        model: document.querySelector('[data-testid="tool-model-status"]')?.innerText || '',
        modelVersion: root?.dataset.modelVersion || '',
        modelPick,
        scanCount: root?.dataset.scanCount || '',
        digitWindow: root?.dataset.digitWindow || '',
        recoveryDigitWindow: root?.dataset.recoveryDigitWindow || '',
        primaryCondition: root?.dataset.primaryCondition || '',
        primaryMarket: root?.dataset.primaryMarket || '',
        recoveryCondition: root?.dataset.recoveryCondition || '',
        recoveryMarket: root?.dataset.recoveryMarket || '',
        marketControls: Boolean(document.querySelector('[data-testid="select-primary-market"]')) &&
            Boolean(document.querySelector('[data-testid="select-recovery-market"]')) &&
            Boolean(document.querySelector('[data-testid="toggle-multi-market"]')),
        purchaseSelections: Boolean(document.querySelector('[data-testid="select-primary-purchase"]')) &&
            Boolean(document.querySelector('[data-testid="select-recovery-purchase"]')),
        legacyExecutionRules: [...document.querySelectorAll('body *')].some(element => element.textContent?.trim() === 'Execution Rules'),
        primaryOptions: [...document.querySelectorAll('[data-testid="select-primary-market"] option')].map(option => option.textContent?.trim() || ''),
        purchaseOptions: [...document.querySelectorAll('[data-testid="select-primary-purchase"] option')].map(option => option.textContent?.trim() || ''),
        multiMarketScanning: document.querySelector('[data-testid="toggle-multi-market"]')?.getAttribute('aria-pressed') || '',
        autoVolatilityMode: root?.dataset.autoVolatilityMode || '',
        payoutFloor: root?.dataset.payoutFloor || '',
        autoRunnerControls: Boolean(document.querySelector('[data-testid="toggle-auto-volatility"]')) &&
            Boolean(document.querySelector('[aria-label="Minimum payout"]')),
        executionLeg: root?.dataset.executionLeg || '',
        feedback: document.querySelector('[data-testid="live-trade-feedback"]')?.innerText || '',
        runningRows: document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-symbol]').length,
        settledRows: Number(root?.dataset.journalCount || 0),
        autoTrades: Number(root?.dataset.autoTrades || 0),
        loading: ['discovering', 'collecting'].includes(root?.dataset.status || ''),
        errorState: ['empty', 'timeout', 'connection-error'].includes(root?.dataset.status || ''),
    };
})()`);

const assertScan = (snapshot, sampleSize, expectedSource = 'fixture') => {
    const acceptedSources = Array.isArray(expectedSource) ? expectedSource : [expectedSource];
    if (!['ready', 'partial-data'].includes(snapshot.status)) {
        throw new Error(`Expected a completed scan for ${sampleSize}, received: ${snapshot.status}`);
    }
    if (snapshot.loading || snapshot.errorState) {
        throw new Error(`Scan ended in an invalid state for ${sampleSize}.`);
    }
    if (!acceptedSources.includes(snapshot.scanSource)) {
        throw new Error(`Expected ${acceptedSources.join(' or ')} data for ${sampleSize}, received ${snapshot.scanSource || 'unknown'}.`);
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
    for (const option of ['Over prediction 0', 'Over prediction 8', 'Under prediction 9', 'Under prediction 1', 'Even', 'Odd', 'Rise', 'Fall', 'Matches prediction 0', 'Matches prediction 9', 'Differs prediction 0', 'Differs prediction 9']) {
        if (!snapshot.purchaseOptions.includes(option)) {
            throw new Error(`Purchase selector is missing ${option}.`);
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
    if (!snapshot.autoRunnerControls) {
        throw new Error('Automatic volatility runner controls are missing.');
    }
    if (!['1.5', '1.8', '2'].includes(snapshot.payoutFloor)) {
        throw new Error(`Unexpected payout floor: ${snapshot.payoutFloor}`);
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
        const fixtureUrl = (sampleSize, executionFixture = false, riskFixture = '', confirmationFixture = '') => {
            const url = new URL(TARGET_URL);
            url.searchParams.set('alpha_scan_sample', String(sampleSize));
            url.searchParams.set('alpha_scan_fixture', '1');
            if (executionFixture) url.searchParams.set('alpha_scan_execution_fixture', '1');
            if (riskFixture) url.searchParams.set('alpha_scan_risk_fixture', riskFixture);
            if (confirmationFixture) url.searchParams.set('alpha_scan_confirmation_fixture', confirmationFixture);
            return url.toString();
        };
        const liveUrl = sampleSize => {
            const url = new URL(TARGET_URL);
            url.searchParams.set('alpha_scan_sample', String(sampleSize));
            url.searchParams.delete('alpha_scan_fixture');
            return url.toString();
        };
        const symbolFailureUrl = sampleSize => {
            const url = new URL(liveUrl(sampleSize));
            url.searchParams.set('alpha_scan_failure_symbol', 'first');
            url.searchParams.set('alpha_scan_failure_mode', 'incomplete');
            return url.toString();
        };

        await client.call('Page.navigate', { url: fixtureUrl(SAMPLE_WINDOWS[0]) });
        await client.evaluate(`document.querySelector('.slx-popup__dismiss')?.click()`);
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
            'model-powered Alpha tool',
        );

        const results = [];
        for (const sampleSize of SAMPLE_WINDOWS) {
            const sampleUrl = new URL(TARGET_URL);
            sampleUrl.searchParams.set('alpha_scan_sample', String(sampleSize));
            sampleUrl.searchParams.set('alpha_scan_fixture', '1');
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
                `fixture ${sampleSize}-observation scan`,
                90000,
            );
            assertScan(snapshot, sampleSize, 'fixture');
            if (sampleSize === 600) {
                for (const windowSize of [1, 2, 4, 8]) {
                    await client.evaluate(`(() => {
                         const select = document.querySelector('[data-testid="select-primary-digit-window"]');
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

                await client.evaluate(`(() => {
                    const toggle = document.querySelector('[data-testid="toggle-auto-volatility"]');
                    if (!toggle) return false;
                    toggle.click();
                    return true;
                })()`);
                const autoRunnerSnapshot = await waitFor(
                    async () => {
                        const next = await getSnapshot(client.evaluate);
                        return next.autoVolatilityMode === 'true' ? next : false;
                    },
                    'automatic volatility runner toggle',
                );
                if (autoRunnerSnapshot.executionLeg !== 'idle') {
                    throw new Error(`Auto runner changed execution state without a live contract: ${autoRunnerSnapshot.executionLeg}`);
                }
                const autoRunButton = await client.evaluate(
                    `document.querySelector('[data-testid="button-run-trade"]')?.disabled === true`,
                );
                if (!autoRunButton) {
                    throw new Error('Auto runner exposed an executable buy without an authorized live account.');
                }
                await client.evaluate(`document.querySelector('[data-testid="toggle-auto-volatility"]')?.click()`);
                await waitFor(
                    async () => {
                        const next = await getSnapshot(client.evaluate);
                        return next.autoVolatilityMode === 'false' ? next : false;
                    },
                    'automatic volatility runner reset',
                );
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

        const fixtureResults = results.splice(0);
        let liveResults = [];
        let symbolFailure;
        let blockedFeed;
        let autoRunner;
        runReport.fixture = {
            status: 'passed',
            scans: fixtureResults,
        };

        await client.call('Page.navigate', { url: fixtureUrl(SAMPLE_WINDOWS[0], true) });
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
            'automatic-runner fixture Alpha Tool',
        );
        const autoScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return ['ready', 'partial-data'].includes(next.status) ? next : false;
            },
            'automatic-runner fixture scan',
            90000,
        );
        assertScan(autoScan, SAMPLE_WINDOWS[0], 'fixture');
        const initialAutoScanCount = Number(autoScan.scanCount);
        if (!Number.isFinite(initialAutoScanCount) || initialAutoScanCount < 1) {
            throw new Error(`Automatic-runner fixture did not expose its initial scan count: ${autoScan.scanCount}`);
        }

        await client.evaluate('document.querySelector("[data-testid=\\"toggle-auto-volatility\\"]")?.click()');
        const autoEnabled = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.autoVolatilityMode === 'true' && next.modelPick ? next : false;
            },
            'automatic volatility runner enabled',
        );
        const confirmation = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.feedback.includes('Fresh confirmation') ? next : false;
            },
            'fresh confirmation messaging before execution',
            5000,
            50,
        );
        if (!/Fresh confirmation (?:1|2)\/3/.test(confirmation.feedback)) {
            throw new Error(`Expected an in-progress fresh confirmation before execution, received: ${confirmation.feedback}`);
        }
        const passedConfirmation = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.feedback.includes('Fresh confirmation passed') ? next : false;
            },
            'fresh confirmation gate passed',
            5000,
            10,
        );
        if (passedConfirmation.runningRows !== 0) {
            throw new Error('The automatic runner opened a contract before fresh confirmation passed.');
        }

        const firstRunning = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.runningRows === 1 ? next : false;
            },
            'first automatic contract',
            5000,
            50,
        );
        await client.evaluate('document.querySelector("[data-testid=\\"button-run-trade\\"]")?.click()');
        await sleep(100);
        const singleActiveContract = await getSnapshot(client.evaluate);
        if (singleActiveContract.runningRows !== 1 || !['primary-running', 'primary-pending'].includes(singleActiveContract.executionLeg)) {
            throw new Error(
                `A second automatic purchase was not blocked while the first was active: ${JSON.stringify(singleActiveContract)}`,
            );
        }

        const settled = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.runningRows === 0 && next.executionLeg === 'idle' && next.settledRows >= 1
                    ? next
                    : false;
            },
            'automatic contract settlement',
            5000,
            50,
        );
        if (settled.runningRows !== 0 || settled.settledRows < 1 || settled.executionLeg !== 'idle') {
            throw new Error(`Settlement did not clear the active position cleanly: ${JSON.stringify(settled)}`);
        }

        const rescanned = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return Number(next.scanCount) > initialAutoScanCount &&
                    ['ready', 'partial-data'].includes(next.status)
                    ? next
                    : false;
            },
            'automatic runner rescan after settlement',
            10000,
            50,
        );
        if (rescanned.coverage !== '8 / 8' || !rescanned.modelPick) {
            throw new Error(`Settlement rescan did not cover the full fixture universe: ${JSON.stringify(rescanned)}`);
        }
        const resumed = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.runningRows === 1 ? next : false;
            },
            'automatic runner resumed after settlement',
            10000,
            50,
        );
        if (resumed.settledRows < 1 || resumed.runningRows !== 1) {
            throw new Error(`Automatic runner did not resume with one active contract: ${JSON.stringify(resumed)}`);
        }
        autoRunner = {
            status: 'passed',
            initialScanCount: initialAutoScanCount,
            rescanCount: Number(rescanned.scanCount),
            firstContract: firstRunning.runningRows,
            settledRows: settled.settledRows,
            resumedActiveRows: resumed.runningRows,
        };
        runReport.fixture.autoRunner = autoRunner;

        await client.call('Page.navigate', {
            url: fixtureUrl(SAMPLE_WINDOWS[0], true, '', 'reverse'),
        });
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
            'confirmation-reversal fixture Alpha Tool',
        );
        const reversalScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return ['ready', 'partial-data'].includes(next.status) ? next : false;
            },
            'confirmation-reversal fixture scan',
            90000,
        );
        assertScan(reversalScan, SAMPLE_WINDOWS[0], 'fixture');
        const initialReversalScanCount = Number(reversalScan.scanCount);
        await client.evaluate('document.querySelector("[data-testid=\\"toggle-auto-volatility\\"]")?.click()');
        const failedConfirmation = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.feedback.includes('Fresh confirmation failed') ? next : false;
            },
            'failed fresh confirmation',
            5000,
            50,
        );
        if (
            failedConfirmation.runningRows !== 0 ||
            failedConfirmation.settledRows !== 0 ||
            failedConfirmation.executionLeg !== 'idle' ||
            Number(failedConfirmation.autoTrades) !== 0
        ) {
            throw new Error(
                `A failed fresh confirmation left an active or settled contract: ${JSON.stringify(failedConfirmation)}`,
            );
        }
        const reversalRescan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return Number(next.scanCount) > initialReversalScanCount &&
                    ['ready', 'partial-data'].includes(next.status)
                    ? next
                    : false;
            },
            'complete rescan after failed fresh confirmation',
            10000,
            50,
        );
        assertScan(reversalRescan, SAMPLE_WINDOWS[0], 'fixture');
        if (reversalRescan.runningRows !== 0 || Number(reversalRescan.autoTrades) !== 0) {
            throw new Error(
                `The runner resumed execution before a new confirmation: ${JSON.stringify(reversalRescan)}`,
            );
        }
        const resumedConfirmation = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.feedback.includes('Fresh confirmation 1/3') ? next : false;
            },
            'fresh confirmation after recovery rescan',
            10000,
            50,
        );
        if (resumedConfirmation.runningRows !== 0 || resumedConfirmation.executionLeg !== 'primary-pending') {
            throw new Error(
                `The runner did not wait for a new valid confirmation: ${JSON.stringify(resumedConfirmation)}`,
            );
        }
        const recoveredRunning = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.runningRows === 1 ? next : false;
            },
            'automatic runner resumed after failed confirmation',
            10000,
            50,
        );
        const confirmationRecovery = {
            status: 'passed',
            initialScanCount: initialReversalScanCount,
            rescanCount: Number(reversalRescan.scanCount),
            failedActiveRows: failedConfirmation.runningRows,
            resumedActiveRows: recoveredRunning.runningRows,
        };
        runReport.fixture.confirmationRecovery = confirmationRecovery;

        const riskBoundaryCases = [
            { mode: 'target', stopMessage: 'Session target reached', settledRows: 2 },
            { mode: 'stop-loss', stopMessage: 'Session stop loss reached', settledRows: 1 },
            { mode: 'consecutive-losses', stopMessage: '3 consecutive losses reached', settledRows: 3 },
            { mode: 'trade-count', stopMessage: '50 trades reached for this session', settledRows: 50 },
        ];
        const riskBoundaries = [];
        for (const riskCase of riskBoundaryCases) {
            await client.call('Page.navigate', {
                url: fixtureUrl(SAMPLE_WINDOWS[0], true, riskCase.mode),
            });
            await waitFor(
                () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
                `${riskCase.mode} risk fixture Alpha Tool`,
            );
            const riskScan = await waitFor(
                async () => {
                    const next = await getSnapshot(client.evaluate);
                    return ['ready', 'partial-data'].includes(next.status) ? next : false;
                },
                `${riskCase.mode} risk fixture scan`,
                5000,
            );
            assertScan(riskScan, SAMPLE_WINDOWS[0], 'fixture');
            await client.evaluate('document.querySelector("[data-testid=\\"toggle-auto-volatility\\"]")?.click()');
            const stopped = await waitFor(
                async () => {
                    const next = await getSnapshot(client.evaluate);
                    return next.autoVolatilityMode === 'false' && next.feedback.includes(riskCase.stopMessage)
                        ? next
                        : false;
                },
                `${riskCase.mode} risk boundary`,
                riskCase.mode === 'trade-count' ? 30000 : 10000,
                50,
            );
            if (
                stopped.runningRows !== 0 ||
                stopped.executionLeg !== 'idle' ||
                Number(stopped.autoTrades) !== riskCase.settledRows
            ) {
                throw new Error(
                    `${riskCase.mode} risk boundary did not clear execution cleanly: ${JSON.stringify(stopped)}`,
                );
            }
            await sleep(250);
            const afterStop = await getSnapshot(client.evaluate);
            if (
                afterStop.runningRows !== 0 ||
                afterStop.executionLeg !== 'idle' ||
                afterStop.autoVolatilityMode !== 'false' ||
                Number(afterStop.autoTrades) !== riskCase.settledRows ||
                !afterStop.feedback.includes(riskCase.stopMessage)
            ) {
                throw new Error(
                    `${riskCase.mode} risk boundary placed another contract after stopping: ${JSON.stringify(afterStop)}`,
                );
            }
            riskBoundaries.push({
                mode: riskCase.mode,
                status: 'passed',
                settledRows: afterStop.autoTrades,
                executionLeg: afterStop.executionLeg,
                feedback: afterStop.feedback,
            });
        }
        runReport.fixture.riskBoundaries = riskBoundaries;

        if (RUN_LIVE) {
            phase = 'external-feed';
            runReport.phase = phase;
            for (const sampleSize of SAMPLE_WINDOWS) {
                await client.call('Page.navigate', { url: liveUrl(sampleSize) });
                await waitFor(
                    () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
                    `${sampleSize}-observation Alpha Tool`,
                );
                const snapshot = await waitFor(
                    async () => {
                        const next = await getSnapshot(client.evaluate);
                        return ['ready', 'partial-data', 'empty', 'timeout', 'connection-error'].includes(next.status)
                            ? next
                            : false;
                    },
                    `external-feed ${sampleSize}-observation scan`,
                    90000,
                );
                assertScan(snapshot, sampleSize, ['public-metadata', 'verified-catalog']);
                liveResults.push({
                    sampleSize,
                    coverage: snapshot.coverage,
                    modelPick: Boolean(snapshot.modelPick),
                    failedSymbols: snapshot.failedSymbols,
                    error: snapshot.error,
                    journalRows: 0,
                    model: snapshot.model,
                    modelVersion: MODEL_VERSION,
                    primaryMarket: snapshot.primaryMarket,
                    recoveryMarket: snapshot.recoveryMarket,
                });
                runReport.externalFeed.scans = liveResults;
            }

            await client.call('Page.navigate', { url: symbolFailureUrl(SAMPLE_WINDOWS[0]) });
            await waitFor(
                () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
                'deterministic symbol-failure Alpha Tool',
            );
            symbolFailure = await waitFor(
                async () => {
                    const next = await getSnapshot(client.evaluate);
                    return ['ready', 'partial-data', 'empty', 'timeout', 'connection-error'].includes(next.status) &&
                        next.failedSymbols.length > 0
                        ? next
                        : false;
                },
                'deterministic symbol history failure',
                90000,
            );
            if (symbolFailure.failedSymbols.length !== 1) {
                throw new Error(
                    `Expected one deterministic failed symbol, received ${symbolFailure.failedSymbols.join(', ') || 'none'}.`,
                );
            }
            const failedSymbol = symbolFailure.failedSymbols[0];
            if (!symbolFailure.error.includes('History collection') || !symbolFailure.error.includes(failedSymbol)) {
                throw new Error(
                    `The deterministic history failure did not name the affected symbol: ${symbolFailure.error || 'no error reported'}.`,
                );
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
            blockedFeed = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return ['empty', 'timeout', 'connection-error', 'partial-data'].includes(next.status) && !next.modelPick ? next : false;
            },
            'blocked-feed error state',
            45000,
        );
            if (Number(blockedFeed.coverage.split('/')[0].trim()) !== 0 || blockedFeed.modelPick) {
                throw new Error('A failed external-feed scan retained previous rows or coverage.');
            }
            runReport.externalFeed = {
                status: 'passed',
                scans: liveResults,
                symbolFailure: {
                    status: symbolFailure.status,
                    failedSymbols: symbolFailure.failedSymbols,
                    error: symbolFailure.error,
                },
                blockedFeed: {
                    status: blockedFeed.status,
                    rows: 0,
                    failedSymbols: blockedFeed.failedSymbols,
                    error: blockedFeed.error,
                },
            };
        }

        const result = {
            schemaVersion: 1,
            runId: RUN_ID,
            startedAt: RUN_STARTED_AT,
            completedAt: new Date().toISOString(),
            ok: true,
            status: 'passed',
            failureClassification: null,
            failure: null,
            target: TARGET_URL,
            surface: 'model-powered-tool',
            fixture: {
                status: 'passed',
                scans: fixtureResults,
                autoRunner,
                confirmationRecovery,
                riskBoundaries: runReport.fixture.riskBoundaries || [],
            },
            externalFeed: RUN_LIVE ? {
                status: 'passed',
                scans: liveResults,
                symbolFailure: {
                    status: symbolFailure.status,
                    failedSymbols: symbolFailure.failedSymbols,
                    error: symbolFailure.error,
                },
                blockedFeed: {
                    status: blockedFeed.status,
                    rows: 0,
                    failedSymbols: blockedFeed.failedSymbols,
                    error: blockedFeed.error,
                },
            } : {
                status: 'skipped',
                reason: 'Set ALPHA_SCAN_LIVE=1 to run public-feed integration coverage.',
            },
        };
        await persistReport(result);
        console.log(JSON.stringify(result, null, 2));
    } finally {
        client?.close();
        browser.kill('SIGTERM');
    }
};

run().catch(async error => {
    const failureLabel = phase === 'external-feed' ? 'Public-feed integration failure' : 'Fixture layout check failure';
    const failureClassification = phase === 'external-feed' ? 'public-feed' : 'fixture-layout';
    if (phase === 'external-feed') {
        runReport.externalFeed = {
            ...runReport.externalFeed,
            status: 'failed',
        };
    } else {
        runReport.fixture = {
            ...runReport.fixture,
            status: 'failed',
        };
    }
    const result = {
        ...runReport,
        completedAt: new Date().toISOString(),
        ok: false,
        status: 'failed',
        phase,
        failureClassification,
        failure: {
            classification: failureClassification,
            label: failureLabel,
            message: error.message,
        },
    };
    try {
        await persistReport(result);
    } catch (persistError) {
        console.error(`[alpha-scan-regression] Could not persist result to ${RESULT_PATH}: ${persistError.message}`);
    }
    console.error(`[alpha-scan-regression][${phase}] ${failureLabel}: ${error.message}`);
    process.exitCode = 1;
});
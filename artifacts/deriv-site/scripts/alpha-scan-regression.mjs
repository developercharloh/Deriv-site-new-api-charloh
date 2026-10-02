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
let fixtureStage = 'initial fixture checks';

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

const touchTap = async (client, { x, y }) => {
    const touchPoint = { x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 };
    await client.call('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [touchPoint],
    });
    await sleep(50);
    await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(50);
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
        scanCoverageSymbols: [...document.querySelectorAll('[data-testid="scan-coverage"] [data-symbol]')]
            .map(element => element.getAttribute('data-symbol') || ''),
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
         primaryPurchase: root?.dataset.primaryPurchase || '',
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
        recoveryEnabled: document.querySelector('[data-testid="toggle-recovery"]')?.getAttribute('aria-pressed') || '',
        autoVolatilityMode: root?.dataset.autoVolatilityMode || '',
        payoutFloor: root?.dataset.payoutFloor || '',
        qualifiedSymbols: (root?.dataset.autoQualifiedSymbols || '')
            .split(',')
            .map(symbol => symbol.trim())
            .filter(Boolean),
        autoRunnerControls: Boolean(document.querySelector('[data-testid="toggle-auto-volatility"]')) &&
            Boolean(document.querySelector('[aria-label="Minimum payout"]')),
        executionLeg: root?.dataset.executionLeg || '',
        feedback: document.querySelector('[data-testid="live-trade-feedback"]')?.innerText || '',
        executionFixture: root?.dataset.executionFixture || '',
        confirmationFixture: root?.dataset.confirmationFixture || '',
        nexusFeedbackHistory: Array.isArray(window.__nexusFeedbackHistory)
            ? [...window.__nexusFeedbackHistory]
            : [],
        fixtureBuyCalls: Array.isArray(window.__alphaScanFixtureBuyCalls)
            ? [...window.__alphaScanFixtureBuyCalls]
            : [],
        nexusRecoveryEnabled: document.querySelector('[data-testid="toggle-recovery"]')?.getAttribute('aria-pressed') || '',
        runningRows: document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-symbol]:not([data-contract-id])').length,
        journalLegs: [...document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-leg]')]
            .map(row => row.getAttribute('data-leg') || ''),
        journalSymbols: [...document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-symbol]')]
            .map(row => row.getAttribute('data-symbol') || ''),
        journalStakes: [...document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-stake]')]
            .map(row => Number(row.getAttribute('data-stake'))),
        journalGates: [...document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-contract-id]')]
            .map(row => row.querySelector('[class*="alpha-cockpit__row-gate"]')?.textContent?.trim() || ''),
        journalProfits: [...document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-contract-id]')]
            .map(row => row.lastElementChild?.textContent?.trim() || ''),
        journalProfitValues: [...document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-contract-id]')]
            .map(row => Number(row.getAttribute('data-profit'))),
        openProfitLoss: root?.dataset.openProfitLoss || '',
        totalPnlAtTop: Boolean(document.querySelector('.alpha-cockpit__topbar + [data-testid="tool-total-pnl"]')),
        totalProfitLoss: Number(root?.dataset.totalProfitLoss || 'NaN'),
        totalPnlDisplay: document.querySelector('[data-testid="tool-total-pnl"]')?.innerText || '',
        location: window.location.href,
        journalPrices: [...document.querySelectorAll('[data-testid="tool-journal"] tbody tr[data-symbol]')]
            .map(row => [...row.querySelectorAll('td')].slice(4, 7).map(cell => cell.textContent?.trim() || '')),
        settledRows: Number(root?.dataset.journalCount || 0),
        autoTrades: Number(root?.dataset.autoTrades || 0),
        payoutSkipCount: Number(root?.dataset.payoutSkipCount || 0),
         digitFallbackCount: Number(root?.dataset.digitFallbackCount || 0),
        lastPayoutSkip: root?.dataset.lastPayoutSkip || '',
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
    if (snapshot.scanCoverageSymbols.length !== discovered) {
        throw new Error(
            `The visible scan coverage list did not match the scanned universe: ${snapshot.scanCoverageSymbols.length} / ${discovered}.`,
        );
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
    for (const option of ['All Even', 'All Odd', 'Over 1', 'Over 2', 'Over 3', 'Over 4', 'Over 5', 'Under 8', 'Under 7', 'Under 6', 'Under 5', 'Under 4']) {
        if (!snapshot.primaryOptions.includes(option)) {
            throw new Error(`Market selector is missing ${option}.`);
        }
    }
    for (const option of ['Over prediction 1', 'Over prediction 2', 'Over prediction 3', 'Over prediction 4', 'Over prediction 5', 'Under prediction 8', 'Under prediction 7', 'Under prediction 6', 'Under prediction 5', 'Under prediction 4', 'Even', 'Odd']) {
        if (!snapshot.purchaseOptions.includes(option)) {
            throw new Error(`Purchase selector is missing ${option}.`);
        }
    }
    for (const option of ['All Same', 'Rise', 'Fall', 'Over 6', 'Over 8', 'Under 3', 'Under 1', 'Matches 1', 'Matches 9']) {
        if (snapshot.primaryOptions.includes(option)) {
            throw new Error(`Unsupported condition ${option} is still selectable: ${JSON.stringify(snapshot.primaryOptions)}`);
        }
    }
    for (const option of ['Over prediction 0', 'Over prediction 6', 'Under prediction 9', 'Under prediction 3', 'Rise', 'Fall', 'Matches prediction 0', 'Differs prediction 9']) {
        if (snapshot.purchaseOptions.includes(option)) {
            throw new Error(`Unsupported purchase route ${option} is still selectable.`);
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
        const fixtureUrl = (sampleSize, executionFixture = false, riskFixture = '', confirmationFixture = '', unavailableContract = false, recoveryFixture = false) => {
            const url = new URL(TARGET_URL);
            url.searchParams.set('alpha_scan_sample', String(sampleSize));
            url.searchParams.set('alpha_scan_fixture', '1');
            if (executionFixture) url.searchParams.set('alpha_scan_execution_fixture', '1');
            if (riskFixture) url.searchParams.set('alpha_scan_risk_fixture', riskFixture);
            if (confirmationFixture) url.searchParams.set('alpha_scan_confirmation_fixture', confirmationFixture);
            if (unavailableContract) url.searchParams.set('alpha_scan_unavailable_contract', '1');
            if (recoveryFixture) url.searchParams.set('alpha_scan_recovery_fixture', 'loss');
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

        await client.call('Page.navigate', { url: fixtureUrl(SAMPLE_WINDOWS[0], true) });
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
            'model-powered Alpha tool',
        );
        await waitFor(
            () => client.evaluate('!document.querySelector(".spl")'),
            'startup splash dismissal',
            10000,
            100,
        );
        await waitFor(
            () => client.evaluate(`(() => {
                const dismiss = document.querySelector('.slx-popup__dismiss');
                if (!dismiss) return false;
                dismiss.click();
                return true;
            })()`),
            'late social popup dismissal',
            5000,
            100,
        );
        await waitFor(
            () => client.evaluate('!document.querySelector(".slx-popup__dismiss")'),
            'social popup closing',
            5000,
            100,
        );

        await client.call('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 700,
            deviceScaleFactor: 1,
            mobile: true,
        });
        await client.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"nexus-launch-button\\"]"))'),
            'mobile Nexus controls',
        );
        const mobileReady = await waitFor(
            async () => client.evaluate(`(() => {
                const scan = document.querySelector('[data-testid="nexus-scan-button"]');
                const engine = document.querySelector('[data-testid="alpha-tool"]');
                const completed = ['ready', 'partial-data'].includes(engine?.dataset.status || '');
                return scan && !scan.disabled && completed
                    ? { scanCount: Number(engine?.dataset.scanCount || 0) }
                    : false;
            })()`),
            'completed mobile Nexus market scan',
        );
        const mobileLayout = await client.evaluate(`(() => {
            const main = document.querySelector('.main.main--nexus-ai');
            const journal = document.querySelector('.nexus-ai__journal');
            const launch = document.querySelector('[data-testid="nexus-launch-button"]');
            const scan = document.querySelector('[data-testid="nexus-scan-button"]');
            if (!main || !journal || !launch || !scan) return null;
            const page = document.scrollingElement || document.documentElement;
            const documentMaxScroll = Math.max(0, page.scrollHeight - document.documentElement.clientHeight);
            const journalDocumentBottom = journal.getBoundingClientRect().bottom + window.scrollY;
            page.scrollTop = Math.min(documentMaxScroll, Math.max(0, journalDocumentBottom - window.innerHeight + 8));
            const journalRect = journal.getBoundingClientRect();
            const launchRect = launch.getBoundingClientRect();
            const scanRect = scan.getBoundingClientRect();
            const ancestors = [];
            for (let element = main; element && ancestors.length < 8; element = element.parentElement) {
                const style = getComputedStyle(element);
                ancestors.push({
                    tag: element.tagName,
                    id: element.id,
                    className: String(element.className || ''),
                    display: style.display,
                    height: style.height,
                    minHeight: style.minHeight,
                    overflowY: style.overflowY,
                    flex: style.flex,
                    scrollHeight: element.scrollHeight,
                    clientHeight: element.clientHeight,
                });
            }
            const result = {
                mainOverflowY: getComputedStyle(main).overflowY,
                mainScrollRange: Math.max(0, main.scrollHeight - main.clientHeight),
                documentClientHeight: document.documentElement.clientHeight,
                documentScrollHeight: page.scrollHeight,
                documentMaxScroll,
                journalReachable: journalRect.bottom > 0 && journalRect.bottom <= window.innerHeight + 8,
                journalBottom: journalRect.bottom,
                nexusLayoutSelectorMatches: Boolean(document.querySelector('.layout:has(.main.main--nexus-ai)')),
                rootViewport: {
                    htmlHeight: getComputedStyle(document.documentElement).height,
                    htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
                    bodyHeight: getComputedStyle(document.body).height,
                    bodyOverflowY: getComputedStyle(document.body).overflowY,
                },
                ancestors,
                launchWidth: launchRect.width,
                launchHeight: launchRect.height,
                scanWidth: scanRect.width,
                scanHeight: scanRect.height,
            };
            page.scrollTop = 0;
            return result;
        })()`);
        if (
            !mobileLayout ||
            !['visible', 'clip'].includes(mobileLayout.mainOverflowY) ||
            mobileLayout.mainScrollRange > 1 ||
            mobileLayout.documentMaxScroll <= 0 ||
            !mobileLayout.journalReachable ||
            mobileLayout.launchWidth < 44 ||
            mobileLayout.launchHeight < 44 ||
            mobileLayout.scanWidth < 44 ||
            mobileLayout.scanHeight < 44
        ) {
            throw new Error(`Nexus mobile layout or touch targets are not usable: ${JSON.stringify(mobileLayout)}`);
        }

        const swipe = await client.evaluate(`(() => {
            const main = document.querySelector('.main.main--nexus-ai');
            if (!main) return null;
            const rect = main.getBoundingClientRect();
            const startY = Math.min(rect.bottom - 20, window.innerHeight - 20);
            return {
                x: 8,
                startY,
                endY: Math.max(rect.top + 20, startY - 420),
            };
        })()`);
        if (!swipe || swipe.startY - swipe.endY < 80) {
            throw new Error(`Nexus page did not expose a usable mobile swipe area: ${JSON.stringify(swipe)}`);
        }
        await client.evaluate(`(() => {
            window.__nexusMobileTrace = [];
            for (const type of ['touchstart', 'touchmove', 'touchend', 'scroll']) {
                document.addEventListener(type, event => {
                    const item = {
                        type: event.type,
                        defaultPrevented: event.defaultPrevented,
                        y: event.touches?.[0]?.clientY ?? null,
                    };
                    window.__nexusMobileTrace.push(item);
                    Promise.resolve().then(() => { item.defaultPrevented = event.defaultPrevented; });
                }, true);
            }
        })()`);
        const touchPoint = y => ({
            x: swipe.x,
            y,
            id: 1,
            radiusX: 1,
            radiusY: 1,
            force: 1,
        });
        await client.call('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [touchPoint(swipe.startY)],
        });
        for (let step = 1; step <= 6; step += 1) {
            const y = swipe.startY + ((swipe.endY - swipe.startY) * step) / 6;
            await client.call('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [touchPoint(y)],
            });
            await sleep(25);
        }
        await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(250);
        const touchScrollState = await client.evaluate(`(() => {
            const main = document.querySelector('.main.main--nexus-ai');
            if (!main) return null;
            const rect = main.getBoundingClientRect();
            const page = document.scrollingElement || document.documentElement;
            const target = document.elementFromPoint(${swipe.x}, ${swipe.startY});
            const ancestors = [];
            for (let element = main; element && ancestors.length < 8; element = element.parentElement) {
                const style = getComputedStyle(element);
                ancestors.push({
                    tag: element.tagName,
                    id: element.id,
                    className: String(element.className || ''),
                    touchAction: style.touchAction,
                    overflowY: style.overflowY,
                    height: style.height,
                    scrollHeight: element.scrollHeight,
                    clientHeight: element.clientHeight,
                });
            }
            return {
                documentScrollTop: page.scrollTop,
                documentScrollHeight: page.scrollHeight,
                documentClientHeight: document.documentElement.clientHeight,
                mainScrollTop: main.scrollTop,
                mainOverflowY: getComputedStyle(main).overflowY,
                htmlTouchAction: getComputedStyle(document.documentElement).touchAction,
                touchAction: getComputedStyle(document.body).touchAction,
                gestureTargetTouchAction: target ? getComputedStyle(target).touchAction : null,
                ancestors,
                rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
                gestureTarget: target
                    ? { tag: target.tagName, className: String(target.className || ''), id: target.id || '' }
                    : null,
                touchTrace: window.__nexusMobileTrace || [],
            };
        })()`);
        const touchScrollTop = Number(touchScrollState?.documentScrollTop || 0);
        if (touchScrollTop <= 0) {
            throw new Error(`A mobile swipe did not scroll the page document: ${JSON.stringify(touchScrollState)}`);
        }

        const scanTarget = await client.evaluate(`(() => {
            const scan = document.querySelector('[data-testid="nexus-scan-button"]');
            scan?.scrollIntoView({ block: 'center' });
            if (!scan) return null;
            const rect = scan.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { x, y, receivesTap: hit === scan || scan.contains(hit) };
        })()`);
        if (!scanTarget?.receivesTap) {
            throw new Error(`The visible Nexus Scan target is covered at its center: ${JSON.stringify(scanTarget)}`);
        }
        const scanCountBefore = Number(mobileReady.scanCount);
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-scan-button\\"]")?.click()');
        let afterManualScan;
        try {
            afterManualScan = await waitFor(
                async () => client.evaluate(`(() => {
                    const button = document.querySelector('[data-testid="nexus-scan-button"]');
                    const root = document.querySelector('[data-testid="alpha-tool"]');
                    const scanCount = Number(root?.dataset.scanCount || 0);
                    return button && !button.disabled && scanCount > ${scanCountBefore}
                        ? { scanCount }
                        : false;
                })()`),
                'mobile Nexus scan action',
                30000,
                50,
            );
        } catch (error) {
            const snapshot = await getSnapshot(client.evaluate);
            const buttonState = await client.evaluate(`(() => {
                const button = document.querySelector('[data-testid="nexus-scan-button"]');
                return button ? { disabled: button.disabled, text: button.innerText, scanCountBefore: ${scanCountBefore} } : null;
            })()`);
            throw new Error(`Mobile Nexus scan action failed: ${JSON.stringify({ snapshot, buttonState })}`);
        }

        const launchTarget = await client.evaluate(`(() => {
            const launch = document.querySelector('[data-testid="nexus-launch-button"]');
            launch?.scrollIntoView({ block: 'center' });
            if (!launch) return null;
            const rect = launch.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(centerX, centerY);
            return {
                x: centerX,
                y: centerY,
                receivesTap: hit === launch || launch.contains(hit),
            };
        })()`);
        if (!launchTarget?.receivesTap) {
            throw new Error(`The visible Nexus Launch target is covered at its center: ${JSON.stringify(launchTarget)}`);
        }
        await touchTap(client, launchTarget);
        await waitFor(
            () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "true"'),
            'Nexus launch responding to a mobile touch',
            5000,
            50,
        );
        const stopTarget = await client.evaluate(`(() => {
            const stop = document.querySelector('[data-testid="nexus-launch-button"]');
            const rect = stop.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        await touchTap(client, stopTarget);
        await waitFor(
            () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "false"'),
            'Nexus stop cancelling its pending launch',
            5000,
            50,
        );
        await sleep(1000);
        const afterNexusStop = await getSnapshot(client.evaluate);
        if (
            afterNexusStop.executionLeg !== 'idle' ||
            afterNexusStop.journalLegs.length > 0 ||
            afterNexusStop.runningRows > 0
        ) {
            throw new Error(`Nexus opened a contract after mobile Stop: ${JSON.stringify(afterNexusStop)}`);
        }
        const mobileNexusTest = {
            status: 'passed',
            documentScrollHeight: mobileLayout.documentScrollHeight,
            documentClientHeight: mobileLayout.documentClientHeight,
            touchScrollTop,
            mainInnerScrollRange: mobileLayout.mainScrollRange,
            launchTarget: `${Math.round(mobileLayout.launchWidth)}×${Math.round(mobileLayout.launchHeight)}`,
            scanTarget: `${Math.round(mobileLayout.scanWidth)}×${Math.round(mobileLayout.scanHeight)}`,
            scanCount: afterManualScan.scanCount,
            contractsAfterStop: afterNexusStop.journalLegs.length,
        };
        await client.call('Emulation.setTouchEmulationEnabled', { enabled: false });
        await client.call('Emulation.clearDeviceMetricsOverride');

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
        let recoveryOff;
        runReport.fixture = {
            status: 'passed',
            scans: fixtureResults,
            mobileNexus: mobileNexusTest,
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
        if (autoEnabled.qualifiedSymbols.length < 2) {
            throw new Error(`Automatic-runner fixture did not expose multiple qualified markets: ${JSON.stringify(autoEnabled.qualifiedSymbols)}`);
        }
        const confirmation = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.feedback.includes('Fresh digit confirmation') ? next : false;
            },
            'fresh digit confirmation messaging before execution',
            5000,
            50,
        );
        if (!/Fresh digit confirmation (?:1|2)\/3/.test(confirmation.feedback)) {
            throw new Error(`Expected an in-progress fresh confirmation before execution, received: ${confirmation.feedback}`);
        }
        let passedConfirmation;
        try {
            passedConfirmation = await waitFor(
                async () => {
                    const next = await getSnapshot(client.evaluate);
                    return next.feedback.includes('Fresh 3/3 digit confirmation passed') ||
                        next.feedback.includes('Fresh digit confirmation failed')
                        ? next
                        : false;
                },
                'fresh digit confirmation gate passed',
                5000,
                10,
            );
        } catch (error) {
            const finalState = await getSnapshot(client.evaluate);
            throw new Error(`${error.message} Final runner state: ${JSON.stringify({
                feedback: finalState.feedback,
                executionLeg: finalState.executionLeg,
                autoTrades: finalState.autoTrades,
                runningRows: finalState.runningRows,
                payoutSkipCount: finalState.payoutSkipCount,
                fixtureBuyCalls: finalState.fixtureBuyCalls,
            })}`);
        }
        if (passedConfirmation.feedback.includes('Fresh digit confirmation failed')) {
            throw new Error(`Fresh digit confirmation did not pass: ${JSON.stringify({
                feedback: passedConfirmation.feedback,
                executionLeg: passedConfirmation.executionLeg,
                fixtureBuyCalls: passedConfirmation.fixtureBuyCalls,
            })}`);
        }
        if (passedConfirmation.runningRows !== 0) {
            throw new Error('The automatic runner opened a contract before fresh confirmation passed.');
        }

        const payoutSkipped = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.runningRows === 0 &&
                    next.payoutSkipCount >= 1 &&
                    next.lastPayoutSkip.includes('quoted payout 1.60x is below the 1.80x floor')
                    ? next
                    : false;
            },
            'below-floor payout skipped before the next automatic attempt',
            5000,
            50,
        );
        if (payoutSkipped.runningRows !== 0 || !payoutSkipped.lastPayoutSkip.includes('quoted payout 1.60x is below the 1.80x floor')) {
            throw new Error(`The automatic runner did not skip the below-floor proposal cleanly: ${JSON.stringify(payoutSkipped)}`);
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
                return next.settledRows >= 1 && next.autoTrades >= 1
                    ? next
                    : false;
            },
            'automatic contract settlement',
            5000,
            50,
        );
        if (settled.settledRows < 1 || settled.autoTrades < 1) {
            throw new Error(`Settlement did not record the active position cleanly: ${JSON.stringify(settled)}`);
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
        const [rescannedCovered, rescannedDiscovered] = rescanned.coverage.split('/').map(value => Number(value.trim()));
        if (!rescannedCovered || !rescannedDiscovered || rescannedCovered !== rescannedDiscovered || !rescanned.modelPick) {
            throw new Error(`Settlement rescan did not cover the full fixture universe: ${JSON.stringify(rescanned)}`);
        }
        const multiMarketSettled = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.settledRows >= 2 && next.autoTrades >= 2 ? next : false;
            },
            'automatic runner checked the next qualified market',
            10000,
            50,
        );
        const executedSymbols = new Set(multiMarketSettled.journalSymbols);
        if (executedSymbols.size < 2 || multiMarketSettled.journalPrices.some(prices => prices.some(price => !price || price === '—'))) {
            throw new Error(`Sequential qualified-market execution did not record both markets with prices: ${JSON.stringify(multiMarketSettled)}`);
        }
        autoRunner = {
            status: 'passed',
            initialScanCount: initialAutoScanCount,
            rescanCount: Number(rescanned.scanCount),
            firstContract: firstRunning.runningRows,
            settledRows: multiMarketSettled.settledRows,
            sequentialMarkets: executedSymbols.size,
            payoutSkipped: {
                scanCount: Number(payoutSkipped.scanCount),
                runningRows: payoutSkipped.runningRows,
                message: payoutSkipped.lastPayoutSkip,
            },
        };
        runReport.fixture.autoRunner = autoRunner;

        await client.call('Page.navigate', {
            url: fixtureUrl(SAMPLE_WINDOWS[0], true, '', '', true),
        });
        await waitFor(
            () => client.evaluate('new URLSearchParams(window.location.search).get("alpha_scan_unavailable_contract") === "1"'),
            'unavailable-contract fallback fixture Alpha Tool',
        );
        const unavailableScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return ['ready', 'partial-data'].includes(next.status) ? next : false;
            },
            'unavailable-contract fallback fixture scan',
            90000,
        );
        assertScan(unavailableScan, SAMPLE_WINDOWS[0], 'fixture');
        await client.evaluate('document.querySelector("[data-testid=\\"toggle-auto-volatility\\"]")?.click()');
        const digitFallbackRunning = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.runningRows === 1 ? next : false;
            },
            'automatic digit contract after an unavailable route',
            10000,
            25,
        );
        const fallbackBuy = digitFallbackRunning.fixtureBuyCalls[0];
        const fallbackBuyAllowed = fallbackBuy &&
            ((['DIGITEVEN', 'DIGITODD'].includes(fallbackBuy.contractType) && fallbackBuy.barrier === null) ||
                (fallbackBuy.contractType === 'DIGITOVER' && ['1', '2', '3', '4', '5'].includes(String(fallbackBuy.barrier))) ||
                (fallbackBuy.contractType === 'DIGITUNDER' && ['4', '5', '6', '7', '8'].includes(String(fallbackBuy.barrier))));
        if (!fallbackBuyAllowed || digitFallbackRunning.digitFallbackCount < 1) {
            throw new Error(
                `Automatic fallback did not execute a whitelisted digit contract: ${JSON.stringify(digitFallbackRunning)}`,
            );
        }
        runReport.fixture.digitFallbackExecution = {
            status: 'passed',
            contractType: fallbackBuy.contractType,
            barrier: fallbackBuy.barrier,
            runningRows: digitFallbackRunning.runningRows,
        };

        await client.call('Page.navigate', {
            url: fixtureUrl(SAMPLE_WINDOWS[0], true, '', 'evidence-decay'),
        });
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
            'evidence-decay fixture Alpha Tool',
        );
        const reversalScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return ['ready', 'partial-data'].includes(next.status) ? next : false;
            },
            'evidence-decay fixture scan',
            90000,
        );
        assertScan(reversalScan, SAMPLE_WINDOWS[0], 'fixture');
        const initialEvidenceScanCount = Number(reversalScan.scanCount);
        await client.evaluate('document.querySelector("[data-testid=\\"toggle-auto-volatility\\"]")?.click()');
        const expiredEvidence = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.feedback.includes('The live 60-tick digit evidence no longer qualifies')
                    ? next
                    : false;
            },
            'live digit evidence invalidation',
            5000,
            50,
        );
        if (
            expiredEvidence.runningRows !== 0 ||
            expiredEvidence.settledRows !== 0 ||
            expiredEvidence.executionLeg !== 'idle' ||
            Number(expiredEvidence.autoTrades) !== 0
        ) {
            throw new Error(
                `Expired 60-tick evidence left an active or settled contract: ${JSON.stringify(expiredEvidence)}`,
            );
        }
        const evidenceRescan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return Number(next.scanCount) > initialEvidenceScanCount &&
                    ['ready', 'partial-data'].includes(next.status)
                    ? next
                    : false;
            },
            'complete rescan after live evidence expired',
            10000,
            50,
        );
        assertScan(evidenceRescan, SAMPLE_WINDOWS[0], 'fixture');
        if (evidenceRescan.runningRows !== 0 || Number(evidenceRescan.autoTrades) !== 0) {
            throw new Error(
                `The runner resumed execution before a new confirmation: ${JSON.stringify(evidenceRescan)}`,
            );
        }
        const resumedConfirmation = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.feedback.includes('Fresh digit confirmation 1/3') ||
                    ['primary-pending', 'primary-running'].includes(next.executionLeg) ||
                    Number(next.autoTrades) >= 1
                    ? next
                    : false;
            },
            'fresh confirmation after recovery rescan',
            10000,
            50,
        );
        if (
            Number(resumedConfirmation.autoTrades) === 0 &&
            (resumedConfirmation.runningRows !== 0 || !['primary-pending', 'primary-running'].includes(resumedConfirmation.executionLeg))
        ) {
            throw new Error(
                `The runner did not wait for a new valid confirmation: ${JSON.stringify(resumedConfirmation)}`,
            );
        }
        const recoveredRunning = resumedConfirmation.runningRows === 1
            ? resumedConfirmation
            : await waitFor(
                async () => {
                    const next = await getSnapshot(client.evaluate);
                    return next.runningRows === 1 ||
                        (next.autoVolatilityMode === 'false' && Number(next.autoTrades) >= 1)
                        ? next
                        : false;
                },
                'automatic runner resumed after failed confirmation',
                10000,
                50,
            );
        const confirmationRecovery = {
            status: 'passed',
            invalidationReason: 'live 60-tick evidence no longer qualified',
            initialScanCount: initialEvidenceScanCount,
            rescanCount: Number(evidenceRescan.scanCount),
            expiredCandidateRows: expiredEvidence.runningRows,
            resumedActiveRows: recoveredRunning.runningRows,
        };
        runReport.fixture.confirmationRecovery = confirmationRecovery;

        await client.call('Page.navigate', {
            url: fixtureUrl(SAMPLE_WINDOWS[0], true, '', '', false, true),
        });
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
            'recovery-toggle fixture Alpha Tool',
        );
        const recoveryOffScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return ['ready', 'partial-data'].includes(next.status) ? next : false;
            },
            'recovery-toggle fixture scan',
            90000,
        );
        assertScan(recoveryOffScan, SAMPLE_WINDOWS[0], 'fixture');
        await client.evaluate('document.querySelector("[data-testid=\\"toggle-recovery\\"]")?.click()');
        const disabledRecovery = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.recoveryEnabled === 'false' ? next : false;
            },
            'Recovery marker disabled',
        );
        if (disabledRecovery.recoveryEnabled !== 'false') {
            throw new Error(`Recovery marker did not turn off: ${JSON.stringify(disabledRecovery)}`);
        }
        await client.evaluate('document.querySelector("[data-testid=\\"toggle-auto-volatility\\"]")?.click()');
        const primaryLoss = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.settledRows >= 1 &&
                    next.autoTrades >= 1 &&
                    !next.journalLegs.includes('recovery') &&
                    !next.executionLeg.startsWith('recovery')
                    ? next
                    : false;
            },
            'primary loss with Recovery marker off',
            10000,
            25,
        );
        if (primaryLoss.journalLegs.includes('recovery') || primaryLoss.feedback.includes('Starting')) {
            throw new Error(`Recovery marker off still started a recovery contract: ${JSON.stringify(primaryLoss)}`);
        }
        await sleep(100);
        const afterRecoveryOffLoss = await getSnapshot(client.evaluate);
        if (
            afterRecoveryOffLoss.journalLegs.includes('recovery') ||
            afterRecoveryOffLoss.executionLeg === 'recovery-pending' ||
            afterRecoveryOffLoss.executionLeg === 'recovery-running'
        ) {
            throw new Error(`Recovery marker off entered a recovery state after the primary loss: ${JSON.stringify(afterRecoveryOffLoss)}`);
        }
        recoveryOff = {
            status: 'passed',
            recoveryEnabled: primaryLoss.recoveryEnabled,
            settledRows: primaryLoss.settledRows,
            recoveryRows: primaryLoss.journalLegs.filter(leg => leg === 'recovery').length,
            executionLeg: afterRecoveryOffLoss.executionLeg,
        };
        runReport.fixture.recoveryOff = recoveryOff;

        const nexusDirectionalExclusionResults = [];
        for (const nexusCase of [
            { fixture: 'nexus-call', label: 'rising-price fixture' },
            { fixture: 'nexus-put', label: 'falling-price fixture' },
        ]) {
            const nexusMomentumUrl = new URL(
                fixtureUrl(SAMPLE_WINDOWS[0], true, '', nexusCase.fixture),
            );
            nexusMomentumUrl.searchParams.set('alpha_scan_fixture_stake', '10');
            nexusMomentumUrl.searchParams.set('alpha_scan_fixture_stop_loss', '50');
            nexusMomentumUrl.searchParams.set('alpha_scan_fixture_target_profit', '50');
            nexusMomentumUrl.searchParams.set('alpha_scan_fixture_martingale', '2');
            nexusMomentumUrl.searchParams.set('alpha_scan_fixture_payout_floor', '1.5');
            await client.call('Page.navigate', { url: nexusMomentumUrl.toString() });
            await waitFor(
                () => client.evaluate(
                    `location.search.includes("alpha_scan_confirmation_fixture=${nexusCase.fixture}")`,
                ),
                `Nexus ${nexusCase.label} fixture navigation`,
            );
            await waitFor(
                () => client.evaluate(
                    `document.querySelector('[data-testid="alpha-tool"]')?.dataset.confirmationFixture === "${nexusCase.fixture}"`,
                ),
                `Nexus ${nexusCase.label} fixture mounted`,
            );
            await waitFor(
                () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
                `Nexus ${nexusCase.label} fixture Alpha Tool`,
            );
            const directionScan = await waitFor(
                async () => {
                    const next = await getSnapshot(client.evaluate);
                    return ['ready', 'partial-data'].includes(next.status) ? next : false;
                },
                `Nexus ${nexusCase.label} scan`,
                10000,
            );
            assertScan(directionScan, SAMPLE_WINDOWS[0], 'fixture');
            await client.evaluate('window.__alphaScanFixtureBuyCalls = []');
            await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
            await waitFor(
                () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "true"'),
                `Nexus ${nexusCase.label} session launch`,
            );
            await sleep(1800);
            const directionalFixture = await getSnapshot(client.evaluate);
            const isAllowedDigitBuy = buyCall =>
                (['DIGITEVEN', 'DIGITODD'].includes(buyCall.contractType) && buyCall.barrier === null) ||
                (buyCall.contractType === 'DIGITOVER' && ['1', '2', '3', '4', '5'].includes(String(buyCall.barrier))) ||
                (buyCall.contractType === 'DIGITUNDER' && ['4', '5', '6', '7', '8'].includes(String(buyCall.barrier)));
            const unsupportedBuys = directionalFixture.fixtureBuyCalls.filter(buyCall => !isAllowedDigitBuy(buyCall));
            if (unsupportedBuys.length) {
                throw new Error(
                    `Nexus ${nexusCase.label} submitted a Rise/Fall or unsupported digit contract: ${JSON.stringify(unsupportedBuys)}`,
                );
            }
            await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
            await waitFor(
                () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "false"'),
                `Nexus ${nexusCase.label} fixture stop`,
            );
            nexusDirectionalExclusionResults.push({
                fixture: nexusCase.fixture,
                executedContracts: directionalFixture.fixtureBuyCalls.map(buyCall => buyCall.contractType),
            });
        }
        runReport.fixture.nexusDirectionalExclusion = {
            status: 'passed',
            cases: nexusDirectionalExclusionResults,
        };

        const repeatedPriceUrl = new URL(
            fixtureUrl(SAMPLE_WINDOWS[0], true, '', 'repeated-price-ticks'),
        );
        repeatedPriceUrl.searchParams.set('alpha_scan_fixture_stake', '10');
        repeatedPriceUrl.searchParams.set('alpha_scan_fixture_stop_loss', '50');
        repeatedPriceUrl.searchParams.set('alpha_scan_fixture_target_profit', '50');
        repeatedPriceUrl.searchParams.set('alpha_scan_fixture_payout_floor', '1.5');
        await client.call('Page.navigate', { url: repeatedPriceUrl.toString() });
        await waitFor(
            () => client.evaluate(
                'document.querySelector(\'[data-testid="alpha-tool"]\')?.dataset.confirmationFixture === "repeated-price-ticks"',
            ),
            'Nexus repeated-price confirmation fixture mounted',
        );
        const repeatedPriceScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.status === 'ready' ? next : false;
            },
            'Nexus repeated-price confirmation scan',
            10000,
        );
        assertScan(repeatedPriceScan, SAMPLE_WINDOWS[0], 'fixture');
        await client.evaluate(`(() => {
            window.__nexusFeedbackHistory = [];
            window.addEventListener('nexus-ai-feedback', event => {
                const detail = event.detail;
                window.__nexusFeedbackHistory.push(typeof detail === 'string' ? detail : detail?.message || '');
            });
            window.__alphaScanFixtureBuyCalls = [];
        })()`);
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
        await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.fixtureBuyCalls.length >= 1 ? next : false;
            },
            'Nexus purchase after three repeated-price fresh ticks',
            12000,
            50,
        );
        const repeatedPriceExecution = await getSnapshot(client.evaluate);
        if (
            repeatedPriceExecution.fixtureBuyCalls.length !== 1 ||
            !repeatedPriceExecution.nexusFeedbackHistory.some(message => message.includes('Fresh 3/3 digit confirmation passed'))
        ) {
            throw new Error(
                `Nexus did not count three matching fresh ticks when quote prices repeated: ${JSON.stringify({
                    buyCalls: repeatedPriceExecution.fixtureBuyCalls,
                    feedback: repeatedPriceExecution.nexusFeedbackHistory,
                })}`,
            );
        }
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
        await waitFor(
            () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "false"'),
            'Nexus repeated-price fixture stop',
        );
        runReport.fixture.nexusRepeatedPriceConfirmation = {
            status: 'passed',
            repeatedQuoteTicks: 3,
            executedContract: repeatedPriceExecution.fixtureBuyCalls[0].contractType,
        };

        const intermittentPriceUrl = new URL(
            fixtureUrl(SAMPLE_WINDOWS[0], true, '', 'mismatch-then-match-ticks'),
        );
        intermittentPriceUrl.searchParams.set('alpha_scan_fixture_stake', '10');
        intermittentPriceUrl.searchParams.set('alpha_scan_fixture_stop_loss', '50');
        intermittentPriceUrl.searchParams.set('alpha_scan_fixture_target_profit', '50');
        intermittentPriceUrl.searchParams.set('alpha_scan_fixture_payout_floor', '1.5');
        fixtureStage = 'Nexus mismatch-then-match navigation';
        await client.call('Page.navigate', { url: intermittentPriceUrl.toString() });
        fixtureStage = 'Nexus mismatch-then-match fixture mount';
        await waitFor(
            () => client.evaluate(
                'document.querySelector(\'[data-testid="alpha-tool"]\')?.dataset.confirmationFixture === "mismatch-then-match-ticks"',
            ),
            'Nexus mismatch-then-match confirmation fixture mounted',
        );
        const intermittentPriceScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.status === 'ready' ? next : false;
            },
            'Nexus mismatch-then-match confirmation scan',
            10000,
        );
        assertScan(intermittentPriceScan, SAMPLE_WINDOWS[0], 'fixture');
        await client.evaluate(`(() => {
            window.__nexusFeedbackHistory = [];
            window.addEventListener('nexus-ai-feedback', event => {
                const detail = event.detail;
                window.__nexusFeedbackHistory.push(typeof detail === 'string' ? detail : detail?.message || '');
            });
            window.__alphaScanFixtureBuyCalls = [];
        })()`);
        fixtureStage = 'Nexus mismatch-then-match launch';
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
        fixtureStage = 'Nexus mismatch wait state';
        await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.nexusFeedbackHistory.some(message =>
                    message.includes('did not match') && message.includes('60-tick evidence still qualifies'),
                ) ? next : false;
            },
            'Nexus to retain an evidence-qualified candidate after one mismatching tick',
            10000,
            20,
        );
        const intermittentWaitingState = await getSnapshot(client.evaluate);
        const intermittentSessionActive = await client.evaluate(
            'document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "true"',
        );
        if (
            intermittentWaitingState.fixtureBuyCalls.length !== 0 ||
            !intermittentSessionActive ||
            intermittentWaitingState.nexusFeedbackHistory.some(message =>
                message.includes('Fresh digit confirmation failed'),
            )
        ) {
            throw new Error(
                `Nexus did not keep waiting safely after a mismatching live digit: ${JSON.stringify({
                    buyCalls: intermittentWaitingState.fixtureBuyCalls,
                    sessionActive: intermittentSessionActive,
                    feedback: intermittentWaitingState.nexusFeedbackHistory,
                })}`,
            );
        }
        fixtureStage = 'Nexus mismatch-then-match buy wait';
        await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.fixtureBuyCalls.length >= 1 ? next : false;
            },
            'Nexus purchase after three matching ticks following one mismatch',
            12000,
            20,
        );
        const intermittentExecution = await getSnapshot(client.evaluate);
        if (
            intermittentExecution.fixtureBuyCalls.length !== 1 ||
            !intermittentExecution.nexusFeedbackHistory.some(message =>
                message.includes('Fresh 3/3 digit confirmation passed'),
            ) ||
            intermittentExecution.nexusFeedbackHistory.some(message =>
                message.includes('Fresh digit confirmation failed'),
            )
        ) {
            throw new Error(
                `Nexus did not resume confirmation after the mismatch and wait for three matching ticks: ${JSON.stringify({
                    buyCalls: intermittentExecution.fixtureBuyCalls,
                    feedback: intermittentExecution.nexusFeedbackHistory,
                })}`,
            );
        }
        fixtureStage = 'Nexus mismatch-then-match fixture stop';
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
        await waitFor(
            () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "false"'),
            'Nexus mismatch-then-match fixture stop',
        );
        runReport.fixture.nexusMismatchThenMatchConfirmation = {
            status: 'passed',
            mismatchingFreshTicks: 1,
            matchingFreshTicksBeforePurchase: 3,
            executedContract: intermittentExecution.fixtureBuyCalls[0].contractType,
        };

        const nexusFallbackUrl = new URL(
            fixtureUrl(SAMPLE_WINDOWS[0], true, '', 'nexus-digits', true),
        );
        nexusFallbackUrl.searchParams.set('alpha_scan_fixture_stake', '10');
        nexusFallbackUrl.searchParams.set('alpha_scan_fixture_stop_loss', '50');
        nexusFallbackUrl.searchParams.set('alpha_scan_fixture_target_profit', '50');
        nexusFallbackUrl.searchParams.set('alpha_scan_fixture_payout_floor', '1.5');
        fixtureStage = 'Nexus fallback navigation';
        await client.call('Page.navigate', { url: nexusFallbackUrl.toString() });
        fixtureStage = 'Nexus fallback mount';
        await waitFor(
            () => client.evaluate('document.querySelector(\'[data-testid="alpha-tool"]\')?.dataset.confirmationFixture === "nexus-digits"'),
            'Nexus unavailable-route fallback fixture mounted',
        );
        fixtureStage = 'Nexus fallback scan';
        const nexusFallbackScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.status === 'ready' ? next : false;
            },
            'Nexus unavailable-route fallback scan',
            10000,
        );
        assertScan(nexusFallbackScan, SAMPLE_WINDOWS[0], 'fixture');
        fixtureStage = 'Nexus fallback listener setup';
        await client.evaluate(`(() => {
            window.__nexusFeedbackHistory = [];
            window.addEventListener('nexus-ai-feedback', event => {
                const detail = event.detail;
                window.__nexusFeedbackHistory.push(typeof detail === 'string' ? detail : detail?.message || '');
            });
            window.__alphaScanFixtureBuyCalls = [];
        })()`);
        fixtureStage = 'Nexus fallback launch';
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
        fixtureStage = 'Nexus fallback buy wait';
        await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return next.fixtureBuyCalls.length >= 1 ? next : false;
            },
            'Nexus same-market fallback after an unavailable contract',
            15000,
            50,
        );
        fixtureStage = 'Nexus fallback verification';
        const nexusFallbackExecution = await getSnapshot(client.evaluate);
        const fallbackMessage = nexusFallbackExecution.nexusFeedbackHistory.find(
            message => message.includes('is unavailable') && message.includes('Retrying once with'),
        );
        const nexusFallbackBuy = nexusFallbackExecution.fixtureBuyCalls[0];
        const nexusFallbackBuyAllowed = nexusFallbackBuy &&
            ((['DIGITEVEN', 'DIGITODD'].includes(nexusFallbackBuy.contractType) && nexusFallbackBuy.barrier === null) ||
                (nexusFallbackBuy.contractType === 'DIGITOVER' && ['1', '2', '3', '4', '5'].includes(String(nexusFallbackBuy.barrier))) ||
                (nexusFallbackBuy.contractType === 'DIGITUNDER' && ['4', '5', '6', '7', '8'].includes(String(nexusFallbackBuy.barrier))));
        if (
            !fallbackMessage ||
            !nexusFallbackBuyAllowed ||
            nexusFallbackExecution.nexusFeedbackHistory.some(message => message.includes('Fresh digit confirmation failed')) ||
            await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") !== "true"')
        ) {
            throw new Error(
                `Nexus did not retain its active state and retry one supported route after an unavailable contract: ${JSON.stringify({
                    retryMessage: fallbackMessage,
                    buyCalls: nexusFallbackExecution.fixtureBuyCalls,
                    feedback: nexusFallbackExecution.nexusFeedbackHistory,
                })}`,
            );
        }
        fixtureStage = 'Nexus fallback stop';
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
        await waitFor(
            () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "false"'),
            'Nexus unavailable-route fixture stop',
        );
        fixtureStage = 'fixture regression continuing';
        runReport.fixture.nexusUnsupportedRouteFallback = {
            status: 'passed',
            retriedOnSameSymbol: true,
            contractType: nexusFallbackBuy.contractType,
            barrier: nexusFallbackBuy.barrier,
        };

        const nexusSessionUrl = new URL(fixtureUrl(SAMPLE_WINDOWS[0], true, '', 'nexus-digits', false, true));
        nexusSessionUrl.searchParams.set('alpha_scan_fixture_stake', '10');
        nexusSessionUrl.searchParams.set('alpha_scan_fixture_stop_loss', '50');
        nexusSessionUrl.searchParams.set('alpha_scan_fixture_target_profit', '50');
        nexusSessionUrl.searchParams.set('alpha_scan_fixture_martingale', '2');
        await client.call('Page.navigate', { url: nexusSessionUrl.toString() });
        await waitFor(
            () => client.evaluate(
                'location.search.includes("alpha_scan_confirmation_fixture=nexus-digits") && ' +
                'location.search.includes("alpha_scan_recovery_fixture=loss")',
            ),
            'Nexus multi-market recovery fixture navigation',
        );
        await waitFor(
            () => client.evaluate(
                'document.querySelector("[data-testid=\\"alpha-tool\\"]")?.dataset.confirmationFixture === "nexus-digits"',
            ),
            'Nexus multi-market recovery fixture mounted',
        );
        await waitFor(
            () => client.evaluate('Boolean(document.querySelector("[data-testid=\\"alpha-tool\\"]"))'),
            'Nexus multi-market recovery fixture Alpha Tool',
        );
        const nexusScan = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                return ['ready', 'partial-data'].includes(next.status) ? next : false;
            },
            'Nexus multi-market recovery fixture scan',
            10000,
        );
        assertScan(nexusScan, SAMPLE_WINDOWS[0], 'fixture');
        const nexusRiskSettings = await client.evaluate(`(() => ({
            url: location.href,
            controls: [...document.querySelectorAll('select[aria-label]')]
                .filter(select => ['Stop loss', 'Target profit', 'Martingale'].includes(select.getAttribute('aria-label')))
                .map(select => ({ label: select.getAttribute('aria-label'), value: select.value })),
        }))()`);
        if (!['Stop loss:50', 'Target profit:50', 'Martingale:2'].every(expected => {
            const [label, value] = expected.split(':');
            return nexusRiskSettings.controls.some(control => control.label === label && control.value === value);
        })) {
            throw new Error(`Nexus fixture settings were not applied: ${JSON.stringify(nexusRiskSettings)}`);
        }
        await client.evaluate(`(() => {
            window.__nexusFeedbackHistory = [];
            window.addEventListener('nexus-ai-feedback', event => {
                const detail = event.detail;
                window.__nexusFeedbackHistory.push(typeof detail === 'string' ? detail : detail?.message || '');
            });
            window.__alphaScanFixtureBuyCalls = [];
        })()`);
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
        await waitFor(
            () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "true"'),
            'Nexus session launch',
        );
        let openWithHistorySnapshot = null;
        const nexusSession = await waitFor(
            async () => {
                const next = await getSnapshot(client.evaluate);
                if (
                    !openWithHistorySnapshot &&
                    next.runningRows > 0 &&
                    next.settledRows > 1
                ) {
                    openWithHistorySnapshot = next;
                }
                return next.journalLegs.length >= 3 && next.settledRows >= 3 &&
                    next.executionLeg === 'idle' && next.runningRows === 0
                    ? next
                    : false;
            },
            'Nexus primary, alternate-market recovery, and next primary entry',
            30000,
            50,
        );
        if (
            !openWithHistorySnapshot ||
            openWithHistorySnapshot.runningRows !== 1 ||
            openWithHistorySnapshot.journalGates.length < 1 ||
            !openWithHistorySnapshot.journalGates.includes('LOST') ||
            openWithHistorySnapshot.openProfitLoss !== '' ||
            !openWithHistorySnapshot.totalPnlAtTop ||
            !openWithHistorySnapshot.totalPnlDisplay.includes('Open Pending')
        ) {
            throw new Error(`P/L and settled journal history were not visible during an open trade: ${JSON.stringify({
                runningRows: openWithHistorySnapshot?.runningRows,
                visibleSettledGates: openWithHistorySnapshot?.journalGates,
                openProfitLoss: openWithHistorySnapshot?.openProfitLoss,
                pnlAtTop: openWithHistorySnapshot?.totalPnlAtTop,
                display: openWithHistorySnapshot?.totalPnlDisplay,
            })}`);
        }
        const nexusLegs = nexusSession.journalLegs.slice(0, 3);
        const nexusSymbols = nexusSession.journalSymbols.slice(0, 3);
        const nexusStakes = nexusSession.journalStakes.slice(0, 3);
        const nexusPurchaseCalls = nexusSession.fixtureBuyCalls.slice(0, 3);
        const initialPrimarySymbol = nexusPurchaseCalls[0]?.symbol;
        const recoverySymbol = nexusPurchaseCalls[1]?.symbol;
        const allowedNexusPurchase = purchase =>
            (['DIGITEVEN', 'DIGITODD'].includes(purchase.contractType) && purchase.barrier === null) ||
            (purchase.contractType === 'DIGITOVER' && ['1', '2', '3', '4', '5'].includes(String(purchase.barrier))) ||
            (purchase.contractType === 'DIGITUNDER' && ['4', '5', '6', '7', '8'].includes(String(purchase.barrier)));
        const nexusPrimaryLoss = Number(nexusSession.journalProfitValues[0]);
        if (
            nexusLegs.join(',') !== 'primary,recovery,primary' ||
            nexusPurchaseCalls.length < 3 ||
            recoverySymbol === initialPrimarySymbol ||
            nexusStakes.join(',') !== '10,20,10' ||
            !nexusPurchaseCalls.slice(0, 3).every(allowedNexusPurchase) ||
            !(nexusPurchaseCalls[1]?.payoutMultiplier > nexusPurchaseCalls[0]?.payoutMultiplier) ||
            !(nexusPurchaseCalls[1]?.projectedProfit >= Math.abs(nexusPrimaryLoss))
        ) {
            throw new Error(
                `Nexus did not use a better-paying, deficit-covering different-market recovery before returning to base stake: ${JSON.stringify({
                    legs: nexusLegs,
                    symbols: nexusSymbols,
                    purchases: nexusPurchaseCalls,
                    initialPrimarySymbol,
                    recoverySymbol,
                    stakes: nexusStakes,
                    primaryLoss: nexusPrimaryLoss,
                    gates: nexusSession.journalGates.slice(0, 3),
                    profits: nexusSession.journalProfits.slice(0, 3),
                    location: nexusSession.location,
                    feedbackHistory: nexusSession.nexusFeedbackHistory,
                    recoveryEnabled: nexusSession.nexusRecoveryEnabled,
                    feedback: nexusSession.feedback,
                })}`,
            );
        }
        const expectedNexusProfitLoss = nexusSession.journalProfitValues
            .slice(0, 3)
            .reduce((total, profit) => total + profit, 0);
        if (
            !nexusSession.totalPnlDisplay.includes('TOTAL PROFIT / LOSS') ||
            !nexusSession.totalPnlAtTop ||
            !Number.isFinite(nexusSession.totalProfitLoss) ||
            Math.abs(nexusSession.totalProfitLoss - expectedNexusProfitLoss) > 0.01
        ) {
            throw new Error(`Nexus total P/L does not match its settled journal: ${JSON.stringify({
                displayed: nexusSession.totalProfitLoss,
                expected: expectedNexusProfitLoss,
                journal: nexusSession.journalProfitValues.slice(0, 3),
                label: nexusSession.totalPnlDisplay,
            })}`);
        }
        await client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.click()');
        await waitFor(
            () => client.evaluate('document.querySelector("[data-testid=\\"nexus-launch-button\\"]")?.getAttribute("aria-pressed") === "false"'),
            'Nexus session stop after recovery regression',
        );
        await sleep(250);
        const nexusAfterStop = await getSnapshot(client.evaluate);
        if (
            nexusAfterStop.executionLeg !== 'idle' ||
            nexusAfterStop.journalLegs.length !== 3 ||
            !nexusAfterStop.feedback.includes('stopped manually') ||
            Math.abs(nexusAfterStop.totalProfitLoss - expectedNexusProfitLoss) > 0.01
        ) {
            throw new Error(`Nexus placed another contract after Stop: ${JSON.stringify(nexusAfterStop)}`);
        }
        runReport.fixture.nexusSession = {
            status: 'passed',
            legs: nexusLegs,
            symbols: nexusSymbols,
            purchases: nexusPurchaseCalls,
            stakes: nexusStakes,
            totalProfitLoss: nexusAfterStop.totalProfitLoss,
            stopMessage: nexusAfterStop.feedback,
        };

        const riskBoundaryCases = [
            { mode: 'target', stopMessage: 'Session target reached', settledRows: 2 },
            { mode: 'stop-loss', stopMessage: 'Session stop loss reached', settledRows: 1 },
            { mode: 'consecutive-losses', stopMessage: '3 consecutive losses reached', settledRows: 3 },
            { mode: 'trade-count', stopMessage: '50 trades reached for this session', settledRows: 50 },
        ];
        const riskBoundaries = [];
        for (const riskCase of riskBoundaryCases) {
            const riskUrl = new URL(fixtureUrl(SAMPLE_WINDOWS[0], true, riskCase.mode));
            riskUrl.searchParams.set('alpha_scan_fixture_target_profit', '15');
            riskUrl.searchParams.set('alpha_scan_fixture_stop_loss', '5');
            await client.call('Page.navigate', {
                url: riskUrl.toString(),
            });
            const expectedRiskUrl = JSON.stringify(riskUrl.toString());
            await waitFor(
                () => client.evaluate(`location.href === ${expectedRiskUrl} && document.readyState === 'complete'`),
                `${riskCase.mode} risk fixture navigation`,
                15000,
                50,
            );
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
            let stopped;
            try {
                stopped = await waitFor(
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
            } catch (error) {
                const latest = await getSnapshot(client.evaluate);
                throw new Error(`${error instanceof Error ? error.message : String(error)} Latest state: ${JSON.stringify(latest)}`);
            }
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
                mobileNexus: mobileNexusTest,
                autoRunner,
                digitFallbackExecution: runReport.fixture.digitFallbackExecution,
                confirmationRecovery,
                recoveryOff,
                nexusDirectionalExclusion: runReport.fixture.nexusDirectionalExclusion,
                nexusRepeatedPriceConfirmation: runReport.fixture.nexusRepeatedPriceConfirmation,
                nexusMismatchThenMatchConfirmation: runReport.fixture.nexusMismatchThenMatchConfirmation,
                nexusUnsupportedRouteFallback: runReport.fixture.nexusUnsupportedRouteFallback,
                nexusSession: runReport.fixture.nexusSession,
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
    const failureMessage = phase === 'external-feed' || !fixtureStage
        ? error.message
        : `${fixtureStage}: ${error.message}`;
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
            message: failureMessage,
        },
    };
    try {
        await persistReport(result);
    } catch (persistError) {
        console.error(`[alpha-scan-regression] Could not persist result to ${RESULT_PATH}: ${persistError.message}`);
    }
    console.error(`[alpha-scan-regression][${phase}] ${failureLabel}: ${failureMessage}`);
    process.exitCode = 1;
});
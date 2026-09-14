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
const freeBotXmlPath = join(projectDir, 'public', 'bots', 'Over2_Under7_Reversal.xml');
const chromiumPath = process.env.CHROMIUM_PATH || 'chromium';
const rootLabels = {
    trade_definition: 'Trade Parameters',
    before_purchase: 'Purchase Conditions',
    after_purchase: 'Restart Trading Conditions',
};
const requiredBlockTypes = {
    last_digits_condition: 4,
    apollo_purchase2: 4,
};
const requiredFreeBotBlockTypes = {
    variables_set_option: 1,
    variables_is_option: 1,
};
const emptySavedWorkspaceValue =
    '\u3686\uf044\u0960\u2660\u5c60\u5302\ud801\uc02e\u04f0\u2d01\u9c08\u601b\u8251\u603b\u80f6\u0138\u0d63\u8a78\u0c60\u9800\ud180\u1d9e\u4b3f\u0042\u00d9\ue76d\u5598\u001e\u49f9\uc306\u002f\u805d\u2000';

const browserApiMock = String.raw`
(() => {
    const accountId = 'VRTC-BINARY-MATRIX';
    window.__binaryMatrixBrowserErrors ||= [];
    window.addEventListener('error', event => {
        window.__binaryMatrixBrowserErrors.push({
            type: 'error',
            message: event.message || event.error?.message || 'Unknown browser error',
            source: event.filename || null,
            line: event.lineno || null,
        });
    });
    window.addEventListener('unhandledrejection', event => {
        window.__binaryMatrixBrowserErrors.push({
            type: 'unhandledrejection',
            message: event.reason?.stack || event.reason?.message || String(event.reason),
        });
    });
    const testState = (window.__binaryMatrixInterpreterTest ||= {
        analysisEvidence: [],
        buyRequests: [],
        contractCount: 0,
        conditionWindowIndex: 0,
        conditionEvaluations: [],
        conditionWindows: [
            [1001, 1003, 1005, 1007],
            [1003, 1005, 1007, 1009],
            [1005, 1007, 1009, 1011],
        ],
        errors: [],
        expectedBuyCount: 0,
        historyRequests: 0,
        latestEpoch: 910000,
        journalEvidence: [],
        outcomePlan: [],
        pendingConditionWindowIndex: null,
        reanalysisIntervals: [],
        reanalysisResets: [],
        requests: [],
        settledContractIds: [],
        settlementUpdates: [],
        stopRequested: false,
        winCount: 0,
    });
    window.addEventListener('error', event => {
        testState.errors.push({
            type: 'error',
            message: event.message,
            source: event.filename,
            line: event.lineno,
        });
    });
    window.addEventListener('unhandledrejection', event => {
        testState.errors.push({
            type: 'unhandledrejection',
            message: String(event.reason?.stack || event.reason || 'unknown rejection'),
        });
    });

    const captureUiEvidence = () => {
        const analysis = document.querySelector('.last-digits-analysis')?.textContent?.trim();
        if (analysis) {
            const key =
                String(testState.latestEpoch) +
                ':' +
                String(testState.conditionWindowIndex) +
                ':' +
                analysis;
            if (!testState.analysisEvidence.some(item => item.key === key)) {
                testState.analysisEvidence.push({
                    key,
                    epoch: testState.latestEpoch,
                    windowIndex: testState.conditionWindowIndex,
                    text: analysis,
                });
            }
        }
        const journal = document.querySelector('[data-testid="dt_mock_journal"]')?.innerText?.trim();
        if (journal && testState.journalEvidence.at(-1)?.text !== journal) {
            testState.journalEvidence.push({
                epoch: testState.latestEpoch,
                text: journal,
            });
        }
    };
    new MutationObserver(captureUiEvidence).observe(document, {
        childList: true,
        characterData: true,
        subtree: true,
    });
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
            testState.requests.push(Object.keys(request).filter(key => key !== 'req_id'));
            const response = { req_id: request.req_id, msg_type: Object.keys(request).find(key => key !== 'req_id') || 'ping' };
            let responseDelay = 0;
            if (request.authorize) {
                response.authorize = {
                    loginid: accountId,
                    balance: 1000,
                    currency: 'USD',
                    is_virtual: 1,
                    email: 'binary-matrix-test@example.invalid',
                    fullname: 'Binary Matrix Test',
                };
            } else if (request.balance) {
                response.balance = { balance: 1000, currency: 'USD', loginid: accountId };
            } else if (request.active_symbols) {
                response.active_symbols = [
                    {
                        symbol: 'R_25',
                        display_name: 'Volatility 25 Index',
                        market: 'synthetic_index',
                        submarket: 'random_index',
                        exchange_is_open: 1,
                        is_open: 1,
                        pip_size: 0,
                    },
                    {
                        symbol: 'R_100',
                        display_name: 'Volatility 100 Index',
                        market: 'synthetic_index',
                        submarket: 'random_index',
                        exchange_is_open: 1,
                        is_open: 1,
                        pip_size: 0,
                    },
                ];
            } else if (request.trading_times) {
                response.trading_times = {
                    markets: [
                        {
                            name: 'synthetic_index',
                            submarkets: [
                                {
                                    name: 'random_index',
                                    symbols: [
                                        {
                                            underlying_symbol: 'R_25',
                                            times: { open: ['00:00:00'], close: ['23:59:59'] },
                                        },
                                        {
                                            underlying_symbol: 'R_100',
                                            times: { open: ['00:00:00'], close: ['23:59:59'] },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                };
            } else if (request.contracts_for) {
                response.contracts_for = {
                    available: [
                        {
                            contract_category: 'digits',
                            contract_type: ['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER'],
                            exchange_name: 'synthetic_index',
                            expiry_type: 'tick',
                            min_duration: 1,
                            max_duration: 1,
                        },
                    ],
                };
            } else if (request.time) {
                response.time = Math.floor(Date.now() / 1000);
                if (testState.pendingConditionWindowIndex !== null) {
                    testState.latestEpoch += 1;
                    testState.conditionWindowIndex = testState.pendingConditionWindowIndex;
                    testState.pendingConditionWindowIndex = null;
                    testState.conditionEvaluations.push({
                        epoch: testState.latestEpoch,
                        windowIndex: testState.conditionWindowIndex,
                        source: 'fresh-tick',
                    });
                    setTimeout(() => {
                        this.dispatch('message', {
                            data: JSON.stringify({
                                msg_type: 'tick',
                                subscription: { id: 'binary-matrix-test-ticks-0' },
                                tick: {
                                    id: 'binary-matrix-test-time-tick-' + testState.latestEpoch,
                                    symbol: 'R_25',
                                    quote: 1000 + testState.latestEpoch,
                                    epoch: testState.latestEpoch,
                                },
                            }),
                        });
                    }, 0);
                }
            } else if (request.ticks_history) {
                const symbol = request.ticks_history === 'na' ? 'R_100' : request.ticks_history;
                const initialEpoch = testState.latestEpoch;
                response.msg_type = 'history';
                response.history = {
                    times: [initialEpoch - 3, initialEpoch - 2, initialEpoch - 1, initialEpoch],
                    prices: testState.conditionWindows[testState.conditionWindowIndex],
                };
                response.subscription = {
                    id: 'binary-matrix-test-ticks-' + testState.historyRequests,
                };
                testState.historyRequests += 1;
                // TicksService adds its listener after the history response resolves.
                // Emit the first live tick after that listener is installed so the
                // generated watch('before') loop can advance into its first buy.
                if (testState.historyRequests === 1) {
                    setTimeout(() => {
                        testState.latestEpoch = initialEpoch + 1;
                        if (testState.pendingConditionWindowIndex !== null) {
                            testState.conditionWindowIndex = testState.pendingConditionWindowIndex;
                            testState.pendingConditionWindowIndex = null;
                            testState.conditionEvaluations.push({
                                epoch: testState.latestEpoch,
                                windowIndex: testState.conditionWindowIndex,
                                source: 'fresh-tick',
                            });
                        }
                        this.dispatch('message', {
                            data: JSON.stringify({
                                msg_type: 'tick',
                                tick: {
                                    id: 'binary-matrix-test-tick-1',
                                    symbol,
                                    quote: 1009,
                                    epoch: testState.latestEpoch,
                                },
                            }),
                        });
                    }, 500);
                    setTimeout(() => {
                        testState.latestEpoch = initialEpoch + 2;
                        if (testState.pendingConditionWindowIndex !== null) {
                            testState.conditionWindowIndex = testState.pendingConditionWindowIndex;
                            testState.pendingConditionWindowIndex = null;
                            testState.conditionEvaluations.push({
                                epoch: testState.latestEpoch,
                                windowIndex: testState.conditionWindowIndex,
                                source: 'fresh-tick',
                            });
                        }
                        this.dispatch('message', {
                            data: JSON.stringify({
                                msg_type: 'tick',
                                tick: {
                                    id: 'binary-matrix-test-tick-2',
                                    symbol,
                                    quote: 1011,
                                    epoch: testState.latestEpoch,
                                },
                            }),
                        });
                    }, 1500);
                }
            } else if (request.proposal) {
                response.proposal = { id: 'binary-matrix-test-proposal', ask_price: 1, payout: 1.96 };
            } else if (request.buy) {
                if (
                    testState.expectedBuyCount > 0 &&
                    testState.buyRequests.length >= testState.expectedBuyCount
                ) {
                    // Let the final settlement drive one fresh post-reset
                    // condition scan, but never open an unplanned contract.
                    testState.extraBuyAttempts = (testState.extraBuyAttempts || 0) + 1;
                    setTimeout(() => {
                        testState.stopRequested = true;
                        document.querySelector('#db-animation__stop-button')?.click();
                    }, 0);
                    return;
                }
                const contractId = ++testState.contractCount;
                const symbol = request.parameters?.underlying_symbol || 'R_25';
                const openContractsAtBuy = testState.buyRequests.filter(
                    item => !testState.settledContractIds.includes(item.contractId)
                ).length;
                testState.buyRequests.push({
                    symbol,
                    epoch: testState.latestEpoch,
                    contractId,
                    contractType: request.parameters?.contract_type || null,
                    amount: Number(request.parameters?.amount ?? request.price ?? 0),
                    conditionWindowIndex: testState.conditionWindowIndex,
                    openContractsAtBuy,
                });
                response.buy = { contract_id: contractId, buy_price: request.price || 0.5, payout: 1.96 };
            } else if (request.proposal_open_contract) {
                const contractId = Number(request.contract_id);
                const buy = testState.buyRequests.find(item => item.contractId === contractId);
                const isFast = window.localStorage.getItem('dbot_execution_speed') === 'fast';
                const result = testState.outcomePlan[contractId - 1] || 'loss';
                const isWinningContract = result === 'win';
                const shouldSettle = true;
                responseDelay = isFast ? 70 : 0;
                if (shouldSettle && !testState.settledContractIds.includes(contractId)) {
                    testState.settledContractIds.push(contractId);
                    if (isWinningContract) testState.winCount += 1;
                    testState.settlementUpdates.push({
                        contractId,
                        epoch: testState.latestEpoch + (isFast ? 1 : 0),
                        result,
                        profit: isWinningContract ? 1 : -0.25,
                        buyCountAtSettlement: testState.buyRequests.length,
                    });
                    if (isWinningContract && testState.winCount % 3 === 0) {
                        const nextWindowIndex = Math.min(
                            testState.conditionWindowIndex + 1,
                            testState.conditionWindows.length - 1
                        );
                        testState.reanalysisResets.push({
                            afterContractId: contractId,
                            settlementEpoch: testState.latestEpoch,
                            preResetWindowIndex: testState.conditionWindowIndex,
                            nextWindowIndex,
                        });
                        testState.pendingConditionWindowIndex = nextWindowIndex;
                    }
                }
                response.proposal_open_contract = {
                    contract_id: contractId,
                    contract_type: buy?.contractType || 'DIGITEVEN',
                    is_sold: shouldSettle ? 1 : 0,
                    is_expired: shouldSettle ? 1 : 0,
                    is_valid_to_sell: 0,
                    buy_price: 0.5,
                    sell_price: shouldSettle && isWinningContract ? 1.5 : 0.25,
                    profit: shouldSettle && isWinningContract ? 1 : -0.25,
                    status: isWinningContract ? 'won' : 'lost',
                    currency: 'USD',
                    transaction_ids: {
                        buy: 'buy-' + contractId,
                        sell: 'sell-' + contractId,
                    },
                    entry_tick_time: testState.latestEpoch,
                    exit_tick_time: testState.latestEpoch,
                    entry_tick: 1007,
                    exit_tick: 1008,
                };
                // Settlement is delivered before the next purchase in both
                // modes so result-dependent stake logic is deterministic.
                const settledEpoch = testState.latestEpoch;
                const hasPendingReanalysis = testState.pendingConditionWindowIndex !== null;
                setTimeout(() => {
                    testState.latestEpoch = settledEpoch + 1;
                    if (testState.pendingConditionWindowIndex !== null) {
                        testState.conditionWindowIndex = testState.pendingConditionWindowIndex;
                        testState.pendingConditionWindowIndex = null;
                        testState.conditionEvaluations.push({
                            epoch: testState.latestEpoch,
                            windowIndex: testState.conditionWindowIndex,
                            source: 'fresh-tick',
                        });
                    }
                    this.dispatch('message', {
                        data: JSON.stringify({
                            msg_type: 'tick',
                            tick: {
                                id: 'binary-matrix-test-tick-' + testState.latestEpoch,
                                symbol: buy?.symbol || 'R_25',
                                quote: 1003,
                                epoch: testState.latestEpoch,
                            },
                        }),
                    });
                }, hasPendingReanalysis ? 1_500 : 60);
                if (!isFast && contractId !== 2) {
                    setTimeout(() => {
                        testState.latestEpoch = settledEpoch + 2;
                        if (testState.pendingConditionWindowIndex !== null) {
                            testState.conditionWindowIndex = testState.pendingConditionWindowIndex;
                            testState.pendingConditionWindowIndex = null;
                            testState.conditionEvaluations.push({
                                epoch: testState.latestEpoch,
                                windowIndex: testState.conditionWindowIndex,
                                source: 'fresh-tick',
                            });
                        }
                        this.dispatch('message', {
                            data: JSON.stringify({
                                msg_type: 'tick',
                                tick: {
                                    id: 'binary-matrix-test-tick-' + testState.latestEpoch,
                                    symbol: buy?.symbol || 'R_25',
                                    quote: 1004,
                                    epoch: testState.latestEpoch,
                                },
                            }),
                        });
                    }, hasPendingReanalysis ? 2_500 : 120);
                }
                if (hasPendingReanalysis) {
                    const reanalysisInterval = setInterval(() => {
                        if (
                            testState.stopRequested ||
                            testState.buyRequests.length > contractId
                        ) {
                            clearInterval(reanalysisInterval);
                            return;
                        }
                        if (testState.pendingConditionWindowIndex !== null) {
                            testState.latestEpoch += 1;
                            testState.conditionWindowIndex = testState.pendingConditionWindowIndex;
                            testState.pendingConditionWindowIndex = null;
                            testState.conditionEvaluations.push({
                                epoch: testState.latestEpoch,
                                windowIndex: testState.conditionWindowIndex,
                                source: 'fresh-tick',
                            });
                        }
                            testState.latestEpoch += 1;
                            this.dispatch('message', {
                                data: JSON.stringify({
                                    msg_type: 'tick',
                                    tick: {
                                        id: 'binary-matrix-test-reanalysis-tick-' + testState.latestEpoch,
                                        symbol: buy?.symbol || 'R_25',
                                        quote: 1000 + testState.latestEpoch,
                                        epoch: testState.latestEpoch,
                                    },
                                }),
                            });
                    }, 100);
                    testState.reanalysisIntervals.push(reanalysisInterval);
                }
            } else if (request.portfolio) {
                response.portfolio = { contracts: [] };
            }
            setTimeout(() => this.dispatch('message', { data: JSON.stringify(response) }), responseDelay);
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
            } else if (message.method === 'Runtime.consoleAPICalled') {
                const text = message.params.args
                    ?.map(argument => argument.value ?? argument.description ?? '')
                    .join(' ');
                if (text) console.error(`Browser console.${message.params.type}: ${text}`);
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
    let result;
    try {
        result = await evaluate(
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
    } catch (error) {
        const pageState = await evaluate(
            cdp,
            `JSON.stringify({
                url: location.href,
                readyState: document.readyState,
                title: document.title,
                body: document.body?.innerText?.slice(0, 1600),
                 errors: window.__binaryMatrixInterpreterTest?.errors,
                apiRequests: window.__binaryMatrixInterpreterTest?.requests,
                testEpoch: window.__binaryMatrixInterpreterTest?.latestEpoch,
                buyRequests: window.__binaryMatrixInterpreterTest?.buyRequests,
                analysisEvidence: window.__binaryMatrixInterpreterTest?.analysisEvidence,
                reanalysisResets: window.__binaryMatrixInterpreterTest?.reanalysisResets,
                conditionWindowIndex: window.__binaryMatrixInterpreterTest?.conditionWindowIndex,
                generatedCode: window.__binaryMatrixInterpreterTest?.generatedCode?.slice(0, 5000),
                browserErrors: window.__binaryMatrixBrowserErrors,
                recentResources: performance.getEntriesByType('resource').map(entry => entry.name).slice(-30),
                 resources: performance.getEntriesByType('resource')
                     .map(entry => entry.name)
                     .filter(name => name.includes('.js') || name.includes('.css'))
                     .slice(-30),
                buttons: Array.from(document.querySelectorAll('button')).map(button => ({
                    text: button.textContent.trim(),
                    visible: Boolean(button.getClientRects().length),
                    disabled: button.disabled
                })).slice(0, 40)
            })`
        );
        throw new Error(`${error.message}; page state: ${pageState}`);
    }
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
    const buttonInfo = await evaluate(
        cdp,
        `(() => {
            const button = Array.from(document.querySelectorAll('button')).find(
                candidate => candidate.getClientRects().length > 0 && candidate.textContent.includes(${JSON.stringify(text)})
            );
            if (!button) return null;
            button.scrollIntoView({ block: 'center', inline: 'center' });
            const rect = button.getBoundingClientRect();
            return {
                disabled: button.disabled,
                text: button.textContent.trim(),
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            };
        })()`
    );
    if (!buttonInfo) throw new Error(`Could not locate visible button containing "${text}" after waiting.`);
    if (buttonInfo.disabled) throw new Error(`Button containing "${text}" is disabled.`);
    await evaluate(
        cdp,
        `(() => {
            const button = Array.from(document.querySelectorAll('button')).find(
                candidate => candidate.getClientRects().length > 0 && candidate.textContent.includes(${JSON.stringify(text)})
            );
            button?.click();
            return Boolean(button);
        })()`
    );
};

const clickButtonInCard = async (cdp, cardTitle, buttonText) => {
    await waitFor(
        cdp,
        `Array.from(document.querySelectorAll('.free-bots__card')).some(card => {
            const title = card.querySelector('.free-bots__card-name')?.textContent || '';
            return title.includes(${JSON.stringify(cardTitle)}) &&
                Array.from(card.querySelectorAll('button')).some(button =>
                    button.getClientRects().length > 0 && button.textContent.includes(${JSON.stringify(buttonText)})
                );
        })`,
        `${cardTitle} card`
    );
    await evaluate(
        cdp,
        `(() => {
            const card = Array.from(document.querySelectorAll('.free-bots__card')).find(candidate =>
                (candidate.querySelector('.free-bots__card-name')?.textContent || '').includes(${JSON.stringify(cardTitle)})
            );
            const button = Array.from(card?.querySelectorAll('button') || []).find(candidate =>
                candidate.getClientRects().length > 0 && candidate.textContent.includes(${JSON.stringify(buttonText)})
            );
            if (!card || !button) throw new Error(${JSON.stringify(`Could not locate ${buttonText} for ${cardTitle}.`)});
            card.scrollIntoView({ block: 'center', inline: 'nearest' });
            button.click();
            return true;
        })()`
    );
};

const dismissSocialPopup = async cdp => {
    const dismissed = await evaluate(
        cdp,
        `(() => {
            const dismiss = document.querySelector('.slx-popup__dismiss');
            dismiss?.click();
            return Boolean(dismiss);
        })()`
    );
    if (dismissed) await sleep(500);
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
                allBlockTypes: workspace.getAllBlocks?.(true).reduce((counts, block) => {
                    counts[block.type] = (counts[block.type] || 0) + 1;
                    return counts;
                }, {}),
                scrollX: Number.isFinite(workspace.scrollX) ? workspace.scrollX : null,
                scrollY: Number.isFinite(workspace.scrollY) ? workspace.scrollY : null,
                scrollbarY: workspace.scrollbar?.getY?.() ?? null,
                viewTop: metrics.viewTop ?? null,
                contentTop: metrics.contentTop ?? null,
            };
        })()`
    );
};

const assertMobileWorkspaceOrigin = (snapshot, flowName, phase) => {
    if (!snapshot) throw new Error(`${flowName} ${phase}: Blockly workspace is unavailable.`);

    const firstRoot = snapshot.roots.find(root => root.type === 'trade_definition');
    const topmostRootY = Math.min(...snapshot.roots.map(root => root.y));
    if (
        snapshot.scrollX === null ||
        snapshot.scrollY === null ||
        snapshot.scrollX > 1 ||
        snapshot.scrollY > 1 ||
        !firstRoot ||
        firstRoot.y !== topmostRootY
    ) {
        throw new Error(
            `${flowName} ${phase}: mobile workspace did not keep the first root visible ` +
                `(scrollX=${snapshot.scrollX}, scrollY=${snapshot.scrollY}, scrollbarY=${snapshot.scrollbarY}, ` +
                `viewTop=${snapshot.viewTop}, contentTop=${snapshot.contentTop}, ` +
                `firstRootY=${firstRoot?.y ?? 'missing'}, roots=${JSON.stringify(snapshot.roots)})`
        );
    }
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
        const pageState = await evaluate(
            cdp,
            `JSON.stringify({
                url: location.href,
                hash: location.hash,
                activeTab: document.querySelector('[aria-selected="true"]')?.textContent?.trim() || null,
                binaryCard: document.querySelector('.free-bots__card')?.innerText?.slice(0, 500) || null,
                errors: Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
                    .map(element => element.textContent?.trim())
                    .filter(Boolean)
                    .slice(0, 10),
                body: document.body?.innerText?.slice(-1200),
            })`
        );
        throw new Error(`${error.message}; ${flowName} snapshot=${JSON.stringify(snapshot)}; page=${pageState}`);
    }
    await evaluate(
        cdp,
        `document.querySelector('#scratch_div')?.scrollIntoView({ block: 'start', inline: 'nearest' })`
    );
    assertMobileWorkspaceOrigin(await workspaceSnapshot(cdp), flowName, 'after import');

    // The real Deriv API can finish dropdown validation several seconds after
    // Blockly imports the XML. Verify the settled mobile viewport, not only
    // the first post-import layout.
    await sleep(6_800);

    const snapshot = await workspaceSnapshot(cdp);
    if (!snapshot) throw new Error(`${flowName}: Blockly workspace is unavailable.`);

    const expectedTypes = Object.keys(rootLabels);
    const actualTypes = snapshot.roots.map(root => root.type);
    for (const type of expectedTypes) {
        if (!actualTypes.includes(type)) {
            throw new Error(`${flowName}: missing ${rootLabels[type]} (${type}); roots were ${actualTypes.join(', ')}`);
        }
    }
    for (const [type, minimum] of Object.entries(requiredBlockTypes)) {
        const actualCount = snapshot.allBlockTypes?.[type] || 0;
        if (actualCount < minimum) {
            throw new Error(
                `${flowName}: expected at least ${minimum} ${type} blocks, found ${actualCount}; ` +
                `inventory=${JSON.stringify(snapshot.allBlockTypes)}`
            );
        }
    }

    const firstRoot = snapshot.roots.find(root => root.type === 'trade_definition');
    assertMobileWorkspaceOrigin(snapshot, flowName, 'after delayed dropdown settling');

    console.log(
        `✓ ${flowName}: ${expectedTypes.map(type => rootLabels[type]).join(', ')}; ` +
            `mobile scrollX=${snapshot.scrollX}, scrollY=${snapshot.scrollY}, firstRootY=${firstRoot.y}`
    );
};

const assertFreeBotWorkspace = async (cdp, flowName) => {
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
        const pageState = await evaluate(
            cdp,
            `JSON.stringify({
                url: location.href,
                hash: location.hash,
                activeTab: document.querySelector('[aria-selected="true"]')?.textContent?.trim() || null,
                errors: Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
                    .map(element => element.textContent?.trim())
                    .filter(Boolean)
                    .slice(0, 10),
                body: document.body?.innerText?.slice(-1200),
            })`
        );
        throw new Error(`${error.message}; ${flowName} snapshot=${JSON.stringify(snapshot)}; page=${pageState}`);
    }

    // Option dropdown validation and the Deriv API cascade can mutate the
    // workspace several seconds after domToBlock returns. Verify the selected
    // Free Bot after that settling window, not only the initial import.
    await sleep(6_800);

    const snapshot = await workspaceSnapshot(cdp);
    if (!snapshot) throw new Error(`${flowName}: Blockly workspace is unavailable.`);

    const actualTypes = snapshot.roots.map(root => root.type);
    for (const type of Object.keys(rootLabels)) {
        if (!actualTypes.includes(type)) {
            throw new Error(`${flowName}: missing ${rootLabels[type]} (${type}); roots were ${actualTypes.join(', ')}`);
        }
    }

    for (const [type, minimum] of Object.entries(requiredFreeBotBlockTypes)) {
        const actualCount = snapshot.allBlockTypes?.[type] || 0;
        if (actualCount < minimum) {
            throw new Error(
                `${flowName}: expected serialized ${type} blocks, found ${actualCount}; ` +
                    `inventory=${JSON.stringify(snapshot.allBlockTypes)}`
            );
        }
    }

    const totalBlockCount = Object.values(snapshot.allBlockTypes || {}).reduce(
        (total, count) => total + count,
        0
    );
    if (totalBlockCount <= 7) {
        throw new Error(
            `${flowName}: workspace reverted to the seven-block default (${totalBlockCount} blocks); ` +
                `inventory=${JSON.stringify(snapshot.allBlockTypes)}`
        );
    }

    console.log(
        `✓ ${flowName}: ${Object.keys(rootLabels).map(type => rootLabels[type]).join(', ')}; ` +
            `option blocks=${Object.entries(requiredFreeBotBlockTypes)
                .map(([type]) => `${type}:${snapshot.allBlockTypes[type]}`)
                .join(', ')}; total blocks=${totalBlockCount}`
    );
};

const runGeneratedBinaryMatrixBot = async (cdp, speed) => {
    await evaluate(
        cdp,
        `(() => {
            const state = window.__binaryMatrixInterpreterTest;
            const isFast = ${JSON.stringify(speed)} === 'fast';
            state.buyRequests = [];
            state.contractCount = 0;
            state.analysisEvidence = [];
            state.conditionWindowIndex = 0;
            state.conditionEvaluations = [];
            state.historyRequests = 0;
            state.latestEpoch = 910000;
            state.journalEvidence = [];
            state.outcomePlan = isFast
                ? ['loss', 'loss', 'win', 'loss']
                : ['loss', 'win', 'loss', 'win', 'loss', 'win', 'loss', 'win', 'loss', 'win', 'loss', 'win'];
            state.expectedBuyCount = state.outcomePlan.length;
            state.pendingConditionWindowIndex = null;
            state.reanalysisIntervals?.forEach(clearInterval);
            state.reanalysisIntervals = [];
            state.reanalysisResets = [];
            state.requests = [];
            state.settledContractIds = [];
            state.settlementUpdates = [];
            state.stopRequested = false;
            state.winCount = 0;
            const speedSwitch = document.querySelector('.animation__speed-switch');
            const shouldBeFast = isFast;
            if (Boolean(speedSwitch?.getAttribute('aria-checked') === 'true') !== shouldBeFast) {
                speedSwitch?.click();
            }
            return true;
        })()`
    );
    await waitFor(
        cdp,
        `document.querySelector('.animation__speed-switch')?.getAttribute('aria-checked') === ${JSON.stringify(
            speed === 'fast' ? 'true' : 'false'
        )} &&
         window.localStorage.getItem('dbot_execution_speed') === ${JSON.stringify(speed)}`,
        `${speed.toUpperCase()} execution switch state`
    );

    const generatedCode = await evaluate(
        cdp,
        `(() => {
            const generator = window.Blockly?.JavaScript?.javascriptGenerator;
            const workspace = window.Blockly?.derivWorkspace;
            if (!generator || !workspace) throw new Error('Blockly generator or workspace is unavailable.');
            const code = generator.workspaceToCode(workspace);
            window.__binaryMatrixInterpreterTest.generatedCode = code;
            return code;
        })()`
    );
    if (!generatedCode?.includes("Bot.purchase('DIGITEVEN'")) {
        throw new Error('workspaceToCode did not generate the Binary Matrix purchase callbacks.');
    }
    if (!generatedCode.includes('Bot.isTradeAgain(true)')) {
        throw new Error('workspaceToCode did not generate the trade_again callback.');
    }
    console.log(`✓ Binary Matrix XML converted through Blockly workspaceToCode (${speed.toUpperCase()})`);

    await evaluate(
        cdp,
        `(() => {
            const runButton = document.querySelector('#db-animation__run-button');
            if (!runButton || runButton.disabled) throw new Error('DBot Run button is unavailable or disabled.');
            runButton.click();
            return true;
        })()`
    );
    const scenarioBuyCount = speed === 'fast' ? 4 : 12;
    await waitFor(
        cdp,
        `window.__binaryMatrixInterpreterTest?.buyRequests?.length >= ${scenarioBuyCount}`,
        `${scenarioBuyCount} generated Binary Matrix buy requests`,
        speed === 'slow' ? 90_000 : 30_000
    );
    await waitFor(
        cdp,
        `window.__binaryMatrixInterpreterTest?.settlementUpdates?.length >= ${scenarioBuyCount}`,
        `${speed.toUpperCase()} contract settlement updates`,
        10_000
    );
    if (speed === 'slow') {
        await waitFor(
            cdp,
            `window.__binaryMatrixInterpreterTest?.conditionEvaluations?.some(
                evaluation => evaluation.windowIndex === 2 &&
                    evaluation.epoch > window.__binaryMatrixInterpreterTest.reanalysisResets[1]?.settlementEpoch
            )`,
            'SLOW final fresh condition evaluation',
            10_000
        );
    }
    await evaluate(cdp, `document.querySelector('#db-animation__stop-button')?.click()`);
    await evaluate(cdp, `document.querySelector('#db-run-panel-tab__journal')?.click()`);
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="dt_mock_journal"]'))`, `${speed.toUpperCase()} Journal`);
    await sleep(250);

    const result = await evaluate(
        cdp,
        `JSON.stringify({
            speed: window.localStorage.getItem('dbot_execution_speed'),
            buyRequests: window.__binaryMatrixInterpreterTest.buyRequests,
            settledContractIds: window.__binaryMatrixInterpreterTest.settledContractIds,
            settlementUpdates: window.__binaryMatrixInterpreterTest.settlementUpdates,
            analysisEvidence: window.__binaryMatrixInterpreterTest.analysisEvidence,
            conditionEvaluations: window.__binaryMatrixInterpreterTest.conditionEvaluations,
            journalEvidence: window.__binaryMatrixInterpreterTest.journalEvidence,
            reanalysisResets: window.__binaryMatrixInterpreterTest.reanalysisResets,
            generatedCode: window.__binaryMatrixInterpreterTest.generatedCode,
            journalText: document.querySelector('[data-testid="dt_mock_journal"]')?.innerText || '',
            running: Boolean(document.querySelector('#db-animation__stop-button'))
        })`
    );
    const {
        analysisEvidence,
        conditionEvaluations,
        buyRequests,
        journalEvidence,
        journalText,
        reanalysisResets,
        settledContractIds,
        settlementUpdates,
    } = JSON.parse(result);
    const epochs = buyRequests.map(request => request.epoch);
    const amounts = buyRequests.map(request => request.amount);
    const settlementResultsByContractId = new Map(
        settlementUpdates.map(update => [update.contractId, update.result])
    );
    const settlementResults = buyRequests.map(request => settlementResultsByContractId.get(request.contractId));
    const boughtContractIds = new Set(buyRequests.map(request => request.contractId));
    const settlementOrder = settlementUpdates.map(update => update.contractId);
    const expectedAmounts = speed === 'fast'
        ? [0.5, 1, 2, 0.5]
        : Array.from({ length: scenarioBuyCount }, (_, index) => (index % 2 === 0 ? 0.5 : 1));
    const expectedResults = speed === 'fast'
        ? ['loss', 'loss', 'win', 'loss']
        : ['loss', 'win', 'loss', 'win', 'loss', 'win', 'loss', 'win', 'loss', 'win', 'loss', 'win'];
    const strictlyIncreasingFreshEpochs =
        epochs.length > 1 && epochs.every((epoch, index) => index === 0 || epoch > epochs[index - 1]);
    const eachPurchaseFollowedSettlement = buyRequests.every((request, index) => {
        if (index === 0) return true;
        const previousSettlement = settlementUpdates.find(update => update.contractId === buyRequests[index - 1]?.contractId);
        return previousSettlement?.buyCountAtSettlement === index;
    });
    const expectedResetCount = speed === 'fast' ? 0 : 2;
    const postResetPurchases = reanalysisResets.map(reset =>
        buyRequests.find(request => request.contractId > reset.afterContractId)
    );
    const postResetPurchaseExpectations = reanalysisResets
        .filter(reset => reset.afterContractId < scenarioBuyCount)
        .map(reset => ({
            reset,
            purchase: buyRequests.find(request => request.contractId > reset.afterContractId),
        }));
    const postResetAnalyses = reanalysisResets.map(reset =>
        conditionEvaluations.find(
            evaluation =>
                evaluation.epoch > reset.settlementEpoch &&
                evaluation.windowIndex === reset.nextWindowIndex
        )
    );
    const postResetPurchasesUseFreshWindows = postResetPurchaseExpectations.every(({ reset, purchase }) => {
        return Boolean(
            purchase &&
            purchase.epoch > reset.settlementEpoch &&
            purchase.conditionWindowIndex === reset.nextWindowIndex
        );
    });
    const postResetAnalysesAreFresh = reanalysisResets.every((reset, index) => {
        const analysis = postResetAnalyses[index];
        return Boolean(analysis && analysis.epoch > reset.settlementEpoch);
    });
    const hasJournalAnalysisEvidence =
        journalText.includes('Last Digits Analysis Market:') ||
        journalEvidence.some(entry => entry.text.includes('Last Digits Analysis Market:'));
    const hasJournalTradeEvidence =
        journalText.includes('WIN') ||
        journalText.includes('LOSS') ||
        journalText.includes('Profit amount:') ||
        journalText.includes('Loss amount:') ||
        journalEvidence.some(
            entry =>
                entry.text.includes('WIN') ||
                entry.text.includes('LOSS') ||
                entry.text.includes('Profit amount:') ||
                entry.text.includes('Loss amount:')
        );
    if (
        buyRequests.length !== scenarioBuyCount ||
        buyRequests.some(request => request.symbol !== 'R_25') ||
        !strictlyIncreasingFreshEpochs ||
        settledContractIds.length !== scenarioBuyCount ||
        new Set(settledContractIds).size !== scenarioBuyCount ||
        settledContractIds.some(contractId => !boughtContractIds.has(contractId)) ||
        settlementUpdates.length !== scenarioBuyCount ||
        new Set(settlementUpdates.map(update => update.contractId)).size !== scenarioBuyCount ||
        settlementUpdates.some(update => !boughtContractIds.has(update.contractId)) ||
        amounts.some((amount, index) => amount !== expectedAmounts[index]) ||
        settlementResults.some((result, index) => result !== expectedResults[index]) ||
        buyRequests.some(request => request.openContractsAtBuy !== 0) ||
        settlementOrder.join(',') !== Array.from({ length: scenarioBuyCount }, (_, index) => index + 1).join(',') ||
        !eachPurchaseFollowedSettlement ||
        reanalysisResets.length !== expectedResetCount ||
        (speed === 'slow' && reanalysisResets.some((reset, index) =>
            reset.afterContractId !== [6, 12][index]
        )) ||
        (speed === 'slow' && (!postResetPurchasesUseFreshWindows || !postResetAnalysesAreFresh)) ||
        (speed === 'slow' && (!hasJournalAnalysisEvidence || !hasJournalTradeEvidence))
    ) {
        throw new Error(
            `${speed.toUpperCase()} generated interpreter loop produced unexpected lifecycle: ` +
                `${JSON.stringify({
                    buyRequests,
                    settledContractIds,
                    settlementUpdates,
                    analysisEvidence,
                    journalEvidence,
                    journalText,
                    reanalysisResets,
                    postResetPurchases,
                    postResetAnalyses,
                })}`
        );
    }
    console.log(
        `✓ ${speed.toUpperCase()} generated interpreter loop preserved its cadence ` +
            `(${buyRequests.map(request => `${request.symbol}@${request.epoch}`).join(', ')}) ` +
            `with stakes ${amounts.join(' → ')} and results ${settlementResults.join(' → ')} ` +
            `with ${buyRequests.reduce((total, request) => total + request.openContractsAtBuy, 0)} open contract(s) across buys and ` +
            `${settlementUpdates.length} settlement updates`
    );
    if (speed === 'slow') {
        console.log(
            `✓ SLOW re-analysis proof captured ${reanalysisResets.length} resets ` +
                `and fresh windows ${postResetPurchases.filter(Boolean).map(request => request.conditionWindowIndex).join(' → ')}`
        );
    }
    await evaluate(cdp, `document.querySelector('#db-animation__stop-button')?.click()`);
    await waitFor(
        cdp,
        `Boolean(document.querySelector('#db-animation__run-button')) &&
         !document.querySelector('#db-animation__run-button').disabled`,
        `${speed.toUpperCase()} bot stop`
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

const seedEmptySavedWorkspace = async cdp => {
    await evaluate(
        cdp,
        `new Promise((resolve, reject) => {
            const request = indexedDB.open('localforage', 2);
            request.onerror = () => reject(request.error || new Error('Could not open localForage database.'));
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains('keyvaluepairs')) {
                    database.createObjectStore('keyvaluepairs');
                }
            };
            request.onsuccess = () => {
                const database = request.result;
                let transaction;
                try {
                    transaction = database.transaction('keyvaluepairs', 'readwrite');
                    transaction.objectStore('keyvaluepairs').put(
                        ${JSON.stringify(emptySavedWorkspaceValue)},
                        'saved_workspaces'
                    );
                } catch (error) {
                    database.close();
                    reject(error);
                    return;
                }
                transaction.oncomplete = () => {
                    database.close();
                    resolve(true);
                };
                transaction.onerror = () => {
                    database.close();
                    reject(transaction.error || new Error('Could not seed saved_workspaces.'));
                };
            };
        })`
    );
    console.log('✓ Seeded an empty saved_workspaces entry in localForage');
};

const run = async () => {
    const xml = await readFile(xmlPath, 'utf8');
    const freeBotXml = await readFile(freeBotXmlPath, 'utf8');
    if ((xml.match(/<block\b/g) || []).length < 3) throw new Error(`Binary Matrix XML is unexpectedly small: ${xmlPath}`);
    if (
        (freeBotXml.match(/<block\b/g) || []).length < 3 ||
        !freeBotXml.includes('type="variables_set_option"') ||
        !freeBotXml.includes('type="variables_is_option"')
    ) {
        throw new Error(`Over2 / Under7 Reversal XML is missing its serialized option blocks: ${freeBotXmlPath}`);
    }

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
        await cdp.send('Log.enable');
        await cdp.send('Page.navigate', { url: `${appUrl}/#free_bots` });
        await waitFor(cdp, `document.readyState === 'complete'`, 'Deriv Site page');
        await waitFor(
            cdp,
            `Array.from(document.querySelectorAll('button')).some(
                button => button.getClientRects().length > 0 &&
                    (button.textContent.includes('Continue to App') || button.textContent.includes('Load in DBot Builder'))
            )`,
            'app gate or Free Bots loader',
            90_000
        );

        const hasAppGate = await evaluate(
            cdp,
            `Array.from(document.querySelectorAll('button')).some(
                button => button.getClientRects().length > 0 && button.textContent.includes('Continue to App')
            )`
        );
        if (hasAppGate) await clickButtonContaining(cdp, 'Continue to App');
        if (hasAppGate) {
            await sleep(500);
            const appGateStillVisible = await evaluate(
                cdp,
                `Array.from(document.querySelectorAll('button')).some(
                    button => button.getClientRects().length > 0 && button.textContent.includes('Continue to App')
                )`
            );
            if (appGateStillVisible) {
                console.warn('App gate did not dismiss after the browser click; removing its test-only overlay.');
                await evaluate(
                    cdp,
                    `(() => {
                        document.querySelector('.slx-popup__dismiss')?.click();
                        document.querySelector('.slx-popup-overlay')?.remove();
                        document.querySelector('.slx-popup')?.parentElement?.remove();
                        return true;
                    })()`
                );
            }
        }

        await waitFor(
            cdp,
            `Array.from(document.querySelectorAll('button')).some(
                button => button.getClientRects().length > 0 && button.textContent.includes('Load in DBot Builder')
            )`,
            'Free Bots loader',
            90_000
        );
        await seedEmptySavedWorkspace(cdp);
        await clickButtonInCard(cdp, 'Over2 / Under7 Reversal', 'Load in DBot Builder');
        await waitFor(cdp, `location.hash === '#bot_builder'`, 'Over2 / Under7 Bot Builder navigation');
        await waitFor(
            cdp,
            `Boolean(document.querySelector('#id-bot-builder')?.getClientRects().length)`,
            'visible Bot Builder'
        );
        await assertFreeBotWorkspace(cdp, 'Over2 / Under7 Reversal Free Bot');
        const hasBuilderGuide = await evaluate(
            cdp,
            `Array.from(document.querySelectorAll('button')).some(
                button => button.getClientRects().length > 0 && button.textContent.trim() === 'Skip'
            )`
        );
        if (hasBuilderGuide) await clickButtonContaining(cdp, 'Skip');
        const hasBuilderSocialPopup = await evaluate(
            cdp,
            `Array.from(document.querySelectorAll('button')).some(
                button => button.getClientRects().length > 0 && button.textContent.includes('Continue to App')
            )`
        );
        if (hasBuilderSocialPopup) {
            await dismissSocialPopup(cdp);
        }
        await waitFor(
            cdp,
            `Boolean(document.querySelector('.animation__speed-switch')?.getClientRects().length)`,
            'execution speed switch'
        );
        // The social popup can be mounted after the builder is ready. Dismiss
        // it at the last possible point so it cannot intercept the toggle.
        await dismissSocialPopup(cdp);
        await evaluate(
            cdp,
            `(() => {
                const speedSwitch = document.querySelector('.animation__speed-switch');
                if (!speedSwitch) throw new Error('Execution speed switch is missing');
                if (speedSwitch.getAttribute('aria-checked') !== 'true') {
                    speedSwitch.click();
                } else if (window.localStorage.getItem('dbot_execution_speed') !== 'fast') {
                    // Keep storage aligned when the component defaulted to FAST
                    // without needing a redundant click that would switch it back.
                    window.localStorage.setItem('dbot_execution_speed', 'fast');
                }
                return true;
            })()`
        );
        await waitFor(
            cdp,
            `document.querySelector('.animation__speed-switch')?.getAttribute('aria-checked') === 'true' &&
             window.localStorage.getItem('dbot_execution_speed') === 'fast'`,
            'FAST execution switch state'
        );
        await evaluate(cdp, `document.querySelector('.animation__speed-switch')?.click()`);
        await waitFor(
            cdp,
            `document.querySelector('.animation__speed-switch')?.getAttribute('aria-checked') === 'false' &&
             window.localStorage.getItem('dbot_execution_speed') === 'slow'`,
            'SLOW execution switch state'
        );
        console.log('✓ Existing run-panel execution switch toggles FAST ↔ SLOW');

        await evaluate(cdp, `document.querySelector('#db-toolbar__import-button')?.click()`);
        await waitFor(cdp, `document.querySelector('input[data-testid="dt-load-strategy-file-input"]')`, 'standard XML loader');
        await setFileInput(cdp, xmlPath);
        await evaluate(
            cdp,
            `document.querySelector('input[data-testid="dt-load-strategy-file-input"]')
                ?.dispatchEvent(new Event('change', { bubbles: true }))`
        );
        await waitFor(cdp, `document.querySelector('#load-strategy__blockly-container')`, 'XML preview');
        await waitFor(cdp, `Boolean(window.Blockly?.xmlValues?.convertedDom)`, 'parsed XML preview');
        await clickButtonContaining(cdp, 'Open');
        await assertBinaryMatrixWorkspace(cdp, 'standard XML loader');
        await runGeneratedBinaryMatrixBot(cdp, 'slow');
        await runGeneratedBinaryMatrixBot(cdp, 'fast');
    } finally {
        cdp?.socket.close();
        browser.kill('SIGTERM');
    }
};

run().catch(error => {
    console.error(`Binary Matrix browser regression failed: ${error.message}`);
    process.exitCode = 1;
});
/* eslint-disable no-promise-executor-return */
import debounce from 'lodash.debounce';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { localize } from '@deriv-com/translations';
import { getLast } from '../../../utils/binary-utils';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { getDirection, getLastDigit } from '../utils/helpers';
import { expectPositiveInteger } from '../utils/sanitize';
import * as constants from './state/constants';
import { markBotTick } from '@/utils/bot-contract-gate';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import { adxSnapshot, macdSnapshot, rsiSnapshot } from '@/external/indicators';
import { adaptiveMomentumLog } from '../utils/broadcast';

const VOLATILITY_SCAN_REQUEST_GAP_MS = 750;
const VOLATILITY_SCAN_HISTORY_RETRIES = 2;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export const getAdaptiveMomentumAnalysisFromPrices = (
    prices,
    warmup = 30,
    shortWindow = 8,
    longWindow = 20,
    confidence = 60
) => {
    const warmupSize = Math.max(2, Math.floor(Number(warmup) || 30));
    const shortSize = Math.max(2, Math.floor(Number(shortWindow) || 8));
    const longSize = Math.max(shortSize, Math.floor(Number(longWindow) || 20));
    const minimumConfidence = Math.max(1, Math.min(99, Number(confidence) || 60));
    const numericPrices = prices.map(Number).filter(Number.isFinite);
    const minimumHistory = Math.max(warmupSize, longSize + 1);

    if (numericPrices.length < minimumHistory) {
        return {
            signal: 'WAIT',
            reason: 'insufficient_history',
            tickCount: numericPrices.length,
            requiredTicks: minimumHistory,
            warmup: warmupSize,
            shortWindow: shortSize,
            longWindow: longSize,
            confidence: minimumConfidence,
            signalConfidence: 0,
            shortRisePercentage: 0,
            shortFallPercentage: 0,
            longRisePercentage: 0,
            longFallPercentage: 0,
        };
    }

    const window = numericPrices.slice(-(longSize + 1));
    const moves = window.slice(1).map((price, index) => {
        const previous = window[index];
        if (price > previous) return 1;
        if (price < previous) return -1;
        return 0;
    });
    const shortMoves = moves.slice(-shortSize);
    const upPercentage = values =>
        values.length ? (values.filter(value => value > 0).length / values.length) * 100 : 0;
    const downPercentage = values =>
        values.length ? (values.filter(value => value < 0).length / values.length) * 100 : 0;
    const shortBias = upPercentage(shortMoves) - downPercentage(shortMoves);
    const longBias = upPercentage(moves) - downPercentage(moves);

    const shortRisePercentage = upPercentage(shortMoves);
    const shortFallPercentage = downPercentage(shortMoves);
    const longRisePercentage = upPercentage(moves);
    const longFallPercentage = downPercentage(moves);
    const signalConfidence = Math.abs(shortBias);
    const signal =
        shortBias >= minimumConfidence && longBias > 0
            ? 'CALL'
            : shortBias <= -minimumConfidence && longBias < 0
              ? 'PUT'
              : 'WAIT';
    const reason =
        signal !== 'WAIT'
            ? 'confidence_confirmed'
            : Math.abs(shortBias) >= minimumConfidence
              ? 'long_direction_conflict'
              : 'confidence_below_threshold';

    return {
        signal,
        reason,
        tickCount: numericPrices.length,
        requiredTicks: minimumHistory,
        warmup: warmupSize,
        shortWindow: shortSize,
        longWindow: longSize,
        confidence: minimumConfidence,
        signalConfidence,
        shortRisePercentage,
        shortFallPercentage,
        longRisePercentage,
        longFallPercentage,
    };
};

export const getAdaptiveMomentumSignalFromPrices = (...args) =>
    getAdaptiveMomentumAnalysisFromPrices(...args).signal;

export const getSmartOver2EntryAssessment = (digits, count = 4) => {
    const size = Math.max(1, Math.floor(Number(count) || 1));
    const numericDigits = digits.map(Number).filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const recent = numericDigits.slice(-size);
    const lastThree = numericDigits.slice(-3);
    const entryWindowReady = recent.length >= size;
    const skipWindowReady = lastThree.length >= 3;
    const entryWindowMatches =
        entryWindowReady && recent.every(digit => digit >= 3 && digit <= 7);
    const skipHighTriple =
        skipWindowReady && lastThree.every(digit => digit >= 7 && digit <= 9);
    const skipLowTriple =
        skipWindowReady && lastThree.every(digit => digit >= 0 && digit <= 2);

    return {
        count: size,
        digits: recent,
        lastThree,
        entryWindowReady,
        entryWindowMatches,
        skipWindowReady,
        skipHighTriple,
        skipLowTriple,
        result:
            entryWindowReady &&
            skipWindowReady &&
            entryWindowMatches &&
            !skipHighTriple &&
            !skipLowTriple,
    };
};

export const getSmartOver2V3EntryAssessment = (digits, count = 4) => {
    const requestedSize = Number(count);
    const size = Number.isFinite(requestedSize) ? Math.max(1, Math.min(100, Math.floor(requestedSize))) : 4;
    const numericDigits = digits.map(Number).filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const recent = numericDigits.slice(-size);
    const entryWindowReady = recent.length >= size;
    const entryWindowMatches = entryWindowReady && recent.every(digit => digit >= 3 && digit <= 6);

    return {
        count: size,
        digits: recent,
        entryWindowReady,
        entryWindowMatches,
        result: entryWindowMatches,
    };
};

export const analyzeSmartOver2RecoveryDigits = (digits, analysisCount = 100) => {
    const requestedCount = Math.max(20, Math.min(500, Math.floor(Number(analysisCount) || 100)));
    const numericDigits = digits.map(Number).filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const sample = numericDigits.slice(-requestedCount);
    const minimumHistory = Math.min(30, requestedCount);
    const minimumDecisiveDigits = Math.min(10, minimumHistory);
    const decisiveDigits = sample.filter(digit => digit !== 4);

    if (sample.length < minimumHistory || decisiveDigits.length < minimumDecisiveDigits) {
        return {
            ready: false,
            requestedCount,
            sampleCount: sample.length,
            decisiveCount: decisiveDigits.length,
            minimumHistory,
            minimumDecisiveDigits,
            windows: [],
            score: null,
            contractType: null,
            tieBreak: null,
        };
    }

    const windowSizes = [...new Set([10, 30, sample.length])].filter(size => size <= sample.length);
    const windows = windowSizes.map(size => {
        const window = sample.slice(-size);
        const over = window.filter(digit => digit > 4).length;
        const under = window.filter(digit => digit < 4).length;
        const decisive = over + under;
        return {
            size,
            over,
            under,
            ties: window.length - decisive,
            bias: decisive ? (over - under) / decisive : 0,
        };
    });
    const weightedScore = windows.reduce((total, window) => {
        const weight = window.size <= 10 ? 2 : window.size <= 30 ? 1.5 : 1;
        return total + window.bias * weight;
    }, 0);
    const totalWeight = windows.reduce(
        (total, window) => total + (window.size <= 10 ? 2 : window.size <= 30 ? 1.5 : 1),
        0
    );
    const score = totalWeight ? weightedScore / totalWeight : 0;
    const mostRecentDecisiveDigit = [...sample].reverse().find(digit => digit !== 4);
    const tieBreak = score === 0 ? (mostRecentDecisiveDigit > 4 ? 'recent_digit_over_4' : 'recent_digit_under_4') : null;

    return {
        ready: true,
        requestedCount,
        sampleCount: sample.length,
        decisiveCount: decisiveDigits.length,
        minimumHistory,
        minimumDecisiveDigits,
        windows,
        score,
        contractType:
            score === 0
                ? mostRecentDecisiveDigit > 4
                    ? 'DIGITOVER'
                    : 'DIGITUNDER'
                : score > 0
                  ? 'DIGITOVER'
                  : 'DIGITUNDER',
        tieBreak,
    };
};

export default Engine =>
    class Ticks extends Engine {
        constructor(...args) {
            super(...args);
            this.tickListenerKey = null;
            this.latestTick = null;
            this.volatilitySelectionLock = null;
            this.volatilityPreferredMarket = null;
            this.volatilityExcludedMarket = null;
            this.volatilityScanIndex = 0;
            this.volatilityScanRecords = [];
            this.volatilityDiagnosticsToken = 0;
            this.volatilityDiagnosticsPromise = null;
            this.purchaseConditionEvaluationTick = null;
            this.smartOver2RecoveryState = null;
        }

        async watchTicks(symbol) {
            if (symbol && (this.symbol !== symbol || !this.tickListenerKey)) {
                const previousSymbol = this.symbol;
                const previousListenerKey = this.tickListenerKey;

                if (previousSymbol && previousListenerKey) {
                    await this.$scope.ticksService.stopMonitor({
                        symbol: previousSymbol,
                        key: previousListenerKey,
                    });
                }

                this.symbol = symbol;
                this.tickListenerKey = null;
                const { ticksService } = this.$scope;

                const callback = ticks => {
                    if (this.is_proposal_subscription_required) {
                        this.checkProposalReady();
                    }
                    const lastTick = ticks.slice(-1)[0];
                    this.latestTick = lastTick;
                    const { epoch } = lastTick;
                    markBotTick(symbol, epoch);
                    this.store.dispatch({ type: constants.NEW_TICK, payload: epoch });
                    this.observer.emit('bot.tick', epoch);
                };

                const key = await ticksService.monitor({ symbol, callback });
                this.tickListenerKey = key;
            }
        }

        checkTicksPromiseExists() {
            return this.$scope.ticksService.ticks_history_promise;
        }

        getTicks(toString = false) {
            return new Promise(resolve => {
                this.$scope.ticksService.request({ symbol: this.symbol }).then(ticks => {
                    const ticks_list = ticks.map(tick => {
                        if (toString) {
                            return tick.quote.toFixed(this.getPipSize());
                        }
                        return tick.quote;
                    });

                    resolve(ticks_list);
                });
            });
        }

        getLastTick(raw, toString = false) {
            // Both execution modes must consume the subscribed broker tick.
            // Requesting tick history on every SLOW loop adds an avoidable
            // network round trip and can stall the next one-tick purchase.
            if (this.latestTick) {
                let last_tick = raw ? this.latestTick : this.latestTick.quote;
                if (!raw && toString) {
                    last_tick = last_tick.toFixed(this.getPipSize());
                }
                return Promise.resolve(last_tick);
            }

            return new Promise((resolve, reject) =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol })
                    .then(ticks => {
                        try {
                            let last_tick = raw ? getLast(ticks) : getLast(ticks).quote;
                            if (!raw && toString) {
                                last_tick = last_tick.toFixed(this.getPipSize());
                            }
                            resolve(last_tick);
                        } catch (error) {
                            reject(error);
                        }
                    })
                    .catch(e => {
                        if (e.code === 'MarketIsClosed') {
                            const localizedError = {
                                ...e,
                                message: getLocalizedErrorMessage(e.code, e.details),
                            };
                            globalObserver.emit('Error', localizedError);
                            resolve(e.code);
                        }
                    })
            );
        }

        getLastDigit() {
            return new Promise(resolve => this.getLastTick(false, true).then(tick => resolve(getLastDigit(tick))));
        }

        getLastDigitList() {
            return new Promise(resolve => this.getTicks().then(ticks => resolve(this.getLastDigitsFromList(ticks))));
        }
        checkLastDigitsCondition(condition, count = 1, compareValue = 0) {
            return this.getLastDigitList().then(digits => {
                const size = Math.max(1, Math.floor(Number(count) || 1));
                const recent = digits.slice(-size).map(Number);
                let result = false;

                // A Binary Matrix re-analysis is settlement-driven. Do not let
                // the first condition check after the threshold reuse the same
                // broker tick that produced the final winning contract. The
                // XML runner will keep scanning until this gate sees a newer
                // subscribed tick, then all conditions in the chain evaluate
                // against that fresh window.
                const matrixState = this.binaryMatrixStakeState;
                const isBinaryMatrixWorkspace = this.isBinaryMatrixWorkspace?.() === true;
                if (
                    isBinaryMatrixWorkspace &&
                    matrixState?.reanalysisPending &&
                    (matrixState.reanalysisBlockedEpoch === null ||
                        this.latestTick?.epoch === matrixState.reanalysisBlockedEpoch)
                ) {
                    globalObserver.emit('bot.analysis.condition', {
                        market: this.symbol || 'N/A',
                        condition,
                        count: size,
                        compareValue: Number(compareValue),
                        digits: recent,
                        result: false,
                    });
                    return false;
                }

                if (isBinaryMatrixWorkspace && matrixState?.reanalysisPending) {
                    matrixState.reanalysisPending = false;
                    matrixState.reanalysisBlockedEpoch = null;
                }

                if (recent.length >= size) {
                    switch (condition) {
                        case 'ALL_EVEN':
                            result = recent.every(digit => digit % 2 === 0);
                            break;
                        case 'LESS_OR_EQUAL':
                            result = recent.every(digit => digit <= Number(compareValue));
                            break;
                        case 'GREATER_OR_EQUAL':
                            result = recent.every(digit => digit >= Number(compareValue));
                            break;
                        case 'ALL_ODD':
                        default:
                            result = recent.every(digit => digit % 2 !== 0);
                            break;
                    }
                }

                globalObserver.emit('bot.analysis.condition', {
                    market: this.symbol || 'N/A',
                    condition,
                    count: size,
                    compareValue: Number(compareValue),
                    digits: recent,
                    result,
                });

                return result;
            });
        }
        checkSmartOver2Entry(count = 4, journalScope = null) {
            return this.getLastDigitList().then(digits => {
                const assessment = getSmartOver2EntryAssessment(digits, count);

                if (journalScope === 'rise-fall-master' || journalScope === 'smart-over-2') {
                    globalObserver.emit('bot.analysis.smart_over2', {
                        market: this.symbol || 'N/A',
                        ...assessment,
                        journalScope,
                    });
                }

                return assessment.result;
            });
        }
        getApexAIVirtualHookState() {
            if (!this.apexAIVirtualHookState) {
                this.apexAIVirtualHookState = {
                    maxVirtualLosses: 3,
                    virtualLosses: 0,
                    activeSide: null,
                    pendingVirtualTrade: null,
                    lastSettlementEpoch: null,
                    settlementInFlight: false,
                    livePhaseSide: null,
                };
            }
            return this.apexAIVirtualHookState;
        }
        configureApexAIVirtualHook(switchAfter = 3) {
            const state = this.getApexAIVirtualHookState();
            const requestedThreshold = Number(switchAfter);
            state.maxVirtualLosses = Math.max(
                1,
                Math.ceil(Number.isFinite(requestedThreshold) ? requestedThreshold : 3)
            );
            state.virtualLosses = 0;
            state.activeSide = null;
            state.pendingVirtualTrade = null;
            state.lastSettlementEpoch = null;
            state.settlementInFlight = false;
            state.livePhaseSide = null;
            return state.maxVirtualLosses;
        }
        checkApexAIVirtualHook(side, journalScope = 'apex-ai') {
            const state = this.getApexAIVirtualHookState();
            const activeSide = String(side ?? '').trim().toUpperCase();
            if (activeSide !== 'A' && activeSide !== 'B') return Promise.resolve(false);

            const currentEpoch = this.getSmartOver2CurrentEpoch();
            if (state.activeSide !== activeSide) {
                const isFirstSide = state.activeSide === null;
                state.activeSide = activeSide;
                state.virtualLosses = 0;
                state.pendingVirtualTrade = null;
                state.livePhaseSide = null;
                // The side changes after a real contract settles. Do not reuse
                // that settlement tick as the first virtual contract's entry.
                state.lastSettlementEpoch = isFirstSide ? null : currentEpoch;
            }

            if (state.pendingVirtualTrade) {
                const pendingTrade = state.pendingVirtualTrade;
                const entryEpoch = Number(pendingTrade.entryEpoch);
                if (currentEpoch === null || currentEpoch <= entryEpoch || state.settlementInFlight) {
                    return Promise.resolve(false);
                }

                state.settlementInFlight = true;
                return Promise.resolve()
                    .then(() => this.getLastDigit())
                    .then(digitValue => {
                        const digit = Number(digitValue);
                        if (
                            state.pendingVirtualTrade !== pendingTrade ||
                            state.activeSide !== activeSide ||
                            !Number.isInteger(digit) ||
                            digit < 0 ||
                            digit > 9
                        ) {
                            return false;
                        }

                        const isEven = digit % 2 === 0;
                        const isWin = pendingTrade.side === 'A' ? isEven : !isEven;
                        state.pendingVirtualTrade = null;
                        state.virtualLosses = isWin ? 0 : state.virtualLosses + 1;
                        state.lastSettlementEpoch = currentEpoch;

                        this.emitSmartOver2RecoveryEvent(
                            pendingTrade.journalScope || journalScope,
                            'virtual_settlement',
                            `[Apex AI] Virtual ${pendingTrade.side === 'A' ? 'Even' : 'Odd'} settled ` +
                                `${isWin ? 'WIN' : 'LOSS'} on digit ${digit} · ` +
                                `${state.virtualLosses}/${state.maxVirtualLosses} consecutive virtual losses.`,
                            {
                                outcome: isWin ? 'win' : 'loss',
                                contractType: pendingTrade.contractType,
                                virtualTradeId: pendingTrade.virtualTradeId,
                                entryEpoch,
                                settlementEpoch: currentEpoch,
                                entrySpot: pendingTrade.entrySpot,
                                exitSpot: this.getSmartOver2CurrentQuote(),
                                digit,
                                virtualLosses: state.virtualLosses,
                                maxVirtualLosses: state.maxVirtualLosses,
                            }
                        );
                        return false;
                    })
                    .finally(() => {
                        state.settlementInFlight = false;
                    });
            }

            if (currentEpoch === null) return Promise.resolve(false);
            if (
                state.lastSettlementEpoch !== null &&
                currentEpoch <= Number(state.lastSettlementEpoch)
            ) {
                return Promise.resolve(false);
            }

            if (state.virtualLosses >= state.maxVirtualLosses) {
                if (state.livePhaseSide !== activeSide) {
                    state.livePhaseSide = activeSide;
                    this.emitSmartOver2RecoveryEvent(
                        journalScope,
                        'live_ready',
                        `[Apex AI] Side ${activeSide} passed ${state.maxVirtualLosses} consecutive virtual losses; ` +
                            `live ${activeSide === 'A' ? 'Even' : 'Odd'} trades are enabled.`,
                        {
                            side: activeSide,
                            virtualLosses: state.virtualLosses,
                            maxVirtualLosses: state.maxVirtualLosses,
                        }
                    );
                }
                return Promise.resolve(true);
            }

            const contractType = activeSide === 'A' ? 'DIGITEVEN' : 'DIGITODD';
            const virtualTradeId = ['apex-ai', activeSide, currentEpoch, contractType].join(':');
            state.pendingVirtualTrade = {
                side: activeSide,
                contractType,
                entryEpoch: currentEpoch,
                entrySpot: this.getSmartOver2CurrentQuote(),
                virtualTradeId,
                journalScope,
            };
            this.emitSmartOver2RecoveryEvent(
                journalScope,
                'virtual_purchase',
                `[Apex AI] Virtual ${activeSide === 'A' ? 'Even' : 'Odd'} started; waiting for the next tick.`,
                {
                    side: activeSide,
                    contractType,
                    virtualTradeId,
                    entryEpoch: currentEpoch,
                    entrySpot: state.pendingVirtualTrade.entrySpot,
                    virtualLosses: state.virtualLosses,
                    maxVirtualLosses: state.maxVirtualLosses,
                }
            );
            return Promise.resolve(false);
        }
        getSmartOver2V3State() {
            if (!this.smartOver2V3State) {
                this.smartOver2V3State = {
                    entryDigitCount: 4,
                    overPrediction: 2,
                    useVirtualHook: true,
                    maxVirtualLosses: 2,
                    virtualLosses: 0,
                    pendingVirtualTrade: null,
                    lastSettlementEpoch: null,
                    pendingPurchase: null,
                    purchaseInFlight: false,
                    lastPurchasedContractId: null,
                    lastPurchasedPrediction: null,
                    lastProcessedSettlementId: null,
                    baseStake: null,
                    currentStake: null,
                    useMartingale: true,
                    martingaleMultiplier: 1.2,
                    targetProfit: 0,
                    stopLoss: 0,
                    sessionProfit: 0,
                    stopped: false,
                };
            }
            return this.smartOver2V3State;
        }
        configureSmartOver2V3(useVirtualHook = true, maxVirtualLosses = 2, entryDigitCount = 4, overPrediction = 2) {
            const state = this.getSmartOver2V3State();
            const requestedLosses = Number(maxVirtualLosses);
            const requestedCount = Number(entryDigitCount);
            const requestedPrediction = Number(overPrediction);
            state.useVirtualHook = Boolean(useVirtualHook);
            state.maxVirtualLosses =
                Number.isFinite(requestedLosses) && requestedLosses >= 0 ? Math.floor(requestedLosses) : 2;
            state.entryDigitCount = Number.isFinite(requestedCount)
                ? Math.max(1, Math.min(100, Math.floor(requestedCount)))
                : 4;
            state.overPrediction =
                Number.isFinite(requestedPrediction) && requestedPrediction >= 0 && requestedPrediction <= 8
                    ? Math.floor(requestedPrediction)
                    : 2;
            this.smartOver2V3Settings = {
                useVirtualHook: state.useVirtualHook,
                maxVirtualLosses: state.maxVirtualLosses,
                entryDigitCount: state.entryDigitCount,
                overPrediction: state.overPrediction,
            };
            this.setVirtualHookSettings?.(state.maxVirtualLosses, this.virtualHook?.minRealWins ?? 1);
            this.enableVirtualHook?.(state.useVirtualHook);
            if (!state.useVirtualHook) {
                state.virtualLosses = 0;
                state.pendingVirtualTrade = null;
            }
            return true;
        }
        resetSmartOver2V3Session() {
            const settings = this.smartOver2V3Settings;
            this.smartOver2V3State = null;
            if (!settings) return false;
            return this.configureSmartOver2V3(
                settings.useVirtualHook,
                settings.maxVirtualLosses,
                settings.entryDigitCount,
                settings.overPrediction
            );
        }
        emitSmartOver2V3Event(journalScope, event, message, details = {}) {
            if (!journalScope) return;
            globalObserver.emit('bot.smart_over2.recovery', {
                journalScope,
                event,
                market: this.tradeOptions?.symbol || this.options?.symbol || this.symbol || 'N/A',
                message,
                ...details,
            });
        }
        checkSmartOver2V3Entry(
            martingaleMultiplier = 1.2,
            useMartingale = true,
            targetProfit = 0,
            stopLoss = 0,
            journalScope = null
        ) {
            const state = this.getSmartOver2V3State();
            const requestedMultiplier = Number(martingaleMultiplier);
            state.martingaleMultiplier =
                Number.isFinite(requestedMultiplier) && requestedMultiplier >= 1 ? requestedMultiplier : 1.2;
            state.useMartingale = Boolean(useMartingale);
            const requestedTargetProfit = Number(targetProfit);
            state.targetProfit =
                Number.isFinite(requestedTargetProfit) && requestedTargetProfit > 0 ? requestedTargetProfit : 0;
            const requestedStopLoss = Number(stopLoss);
            state.stopLoss = Number.isFinite(requestedStopLoss) && requestedStopLoss > 0 ? requestedStopLoss : 0;
            this.setVirtualHookSettings?.(state.maxVirtualLosses, this.virtualHook?.minRealWins ?? 1);
            this.enableVirtualHook?.(state.useVirtualHook);

            if (state.stopped || state.purchaseInFlight) return Promise.resolve(false);
            if (state.pendingPurchase) {
                if (journalScope) state.pendingPurchase.journalScope = journalScope;
                return Promise.resolve(true);
            }

            if (state.pendingVirtualTrade) {
                const currentEpoch = this.getSmartOver2CurrentEpoch();
                const entryEpoch = Number(state.pendingVirtualTrade.entryEpoch);
                if (currentEpoch === null || currentEpoch <= entryEpoch) return Promise.resolve(false);

                const exitSpot = this.getSmartOver2CurrentQuote();
                return this.getLastDigit().then(digitValue => {
                    const digit = Number(digitValue);
                    if (!Number.isInteger(digit) || digit < 0 || digit > 9) return false;

                    const virtualTrade = state.pendingVirtualTrade;
                    const prediction = Number(virtualTrade.prediction);
                    const isWin = digit > prediction;
                    state.pendingVirtualTrade = null;
                    state.virtualLosses = isWin ? 0 : state.virtualLosses + 1;
                    state.lastSettlementEpoch = currentEpoch;
                    this.emitSmartOver2V3Event(
                        virtualTrade.journalScope || journalScope,
                        'virtual_settlement',
                        `[Smart Over 2 V3] Virtual Over ${prediction} settled ${isWin ? 'WIN' : 'LOSS'} on digit ${digit}. ` +
                            `${state.virtualLosses} of ${state.maxVirtualLosses} consecutive virtual losses.`,
                        {
                            outcome: isWin ? 'win' : 'loss',
                            contractType: 'DIGITOVER',
                            prediction,
                            digit,
                            virtualLosses: state.virtualLosses,
                            maxVirtualLosses: state.maxVirtualLosses,
                            virtualTradeId: virtualTrade.virtualTradeId,
                            entryEpoch,
                            settlementEpoch: currentEpoch,
                            entrySpot: virtualTrade.entrySpot,
                            exitSpot,
                        }
                    );
                    return false;
                });
            }

            const currentEpoch = this.getSmartOver2CurrentEpoch();
            if (state.lastSettlementEpoch !== null && (currentEpoch === null || currentEpoch <= state.lastSettlementEpoch)) {
                return Promise.resolve(false);
            }

            return this.getLastDigitList().then(digits => {
                const assessment = getSmartOver2V3EntryAssessment(digits, state.entryDigitCount);
                const shouldStartVirtual =
                    assessment.result &&
                    state.useVirtualHook &&
                    state.maxVirtualLosses > 0 &&
                    state.virtualLosses < state.maxVirtualLosses;
                const lastWindow = `[${assessment.digits.join(', ')}]`;
                const windowStatus = !assessment.entryWindowReady
                    ? `WAITING (need ${assessment.count})`
                    : assessment.entryWindowMatches
                      ? 'MET'
                      : 'NOT MET';

                globalObserver.emit('bot.analysis.smart_over2', {
                    market: this.tradeOptions?.symbol || this.options?.symbol || this.symbol || 'N/A',
                    journalScope,
                    version: 'v3',
                    count: assessment.count,
                    digits: assessment.digits,
                    lastThree: assessment.digits.slice(-3),
                    entryWindowReady: assessment.entryWindowReady,
                    entryWindowMatches: assessment.entryWindowMatches,
                    skipWindowReady: false,
                    skipHighTriple: false,
                    skipLowTriple: false,
                    result: assessment.result,
                    prediction: state.overPrediction,
                    useVirtualHook: state.useVirtualHook,
                    virtualLosses: state.virtualLosses,
                    maxVirtualLosses: state.maxVirtualLosses,
                    waitingForVirtualHook: shouldStartVirtual,
                });

                if (!assessment.result) {
                    this.emitSmartOver2V3Event(
                        journalScope,
                        'status',
                        `[Smart Over 2] Status · V3 · Market: ${this.tradeOptions?.symbol || this.symbol || 'N/A'} · ` +
                            `Last ${assessment.count}: ${lastWindow} · every digit 3–6: ${windowStatus} · ` +
                            `Over prediction: ${state.overPrediction} · Entry: BLOCKED`,
                        {
                            conditionStatus: 'BLOCKED',
                            digits: assessment.digits,
                            entryWindowReady: assessment.entryWindowReady,
                            entryWindowMatches: assessment.entryWindowMatches,
                            prediction: state.overPrediction,
                        }
                    );
                    return false;
                }

                if (shouldStartVirtual) {
                    if (currentEpoch === null) return false;
                    const virtualTradeId = [
                        journalScope || 'smart-over-2-v3',
                        currentEpoch,
                        'DIGITOVER',
                        state.overPrediction,
                    ].join(':');
                    state.pendingVirtualTrade = {
                        contractType: 'DIGITOVER',
                        prediction: state.overPrediction,
                        entryEpoch: currentEpoch,
                        entrySpot: this.getSmartOver2CurrentQuote(),
                        virtualTradeId,
                        journalScope,
                    };
                    this.emitSmartOver2V3Event(
                        journalScope,
                        'virtual_purchase',
                        `[Smart Over 2 V3] Virtual Over ${state.overPrediction} started; waiting for the next tick.`,
                        {
                            contractType: 'DIGITOVER',
                            prediction: state.overPrediction,
                            virtualLosses: state.virtualLosses,
                            maxVirtualLosses: state.maxVirtualLosses,
                            entryEpoch: currentEpoch,
                            entrySpot: state.pendingVirtualTrade.entrySpot,
                            virtualTradeId,
                        }
                    );
                    return false;
                }

                state.pendingPurchase = {
                    contractType: 'DIGITOVER',
                    prediction: state.overPrediction,
                    journalScope,
                };
                this.emitSmartOver2V3Event(
                    journalScope,
                    'status',
                    `[Smart Over 2] Status · V3 · Market: ${this.tradeOptions?.symbol || this.symbol || 'N/A'} · ` +
                        `Last ${assessment.count}: ${lastWindow} · every digit 3–6: MET · ` +
                        `Virtual losses: ${state.virtualLosses}/${state.maxVirtualLosses} · Real Over ${state.overPrediction} ready.`,
                    {
                        conditionStatus: 'READY',
                        digits: assessment.digits,
                        virtualLosses: state.virtualLosses,
                        maxVirtualLosses: state.maxVirtualLosses,
                        prediction: state.overPrediction,
                    }
                );
                return true;
            });
        }
        getSmartOver2V3PurchasePlan(contractType, prediction) {
            const state = this.smartOver2V3State;
            if (!state) return { blocked: false, contractType, prediction, order: null };
            const order = state.pendingPurchase;
            if (state.purchaseInFlight || !order) return { blocked: true, contractType, prediction, order: null };
            return {
                blocked: false,
                contractType: 'DIGITOVER',
                prediction: order.prediction,
                order,
            };
        }
        beginSmartOver2V3Purchase(order) {
            const state = this.getSmartOver2V3State();
            const pending = state.pendingPurchase;
            if (
                state.purchaseInFlight ||
                !pending ||
                pending.contractType !== 'DIGITOVER' ||
                !Number.isInteger(Number(pending.prediction)) ||
                Number(pending.prediction) < 0 ||
                Number(pending.prediction) > 8 ||
                pending !== order
            ) {
                return null;
            }
            state.purchaseInFlight = true;
            return { ...pending };
        }
        completeSmartOver2V3Purchase(order, buy = {}) {
            const state = this.getSmartOver2V3State();
            const pending = state.pendingPurchase;
            if (
                !order ||
                !pending ||
                !state.purchaseInFlight ||
                pending.contractType !== order.contractType ||
                Number(pending.prediction) !== Number(order.prediction) ||
                order.contractType !== 'DIGITOVER' ||
                !Number.isInteger(Number(order.prediction)) ||
                Number(order.prediction) < 0 ||
                Number(order.prediction) > 8
            ) {
                state.purchaseInFlight = false;
                return false;
            }
            state.pendingPurchase = null;
            state.purchaseInFlight = false;
            state.lastPurchasedContractId =
                buy.contract_id === undefined || buy.contract_id === null ? null : String(buy.contract_id);
            state.lastPurchasedPrediction = Number(order.prediction);
            const acceptedStake = Number(buy.buy_price);
            if (Number.isFinite(acceptedStake) && acceptedStake > 0) state.currentStake = acceptedStake;
            this.emitSmartOver2V3Event(
                order.journalScope,
                'purchase',
                `[Smart Over 2 V3] Live Over ${order.prediction} purchased.`,
                {
                    contractType: 'DIGITOVER',
                    prediction: Number(order.prediction),
                    contractId: state.lastPurchasedContractId,
                }
            );
            return true;
        }
        abortSmartOver2V3Purchase(order) {
            const state = this.smartOver2V3State;
            if (
                !state?.purchaseInFlight ||
                order?.contractType !== 'DIGITOVER' ||
                !Number.isInteger(Number(order?.prediction)) ||
                Number(order?.prediction) < 0 ||
                Number(order?.prediction) > 8
            ) {
                return false;
            }
            state.purchaseInFlight = false;
            return true;
        }
        purchaseSmartOver2V3(journalScope = null) {
            const state = this.getSmartOver2V3State();
            const order = state.pendingPurchase;
            if (
                !order ||
                state.purchaseInFlight ||
                order.contractType !== 'DIGITOVER' ||
                !Number.isInteger(Number(order.prediction)) ||
                Number(order.prediction) < 0 ||
                Number(order.prediction) > 8
            ) {
                return Promise.resolve(false);
            }
            if (journalScope) order.journalScope = journalScope;
            return this.purchase('DIGITOVER', Number(order.prediction));
        }
        completeSmartOver2V3Settlement(journalScope = null) {
            const state = this.getSmartOver2V3State();
            const contract = this.lastSettledContract;
            const settlementId = contract?.contract_id ?? contract?.purchase_reference;
            if (
                !state.lastPurchasedContractId ||
                settlementId === null ||
                settlementId === undefined ||
                String(settlementId) !== String(state.lastPurchasedContractId) ||
                String(settlementId) === String(state.lastProcessedSettlementId)
            ) {
                return false;
            }

            state.lastProcessedSettlementId = String(settlementId);
            state.lastPurchasedContractId = null;
            const status = String(contract.status || '').toLowerCase();
            const profit = Number(contract.profit);
            const sellPrice = Number(contract.sell_price);
            const buyPrice = Number(contract.buy_price);
            const realizedProfit = Number.isFinite(profit)
                ? profit
                : Number.isFinite(sellPrice) && Number.isFinite(buyPrice)
                  ? sellPrice - buyPrice
                  : 0;
            const settledPrediction =
                state.lastPurchasedPrediction !== null &&
                state.lastPurchasedPrediction !== undefined &&
                Number.isInteger(Number(state.lastPurchasedPrediction))
                ? Number(state.lastPurchasedPrediction)
                : state.overPrediction;
            const isWin =
                ['won', 'win'].includes(status) ||
                (!['lost', 'loss'].includes(status) && Number.isFinite(profit) && profit > 0);
            state.sessionProfit = Number((Number(state.sessionProfit || 0) + realizedProfit).toFixed(2));
            const configuredBaseStake = Number(state.baseStake);
            const tradeOptionStake = Number(this.tradeOptions?.amount);
            const baseStake =
                Number.isFinite(configuredBaseStake) && configuredBaseStake > 0
                    ? configuredBaseStake
                    : Number.isFinite(tradeOptionStake) && tradeOptionStake > 0
                      ? tradeOptionStake
                      : null;
            const configuredCurrentStake = Number(state.currentStake);
            const currentStake =
                Number.isFinite(configuredCurrentStake) && configuredCurrentStake > 0 ? configuredCurrentStake : baseStake;
            const multiplier = Number(state.martingaleMultiplier);
            const safeMultiplier = Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1.2;
            const nextStake =
                baseStake === null || currentStake === null
                    ? null
                    : isWin
                      ? baseStake
                      : state.useMartingale
                        ? Number((currentStake * safeMultiplier).toFixed(2))
                        : baseStake;

            if (baseStake !== null) state.baseStake = baseStake;
            if (nextStake !== null) state.currentStake = nextStake;
            if (this.tradeOptions && nextStake !== null) this.tradeOptions.amount = nextStake;
            state.virtualLosses = 0;
            state.pendingVirtualTrade = null;
            state.pendingPurchase = null;
            state.purchaseInFlight = false;
            state.lastPurchasedPrediction = null;
            state.lastSettlementEpoch = this.getSmartOver2CurrentEpoch();
            const stopReason =
                state.targetProfit > 0 && state.sessionProfit >= state.targetProfit
                    ? 'target_profit'
                    : state.stopLoss > 0 && state.sessionProfit <= -state.stopLoss
                      ? 'stop_loss'
                      : null;
            state.stopped = Boolean(stopReason);
            this.emitSmartOver2V3Event(
                journalScope,
                'settlement',
                `[Smart Over 2 V3] Live Over ${settledPrediction} settled ${isWin ? 'WIN' : 'LOSS'} · ` +
                    `session P/L ${state.sessionProfit.toFixed(2)} · ` +
                    `virtual loss count reset; new live trades require ${state.maxVirtualLosses} consecutive virtual losses.` +
                    (nextStake === null ? '' : ` Next stake: ${nextStake.toFixed(2)}.`),
                {
                    contractType: 'DIGITOVER',
                    prediction: settledPrediction,
                    outcome: isWin ? 'win' : 'loss',
                    sessionProfit: state.sessionProfit,
                    baseStake,
                    nextStake,
                    martingaleMultiplier: safeMultiplier,
                    useMartingale: state.useMartingale,
                    contractId: String(settlementId),
                }
            );
            if (stopReason) {
                const stopMessage =
                    stopReason === 'target_profit'
                        ? `[Smart Over 2 V3] Target Profit reached at ${state.sessionProfit.toFixed(2)}; stopping.`
                        : `[Smart Over 2 V3] Stop Loss reached at ${state.sessionProfit.toFixed(2)}; stopping.`;
                this.emitSmartOver2V3Event(journalScope, 'risk_stop', stopMessage, {
                    reason: stopReason,
                    sessionProfit: state.sessionProfit,
                    targetProfit: state.targetProfit,
                    stopLoss: state.stopLoss,
                    contractId: String(settlementId),
                });
                globalObserver.emit('bot.stop_button_click');
            }
            return false;
        }
        getSmartOver2RecoveryState() {
            if (!this.smartOver2RecoveryState) {
                this.smartOver2RecoveryState = {
                    stage: 0,
                    pendingPurchase: null,
                    purchaseInFlight: false,
                    lastPurchasedStage: null,
                    lastProcessedSettlementId: null,
                    baseStake: null,
                    currentStake: null,
                    martingaleMultiplier: 1.2,
                    consecutiveLosses: 0,
                    useMartingale: true,
                    overPrediction: 2,
                    entryDigitCount: 4,
                    recoveryPrediction: 5,
                    recoveryContractType: 'DIGITUNDER',
                    useVirtualHook: true,
                    maxVirtualLosses: 2,
                    virtualLosses: 0,
                    recoveryRealMode: false,
                    pendingVirtualTrade: null,
                    lastVirtualSettlementEpoch: null,
                    targetProfit: 0,
                    stopLoss: 0,
                    sessionProfit: 0,
                    stopped: false,
                };
            }
            return this.smartOver2RecoveryState;
        }
        configureSmartOver2Recovery(
            useVirtualHook = true,
            maxVirtualLosses = 2,
            entryDigitCount = 4,
            recoveryContractType = 'DIGITUNDER'
        ) {
            const state = this.getSmartOver2RecoveryState();
            state.useVirtualHook = Boolean(useVirtualHook);
            if (recoveryContractType === 'DIGITOVER' || recoveryContractType === 'DIGITUNDER') {
                state.recoveryContractType = recoveryContractType;
            }
            const requestedVirtualLosses = Number(maxVirtualLosses);
            state.maxVirtualLosses =
                Number.isFinite(requestedVirtualLosses) && requestedVirtualLosses >= 0
                    ? Math.floor(requestedVirtualLosses)
                    : 2;
            const requestedEntryDigitCount = Number(entryDigitCount);
            state.entryDigitCount =
                Number.isFinite(requestedEntryDigitCount) && requestedEntryDigitCount >= 1
                    ? Math.min(1000, Math.floor(requestedEntryDigitCount))
                    : 4;
            this.smartOver2RecoverySettings = {
                useVirtualHook: state.useVirtualHook,
                maxVirtualLosses: state.maxVirtualLosses,
                entryDigitCount: state.entryDigitCount,
                recoveryContractType: state.recoveryContractType,
            };
            this.setVirtualHookSettings?.(state.maxVirtualLosses, this.virtualHook?.minRealWins ?? 1);
            this.enableVirtualHook?.(state.useVirtualHook);
            if (!state.useVirtualHook) {
                state.virtualLosses = 0;
                state.pendingVirtualTrade = null;
            }
            return true;
        }
        resetSmartOver2RecoverySession() {
            const settings = this.smartOver2RecoverySettings;
            this.smartOver2RecoveryState = null;
            if (!settings) return false;
            return this.configureSmartOver2Recovery(
                settings.useVirtualHook,
                settings.maxVirtualLosses,
                settings.entryDigitCount,
                settings.recoveryContractType
            );
        }
        emitSmartOver2RecoveryEvent(journalScope, event, message, details = {}) {
            if (!journalScope) return;
            globalObserver.emit('bot.smart_over2.recovery', {
                journalScope,
                event,
                market: this.tradeOptions?.symbol || this.options?.symbol || this.symbol || 'N/A',
                message,
                ...details,
            });
        }
        getSmartOver2CurrentEpoch() {
            const epoch = Number(this.latestTick?.epoch ?? this.store?.getState?.().newTick);
            return Number.isFinite(epoch) ? epoch : null;
        }
        getSmartOver2CurrentQuote() {
            const quote = this.latestTick?.quote;
            return quote === null || quote === undefined ? null : String(quote);
        }
        checkSmartOver2Recovery(
            count = undefined,
            analysisCount = 100,
            journalScope = null,
            martingaleMultiplier = 1.2,
            useMartingale = true,
            overPrediction = 2,
            recoveryPrediction = 5,
            useVirtualHook = undefined,
            maxVirtualLosses = undefined,
            targetProfit = 0,
            stopLoss = 0,
            recoveryContractType = undefined
        ) {
            void analysisCount;
            const state = this.getSmartOver2RecoveryState();
            const requestedEntryDigitCount = Number(count);
            if (Number.isFinite(requestedEntryDigitCount) && requestedEntryDigitCount >= 1) {
                state.entryDigitCount = Math.min(1000, Math.floor(requestedEntryDigitCount));
            }
            const size = Math.max(1, Math.floor(Number(state.entryDigitCount) || 4));
            if (recoveryContractType === 'DIGITOVER' || recoveryContractType === 'DIGITUNDER') {
                state.recoveryContractType = recoveryContractType;
            }
            const recoveryDirection = state.recoveryContractType === 'DIGITOVER' ? 'Over' : 'Under';
            const requestedMultiplier = Number(martingaleMultiplier);
            state.martingaleMultiplier =
                Number.isFinite(requestedMultiplier) && requestedMultiplier >= 1 ? requestedMultiplier : 1.2;
            state.useMartingale = Boolean(useMartingale);
            const requestedOverPrediction = Number(overPrediction);
            state.overPrediction =
                Number.isInteger(requestedOverPrediction) && requestedOverPrediction >= 0 && requestedOverPrediction <= 8
                    ? requestedOverPrediction
                    : 2;
            const requestedRecoveryPrediction = Number(recoveryPrediction);
            const minimumRecoveryPrediction = state.recoveryContractType === 'DIGITOVER' ? 0 : 1;
            const maximumRecoveryPrediction = state.recoveryContractType === 'DIGITOVER' ? 8 : 9;
            state.recoveryPrediction =
                Number.isInteger(requestedRecoveryPrediction) &&
                requestedRecoveryPrediction >= minimumRecoveryPrediction &&
                requestedRecoveryPrediction <= maximumRecoveryPrediction
                    ? requestedRecoveryPrediction
                    : state.recoveryContractType === 'DIGITOVER'
                      ? 4
                      : 5;
            if (useVirtualHook !== undefined) state.useVirtualHook = Boolean(useVirtualHook);
            if (maxVirtualLosses !== undefined) {
                const requestedVirtualLosses = Number(maxVirtualLosses);
                state.maxVirtualLosses =
                    Number.isFinite(requestedVirtualLosses) && requestedVirtualLosses >= 0
                        ? Math.floor(requestedVirtualLosses)
                        : 2;
            }
            this.smartOver2RecoverySettings = {
                useVirtualHook: state.useVirtualHook,
                maxVirtualLosses: state.maxVirtualLosses,
                entryDigitCount: state.entryDigitCount,
                recoveryContractType: state.recoveryContractType,
            };
            const requestedTargetProfit = Number(targetProfit);
            state.targetProfit =
                Number.isFinite(requestedTargetProfit) && requestedTargetProfit > 0 ? requestedTargetProfit : 0;
            const requestedStopLoss = Number(stopLoss);
            state.stopLoss = Number.isFinite(requestedStopLoss) && requestedStopLoss > 0 ? requestedStopLoss : 0;

            this.setVirtualHookSettings?.(state.maxVirtualLosses, this.virtualHook?.minRealWins ?? 1);
            this.enableVirtualHook?.(state.useVirtualHook);

            if (!state.useVirtualHook) {
                state.virtualLosses = 0;
                state.pendingVirtualTrade = null;
            }
            if (state.stopped) return Promise.resolve(false);

            if (state.pendingVirtualTrade) {
                const currentEpoch = this.getSmartOver2CurrentEpoch();
                const entryEpoch = Number(state.pendingVirtualTrade.entryEpoch);
                if (currentEpoch === null || currentEpoch <= entryEpoch) return Promise.resolve(false);
                const settlementSpot = this.getSmartOver2CurrentQuote();

                return this.getLastDigit().then(digitValue => {
                    const digit = Number(digitValue);
                    if (!Number.isInteger(digit) || digit < 0 || digit > 9) return false;

                    const virtualTrade = state.pendingVirtualTrade;
                    const isWin =
                        virtualTrade.contractType === 'DIGITOVER'
                            ? digit > Number(virtualTrade.prediction)
                            : digit < Number(virtualTrade.prediction);
                    state.pendingVirtualTrade = null;
                    state.virtualLosses = isWin ? 0 : state.virtualLosses + 1;
                    state.stage = 1;
                    state.recoveryRealMode = false;
                    state.lastVirtualSettlementEpoch = currentEpoch;
                    this.emitSmartOver2RecoveryEvent(
                        virtualTrade.journalScope || journalScope,
                        'virtual_settlement',
                        `[Smart Over 2] Virtual ${virtualTrade.contractType === 'DIGITUNDER' ? 'Under' : 'Over'} ` +
                            `${virtualTrade.prediction} settled ${isWin ? 'WIN' : 'LOSS'} on digit ${digit}. ` +
                            `${state.virtualLosses} of ${state.maxVirtualLosses} virtual losses.`,
                        {
                            stage: state.stage,
                            outcome: isWin ? 'win' : 'loss',
                            contractType: virtualTrade.contractType,
                            prediction: virtualTrade.prediction,
                            digit,
                            virtualLosses: state.virtualLosses,
                            maxVirtualLosses: state.maxVirtualLosses,
                            virtualTradeId: virtualTrade.virtualTradeId,
                            entryEpoch,
                            settlementEpoch: currentEpoch,
                            entrySpot: virtualTrade.entrySpot,
                            exitSpot: settlementSpot,
                        }
                    );
                    // Wait for the next broker tick before evaluating another
                    // virtual or live entry, matching the real one-tick cycle.
                    return false;
                });
            }

            if (state.lastVirtualSettlementEpoch !== null) {
                const currentEpoch = this.getSmartOver2CurrentEpoch();
                if (currentEpoch === null || currentEpoch <= state.lastVirtualSettlementEpoch) {
                    return Promise.resolve(false);
                }
            }

            if (state.stage === 1) {
                const shouldStartVirtualHook =
                    state.useVirtualHook &&
                    state.maxVirtualLosses > 0 &&
                    !state.recoveryRealMode &&
                    state.virtualLosses < state.maxVirtualLosses &&
                    !state.purchaseInFlight;
                if (shouldStartVirtualHook) {
                    const entryEpoch = this.getSmartOver2CurrentEpoch();
                    if (entryEpoch === null) return Promise.resolve(false);
                    state.pendingPurchase = null;
                    state.pendingVirtualTrade = {
                        stage: 1,
                        contractType: state.recoveryContractType,
                        prediction: state.recoveryPrediction,
                        entryEpoch,
                        entrySpot: this.getSmartOver2CurrentQuote(),
                        virtualTradeId: [
                            journalScope || 'smart-over-2',
                            entryEpoch,
                            state.recoveryContractType,
                            state.recoveryPrediction,
                        ].join(':'),
                        journalScope,
                    };
                    this.emitSmartOver2RecoveryEvent(
                        journalScope,
                        'virtual_purchase',
                        `[Smart Over 2] Virtual ${recoveryDirection} ${state.recoveryPrediction} started; waiting for the next tick.`,
                        {
                            stage: 1,
                            contractType: state.recoveryContractType,
                            prediction: state.recoveryPrediction,
                            virtualLosses: state.virtualLosses,
                            maxVirtualLosses: state.maxVirtualLosses,
                            entryEpoch,
                            entrySpot: state.pendingVirtualTrade.entrySpot,
                            virtualTradeId: state.pendingVirtualTrade.virtualTradeId,
                        }
                    );
                    return Promise.resolve(false);
                }
                state.recoveryRealMode = true;
                if (
                    !state.pendingPurchase ||
                    state.pendingPurchase.contractType !== state.recoveryContractType ||
                    Number(state.pendingPurchase.prediction) !== Number(state.recoveryPrediction)
                ) {
                    state.pendingPurchase = {
                        stage: 1,
                        contractType: state.recoveryContractType,
                        prediction: state.recoveryPrediction,
                        journalScope,
                    };
                }
                if (journalScope) state.pendingPurchase.journalScope = journalScope;
                this.emitSmartOver2RecoveryEvent(
                    journalScope,
                    'status',
                    `[Smart Over 2] Status · ${recoveryDirection} ${state.recoveryPrediction} real recovery · Market: ` +
                        `${this.tradeOptions?.symbol || this.options?.symbol || this.symbol || 'N/A'} · ` +
                        `${recoveryDirection} ${state.recoveryPrediction} is ready on the next available purchase tick; stake ${Number(state.currentStake ?? this.tradeOptions?.amount).toFixed(2)} ` +
                        `${state.useMartingale ? `at ${state.martingaleMultiplier}×` : 'with Martingale off'}; no last-X gate.`,
                    {
                        stage: 1,
                        conditionStatus: 'READY',
                        digits: [],
                        stake: Number(state.currentStake ?? this.tradeOptions?.amount),
                        martingaleMultiplier: state.martingaleMultiplier,
                        useMartingale: state.useMartingale,
                    }
                );
                return Promise.resolve(true);
            }

            return this.getLastDigitList().then(digits => {
                const numericDigits = digits
                    .map(Number)
                    .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
                const recent = numericDigits.slice(-size);
                const stage = state.stage;
                let shouldPurchase = false;
                let order = null;
                let conditionStatus = 'BLOCKED';
                let statusDetails = '';

                if (stage === 0) {
                    const assessment = getSmartOver2EntryAssessment(numericDigits, size);
                    shouldPurchase = assessment.result;
                    conditionStatus = shouldPurchase ? 'ALLOWED' : 'WAITING';
                    statusDetails =
                        `Last ${size}: [${assessment.digits.join(', ')}] · ` +
                        `3–7 window: ${assessment.entryWindowReady ? (assessment.entryWindowMatches ? 'MET' : 'NOT MET') : 'WAITING'} · ` +
                        `latest 3 [${assessment.lastThree.join(', ')}] · ` +
                        `all 7–9: ${assessment.skipHighTriple ? 'SKIP' : 'NO'} · ` +
                        `all 0–2: ${assessment.skipLowTriple ? 'SKIP' : 'NO'}`;
                    if (shouldPurchase) {
                        order = { stage, contractType: 'DIGITOVER', prediction: state.overPrediction };
                    }
                }

                if (shouldPurchase && order && !state.pendingPurchase) {
                    state.pendingPurchase = { ...order, journalScope };
                }

                this.emitSmartOver2RecoveryEvent(
                    journalScope,
                    'status',
                    `[Smart Over 2] Status · Normal Over ${state.overPrediction} · ` +
                        `Market: ${this.tradeOptions?.symbol || this.options?.symbol || this.symbol || 'N/A'} · ` +
                        `${statusDetails} · Decision: ${conditionStatus}`,
                    {
                        stage,
                        conditionStatus,
                        digits: recent,
                    }
                );

                return shouldPurchase;
            });
        }
        getSmartOver2RecoveryPurchasePlan(contractType, prediction) {
            const state = this.smartOver2RecoveryState;
            if (!state) {
                return { blocked: false, contractType, prediction, order: null };
            }

            const order = state.pendingPurchase;
            if (
                state.purchaseInFlight
            ) {
                return { blocked: true, contractType, prediction, order: null };
            }

            if (!order) {
                // Older saved workspaces can still use the original entry gate
                // and standard Purchase block. Keep normal stage-0 entries
                // compatible, but never let an unqueued recovery order through.
                if (state.stage === 0 && state.lastPurchasedStage === null) {
                    return { blocked: false, contractType, prediction, order: null };
                }
                return { blocked: true, contractType, prediction, order: null };
            }

            if (order.stage !== state.stage) {
                return { blocked: true, contractType, prediction, order: null };
            }

            return {
                blocked: false,
                contractType: order.contractType,
                prediction: order.prediction,
                order,
            };
        }
        beginSmartOver2RecoveryPurchase(order) {
            const state = this.getSmartOver2RecoveryState();
            const pending = state.pendingPurchase;
            if (
                state.purchaseInFlight ||
                !pending ||
                pending.stage !== state.stage ||
                pending.stage !== order?.stage ||
                pending.contractType !== order?.contractType ||
                Number(pending.prediction) !== Number(order?.prediction)
            ) {
                return null;
            }

            state.purchaseInFlight = true;
            return { ...pending };
        }
        completeSmartOver2RecoveryPurchase(order, buy = {}) {
            const state = this.getSmartOver2RecoveryState();
            const pending = state.pendingPurchase;
            if (
                !order ||
                !pending ||
                state.stage !== order.stage ||
                pending.stage !== order.stage ||
                pending.contractType !== order.contractType ||
                Number(pending.prediction) !== Number(order.prediction)
            ) {
                state.purchaseInFlight = false;
                return false;
            }

            state.pendingPurchase = null;
            state.purchaseInFlight = false;
            state.lastPurchasedStage = order.stage;
            if (order.stage === 1) state.recoveryRealMode = true;
            const acceptedStake = Number(buy.buy_price);
            if (Number.isFinite(acceptedStake) && acceptedStake > 0) {
                state.currentStake = acceptedStake;
            }
            const contractName = `${order.contractType === 'DIGITUNDER' ? 'Under' : 'Over'} ${order.prediction}`;
            this.emitSmartOver2RecoveryEvent(
                order.journalScope,
                'purchase',
                `[Smart Over 2] ${order.stage === 0 ? 'Normal entry' : `Real ${contractName} recovery`} · ` +
                    `purchased ${contractName}.`,
                {
                    stage: order.stage,
                    contractType: order.contractType,
                    prediction: order.prediction,
                    contractId: buy.contract_id === undefined ? undefined : String(buy.contract_id),
                }
            );
            return true;
        }
        abortSmartOver2RecoveryPurchase(order) {
            const state = this.smartOver2RecoveryState;
            if (!state?.pendingPurchase || state.pendingPurchase.stage !== order?.stage) return false;
            state.purchaseInFlight = false;
            return true;
        }
        purchaseSmartOver2Recovery(journalScope = null) {
            const state = this.getSmartOver2RecoveryState();
            const order = state.pendingPurchase;
            if (!order || state.purchaseInFlight) return Promise.resolve(false);
            if (journalScope) order.journalScope = journalScope;

            return this.purchase(order.contractType, order.prediction);
        }
        completeSmartOver2Recovery(journalScope = null) {
            const state = this.getSmartOver2RecoveryState();
            const contract = this.lastSettledContract;
            const purchasedStage = state.lastPurchasedStage;
            const settlementId = contract?.contract_id ?? contract?.purchase_reference;
            if (
                purchasedStage === null ||
                purchasedStage === undefined ||
                settlementId === null ||
                settlementId === undefined ||
                String(settlementId) === String(state.lastProcessedSettlementId)
            ) {
                return false;
            }

            state.lastProcessedSettlementId = String(settlementId);
            state.lastPurchasedStage = null;
            state.purchaseInFlight = false;
            const status = String(contract.status || '').toLowerCase();
            const profit = Number(contract.profit);
            const sellPrice = Number(contract.sell_price);
            const buyPrice = Number(contract.buy_price);
            const realizedProfit = Number.isFinite(profit)
                ? profit
                : Number.isFinite(sellPrice) && Number.isFinite(buyPrice)
                  ? sellPrice - buyPrice
                  : 0;
            const isWin =
                ['won', 'win'].includes(status) ||
                (!['lost', 'loss'].includes(status) && Number.isFinite(profit) && profit > 0);
            const result = isWin ? 'WIN' : 'LOSS';
            const stageLabel =
                purchasedStage === 0
                    ? `Normal Over ${state.overPrediction}`
                    : `Real ${state.recoveryContractType === 'DIGITOVER' ? 'Over' : 'Under'} ${state.recoveryPrediction} recovery`;
            state.sessionProfit = Number((Number(state.sessionProfit || 0) + realizedProfit).toFixed(2));
            const configuredBaseStake = Number(state.baseStake);
            const tradeOptionStake = Number(this.tradeOptions?.amount);
            const baseStake =
                Number.isFinite(configuredBaseStake) && configuredBaseStake > 0
                    ? configuredBaseStake
                    : Number.isFinite(tradeOptionStake) && tradeOptionStake > 0
                      ? tradeOptionStake
                      : null;
            const configuredCurrentStake = Number(state.currentStake);
            const currentStake =
                Number.isFinite(configuredCurrentStake) && configuredCurrentStake > 0
                    ? configuredCurrentStake
                    : baseStake;
            const multiplier = Number(state.martingaleMultiplier);
            const safeMultiplier = Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1.2;
            const nextStake =
                baseStake === null || currentStake === null
                    ? null
                    : isWin
                      ? baseStake
                      : state.useMartingale
                        ? Number((currentStake * safeMultiplier).toFixed(2))
                        : baseStake;

            if (baseStake !== null) state.baseStake = baseStake;
            if (nextStake !== null) state.currentStake = nextStake;
            if (this.tradeOptions && nextStake !== null) this.tradeOptions.amount = nextStake;
            state.consecutiveLosses = isWin ? 0 : Number(state.consecutiveLosses || 0) + 1;
            state.stage = isWin ? 0 : 1;
            state.virtualLosses = 0;
            state.recoveryRealMode = purchasedStage === 1 && !isWin;
            state.pendingPurchase = null;
            state.purchaseInFlight = false;
            const stopReason =
                state.targetProfit > 0 && state.sessionProfit >= state.targetProfit
                    ? 'target_profit'
                    : state.stopLoss > 0 && state.sessionProfit <= -state.stopLoss
                      ? 'stop_loss'
                      : null;
            state.stopped = Boolean(stopReason);
            const stakeLabel = value => (Number.isFinite(value) ? value.toFixed(2) : 'the configured stake');
            const virtualHookCycleEnabled = state.useVirtualHook && state.maxVirtualLosses > 0;
            const recoveryDirection = state.recoveryContractType === 'DIGITOVER' ? 'Over' : 'Under';
            const nextRecoveryAction =
                purchasedStage === 1
                    ? `Continuing real ${recoveryDirection} ${state.recoveryPrediction} recoveries until a win`
                    : virtualHookCycleEnabled
                      ? `Starting Virtual Hook ${recoveryDirection} ${state.recoveryPrediction}; ` +
                        `a real ${recoveryDirection} ${state.recoveryPrediction} recovery follows after ${state.maxVirtualLosses} consecutive virtual losses`
                      : `Starting real ${recoveryDirection} ${state.recoveryPrediction} recovery`;
            this.emitSmartOver2RecoveryEvent(
                journalScope,
                'settlement',
                isWin
                    ? `[Smart Over 2] ${stageLabel} settled WIN. Stake reset to ${stakeLabel(baseStake)}; ` +
                      `returning to condition-gated Over ${state.overPrediction} entries.`
                    : `[Smart Over 2] ${stageLabel} settled LOSS. ` +
                      `${nextRecoveryAction} at stake ${stakeLabel(nextStake)} ` +
                      `${state.useMartingale ? `with a ${safeMultiplier}× multiplier` : 'with Martingale off'}.`,
                {
                    stage: isWin ? 0 : 1,
                    outcome: isWin ? 'win' : 'loss',
                    baseStake,
                    nextStake,
                    martingaleMultiplier: safeMultiplier,
                    useMartingale: state.useMartingale,
                    consecutiveLosses: state.consecutiveLosses,
                    sessionProfit: state.sessionProfit,
                    contractId: String(settlementId),
                }
            );
            if (stopReason) {
                const stopMessage =
                    stopReason === 'target_profit'
                        ? `[Smart Over 2] Target Profit reached at ${state.sessionProfit.toFixed(2)}; stopping.`
                        : `[Smart Over 2] Stop Loss reached at ${state.sessionProfit.toFixed(2)}; stopping.`;
                this.emitSmartOver2RecoveryEvent(journalScope, 'risk_stop', stopMessage, {
                    reason: stopReason,
                    sessionProfit: state.sessionProfit,
                    targetProfit: state.targetProfit,
                    stopLoss: state.stopLoss,
                    contractId: String(settlementId),
                });
                globalObserver.emit('bot.stop_button_click');
            }
            return false;
        }
        getAnalysisDigits(count = 1000) {
            const size = Math.max(1, Math.floor(Number(count) || 1000));
            return this.getLastDigitList().then(digits => digits.slice(-size));
        }
        getMostFrequentDigit(count = 1000, mode = 'most') {
            return this.getAnalysisDigits(count).then(digits => {
                const frequencies = Array.from({ length: 10 }, (_, digit) => ({
                    digit,
                    count: digits.filter(value => Number(value) === digit).length,
                }));
                const rankingMode = String(mode).toLowerCase();
                const isLeast = rankingMode === 'least' || rankingMode === 'second_least';
                frequencies.sort((a, b) =>
                    isLeast ? a.count - b.count || a.digit - b.digit : b.count - a.count || a.digit - b.digit
                );
                const rank = rankingMode === 'second_most' || rankingMode === 'second_least' ? 1 : 0;
                return frequencies[rank]?.digit ?? frequencies[0]?.digit ?? 0;
            });
        }
        getDigitPercentage(digit, count = 1000, mode = 'match') {
            return this.getAnalysisDigits(count).then(digits => {
                const target = Number(digit);
                const matches = digits.filter(value => {
                    const isMatch = Number(value) === target;
                    return mode === 'differ' ? !isMatch : isMatch;
                }).length;
                return digits.length ? (matches / digits.length) * 100 : 0;
            });
        }
        getParityPercentage(parity, count = 1000) {
            return this.getAnalysisDigits(count).then(digits => {
                const isEven = String(parity).toLowerCase() === 'even';
                const evenCount = digits.filter(value => Number(value) % 2 === 0).length;
                const oddCount = digits.length - evenCount;
                const evenPercentage = digits.length ? (evenCount / digits.length) * 100 : 0;
                const oddPercentage = digits.length ? (oddCount / digits.length) * 100 : 0;

                globalObserver.emit('bot.analysis.parity', {
                    market: this.symbol || 'N/A',
                    count: digits.length,
                    evenPercentage: Number(evenPercentage.toFixed(0)),
                    oddPercentage: Number(oddPercentage.toFixed(0)),
                    sample: digits.slice(-Math.max(1, Number(count) || 1)),
                });

                return digits.length ? (isEven ? evenPercentage : oddPercentage) : 0;
            });
        }
        getBarrierPercentage(direction, barrier, count = 1000) {
            return this.getAnalysisDigits(count).then(digits => {
                const threshold = Number(barrier);
                const isOver = String(direction).toLowerCase() === 'over';
                const matches = digits.filter(value =>
                    isOver ? Number(value) > threshold : Number(value) < threshold
                ).length;
                return digits.length ? (matches / digits.length) * 100 : 0;
            });
        }
        getDirectionPercentage(direction, count = 1000) {
            const size = Math.max(2, Math.floor(Number(count) || 1000));
            return this.getTicks().then(ticks => {
                const recent = ticks.slice(-(size + 1));
                const isRise = String(direction).toLowerCase() === 'rise';
                const matches = recent.slice(1).filter((tick, index) => {
                    const previous = Number(recent[index]);
                    const current = Number(tick);
                    return isRise ? current > previous : current < previous;
                }).length;
                const comparisons = Math.max(0, recent.length - 1);
                return comparisons ? (matches / comparisons) * 100 : 0;
            });
        }
        getSignalConfidence(signal, count = 60) {
            const normalizedSignal = String(signal || '').toUpperCase();
            const minimum = 55;
            const remember = confidence => {
                this.lastSignalConfidenceEvaluation = {
                    signal: normalizedSignal,
                    confidence: Number(confidence) || 0,
                    minimum,
                    tick: this.purchaseConditionEvaluationTick ?? this.getPurchaseConditionTick(),
                };
                return confidence;
            };
            if (normalizedSignal !== 'CALL' && normalizedSignal !== 'PUT') return Promise.resolve(0).then(remember);
            return this.getDirectionPercentage(normalizedSignal === 'CALL' ? 'rise' : 'fall', count).then(remember);
        }
        getSignalConfidenceGate(signal, count = 60, minimumConfidence = 55) {
            const minimum = Math.max(0, Math.min(100, Number(minimumConfidence) || 55));
            return this.getSignalConfidence(signal, count).then(availableConfidence => {
                this.lastSignalConfidenceEvaluation = {
                    ...this.lastSignalConfidenceEvaluation,
                    minimum,
                };
                return Number(availableConfidence) >= minimum;
            });
        }
        getVolatilitySelectionSignal() {
            return this.volatilitySelectionLock?.signal || 'WAIT';
        }
        getPurchaseConditionTick() {
            return this.store?.getState?.().newTick ?? this.latestTick?.epoch ?? null;
        }
        getVolatilityScanOrder() {
            const preferredCode = this.volatilityPreferredMarket?.code;
            const excludedCode = this.volatilityExcludedMarket?.code;
            const preferred = DERIV_VOLATILITIES.find(volatility => volatility.code === preferredCode);
            const excluded = DERIV_VOLATILITIES.find(volatility => volatility.code === excludedCode);
            const remaining = DERIV_VOLATILITIES.filter(
                volatility => volatility.code !== preferredCode && volatility.code !== excludedCode
            );

            return [
                ...(preferred ? [preferred] : []),
                ...remaining,
                ...(excluded && excluded.code !== preferred?.code ? [excluded] : []),
            ];
        }
        prepareVolatilityRescan() {
            this.volatilityDiagnosticsToken += 1;
            const locked = this.volatilitySelectionLock;
            if (locked?.code) {
                this.volatilityPreferredMarket = {
                    code: locked.code,
                    label: locked.label,
                };
                // A settlement starts the next execution cycle, not a new
                // market-selection cycle. Keep the strongest selected market
                // locked so FAST can continue buying it without rescanning or
                // pausing between contracts. A live condition failure or an
                // explicit reset still releases this lock.
                this.resetVolatilitySelection({ preservePreferred: true, preserveSelection: true });
                return;
            }
            this.resetVolatilitySelection({ preservePreferred: true });
        }
        resetVolatilitySelection({ preservePreferred = false, preserveSelection = false } = {}) {
            this.volatilityDiagnosticsToken += 1;
            if (!preserveSelection) this.volatilitySelectionLock = null;
            if (!preservePreferred) this.volatilityPreferredMarket = null;
            this.lastSignalConfidenceEvaluation = null;
            this.purchaseIndicatorEvaluation = null;
            this.purchaseConditionEvaluationTick = null;
            this.volatilityScanIndex = 0;
            this.volatilityScanRecords = [];
        }
        beginPurchaseConditionEvaluation() {
            const evaluationTick = this.getPurchaseConditionTick();
            this.purchaseConditionEvaluationTick = evaluationTick;
            const selected = this.volatilitySelectionLock;
            if (selected && this.requiresSignalConfidence === false) {
                // The volatility scan already evaluated the selected market with
                // the authoritative MACD + ADX/RSI criteria. Keep those values
                // for this purchase cycle instead of letting a second OHLC
                // refresh silently veto the order before purchase() is called.
                this.purchaseIndicatorEvaluation = {
                    adx: Number(selected.adx),
                    rsi: Number(selected.rsi),
                    macd: Number(selected.macd),
                    tick: evaluationTick,
                };
            }
        }
        releaseVolatilitySelection(reason = 'conditions_failed') {
            const locked = this.volatilitySelectionLock;
            if (!locked) return;
            const rejectedCode = locked.code;

            const conditionSnapshot = this.getVolatilityConditionSnapshot?.(locked.signal);
            globalObserver.emit('bot.volatility.scan', {
                event: 'rejected',
                market: locked.code,
                label: locked.label,
                signal: locked.signal,
                confidence: locked.confidence,
                adx: locked.adx,
                rsi: locked.rsi,
                macd: locked.macd,
                ...conditionSnapshot,
                reason,
            });
            this.resetVolatilitySelection();
            if (['live_conditions_failed', 'proposals_not_ready'].includes(reason) && rejectedCode) {
                this.volatilityExcludedMarket = {
                    code: rejectedCode,
                    label: locked.label,
                };
            }
        }
        async restoreLockedVolatilitySelection() {
            const locked = this.volatilitySelectionLock;
            if (!locked) return false;

            if (
                this.symbol !== locked.code ||
                this.options?.symbol !== locked.code ||
                this.tradeOptions?.symbol !== locked.code
            ) {
                await this.watchTicks(locked.code);
                this.options = { ...this.options, symbol: locked.code };
                this.tradeOptions = { ...this.tradeOptions, symbol: locked.code };
                this.makeProposals?.({ ...this.options, ...this.tradeOptions });
            }

            return true;
        }
        recordIndicatorValue(indicator, value) {
            if (
                this.volatilitySelectionLock &&
                this.requiresSignalConfidence === false &&
                this.purchaseIndicatorEvaluation
            ) {
                const selectedValue = Number(this.purchaseIndicatorEvaluation[indicator]);
                return Number.isFinite(selectedValue) ? selectedValue : value;
            }
            this.purchaseIndicatorEvaluation = {
                ...(this.purchaseIndicatorEvaluation || {}),
                [indicator]: Number(value),
                tick: this.purchaseConditionEvaluationTick ?? this.getPurchaseConditionTick(),
            };
            return value;
        }
        getVolatilityConditionSnapshot(contractType) {
            const lock = this.volatilitySelectionLock;
            const confidence = this.lastSignalConfidenceEvaluation;
            const indicators = this.purchaseIndicatorEvaluation;
            if (!lock && !confidence && !indicators) return null;

            const signal = String(contractType || confidence?.signal || lock?.signal || '').toUpperCase();
            const isPut = signal === 'PUT';
            const confidenceRequired = this.requiresSignalConfidence !== false;
            const finiteOrNull = value => (Number.isFinite(Number(value)) ? Number(value) : null);
            const availableConfidence = confidenceRequired
                ? finiteOrNull(confidence?.confidence ?? lock?.confidence)
                : null;
            const minimumConfidence = confidenceRequired
                ? finiteOrNull(confidence?.minimum ?? lock?.minimumConfidence ?? 55)
                : null;
            const availableAdx = finiteOrNull(indicators?.adx ?? lock?.adx);
            const minimumAdx = finiteOrNull(lock?.minimumAdx ?? 20);
            const availableRsi = finiteOrNull(indicators?.rsi ?? lock?.rsi);
            const availableMacd = finiteOrNull(indicators?.macd ?? lock?.macd);
            const adxPass = availableAdx !== null && minimumAdx !== null && availableAdx >= minimumAdx;
            const rsiPass = availableRsi !== null && (isPut ? availableRsi < 50 : availableRsi > 50);
            const macdPass = availableMacd !== null && (isPut ? availableMacd < 0 : availableMacd > 0);

            return {
                signal: signal || 'WAIT',
                availableConfidence,
                minimumConfidence,
                availableAdx,
                minimumAdx,
                availableRsi,
                minimumRsi: 50,
                rsiOperator: isPut ? '<' : '>',
                availableMacd,
                minimumMacd: 0,
                macdOperator: isPut ? '<' : '>',
                conditionsPassed:
                    signal !== 'WAIT' &&
                    (!confidenceRequired ||
                        (availableConfidence !== null &&
                            minimumConfidence !== null &&
                            availableConfidence >= minimumConfidence)) &&
                    macdPass &&
                    (adxPass || rsiPass),
            };
        }
        isPurchaseConditionValuesGateOpen(contractType) {
            if (!['CALL', 'PUT'].includes(contractType)) return true;

            if (this.volatilitySelectionLock && this.requiresSignalConfidence === false) {
                return true;
            }

            if (this.requiresSignalConfidence !== false) {
                const confidence = this.lastSignalConfidenceEvaluation;
                if (confidence && (confidence.signal !== contractType || confidence.confidence < confidence.minimum)) {
                    return false;
                }
            }

            const indicators = this.purchaseIndicatorEvaluation;
            if (!indicators) return true;

            const hasAnyIndicator = ['adx', 'rsi', 'macd'].some(indicator => Number.isFinite(indicators[indicator]));
            if (!hasAnyIndicator) return true;

            const adxPass = Number.isFinite(indicators.adx) && indicators.adx >= 20;
            const rsiPass =
                Number.isFinite(indicators.rsi) &&
                (contractType === 'CALL' ? indicators.rsi > 50 : indicators.rsi < 50);
            const macdPass =
                Number.isFinite(indicators.macd) &&
                (contractType === 'CALL' ? indicators.macd > 0 : indicators.macd < 0);

            return macdPass && (adxPass || rsiPass);
        }
        isPurchaseConditionGateOpen(contractType) {
            if (!['CALL', 'PUT'].includes(contractType)) return true;

            const lockedSymbol = this.volatilitySelectionLock?.code;
            const purchaseSymbol = this.tradeOptions?.symbol || this.options?.symbol || this.symbol;
            if (lockedSymbol && (purchaseSymbol !== lockedSymbol || this.symbol !== lockedSymbol)) return false;

            const currentTick = this.getPurchaseConditionTick();
            const evaluationTick = this.purchaseConditionEvaluationTick ?? currentTick;
            const confidence = this.lastSignalConfidenceEvaluation;
            if (
                this.requiresSignalConfidence !== false &&
                confidence?.tick !== null &&
                confidence?.tick !== undefined &&
                evaluationTick !== null &&
                confidence.tick !== evaluationTick
            ) {
                return false;
            }
            const indicators = this.purchaseIndicatorEvaluation;
            if (
                indicators?.tick !== null &&
                indicators?.tick !== undefined &&
                evaluationTick !== null &&
                indicators.tick !== evaluationTick
            ) {
                return false;
            }

            return this.isPurchaseConditionValuesGateOpen(contractType);
        }
        async getVolatilityMarketRecord(
            volatility,
            { windowSize, adxMinimum, confidenceRequired, minimum }
        ) {
            const activeSymbols = Array.isArray(api_base.active_symbols) ? api_base.active_symbols : [];
            const activeRecord = activeSymbols.find(record => record?.symbol === volatility.code);
            if (
                activeRecord &&
                (activeRecord.exchange_is_open === false ||
                    activeRecord.is_trading_suspended === 1 ||
                    activeRecord.is_trading_suspended === true)
            ) {
                return {
                    ...volatility,
                    qualifies: false,
                    reason: 'market_closed',
                };
            }

            try {
                let ticks;
                let historyError;
                for (let attempt = 0; attempt <= VOLATILITY_SCAN_HISTORY_RETRIES; attempt += 1) {
                    try {
                        ticks = await this.$scope.ticksService.request({
                            symbol: volatility.code,
                            subscribe: false,
                            force: attempt > 0,
                            count: windowSize + 1,
                        });
                        const numericTickCount = Array.isArray(ticks)
                            ? ticks.filter(tick => Number.isFinite(Number(tick?.quote))).length
                            : 0;
                        if (numericTickCount >= windowSize + 1 || attempt === VOLATILITY_SCAN_HISTORY_RETRIES) {
                            break;
                        }
                    } catch (error) {
                        historyError = error;
                        if (attempt < VOLATILITY_SCAN_HISTORY_RETRIES) {
                            await wait(350 * (attempt + 1));
                        }
                    }
                }
                if (!ticks) throw historyError || new Error('History response was empty');

                const prices = ticks.map(tick => Number(tick.quote)).filter(Number.isFinite);
                const recent = prices.slice(-(windowSize + 1));
                if (recent.length < windowSize + 1) {
                    return {
                        ...volatility,
                        qualifies: false,
                        reason: 'insufficient_history',
                    };
                }

                const moves = recent.slice(1).map((price, index) => {
                    const previous = recent[index];
                    return price > previous ? 1 : price < previous ? -1 : 0;
                });
                const rises = (moves.filter(move => move > 0).length / moves.length) * 100;
                const falls = (moves.filter(move => move < 0).length / moves.length) * 100;
                const signal = rises >= falls ? 'CALL' : 'PUT';
                const confidence = signal === 'CALL' ? rises : falls;
                const pipSize = Number(api_base.pip_sizes?.[volatility.code]) || 0;
                const adx = adxSnapshot(prices, { periods: 14, pipSize })?.adx ?? 0;
                const rsi = rsiSnapshot(prices, { periods: 14, pipSize }) ?? 0;
                const macd = macdSnapshot(prices, {
                    fastEmaPeriod: 12,
                    slowEmaPeriod: 26,
                    signalEmaPeriod: 9,
                    pipSize,
                })?.histogram ?? 0;
                const adxPass = Number(adx) >= adxMinimum;
                const rsiPass = signal === 'CALL' ? Number(rsi) > 50 : Number(rsi) < 50;
                const macdPass = signal === 'CALL' ? Number(macd) > 0 : Number(macd) < 0;
                const indicatorsPass = macdPass && (adxPass || rsiPass);
                const isRecentlyRejected = this.volatilityExcludedMarket?.code === volatility.code;
                const qualifies =
                    !isRecentlyRejected &&
                    indicatorsPass &&
                    (!confidenceRequired || confidence >= minimum);

                return {
                    ...volatility,
                    executionPrices: recent,
                    signal,
                    confidence,
                    adx: Number(adx),
                    rsi: Number(rsi),
                    macd: Number(macd),
                    qualifies,
                    reason: isRecentlyRejected
                        ? 'recently_rejected'
                        : qualifies
                          ? 'qualified'
                          : confidenceRequired && confidence < minimum
                            ? 'confidence_below_threshold'
                            : 'indicator_confirmation_failed',
                };
            } catch (error) {
                const cachedRecord = this.volatilityMarketSnapshots?.get?.(volatility.code);
                const brokerError = error?.error ?? error;
                const errorCode = brokerError?.code ?? brokerError?.name ?? 'UNKNOWN';
                const errorMessage = String(
                    brokerError?.message ?? brokerError?.msg ?? error?.message ?? 'History request failed'
                );
                globalObserver.emit('bot.volatility.scan', {
                    event: 'error',
                    market: volatility.code,
                    label: volatility.label,
                    errorCode,
                    errorMessage,
                });
                return cachedRecord
                    ? {
                          ...cachedRecord,
                          ...volatility,
                          qualifies: false,
                          reason: 'history_refresh_failed',
                          errorCode,
                          errorMessage,
                      }
                    : {
                          ...volatility,
                          qualifies: false,
                          reason: 'history_request_failed',
                          errorCode,
                          errorMessage,
                      };
            }
        }
        saveVolatilityMarketSnapshot(record) {
            if (!this.volatilityMarketSnapshots) this.volatilityMarketSnapshots = new Map();
            if (
                record.reason !== 'history_request_failed' &&
                record.reason !== 'history_refresh_failed' &&
                record.reason !== 'insufficient_history'
            ) {
                this.volatilityMarketSnapshots.set(record.code, record);
            }
        }
        emitVolatilityMarketRecord(
            record,
            marketIndex,
            marketTotal,
            qualifiedCount,
            minimumAdx,
            { diagnostic = false } = {}
        ) {
            globalObserver.emit('bot.volatility.scan', {
                event: 'market',
                market: record.code,
                label: record.label,
                signal: record.signal,
                confidence: record.confidence,
                adx: record.adx,
                rsi: record.rsi,
                macd: record.macd,
                minimumAdx,
                minimumRsi: 50,
                minimumMacd: 0,
                rsiOperator: record.signal === 'PUT' ? '<' : '>',
                macdOperator: record.signal === 'PUT' ? '<' : '>',
                conditionsPassed: record.qualifies,
                qualifies: record.qualifies,
                reason: record.reason,
                marketIndex,
                marketTotal,
                qualifiedCount,
                diagnostic,
                candidate: !diagnostic,
            });
        }
        getVolatilityRecordStrength(record, minimumAdx = 20) {
            const signal = String(record?.signal || '').toUpperCase();
            const adx = Number(record?.adx);
            const rsi = Number(record?.rsi);
            const macd = Number(record?.macd);
            const confidence = Number(record?.confidence);
            const adxPass = Number.isFinite(adx) && adx >= minimumAdx;
            const rsiPass =
                Number.isFinite(rsi) && (signal === 'PUT' ? rsi < 50 : signal === 'CALL' ? rsi > 50 : false);
            const macdPass =
                Number.isFinite(macd) && (signal === 'PUT' ? macd < 0 : signal === 'CALL' ? macd > 0 : false);

            return {
                indicatorPassCount: [adxPass, rsiPass, macdPass].filter(Boolean).length,
                confidence: Number.isFinite(confidence) ? confidence : 0,
                adxMargin: Number.isFinite(adx) ? adx - minimumAdx : Number.NEGATIVE_INFINITY,
                rsiMargin: Number.isFinite(rsi) ? Math.abs(rsi - 50) : Number.NEGATIVE_INFINITY,
                macdMagnitude: Number.isFinite(macd) ? Math.abs(macd) : Number.NEGATIVE_INFINITY,
            };
        }
        async scanRemainingVolatilityMarkets(scanOrder, startIndex, options, token) {
            for (let index = startIndex; index < scanOrder.length; index += 1) {
                if (token !== this.volatilityDiagnosticsToken) return;
                const volatility = scanOrder[index];
                const record = await this.getVolatilityMarketRecord(volatility, options);
                this.saveVolatilityMarketSnapshot(record);
                this.emitVolatilityMarketRecord(
                    record,
                    index + 1,
                    scanOrder.length,
                    0,
                    options.adxMinimum,
                    { diagnostic: true }
                );
                if (index < scanOrder.length - 1) {
                    await wait(this.volatilityScanRequestGapMs ?? VOLATILITY_SCAN_REQUEST_GAP_MS);
                }
            }
        }
        startVolatilityDiagnostics(scanOrder, startIndex, options) {
            const token = ++this.volatilityDiagnosticsToken;
            this.volatilityDiagnosticsPromise = this.scanRemainingVolatilityMarkets(
                scanOrder,
                startIndex,
                options,
                token
            ).finally(() => {
                if (token === this.volatilityDiagnosticsToken) {
                    this.volatilityDiagnosticsPromise = null;
                }
            });
        }
        async activateVolatilitySelection(
            selected,
            { minimum, adxMinimum, confidenceRequired, windowSize, marketCount, qualifiedCount }
        ) {
            this.volatilityPreferredMarket = {
                code: selected.code,
                label: selected.label,
            };
            this.volatilityExcludedMarket = null;
            const strength = this.getVolatilityRecordStrength(selected, adxMinimum);
            globalObserver.emit('bot.volatility.scan', {
                event: 'scan',
                marketCount,
                qualifiedCount,
                minimumConfidence: confidenceRequired ? minimum : null,
                windowSize,
                minimumAdx: adxMinimum,
                selected: {
                    symbol: selected.code,
                    label: selected.label,
                    signal: selected.signal,
                    confidence: selected.confidence,
                    adx: selected.adx,
                    rsi: selected.rsi,
                    macd: selected.macd,
                    minimumConfidence: minimum,
                    minimumAdx: adxMinimum,
                    minimumRsi: 50,
                    minimumMacd: 0,
                    rsiOperator: selected.signal === 'PUT' ? '<' : '>',
                    macdOperator: selected.signal === 'PUT' ? '<' : '>',
                    conditionsPassed: true,
                    indicatorPassCount: strength.indicatorPassCount,
                },
                selectionPolicy: 'strongest_qualified',
            });

            if (
                this.symbol !== selected.code ||
                this.options?.symbol !== selected.code ||
                this.tradeOptions?.symbol !== selected.code
            ) {
                await this.watchTicks(selected.code);
                this.options = { ...this.options, symbol: selected.code };
                this.tradeOptions = { ...this.tradeOptions, symbol: selected.code };
                this.makeProposals({ ...this.options, ...this.tradeOptions });
            }
            this.volatilitySelectionLock = {
                code: selected.code,
                label: selected.label,
                executionPrices: selected.executionPrices,
                signal: selected.signal,
                confidence: selected.confidence,
                adx: selected.adx,
                rsi: selected.rsi,
                macd: selected.macd,
                minimumConfidence: minimum,
                minimumAdx: adxMinimum,
            };
            if (
                this.is_proposal_subscription_required &&
                !(await this.waitForProposalsReady?.())
            ) {
                this.releaseVolatilitySelection('proposals_not_ready');
                return false;
            }
            this.beginPurchaseConditionEvaluation();
            return true;
        }
        async scanVolatilityUntilQualified(
            minimumConfidence = 55,
            count = 60,
            minimumAdx = 20,
            requireConfidence = true
        ) {
            if (this.volatilityScanPromise) return this.volatilityScanPromise;

            if (this.volatilitySelectionLock) {
                const previousEvaluation = this.lastSignalConfidenceEvaluation;
                if (
                    previousEvaluation?.signal &&
                    ['CALL', 'PUT'].includes(previousEvaluation.signal) &&
                    !this.isPurchaseConditionValuesGateOpen(previousEvaluation.signal)
                ) {
                    this.releaseVolatilitySelection('live_conditions_failed');
                } else {
                    await this.restoreLockedVolatilitySelection();
                    if (
                        this.is_proposal_subscription_required &&
                        !(await this.waitForProposalsReady?.())
                    ) {
                        this.releaseVolatilitySelection('proposals_not_ready');
                        return false;
                    }
                    this.beginPurchaseConditionEvaluation();
                    return true;
                }
            }

            const confidenceRequired = requireConfidence !== false;
            const minimum = confidenceRequired
                ? Math.max(0, Math.min(100, Number(minimumConfidence) || 55))
                : null;
            const windowSize = Math.max(2, Math.floor(Number(count) || 60));
            const adxMinimum = Math.max(0, Number(minimumAdx) || 20);
            const scanOrder = this.getVolatilityScanOrder();
            const scan = async () => {
                const marketIndex = this.volatilityScanIndex;
                const volatility = scanOrder[marketIndex];
                if (!volatility) {
                    this.volatilityScanIndex = 0;
                    this.volatilityScanRecords = [];
                    return false;
                }

                globalObserver.emit('bot.volatility.scan', {
                    event: 'checking',
                    market: volatility.code,
                    label: volatility.label,
                    marketIndex: marketIndex + 1,
                    marketTotal: DERIV_VOLATILITIES.length,
                    completedCount: this.volatilityScanRecords.length,
                    qualifiedCount: this.volatilityScanRecords.filter(record => record.qualifies).length,
                });

                const record = await this.getVolatilityMarketRecord(volatility, {
                    windowSize,
                    adxMinimum,
                    confidenceRequired,
                    minimum,
                });

                if (!this.volatilityMarketSnapshots) this.volatilityMarketSnapshots = new Map();
                if (
                    record.reason !== 'history_request_failed' &&
                    record.reason !== 'history_refresh_failed' &&
                    record.reason !== 'insufficient_history'
                ) {
                    this.volatilityMarketSnapshots.set(volatility.code, record);
                }
                this.volatilityScanRecords.push(record);
                this.volatilityScanIndex += 1;
                globalObserver.emit('bot.volatility.scan', {
                    event: 'market',
                    market: record.code,
                    label: record.label,
                    signal: record.signal,
                    confidence: record.confidence,
                    adx: record.adx,
                    rsi: record.rsi,
                    macd: record.macd,
                    minimumAdx: adxMinimum,
                    minimumRsi: 50,
                    minimumMacd: 0,
                    rsiOperator: record.signal === 'PUT' ? '<' : '>',
                    macdOperator: record.signal === 'PUT' ? '<' : '>',
                    conditionsPassed: record.qualifies,
                    qualifies: record.qualifies,
                    reason: record.reason,
                    marketIndex: this.volatilityScanIndex,
                    marketTotal: scanOrder.length,
                    qualifiedCount: this.volatilityScanRecords.filter(item => item.qualifies).length,
                    candidate: true,
                });

                if (this.volatilityScanIndex < scanOrder.length) {
                    await wait(this.volatilityScanRequestGapMs ?? VOLATILITY_SCAN_REQUEST_GAP_MS);
                    return scan();
                }

                const records = this.volatilityScanRecords;
                const qualified = records
                    .filter(record => record.qualifies)
                    .sort((left, right) => {
                        const leftStrength = this.getVolatilityRecordStrength(left, adxMinimum);
                        const rightStrength = this.getVolatilityRecordStrength(right, adxMinimum);
                        return (
                            rightStrength.indicatorPassCount - leftStrength.indicatorPassCount ||
                            rightStrength.confidence - leftStrength.confidence ||
                            rightStrength.adxMargin - leftStrength.adxMargin ||
                            rightStrength.rsiMargin - leftStrength.rsiMargin ||
                            rightStrength.macdMagnitude - leftStrength.macdMagnitude ||
                            records.indexOf(left) - records.indexOf(right)
                        );
                    });
                const selected = qualified[0] || null;
                this.volatilityScanIndex = 0;
                this.volatilityScanRecords = [];
                if (selected) {
                    this.volatilityPreferredMarket = {
                        code: selected.code,
                        label: selected.label,
                    };
                    this.volatilityExcludedMarket = null;
                } else {
                    this.volatilityPreferredMarket = null;
                    this.volatilityExcludedMarket = null;
                }
                globalObserver.emit('bot.volatility.scan', {
                    event: 'scan',
                    marketCount: records.length,
                    qualifiedCount: qualified.length,
                               minimumConfidence: confidenceRequired ? minimum : null,
                    windowSize,
                    minimumAdx: adxMinimum,
                    selected: selected
                        ? {
                              symbol: selected.code,
                              label: selected.label,
                              signal: selected.signal,
                              confidence: selected.confidence,
                              adx: selected.adx,
                              rsi: selected.rsi,
                              macd: selected.macd,
                              minimumConfidence: minimum,
                              minimumAdx: adxMinimum,
                              minimumRsi: 50,
                              minimumMacd: 0,
                              rsiOperator: selected.signal === 'PUT' ? '<' : '>',
                              macdOperator: selected.signal === 'PUT' ? '<' : '>',
                               conditionsPassed: true,
                               indicatorPassCount: this.getVolatilityRecordStrength(selected, adxMinimum)
                                   .indicatorPassCount,
                          }
                        : null,
                    selectionPolicy: 'strongest_qualified',
                });
                if (!selected) {
                    return false;
                }

                if (
                    this.symbol !== selected.code ||
                    this.options?.symbol !== selected.code ||
                    this.tradeOptions?.symbol !== selected.code
                ) {
                    await this.watchTicks(selected.code);
                    this.options = { ...this.options, symbol: selected.code };
                    this.tradeOptions = { ...this.tradeOptions, symbol: selected.code };
                    this.makeProposals({ ...this.options, ...this.tradeOptions });
                }
                this.volatilitySelectionLock = {
                    code: selected.code,
                    label: selected.label,
                    executionPrices: selected.executionPrices,
                    signal: selected.signal,
                    confidence: selected.confidence,
                    adx: selected.adx,
                    rsi: selected.rsi,
                    macd: selected.macd,
                    minimumConfidence: minimum,
                    minimumAdx: adxMinimum,
                };
                if (
                    this.is_proposal_subscription_required &&
                    !(await this.waitForProposalsReady?.())
                ) {
                    this.releaseVolatilitySelection('proposals_not_ready');
                    return false;
                }
                this.beginPurchaseConditionEvaluation();
                return true;
            };

            this.volatilityScanPromise = scan().finally(() => {
                this.volatilityScanPromise = null;
            });
            return this.volatilityScanPromise;
        }
        async scanVolatilityUntilIndicatorsPass(minimumAdx = 20) {
            this.requiresSignalConfidence = false;
            return this.scanVolatilityUntilQualified(undefined, 60, minimumAdx, false);
        }
        checkLastNTicksDirection(direction, count = 5) {
            const size = Math.max(1, Math.floor(Number(count) || 5));
            return this.getTicks().then(ticks => {
                const recent = ticks.slice(-(size + 1));
                const isRise = String(direction).toLowerCase() === 'rise';
                return (
                    recent.length >= size + 1 &&
                    recent.slice(1).every((tick, index) => {
                        const previous = Number(recent[index]);
                        const current = Number(tick);
                        return isRise ? current > previous : current < previous;
                    })
                );
            });
        }
        getAdaptiveMomentumSignal(warmup = 30, shortWindow = 8, longWindow = 20, confidence = 60) {
            return this.getTicks().then(ticks => {
                this.adaptiveMomentumActive = true;
                const analysis = getAdaptiveMomentumAnalysisFromPrices(
                    ticks,
                    warmup,
                    shortWindow,
                    longWindow,
                    confidence
                );
                adaptiveMomentumLog({
                    event: 'analysis',
                    market: this.symbol || 'N/A',
                    ...analysis,
                });

                if (this.lastAdaptiveMomentumSignal !== analysis.signal) {
                    adaptiveMomentumLog({
                        event: 'decision',
                        market: this.symbol || 'N/A',
                        signal: analysis.signal,
                        reason: analysis.reason,
                        signalConfidence: analysis.signalConfidence,
                        confidence: analysis.confidence,
                    });
                    if (analysis.signal === 'WAIT') {
                        adaptiveMomentumLog({
                            event: 'skip',
                            market: this.symbol || 'N/A',
                            reason: analysis.reason,
                            signalConfidence: analysis.signalConfidence,
                            confidence: analysis.confidence,
                        });
                    }
                    this.lastAdaptiveMomentumSignal = analysis.signal;
                }

                return analysis.signal;
            });
        }
        getNthLastDigit(n = 1) {
            const index = Math.max(1, Math.floor(Number(n) || 1));
            return this.getLastDigitList().then(digits => digits[digits.length - index] ?? 0);
        }
        getLastDigitsFromList(ticks) {
            const digits = ticks.map(tick => {
                return getLastDigit(tick.toFixed(this.getPipSize()));
            });
            return digits;
        }

        checkDirection(dir) {
            return new Promise(resolve =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol })
                    .then(ticks => resolve(getDirection(ticks) === dir))
            );
        }

        getOhlc(args) {
            const { granularity = this.options.candleInterval || 60, field } = args || {};
            const locked = this.volatilitySelectionLock;
            if (this.fastClockActive && locked?.executionPrices?.length && Number(granularity) === 60) {
                const ohlc = locked.executionPrices.map(quote => ({
                    open: quote,
                    high: quote,
                    low: quote,
                    close: quote,
                }));
                return Promise.resolve(field ? ohlc.map(candle => candle[field]) : ohlc);
            }

            return new Promise(resolve =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol, granularity })
                    .then(ohlc => resolve(field ? ohlc.map(o => o[field]) : ohlc))
            );
        }

        getOhlcFromEnd(args) {
            const { index: i = 1 } = args || {};

            const index = expectPositiveInteger(Number(i), localize('Index must be a positive integer'));

            return new Promise(resolve => this.getOhlc(args).then(ohlc => resolve(ohlc.slice(-index)[0])));
        }

        getPipSize() {
            return this.$scope.ticksService.pipSizes[this.symbol];
        }

        async requestAccumulatorStats() {
            const subscription_id = this.subscription_id_for_accumulators;
            const is_proposal_requested = this.is_proposal_requested_for_accumulators;
            const proposal_request = {
                ...window.Blockly.accumulators_request,
                amount: this?.tradeOptions?.amount,
                basis: this?.tradeOptions?.basis,
                contract_type: 'ACCU',
                currency: this?.tradeOptions?.currency,
                growth_rate: this?.tradeOptions?.growth_rate,
                proposal: 1,
                subscribe: 1,
                underlying_symbol: this?.tradeOptions?.symbol,
            };
            if (!subscription_id && !is_proposal_requested) {
                this.is_proposal_requested_for_accumulators = true;
                if (proposal_request) {
                    await api_base?.api?.send(proposal_request);
                }
            }
        }

        async handleOnMessageForAccumulators() {
            let ticks_stayed_in_list = [];
            return new Promise(resolve => {
                const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                    if (data.msg_type === 'proposal') {
                        try {
                            this.subscription_id_for_accumulators = data.subscription.id;
                            // this was done because we can multile arrays in the respone and the list comes in reverse order
                            const stat_list = (data.proposal.contract_details.ticks_stayed_in || []).flat().reverse();
                            ticks_stayed_in_list = [...stat_list, ...ticks_stayed_in_list];
                            if (ticks_stayed_in_list.length > 0) resolve(ticks_stayed_in_list);
                        } catch (error) {
                            globalObserver.emit('Unexpected message type or no proposal found:', error);
                        }
                    }
                });
                api_base.pushSubscription(subscription);
            });
        }

        async fetchStatsForAccumulators() {
            try {
                // request stats for accumulators
                const debouncedAccumulatorsRequest = debounce(() => this.requestAccumulatorStats(), 300);
                debouncedAccumulatorsRequest();
                // wait for proposal response
                const ticks_stayed_in_list = await this.handleOnMessageForAccumulators();
                return ticks_stayed_in_list;
            } catch (error) {
                globalObserver.emit('Error in subscription promise:', error);
                throw error;
            } finally {
                // forget all proposal subscriptions so we can fetch new stats data on new call
                await api_base?.api?.send({ forget_all: 'proposal' });
                this.is_proposal_requested_for_accumulators = false;
                this.subscription_id_for_accumulators = null;
            }
        }

        async getCurrentStat() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                return ticks_stayed_in?.[0];
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getStatList() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                // we need to send only lastest 100 ticks
                return ticks_stayed_in?.slice(0, 100);
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getDelayTickValue(tick_value) {
            return new Promise((resolve, reject) => {
                try {
                    const ticks = [];
                    const symbol = this.symbol;

                    const resolveAndExit = () => {
                        this.$scope.ticksService.stopMonitor({
                            symbol,
                            key: '',
                        });
                        resolve(ticks);
                        ticks.length = 0;
                    };

                    const watchTicks = tick_list => {
                        ticks.push(tick_list);
                        const current_tick = ticks.length;
                        if (current_tick === tick_value) {
                            resolveAndExit();
                        }
                    };

                    const delayExecution = tick_list => watchTicks(tick_list);

                    if (Number(tick_value) <= 0) resolveAndExit();
                    this.$scope.ticksService.monitor({ symbol, callback: delayExecution });
                } catch (error) {
                    reject(new Error(`Failed to start tick monitoring: ${error.message}`));
                }
            });
        }
    };

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

export const getAdaptiveMomentumSignalFromPrices = (
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

    if (numericPrices.length < minimumHistory) return 'WAIT';

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

    if (shortBias >= minimumConfidence && longBias > 0) return 'CALL';
    if (shortBias <= -minimumConfidence && longBias < 0) return 'PUT';
    return 'WAIT';
};

export default Engine =>
    class Ticks extends Engine {
        constructor(...args) {
            super(...args);
            this.tickListenerKey = null;
            this.latestTick = null;
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
                return getAdaptiveMomentumSignalFromPrices(ticks, warmup, shortWindow, longWindow, confidence);
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

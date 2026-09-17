// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { botNotification } from '@/components/bot-notification/bot-notification';
import { notification_message } from '@/components/bot-notification/bot-notification-utils';
import { generateOAuthURL, isSafari, mobileOSDetect, standalone_routes } from '@/components/shared';
import { contract_stages, TContractStage } from '@/constants/contract-stage';
import { run_panel } from '@/constants/run-panel';
import { ErrorTypes, MessageTypes, observer, unrecoverable_errors } from '@/external/bot-skeleton';
import { getSelectedTradeType } from '@/external/bot-skeleton/scratch/utils';
import { handleBackendError, isBackendError } from '@/utils/error-handler';
// import { journalError, switch_account_notification } from '@/utils/bot-notifications';
import GTM from '@/utils/gtm';
import { helpers } from '@/utils/store-helpers';
import { generateUrlWithRedirect } from '@/utils/url-redirect-utils';
import { BinaryMatrixEngine, type BinaryMatrixConfig, type BinaryMatrixStatus } from '@/utils/binary-matrix-engine';
import { readBlocklyNumberVariable } from '@/utils/binary-matrix-settings';
import type { DTPosition } from '@/utils/dtrader-engine';
import { Buy, ProposalOpenContract } from '@deriv/api-types';
import { TStores } from '@deriv/stores/types';
import { localize } from '@deriv-com/translations';
import { TDbot } from 'Types';
import RootStore from './root-store';

export type TLastDigitsAnalysis = {
    market: string;
    condition: string;
    count: number;
    compareValue: number;
    digits: number[];
    result: boolean;
    purchaseMapping?: string | null;
};

export type TParityAnalysis = {
    market: string;
    count: number;
    evenPercentage: number;
    oddPercentage: number;
    sample: number[];
};

type TPurchaseMapping = {
    contractType: string;
    prediction: number | string | null;
    label: string;
};

export type TContractState = {
    buy?: Buy;
    contract?: ProposalOpenContract;
    data: number;
    id: string;
};

export default class RunPanelStore {
    root_store: RootStore;
    dbot: TDbot;
    core: TStores;
    disposeReactionsFn: () => void;
    timer: NodeJS.Timeout | null;

    constructor(root_store: RootStore, core: TStores) {
        makeObservable(this, {
            active_index: observable,
            contract_stage: observable,
            dialog_options: observable,
            has_open_contract: observable,
            is_running: observable,
            is_statistics_info_modal_open: observable,
            is_drawer_open: observable,
            is_dialog_open: observable,
            is_sell_requested: observable,
            run_id: observable,
            error_type: observable,
            show_bot_stop_message: observable,
            is_stop_button_visible: computed,
            is_stop_button_disabled: computed,
            is_clear_stat_disabled: computed,
            toggleDrawer: action,
            onBotSellEvent: action,
            setContractStage: action,
            setHasOpenContract: action,
            setIsRunning: action,
            onRunButtonClick: action,
            onPauseButtonClick: action,
            is_contract_buying_in_progress: observable,
             last_digits_analysis: observable,
             parity_analysis: observable,
             is_paused: observable,
             native_bot_stop_handler: observable,
             native_bot_pause_handler: observable,
            SetpurchaseInProgress: action,
            onStopButtonClick: action,
            onClearStatClick: action,
            clearStat: action,
            toggleStatisticsInfoModal: action,
            setActiveTabIndex: action,
            onCloseDialog: action,
            stopMyBot: action,
            closeMultiplierContract: action,
            showStopMultiplierContractDialog: action,
            showLoginDialog: action,
            showRealAccountDialog: action,
            showClearStatDialog: action,
            showIncompatibleStrategyDialog: action,
            showContractUpdateErrorDialog: action,
            registerBotListeners: action,
            registerReactions: action,
            onBotRunningEvent: action,
            onBotStopEvent: action,
            onBotReadyEvent: action,
            onBotTradeAgain: action,
            onContractStatusEvent: action,
            onClickSell: action,
            clear: action,
            onBotContractEvent: action,
            onError: action,
            onLastDigitsAnalysis: action.bound,
            onParityAnalysis: action.bound,
             onPurchaseMapping: action.bound,
             onAdaptiveMomentumJournalLog: action.bound,
            clearLastDigitsAnalysis: action,
            showErrorMessage: action,
            switchToJournal: action,
            unregisterBotListeners: action,
            handleInvalidToken: action,
            preloadAudio: action,
            onMount: action,
            onUnmount: action,
             registerNativeBot: action,
             updateNativeBot: action,
             unregisterNativeBot: action,
             startNativeApolloBot: action,
        });

        this.root_store = root_store;
        this.dbot = this.root_store.dbot;
        this.core = core;
        this.disposeReactionsFn = this.registerReactions();
        this.timer = null;
    }

    active_index = 0;
    contract_stage: TContractStage = contract_stages.NOT_RUNNING;
    dialog_options = {};
    has_open_contract = false;
    is_running = false;
    is_statistics_info_modal_open = false;
    is_drawer_open = true;
    is_dialog_open = false;
    is_sell_requested = false;
    show_bot_stop_message = false;
    is_contract_buying_in_progress = false;
    is_paused = false;
    native_bot_stop_handler: (() => void) | null = null;
    native_bot_pause_handler: ((paused: boolean) => void) | null = null;
    native_apollo_engine: BinaryMatrixEngine | null = null;
    last_digits_analysis: TLastDigitsAnalysis | null = null;
    parity_analysis: TParityAnalysis | null = null;

    run_id = '';
    onOkButtonClick: (() => void) | null = null;
    onCancelButtonClick: (() => void) | null = null;

    // when error happens, if it is unrecoverable_errors we reset run-panel
    // we activate run-button and clear trade info and set the ContractStage to NOT_RUNNING
    // otherwise we keep opening new contracts and set the ContractStage to PURCHASE_SENT
    error_type: ErrorTypes | undefined = undefined;

    get is_stop_button_visible() {
        return this.is_running || this.has_open_contract;
    }

    get is_stop_button_disabled() {
        if (this.is_contract_buying_in_progress) {
            return false;
        }
        return [contract_stages.PURCHASE_SENT as number, contract_stages.IS_STOPPING as number].includes(
            this.contract_stage
        );
    }

    get is_clear_stat_disabled() {
        const { journal, transactions } = this.root_store;

        return (
            this.is_running ||
            this.has_open_contract ||
            (journal.unfiltered_messages.length === 0 && transactions?.transactions?.length === 0)
        );
    }

    setShowBotStopMessage = (show_bot_stop_message: boolean) => {
        this.show_bot_stop_message = show_bot_stop_message;
        if (!show_bot_stop_message) return;
        const handleNotificationClick = () => {
            const contract_type = getSelectedTradeType();
            const baseUrl = `${standalone_routes.positions}?contract_type_bots=${contract_type}`;

            // Use generateUrlWithRedirect to add redirect parameter and account_type from localStorage
            const urlWithRedirect = generateUrlWithRedirect(baseUrl);
            window.location.assign(urlWithRedirect);
        };

        botNotification(notification_message().bot_stop, {
            label: localize('Reports'),
            onClick: handleNotificationClick,
        });
    };

    onRunButtonClick = async () => {
        let timer_counter = 1;
        if (window.sendRequestsStatistic) {
            performance.clearMeasures();
            // Log is sent every 10 seconds for 5 minutes
            this.timer = setInterval(() => {
                window.sendRequestsStatistic(true);
                performance.clearMeasures();
                if (timer_counter === 12) {
                    clearInterval(this.timer as NodeJS.Timeout);
                } else {
                    timer_counter++;
                }
            }, 10000);
        }
        const { summary_card } = this.root_store;
        const { client, ui } = this.core;
        const is_ios = mobileOSDetect() === 'iOS';
        this.dbot.saveRecentWorkspace();
        this.dbot.unHighlightAllBlocks();
        if (!client.is_logged_in) {
            this.showLoginDialog();
            return;
        }

        /**
         * Due to Apple's policy on cellular data usage in ios audioElement.play() should be initially called on
         * user action(e.g click/touch) to be downloaded, otherwise throws an error. Also it should be called
         * syncronously, so keep above await.
         */
        if (is_ios || isSafari()) this.preloadAudio();

        this.registerBotListeners();

        if (!this.dbot.shouldRunBot()) {
            this.unregisterBotListeners();
            return;
        }

        ui?.setAccountSwitcherDisabledMessage(
            localize(
                'Account switching is disabled while your bot is running. Please stop your bot before switching accounts.'
            )
        );
        runInAction(() => {
            this.setIsRunning(true);
            this.is_paused = false;
            ui.setPromptHandler(true);
            this.toggleDrawer(true);
            this.run_id = `run-${Date.now()}`;
            this.clearLastDigitsAnalysis();

            summary_card.clear();
            this.setContractStage(contract_stages.STARTING);
            this.dbot.runBot();
        });
        this.setShowBotStopMessage(false);
    };

    onStopButtonClick = () => {
        if (this.native_bot_stop_handler) {
            this.native_bot_stop_handler();
            return;
        }
        this.is_contract_buying_in_progress = false;
        const { is_multiplier } = this.root_store.summary_card;

        if (is_multiplier) {
            this.showStopMultiplierContractDialog();
        } else {
            this.stopBot();
        }
    };

    onPauseButtonClick = () => {
        const nextPaused = !this.is_paused;
        if (this.native_bot_pause_handler) {
            this.native_bot_pause_handler(nextPaused);
            this.is_paused = nextPaused;
            return;
        }
        if (nextPaused) {
            this.dbot.pauseBot();
        } else {
            this.dbot.resumeBot();
        }
        this.is_paused = nextPaused;
    };

    onStopBotClick = () => {
        if (this.native_bot_stop_handler) {
            this.native_bot_stop_handler();
            return;
        }
        this.is_contract_buying_in_progress = false;

        const { is_multiplier } = this.root_store.summary_card;
        const { summary_card } = this.root_store;

        if (is_multiplier) {
            this.showStopMultiplierContractDialog();
        } else {
            this.stopBot();
            summary_card.clear();
            this.setShowBotStopMessage(true);
        }
    };

    stopBot = () => {
        const { ui } = this.core;

        this.dbot.stopBot();
        this.is_paused = false;

        ui.setPromptHandler(false);

        if (this.error_type) {
            // when user click stop button when there is a error but bot is retrying
            this.setContractStage(contract_stages.NOT_RUNNING);
            ui.setAccountSwitcherDisabledMessage();
            this.setIsRunning(false);
        } else if (this.has_open_contract) {
            // when user click stop button when bot is running
            this.setContractStage(contract_stages.IS_STOPPING);
        } else {
            // when user click stop button before bot start running
            this.setContractStage(contract_stages.NOT_RUNNING);
            this.unregisterBotListeners();
            ui.setAccountSwitcherDisabledMessage();
            this.setIsRunning(false);
        }

        if (this.error_type) {
            this.error_type = undefined;
        }

        if (this.timer) {
            clearInterval(this.timer);
        }
        if (window.sendRequestsStatistic) {
            window.sendRequestsStatistic(true);
            performance.clearMeasures();
        }
    };

    onClearStatClick = () => {
        this.showClearStatDialog();
    };

    clearStat = () => {
        const { summary_card, journal, transactions } = this.root_store;

        this.setIsRunning(false);
        this.is_paused = false;
        this.setHasOpenContract(false);
        this.clear();
        this.clearLastDigitsAnalysis();
        journal.clear();
        summary_card.clear();
        transactions.clear();
        this.setContractStage(contract_stages.NOT_RUNNING);
    };

    toggleStatisticsInfoModal = () => {
        this.is_statistics_info_modal_open = !this.is_statistics_info_modal_open;
    };

    toggleDrawer = (is_open: boolean) => {
        this.is_drawer_open = is_open;
    };

    setActiveTabIndex = (index: number) => {
        this.active_index = index;
    };

    onCloseDialog = () => {
        this.is_dialog_open = false;
    };

    stopMyBot = () => {
        const { summary_card, quick_strategy } = this.root_store;
        const { ui } = this.core;
        const { toggleStopBotDialog } = quick_strategy;

        ui.setPromptHandler(false);
        this.dbot.terminateBot();
        this.onCloseDialog();
        summary_card.clear();
        toggleStopBotDialog();
        if (this.timer) {
            clearInterval(this.timer);
        }
        if (window.sendRequestsStatistic) {
            window.sendRequestsStatistic(true);
            performance.clearMeasures();
        }
    };

    closeMultiplierContract = () => {
        const { quick_strategy } = this.root_store;
        const { toggleStopBotDialog } = quick_strategy;

        this.onClickSell();
        this.stopBot();
        this.onCloseDialog();
        toggleStopBotDialog();
    };

    showStopMultiplierContractDialog = () => {
        const { summary_card } = this.root_store;
        const { ui } = this.core;

        this.onOkButtonClick = () => {
            ui.setPromptHandler(false);
            this.dbot.terminateBot();
            if (this.timer) {
                clearInterval(this.timer);
            }
            if (window.sendRequestsStatistic) {
                window.sendRequestsStatistic(true);
                performance.clearMeasures();
            }
            this.onCloseDialog();
            summary_card.clear();
        };
        this.onCancelButtonClick = () => {
            this.onClickSell();
            this.stopBot();
            this.onCloseDialog();
        };
        this.dialog_options = {
            title: localize('Keep your current contract?'),
            message: helpers.keep_current_contract,
            ok_button_text: localize('Keep my contract'),
            cancel_button_text: localize('Close my contract'),
        };
        this.is_dialog_open = true;
    };

    showLoginDialog = () => {
        // Only allow closing through the buttons
        this.onOkButtonClick = () => {
            generateOAuthURL('registration').then(url => {
                if (url) window.location.replace(url);
            });
            this.is_dialog_open = false;
        };
        this.onCancelButtonClick = () => {
            this.is_dialog_open = false;
        };
        this.dialog_options = {
            title: localize('You are not logged in'),
            message: localize('Please log in or sign up to start trading with us.'),
            ok_button_text: localize('Sign up'),
            cancel_button_text: localize('Log in'),
            dismissable: false,
            is_closed_on_cancel: false,
        };
        this.is_dialog_open = true;
    };

    showRealAccountDialog = () => {
        this.onOkButtonClick = this.onCloseDialog;
        this.onCancelButtonClick = null;
        this.dialog_options = {
            title: localize("Deriv Bot isn't quite ready for real accounts"),
            message: localize('Please switch to your demo account to run your Deriv Bot.'),
        };
        this.is_dialog_open = true;
    };

    showClearStatDialog = () => {
        this.onOkButtonClick = () => {
            this.clearStat();
            this.onCloseDialog();
        };
        this.onCancelButtonClick = this.onCloseDialog;
        this.dialog_options = {
            title: localize('Are you sure?'),
            message: localize(
                'This will clear all data in the summary, transactions, and journal panels. All counters will be reset to zero.'
            ),
        };
        this.is_dialog_open = true;
    };

    showIncompatibleStrategyDialog = () => {
        this.onOkButtonClick = this.onCloseDialog;
        this.onCancelButtonClick = null;
        this.dialog_options = {
            title: localize('Import error'),
            message: localize('This strategy is currently not compatible with Deriv Bot.'),
        };
        this.is_dialog_open = true;
    };

    showContractUpdateErrorDialog = (message?: string) => {
        this.onOkButtonClick = this.onCloseDialog;
        this.onCancelButtonClick = null;
        this.dialog_options = {
            title: localize('Contract Update Error'),
            message,
        };
        this.is_dialog_open = true;
    };

    registerBotListeners = () => {
        const { summary_card, transactions } = this.root_store;

        observer.register('bot.running', this.onBotRunningEvent);
        observer.register('bot.sell', this.onBotSellEvent);
        observer.register('bot.stop', this.onBotStopEvent);
        observer.register('bot.bot_ready', this.onBotReadyEvent);
        observer.register('bot.click_stop', this.onStopButtonClick);
        observer.register('bot.trade_again', this.onBotTradeAgain);
        observer.register('contract.status', this.onContractStatusEvent);
        observer.register('bot.contract', this.onBotContractEvent);
        observer.register('bot.contract', summary_card.onBotContractEvent);
        observer.register('bot.contract', transactions.onBotContractEvent);
        observer.register('bot.stop_button_click', this.onStopBotClick);
        observer.register('Error', this.onError);
        observer.register('bot.setPurchaseInProgress', this.SetpurchaseInProgress);
    };

    SetpurchaseInProgress = () => {
        return (this.is_contract_buying_in_progress = true);
    };

    registerReactions = () => {
        const { client, common } = this.core;
        // eslint-disable-next-line prefer-const
        let disposeIsSocketOpenedListener: (() => void) | undefined, disposeLogoutListener: (() => void) | undefined;

        const registerIsSocketOpenedListener = () => {
            // TODO: fix notifications
            if (common.is_socket_opened) {
                disposeIsSocketOpenedListener = reaction(
                    () => client.loginid,
                    loginid => {
                        if (loginid && this.is_running) {
                            // TODO: fix notifications
                            // notifications.addNotificationMessage(switch_account_notification());
                        }
                        this.dbot.terminateBot();
                        this.unregisterBotListeners();
                    }
                );
            } else if (typeof disposeLogoutListener === 'function') {
                disposeLogoutListener();
            }
        };

        registerIsSocketOpenedListener();

        disposeLogoutListener = reaction(
            () => common.is_socket_opened,
            () => registerIsSocketOpenedListener()
        );

        const disposeStopBotListener = reaction(
            () => !this.is_running,
            () => {
                if (!this.is_running) this.setContractStage(contract_stages.NOT_RUNNING);
            }
        );

        return () => {
            if (typeof disposeIsSocketOpenedListener === 'function') {
                disposeIsSocketOpenedListener();
            }

            if (typeof disposeLogoutListener === 'function') {
                disposeLogoutListener();
            }

            if (typeof disposeStopBotListener === 'function') {
                disposeStopBotListener();
            }
        };
    };

    onBotRunningEvent = () => {
        this.setHasOpenContract(true);

        // prevent new version update
        const ignore_new_version = new Event('IgnorePWAUpdate');
        document.dispatchEvent(ignore_new_version);
    };

    onBotSellEvent = () => {
        this.is_sell_requested = true;
    };

    onBotStopEvent = () => {
        const { summary_card } = this.root_store;
        const { ui } = this.core;
        const indicateBotStopped = () => {
            this.error_type = undefined;
            this.setContractStage(contract_stages.NOT_RUNNING);
            ui.setAccountSwitcherDisabledMessage();
            this.unregisterBotListeners();
        };
        if (this.error_type === ErrorTypes.RECOVERABLE_ERRORS) {
            // Bot should indicate it started in below cases:
            // - When error happens it's a recoverable error
            const { shouldRestartOnError = false, timeMachineEnabled = false } =
                this.dbot?.interpreter?.bot?.tradeEngine?.options ?? {};
            const is_bot_recoverable = shouldRestartOnError || timeMachineEnabled;

            if (is_bot_recoverable) {
                this.error_type = undefined;
                this.setContractStage(contract_stages.PURCHASE_SENT);
            } else {
                this.setIsRunning(false);
                indicateBotStopped();
            }
        } else if (this.error_type === ErrorTypes.UNRECOVERABLE_ERRORS) {
            // Bot should indicate it stopped in below cases:
            // - When error happens and it's an unrecoverable error
            this.setIsRunning(false);
            indicateBotStopped();
        } else if (this.has_open_contract) {
            // Bot should indicate the contract is closed in below cases:
            // - When bot was running and an error happens
            this.error_type = undefined;
            this.is_sell_requested = false;
            this.setContractStage(contract_stages.CONTRACT_CLOSED);
            ui.setAccountSwitcherDisabledMessage();
            this.unregisterBotListeners();
        }

        this.setHasOpenContract(false);

        summary_card.clearContractUpdateConfigValues();

        // listen for new version update
        const listen_new_version = new Event('ListenPWAUpdate');
        document.dispatchEvent(listen_new_version);
    };

    onBotReadyEvent = () => {
        this.setIsRunning(false);
        observer.unregisterAll('bot.bot_ready');
    };

    onBotTradeAgain = (is_trade_again: boolean) => {
        if (!is_trade_again) {
            this.stopBot();
        }
    };

    onContractStatusEvent = (contract_status: TContractState) => {
        switch (contract_status.id) {
            case 'contract.purchase_sent': {
                this.setContractStage(contract_stages.PURCHASE_SENT);
                break;
            }
            case 'contract.purchase_received': {
                this.is_contract_buying_in_progress = false;
                this.setContractStage(contract_stages.PURCHASE_RECEIVED);
                const { buy } = contract_status;
                const { is_virtual } = this.core.client;

                if (!is_virtual && buy) {
                    GTM?.pushDataLayer?.({ event: 'dbot_purchase', buy_price: buy.buy_price });
                }

                break;
            }
            case 'contract.sold': {
                this.is_sell_requested = false;
                this.setContractStage(contract_stages.CONTRACT_CLOSED);
                if (contract_status.contract) GTM.onTransactionClosed(contract_status.contract);
                break;
            }
            default:
                break;
        }
    };

    onClickSell = () => {
        const { is_multiplier } = this.root_store.summary_card;

        if (is_multiplier) {
            this.setContractStage(contract_stages.IS_STOPPING);
        }

        this.dbot.interpreter.bot.getInterface().sellAtMarket();
    };

    clear = () => {
        observer.emit('statistics.clear');
    };

    onBotContractEvent = (data: { is_sold?: boolean }) => {
        if (data?.is_sold) {
            this.is_sell_requested = false;
            this.setContractStage(contract_stages.CONTRACT_CLOSED);
        }
    };

    onError = (data: { error: any }) => {
        // data.error for API errors, data for code errors
        const error = data.error || data;
        if (unrecoverable_errors.includes(error.code)) {
            this.root_store.summary_card.clear();
            this.error_type = ErrorTypes.UNRECOVERABLE_ERRORS;
        } else {
            this.error_type = ErrorTypes.RECOVERABLE_ERRORS;
        }

        // Check if this error has subcode and code_args for proper mapping
        if (error.subcode && error.code_args) {
            const { getLocalizedErrorMessage } = require('@/constants/backend-error-messages');

            const details = {
                param1: error.code_args[0],
                param2: error.code_args[1],
                param3: error.code_args[2],
            };

            const localizedMessage = getLocalizedErrorMessage(error.subcode, details);
            this.showErrorMessage(localizedMessage, error);
            return;
        }

        // Use localized error message if it's a backend error, otherwise fallback to original message
        let error_message = error?.message;
        if (isBackendError(error)) {
            error_message = handleBackendError(error);
        } else if (error?.code && typeof error.code === 'string') {
            // Handle errors that have a code but might not be structured as BackendError
            // This covers cases like "InvalidtoBuy" errors from bot-skeleton
            const backendError = {
                code: error.code,
                message: error.message,
                details: error.code_args ? { code_args: error.code_args } : error.details,
            };
            error_message = handleBackendError(backendError);
        }

        this.showErrorMessage(error_message, error);
    };

    showErrorMessage = (data: string | Error, originalError?: any) => {
        let processedMessage = data;

        // If it's a string with placeholder patterns, try to process it
        if (typeof data === 'string' && data.includes('[_')) {
            const { getLocalizedErrorMessage, getBackendErrorMessages } = require('@/constants/backend-error-messages');
            const errorMessages = getBackendErrorMessages();

            // Convert placeholders from [_1], [_2] format to {{param1}}, {{param2}} format for comparison
            const normalizedMessage = data.replace(/\[_(\d+)\]/g, '{{param$1}}');

            // Search through all error codes to find a match

            let matchedErrorCode: string | null = null;
            for (const [errorCode, errorTemplate] of Object.entries(errorMessages)) {
                if (typeof errorTemplate === 'string' && errorTemplate === normalizedMessage) {
                    matchedErrorCode = errorCode;
                    break;
                }
            }

            if (matchedErrorCode) {
                // If we have the original error with code_args, use those values
                if (originalError?.code_args && Array.isArray(originalError.code_args)) {
                    const details = {
                        param1: originalError.code_args[0],
                        param2: originalError.code_args[1],
                        param3: originalError.code_args[2],
                        param4: originalError.code_args[3],
                        param5: originalError.code_args[4],
                    };
                    processedMessage = getLocalizedErrorMessage(matchedErrorCode, details);
                } else {
                    processedMessage = getLocalizedErrorMessage(matchedErrorCode);
                }
            }
        }

        const { journal } = this.root_store;
        const { ui } = this.core;
        journal.onError(processedMessage);
        if (journal.journal_filters.some(filter => filter === MessageTypes.ERROR)) {
            this.toggleDrawer(true);
            this.setActiveTabIndex(run_panel.JOURNAL);
            ui.setPromptHandler(false);
        } else {
            // TODO: fix notifications
            // notifications.addNotificationMessage(journalError(this.switchToJournal));
            // notifications.removeNotificationMessage({ key: 'bot_error' });
        }
    };

    switchToJournal = () => {
        const { journal } = this.root_store;
        journal.journal_filters.push(MessageTypes.ERROR);
        this.setActiveTabIndex(run_panel.JOURNAL);
        this.toggleDrawer(true);

        // TODO: fix notifications
        // notifications.toggleNotificationsModal();
        // notifications.removeNotificationByKey({ key: 'bot_error' });
    };

    unregisterBotListeners = () => {
        observer.unregisterAll('bot.running');
        observer.unregisterAll('bot.stop');
        observer.unregisterAll('bot.click_stop');
        observer.unregisterAll('bot.stop_button_click');
        observer.unregisterAll('bot.trade_again');
        observer.unregisterAll('contract.status');
        observer.unregisterAll('bot.contract');
        observer.unregisterAll('Error');
        observer.unregisterAll('bot.setPurchaseInProgress');
    };

    registerNativeBot = (stop_handler: () => void, pause_handler?: (paused: boolean) => void) => {
        this.native_bot_stop_handler = stop_handler;
        this.native_bot_pause_handler = pause_handler ?? null;
        this.is_paused = false;
        this.run_id = `native-${Date.now()}`;
        this.setIsRunning(true);
        this.setHasOpenContract(false);
        this.setContractStage(contract_stages.STARTING);
        this.toggleDrawer(true);
        this.core.ui?.setPromptHandler(true);
    };

    updateNativeBot = (contract_stage: TContractStage, has_open_contract = false) => {
        if (!this.native_bot_stop_handler) return;
        this.setIsRunning(true);
        this.setHasOpenContract(has_open_contract);
        this.setContractStage(contract_stage);
    };

    unregisterNativeBot = () => {
        this.native_bot_stop_handler = null;
        this.native_bot_pause_handler = null;
        this.is_paused = false;
        this.setHasOpenContract(false);
        this.setContractStage(contract_stages.NOT_RUNNING);
        this.setIsRunning(false);
        this.core.ui?.setPromptHandler(false);
        this.core.ui?.setAccountSwitcherDisabledMessage();
    };

    hasNativeApolloBlocks = () => {
        const blocks = window.Blockly?.derivWorkspace?.getAllBlocks?.(true) ?? [];
        return blocks.some(block => ['last_digits_condition', 'apollo_purchase2'].includes(block.type));
    };

    nativePositionToContractInfo = (position: DTPosition) => {
        const numericContractId = Number(position.contractId);
        const contractId = Number.isFinite(numericContractId) ? numericContractId : position.contractId;
        const now = new Date().toISOString();
        const completed = !position.isOpen;

        return {
            contract_id: contractId,
            transaction_ids: { buy: contractId },
            contract_type: position.contractType,
            underlying_symbol: position.symbol,
            currency: this.core.client.currency || 'USD',
            buy_price: position.buyPrice,
            payout: position.payout,
            bid_price: position.currentBid ?? undefined,
            profit: position.profit ?? 0,
            status: position.isOpen ? 'open' : position.isWin ? 'won' : 'lost',
            is_expired: completed,
            date_start: now,
            entry_spot: position.entrySpot ?? undefined,
            entry_tick: position.entrySpot ?? undefined,
            entry_tick_time: now,
            exit_spot: position.exitSpot ?? undefined,
            exit_tick: position.exitSpot ?? undefined,
            exit_tick_time: completed ? now : undefined,
            tick_count: 1,
            barrier: position.barrier ?? undefined,
            longcode: position.longcode,
        };
    };

    startNativeApolloBot = () => {
        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace) return;
        // A double Run event can arrive before the first engine has emitted
        // its initial status. Do not stop a live native runner and create a
        // second engine for the same R_25 stream.
        if (this.native_apollo_engine) return;

        const marketBlock = workspace
            .getAllBlocks(true)
            .find(block => block.type === 'trade_definition_market');
        const config: BinaryMatrixConfig = {
            symbol: marketBlock?.getFieldValue?.('SYMBOL_LIST') || 'R_25',
            currency: this.core.client.currency || 'USD',
            initialStake: readBlocklyNumberVariable(workspace, 'Stake', 0.5),
            takeProfit: readBlocklyNumberVariable(workspace, 'Take Profit', 10),
            stopLoss: readBlocklyNumberVariable(workspace, 'Stop Loss', 50),
            martingale: readBlocklyNumberVariable(workspace, 'Martingale', 2),
            reanalyzeAfterWins: Math.max(
                1,
                Math.floor(readBlocklyNumberVariable(workspace, 'Re Analyse After', 3))
            ),
        };

        this.native_apollo_engine?.stop();
        const engine = new BinaryMatrixEngine(config);
        this.native_apollo_engine = engine;

        const syncStatus = (status: BinaryMatrixStatus) => {
            if (status === 'stopped' || status === 'idle') {
                // A replaced engine must not clear the state owned by the
                // current runner.
                if (this.native_apollo_engine !== engine) return;
                this.native_apollo_engine = null;
                this.unregisterNativeBot();
                return;
            }

            const stage = status === 'buying'
                ? contract_stages.PURCHASE_SENT
                : status === 'waiting'
                  ? contract_stages.PURCHASE_RECEIVED
                  : contract_stages.RUNNING;
            this.updateNativeBot(stage, status === 'waiting');
        };

        engine.onStatus = syncStatus;
        // Binary Matrix log and settlement events are routed through the
        // shared observer so native Builder runs and the standalone runner
        // produce the same single Journal entry.
        engine.onLog = () => {};
        engine.onTrade = () => {};
        engine.onPosition = position => {
            this.root_store.transactions.onBotContractEvent(this.nativePositionToContractInfo(position));
        };

        if (!engine.start()) {
            this.native_apollo_engine = null;
            return;
        }
        this.registerNativeBot(
            () => engine.stop(),
            paused => (paused ? engine.pause() : engine.resume())
        );
    };

    setContractStage = (contract_stage: TContractStage) => {
        this.contract_stage = contract_stage;
    };

    setHasOpenContract = (has_open_contract: boolean) => {
        this.has_open_contract = has_open_contract;
    };

    setIsRunning = (is_running: boolean) => {
        this.is_running = is_running;
    };

    onLastDigitsAnalysis = (analysis: TLastDigitsAnalysis) => {
        // Update the live banner and Journal from the same event. Binary Matrix
        // evaluates several conditions asynchronously; keeping these writes in
        // one observer callback prevents the Journal from drifting behind the
        // banner when the next condition arrives.
        this.last_digits_analysis = { ...analysis };

        const conditionLabel = (() => {
            switch (analysis.condition) {
                case 'ALL_EVEN':
                    return 'all even';
                case 'ALL_ODD':
                    return 'all odd';
                case 'LESS_OR_EQUAL':
                    return `less than or equal to ${analysis.compareValue}`;
                case 'GREATER_OR_EQUAL':
                    return `greater than or equal to ${analysis.compareValue}`;
                default:
                    return analysis.condition;
            }
        })();

        this.root_store.journal.pushMessage(
            `Last Digits Analysis Market: ${analysis.market || 'N/A'} ` +
                `Condition: ${conditionLabel} ` +
                `Digits: [${analysis.digits.join(', ')}] ` +
                `Entry point: ${analysis.result ? 'HIT' : 'NOT HIT'} · ` +
                `Result: ${analysis.result ? '✅ CONDITIONS MET' : '❌ CONDITIONS NOT MET'}`,
            MessageTypes.NOTIFY,
            'journal__text'
        );
    };

    onParityAnalysis = (analysis: TParityAnalysis) => {
        const previous = this.parity_analysis;
        this.parity_analysis = analysis;

        const hasChanged =
            !previous ||
            previous.market !== analysis.market ||
            previous.count !== analysis.count ||
            previous.evenPercentage !== analysis.evenPercentage ||
            previous.oddPercentage !== analysis.oddPercentage ||
            previous.sample.join(',') !== analysis.sample.join(',');

        if (hasChanged) {
            this.root_store.journal.pushMessage(
                `Even ${analysis.evenPercentage}% || Odd ${analysis.oddPercentage}% ` +
                    `Based on last ${analysis.count} ticks`,
                MessageTypes.NOTIFY,
                'journal__text'
            );
        }
    };

    onPurchaseMapping = (mapping: TPurchaseMapping) => {
        if (this.last_digits_analysis) {
            this.last_digits_analysis = {
                ...this.last_digits_analysis,
                purchaseMapping: mapping.label,
            };
        }

        this.root_store.journal.pushMessage(
            `Purchase mapping: ${mapping.label} ` +
                `(contract ${mapping.contractType}${mapping.prediction !== null ? `, prediction ${mapping.prediction}` : ''})`,
            MessageTypes.NOTIFY,
            'journal__text'
        );
    };

    onBinaryMatrixJournalLog = (log: { message?: string; type?: string }) => {
        const message = String(log?.message || '');

        // Analysis events have their own shared journal handler so generated
        // Builder runs and native Matrix runs produce one identical row.
        if (
            message.startsWith('Last Digits Analysis Market:') ||
            message.startsWith('Re-analysis threshold reached')
        ) {
            return;
        }

        this.root_store.journal.pushMessage(
            `[Binary Matrix] ${message}`,
            log?.type === 'error' ? MessageTypes.ERROR : MessageTypes.NOTIFY,
            'journal__text'
        );
    };

    onBinaryMatrixReanalysis = (data: { wins?: number }) => {
        const wins = Math.max(1, Number(data?.wins) || 1);
        this.root_store.journal.pushMessage(
            `[Binary Matrix] ${wins} wins reached — now re-analysing until Take Profit is hit.`,
            MessageTypes.NOTIFY,
            'journal__text'
        );
    };

    onVolatilityScan = (event: {
        event?: string;
        marketCount?: number;
        qualifiedCount?: number;
        minimumConfidence?: number;
        windowSize?: number;
        marketIndex?: number;
        marketTotal?: number;
        completedCount?: number;
        selected?: {
            symbol?: string;
            label?: string;
            signal?: string;
            confidence?: number;
            adx?: number;
            rsi?: number;
            macd?: number;
                minimumConfidence?: number;
                minimumAdx?: number;
                minimumRsi?: number;
                minimumMacd?: number;
                rsiOperator?: string;
                macdOperator?: string;
                conditionsPassed?: boolean;
        } | null;
        selectionPolicy?: string;
        rejected?: Array<{
            symbol?: string;
            label?: string;
            reason?: string;
            confidence?: number;
            adx?: number;
            rsi?: number;
            macd?: number;
        }>;
        market?: string;
        label?: string;
        signal?: string;
        confidence?: number;
        adx?: number;
        rsi?: number;
        macd?: number;
        qualifies?: boolean;
        minimumRsi?: number;
        minimumMacd?: number;
            availableConfidence?: number | null;
            minimumConfidence?: number | null;
            availableAdx?: number | null;
            minimumAdx?: number | null;
            availableRsi?: number | null;
            minimumRsi?: number | null;
            rsiOperator?: string;
            availableMacd?: number | null;
            minimumMacd?: number | null;
            macdOperator?: string;
            conditionsPassed?: boolean;
        reason?: string;
        contractType?: string;
        contractId?: string | number;
        buyPrice?: number;
            entryTick?: number | string;
            entryTickTime?: number | string;
        outcome?: string;
        profit?: number;
    }) => {
        const journal = this.root_store.journal;
        const number = (value: unknown, digits = 1) =>
            value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
                ? 'N/A'
                : Number(value).toFixed(digits);
        const conditionSummary = (values: {
                signal?: string;
                availableConfidence?: number | null;
                minimumConfidence?: number | null;
                availableAdx?: number | null;
                minimumAdx?: number | null;
                availableRsi?: number | null;
                minimumRsi?: number | null;
                rsiOperator?: string;
                availableMacd?: number | null;
                minimumMacd?: number | null;
                macdOperator?: string;
                conditionsPassed?: boolean;
            }) => {
                const signal = String(values.signal || 'WAIT').toUpperCase();
                const directionalOperator = signal === 'PUT' ? '<' : signal === 'CALL' ? '>' : '—';
                const minimum = (value: unknown, digits = 1) =>
                    value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
                        ? 'N/A'
                        : Number(value).toFixed(digits);
                const result = (
                    available: unknown,
                    required: unknown,
                    operator: '>' | '<' | '>=' | '—',
                    digits = 1
                ) => {
                    const availableNumber = Number(available);
                    const requiredNumber = Number(required);
                    if (
                        !Number.isFinite(availableNumber) ||
                        !Number.isFinite(requiredNumber) ||
                        operator === '—'
                    ) {
                        return `${number(available, digits)} / ${minimum(required, digits)} —`;
                    }
                    const passed =
                        operator === '<'
                            ? availableNumber < requiredNumber
                            : operator === '>'
                              ? availableNumber > requiredNumber
                              : availableNumber >= requiredNumber;
                    return `${number(available, digits)} / ${operator}${minimum(required, digits)} ${
                        passed ? '✅' : '❌'
                    }`;
                };
                const isAvailable = (value: unknown) =>
                    value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
                const hasUnavailableIndicator =
                    !isAvailable(values.availableAdx) ||
                    !isAvailable(values.availableRsi) ||
                    !isAvailable(values.availableMacd);
                const status =
                    hasUnavailableIndicator
                        ? '⏳ DATA UNAVAILABLE · '
                        : values.conditionsPassed === true
                          ? '✅ ALL CONDITIONS MET · '
                          : values.conditionsPassed === false
                            ? '❌ CONDITIONS NOT MET · '
                            : '';
                return (
                    status +
                    `Confidence ${number(values.availableConfidence)}% / ` +
                    `${
                        values.minimumConfidence === null || values.minimumConfidence === undefined
                            ? 'not required'
                            : `${minimum(values.minimumConfidence, 0)}% ${Number(values.availableConfidence) >= Number(values.minimumConfidence) ? '✅' : '❌'}`
                    } · ` +
                    `ADX ${result(values.availableAdx, values.minimumAdx, '>=')} · ` +
                    `RSI ${result(values.availableRsi, values.minimumRsi, values.rsiOperator || directionalOperator)} · ` +
                    `MACD ${result(values.availableMacd, values.minimumMacd, values.macdOperator || directionalOperator, 3)}`
                );
            };
        const reasonLabel = (reason?: string) =>
            ({
                market_closed: 'closed',
                insufficient_history: 'not enough ticks',
                history_request_failed: 'history unavailable',
                confidence_below_threshold: 'confidence below threshold',
                indicator_confirmation_failed: 'ADX/RSI/MACD failed',
                live_conditions_failed: 'fresh confirmation failed',
                proposals_not_ready: 'proposal refresh timed out',
            })[reason || ''] || reason || 'not specified';

        if (event.event === 'checking') {
            journal.updateVolatilityScanMessage(
                `[Volatility Scan] Status · Checking market ${event.marketIndex ?? 0}/${event.marketTotal ?? 0} · ` +
                    `${event.label || event.market || 'next market'}`
            );
            return;
        }

        if (event.event === 'market') {
            const signal = String(event.signal || 'WAIT').toUpperCase();
            const recommendation = event.qualifies === true ? '✅ RECOMMENDED' : '⏭️ SKIP';
            journal.pushMessage(
                `[Volatility Scan] Market ${event.marketIndex ?? 0}/${event.marketTotal ?? 0} · ` +
                    `${event.label || event.market || 'market'} · ${recommendation} · ` +
                    `${conditionSummary({
                        signal,
                        availableConfidence: event.confidence,
                        minimumConfidence: null,
                        availableAdx: event.adx,
                        minimumAdx: event.minimumAdx,
                        availableRsi: event.rsi,
                        minimumRsi: event.minimumRsi ?? 50,
                        rsiOperator: event.rsiOperator,
                        availableMacd: event.macd,
                        minimumMacd: event.minimumMacd ?? 0,
                        macdOperator: event.macdOperator,
                        conditionsPassed: event.conditionsPassed ?? event.qualifies,
                    })} · ${reasonLabel(event.reason)}`,
                MessageTypes.NOTIFY,
                'journal__text'
            );
            return;
        }

        if (event.event === 'rejected') {
            journal.updateVolatilityScanMessage(
                `[Volatility Scan] Status · Rejected ${event.label || event.market || 'selected market'} · ` +
                    `${conditionSummary(event)} · ${reasonLabel(event.reason)} · rescanning for another market`,
            );
            return;
        }

        if (event.event === 'blocked') {
            journal.pushMessage(
                `[Volatility Scan] Entry blocked · ${event.market || 'selected market'} · ` +
                    `${event.contractType || event.signal || 'contract'} · ${conditionSummary(event)} · ` +
                    `${reasonLabel(event.reason)}`,
                MessageTypes.NOTIFY,
                'journal__text'
            );
            return;
        }

        if (event.event === 'purchase') {
            journal.pushMessage(
                `[Volatility Scan] Entry order submitted · ${event.market || 'selected market'} · ` +
                    `${event.contractType || 'contract'} · contract ${event.contractId || 'N/A'} · ` +
                    `stake ${number(event.buyPrice, 2)} · ${conditionSummary(event)}`,
                MessageTypes.NOTIFY,
                'journal__text'
            );
            return;
        }

        if (event.event === 'entry') {
            journal.pushMessage(
                `[Volatility Scan] Entry confirmed · ${event.market || 'selected market'} · ` +
                    `${event.contractType || 'contract'} at tick ${event.entryTick ?? 'N/A'} · ` +
                    `contract ${event.contractId || 'N/A'} · ${conditionSummary(event)}`,
                MessageTypes.NOTIFY,
                'journal__text'
            );
            return;
        }

        if (event.event === 'settlement') {
            journal.pushMessage(
                `[Volatility Scan] Settlement ${event.market || 'selected market'} · ` +
                    `${event.outcome || 'result'} · profit ${number(event.profit, 2)} · next scan will begin`,
                MessageTypes.NOTIFY,
                'journal__text'
            );
            return;
        }

        const selected = event.selected;
        const selectedText = selected
            ? `Selected ${selected.label || selected.symbol} (${selected.symbol}) · ${selected.signal} · ` +
              `${conditionSummary({
                  signal: selected.signal,
                  availableConfidence: selected.confidence,
                  minimumConfidence: selected.minimumConfidence ?? event.minimumConfidence,
                  availableAdx: selected.adx,
                  minimumAdx: selected.minimumAdx ?? event.minimumAdx,
                  availableRsi: selected.rsi,
                  minimumRsi: selected.minimumRsi ?? 50,
                  rsiOperator: selected.rsiOperator,
                  availableMacd: selected.macd,
                  minimumMacd: selected.minimumMacd ?? 0,
                  macdOperator: selected.macdOperator,
                  conditionsPassed: selected.conditionsPassed ?? true,
              })} · executing after fresh confirmation`
            : `No market met the ${number(event.minimumConfidence, 0)}% confidence and indicator gates`;
        journal.updateVolatilityScanMessage(
            `[Volatility Scan] Status · Finished ${event.marketCount ?? 0} markets · ` +
                `${event.qualifiedCount ?? 0} qualified · window ${event.windowSize ?? 0} ticks · ` +
                selectedText
        );
    };

    onAdaptiveMomentumJournalLog = (event: {
        event?: string;
        market?: string;
        tickCount?: number;
        requiredTicks?: number;
        warmup?: number;
        shortWindow?: number;
        longWindow?: number;
        confidence?: number;
        signalConfidence?: number;
        shortRisePercentage?: number;
        shortFallPercentage?: number;
        longRisePercentage?: number;
        longFallPercentage?: number;
        signal?: string;
        reason?: string;
        contractId?: string | number;
        contractType?: string;
        entryTick?: number | string;
        entryTickTime?: number | string;
        buyPrice?: number;
        outcome?: string;
        profit?: number;
        currency?: string;
        totalProfit?: number;
        totalWins?: number;
        totalLosses?: number;
    }) => {
        const journal = this.root_store.journal;
        const number = (value: unknown, digits = 1) =>
            Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '0';
        const reasonLabel = (reason?: string) =>
            ({
                insufficient_history: 'not enough tick history',
                confidence_below_threshold: 'confidence below threshold',
                long_direction_conflict: 'short and long direction disagree',
                confidence_confirmed: 'confidence and trend confirmed',
                take_profit: 'take-profit reached',
                stop_loss: 'stop-loss reached',
                session_risk_limit: 'session risk limit reached',
            })[reason || ''] || reason || 'not specified';
        const market = event.market || 'N/A';

        switch (event.event) {
            case 'analysis': {
                journal.updateAdaptiveAnalysisMessage(
                    `[Adaptive Momentum] Analysis · ${market} · ` +
                        `Ticks ${event.tickCount ?? 0}/${event.requiredTicks ?? 0} ` +
                        `(warm-up ${event.warmup ?? 0}) · ` +
                        `Short ${number(event.shortRisePercentage)}% rise / ${number(event.shortFallPercentage)}% fall ` +
                        `(${event.shortWindow ?? 0}) · ` +
                        `Long ${number(event.longRisePercentage)}% rise / ${number(event.longFallPercentage)}% fall ` +
                        `(${event.longWindow ?? 0}) · ` +
                        `Confidence ${number(event.signalConfidence)}% / threshold ${number(event.confidence)}% · ` +
                        `Signal ${event.signal || 'WAIT'}`
                );
                break;
            }
            case 'decision':
                journal.pushMessage(
                    `[Adaptive Momentum] Signal decision · ${event.market || 'N/A'} · ` +
                        `${event.signal || 'WAIT'} · ${reasonLabel(event.reason)} · ` +
                        `confidence ${number(event.signalConfidence)}% / threshold ${number(event.confidence)}%`,
                    MessageTypes.NOTIFY,
                    'journal__text'
                );
                break;
            case 'skip':
                journal.pushMessage(
                    `[Adaptive Momentum] Entry skipped · ${market} · ${reasonLabel(event.reason)} · ` +
                        `confidence ${number(event.signalConfidence)}% / threshold ${number(event.confidence)}%`,
                    MessageTypes.NOTIFY,
                    'journal__text'
                );
                break;
            case 'entry':
                journal.pushMessage(
                    `[Adaptive Momentum] Entry confirmed · ${market} · ${event.contractType || 'contract'} ` +
                        `at tick ${event.entryTick ?? 'N/A'} · contract ${event.contractId || 'N/A'} · ` +
                        `stake ${number(event.buyPrice, 2)}`,
                    MessageTypes.NOTIFY,
                    'journal__text'
                );
                break;
            case 'settlement':
                journal.pushMessage(
                    `[Adaptive Momentum] Settlement · ${market} · ${event.outcome || 'RESULT'} · ` +
                        `profit ${number(event.profit, 2)} ${event.currency || ''} · ` +
                        `session ${number(event.totalProfit, 2)} ${event.currency || ''} · ` +
                        `wins ${event.totalWins ?? 0}, losses ${event.totalLosses ?? 0} · ` +
                        `contract ${event.contractId || 'N/A'}`,
                    MessageTypes.NOTIFY,
                    'journal__text'
                );
                break;
            case 'risk_stop':
                journal.pushMessage(
                    `[Adaptive Momentum] Session stopped · ${market} · ${reasonLabel(event.reason)} · ` +
                        `session profit ${number(event.totalProfit, 2)}`,
                    MessageTypes.NOTIFY,
                    'journal__text'
                );
                break;
            default:
                break;
        }
    };

    clearLastDigitsAnalysis = () => {
        this.last_digits_analysis = null;
        this.parity_analysis = null;
    };

    onMount = () => {
        const { journal } = this.root_store;

        // Create a generic handler for ui.log.error that can extract error codes and use getLocalizedErrorMessage
        const handleUiLogError = (errorMessage: string) => {
            // Check if this is a stake/payout error message first
            if (
                typeof errorMessage === 'string' &&
                errorMessage.includes('Minimum stake') &&
                errorMessage.includes('maximum payout')
            ) {
                const { getLocalizedErrorMessage } = require('@/constants/backend-error-messages');

                // Extract parameter values from the message
                const stakeMatch = errorMessage.match(/Minimum stake of ([\d.]+)/);
                const payoutMatch = errorMessage.match(/maximum payout of ([\d.]+)/);
                const currentMatch = errorMessage.match(/Current (?:payout|stake) is ([\d.]+)/);

                if (stakeMatch && payoutMatch && currentMatch) {
                    const details = {
                        param1: stakeMatch[1],
                        param2: payoutMatch[1],
                        param3: currentMatch[1],
                    };

                    // Determine which error code to use based on the message content
                    let errorCode = 'InvalidtoBuy'; // default
                    if (errorMessage.includes('Current payout')) {
                        errorCode = errorMessage.includes('stake') ? 'StakeLimits' : 'PayoutLimits';
                    } else if (errorMessage.includes('Current stake')) {
                        errorCode = 'StakeLimits';
                    }

                    const processedMessage = getLocalizedErrorMessage(errorCode, details);
                    this.showErrorMessage(processedMessage);
                    return;
                }
            }

            // If errorMessage is a string with placeholder patterns, try to extract the error code
            if (typeof errorMessage === 'string' && errorMessage.includes('[_')) {
                const {
                    getLocalizedErrorMessage,
                    getBackendErrorMessages,
                } = require('@/constants/backend-error-messages');
                const errorMessages = getBackendErrorMessages();

                // Find the error code by matching the message pattern
                let matchedErrorCode: string | null = null;

                // Convert placeholders from [_1], [_2] format to {{param1}}, {{param2}} format for comparison
                const normalizedMessage = errorMessage.replace(/\[_(\d+)\]/g, '{{param$1}}');
                // Search through all error codes to find a match
                for (const [errorCode, errorTemplate] of Object.entries(errorMessages)) {
                    // errorTemplate is a string (the localized template)
                    if (typeof errorTemplate === 'string' && errorTemplate === normalizedMessage) {
                        matchedErrorCode = errorCode;
                        break;
                    }
                }

                if (matchedErrorCode) {
                    // Use the localized message for this error code
                    const localizedMessage = getLocalizedErrorMessage(matchedErrorCode);
                    this.showErrorMessage(localizedMessage);
                    return;
                }
            }

            // Default behavior for other errors or when we can't find a match
            this.showErrorMessage(errorMessage);
        };

        observer.register('ui.log.error', handleUiLogError);
        observer.register('ui.log.notify', journal.onNotify);
        observer.register('ui.log.success', journal.onLogSuccess);
        observer.register('bot.analysis.condition', this.onLastDigitsAnalysis);
        observer.register('bot.analysis.parity', this.onParityAnalysis);
        observer.register('bot.purchase.mapping', this.onPurchaseMapping);
        observer.register('bot.adaptive_momentum.log', this.onAdaptiveMomentumJournalLog);
        observer.register('bot.binary_matrix.log', this.onBinaryMatrixJournalLog);
        observer.register('bot.analysis.reanalysis', this.onBinaryMatrixReanalysis);
        observer.register('bot.volatility.scan', this.onVolatilityScan);
        observer.register('client.invalid_token', this.handleInvalidToken);
    };

    onUnmount = () => {
        const { journal, summary_card, transactions } = this.root_store;

        if (!this.is_running) {
            this.unregisterBotListeners();
            this.disposeReactionsFn();
            journal.disposeReactionsFn();
            summary_card.disposeReactionsFn();
            transactions.disposeReactionsFn();
        }

        observer.unregisterAll('ui.log.error');
        observer.unregisterAll('ui.log.notify');
        observer.unregisterAll('ui.log.success');
        observer.unregister('bot.analysis.condition', this.onLastDigitsAnalysis);
        observer.unregister('bot.analysis.parity', this.onParityAnalysis);
        observer.unregister('bot.purchase.mapping', this.onPurchaseMapping);
        observer.unregister('bot.adaptive_momentum.log', this.onAdaptiveMomentumJournalLog);
        observer.unregister('bot.binary_matrix.log', this.onBinaryMatrixJournalLog);
        observer.unregister('bot.analysis.reanalysis', this.onBinaryMatrixReanalysis);
        observer.unregister('bot.volatility.scan', this.onVolatilityScan);
        observer.unregisterAll('client.invalid_token');
    };

    handleInvalidToken = async () => {
        this.setActiveTabIndex(run_panel.SUMMARY);
    };

    preloadAudio = () => {
        const strategy_sounds = this.dbot.getStrategySounds() as string[];

        strategy_sounds.forEach((sound: string) => {
            const audioElement = document.getElementById(sound) as HTMLAudioElement | null;
            if (!audioElement) return;
            audioElement.muted = true;
            audioElement.play().catch(() => {
                // suppressing abort error, thrown on immediate .pause()
            });
            audioElement.pause();
            audioElement.muted = false;
        });
    };
}

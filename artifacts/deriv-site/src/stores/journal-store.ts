// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import { action, computed, makeObservable, observable, reaction, when } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { isVirtualAccount } from '@/utils/account-helpers';
/* [/AI] */
import { formatDate } from '@/components/shared';
import { run_panel } from '@/constants/run-panel';
import { LogTypes, MessageTypes } from '@/external/bot-skeleton';
import { config } from '@/external/bot-skeleton/constants/config';
import { RESET_STRATEGIES, RESET_STRATEGIES_BLOCK_IDS, STRATEGIES } from '@/pages/bot-builder/quick-strategy/config';
import { localize } from '@deriv-com/translations';
import { isCustomJournalMessage } from '../utils/journal-notifications';
import { getStoredItemsByKey, getStoredItemsByUser, setStoredItemsByKey } from '../utils/session-storage';
import { getSetting, storeSetting } from '../utils/settings';
import { isRiseFallJournalEntry, shouldShowJournalEntryForBot } from '@/utils/bot-template-scope';
import { TAccountList } from './client-store';
import RootStore from './root-store';

type TExtra = {
    current_currency?: string;
    currency?: string;
    profit?: number;
    botTemplateId?: string;
};

type TlogSuccess = {
    log_type: string;
    extra: TExtra;
};

type TMessage = {
    message: string | Error;
    message_type: string;
    className?: string;
};

type TMessageItem = {
    date?: string;
    time?: string;
    unique_id: string;
    extra: TExtra;
} & TMessage;

type TNotifyData = {
    sound: string;
    block_id?: string;
    variable_name?: string;
} & TMessage;

export interface IJournalStore {
    is_filter_dialog_visible: boolean;
    journal_filters: string[];
    filters: { id: string; label: string }[];
    unfiltered_messages: TMessageItem[];
    toggleFilterDialog: () => void;
    onLogSuccess: (message: TlogSuccess) => void;
    onError: (message: Error | string) => void;
    onNotify: (data: TNotifyData) => void;
    pushMessage: (message: string, message_type: string, className: string, extra?: TExtra) => void;
    updateAdaptiveAnalysisMessage: (message: string) => void;
    updateVolatilityScanMessage: (message: string) => void;
    updateSmartOver2AnalysisMessage: (message: string) => void;
    updateEdgingProAnalysisMessage: (message: string) => void;
    updateStatMessage: (
        message: string,
        setContractBuyInprogress: () => void,
        isContractBuyInprogress: boolean
    ) => void;
    filtered_messages: TMessageItem[];
    getServerTime: () => Date;
    playAudio: (sound: string) => void;
    checked_filters: string[];
    filterMessage: (checked: boolean, item_id: string) => void;
    active_bot_template_id: string | null;
    setActiveBotTemplateId: (identity: string | null) => void;
    visible_messages: TMessageItem[];
    clear: () => void;
    registerReactions: () => void;
    restoreStoredJournals: () => void;
}

export default class JournalStore {
    root_store: RootStore;
    core: RootStore['core'];
    disposeReactionsFn: () => void;
    constructor(root_store: RootStore, core: RootStore['core']) {
        makeObservable(this, {
            is_filter_dialog_visible: observable,
            journal_filters: observable.shallow,
            filters: observable.shallow,
            unfiltered_messages: observable.shallow,
            active_bot_template_id: observable,
            toggleFilterDialog: action.bound,
            onLogSuccess: action.bound,
            onError: action.bound,
            onNotify: action.bound,
            pushMessage: action.bound,
            updateAdaptiveAnalysisMessage: action.bound,
            updateVolatilityScanMessage: action.bound,
            updateSmartOver2AnalysisMessage: action.bound,
            updateEdgingProAnalysisMessage: action.bound,
            filtered_messages: computed,
            visible_messages: computed,
            getServerTime: action.bound,
            playAudio: action.bound,
            checked_filters: computed,
            filterMessage: action.bound,
            setActiveBotTemplateId: action.bound,
            clear: action.bound,
            registerReactions: action.bound,
            restoreStoredJournals: action.bound,
        });

        this.root_store = root_store;
        this.core = core;
        this.active_bot_template_id = this.readActiveBotTemplateId();
        this.disposeReactionsFn = this.registerReactions();
        this.restoreStoredJournals();
    }

    JOURNAL_CACHE = 'journal_cache';
    ACTIVE_BOT_TEMPLATE_KEY = 'free_bots_active_bot_template_id';

    is_filter_dialog_visible = false;
    active_bot_template_id: string | null = null;

    filters = [
        { id: MessageTypes.ERROR, label: localize('Errors') },
        { id: MessageTypes.NOTIFY, label: localize('Notifications') },
        { id: MessageTypes.SUCCESS, label: localize('System') },
    ];
    journal_filters: string[] = [];
    unfiltered_messages: TMessageItem[] = [];

    readActiveBotTemplateId() {
        if (typeof window === 'undefined') return null;
        try {
            return window.localStorage.getItem(this.ACTIVE_BOT_TEMPLATE_KEY);
        } catch {
            return null;
        }
    }

    setActiveBotTemplateId(identity: string | null) {
        this.active_bot_template_id = identity || null;
        if (typeof window === 'undefined') return;
        try {
            if (identity) {
                window.localStorage.setItem(this.ACTIVE_BOT_TEMPLATE_KEY, identity);
            } else {
                window.localStorage.removeItem(this.ACTIVE_BOT_TEMPLATE_KEY);
            }
        } catch {
            // Journal visibility still follows the in-memory bot selection when storage is unavailable.
        }
    }

    restoreStoredJournals() {
        const client = this.core.client as RootStore['client'];
        const { loginid } = client;
        this.journal_filters = getSetting('journal_filter') ?? this.filters.map(filter => filter.id);
        this.unfiltered_messages = getStoredItemsByUser(this.JOURNAL_CACHE, loginid, []);
    }

    getServerTime() {
        return this.core?.common.server_time.get();
    }

    playAudio = (sound: string) => {
        if (sound !== config().lists.NOTIFICATION_SOUND[0][1]) {
            const audio = document.getElementById(sound) as HTMLAudioElement;
            audio.play();
        }
    };

    toggleFilterDialog() {
        this.is_filter_dialog_visible = !this.is_filter_dialog_visible;
    }

    onLogSuccess(message: TlogSuccess) {
        const { log_type, extra } = message;
        this.pushMessage(log_type, MessageTypes.SUCCESS, '', extra);
    }

    onError(message: Error | string) {
        let processedMessage = message;

        // Check if this is an error object with backend error information
        if (typeof message === 'object' && message !== null && 'code' in message) {
            const error = message as any;

            if (error.subcode && error.code_args) {
                const { getLocalizedErrorMessage } = require('@/constants/backend-error-messages');

                const details = {
                    param1: error.code_args[0],
                    param2: error.code_args[1],
                    param3: error.code_args[2],
                };

                processedMessage = getLocalizedErrorMessage(error.subcode, details);
            } else if (error.code && error.code_args) {
                const { getLocalizedErrorMessage } = require('@/constants/backend-error-messages');

                const details = {
                    param1: error.code_args[0],
                    param2: error.code_args[1],
                    param3: error.code_args[2],
                };

                processedMessage = getLocalizedErrorMessage(error.code, details);
            } else {
                processedMessage = error.message || message;
            }
        } else if (typeof message === 'string') {
            // Check if this is a backend error message that needs processing
            if (message.includes('Minimum stake') && message.includes('maximum payout')) {
                const { getLocalizedErrorMessage } = require('@/constants/backend-error-messages');

                // Extract parameter values from the message
                const stakeMatch = message.match(/Minimum stake of ([\d.]+)/);
                const payoutMatch = message.match(/maximum payout of ([\d.]+)/);
                const currentMatch = message.match(/Current (?:payout|stake) is ([\d.]+)/);

                if (stakeMatch && payoutMatch && currentMatch) {
                    const details = {
                        param1: stakeMatch[1],
                        param2: payoutMatch[1],
                        param3: currentMatch[1],
                    };

                    // Determine which error code to use based on the message content
                    let errorCode = 'InvalidtoBuy'; // default
                    if (message.includes('Current payout')) {
                        errorCode = message.includes('stake') ? 'StakeLimits' : 'PayoutLimits';
                    } else if (message.includes('Current stake')) {
                        errorCode = 'StakeLimits';
                    }

                    processedMessage = getLocalizedErrorMessage(errorCode, details);
                }
            }
        }

        this.pushMessage(processedMessage, MessageTypes.ERROR);
    }

    onNotify(data: TNotifyData) {
        const { run_panel, dbot, quick_strategy } = this.root_store;

        const { message, className, message_type, sound, block_id, variable_name } = data;
        const selected_quick_strategy = quick_strategy.selected_strategy_for_notofy;

        // Special handling for stat notifications by block_id
        const isStatNotification =
            RESET_STRATEGIES_BLOCK_IDS?.includes(block_id || '') &&
            RESET_STRATEGIES?.includes(STRATEGIES()[selected_quick_strategy]?.name || '');

        // Create a custom pushMessage handler that uses updateStatMessage for stats
        const customPushMessage = (parsed_message: string) => {
            if (isStatNotification) {
                this.updateStatMessage(
                    parsed_message,
                    run_panel?.SetpurchaseInProgress,
                    run_panel.is_contract_buying_in_progress
                );
            } else {
                this.pushMessage(parsed_message, message_type || MessageTypes.NOTIFY, className);
            }
        };

        if (
            isCustomJournalMessage(
                { message, block_id, variable_name },
                run_panel.showErrorMessage,
                () => dbot.centerAndHighlightBlock(block_id as string, true),
                customPushMessage,
                isStatNotification
            )
        ) {
            this.playAudio(sound);
            return;
        }
        this.pushMessage(message, message_type || MessageTypes.NOTIFY, className);
        this.playAudio(sound);
    }

    pushMessage(
        message: Error | string,
        message_type: string,
        className?: string,
        extra: TExtra = {}
    ) {
        const { client } = this.core;
        const { loginid, account_list } = client as RootStore['client'];

        if (loginid) {
            const current_account = account_list?.find(account => account?.loginid === loginid);
            // Use centralized utility to determine if demo account
            const isVirtual = isVirtualAccount(loginid);
            extra.current_currency = isVirtual ? 'Demo' : current_account?.currency;
        } else if (message === LogTypes.WELCOME) {
            return;
        }

        if (isRiseFallJournalEntry(message)) {
            extra.botTemplateId = 'rise-fall-master';
        } else if (!extra.botTemplateId && this.active_bot_template_id) {
            extra.botTemplateId = this.active_bot_template_id;
        }

        const date = formatDate(this.getServerTime());
        const time = formatDate(this.getServerTime(), 'HH:mm:ss [GMT]');
        const unique_id = uuidv4();

        this.unfiltered_messages.unshift({ date, time, message, message_type, className, unique_id, extra });
        this.unfiltered_messages = this.unfiltered_messages.slice(); // force array update
    }

    updateAdaptiveAnalysisMessage(message: string) {
        const analysisPrefix = '[Adaptive Momentum] Analysis';
        const existingIndex = this.unfiltered_messages.findIndex(
            item => item.message_type === MessageTypes.NOTIFY && typeof item.message === 'string' && item.message.startsWith(analysisPrefix)
        );

        if (existingIndex < 0) {
            this.pushMessage(message, MessageTypes.NOTIFY, 'journal__text');
            return;
        }

        const existing = this.unfiltered_messages[existingIndex];
        const updated = {
            ...existing,
            message,
            time: formatDate(this.getServerTime(), 'HH:mm:ss [GMT]'),
        };
        this.unfiltered_messages = [
            updated,
            ...this.unfiltered_messages.slice(0, existingIndex),
            ...this.unfiltered_messages.slice(existingIndex + 1),
        ];
    }

    updateVolatilityScanMessage(message: string) {
        const scanPrefix = '[Volatility Scan] Status';
        const existingIndex = this.unfiltered_messages.findIndex(
            item => item.message_type === MessageTypes.NOTIFY && typeof item.message === 'string' && item.message.startsWith(scanPrefix)
        );

        if (existingIndex < 0) {
            this.pushMessage(message, MessageTypes.NOTIFY, 'journal__text');
            return;
        }

        const existing = this.unfiltered_messages[existingIndex];
        const updated = {
            ...existing,
            message,
            time: formatDate(this.getServerTime(), 'HH:mm:ss [GMT]'),
        };
        this.unfiltered_messages = [
            updated,
            ...this.unfiltered_messages.slice(0, existingIndex),
            ...this.unfiltered_messages.slice(existingIndex + 1),
        ];
    }

    updateSmartOver2AnalysisMessage(message: string) {
        const analysisPrefix = '[Smart Over 2] Status';
        const activeTemplateId = this.active_bot_template_id;
        const existingIndex = this.unfiltered_messages.findIndex(
            item =>
                item.message_type === MessageTypes.NOTIFY &&
                typeof item.message === 'string' &&
                item.message.startsWith(analysisPrefix) &&
                (!activeTemplateId || item.extra?.botTemplateId === activeTemplateId)
        );

        if (existingIndex < 0) {
            this.pushMessage(message, MessageTypes.NOTIFY, 'journal__text');
            return;
        }

        const existing = this.unfiltered_messages[existingIndex];
        const updated = {
            ...existing,
            message,
            time: formatDate(this.getServerTime(), 'HH:mm:ss [GMT]'),
        };
        this.unfiltered_messages = [
            updated,
            ...this.unfiltered_messages.slice(0, existingIndex),
            ...this.unfiltered_messages.slice(existingIndex + 1),
        ];
    }

    updateEdgingProAnalysisMessage(message: string) {
        const analysisPrefix = '[Edging pro] Last ';
        const activeTemplateId = this.active_bot_template_id;
        const existingIndex = this.unfiltered_messages.findIndex(
            item =>
                item.message_type === MessageTypes.NOTIFY &&
                typeof item.message === 'string' &&
                item.message.startsWith(analysisPrefix) &&
                (!activeTemplateId || item.extra?.botTemplateId === activeTemplateId)
        );

        if (existingIndex < 0) {
            this.pushMessage(message, MessageTypes.NOTIFY, 'journal__text', {
                botTemplateId: 'edging-pro-engine',
            });
            return;
        }

        const existing = this.unfiltered_messages[existingIndex];
        const updated = {
            ...existing,
            message,
            time: formatDate(this.getServerTime(), 'HH:mm:ss [GMT]'),
        };
        this.unfiltered_messages = [
            updated,
            ...this.unfiltered_messages.slice(0, existingIndex),
            ...this.unfiltered_messages.slice(existingIndex + 1),
        ];
    }

    // Method to update the existing stat message instead of creating a new one
    updateStatMessage(message: string, setContractBuyInprogress: () => void, isContractBuyInprogress: boolean) {
        // First check if the first message in the array is already a stat message

        if (isContractBuyInprogress) {
            const firstMessage = this.unfiltered_messages[0];

            if (
                firstMessage &&
                typeof firstMessage.message === 'string' &&
                firstMessage.message.includes('stat-count')
            ) {
                // Update the existing first message with the new stat value using immutable pattern
                // to properly update MobX observable (avoid direct mutations)
                this.unfiltered_messages[0] = {
                    ...firstMessage,
                    message,
                    time: formatDate(this.getServerTime(), 'HH:mm:ss [GMT]'),
                };
                // Force array update
                this.unfiltered_messages = this.unfiltered_messages.slice();
                return;
            }
        }
        setContractBuyInprogress();

        // If no stat message found at the first position, create a new one
        this.pushMessage(message, MessageTypes.NOTIFY, 'journal__item--content');
        this.root_store.run_panel.setActiveTabIndex(run_panel.JOURNAL);
    }

    get filtered_messages() {
        return (
            this.visible_messages
                // filter messages based on filtered-checkbox
                .filter(
                    message =>
                        this.journal_filters.length &&
                        this.journal_filters.some(filter => message.message_type === filter)
                )
        );
    }

    get visible_messages() {
        return this.unfiltered_messages.filter(message =>
            shouldShowJournalEntryForBot(message, this.active_bot_template_id)
        );
    }

    get checked_filters() {
        return this.journal_filters.filter(filter => filter != null);
    }

    filterMessage(checked: boolean, item_id: string) {
        if (checked) {
            this.journal_filters.push(item_id);
        } else {
            this.journal_filters.splice(this.journal_filters.indexOf(item_id), 1);
        }

        storeSetting('journal_filter', this.journal_filters);
    }

    clear() {
        this.unfiltered_messages = this.unfiltered_messages.slice(0, 0);
    }

    registerReactions() {
        const client = this.core.client as RootStore['client'];

        // Write journal messages to session storage on each change in unfiltered messages.
        const disposeWriteJournalMessageListener = reaction(
            () => this.unfiltered_messages,
            unfiltered_messages => {
                const stored_journals = getStoredItemsByKey(this.JOURNAL_CACHE, {});
                stored_journals[client.loginid as string] = unfiltered_messages?.slice(0, 5000);
                setStoredItemsByKey(this.JOURNAL_CACHE, stored_journals);
            }
        );

        // Attempt to load cached journal messages on client loginid change.
        const disposeJournalMessageListener = reaction(
            () => client?.loginid,
            async loginid => {
                await when(() => {
                    const has_account = client.account_list?.find(
                        (account: TAccountList[number]) => account.loginid === loginid
                    );
                    return !!has_account;
                });
                this.unfiltered_messages = getStoredItemsByUser(this.JOURNAL_CACHE, loginid, []);
                if (this.unfiltered_messages.length === 0) {
                    this.pushMessage(LogTypes.WELCOME, MessageTypes.SUCCESS, 'journal__text');
                } else if (this.unfiltered_messages.length > 0) {
                    this.pushMessage(LogTypes.WELCOME_BACK, MessageTypes.SUCCESS, 'journal__text');
                }
            },
            { fireImmediately: true } // For initial welcome message
        );

        return () => {
            disposeWriteJournalMessageListener();
            disposeJournalMessageListener();
        };
    }
}

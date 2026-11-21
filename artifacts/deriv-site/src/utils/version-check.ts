import Cookies from 'js-cookie';
import { BOT_VERSION_CONFIG } from '@/constants/bot-version';
import {
    AI_BOT_BUILDER_HISTORY_STORAGE_PREFIX,
    AI_BOT_BUILDER_LAUNCHER_STORAGE_KEY,
} from '@/pages/bot-builder/ai-bot-builder/storage';

/**
 * Clears localStorage while preserving the bot version and AI builder preferences.
 */
const clearLocalStorage = (): void => {
    try {
        // Keep the AI builder's account-scoped history and launcher position
        // when the Blockly workspace version changes. Old XML is still checked
        // by the preview/load validator before it can replace the workspace.
        const preservedEntries: Array<[string, string]> = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (
                key &&
                (key.startsWith(`${AI_BOT_BUILDER_HISTORY_STORAGE_PREFIX}:`) ||
                    key === AI_BOT_BUILDER_LAUNCHER_STORAGE_KEY)
            ) {
                const value = localStorage.getItem(key);
                if (value !== null) preservedEntries.push([key, value]);
            }
        }

        // Get the current bot_version before clearing
        const currentBotVersion = localStorage.getItem(BOT_VERSION_CONFIG.STORAGE_KEY);

        // Clear all localStorage
        localStorage.clear();

        // Restore the bot_version if it existed
        if (currentBotVersion) {
            localStorage.setItem(BOT_VERSION_CONFIG.STORAGE_KEY, currentBotVersion);
        }
        preservedEntries.forEach(([key, value]) => localStorage.setItem(key, value));
    } catch (error) {
        console.error('Error clearing localStorage:', error);
    }
};

/**
 * Clears all cookies for the current domain and parent domains
 */
const clearCookies = (): void => {
    try {
        // Get all cookies
        const cookies = document.cookie.split(';');

        // Clear each cookie for different domain variations
        const domains = [`.${document.domain.split('.').slice(-2).join('.')}`, `.${document.domain}`, document.domain];

        const paths = ['/', window.location.pathname.split('/', 2)[1] || ''];

        cookies.forEach(cookie => {
            const cookieName = cookie.split('=')[0].trim();
            if (cookieName) {
                // Remove cookie for different domain and path combinations
                domains.forEach(domain => {
                    paths.forEach(path => {
                        Cookies.remove(cookieName, { domain, path });
                    });
                });
                // Also try removing without domain/path
                Cookies.remove(cookieName);
            }
        });
    } catch (error) {
        console.error('Error clearing cookies:', error);
    }
};

/**
 * Sets the bot version in localStorage to prevent infinite clearing
 */
const setBotVersion = (): void => {
    try {
        localStorage.setItem(BOT_VERSION_CONFIG.STORAGE_KEY, BOT_VERSION_CONFIG.REQUIRED_VERSION.toString());
    } catch (error) {
        console.error('Error setting bot version:', error);
    }
};

/**
 * Checks if the current bot version matches the required version
 * @returns true if version matches or is not set, false if version is different
 */
const isVersionValid = (): boolean => {
    try {
        const currentVersion = localStorage.getItem(BOT_VERSION_CONFIG.STORAGE_KEY);

        // If no version is set, consider it invalid (needs clearing)
        if (currentVersion === null) {
            return false;
        }

        // Parse the version and check if it matches
        const versionNumber = parseInt(currentVersion, 10);
        return versionNumber === BOT_VERSION_CONFIG.REQUIRED_VERSION;
    } catch (error) {
        console.error('Error checking bot version:', error);
        return false;
    }
};

/**
 * Performs version check and clears storage if necessary
 * This function should be called at the very beginning of app initialization
 * before any other localStorage or cookie operations
 */
export const performVersionCheck = (): void => {
    console.log('Performing bot version check...');

    if (!isVersionValid()) {
        console.log('Bot version mismatch or not set. Clearing localStorage and cookies...');

        // Clear all storage
        clearLocalStorage();
        clearCookies();

        // Set the correct version to prevent infinite clearing
        setBotVersion();

        console.log('Storage cleared and bot version set to:', BOT_VERSION_CONFIG.REQUIRED_VERSION);
    } else {
        console.log('Bot version is valid:', BOT_VERSION_CONFIG.REQUIRED_VERSION);
    }
};

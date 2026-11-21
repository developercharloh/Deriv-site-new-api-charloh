jest.mock('js-cookie', () => ({
    remove: jest.fn(),
}));

import { performVersionCheck } from '../version-check';

describe('performVersionCheck', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('preserves AI builder history and launcher position while clearing stale bot state', () => {
        const historyKey = 'deriv-ai-bot-builder-history:CR12345';
        const launcherKey = 'deriv-ai-bot-builder-launcher-position';
        const history = JSON.stringify([{ id: 'saved-bot', xml: '<xml />' }]);
        const launcher = JSON.stringify({ left: 120, bottom: 160 });
        localStorage.setItem('bot_version', '1');
        localStorage.setItem('authToken', 'stale-token');
        localStorage.setItem(historyKey, history);
        localStorage.setItem(launcherKey, launcher);

        performVersionCheck();

        expect(localStorage.getItem('bot_version')).toBe('2');
        expect(localStorage.getItem('authToken')).toBeNull();
        expect(localStorage.getItem(historyKey)).toBe(history);
        expect(localStorage.getItem(launcherKey)).toBe(launcher);
    });
});

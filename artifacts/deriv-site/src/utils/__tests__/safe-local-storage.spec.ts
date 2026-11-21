import { getLocalStorageRecord } from '../safe-local-storage';

describe('getLocalStorageRecord', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns a stored object', () => {
        localStorage.setItem('accountsList', JSON.stringify({ CR12345: { token: 'demo' } }));

        expect(getLocalStorageRecord('accountsList')).toEqual({ CR12345: { token: 'demo' } });
    });

    it('removes only a malformed value and returns an empty object', () => {
        localStorage.setItem('accountsList', '{broken');
        localStorage.setItem('unrelated-setting', 'keep-me');

        expect(getLocalStorageRecord('accountsList')).toEqual({});
        expect(localStorage.getItem('accountsList')).toBeNull();
        expect(localStorage.getItem('unrelated-setting')).toBe('keep-me');
    });

    it('rejects valid JSON that is not an object', () => {
        localStorage.setItem('accountsList', 'null');

        expect(getLocalStorageRecord('accountsList')).toEqual({});
        expect(localStorage.getItem('accountsList')).toBeNull();
    });
});

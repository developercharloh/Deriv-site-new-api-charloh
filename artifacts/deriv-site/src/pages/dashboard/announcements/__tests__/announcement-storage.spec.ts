import { getAnnouncementReadState, getClientAccountDetails } from '../announcement-storage';

describe('announcement local storage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('uses an empty read state and removes only malformed announcement data', () => {
        localStorage.setItem('bot-announcements', '{broken');
        localStorage.setItem('unrelated-setting', 'keep-me');

        expect(getAnnouncementReadState()).toEqual({});
        expect(localStorage.getItem('bot-announcements')).toBeNull();
        expect(localStorage.getItem('unrelated-setting')).toBe('keep-me');
    });

    it('rejects account details with the wrong shape instead of crashing startup', () => {
        localStorage.setItem('client_account_details', JSON.stringify({ loginid: 'VRTC123' }));

        expect(getClientAccountDetails()).toEqual([]);
        expect(localStorage.getItem('client_account_details')).toBeNull();
    });

    it('keeps valid announcement and account data', () => {
        const accounts = [{ loginid: 'VRTC123', created_at: 1_700_000_000 }];
        localStorage.setItem('bot-announcements', JSON.stringify({ update_one: false }));
        localStorage.setItem('client_account_details', JSON.stringify(accounts));

        expect(getAnnouncementReadState()).toEqual({ update_one: false });
        expect(getClientAccountDetails()).toEqual(accounts);
    });
});

import { getLocalStorageJson } from '@/utils/safe-local-storage';

type AnnouncementReadState = Record<string, boolean>;

type ClientAccountDetails = {
    loginid: string;
    created_at?: number;
};

const isAnnouncementReadState = (value: unknown): value is AnnouncementReadState =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(item => typeof item === 'boolean');

const isClientAccountDetails = (value: unknown): value is ClientAccountDetails[] =>
    Array.isArray(value) &&
    value.every(
        account =>
            !!account &&
            typeof account === 'object' &&
            typeof account.loginid === 'string' &&
            (account.created_at === undefined || typeof account.created_at === 'number')
    );

export const getAnnouncementReadState = () =>
    getLocalStorageJson<AnnouncementReadState>('bot-announcements', {}, isAnnouncementReadState);

export const getClientAccountDetails = () =>
    getLocalStorageJson<ClientAccountDetails[]>('client_account_details', [], isClientAccountDetails);

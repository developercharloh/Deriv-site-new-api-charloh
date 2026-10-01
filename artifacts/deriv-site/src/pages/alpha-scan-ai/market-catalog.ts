import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';

export type SyntheticSymbol = {
    symbol: string;
    displayName: string;
    market: string;
    submarket: string;
    pipSize?: number;
    status?: 'open' | 'closed' | 'unknown';
};

const stringFromRecord = (record: Record<string, unknown>, keys: string[]): string =>
    keys.map(key => record[key]).find(value => typeof value === 'string' && value.length > 0) as string || '';

const numberFromRecord = (record: Record<string, unknown>, keys: string[]): number | undefined => {
    const value = keys.map(key => record[key]).find(candidate =>
        typeof candidate === 'number' || (typeof candidate === 'string' && candidate.length > 0),
    );
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const flagFromValue = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    return undefined;
};

const formatMetadataLabel = (value: string): string =>
    value.split(/[_\s]+/).map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(' ');

const getVerifiedCatalogSymbols = (): SyntheticSymbol[] =>
    DERIV_VOLATILITIES.map(index => ({
        symbol: index.code,
        displayName: index.label,
        market: 'Derived',
        submarket: index.tickEvery === 1 ? 'Continuous Indices' : 'Standard Indices',
        status: 'unknown',
    }));

export const getMetadataSymbolCode = (record: Record<string, unknown>): string =>
    stringFromRecord(record, ['symbol', 'underlying_symbol']);

const symbolStatusFromRecord = (record: Record<string, unknown>): SyntheticSymbol['status'] => {
    const explicitStatus = stringFromRecord(record, ['status', 'market_status']).toLowerCase();
    if (['closed', 'close', 'inactive', 'disabled', 'suspended'].includes(explicitStatus)) return 'closed';
    if (['open', 'active', 'enabled'].includes(explicitStatus)) return 'open';

    if (flagFromValue(record.is_trading_suspended) === true) return 'closed';

    const statusFlags = ['exchange_is_open', 'is_open', 'is_trading']
        .map(key => flagFromValue(record[key]))
        .filter((value): value is boolean => value !== undefined);
    if (statusFlags.some(value => value === false)) return 'closed';
    if (statusFlags.some(value => value === true)) return 'open';
    return 'unknown';
};

export const discoverVolatilitySymbols = (records: Array<Record<string, unknown>>): SyntheticSymbol[] => {
    const metadataBySymbol = new Map(
        records
            .map(record => [getMetadataSymbolCode(record), record] as const)
            .filter(([symbol]) => Boolean(symbol)),
    );

    return getVerifiedCatalogSymbols().map(catalogSymbol => {
        const record = metadataBySymbol.get(catalogSymbol.symbol);
        const market = stringFromRecord(record || {}, ['market_display_name', 'market']);
        const submarket = stringFromRecord(record || {}, ['submarket_display_name', 'submarket']);
        return {
            ...catalogSymbol,
            displayName: stringFromRecord(record || {}, [
                'display_name',
                'underlying_symbol_name',
                'underlying_symbol',
            ]) || catalogSymbol.displayName,
            market: market ? formatMetadataLabel(market) : catalogSymbol.market,
            submarket: submarket ? formatMetadataLabel(submarket) : catalogSymbol.submarket,
            pipSize: numberFromRecord(record || {}, ['pip_size']),
            status: record ? symbolStatusFromRecord(record) : 'unknown',
        };
    });
};
import { discoverVolatilitySymbols, getMetadataSymbolCode } from '../market-catalog';

describe('public volatility market metadata', () => {
    it('reads the Options API underlying symbol fields and numeric availability flags', () => {
        const symbols = discoverVolatilitySymbols([{
            underlying_symbol: '1HZ100V',
            underlying_symbol_name: 'Volatility 100 (1s) Index',
            market: 'synthetic_index',
            submarket: 'random_index',
            pip_size: 0.01,
            exchange_is_open: 1,
            is_trading_suspended: 0,
        }]);
        const volatility100 = symbols.find(symbol => symbol.symbol === '1HZ100V');

        expect(getMetadataSymbolCode({
            underlying_symbol: '1HZ100V',
            underlying_symbol_name: 'Volatility 100 (1s) Index',
        })).toBe('1HZ100V');
        expect(volatility100).toMatchObject({
            symbol: '1HZ100V',
            displayName: 'Volatility 100 (1s) Index',
            market: 'Synthetic Index',
            submarket: 'Random Index',
            pipSize: 0.01,
            status: 'open',
        });
    });

    it('marks closed and suspended instruments unavailable', () => {
        const symbols = discoverVolatilitySymbols([
            { underlying_symbol: 'R_10', exchange_is_open: 0, is_trading_suspended: 0 },
            { underlying_symbol: 'R_100', exchange_is_open: 1, is_trading_suspended: 1 },
        ]);

        expect(symbols.find(symbol => symbol.symbol === 'R_10')?.status).toBe('closed');
        expect(symbols.find(symbol => symbol.symbol === 'R_100')?.status).toBe('closed');
    });

    it('keeps supporting legacy symbol metadata and the verified catalogue fallback', () => {
        const legacySymbols = discoverVolatilitySymbols([
            { symbol: 'R_100', display_name: 'Volatility 100 Index', exchange_is_open: true },
        ]);
        const fallbackSymbols = discoverVolatilitySymbols([]);

        expect(legacySymbols.find(symbol => symbol.symbol === 'R_100')).toMatchObject({
            displayName: 'Volatility 100 Index',
            status: 'open',
        });
        expect(fallbackSymbols.find(symbol => symbol.symbol === 'R_100')?.status).toBe('unknown');
    });
});
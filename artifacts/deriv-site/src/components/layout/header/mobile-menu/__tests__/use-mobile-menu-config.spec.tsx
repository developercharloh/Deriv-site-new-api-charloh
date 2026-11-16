import { renderHook } from '@testing-library/react';
import useMobileMenuConfig from '../use-mobile-menu-config';

jest.mock('@/hooks/useStore', () => ({ useStore: () => null }));
jest.mock('@/hooks/useThemeSwitcher', () => ({
    __esModule: true,
    default: () => ({ is_dark_mode_on: false, toggleTheme: jest.fn() }),
}));
jest.mock('@deriv-com/translations', () => ({
    useTranslations: () => ({ localize: (value: string) => value }),
}));

describe('mobile analysis navigation during startup', () => {
    it('renders safely before the store provider has initialized', () => {
        const { result } = renderHook(() => useMobileMenuConfig(undefined, undefined, false));
        const analysis = result.current.config.flat().find(item => item.label === 'AI Analysis Tool');
        expect(analysis).toBeDefined();
        expect(() => analysis?.onClick?.()).not.toThrow();
    });
});

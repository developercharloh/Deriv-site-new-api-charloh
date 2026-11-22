import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AiAnalysisTool from '../index';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { AnalysisApiClient, DerivAnalysisMessage } from '../ai-analysis-feed';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));
jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('mobx-react-lite', () => ({ observer: (component: unknown) => component }));
jest.mock('@/constants/bot-contents', () => ({ DBOT_TABS: { BOT_BUILDER: 1 } }));

const createApi = () => {
    const listeners = new Set<(raw: unknown) => void>();
    const send = jest.fn((_request: Record<string, unknown>): unknown => undefined);
    const api: AnalysisApiClient = {
        send,
        onMessage: () => ({
            subscribe: callback => {
                listeners.add(callback);
                return { unsubscribe: () => listeners.delete(callback) };
            },
        }),
    };
    const emitFor = (request: Record<string, unknown>, message: DerivAnalysisMessage) => {
        act(() => listeners.forEach(listener => listener({
            data: { req_id: request.req_id, ...message },
        })));
    };
    const emit = (message: DerivAnalysisMessage) => {
        const requests = send.mock.calls.filter(([request]) => 'ticks_history' in request);
        const request = requests[requests.length - 1][0];
        emitFor(request, message);
    };
    const load = (
        id: string,
        prices: Array<string | number> = [100.01, 100.02],
        historyPipSize = 2,
        tickQuote: string | number = 100.03,
        tickPipSize = historyPipSize
    ) => {
        emit({ msg_type: 'history', history: { prices }, pip_size: historyPipSize, subscription: { id } });
        emit({ msg_type: 'tick', tick: { quote: tickQuote, pip_size: tickPipSize }, subscription: { id } });
    };
    const loadSymbol = (
        symbol: string,
        prices: Array<string | number> = [100.01, 100.02],
        historyPipSize = 2,
        tickQuote: string | number = 100.03,
        tickPipSize = historyPipSize,
        id = `subscription-${symbol}`,
    ) => {
        const request = [...send.mock.calls]
            .reverse()
            .find(([candidate]) => candidate.ticks_history === symbol)?.[0];
        if (!request) throw new Error(`No history request found for ${symbol}`);
        emitFor(request, { msg_type: 'history', history: { prices }, pip_size: historyPipSize, subscription: { id } });
        emitFor(request, { msg_type: 'tick', tick: { quote: tickQuote, pip_size: tickPipSize }, subscription: { id } });
    };
    return { api, send, emit, load, loadSymbol, listeners };
};

describe('AI Analysis site-session lifecycle', () => {
    let status: string;
    let account: string;
    let site: ReturnType<typeof createApi>;

    beforeEach(() => {
        jest.useFakeTimers();
        status = 'opened';
        account = 'test-account';
        site = createApi();
        (api_base as unknown as { api: AnalysisApiClient }).api = site.api;
        (useApiBase as jest.Mock).mockImplementation(() => ({ connectionStatus: status }));
        (useStore as jest.Mock).mockImplementation(() => ({
            dashboard: { setActiveTab: jest.fn() },
            client: { loginid: account },
            run_panel: { is_stop_button_visible: false },
        }));
    });

    afterEach(() => { jest.useRealTimers(); });

    it('uses selected market precision and tick window for live analysis, then releases streams on exit', () => {
        const view = render(<AiAnalysisTool />);
        expect(screen.queryByText(/Statistical analysis only/)).not.toBeInTheDocument();
        expect(screen.getByTestId('input-tick-window')).toHaveValue(120);
        const makePrices = (count: number, decimals: number) =>
            Array.from({ length: count }, (_, index) => `100.${String(index % 10).padStart(decimals, '0')}`);
        site.load('market-one', makePrices(1000, 2), 2, '100.03', 2);
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Live');
        expect(screen.getByText('100.03')).toBeInTheDocument();
        expect(screen.getByText('Last 120')).toBeInTheDocument();
        expect(view.container.querySelectorAll('.aat-market-card__digit')).toHaveLength(10);
        expect(screen.getByTestId('text-ai-recommendation-volatility-25-1s')).toBeInTheDocument();
        expect(screen.getByTestId('text-ai-confidence-volatility-25-1s')).toBeInTheDocument();
        const selectors = screen.getAllByRole('combobox');
        fireEvent.change(selectors[1], { target: { value: 'matches_differs' } });
        expect(screen.getByTestId('select-analysis-type')).toHaveValue('matches_differs');
        fireEvent.change(selectors[0], { target: { value: 'JD10' } });
        expect(site.send).toHaveBeenCalledWith({ forget: 'market-one' });
        expect(site.send).toHaveBeenLastCalledWith(expect.objectContaining({ ticks_history: 'JD10' }));
        expect(screen.queryByText('100.03')).not.toBeInTheDocument();
        site.load('market-two', makePrices(200, 3), 2, '100.457', 3);
        expect(screen.getByText('100.457')).toBeInTheDocument();
        expect(screen.getByText('Last 120')).toBeInTheDocument();
        expect(view.container.querySelector('.aat-market-card__digit--active .aat-market-card__digit-number')).toHaveTextContent('7');
        const tickInput = screen.getByTestId('input-tick-window');
        fireEvent.change(tickInput, { target: { value: '500' } });
        fireEvent.blur(tickInput);
        expect(site.send).toHaveBeenCalledWith({ forget: 'market-two' });
        expect(site.send).toHaveBeenLastCalledWith(expect.objectContaining({ ticks_history: 'JD10', count: 500 }));
        site.load('window-two', makePrices(500, 3), 3, '100.456', 3);
        expect(screen.getByText('100.456')).toBeInTheDocument();
        expect(screen.getByText('Last 500')).toBeInTheDocument();
        expect(view.container.querySelector('.aat-market-card__digit--active .aat-market-card__digit-number')).toHaveTextContent('6');
        view.unmount();
        expect(site.send).toHaveBeenLastCalledWith({ forget: 'window-two' });
        expect(site.listeners.size).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('follows site disconnect and reconnect without creating another connection', () => {
        const view = render(<AiAnalysisTool />);
        site.load('first');
        status = 'closed';
        view.rerender(<AiAnalysisTool />);
        expect(screen.getByText(/site connection was interrupted/)).toBeInTheDocument();
        expect(site.listeners.size).toBe(0);
        const oldSite = site;
        site = createApi();
        (api_base as unknown as { api: AnalysisApiClient }).api = site.api;
        status = 'opened';
        view.rerender(<AiAnalysisTool />);
        site.load('replacement');
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Live');
        expect(screen.queryByText(/site connection was interrupted/)).not.toBeInTheDocument();
        expect(oldSite.listeners.size).toBe(0);
        expect(site.listeners.size).toBe(1);
        view.unmount();
    });

    it('clears old account data and rebinds when the selected site account changes', () => {
        const view = render(<AiAnalysisTool />);
        site.load('old-account');
        account = 'other-test-account';
        view.rerender(<AiAnalysisTool />);
        expect(site.send).toHaveBeenCalledWith({ forget: 'old-account' });
        expect(screen.queryByText('100.03')).not.toBeInTheDocument();
        site.load('new-account');
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Live');
        view.unmount();
    });

    it('shows broker errors and lets users retry through the same client', () => {
        const view = render(<AiAnalysisTool />);
        site.emit({ error: { message: 'Market data unavailable' } });
        expect(screen.getByText(/Market data unavailable/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
        expect(site.send.mock.calls.filter(([request]) => 'ticks_history' in request)).toHaveLength(2);
        site.load('retried');
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Live');
        expect(screen.queryByText(/Market data unavailable/)).not.toBeInTheDocument();
        view.unmount();
    });

    it('automatically retries a server error and resumes when the shared feed returns', () => {
        const view = render(<AiAnalysisTool />);
        site.emit({ error: { message: 'Internal server error' } });
        expect(screen.getByText(/Retrying automatically in 2s/)).toBeInTheDocument();

        act(() => jest.advanceTimersByTime(2_000));
        expect(site.send.mock.calls.filter(([request]) => 'ticks_history' in request)).toHaveLength(2);

        site.load('recovered-feed');
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Live');
        expect(screen.queryByText(/Internal server error/)).not.toBeInTheDocument();

        view.unmount();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not remain connecting forever when the site or market data is unavailable', () => {
        status = 'unknown';
        const view = render(<AiAnalysisTool />);
        expect(site.send).not.toHaveBeenCalled();
        act(() => jest.advanceTimersByTime(12_000));
        expect(screen.getByText(/No live data arrived/)).toBeInTheDocument();
        status = 'opened';
        view.rerender(<AiAnalysisTool />);
        site.emit({ msg_type: 'history', history: { prices: [100.01] }, subscription: { id: 'history-only' } });
        act(() => jest.advanceTimersByTime(12_000));
        expect(screen.getByText(/No live data arrived/)).toBeInTheDocument();
        site.emit({ msg_type: 'tick', tick: { quote: 100.03 }, subscription: { id: 'history-only' } });
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Live');
        expect(screen.queryByText(/No live data arrived/)).not.toBeInTheDocument();
        view.unmount();
    });

    it('stops labeling a stalled feed as live and recovers when ticks resume', () => {
        const view = render(<AiAnalysisTool />);
        site.load('stalled-stream');
        expect(screen.getByText('100.03')).toBeInTheDocument();
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Live');

        act(() => jest.advanceTimersByTime(12_000));
        expect(screen.getByText(/Live ticks stopped arriving/)).toBeInTheDocument();
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Offline');
        expect(view.container.querySelector('.aat-market-card__price')).toHaveTextContent('—');

        site.emit({
            msg_type: 'tick',
            tick: { quote: '100.04', pip_size: 2 },
            subscription: { id: 'stalled-stream' },
        });
        expect(screen.getByTestId('status-analysis-connection')).toHaveTextContent('Live');
        expect(screen.queryByText(/Live ticks stopped arriving/)).not.toBeInTheDocument();
        expect(screen.getByText('100.04')).toBeInTheDocument();
        view.unmount();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('loads every continuous volatility index in Wide Eye through the site connection', () => {
        const view = render(<AiAnalysisTool />);
        fireEvent.click(screen.getByTestId('button-wide-eye'));

        const requests = site.send.mock.calls
            .map(([request]) => request)
            .filter(request => typeof request.ticks_history === 'string')
            .slice(-8);
        expect(requests.map(request => request.ticks_history)).toEqual([
            '1HZ10V', '1HZ15V', '1HZ25V', '1HZ30V',
            '1HZ50V', '1HZ75V', '1HZ90V', '1HZ100V',
        ]);
        expect(view.container.querySelectorAll('.aat__wide-list .aat-market-card')).toHaveLength(8);

        const makePrices = (count: number) =>
            Array.from({ length: count }, (_, index) => `100.${String(index % 10).padStart(2, '0')}`);
        site.loadSymbol('1HZ25V', makePrices(120), 2, '100.07');

        const marketCard = view.container.querySelector('[data-testid="card-market-volatility-25-1s"]');
        expect(marketCard).toHaveTextContent('Live');
        expect(marketCard).toHaveTextContent('100.07');
        expect(marketCard?.querySelectorAll('.aat-market-card__digit')).toHaveLength(10);
        expect(marketCard?.querySelector('[data-testid="text-ai-recommendation-volatility-25-1s"]')).not.toBeNull();

        view.unmount();
        expect(site.listeners.size).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });
});

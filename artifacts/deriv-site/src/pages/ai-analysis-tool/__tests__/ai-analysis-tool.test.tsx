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
    const emit = (message: DerivAnalysisMessage) => {
        const requests = send.mock.calls.filter(([request]) => 'ticks_history' in request);
        const request = requests[requests.length - 1][0];
        act(() => listeners.forEach(listener => listener({ data: { req_id: request.req_id, ...message } })));
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
    return { api, send, emit, load, listeners };
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
        const makePrices = (count: number, decimals: number) =>
            Array.from({ length: count }, (_, index) => `100.${String(index % 10).padStart(decimals, '0')}`);
        site.load('market-one', makePrices(1000, 2), 2, '100.03', 2);
        expect(screen.getByText('Streaming')).toBeInTheDocument();
        expect(screen.getByText('100.03')).toBeInTheDocument();
        expect(screen.getByText('(Last 1,000 Ticks)')).toBeInTheDocument();
        expect(view.container.querySelectorAll('.aat__pattern-block')).toHaveLength(20);
        const selectors = screen.getAllByRole('combobox');
        fireEvent.change(selectors[1], { target: { value: 'matches_differs' } });
        expect(Array.from(view.container.querySelectorAll('.aat__pattern-block')).some(
            pattern => ['M', 'D'].includes(pattern.textContent ?? '')
        )).toBe(true);
        fireEvent.change(selectors[0], { target: { value: 'JD10' } });
        expect(site.send).toHaveBeenCalledWith({ forget: 'market-one' });
        expect(site.send).toHaveBeenLastCalledWith(expect.objectContaining({ ticks_history: 'JD10' }));
        expect(screen.queryByText('100.03')).not.toBeInTheDocument();
        site.load('market-two', makePrices(200, 3), 2, '100.457', 3);
        expect(screen.getByText('100.457')).toBeInTheDocument();
        expect(screen.getByText('(Last 201 Ticks)')).toBeInTheDocument();
        expect(view.container.querySelector('.aat__dist-cell--active .aat__dist-digit')).toHaveTextContent('7');
        fireEvent.change(selectors[2], { target: { value: '500' } });
        expect(site.send).toHaveBeenCalledWith({ forget: 'market-two' });
        expect(site.send).toHaveBeenLastCalledWith(expect.objectContaining({ ticks_history: 'JD10', count: 500 }));
        site.load('window-two', makePrices(500, 3), 3, '100.456', 3);
        expect(screen.getByText('100.456')).toBeInTheDocument();
        expect(screen.getByText('(Last 500 Ticks)')).toBeInTheDocument();
        expect(view.container.querySelector('.aat__dist-cell--active .aat__dist-digit')).toHaveTextContent('6');
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
        expect(screen.getByRole('status')).toHaveTextContent('site connection was interrupted');
        expect(site.listeners.size).toBe(0);
        const oldSite = site;
        site = createApi();
        (api_base as unknown as { api: AnalysisApiClient }).api = site.api;
        status = 'opened';
        view.rerender(<AiAnalysisTool />);
        site.load('replacement');
        expect(screen.getByText('Streaming')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
        expect(screen.getByText('Streaming')).toBeInTheDocument();
        view.unmount();
    });

    it('shows broker errors and lets users retry through the same client', () => {
        const view = render(<AiAnalysisTool />);
        site.emit({ error: { message: 'Market data unavailable' } });
        expect(screen.getByRole('status')).toHaveTextContent('Market data unavailable');
        fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
        expect(site.send.mock.calls.filter(([request]) => 'ticks_history' in request)).toHaveLength(2);
        site.load('retried');
        expect(screen.getByText('Streaming')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        view.unmount();
    });

    it('automatically retries a server error and resumes when the shared feed returns', () => {
        const view = render(<AiAnalysisTool />);
        site.emit({ error: { message: 'Internal server error' } });
        expect(screen.getByRole('status')).toHaveTextContent('Retrying automatically in 2s');

        act(() => jest.advanceTimersByTime(2_000));
        expect(site.send.mock.calls.filter(([request]) => 'ticks_history' in request)).toHaveLength(2);

        site.load('recovered-feed');
        expect(screen.getByText('Streaming')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        view.unmount();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not remain connecting forever when the site or market data is unavailable', () => {
        status = 'unknown';
        const view = render(<AiAnalysisTool />);
        expect(site.send).not.toHaveBeenCalled();
        act(() => jest.advanceTimersByTime(12_000));
        expect(screen.getByRole('status')).toHaveTextContent('No live data arrived');
        status = 'opened';
        view.rerender(<AiAnalysisTool />);
        site.emit({ msg_type: 'history', history: { prices: [100.01] }, subscription: { id: 'history-only' } });
        act(() => jest.advanceTimersByTime(12_000));
        expect(screen.getByRole('status')).toHaveTextContent('No live data arrived');
        site.emit({ msg_type: 'tick', tick: { quote: 100.03 }, subscription: { id: 'history-only' } });
        expect(screen.getByText('Streaming')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        view.unmount();
    });

    it('stops labeling a stalled feed as live and recovers when ticks resume', () => {
        const view = render(<AiAnalysisTool />);
        site.load('stalled-stream');
        expect(screen.getByText('100.03')).toBeInTheDocument();
        expect(screen.getByText('Streaming')).toBeInTheDocument();

        act(() => jest.advanceTimersByTime(12_000));
        expect(screen.getByRole('status')).toHaveTextContent('Live ticks stopped arriving');
        expect(screen.getByText('Offline')).toBeInTheDocument();
        expect(view.container.querySelector('.aat__price-val')).toHaveTextContent('—');
        expect(view.container.querySelectorAll('.aat__pattern-block')).toHaveLength(0);

        site.emit({
            msg_type: 'tick',
            tick: { quote: '100.04', pip_size: 2 },
            subscription: { id: 'stalled-stream' },
        });
        expect(screen.getByText('Streaming')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByText('100.04')).toBeInTheDocument();
        view.unmount();
        expect(jest.getTimerCount()).toBe(0);
    });
});

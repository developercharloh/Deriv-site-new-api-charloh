import React from 'react';
import { render, screen } from '@testing-library/react';
import AnalysisMarketCard from '../AnalysisMarketCard';

const makePrices = (counts: number[]) => counts.flatMap((count, digit) =>
    Array.from({ length: count }, (_, index) => 100 + (digit / 100) + index),
);

describe('AnalysisMarketCard', () => {
    it('shows current market movement without a target or waiting label', () => {
        const prices = makePrices([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        render(
            <AnalysisMarketCard
                marketLabel='Volatility 25 (1s)'
                livePrice={100.09}
                pipSize={2}
                prices={prices}
                tickWindow={120}
                connected
                aiResult={null}
                overUnderBarrier={4}
                overUnderEntryValid={false}
                riseFallEntryValid={false}
                evenOddEntryValid={false}
            />,
        );

        expect(screen.getByTestId('digit-frequency-volatility-25-1s-0')).toHaveClass('aat-market-card__digit--least');
        expect(screen.getByTestId('digit-frequency-volatility-25-1s-1')).toHaveClass('aat-market-card__digit--second-least');
        expect(screen.getByTestId('digit-frequency-volatility-25-1s-8')).toHaveClass('aat-market-card__digit--second-most');
        expect(screen.getByTestId('digit-frequency-volatility-25-1s-9')).toHaveClass('aat-market-card__digit--most');
        expect(screen.queryByText(/most frequent|least frequent/i)).not.toBeInTheDocument();
        expect(screen.getByText('Recent movement · latest ticks')).toBeInTheDocument();
        expect(screen.getByTestId('status-over-under-entry-volatility-25-1s-sequence')).toHaveTextContent('Ov Ov Ov Ov Ov Ov Ov Ov Ov');
        expect(screen.getByTestId('status-rise-fall-entry-volatility-25-1s-sequence')).toHaveTextContent('RRRRRRRRR');
        expect(screen.getByTestId('status-even-odd-entry-volatility-25-1s-sequence')).toHaveTextContent('EOOOOOOOOOO');
        expect(screen.getByTestId('status-over-under-entry-volatility-25-1s-sequence').querySelectorAll('.aat-market-card__entry-token--over')).toHaveLength(9);
        expect(screen.getByTestId('status-even-odd-entry-volatility-25-1s-sequence').querySelector('.aat-market-card__entry-token--odd')).toBeInTheDocument();
        expect(screen.getByTestId('status-rise-fall-entry-volatility-25-1s-sequence').querySelector('.aat-market-card__entry-token--rise')).toBeInTheDocument();
        expect(screen.queryByText(/^Target:/)).not.toBeInTheDocument();
        expect(screen.queryByText('Wait')).not.toBeInTheDocument();
    });

    it('shows Entry only when the live sequence matches', () => {
        const prices = [5, 6, 7, 3, 2, 8, 1, 0, 3].map(digit => 100 + digit / 100);
        render(
            <AnalysisMarketCard
                marketLabel='Volatility 25 (1s)'
                livePrice={100.03}
                pipSize={2}
                prices={prices}
                tickWindow={9}
                connected
                aiResult={null}
                overUnderBarrier={4}
                overUnderEntryValid
                riseFallEntryValid={false}
                evenOddEntryValid={false}
            />,
        );

        expect(screen.getByTestId('status-over-under-entry-volatility-25-1s')).toHaveTextContent('Entry');
        expect(screen.getByTestId('pointer-current-digit-volatility-25-1s')).toHaveClass('aat-market-card__pointer--down');
        expect(screen.getByTestId('status-over-under-entry-volatility-25-1s-sequence')).toHaveTextContent('Ov Ov Ov U U Ov U U U');
        expect(screen.queryByText('Wait')).not.toBeInTheDocument();
        expect(screen.queryByText(/^Target:/)).not.toBeInTheDocument();
    });

    it('shows Over/Under percentages for the selected barrier and excludes equal digits', () => {
        const prices = Array.from({ length: 10 }, (_, digit) => 100 + digit / 100);
        render(
            <AnalysisMarketCard
                marketLabel='Volatility 25 (1s)'
                livePrice={100.09}
                pipSize={2}
                prices={prices}
                tickWindow={10}
                connected
                aiResult={null}
                overUnderBarrier={4}
                overUnderEntryValid={false}
                riseFallEntryValid={false}
                evenOddEntryValid={false}
            />,
        );

        expect(screen.getByTestId('bar-over-under-volatility-25-1s')).toHaveTextContent('Over 4: 50.0%');
        expect(screen.getByTestId('bar-over-under-volatility-25-1s')).toHaveTextContent('Under 4: 40.0%');
        expect(screen.getByTestId('text-over-under-equal-volatility-25-1s')).toHaveTextContent('At barrier: 10.0% · 10 ticks');
    });

    it('respects the valid Over 0–8 and Under 1–9 barrier ranges', () => {
        const prices = Array.from({ length: 10 }, (_, digit) => 100 + digit / 100);
        const { rerender } = render(
            <AnalysisMarketCard
                marketLabel='Volatility 25 (1s)'
                livePrice={100.09}
                pipSize={2}
                prices={prices}
                tickWindow={10}
                connected
                aiResult={null}
                overUnderBarrier={0}
                overUnderEntryValid={false}
                riseFallEntryValid={false}
                evenOddEntryValid={false}
            />,
        );

        expect(screen.getByTestId('bar-over-under-volatility-25-1s')).toHaveTextContent('Over 0: 90.0%');
        expect(screen.getByTestId('bar-over-under-volatility-25-1s')).toHaveTextContent('Under 0: N/A');

        rerender(
            <AnalysisMarketCard
                marketLabel='Volatility 25 (1s)'
                livePrice={100.09}
                pipSize={2}
                prices={prices}
                tickWindow={10}
                connected
                aiResult={null}
                overUnderBarrier={9}
                overUnderEntryValid={false}
                riseFallEntryValid={false}
                evenOddEntryValid={false}
            />,
        );
        expect(screen.getByTestId('bar-over-under-volatility-25-1s')).toHaveTextContent('Over 9: N/A');
        expect(screen.getByTestId('bar-over-under-volatility-25-1s')).toHaveTextContent('Under 9: 90.0%');
    });

    it('keeps all digit circles neutral until tick history arrives', () => {
        const { container } = render(
            <AnalysisMarketCard
                marketLabel='Volatility 10 (1s)'
                livePrice={null}
                pipSize={2}
                prices={[]}
                tickWindow={120}
                connected={false}
                aiResult={null}
                overUnderBarrier={4}
                overUnderEntryValid={false}
                riseFallEntryValid={false}
                evenOddEntryValid={false}
            />,
        );

        expect(container.querySelectorAll('.aat-market-card__digit--neutral')).toHaveLength(10);
        expect(screen.getByTestId('text-no-recent-digits-volatility-10-1s')).toHaveTextContent('Waiting for ticks');
    });

    it('colors every digit tied at a frequency rank without inventing a rank order', () => {
        const { container } = render(
            <AnalysisMarketCard
                marketLabel='Volatility 50 (1s)'
                livePrice={100.05}
                pipSize={2}
                prices={makePrices([1, 1, 2, 2, 3, 3, 4, 4, 5, 5])}
                tickWindow={120}
                connected
                aiResult={null}
                overUnderBarrier={4}
                overUnderEntryValid={false}
                riseFallEntryValid={false}
                evenOddEntryValid={false}
            />,
        );

        expect(container.querySelectorAll('.aat-market-card__digit--least')).toHaveLength(2);
        expect(container.querySelectorAll('.aat-market-card__digit--second-least')).toHaveLength(2);
        expect(container.querySelectorAll('.aat-market-card__digit--second-most')).toHaveLength(2);
        expect(container.querySelectorAll('.aat-market-card__digit--most')).toHaveLength(2);
    });
});

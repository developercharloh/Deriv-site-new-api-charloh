import React from 'react';
import { render, screen } from '@testing-library/react';
import AnalysisMarketCard from '../AnalysisMarketCard';

const makePrices = (counts: number[]) => counts.flatMap((count, digit) =>
    Array.from({ length: count }, (_, index) => 100 + (digit / 100) + index),
);

describe('AnalysisMarketCard', () => {
    it('uses color-only frequency ranks and displays both entry pattern checks', () => {
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
                riseFallEntryValid
                evenOddEntryValid={false}
            />,
        );

        expect(screen.getByTestId('digit-frequency-volatility-25-1s-0')).toHaveClass('aat-market-card__digit--least');
        expect(screen.getByTestId('digit-frequency-volatility-25-1s-1')).toHaveClass('aat-market-card__digit--second-least');
        expect(screen.getByTestId('digit-frequency-volatility-25-1s-8')).toHaveClass('aat-market-card__digit--second-most');
        expect(screen.getByTestId('digit-frequency-volatility-25-1s-9')).toHaveClass('aat-market-card__digit--most');
        expect(screen.queryByText(/most frequent|least frequent/i)).not.toBeInTheDocument();
        expect(screen.getByTestId('status-rise-fall-entry-volatility-25-1s')).toHaveTextContent('RRRFFRFFF');
        expect(screen.getByTestId('status-rise-fall-entry-volatility-25-1s')).toHaveTextContent('Valid');
        expect(screen.getByTestId('status-even-odd-entry-volatility-25-1s')).toHaveTextContent('EEEOEEEEOOO');
        expect(screen.getByTestId('status-even-odd-entry-volatility-25-1s')).toHaveTextContent('Wait');
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

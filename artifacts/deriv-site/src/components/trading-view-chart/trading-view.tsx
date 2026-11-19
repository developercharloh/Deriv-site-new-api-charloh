const tradingViewUrl = 'https://charts.deriv.com/deriv?hide-signup=true&instrument=R_25&timePeriod=1';

const TradingViewComponent = () => {
    return (
        <div className='trading-view-launcher'>
            <div className='trading-view-launcher__card'>
                <p className='trading-view-launcher__eyebrow'>Official Deriv tool</p>
                <h1>TradingView charts</h1>
                <p className='trading-view-launcher__description'>
                    Open Deriv’s live chart in a separate tab to use the full chart and drawing tools.
                </p>
                <a
                    className='trading-view-launcher__link'
                    href={tradingViewUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    Open Deriv TradingView
                </a>
                <p className='trading-view-launcher__note'>
                    Opens on Volatility 25 with a 1-minute interval. Return to this tab to continue.
                </p>
            </div>
        </div>
    );
};

export default TradingViewComponent;

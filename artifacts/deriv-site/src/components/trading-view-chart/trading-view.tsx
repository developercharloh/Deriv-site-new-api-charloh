const tradingViewUrl = 'https://charts.deriv.com/deriv?hide-signup=true&instrument=R_25&timePeriod=1';

const TradingViewComponent = () => {
    return (
        <iframe
            id='trading-view-iframe'
            title='TradingView advanced charts and tools from Deriv'
            src={tradingViewUrl}
            allow='fullscreen'
            allowFullScreen
            loading='eager'
        />
    );
};

export default TradingViewComponent;

const TradingViewComponent = () => {
    return (
        <iframe
            id='trading-view-iframe'
            title='TradingView advanced charts and tools from Deriv'
            style={{ width: '100%', height: '100%', backgroundColor: 'white' }}
            src='https://charts.deriv.com/deriv?hide-signup=true&instrument=R_25&timePeriod=1'
        />
    );
};

export default TradingViewComponent;

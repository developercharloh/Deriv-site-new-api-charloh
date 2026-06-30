import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import './analysis-tool.scss';

const TOOL_URL = 'https://bot-analysis-tool-belex.web.app';

const AnalysisTool = observer(() => {
    const [launched, setLaunched] = useState(false);

    return (
        <div className='analysis-tool'>
            <div className='analysis-tool__launch-wrapper'>
                <div className='analysis-tool__card'>
                    <div className='analysis-tool__icon'>🤖</div>
                    <h2 className='analysis-tool__title'>AI Bot Analysis Tool</h2>
                    <p className='analysis-tool__desc'>
                        Analyse your Deriv bot performance with AI — contract history, win rate,
                        profit curves, drawdown, and strategy insights.
                    </p>
                    <div className='analysis-tool__buttons'>
                        <a
                            href={TOOL_URL}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='analysis-tool__btn analysis-tool__btn--primary'
                            onClick={() => setLaunched(true)}
                        >
                            🚀 Open Analysis Tool
                        </a>
                        {launched && (
                            <p className='analysis-tool__launched-msg'>
                                ✅ Opened in a new tab! Switch to it to start analysing.
                            </p>
                        )}
                    </div>
                    <div className='analysis-tool__features'>
                        <div className='analysis-tool__feature'><span>📈</span><span>Win rate &amp; profit curves</span></div>
                        <div className='analysis-tool__feature'><span>🎯</span><span>Entry point analysis</span></div>
                        <div className='analysis-tool__feature'><span>📉</span><span>Drawdown &amp; risk metrics</span></div>
                        <div className='analysis-tool__feature'><span>🧠</span><span>AI strategy recommendations</span></div>
                        <div className='analysis-tool__feature'><span>📊</span><span>Digit frequency &amp; pattern stats</span></div>
                        <div className='analysis-tool__feature'><span>🔍</span><span>Contract-by-contract breakdown</span></div>
                    </div>
                    <p className='analysis-tool__note'>
                        Opens securely at <strong>bot-analysis-tool-belex.web.app</strong>
                    </p>
                </div>
            </div>
        </div>
    );
});

export default AnalysisTool;

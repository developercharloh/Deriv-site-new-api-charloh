import React from 'react';
import './execution-plan.scss';

const ExecutionPlan: React.FC = () => (
    <div className='ep'>
        <div className='ep__glow' />
        <div className='ep__icon'>🗂</div>
        <h1 className='ep__title'>
            Execution<br /><span className='ep__accent'>Plan</span>
        </h1>
        <p className='ep__sub'>We&rsquo;re building something powerful for you.</p>
        <div className='ep__badge'>COMING SOON</div>
        <p className='ep__desc'>
            The Execution Plan will let you configure, schedule, and automate
            your trading strategies with precision — all in one place.
        </p>
        <div className='ep__dots'>
            <span /><span /><span />
        </div>
    </div>
);

export default ExecutionPlan;

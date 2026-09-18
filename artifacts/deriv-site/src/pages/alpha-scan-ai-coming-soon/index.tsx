import React, { useState } from 'react';
import { Localize } from '@deriv-com/translations';

type ParameterCardProps = {
    tone: 'violet' | 'teal' | 'orange' | 'blue';
    icon: string;
    title: string;
    subtitle: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
};

const ParameterCard: React.FC<ParameterCardProps> = ({
    tone,
    icon,
    title,
    subtitle,
    value,
    onChange,
    min = 0,
}) => (
    <article className={`nexus-parameter nexus-parameter--${tone}`}>
        <div className='nexus-parameter__heading'>
            <span className='nexus-parameter__icon' aria-hidden='true'>{icon}</span>
            <span>
                <strong>{title}</strong>
                <small>{subtitle}</small>
            </span>
        </div>
        <div className='nexus-parameter__stepper'>
            <button type='button' aria-label={`Decrease ${title}`} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
            <strong>{value}</strong>
            <button type='button' aria-label={`Increase ${title}`} onClick={() => onChange(value + 1)}>+</button>
        </div>
    </article>
);

const NexusAIComingSoon: React.FC = () => {
    const [stake, setStake] = useState(1);
    const [takeProfit, setTakeProfit] = useState(10);
    const [stopLoss, setStopLoss] = useState(50);
    const [multiplier, setMultiplier] = useState(2);
    const [recoveryMode, setRecoveryMode] = useState(true);
    const [status, setStatus] = useState('Standby');

    return (
        <section className='ai-analysis-coming-soon nexus-ai' aria-labelledby='nexus-ai-title'>
            <div className='nexus-ai__shell'>
                <div className='nexus-ai__hero' aria-label='Nexus AI adaptive trading engine'>
                    <img src='/assets/nexus-ai-reference.jpg' alt='' />
                </div>

                <div className='nexus-ai__parameters'>
                    <div className='nexus-ai__section-heading'>
                        <strong>TRADING PARAMETERS</strong>
                        <button type='button' className='nexus-ai__currency' aria-label='Currency USD'>USD</button>
                        <span>USD - 1 tick</span>
                    </div>
                    <div className='nexus-ai__status'>
                        <span className={status === 'Standby' ? 'nexus-ai__status-dot' : 'nexus-ai__status-dot nexus-ai__status-dot--active'} />
                        <strong>{status}</strong>
                    </div>

                    <div className='nexus-ai__parameter-grid'>
                        <ParameterCard
                            tone='violet'
                            icon='▱'
                            title='Stake'
                            subtitle='Amount per trade'
                            value={stake}
                            onChange={setStake}
                            min={1}
                        />
                        <ParameterCard
                            tone='teal'
                            icon='◎'
                            title='Take Profit'
                            subtitle='Total profit target'
                            value={takeProfit}
                            onChange={setTakeProfit}
                            min={1}
                        />
                        <ParameterCard
                            tone='orange'
                            icon='♢'
                            title='Stop Loss'
                            subtitle='Max allowed loss'
                            value={stopLoss}
                            onChange={setStopLoss}
                            min={1}
                        />
                        <ParameterCard
                            tone='blue'
                            icon='⌘'
                            title='Multiplier'
                            subtitle='Increase after loss'
                            value={multiplier}
                            onChange={setMultiplier}
                            min={1}
                        />
                    </div>

                    <div className='nexus-ai__recovery'>
                        <span className='nexus-ai__recovery-icon' aria-hidden='true'>↻</span>
                        <span className='nexus-ai__recovery-copy'>
                            <strong>Recovery Mode</strong>
                            <small>Auto increase after loss</small>
                            <em>After a loss, increase the stake and scan both Over / Under and Even / Odd recovery patterns. Resets after a win.</em>
                        </span>
                        <button
                            type='button'
                            className={`nexus-ai__toggle ${recoveryMode ? 'nexus-ai__toggle--on' : ''}`}
                            aria-pressed={recoveryMode}
                            aria-label='Toggle Recovery Mode'
                            onClick={() => setRecoveryMode(current => !current)}
                        >
                            <span />
                        </button>
                    </div>

                    <button
                        type='button'
                        className='nexus-ai__launch'
                        onClick={() => setStatus(current => current === 'Standby' ? 'Scanning markets' : 'Standby')}
                    >
                        <span aria-hidden='true'>▶</span>
                        <strong>Launch AI</strong>
                        <span aria-hidden='true'>›</span>
                    </button>
                    <div className='nexus-ai__launch-caption'><span aria-hidden='true'>⌁</span> Scan volatility markets</div>

                    <div className='nexus-ai__stats' aria-label='Nexus AI trading statistics'>
                        <div><span className='nexus-stat-icon nexus-stat-icon--trades'>↑</span><small>Trades</small><strong>0</strong></div>
                        <div><span className='nexus-stat-icon nexus-stat-icon--wins'>♜</span><small>Wins</small><strong>0</strong></div>
                        <div><span className='nexus-stat-icon nexus-stat-icon--losses'>↓</span><small>Losses</small><strong>0</strong></div>
                        <div><span className='nexus-stat-icon nexus-stat-icon--rate'>◎</span><small>Win Rate</small><strong>0%</strong></div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default NexusAIComingSoon;
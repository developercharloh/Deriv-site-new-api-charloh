import React, { useEffect, useState } from 'react';
import './splash-loader.scss';

const PHRASES = [
    { top: 'Initializing', bottom: 'Trading Workspace...' },
    { top: 'Where Precision', bottom: 'Meets Opportunity.' },
    { top: 'Reading Volatility', bottom: 'Patterns...' },
    { top: 'Smart Money Follows', bottom: 'Smart Signals.' },
    { top: 'Risk Managed.', bottom: 'Profits Protected.' },
    { top: 'Your Edge', bottom: 'Starts Here.' },
];

const TOTAL_MS = 3200;
const PHRASE_MS = TOTAL_MS / PHRASES.length; // ~533ms each

const CANDLES = [
    { h: 64, b: 46, up: true,  left: '6%',  delay: '0s',    dur: '3.2s' },
    { h: 80, b: 58, up: false, left: '11%', delay: '0.4s',  dur: '2.8s' },
    { h: 50, b: 36, up: true,  left: '16%', delay: '0.8s',  dur: '3.6s' },
    { h: 72, b: 52, up: true,  left: '78%', delay: '0.2s',  dur: '3.0s' },
    { h: 56, b: 40, up: false, left: '83%', delay: '0.6s',  dur: '2.6s' },
    { h: 88, b: 64, up: true,  left: '88%', delay: '1.0s',  dur: '3.4s' },
    { h: 44, b: 32, up: false, left: '93%', delay: '0.3s',  dur: '2.9s' },
];

interface SplashLoaderProps {
    onDone: () => void;
}

const SplashLoader: React.FC<SplashLoaderProps> = ({ onDone }) => {
    const [phraseIdx, setPhraseIdx] = useState(0);
    const [phrasePhase, setPhrasePhase] = useState<'in' | 'hold' | 'out'>('in');
    const [exiting, setExiting] = useState(false);

    // Cycle through phrases
    useEffect(() => {
        let idx = 0;
        const tick = () => {
            // fade in
            setPhrasePhase('in');
            setTimeout(() => setPhrasePhase('hold'), 100);
            // fade out before next
            const holdTimer = setTimeout(() => {
                setPhrasePhase('out');
                const nextTimer = setTimeout(() => {
                    idx = (idx + 1) % PHRASES.length;
                    setPhraseIdx(idx);
                    tick();
                }, 500);
                return () => clearTimeout(nextTimer);
            }, PHRASE_MS - 500);
            return () => clearTimeout(holdTimer);
        };
        const cleanup = tick();
        return cleanup;
    }, []);

    // Whole splash exits after TOTAL_MS
    useEffect(() => {
        const t1 = setTimeout(() => setExiting(true), TOTAL_MS);
        const t2 = setTimeout(() => onDone(), TOTAL_MS + 700);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [onDone]);

    return (
        <div className={`spl${exiting ? ' spl--exit' : ''}`} aria-hidden='true'>
            {/* Animated background grid */}
            <div className='spl__grid' />

            {/* Floating candles (left + right columns) */}
            <div className='spl__candles'>
                {CANDLES.map((c, i) => (
                    <div
                        key={i}
                        className={`spl__candle spl__candle--${c.up ? 'up' : 'dn'}`}
                        style={{
                            left: c.left,
                            '--b': `${c.b}px`,
                            '--w': `${c.h}px`,
                            animationDelay: c.delay,
                            animationDuration: c.dur,
                        } as React.CSSProperties}
                    />
                ))}
            </div>

            {/* Central glow */}
            <div className='spl__glow' />

            {/* Content */}
            <div className='spl__content'>
                {/* Logo */}
                <div className='spl__logo-wrap'>
                    <img className='spl__logo' src='/logo.png' alt='Trader CharlohFX' draggable={false} />
                    <div className='spl__logo-ring spl__logo-ring--1' />
                    <div className='spl__logo-ring spl__logo-ring--2' />
                </div>

                {/* Cycling trading phrase */}
                <div className='spl__phrase-box'>
                    <div className={`spl__phrase spl__phrase--${phrasePhase}`}>
                        <span className='spl__phrase-top'>{PHRASES[phraseIdx].top}</span>
                        <span className='spl__phrase-bot'>{PHRASES[phraseIdx].bottom}</span>
                    </div>
                </div>

                {/* Live ticker strip */}
                <div className='spl__ticker'>
                    <div className='spl__ticker-inner'>
                        {['V10 (1s)', 'V25 (1s)', 'V50 (1s)', 'V75 (1s)', 'V100 (1s)',
                          'Boom 300', 'Boom 500', 'Boom 1000', 'Crash 300', 'Crash 500',
                          'Crash 1000', 'Step Index', 'Range Break 100', 'Range Break 200',
                          'V10 (1s)', 'V25 (1s)', 'V50 (1s)', 'V75 (1s)', 'V100 (1s)'].map((sym, i) => (
                            <span key={i} className='spl__ticker-item'>
                                <span className='spl__ticker-sym'>{sym}</span>
                                <span className={`spl__ticker-val ${i % 3 === 0 ? 'dn' : 'up'}`}>
                                    {i % 3 === 0 ? '▼' : '▲'} {(Math.random() * 2 + 0.1).toFixed(2)}%
                                </span>
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Progress bar */}
            <div className='spl__bar-track'>
                <div className='spl__bar-fill' style={{ animationDuration: `${TOTAL_MS}ms` }} />
            </div>
        </div>
    );
};

export default SplashLoader;

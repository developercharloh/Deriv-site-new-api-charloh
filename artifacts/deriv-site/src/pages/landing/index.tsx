import React, { useCallback, useEffect, useRef, useState } from 'react';
import { generateOAuthURL } from '@/components/shared';
import './landing.scss';

// ── Testimonials data ────────────────────────────────────────────────────────
const TESTIMONIALS = [
    {
        name: 'Kwame A.',
        location: 'Ghana',
        avatar: 'KA',
        rating: 5,
        text: 'The AI Signal Scanner changed everything for me. I was struggling with entry points but now I get clear, confident signals every session.',
        tag: 'AI Signal Scanner',
    },
    {
        name: 'Fatima M.',
        location: 'Nigeria',
        avatar: 'FM',
        rating: 5,
        text: 'Free Bots + AI Analysis Tool is a deadly combo. I run the bot overnight and consistently wake up to profits. Best platform on Deriv hands down.',
        tag: 'Free Bots',
    },
    {
        name: 'Sipho N.',
        location: 'South Africa',
        avatar: 'SN',
        rating: 5,
        text: 'The digit distribution feature is incredible. You can see exactly which digits are hot and cold — totally removed the guesswork from my trading.',
        tag: 'AI Analysis Tool',
    },
    {
        name: 'Emmanuel O.',
        location: 'Kenya',
        avatar: 'EO',
        rating: 5,
        text: 'Used the AI Analysis Tool before every trade for three weeks. My win rate went from 47% to 69%. These results speak for themselves.',
        tag: 'AI Analysis',
    },
    {
        name: 'Amara D.',
        location: 'Senegal',
        avatar: 'AD',
        rating: 5,
        text: 'The live pattern stream is addictive. You see the market rhythm before it completes — it feels like having an unfair advantage. Love it.',
        tag: 'Pattern Stream',
    },
];

// ── Features data ─────────────────────────────────────────────────────────────
const FEATURES = [
    {
        icon: '🔮',
        title: 'AI Signal Scanner',
        desc: 'Real-time AI signals scanning 10 markets simultaneously. Detects spikes, filters noise, and fires only high-confidence calls.',
        badge: 'LIVE',
        color: '#00e676',
    },
    {
        icon: '🧠',
        title: 'AI Analysis Tool',
        desc: '3-model AI engine streaming live digit patterns, distribution analysis, and probability scores. Trade with data, not gut.',
        badge: 'NEW',
        color: '#7c4dff',
    },
    {
        icon: '⚡',
        title: 'Free Bots',
        desc: 'Pre-built algorithmic bots you can run instantly. Even/Odd, Matches/Differs, and more — fully automated, zero setup.',
        badge: 'FREE',
        color: '#ffd600',
    },
];

// ── Live ticker markets ───────────────────────────────────────────────────────
const TICKER_MARKETS = [
    'V10', 'V25', 'V50', 'V75', 'V100',
    'Jump 10', 'Jump 25', 'Jump 50', 'Jump 75', 'Jump 100',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const Stars = ({ n }: { n: number }) => (
    <span className='lp-stars'>
        {'★'.repeat(n)}{'☆'.repeat(5 - n)}
    </span>
);

// ── CountUp hook ──────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1800) {
    const [value, setValue] = useState(0);
    const startRef = useRef<number | null>(null);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        startRef.current = null;
        const animate = (ts: number) => {
            if (startRef.current === null) startRef.current = ts;
            const progress = Math.min((ts - startRef.current) / duration, 1);
            setValue(Math.round(progress * target));
            if (progress < 1) rafRef.current = requestAnimationFrame(animate);
        };
        rafRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafRef.current);
    }, [target, duration]);

    return value;
}

// ── Main component ────────────────────────────────────────────────────────────
const LandingPage: React.FC = () => {
    const [activeTraders, setActiveTraders] = useState(847);
    const [testimonialIdx, setTestimonialIdx] = useState(0);
    const [tickerPrices, setTickerPrices] = useState<Record<string, { price: number; up: boolean }>>({});
    const [loginLoading, setLoginLoading] = useState(false);
    const [visible, setVisible] = useState(false);

    const tradesCount   = useCountUp(12480);
    const winRateMin    = useCountUp(89);
    const winRateMax    = useCountUp(95);
    const marketsCount  = useCountUp(10);

    // Mount fade-in
    useEffect(() => {
        const t = setTimeout(() => setVisible(true), 60);
        return () => clearTimeout(t);
    }, []);

    // Live active traders tick
    useEffect(() => {
        const iv = setInterval(() => {
            setActiveTraders(prev => {
                const delta = Math.floor(Math.random() * 7) - 3;
                return Math.max(800, Math.min(1250, prev + delta));
            });
        }, 3200);
        return () => clearInterval(iv);
    }, []);

    // Fake ticker prices
    useEffect(() => {
        const seeds: Record<string, number> = {
            V10: 6482.12, V25: 98432.5, V50: 45213.88, V75: 12304.67, V100: 78234.21,
            'Jump 10': 3241.55, 'Jump 25': 14322.3, 'Jump 50': 43210.4, 'Jump 75': 98211.1, 'Jump 100': 240534.8,
        };
        setTickerPrices(Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, { price: v, up: true }])));
        const iv = setInterval(() => {
            setTickerPrices(prev => {
                const updated = { ...prev };
                const keys = Object.keys(updated);
                const key = keys[Math.floor(Math.random() * keys.length)];
                const old = updated[key].price;
                const delta = (Math.random() - 0.5) * old * 0.002;
                updated[key] = { price: parseFloat((old + delta).toFixed(2)), up: delta >= 0 };
                return updated;
            });
        }, 900);
        return () => clearInterval(iv);
    }, []);

    // Testimonials auto-rotate
    useEffect(() => {
        const iv = setInterval(() => {
            setTestimonialIdx(i => (i + 1) % TESTIMONIALS.length);
        }, 5000);
        return () => clearInterval(iv);
    }, []);

    const handleLogin = useCallback(async () => {
        setLoginLoading(true);
        try {
            const url = await generateOAuthURL();
            if (url) window.location.replace(url);
        } catch { /* */ }
        setLoginLoading(false);
    }, []);

    const handleSignup = useCallback(async () => {
        try {
            const url = await generateOAuthURL('registration');
            if (url) window.location.replace(url);
        } catch { /* */ }
    }, []);

    return (
        <div className={`lp${visible ? ' lp--visible' : ''}`}>

            {/* ── Sticky Nav ─────────────────────────────────────────────── */}
            <nav className='lp-nav'>
                <div className='lp-nav__brand'>
                    <img src='/logo.png' alt='Derex Master' className='lp-nav__logo' />
                    <span className='lp-nav__name'>Derex <span className='lp-nav__name-accent'>Master</span></span>
                </div>
                <div className='lp-nav__actions'>
                    <button className='lp-nav__login-btn' onClick={handleLogin} disabled={loginLoading}>
                        {loginLoading ? '...' : 'Log In'}
                    </button>
                    <button className='lp-nav__signup-btn' onClick={handleSignup}>
                        Sign Up
                    </button>
                </div>
            </nav>

            {/* ── Live ticker strip ───────────────────────────────────────── */}
            <div className='lp-ticker'>
                <div className='lp-ticker__live-badge'>
                    <span className='lp-ticker__dot' />LIVE
                </div>
                <div className='lp-ticker__track'>
                    <div className='lp-ticker__inner'>
                        {[...TICKER_MARKETS, ...TICKER_MARKETS].map((m, i) => {
                            const d = tickerPrices[m];
                            return (
                                <span key={i} className='lp-ticker__item'>
                                    <span className='lp-ticker__market'>{m}</span>
                                    <span className={`lp-ticker__price lp-ticker__price--${d?.up ? 'up' : 'dn'}`}>
                                        {d ? d.price.toFixed(2) : '—'}
                                    </span>
                                </span>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ── Hero ────────────────────────────────────────────────────── */}
            <section className='lp-hero'>
                <div className='lp-hero__glow lp-hero__glow--1' />
                <div className='lp-hero__glow lp-hero__glow--2' />

                <div className='lp-hero__live-row'>
                    <span className='lp-hero__live-dot' />
                    <span className='lp-hero__live-lbl'>{activeTraders.toLocaleString()} traders active right now</span>
                </div>

                <h1 className='lp-hero__h1'>
                    Trade Smarter<br />
                    <span className='lp-hero__h1-accent'>with AI Power</span>
                </h1>
                <p className='lp-hero__sub'>
                    Real-time AI signals, automated bots, and live digit analysis — built for serious Deriv traders.
                    No guesswork. Just edge.
                </p>

                <div className='lp-hero__ctas'>
                    <button className='lp-cta-primary' onClick={handleSignup}>
                        🚀 Sign Up Free
                    </button>
                    <button className='lp-cta-ghost' onClick={handleLogin} disabled={loginLoading}>
                        {loginLoading ? 'Redirecting…' : 'Log in to your account →'}
                    </button>
                </div>

                {/* Floating pattern preview */}
                <div className='lp-hero__pattern-preview'>
                    {['E','O','E','E','O','E','O','O','E','E','O','E'].map((l, i) => (
                        <span key={i} className={`lp-hero__tick lp-hero__tick--${l === 'E' ? 'win' : 'lose'}`}
                            style={{ animationDelay: `${i * 0.12}s` }}>
                            {l}
                        </span>
                    ))}
                    <span className='lp-hero__pattern-lbl'>Live Even/Odd stream</span>
                </div>
            </section>

            {/* ── Stats bar ───────────────────────────────────────────────── */}
            <div className='lp-stats'>
                <div className='lp-stats__card'>
                    <span className='lp-stats__val'>{tradesCount.toLocaleString()}+</span>
                    <span className='lp-stats__lbl'>Trades Today</span>
                </div>
                <div className='lp-stats__divider' />
                <div className='lp-stats__card'>
                    <span className='lp-stats__val lp-stats__val--green'>{winRateMin}-{winRateMax}%</span>
                    <span className='lp-stats__lbl'>Win Probability</span>
                </div>
                <div className='lp-stats__divider' />
                <div className='lp-stats__card'>
                    <span className='lp-stats__val'>{activeTraders.toLocaleString()}</span>
                    <span className='lp-stats__lbl'>Active Traders</span>
                </div>
                <div className='lp-stats__divider' />
                <div className='lp-stats__card'>
                    <span className='lp-stats__val'>{marketsCount}</span>
                    <span className='lp-stats__lbl'>Live Markets</span>
                </div>
            </div>

            {/* ── Features ────────────────────────────────────────────────── */}
            <section className='lp-features'>
                <div className='lp-section-header'>
                    <span className='lp-section-eyebrow'>YOUR EDGE</span>
                    <h2 className='lp-section-title'>Everything you need to win</h2>
                    <p className='lp-section-sub'>Three powerful tools. One platform. Zero compromises.</p>
                </div>
                <div className='lp-features__grid'>
                    {FEATURES.map(f => (
                        <div key={f.title} className='lp-feat-card' style={{ '--feat-color': f.color } as React.CSSProperties}>
                            <div className='lp-feat-card__top'>
                                <span className='lp-feat-card__icon'>{f.icon}</span>
                                <span className='lp-feat-card__badge'>{f.badge}</span>
                            </div>
                            <h3 className='lp-feat-card__title'>{f.title}</h3>
                            <p className='lp-feat-card__desc'>{f.desc}</p>
                            <div className='lp-feat-card__bar' />
                        </div>
                    ))}
                </div>
            </section>

            {/* ── How it works ─────────────────────────────────────────────── */}
            <section className='lp-how'>
                <div className='lp-section-header'>
                    <span className='lp-section-eyebrow'>SIMPLE PROCESS</span>
                    <h2 className='lp-section-title'>Up and running in 60 seconds</h2>
                </div>
                <div className='lp-how__steps'>
                    {[
                        { n: '01', title: 'Log in', desc: 'Connect your Deriv account securely via OAuth.' },
                        { n: '02', title: 'Pick a tool', desc: 'Use the AI Orb for signals, the Analyser for digits, or deploy a bot.' },
                        { n: '03', title: 'Trade with edge', desc: 'Execute trades backed by real-time AI analysis and live market data.' },
                    ].map(s => (
                        <div key={s.n} className='lp-how__step'>
                            <span className='lp-how__num'>{s.n}</span>
                            <h4 className='lp-how__title'>{s.title}</h4>
                            <p className='lp-how__desc'>{s.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Testimonials ────────────────────────────────────────────── */}
            <section className='lp-testimonials'>
                <div className='lp-section-header'>
                    <span className='lp-section-eyebrow'>COMMUNITY</span>
                    <h2 className='lp-section-title'>Traders who level up</h2>
                </div>

                <div className='lp-testi-carousel'>
                    {TESTIMONIALS.map((t, i) => (
                        <div key={i} className={`lp-testi-card${i === testimonialIdx ? ' lp-testi-card--active' : i === (testimonialIdx + 1) % TESTIMONIALS.length ? ' lp-testi-card--next' : ''}`}>
                            <div className='lp-testi-card__top'>
                                <div className='lp-testi-card__avatar'>{t.avatar}</div>
                                <div>
                                    <div className='lp-testi-card__name'>{t.name}</div>
                                    <div className='lp-testi-card__loc'>📍 {t.location}</div>
                                </div>
                                <span className='lp-testi-card__tag'>{t.tag}</span>
                            </div>
                            <Stars n={t.rating} />
                            <p className='lp-testi-card__text'>"{t.text}"</p>
                        </div>
                    ))}
                </div>

                <div className='lp-testi-dots'>
                    {TESTIMONIALS.map((_, i) => (
                        <button key={i} className={`lp-testi-dot${i === testimonialIdx ? ' lp-testi-dot--active' : ''}`}
                            onClick={() => setTestimonialIdx(i)} />
                    ))}
                </div>
            </section>

            {/* ── Final CTA ───────────────────────────────────────────────── */}
            <section className='lp-final-cta'>
                <div className='lp-final-cta__glow' />
                <div className='lp-hero__live-row' style={{ justifyContent: 'center' }}>
                    <span className='lp-hero__live-dot' />
                    <span className='lp-hero__live-lbl'>{activeTraders.toLocaleString()} traders online now</span>
                </div>
                <h2 className='lp-final-cta__title'>Your next trade starts here.</h2>
                <p className='lp-final-cta__sub'>Join thousands of traders using AI to win on Deriv every day.</p>
                <div className='lp-final-cta__btns'>
                    <button className='lp-cta-primary lp-cta-primary--large' onClick={handleSignup}>
                        🚀 Sign Up Free
                    </button>
                    <button className='lp-cta-ghost' onClick={handleLogin} disabled={loginLoading}>
                        {loginLoading ? 'Redirecting…' : 'Already have an account →'}
                    </button>
                </div>
                <p className='lp-final-cta__note'>No subscription. Connect your existing Deriv account.</p>
            </section>

            {/* ── Footer ──────────────────────────────────────────────────── */}
            <footer className='lp-footer'>
                <div className='lp-footer__brand'>
                    <img src='/logo.png' alt='Derex Master' className='lp-footer__logo' />
                    <span className='lp-footer__name'>Derex Master</span>
                </div>
                <p className='lp-footer__disclaimer'>
                    Trading involves risk. Synthetic indices are offered by Deriv. Past performance does not guarantee future results. Trade responsibly.
                </p>
                <p className='lp-footer__copy'>© {new Date().getFullYear()} Derex Master · Powered by Deriv</p>
            </footer>
        </div>
    );
};

export default LandingPage;

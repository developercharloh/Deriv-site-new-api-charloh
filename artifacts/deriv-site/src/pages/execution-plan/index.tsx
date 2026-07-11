import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './execution-plan.scss';

// ── Helpers ───────────────────────────────────────────────────────────────────
const f = (v: number, d = 2) =>
    v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

interface DayRow {
    day:              number;
    open:             number;   // opening balance
    dailyTarget:      number;   // open × pct%
    perSession:       number;   // dailyTarget / sessions
    sessionStake:     number;   // perSession / 3
    close:            number;   // open + dailyTarget
    totalProfit:      number;   // close − initial capital
    growthPct:        number;   // (close / initialCapital − 1) × 100
}

const buildRows = (capital: number, pct: number, days: number, sessions: number): DayRow[] => {
    const rows: DayRow[] = [];
    let bal = capital;
    for (let d = 1; d <= days; d++) {
        const dailyTarget  = +(bal * pct / 100).toFixed(2);
        const perSession   = +(dailyTarget / sessions).toFixed(2);
        const sessionStake = +(perSession / 3).toFixed(2);
        const close        = +(bal + dailyTarget).toFixed(2);
        rows.push({
            day: d,
            open:  +bal.toFixed(2),
            dailyTarget, perSession, sessionStake, close,
            totalProfit: +(close - capital).toFixed(2),
            growthPct:   +((close / capital - 1) * 100).toFixed(2),
        });
        bal = close;
    }
    return rows;
};

interface SavedPlan {
    id: string; name: string; capital: number; pct: number;
    days: number; sessions: number; rows: DayRow[]; date: string;
}
const STORE = 'tc_plans_v2';

// ── Sparkline ─────────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ rows: DayRow[] }> = ({ rows }) => {
    if (rows.length < 2) return null;
    const vals  = rows.map(r => r.close);
    const min   = Math.min(...vals);
    const max   = Math.max(...vals);
    const range = max - min || 1;
    const W = 280, H = 52, pad = 4;
    const pts = vals.map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
        const y = H - pad - ((v - min) / range) * (H - pad * 2);
        return `${x},${y}`;
    }).join(' ');
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className='ep__spark' preserveAspectRatio='none'>
            <defs>
                <linearGradient id='spk-fill' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%'   stopColor='#f59e0b' stopOpacity='0.35' />
                    <stop offset='100%' stopColor='#f59e0b' stopOpacity='0.02' />
                </linearGradient>
            </defs>
            <polygon
                points={`${pad},${H} ${pts} ${W - pad},${H}`}
                fill='url(#spk-fill)'
            />
            <polyline points={pts} fill='none' stroke='#f59e0b' strokeWidth='2' strokeLinejoin='round' />
        </svg>
    );
};

// ── Component ─────────────────────────────────────────────────────────────────
const ExecutionPlan: React.FC = () => {

    /* ── Risk Calc state ──────────────────────────────────────────────────── */
    const [rCap,     setRCap]     = useState('');
    const [rResult,  setRResult]  = useState<{stake:number;target:number} | null>(null);

    /* ── Planner state ────────────────────────────────────────────────────── */
    const [pCap,      setPCap]      = useState('');
    const [pPct,      setPPct]      = useState('2');
    const [pDays,     setPDays]     = useState('10');
    const [pSess,     setPSess]     = useState('2');
    const [pName,     setPName]     = useState('');
    const [rows,      setRows]      = useState<DayRow[]>([]);
    const [generated, setGenerated] = useState(false);

    /* ── Saved plans ──────────────────────────────────────────────────────── */
    const [saved,       setSaved]       = useState<SavedPlan[]>([]);
    const [viewPlan,    setViewPlan]    = useState<SavedPlan | null>(null);
    const [saveFlash,   setSaveFlash]   = useState(false);

    useEffect(() => {
        try { const r = localStorage.getItem(STORE); if (r) setSaved(JSON.parse(r)); } catch { /**/ }
    }, []);

    const persist = useCallback((plans: SavedPlan[]) => {
        setSaved(plans);
        try { localStorage.setItem(STORE, JSON.stringify(plans)); } catch { /**/ }
    }, []);

    /* ── Handlers ─────────────────────────────────────────────────────────── */
    const calcRisk = () => {
        const c = parseFloat(rCap);
        if (!c || c <= 0) return;
        setRResult({ stake: +(c * 0.05).toFixed(2), target: +(c * 0.15).toFixed(2) });
    };

    const generate = () => {
        const c = parseFloat(pCap), p = parseFloat(pPct),
              d = parseInt(pDays), s = parseInt(pSess);
        if (!c || !p || !d || !s || c <= 0 || p <= 0) return;
        setRows(buildRows(c, p, d, s));
        setGenerated(true);
        setViewPlan(null);
    };

    const savePlan = () => {
        if (!generated || rows.length === 0) return;
        const c = parseFloat(pCap), p = parseFloat(pPct),
              d = parseInt(pDays), s = parseInt(pSess);
        const name = pName.trim() || `${d}-Day Challenge · $${f(c, 0)}`;
        const plan: SavedPlan = { id: Date.now().toString(), name, capital: c, pct: p, days: d, sessions: s, rows, date: new Date().toLocaleDateString() };
        persist([plan, ...saved]);
        setSaveFlash(true);
        setTimeout(() => setSaveFlash(false), 2000);
    };

    const deletePlan = (id: string) => {
        persist(saved.filter(p => p.id !== id));
        if (viewPlan?.id === id) setViewPlan(null);
    };

    /* ── Active display ───────────────────────────────────────────────────── */
    const activeRows = viewPlan ? viewPlan.rows : rows;
    const showTable  = (generated || !!viewPlan) && activeRows.length > 0;
    const meta = viewPlan
        ? { cap: viewPlan.capital, pct: viewPlan.pct, days: viewPlan.days, sess: viewPlan.sessions, name: viewPlan.name }
        : { cap: parseFloat(pCap)||0, pct: parseFloat(pPct)||2, days: parseInt(pDays)||10, sess: parseInt(pSess)||2, name: pName||`${pDays}-Day Challenge` };

    const last = activeRows[activeRows.length - 1];

    const roiPct = useMemo(() =>
        meta.cap > 0 && last ? ((last.totalProfit / meta.cap) * 100).toFixed(1) : '0.0',
    [meta.cap, last]);

    return (
        <div className='ep'>

            {/* ── Page header ─────────────────────────────────────────── */}
            <div className='ep__top'>
                <div className='ep__top-inner'>
                    <span className='ep__top-icon'>📋</span>
                    <div>
                        <h1 className='ep__top-title'>Execution Plan</h1>
                        <p  className='ep__top-sub'>Risk Management · Compounding Challenge · Trade Schedule</p>
                    </div>
                </div>
            </div>

            {/* ════════════════════════════════════════════════════════
                RISK CALCULATOR
            ════════════════════════════════════════════════════════ */}
            <div className='ep__card'>
                <div className='ep__card-hd ep__card-hd--gold'>
                    <span>⚖️</span>
                    <div>
                        <h2>Risk Calculator</h2>
                        <p>Get your safe stake &amp; session target from your capital</p>
                    </div>
                </div>
                <div className='ep__rc-body'>
                    <div className='ep__field-wrap'>
                        <label>Trading Capital (USD)</label>
                        <div className='ep__inp-row'>
                            <span className='ep__inp-prefix'>$</span>
                            <input
                                type='number' min='1' placeholder='e.g. 1000'
                                value={rCap}
                                onChange={e => setRCap(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && calcRisk()}
                            />
                        </div>
                    </div>
                    <button className='ep__btn ep__btn--gold' onClick={calcRisk}>
                        Calculate Risk
                    </button>
                </div>

                {rResult && (
                    <div className='ep__rc-results' key={rResult.stake}>
                        <div className='ep__rc-card ep__rc-card--stake'>
                            <div className='ep__rc-icon'>🎯</div>
                            <div className='ep__rc-val'>${f(rResult.stake)}</div>
                            <div className='ep__rc-lbl'>Recommended Stake</div>
                            <div className='ep__rc-hint'>10% ÷ 2 of capital</div>
                        </div>
                        <div className='ep__rc-card ep__rc-card--target'>
                            <div className='ep__rc-icon'>💰</div>
                            <div className='ep__rc-val'>${f(rResult.target)}</div>
                            <div className='ep__rc-lbl'>Session Target</div>
                            <div className='ep__rc-hint'>3× your stake</div>
                        </div>
                        <div className='ep__rc-card ep__rc-card--risk'>
                            <div className='ep__rc-icon'>🛡️</div>
                            <div className='ep__rc-val'>5%</div>
                            <div className='ep__rc-lbl'>Risk per Session</div>
                            <div className='ep__rc-hint'>of total capital</div>
                        </div>
                    </div>
                )}
            </div>

            {/* ════════════════════════════════════════════════════════
                CHALLENGE PLANNER
            ════════════════════════════════════════════════════════ */}
            <div className='ep__card'>
                <div className='ep__card-hd ep__card-hd--green'>
                    <span>📅</span>
                    <div>
                        <h2>Challenge Planner</h2>
                        <p>Set your capital, compound rate &amp; sessions — we build the plan</p>
                    </div>
                </div>

                <div className='ep__planner'>
                    <div className='ep__field-wrap'>
                        <label>Starting Capital (USD)</label>
                        <div className='ep__inp-row'>
                            <span className='ep__inp-prefix'>$</span>
                            <input type='number' min='1' placeholder='e.g. 500' value={pCap} onChange={e => setPCap(e.target.value)} />
                        </div>
                    </div>

                    <div className='ep__field-wrap'>
                        <label>Daily Compound %</label>
                        <div className='ep__inp-row'>
                            <input type='number' min='0.1' max='100' step='0.1' placeholder='2' value={pPct} onChange={e => setPPct(e.target.value)} />
                            <span className='ep__inp-suffix'>%</span>
                        </div>
                    </div>

                    <div className='ep__field-wrap'>
                        <label>Challenge Duration</label>
                        <select value={pDays} onChange={e => setPDays(e.target.value)}>
                            {[5,7,10,14,20,30,60,90].map(d => <option key={d} value={d}>{d}-Day Challenge</option>)}
                        </select>
                    </div>

                    <div className='ep__field-wrap'>
                        <label>Sessions Per Day</label>
                        <select value={pSess} onChange={e => setPSess(e.target.value)}>
                            {[1,2,3,4,5,6].map(s => <option key={s} value={s}>{s} session{s>1?'s':''}/day</option>)}
                        </select>
                    </div>

                    <div className='ep__field-wrap ep__field-wrap--full'>
                        <label>Plan Name <span>(optional)</span></label>
                        <input type='text' placeholder={`e.g. My ${pDays}-Day Challenge`} value={pName} onChange={e => setPName(e.target.value)} />
                    </div>
                </div>

                <div className='ep__planner-btns'>
                    <button className='ep__btn ep__btn--green' onClick={generate}>
                        ⚡ Generate Plan
                    </button>
                    {generated && <>
                        <button
                            className={`ep__btn ep__btn--save${saveFlash ? ' ep__btn--flash' : ''}`}
                            onClick={savePlan}
                        >
                            {saveFlash ? '✓ Saved!' : '💾 Save Plan'}
                        </button>
                        <button className='ep__btn ep__btn--outline' onClick={() => window.print()}>
                            📄 Export PDF
                        </button>
                    </>}
                </div>
            </div>

            {/* ════════════════════════════════════════════════════════
                PLAN TABLE
            ════════════════════════════════════════════════════════ */}
            {showTable && last && (
                <div className='ep__card ep__card--plan' id='ep-print-area'>

                    {/* Plan name + close button */}
                    <div className='ep__plan-namebar'>
                        <span className='ep__plan-namebar-txt'>{meta.name}</span>
                        {viewPlan && (
                            <button className='ep__icon-btn' onClick={() => setViewPlan(null)}>✕</button>
                        )}
                    </div>

                    {/* 4 meta chips */}
                    <div className='ep__chips'>
                        <span className='ep__chip'>💰 ${f(meta.cap, 0)} capital</span>
                        <span className='ep__chip'>📈 {meta.pct}% daily</span>
                        <span className='ep__chip'>📅 {meta.days} days</span>
                        <span className='ep__chip'>🔁 {meta.sess} sessions/day</span>
                    </div>

                    {/* Summary KPIs */}
                    <div className='ep__kpis'>
                        <div className='ep__kpi'>
                            <span>Final Balance</span>
                            <strong>${f(last.close)}</strong>
                        </div>
                        <div className='ep__kpi ep__kpi--profit'>
                            <span>Total Profit</span>
                            <strong>+${f(last.totalProfit)}</strong>
                        </div>
                        <div className='ep__kpi ep__kpi--roi'>
                            <span>ROI</span>
                            <strong>+{roiPct}%</strong>
                        </div>
                    </div>

                    {/* Sparkline growth chart */}
                    <div className='ep__spark-wrap'>
                        <span className='ep__spark-lbl'>Balance Growth Over {meta.days} Days</span>
                        <Sparkline rows={activeRows} />
                        <div className='ep__spark-axis'>
                            <span>${f(meta.cap, 0)}</span>
                            <span>${f(last.close, 0)}</span>
                        </div>
                    </div>

                    {/* Compounding note */}
                    <div className='ep__compound-note'>
                        <span className='ep__note-icon'>🔄</span>
                        <span>Each day's <strong>Opening Balance</strong> = previous day's <strong>Closing Balance</strong> — this is how compounding grows your account.</span>
                    </div>

                    {/* Table */}
                    <div className='ep__tbl-wrap'>
                        <table className='ep__tbl'>
                            <thead>
                                <tr>
                                    <th className='ep__th--day'>Day</th>
                                    <th>Opening<br/>Balance</th>
                                    <th>Daily Target<br/>({meta.pct}%)</th>
                                    <th>Per Session<br/>Target</th>
                                    <th>Session<br/>Stake</th>
                                    <th>Closing<br/>Balance ↗</th>
                                    <th>Total<br/>Profit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeRows.map((row, i) => (
                                    <tr key={row.day} className={i % 2 === 1 ? 'ep__tr--alt' : ''}>
                                        <td className='ep__td--day'>
                                            <span className='ep__day-badge'>D{row.day}</span>
                                        </td>
                                        <td className='ep__td--open'>
                                            ${f(row.open)}
                                            {i > 0 && (
                                                <span className='ep__carry'>↑ carried</span>
                                            )}
                                        </td>
                                        <td className='ep__td--dtarget'>+${f(row.dailyTarget)}</td>
                                        <td>${f(row.perSession)}</td>
                                        <td className='ep__td--stake'>${f(row.sessionStake)}</td>
                                        <td className='ep__td--close'>${f(row.close)}</td>
                                        <td className='ep__td--profit'>+${f(row.totalProfit)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ════════════════════════════════════════════════════════
                SAVED PLANS
            ════════════════════════════════════════════════════════ */}
            {saved.length > 0 && (
                <div className='ep__card'>
                    <div className='ep__card-hd ep__card-hd--purple'>
                        <span>📂</span>
                        <div>
                            <h2>Saved Plans</h2>
                            <p>{saved.length} plan{saved.length !== 1 ? 's' : ''} on this device</p>
                        </div>
                    </div>
                    <div className='ep__saved'>
                        {saved.map(plan => (
                            <div
                                key={plan.id}
                                className={`ep__saved-row${viewPlan?.id === plan.id ? ' ep__saved-row--on' : ''}`}
                            >
                                <div className='ep__saved-info'>
                                    <div className='ep__saved-name'>{plan.name}</div>
                                    <div className='ep__saved-meta'>
                                        ${f(plan.capital,0)} · {plan.days}d · {plan.pct}%/day · {plan.sessions} sessions · {plan.date}
                                    </div>
                                    <div className='ep__saved-roi'>
                                        Final ${f(plan.rows[plan.rows.length-1]?.close ?? 0)} &nbsp;·&nbsp; +${f(plan.rows[plan.rows.length-1]?.totalProfit ?? 0)} profit · +{plan.rows[plan.rows.length-1]?.growthPct ?? 0}% ROI
                                    </div>
                                </div>
                                <div className='ep__saved-btns'>
                                    <button
                                        className='ep__btn ep__btn--sm ep__btn--outline'
                                        onClick={() => setViewPlan(viewPlan?.id === plan.id ? null : plan)}
                                    >
                                        {viewPlan?.id === plan.id ? '▲ Hide' : '▼ View'}
                                    </button>
                                    <button
                                        className='ep__btn ep__btn--sm ep__btn--danger'
                                        onClick={() => deletePlan(plan.id)}
                                    >🗑</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

        </div>
    );
};

export default ExecutionPlan;

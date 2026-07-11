import React, { useState, useEffect, useCallback } from 'react';
import './execution-plan.scss';

// ── Types ──────────────────────────────────────────────────────────────────────
interface RiskResult {
    capital: number;
    stake:   number;
    target:  number;
}

interface DayRow {
    day:              number;
    openBalance:      number;
    dailyTarget:      number;
    sessionTarget:    number;
    sessionStake:     number;
    closeBalance:     number;
    cumulativeProfit: number;
}

interface SavedPlan {
    id:          string;
    name:        string;
    capital:     number;
    compoundPct: number;
    days:        number;
    sessions:    number;
    rows:        DayRow[];
    createdAt:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number, d = 2) =>
    v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const buildPlan = (capital: number, pct: number, days: number, sessions: number): DayRow[] => {
    const rows: DayRow[] = [];
    let bal = capital;
    for (let d = 1; d <= days; d++) {
        const dailyTarget    = +(bal * (pct / 100)).toFixed(2);
        const sessionTarget  = +(dailyTarget / sessions).toFixed(2);
        const sessionStake   = +(sessionTarget / 3).toFixed(2);   // target = 3× stake
        const closeBalance   = +(bal + dailyTarget).toFixed(2);
        rows.push({
            day: d,
            openBalance:      +bal.toFixed(2),
            dailyTarget,
            sessionTarget,
            sessionStake,
            closeBalance,
            cumulativeProfit: +(closeBalance - capital).toFixed(2),
        });
        bal = closeBalance;
    }
    return rows;
};

const STORAGE_KEY = 'tc_execution_plans';

// ── Component ─────────────────────────────────────────────────────────────────
const ExecutionPlan: React.FC = () => {

    // ── Risk calculator ─────────────────────────────────────────────────────
    const [riskCapital, setRiskCapital] = useState('');
    const [riskResult,  setRiskResult]  = useState<RiskResult | null>(null);

    // ── Challenge planner ───────────────────────────────────────────────────
    const [planCapital,  setPlanCapital]  = useState('');
    const [compoundPct,  setCompoundPct]  = useState('2');
    const [planDays,     setPlanDays]     = useState('10');
    const [planSessions, setPlanSessions] = useState('2');
    const [planName,     setPlanName]     = useState('');
    const [planRows,     setPlanRows]     = useState<DayRow[]>([]);
    const [planVisible,  setPlanVisible]  = useState(false);

    // ── Saved plans ─────────────────────────────────────────────────────────
    const [savedPlans,  setSavedPlans]  = useState<SavedPlan[]>([]);
    const [viewingPlan, setViewingPlan] = useState<SavedPlan | null>(null);
    const [saveMsg,     setSaveMsg]     = useState('');

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) setSavedPlans(JSON.parse(raw));
        } catch { /**/ }
    }, []);

    const persistPlans = useCallback((plans: SavedPlan[]) => {
        setSavedPlans(plans);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plans)); } catch { /**/ }
    }, []);

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleCalcRisk = () => {
        const capital = parseFloat(riskCapital);
        if (!capital || capital <= 0) return;
        setRiskResult({ capital, stake: +(capital * 0.05).toFixed(2), target: +(capital * 0.15).toFixed(2) });
    };

    const handleGenerate = () => {
        const capital  = parseFloat(planCapital);
        const pct      = parseFloat(compoundPct);
        const days     = parseInt(planDays,     10);
        const sessions = parseInt(planSessions, 10);
        if (!capital || capital <= 0 || !pct || pct <= 0 || !days || !sessions) return;
        setPlanRows(buildPlan(capital, pct, days, sessions));
        setPlanVisible(true);
        setViewingPlan(null);
    };

    const handleSave = () => {
        if (!planVisible || planRows.length === 0) return;
        const capital  = parseFloat(planCapital);
        const pct      = parseFloat(compoundPct);
        const days     = parseInt(planDays,     10);
        const sessions = parseInt(planSessions, 10);
        const name = planName.trim() || `${days}-Day Challenge — $${fmt(capital, 0)}`;
        const plan: SavedPlan = {
            id:          Date.now().toString(),
            name,
            capital,
            compoundPct: pct,
            days,
            sessions,
            rows:        planRows,
            createdAt:   new Date().toLocaleDateString(),
        };
        persistPlans([plan, ...savedPlans]);
        setSaveMsg('Plan saved ✓');
        setTimeout(() => setSaveMsg(''), 2500);
    };

    const handleDelete = (id: string) => {
        persistPlans(savedPlans.filter(p => p.id !== id));
        if (viewingPlan?.id === id) setViewingPlan(null);
    };

    const handlePrint = () => window.print();

    // ── Active display ────────────────────────────────────────────────────────
    const activeRows = viewingPlan ? viewingPlan.rows : planRows;
    const showTable  = (planVisible || !!viewingPlan) && activeRows.length > 0;

    const activeMeta = viewingPlan
        ? { capital: viewingPlan.capital, pct: viewingPlan.compoundPct, days: viewingPlan.days, sessions: viewingPlan.sessions, name: viewingPlan.name }
        : { capital: parseFloat(planCapital) || 0, pct: parseFloat(compoundPct) || 2, days: parseInt(planDays) || 10, sessions: parseInt(planSessions) || 2, name: planName || `${planDays}-Day Challenge` };

    const lastRow     = activeRows[activeRows.length - 1];
    const totalProfit = lastRow?.cumulativeProfit ?? 0;
    const roiPct      = activeMeta.capital > 0 ? ((totalProfit / activeMeta.capital) * 100).toFixed(1) : '0.0';

    return (
        <div className='ep'>

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className='ep__hd'>
                <div className='ep__hd-left'>
                    <span className='ep__hd-title'>EXECUTION <span className='ep__hd-accent'>PLAN</span></span>
                    <span className='ep__hd-sub'>Risk Calculator · Challenge Planner · Trading Schedule</span>
                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                SECTION 1 — Risk Calculator
            ══════════════════════════════════════════════════════════════ */}
            <section className='ep__section'>
                <div className='ep__section-hd'>
                    <span className='ep__s-icon'>⚖️</span>
                    <div>
                        <h2 className='ep__s-title'>Risk Calculator</h2>
                        <p  className='ep__s-sub'>Enter your capital to get a safe stake &amp; profit target</p>
                    </div>
                </div>

                <div className='ep__risk-row'>
                    <div className='ep__field'>
                        <label className='ep__label'>Trading Capital (USD)</label>
                        <input
                            className='ep__input'
                            type='number'
                            min='1'
                            placeholder='e.g. 1,000'
                            value={riskCapital}
                            onChange={e => setRiskCapital(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCalcRisk()}
                        />
                    </div>
                    <button className='ep__btn ep__btn--primary' onClick={handleCalcRisk}>
                        Calculate Risk
                    </button>
                </div>

                {riskResult && (
                    <div className='ep__risk-cards'>
                        <div className='ep__rcard ep__rcard--stake'>
                            <span className='ep__rcard-lbl'>Recommended Stake</span>
                            <span className='ep__rcard-val'>${fmt(riskResult.stake)}</span>
                            <span className='ep__rcard-hint'>10% of capital ÷ 2</span>
                        </div>
                        <div className='ep__rcard ep__rcard--target'>
                            <span className='ep__rcard-lbl'>Session Target</span>
                            <span className='ep__rcard-val'>${fmt(riskResult.target)}</span>
                            <span className='ep__rcard-hint'>3 × stake</span>
                        </div>
                        <div className='ep__rcard ep__rcard--exp'>
                            <span className='ep__rcard-lbl'>Risk Exposure</span>
                            <span className='ep__rcard-val'>5%</span>
                            <span className='ep__rcard-hint'>of total capital</span>
                        </div>
                    </div>
                )}

                {riskResult && (
                    <div className='ep__risk-formula'>
                        <span className='ep__formula-pill'>Capital</span>
                        <span className='ep__formula-op'>×10%÷2</span>
                        <span className='ep__formula-pill ep__formula-pill--out'>${fmt(riskResult.stake)} stake</span>
                        <span className='ep__formula-op'>×3</span>
                        <span className='ep__formula-pill ep__formula-pill--profit'>${fmt(riskResult.target)} target</span>
                    </div>
                )}
            </section>

            {/* ══════════════════════════════════════════════════════════════
                SECTION 2 — Challenge Planner
            ══════════════════════════════════════════════════════════════ */}
            <section className='ep__section'>
                <div className='ep__section-hd'>
                    <span className='ep__s-icon'>📅</span>
                    <div>
                        <h2 className='ep__s-title'>Challenge Planner</h2>
                        <p  className='ep__s-sub'>Build a compounding schedule with per-session stake &amp; targets</p>
                    </div>
                </div>

                <div className='ep__planner-grid'>
                    <div className='ep__field'>
                        <label className='ep__label'>Starting Capital (USD)</label>
                        <input
                            className='ep__input'
                            type='number' min='1'
                            placeholder='e.g. 500'
                            value={planCapital}
                            onChange={e => setPlanCapital(e.target.value)}
                        />
                    </div>
                    <div className='ep__field'>
                        <label className='ep__label'>Daily Compound %</label>
                        <input
                            className='ep__input'
                            type='number' min='0.1' max='100' step='0.1'
                            placeholder='2'
                            value={compoundPct}
                            onChange={e => setCompoundPct(e.target.value)}
                        />
                    </div>
                    <div className='ep__field'>
                        <label className='ep__label'>Challenge Duration</label>
                        <select className='ep__input ep__select' value={planDays} onChange={e => setPlanDays(e.target.value)}>
                            {[5,7,10,14,20,30,60,90].map(d =>
                                <option key={d} value={d}>{d}-Day Challenge</option>
                            )}
                        </select>
                    </div>
                    <div className='ep__field'>
                        <label className='ep__label'>Sessions Per Day</label>
                        <select className='ep__input ep__select' value={planSessions} onChange={e => setPlanSessions(e.target.value)}>
                            {[1,2,3,4,5,6].map(s =>
                                <option key={s} value={s}>{s} session{s > 1 ? 's' : ''}</option>
                            )}
                        </select>
                    </div>
                    <div className='ep__field ep__field--full'>
                        <label className='ep__label'>Plan Name <span className='ep__label-opt'>(optional)</span></label>
                        <input
                            className='ep__input'
                            type='text'
                            placeholder={`e.g. My ${planDays}-Day Challenge`}
                            value={planName}
                            onChange={e => setPlanName(e.target.value)}
                        />
                    </div>
                </div>

                <div className='ep__planner-actions'>
                    <button className='ep__btn ep__btn--primary' onClick={handleGenerate}>
                        ⚡ Generate Plan
                    </button>
                    {planVisible && (
                        <>
                            <button className='ep__btn ep__btn--save' onClick={handleSave}>
                                💾 Save Plan {saveMsg && <span className='ep__save-tick'>{saveMsg}</span>}
                            </button>
                            <button className='ep__btn ep__btn--pdf' onClick={handlePrint}>
                                📄 Export PDF
                            </button>
                        </>
                    )}
                </div>
            </section>

            {/* ══════════════════════════════════════════════════════════════
                SECTION 3 — Plan Table
            ══════════════════════════════════════════════════════════════ */}
            {showTable && (
                <section className='ep__section ep__section--table' id='ep-print-area'>

                    {/* Summary header */}
                    <div className='ep__plan-hd'>
                        <div className='ep__plan-title-row'>
                            <h3 className='ep__plan-name'>
                                {activeMeta.name || `${activeMeta.days}-Day Challenge`}
                            </h3>
                            {viewingPlan && (
                                <button className='ep__btn ep__btn--ghost' onClick={() => setViewingPlan(null)}>
                                    ✕ Close
                                </button>
                            )}
                        </div>
                        <div className='ep__plan-meta'>
                            <span>💰 Capital: <strong>${fmt(activeMeta.capital)}</strong></span>
                            <span>📈 Daily: <strong>{activeMeta.pct}%</strong></span>
                            <span>📅 <strong>{activeMeta.days} days</strong></span>
                            <span>🔁 <strong>{activeMeta.sessions} session{activeMeta.sessions > 1 ? 's' : ''}/day</strong></span>
                        </div>
                        <div className='ep__summary-row'>
                            <div className='ep__scard'>
                                <span>Final Balance</span>
                                <strong>${fmt(lastRow.closeBalance)}</strong>
                            </div>
                            <div className='ep__scard ep__scard--profit'>
                                <span>Total Profit</span>
                                <strong>+${fmt(totalProfit)}</strong>
                            </div>
                            <div className='ep__scard ep__scard--roi'>
                                <span>Return on Capital</span>
                                <strong>+{roiPct}%</strong>
                            </div>
                        </div>
                    </div>

                    {/* Table */}
                    <div className='ep__table-wrap'>
                        <table className='ep__table'>
                            <thead>
                                <tr>
                                    <th>Day</th>
                                    <th>Opening Balance</th>
                                    <th>Daily Target ({activeMeta.pct}%)</th>
                                    <th>Per Session Target</th>
                                    <th>Session Stake</th>
                                    <th>Closing Balance</th>
                                    <th>Cumulative Profit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeRows.map(row => (
                                    <tr key={row.day} className={row.day % 2 === 0 ? 'ep__tr--even' : ''}>
                                        <td className='ep__td--day'>Day {row.day}</td>
                                        <td>${fmt(row.openBalance)}</td>
                                        <td className='ep__td--target'>+${fmt(row.dailyTarget)}</td>
                                        <td>${fmt(row.sessionTarget)}</td>
                                        <td className='ep__td--stake'>${fmt(row.sessionStake)}</td>
                                        <td className='ep__td--close'>${fmt(row.closeBalance)}</td>
                                        <td className='ep__td--profit'>+${fmt(row.cumulativeProfit)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* ══════════════════════════════════════════════════════════════
                SECTION 4 — Saved Plans
            ══════════════════════════════════════════════════════════════ */}
            {savedPlans.length > 0 && (
                <section className='ep__section'>
                    <div className='ep__section-hd'>
                        <span className='ep__s-icon'>📂</span>
                        <div>
                            <h2 className='ep__s-title'>Saved Plans</h2>
                            <p  className='ep__s-sub'>{savedPlans.length} plan{savedPlans.length !== 1 ? 's' : ''} stored on this device</p>
                        </div>
                    </div>
                    <div className='ep__saved-list'>
                        {savedPlans.map(plan => (
                            <div
                                key={plan.id}
                                className={`ep__saved-item${viewingPlan?.id === plan.id ? ' ep__saved-item--active' : ''}`}
                            >
                                <div className='ep__saved-info'>
                                    <span className='ep__saved-name'>{plan.name}</span>
                                    <span className='ep__saved-meta'>
                                        ${fmt(plan.capital, 0)} · {plan.days} days · {plan.compoundPct}%/day · {plan.sessions} sessions/day · saved {plan.createdAt}
                                    </span>
                                    <span className='ep__saved-roi'>
                                        Final: ${fmt(plan.rows[plan.rows.length - 1]?.closeBalance ?? 0)} &nbsp;|&nbsp; +${fmt(plan.rows[plan.rows.length - 1]?.cumulativeProfit ?? 0)} profit
                                    </span>
                                </div>
                                <div className='ep__saved-acts'>
                                    <button
                                        className='ep__btn ep__btn--view'
                                        onClick={() => setViewingPlan(viewingPlan?.id === plan.id ? null : plan)}
                                    >
                                        {viewingPlan?.id === plan.id ? '▲ Hide' : '▼ View'}
                                    </button>
                                    <button className='ep__btn ep__btn--del' onClick={() => handleDelete(plan.id)}>🗑</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

        </div>
    );
};

export default ExecutionPlan;

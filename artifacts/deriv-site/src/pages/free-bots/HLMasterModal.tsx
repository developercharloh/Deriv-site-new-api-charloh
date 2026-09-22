// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    HLMasterEngine,
    type HLMasterConfig,
    type HLMasterLog,
    type HLMasterStats,
    type HLMasterStatus,
} from '@/utils/hl-master-engine';
import type { BotConfig } from './types';

interface Props {
    bot: BotConfig;
    onClose: () => void;
}

const symbols = [
    ['1HZ100V', 'Volatility 100 (1s)'],
    ['1HZ75V', 'Volatility 75 (1s)'],
    ['1HZ50V', 'Volatility 50 (1s)'],
    ['1HZ25V', 'Volatility 25 (1s)'],
    ['R_100', 'Volatility 100'],
    ['R_75', 'Volatility 75'],
];

const HLMasterModal: React.FC<Props> = ({ bot, onClose }) => {
    const [symbol, setSymbol] = useState('1HZ100V');
    const [stake, setStake] = useState('0.35');
    const [status, setStatus] = useState<HLMasterStatus>('idle');
    const [logs, setLogs] = useState<HLMasterLog[]>([]);
    const [stats, setStats] = useState<HLMasterStats>({
        profit: 0,
        wins: 0,
        losses: 0,
        pairs: 0,
        totalStake: 0,
    });
    const engineRef = useRef<HLMasterEngine | null>(null);
    const isRunning = status === 'scanning' || status === 'trading';
    const perContract = Math.max(0.35, Number(stake) || 0.35);

    useEffect(() => () => {
        engineRef.current?.stop(false);
    }, []);

    const handleStart = () => {
        const config: HLMasterConfig = {
            symbol,
            stake: perContract,
            duration: 1,
            currency: 'USD',
        };
        const engine = new HLMasterEngine(config);
        engine.onStatus = setStatus;
        engine.onLog = log => setLogs(previous => [...previous, log].slice(-300));
        engine.onStats = setStats;
        engineRef.current = engine;
        setLogs([]);
        setStats({ profit: 0, wins: 0, losses: 0, pairs: 0, totalStake: 0 });
        engine.start();
    };

    const handleStop = () => {
        engineRef.current?.stop();
        engineRef.current = null;
    };

    const statusLabel: Record<HLMasterStatus, string> = {
        idle: 'READY',
        scanning: 'SCANNING',
        trading: 'BUYING PAIRS',
        stopped: 'STOPPED',
        error: 'ERROR',
    };

    return (
        <div className='hl-master-overlay' onClick={isRunning ? undefined : onClose}>
            <div className='hl-master-modal' onClick={event => event.stopPropagation()}>
                <div className='hl-master-modal__header'>
                    <div>
                        <div className='hl-master-modal__title'>{bot.emoji} {bot.name}</div>
                        <div className='hl-master-modal__subtitle'>Paired Higher + Lower execution</div>
                    </div>
                    <button className='hl-master-modal__close' onClick={onClose} disabled={isRunning}>✕</button>
                </div>

                <div className='hl-master-modal__status'>
                    <span className={`hl-master-modal__dot hl-master-modal__dot--${status}`} />
                    <strong>{statusLabel[status]}</strong>
                    <span className='hl-master-modal__status-copy'>
                        {isRunning ? 'Live broker cycle active' : 'No contracts are being placed'}
                    </span>
                </div>

                {!api_base.is_authorized && (
                    <div className='hl-master-modal__warning'>
                        Log in to your Deriv account before starting. This runner does not place trades while logged out.
                    </div>
                )}

                <div className='hl-master-modal__pair-card'>
                    <div>
                        <span className='hl-master-modal__eyebrow'>EVERY TICK</span>
                        <strong>HIGHER + LOWER</strong>
                        <small>1-tick contracts, opened as one pair</small>
                    </div>
                    <div className='hl-master-modal__total'>
                        <span>Pair total</span>
                        <strong>${(perContract * 2).toFixed(2)}</strong>
                    </div>
                </div>

                <div className='hl-master-modal__fields'>
                    <label>
                        <span>Market</span>
                        <select value={symbol} onChange={event => setSymbol(event.target.value)} disabled={isRunning}>
                            {symbols.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </label>
                    <label>
                        <span>Stake per contract</span>
                        <input
                            type='number'
                            min='0.35'
                            step='0.01'
                            value={stake}
                            onChange={event => setStake(event.target.value)}
                            disabled={isRunning}
                        />
                    </label>
                </div>

                <div className='hl-master-modal__stats'>
                    <div><span>Pairs settled</span><strong>{stats.pairs}</strong></div>
                    <div><span>Wins</span><strong>{stats.wins}</strong></div>
                    <div><span>Losses</span><strong>{stats.losses}</strong></div>
                    <div><span>P&amp;L</span><strong className={stats.profit >= 0 ? 'is-positive' : 'is-negative'}>{stats.profit >= 0 ? '+' : ''}${stats.profit.toFixed(2)}</strong></div>
                </div>

                <div className='hl-master-modal__journal'>
                    <div className='hl-master-modal__journal-title'>Live execution journal</div>
                    {logs.length === 0 && <div className='hl-master-modal__empty'>Journal updates appear when the runner starts.</div>}
                    {logs.map(log => (
                        <div key={log.seq} className={`hl-master-modal__log hl-master-modal__log--${log.type}`}>
                            <time>{log.time}</time>
                            <span>{log.message}</span>
                        </div>
                    ))}
                </div>

                <div className='hl-master-modal__footer'>
                    <button className='hl-master-modal__cancel' onClick={onClose} disabled={isRunning}>Close</button>
                    {isRunning ? (
                        <button className='hl-master-modal__stop' onClick={handleStop}>Stop buying</button>
                    ) : (
                        <button className='hl-master-modal__start' onClick={handleStart} disabled={!api_base.is_authorized}>
                            ▶ Start HL master Bot
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default HLMasterModal;
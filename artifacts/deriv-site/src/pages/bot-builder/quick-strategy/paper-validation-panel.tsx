// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { useFormikContext } from 'formik';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { runAdaptiveMomentumPaperValidation } from '@/external/bot-skeleton/services/tradeEngine/trade/adaptiveMomentumValidation';
import { historyToTicks } from '@/external/bot-skeleton/utils/binary-utils';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { STRATEGIES } from '../config';
import { TFormValues } from '../types';

type ValidationStatus = 'idle' | 'loading' | 'empty' | 'failed' | 'success' | 'incomplete';

type ValidationResult = {
    disclaimer: string;
    metrics: {
        ticksProcessed: number;
        signalCounts: { CALL: number; PUT: number; WAIT: number };
        purchases: number;
        settledTrades: number;
        wins: number;
        losses: number;
        totalProfit: number;
        maxDrawdown: number;
        skippedByCooldown: number;
        skippedByOpenTrade: number;
        skippedByRiskLimit: number;
        riskStop: { reason: string; tickIndex: number; totalProfit: number } | null;
        openTrades: number;
    };
};

type PaperValidationPanelProps = {
    onValidationChange?: (isComplete: boolean) => void;
};

const PAPER_TICK_COUNT = 1000;

const formatNumber = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : '—');

const getReplayConfig = (values: TFormValues) => ({
    warmup: Number(values.warmup_window) || 30,
    shortWindow: Number(values.short_window) || 8,
    longWindow: Number(values.long_window) || 20,
    confidence: Number(values.confidence) || 60,
    cooldownTicks: Number(values.cooldown_ticks) || 0,
    takeProfit: Number(values.profit) || 10,
    stopLoss: Number(values.loss) || 10,
});

const PaperValidationPanel = ({ onValidationChange }: PaperValidationPanelProps) => {
    const { values } = useFormikContext<TFormValues>();
    const { quick_strategy } = useStore();
    const selected_strategy = quick_strategy.selected_strategy as keyof ReturnType<typeof STRATEGIES>;
    const supports_paper_validation = STRATEGIES()[selected_strategy]?.paper_validation;
    const [status, setStatus] = React.useState<ValidationStatus>('idle');
    const [result, setResult] = React.useState<ValidationResult | null>(null);
    const [error, setError] = React.useState('');
    const validation_key = [
        quick_strategy.selected_strategy,
        values.symbol,
        values.warmup_window,
        values.short_window,
        values.long_window,
        values.confidence,
        values.cooldown_ticks,
        values.profit,
        values.loss,
    ].join('|');
    const validation_key_ref = React.useRef(validation_key);
    validation_key_ref.current = validation_key;

    React.useEffect(() => {
        setStatus('idle');
        setResult(null);
        setError('');
        onValidationChange?.(false);
    }, [
        quick_strategy.selected_strategy,
        values.symbol,
        values.warmup_window,
        values.short_window,
        values.long_window,
        values.confidence,
        values.cooldown_ticks,
        values.profit,
        values.loss,
        onValidationChange,
    ]);

    if (!supports_paper_validation) return null;

    const runValidation = async () => {
        setStatus('loading');
        setResult(null);
        setError('');
        onValidationChange?.(false);
        const request_validation_key = validation_key;

        try {
            if (!api_base.api || !values.symbol) {
                setStatus('empty');
                return;
            }

            const response = await api_base.api.send({
                ticks_history: values.symbol === 'na' ? 'R_100' : values.symbol,
                end: 'latest',
                count: PAPER_TICK_COUNT,
                style: 'ticks',
                subscribe: 0,
            });
            if (request_validation_key !== validation_key_ref.current) return;
            if (response?.error) {
                throw new Error(response.error.message || localize('The market history request failed.'));
            }
            const ticks = response?.history ? historyToTicks(response.history) : [];

            if (!ticks.length) {
                setStatus('empty');
                return;
            }

            const validation = runAdaptiveMomentumPaperValidation({
                ticks,
                config: getReplayConfig(values),
            });
            if (request_validation_key !== validation_key_ref.current) return;
            setResult(validation);
            const is_incomplete =
                validation.metrics.openTrades > 0 || validation.metrics.settledTrades < validation.metrics.purchases;
            const validation_status = is_incomplete ? 'incomplete' : 'success';
            setStatus(validation_status);
            onValidationChange?.(validation_status === 'success');
        } catch (validationError) {
            if (request_validation_key !== validation_key_ref.current) return;
            setError(validationError instanceof Error ? validationError.message : localize('The replay failed.'));
            setStatus('failed');
            onValidationChange?.(false);
        }
    };

    const metrics = result?.metrics;
    const statusMessage = {
        idle: localize('Complete a successful paper replay before running Adaptive Momentum live.'),
        empty: localize('No replayable tick history was returned for this asset.'),
        failed: error || localize('The paper replay could not be completed.'),
        incomplete: localize(
            'The replay ended with an unsettled paper trade. Review the sample, but do not treat it as complete evidence.'
        ),
    }[status];

    return (
        <section className='qs__paper-validation' aria-labelledby='qs-paper-validation-title'>
            <div className='qs__paper-validation__header'>
                <div>
                    <Text weight='bold' id='qs-paper-validation-title'>
                        {localize('Paper validation')}
                    </Text>
                    <Text size='xs'>
                        {localize('Replay recent ticks before deciding whether to run this strategy live.')}
                    </Text>
                </div>
                <Button
                    secondary
                    type='button'
                    data-testid='qs-paper-validation-button'
                    onClick={runValidation}
                    disabled={status === 'loading' || quick_strategy.is_options_loading}
                >
                    {status === 'loading' ? localize('Validating...') : localize('Validate on paper')}
                </Button>
            </div>

            {statusMessage && (
                <div
                    className={`qs__paper-validation__state qs__paper-validation__state--${status}`}
                    role={status === 'failed' ? 'alert' : 'status'}
                >
                    <Text size='xs'>{statusMessage}</Text>
                </div>
            )}

            {metrics && (
                <div className='qs__paper-validation__result' data-testid='qs-paper-validation-result'>
                    <div className='qs__paper-validation__result-heading'>
                        <Text weight='bold'>
                            {status === 'incomplete'
                                ? localize('Incomplete replay')
                                : localize('Paper replay results')}
                        </Text>
                        <Text size='xs'>
                            {localize('{{ ticks }} ticks processed', { ticks: metrics.ticksProcessed })}
                        </Text>
                    </div>
                    <dl className='qs__paper-validation__metrics'>
                        <div>
                            <dt>{localize('Signals')}</dt>
                            <dd>
                                {localize('CALL {{ call }}, PUT {{ put }}, WAIT {{ wait }}', {
                                    call: metrics.signalCounts.CALL,
                                    put: metrics.signalCounts.PUT,
                                    wait: metrics.signalCounts.WAIT,
                                })}
                            </dd>
                        </div>
                        <div>
                            <dt>{localize('Purchases')}</dt>
                            <dd>{metrics.purchases}</dd>
                        </div>
                        <div>
                            <dt>{localize('Settlements')}</dt>
                            <dd>
                                {metrics.settledTrades} ({metrics.wins} {localize('wins')}, {metrics.losses}{' '}
                                {localize('losses')})
                            </dd>
                        </div>
                        <div>
                            <dt>{localize('Cooldown skips')}</dt>
                            <dd>{metrics.skippedByCooldown}</dd>
                        </div>
                        <div>
                            <dt>{localize('Open-trade skips')}</dt>
                            <dd>{metrics.skippedByOpenTrade}</dd>
                        </div>
                        <div>
                            <dt>{localize('Risk-limit skips')}</dt>
                            <dd>{metrics.skippedByRiskLimit}</dd>
                        </div>
                        <div>
                            <dt>{localize('Drawdown')}</dt>
                            <dd>{formatNumber(metrics.maxDrawdown)}</dd>
                        </div>
                        <div>
                            <dt>{localize('Total paper profit')}</dt>
                            <dd>{formatNumber(metrics.totalProfit)}</dd>
                        </div>
                        <div>
                            <dt>{localize('Risk-stop reason')}</dt>
                            <dd>{metrics.riskStop?.reason || localize('None')}</dd>
                        </div>
                        <div>
                            <dt>{localize('Open paper trades')}</dt>
                            <dd>{metrics.openTrades}</dd>
                        </div>
                    </dl>
                    <Text size='xs' className='qs__paper-validation__disclaimer'>
                        {result.disclaimer}
                    </Text>
                </div>
            )}
        </section>
    );
};

export default PaperValidationPanel;
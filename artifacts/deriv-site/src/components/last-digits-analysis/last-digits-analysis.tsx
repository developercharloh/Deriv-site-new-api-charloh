import type { TLastDigitsAnalysis } from '@/stores/run-panel-store';
import './last-digits-analysis.scss';

type TLastDigitsAnalysisProps = {
    analysis: TLastDigitsAnalysis;
};

const conditionLabel = ({ condition, compareValue }: TLastDigitsAnalysis) => {
    switch (condition) {
        case 'ALL_EVEN':
            return 'all even';
        case 'ALL_ODD':
            return 'all odd';
        case 'LESS_OR_EQUAL':
            return `less than or equal to ${compareValue}`;
        case 'GREATER_OR_EQUAL':
            return `greater than or equal to ${compareValue}`;
        default:
            return condition;
    }
};

const LastDigitsAnalysis = ({ analysis }: TLastDigitsAnalysisProps) => (
    <div
        className={`last-digits-analysis ${
            analysis.result ? 'last-digits-analysis--true' : 'last-digits-analysis--false'
        }`}
        role='status'
        aria-live='polite'
    >
        <span>
            Last Digits Analysis Market: {analysis.market || 'N/A'} Condition: {conditionLabel(analysis)} Digits:{' '}
            [{analysis.digits.join(', ')}] Result:{' '}
        </span>
        <span className='last-digits-analysis__result' aria-label={analysis.result ? 'true' : 'false'}>
            {analysis.result ? '✅ TRUE' : '❌ FALSE'}
        </span>
        {analysis.purchaseMapping && (
            <span className='last-digits-analysis__mapping'> · Trading: {analysis.purchaseMapping}</span>
        )}
    </div>
);

export default LastDigitsAnalysis;
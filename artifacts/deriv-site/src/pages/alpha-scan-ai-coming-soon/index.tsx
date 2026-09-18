import React from 'react';
import { Localize } from '@deriv-com/translations';
import { LabelPairedChartLineCaptionRegularIcon } from '@deriv/quill-icons/LabelPaired';

const AlphaScanComingSoon: React.FC = () => (
    <section className='ai-analysis-coming-soon' aria-labelledby='alpha-scan-coming-soon-title'>
        <div className='ai-analysis-coming-soon__inner'>
            <div className='ai-analysis-coming-soon__icon' aria-hidden='true'>
                <LabelPairedChartLineCaptionRegularIcon height='52px' width='52px' fill='#f97316' />
            </div>
            <span className='ai-analysis-coming-soon__badge'>
                <Localize i18n_default_text='Coming Soon' />
            </span>
            <h2 className='ai-analysis-coming-soon__title' id='alpha-scan-coming-soon-title'>
                <Localize i18n_default_text='Nexus AI' />
            </h2>
            <p className='ai-analysis-coming-soon__sub'>
                <Localize i18n_default_text='Full overview coming soon.' />
            </p>
            <p className='ai-analysis-coming-soon__hint'>
                <Localize i18n_default_text='The complete Nexus AI market overview is being prepared. Check back soon.' />
            </p>
        </div>
    </section>
);

export default AlphaScanComingSoon;
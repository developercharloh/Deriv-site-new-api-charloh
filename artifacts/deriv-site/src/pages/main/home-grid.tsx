import React from 'react';
import { Localize } from '@deriv-com/translations';
import {
    LabelPairedChartLineCaptionRegularIcon,
    LabelPairedObjectsColumnCaptionRegularIcon,
    LabelPairedPuzzlePieceTwoCaptionBoldIcon,
} from '@deriv/quill-icons/LabelPaired';
import { DBOT_TABS } from '@/constants/bot-contents';
import './home-grid.scss';

type THomeTile = {
    tab_index: number;
    label: React.ReactNode;
    icon: React.ReactNode;
};

const HomeGrid = ({ onSelect }: { onSelect: (tab_index: number) => void }) => {
    const tiles: THomeTile[] = [
        {
            tab_index: DBOT_TABS.DASHBOARD,
            label: <Localize i18n_default_text='Dashboard' />,
            icon: <LabelPairedObjectsColumnCaptionRegularIcon height='30px' width='30px' fill='#fff' />,
        },
        {
            tab_index: DBOT_TABS.CHART,
            label: <Localize i18n_default_text='Charts' />,
            icon: <LabelPairedChartLineCaptionRegularIcon height='30px' width='30px' fill='#fff' />,
        },
        {
            tab_index: DBOT_TABS.BOT_BUILDER,
            label: <Localize i18n_default_text='Bot Builder' />,
            icon: <LabelPairedPuzzlePieceTwoCaptionBoldIcon height='30px' width='30px' fill='#fff' />,
        },
        {
            tab_index: DBOT_TABS.FREE_BOTS,
            label: <Localize i18n_default_text='Free Bots' />,
            icon: <LabelPairedPuzzlePieceTwoCaptionBoldIcon height='30px' width='30px' fill='#fff' />,
        },
        {
            tab_index: DBOT_TABS.AI_ANALYSIS,
            label: <Localize i18n_default_text='AI Analysis Tool' />,
            icon: <span className='home-grid__emoji'>🧠</span>,
        },
        {
            tab_index: DBOT_TABS.D_CIRCLES,
            label: <Localize i18n_default_text='D-Circles' />,
            icon: <span className='home-grid__emoji'>🔵</span>,
        },
        {
            tab_index: DBOT_TABS.ADVANCED_DTRADER,
            label: <Localize i18n_default_text='Advanced D-Trader' />,
            icon: <span className='home-grid__emoji'>⚡</span>,
        },
    ];

    return (
        <div className='home-grid'>
            <div className='home-grid__header'>
                <Localize i18n_default_text='Where would you like to go?' />
            </div>
            <div className='home-grid__grid'>
                {tiles.map(tile => (
                    <button
                        key={tile.tab_index}
                        type='button'
                        className='home-grid__tile'
                        onClick={() => onSelect(tile.tab_index)}
                    >
                        <span className='home-grid__icon'>{tile.icon}</span>
                        <span className='home-grid__label'>{tile.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default HomeGrid;

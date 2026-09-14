// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { LabelPairedChevronDownMdFillIcon } from '@deriv/quill-icons/LabelPaired';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */
import SearchBox from './search-box';
import { ToolboxItems } from './toolbox-items';

const Toolbox = observer(() => {
    const { isDesktop } = useDevice();
    const { toolbox, flyout } = useStore();
    const {
        hasSubCategory,
        is_search_loading,
        onMount,
        onSearchBlur,
        onSearchClear,
        onSearchKeyUp,
        onToolboxItemClick,
        onToolboxItemExpand,
        onUnmount,
        categoryMatchesSearch,
        search_term,
        sub_category_index,
        toolbox_dom,
    } = toolbox;

    const { setVisibility, selected_category } = flyout;

    const toolbox_ref = React.useRef(ToolboxItems());
    const [is_open, setOpen] = React.useState(isDesktop);
    const [pending_selection] = React.useState<string | null>(null);

    React.useEffect(() => {
        onMount(toolbox_ref);
        return () => onUnmount();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
        setOpen(isDesktop);
    }, [isDesktop]);

    const toggleToolbox = () => {
        setOpen(!is_open);
        setVisibility(false);
    };

    const renderHeader = (is_mobile = false) => (
        <button
            type='button'
            className={classNames('db-toolbox__title', { 'db-toolbox__title--mobile': is_mobile })}
            data-testid={is_mobile ? 'button-open-blocks-menu' : 'db-toolbox__title'}
            aria-expanded={is_open}
            onClick={toggleToolbox}
        >
            {localize('Blocks menu')}
            <span
                className={classNames('db-toolbox__title__chevron', {
                    'db-toolbox__title__chevron--active': is_open,
                })}
            >
                <LabelPairedChevronDownMdFillIcon fill='var(--text-general)' />
            </span>
        </button>
    );

    const renderCategories = () => (
        <div className='db-toolbox__category-menu'>
            {toolbox_dom &&
                Array.from(toolbox_dom.childNodes as HTMLElement[]).map((category, index) => {
                    if (
                        category.tagName.toUpperCase() === 'CATEGORY' &&
                        (!search_term || categoryMatchesSearch?.(category))
                    ) {
                        const has_sub_category = hasSubCategory(category.children);
                        const is_sub_category_open = sub_category_index.includes(index);
                        return (
                            <div
                                key={`db-toolbox__row--${category.getAttribute('id')}`}
                                className={classNames('db-toolbox__row', {
                                    'db-toolbox__row--active':
                                        selected_category?.getAttribute('id') === category?.id,
                                    'db-toolbox__row--pending':
                                        pending_selection === category?.getAttribute('id'),
                                })}
                            >
                                <div
                                    className='db-toolbox__item'
                                    onClick={() => {
                                        has_sub_category
                                            ? onToolboxItemExpand(index)
                                            : onToolboxItemClick(category);
                                    }}
                                >
                                    <div className='db-toolbox__category-text'>
                                        <div className='db-toolbox__label'>
                                            {localize(category.getAttribute('name') as string)}
                                        </div>
                                        {has_sub_category && (
                                            <div
                                                className={classNames('db-toolbox__category-arrow', {
                                                    'db-toolbox__category-arrow--active': is_sub_category_open,
                                                })}
                                            >
                                                <LabelPairedChevronDownMdFillIcon fill='var(--text-general)' />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {has_sub_category &&
                                    is_sub_category_open &&
                                    (Array.from(category.childNodes) as HTMLElement[]).map(subCategory => (
                                        <div
                                            key={`db-toolbox__sub-category-row--${subCategory.getAttribute('id')}`}
                                            className={classNames('db-toolbox__sub-category-row', {
                                                'db-toolbox__sub-category-row--active':
                                                    selected_category?.getAttribute('id') === subCategory?.id,
                                                'db-toolbox__sub-category-row--pending':
                                                    pending_selection === subCategory?.getAttribute('id'),
                                            })}
                                            onClick={() => onToolboxItemClick(subCategory)}
                                        >
                                            <Text size='xxs'>{subCategory.getAttribute('name') as string}</Text>
                                        </div>
                                    ))}
                            </div>
                        );
                    }
                    return null;
                })}
        </div>
    );

    const renderMenu = (mobile = false) => (
        <div id={mobile ? 'gtm-toolbox-mobile' : 'gtm-toolbox'} className='db-toolbox__content'>
            <div className='db-toolbox__header'>{renderHeader(mobile)}</div>
            <div
                className={classNames('db-toolbox__content-wrapper', { active: is_open })}
                data-testid='db-toolbox__content-wrapper'
            >
                <SearchBox
                    is_search_loading={is_search_loading}
                    onSearch={toolbox.onSearch}
                    onSearchBlur={onSearchBlur}
                    onSearchClear={onSearchClear}
                    onSearchKeyUp={onSearchKeyUp}
                />
                {renderCategories()}
            </div>
        </div>
    );

    if (isDesktop) {
        return (
            <div className='db-toolbox' data-testid='dashboard__toolbox'>
                {renderMenu()}
            </div>
        );
    }

    return (
        <div className={classNames('db-toolbox db-toolbox--mobile', { 'db-toolbox--mobile-open': is_open })}>
            {!is_open && renderHeader(true)}
            {is_open && <div className='db-toolbox__mobile-panel'>{renderMenu(true)}</div>}
        </div>
    );
});

export default Toolbox;

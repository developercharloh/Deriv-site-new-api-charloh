import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { Loader } from '@deriv-com/ui';

const BlocklyLoading = observer(() => {
    const { blockly_store } = useStore();
    const { initialization_error, is_loading } = blockly_store;

    return (
        <>
            {is_loading && (
                <div className='bot__loading' data-testid='blockly-loader'>
                    <Loader />
                    <div>Loading Blockly...</div>
                </div>
            )}
            {initialization_error && (
                <div className='bot__loading bot__loading--error' data-testid='blockly-error' role='alert'>
                    <div className='bot__loading-title'>Blockly did not load</div>
                    <div className='bot__loading-message'>{initialization_error}</div>
                    <button type='button' onClick={() => window.location.reload()}>
                        Reload workspace
                    </button>
                </div>
            )}
        </>
    );
});

export default BlocklyLoading;

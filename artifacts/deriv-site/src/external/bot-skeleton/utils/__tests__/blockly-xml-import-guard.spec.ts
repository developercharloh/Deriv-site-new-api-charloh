import {
    acquireBlocklyXmlImportGuard,
    BLOCKLY_XML_IMPORT_SETTLE_MS,
} from '@/external/bot-skeleton/utils/blockly-xml-import-guard';

describe('Blockly XML import guard', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        delete (window as any).__DBOT_XML_IMPORT_GUARD_STATE;
        delete (window as any).__DBOT_LOADING_XML;
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('keeps the workspace guarded when the builder and a Free Bot load overlap', () => {
        const initialBuilderLoad = acquireBlocklyXmlImportGuard();
        initialBuilderLoad.releaseAfter(1000);

        const freeBotLoad = acquireBlocklyXmlImportGuard();
        freeBotLoad.releaseAfter(BLOCKLY_XML_IMPORT_SETTLE_MS);

        expect((window as any).__DBOT_LOADING_XML).toBe(true);

        jest.advanceTimersByTime(1000);
        expect((window as any).__DBOT_LOADING_XML).toBe(true);

        jest.advanceTimersByTime(BLOCKLY_XML_IMPORT_SETTLE_MS - 1000);
        expect((window as any).__DBOT_LOADING_XML).toBe(false);
    });

    it('releases each import only once', () => {
        const first = acquireBlocklyXmlImportGuard();
        const second = acquireBlocklyXmlImportGuard();

        first.release();
        first.release();
        expect((window as any).__DBOT_LOADING_XML).toBe(true);

        second.release();
        expect((window as any).__DBOT_LOADING_XML).toBe(false);
    });
});

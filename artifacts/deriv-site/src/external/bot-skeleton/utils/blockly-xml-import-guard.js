export const BLOCKLY_XML_IMPORT_SETTLE_MS = 6000;

const getGuardState = () => {
    const target = window;
    const existing = target.__DBOT_XML_IMPORT_GUARD_STATE;
    if (existing?.activeImports instanceof Set) return existing;

    const state = { activeImports: new Set() };
    target.__DBOT_XML_IMPORT_GUARD_STATE = state;
    return state;
};

export const acquireBlocklyXmlImportGuard = () => {
    const state = getGuardState();
    const token = Symbol('blockly-xml-import');
    state.activeImports.add(token);
    window.__DBOT_LOADING_XML = true;

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        state.activeImports.delete(token);
        window.__DBOT_LOADING_XML = state.activeImports.size > 0;
    };

    return {
        release,
        releaseAfter: (delay = BLOCKLY_XML_IMPORT_SETTLE_MS) => window.setTimeout(release, delay),
    };
};

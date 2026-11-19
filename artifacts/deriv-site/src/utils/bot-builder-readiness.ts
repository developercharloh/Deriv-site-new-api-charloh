const BOT_BUILDER_PANEL_SELECTOR = '#id-bot-builder.dc-tabs__content-panel';

/**
 * Wait for the active Bot Builder tab to render before starting a signal bot.
 * A pair of animation frames gives the tab a chance to mount and paint without
 * imposing the fixed 500 ms delay used by the old launch handoff.
 */
export const waitForBotBuilderReady = (maxFrames = 120): Promise<void> =>
    new Promise((resolve, reject) => {
        let frames = 0;

        const check = () => {
            const panel = document.querySelector(BOT_BUILDER_PANEL_SELECTOR);
            if (panel?.isConnected) {
                window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
                return;
            }

            frames += 1;
            if (frames >= maxFrames) {
                reject(new Error('Bot Builder did not finish opening. Please try again.'));
                return;
            }

            window.requestAnimationFrame(check);
        };

        window.requestAnimationFrame(check);
    });

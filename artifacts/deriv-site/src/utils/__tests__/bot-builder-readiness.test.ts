import { waitForBotBuilderReady } from '../bot-builder-readiness';

describe('waitForBotBuilderReady', () => {
    let frames: FrameRequestCallback[];
    let requestAnimationFrameSpy: jest.SpyInstance;

    const flushFrame = (time = 0) => {
        const queuedFrames = frames;
        frames = [];
        queuedFrames.forEach(callback => callback(time));
    };

    beforeEach(() => {
        frames = [];
        document.body.innerHTML = '';
        requestAnimationFrameSpy = jest
            .spyOn(window, 'requestAnimationFrame')
            .mockImplementation(callback => {
                frames.push(callback);
                return frames.length;
            });
    });

    afterEach(() => {
        requestAnimationFrameSpy.mockRestore();
    });

    it('starts waiting for paint as soon as the active Builder panel exists', async () => {
        const ready = waitForBotBuilderReady();

        flushFrame();
        const panel = document.createElement('div');
        panel.id = 'id-bot-builder';
        panel.className = 'dc-tabs__content-panel';
        document.body.appendChild(panel);

        flushFrame();
        flushFrame();
        flushFrame();

        await expect(ready).resolves.toBeUndefined();
    });

    it('fails clearly when the Builder panel never mounts', async () => {
        const ready = waitForBotBuilderReady(2);

        flushFrame();
        flushFrame();

        await expect(ready).rejects.toThrow('Bot Builder did not finish opening.');
    });
});

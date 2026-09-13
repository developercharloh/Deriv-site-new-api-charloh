export const FAST_EXECUTION_INTERVAL_MS = 1800;

export class FastExecutionClock {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private nextSlotAt = 0;
    private running = false;

    constructor(
        private readonly onSlot: () => void,
        private readonly now: () => number = () => Date.now(),
    ) {}

    start(): void {
        this.stop();
        this.running = true;
        this.nextSlotAt = this.now();

        const releaseSlot = () => {
            if (!this.running) return;

            this.onSlot();
            this.nextSlotAt += FAST_EXECUTION_INTERVAL_MS;
            const delay = Math.max(0, this.nextSlotAt - this.now());
            this.timer = setTimeout(releaseSlot, delay);
        };

        // The first slot is immediate. Subsequent slots remain aligned to the
        // Two-second wall-clock schedule rather than drifting after network work.
        releaseSlot();
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    isRunning(): boolean {
        return this.running;
    }
}
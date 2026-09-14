export const FAST_EXECUTION_INTERVAL_MS = 800;
export const FAST_SETTLEMENT_REST_MS = 400;

export class FastExecutionClock {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private nextSlotAt = 0;
    private running = false;
    private releaseSlot: (() => void) | null = null;

    constructor(
        private readonly onSlot: () => void,
        private readonly now: () => number = () => Date.now(),
    ) {}

    start(): void {
        this.stop();
        this.running = true;
        this.nextSlotAt = this.now();

        this.releaseSlot = () => {
            if (!this.running) return;

            this.onSlot();
            this.nextSlotAt += FAST_EXECUTION_INTERVAL_MS;
            this.scheduleNextSlot(Math.max(0, this.nextSlotAt - this.now()));
        };

        // The first slot is immediate. Subsequent slots remain aligned to the
        // 800 ms wall-clock schedule rather than drifting after network
        // work, unless settlement explicitly resets the next slot.
        this.releaseSlot();
    }

    scheduleAfterSettlement(): void {
        if (!this.running || !this.releaseSlot) return;

        this.nextSlotAt = this.now() + FAST_SETTLEMENT_REST_MS;
        this.scheduleNextSlot(FAST_SETTLEMENT_REST_MS);
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.releaseSlot = null;
    }

    isRunning(): boolean {
        return this.running;
    }

    private scheduleNextSlot(delay: number): void {
        if (!this.running || !this.releaseSlot) return;

        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(this.releaseSlot, delay);
    }
}
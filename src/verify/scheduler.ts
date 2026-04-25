interface VerifySchedulerOptions {
  intervalMs: number;
  staggerMs: number;
  onVerify: (lockId: string) => void | Promise<void>;
}

export interface ScheduleOptions {
  skipInitial?: boolean;
}

export class VerifyScheduler {
  private timeouts: NodeJS.Timeout[] = [];
  private intervals: NodeJS.Timeout[] = [];
  constructor(private readonly opts: VerifySchedulerOptions) {}

  schedule(lockIds: readonly string[], options?: ScheduleOptions): void {
    this.stop();
    const skipInitial = options?.skipInitial ?? false;
    const step = lockIds.length > 1 ? this.opts.staggerMs / Math.max(lockIds.length - 1, 1) : 0;
    lockIds.forEach((id, idx) => {
      const initialDelay = skipInitial
        ? this.opts.intervalMs + idx * step
        : idx * step;
      const initial = setTimeout(() => {
        this.run(id);
        const interval = setInterval(() => {
          void this.run(id);
        }, this.opts.intervalMs);
        this.intervals.push(interval);
      }, initialDelay);
      this.timeouts.push(initial);
    });
  }

  stop(): void {
    for (const t of this.timeouts) clearTimeout(t);
    for (const i of this.intervals) clearInterval(i);
    this.timeouts = [];
    this.intervals = [];
  }

  private run(id: string): void {
    void Promise.resolve(this.opts.onVerify(id)).catch(() => undefined);
  }
}

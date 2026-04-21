interface VerifySchedulerOptions {
  intervalMs: number;
  staggerMs: number;
  onVerify: (lockId: string) => void | Promise<void>;
}

export class VerifyScheduler {
  private timers: NodeJS.Timeout[] = [];
  constructor(private readonly opts: VerifySchedulerOptions) {}

  schedule(lockIds: readonly string[]): void {
    this.stop();
    const step = lockIds.length > 1 ? this.opts.staggerMs / Math.max(lockIds.length - 1, 1) : 0;
    lockIds.forEach((id, idx) => {
      const initial = setTimeout(() => {
        this.run(id);
        const interval = setInterval(() => {
          void this.run(id);
        }, this.opts.intervalMs);
        this.timers.push(interval);
      }, idx * step);
      this.timers.push(initial);
    });
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private run(id: string): void {
    void Promise.resolve(this.opts.onVerify(id)).catch(() => undefined);
  }
}

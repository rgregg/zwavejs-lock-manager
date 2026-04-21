import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyScheduler } from "../../src/verify/scheduler.js";

describe("VerifyScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires callback for each lock at staggered times", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 1000,
      staggerMs: 300,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a", "b", "c"]);
    vi.advanceTimersByTime(0);
    expect(calls).toEqual(["a"]);
    vi.advanceTimersByTime(150);
    expect(calls).toEqual(["a", "b"]);
    vi.advanceTimersByTime(150);
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("repeats at interval per lock", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 500,
      staggerMs: 0,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a"]);
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(["a", "a", "a"]);
  });

  it("stop clears timers", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 500,
      staggerMs: 0,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a"]);
    vi.advanceTimersByTime(0);
    s.stop();
    vi.advanceTimersByTime(5000);
    expect(calls).toEqual(["a"]);
  });
});

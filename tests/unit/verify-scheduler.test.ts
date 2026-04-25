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

  it("skipInitial: does not fire at t=0, fires at t=intervalMs", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 1000,
      staggerMs: 0,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a"], { skipInitial: true });
    vi.advanceTimersByTime(0);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(999);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["a"]);
  });

  it("skipInitial: staggered locks each defer by one full interval plus their stagger offset", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 1000,
      staggerMs: 300,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a", "b", "c"], { skipInitial: true });
    // Nothing fires before the interval
    vi.advanceTimersByTime(999);
    expect(calls).toEqual([]);
    // "a" fires at intervalMs + 0 * step = 1000
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["a"]);
    // "b" fires at intervalMs + 1 * step = 1150
    vi.advanceTimersByTime(150);
    expect(calls).toEqual(["a", "b"]);
    // "c" fires at intervalMs + 2 * step = 1300
    vi.advanceTimersByTime(150);
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("skipInitial: fires again at intervalMs after the first deferred fire", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 500,
      staggerMs: 0,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a"], { skipInitial: true });
    vi.advanceTimersByTime(500); // first fire (deferred)
    expect(calls).toEqual(["a"]);
    vi.advanceTimersByTime(500); // second fire (interval)
    expect(calls).toEqual(["a", "a"]);
    vi.advanceTimersByTime(500); // third fire
    expect(calls).toEqual(["a", "a", "a"]);
  });
});

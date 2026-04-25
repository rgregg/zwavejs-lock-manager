import { describe, expect, it } from "vitest";

/**
 * Standalone tests for the per-lock verify queue pattern used in app.ts.
 *
 * We extract the same queueVerify logic into a local helper so we can unit-test
 * it without spinning up a full app.
 */

function makeQueue() {
  const queues = new Map<string, Promise<void>>();

  const queue = async (lockId: string, fn: () => Promise<void>): Promise<void> => {
    const prior = queues.get(lockId) ?? Promise.resolve();
    const next = prior.then(() => fn());
    queues.set(lockId, next.catch(() => undefined));
    await next;
  };

  return queue;
}

describe("per-lock verify queue", () => {
  it("serializes concurrent calls for the same lock", async () => {
    const order: string[] = [];
    const queue = makeQueue();

    let resolveFirst!: () => void;
    const first = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const p1 = queue("lock-a", async () => {
      order.push("first-start");
      await first;
      order.push("first-end");
    });

    const p2 = queue("lock-a", async () => {
      order.push("second-start");
      order.push("second-end");
    });

    // Yield a tick so the first task actually starts executing
    await Promise.resolve();

    // At this point: first is running (blocked on `first`), second is waiting
    expect(order).toEqual(["first-start"]);

    resolveFirst();
    await p1;
    await p2;

    // Second must not start until first fully completes
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  it("does not serialize calls for different locks", async () => {
    const order: string[] = [];
    const queue = makeQueue();

    let resolveA!: () => void;
    const blockA = new Promise<void>((r) => {
      resolveA = r;
    });

    const pA = queue("lock-a", async () => {
      order.push("a-start");
      await blockA;
      order.push("a-end");
    });

    const pB = queue("lock-b", async () => {
      order.push("b-start");
      order.push("b-end");
    });

    // b should be able to run while a is still blocked
    await pB;
    expect(order).toContain("b-end");
    expect(order).not.toContain("a-end");

    resolveA();
    await pA;
    expect(order).toContain("a-end");
  });

  it("second call runs even if the first rejects", async () => {
    const order: string[] = [];
    const queue = makeQueue();

    const p1 = queue("lock-a", async () => {
      order.push("first");
      throw new Error("first failed");
    });

    const p2 = queue("lock-a", async () => {
      order.push("second");
    });

    await expect(p1).rejects.toThrow("first failed");
    await p2;

    expect(order).toEqual(["first", "second"]);
  });
});

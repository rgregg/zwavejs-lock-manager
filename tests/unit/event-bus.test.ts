import { describe, it, expect } from "vitest";
import { EventBus } from "../../src/events/bus.js";

describe("EventBus", () => {
  it("dispatches typed events to subscribers", () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.on("unlock", (e) => seen.push(e.slot));
    bus.emit("unlock", { ts: "t", lockId: "a", slot: 3 });
    bus.emit("unlock", { ts: "t", lockId: "a", slot: 4 });
    expect(seen).toEqual([3, 4]);
  });

  it("fans out to multiple subscribers", () => {
    const bus = new EventBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.on("unlock", (e) => a.push(e.slot));
    bus.on("unlock", (e) => b.push(e.slot));
    bus.emit("unlock", { ts: "t", lockId: "x", slot: 1 });
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
  });

  it("off removes a listener", () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const fn = (e: { slot: number }) => seen.push(e.slot);
    bus.on("unlock", fn);
    bus.off("unlock", fn);
    bus.emit("unlock", { ts: "t", lockId: "x", slot: 9 });
    expect(seen).toEqual([]);
  });
});

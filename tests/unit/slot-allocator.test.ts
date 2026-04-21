import { describe, it, expect } from "vitest";
import { allocateSlot } from "../../src/store/slot-allocator.js";

describe("allocateSlot", () => {
  it("returns 1 when no slots are taken", () => {
    expect(allocateSlot(new Set(), 30)).toBe(1);
  });

  it("returns the lowest free slot", () => {
    expect(allocateSlot(new Set([1, 2, 4]), 30)).toBe(3);
  });

  it("returns the next free slot after the taken block", () => {
    expect(allocateSlot(new Set([1, 2, 3]), 30)).toBe(4);
  });

  it("treats reserved (disabled) slots as taken", () => {
    expect(allocateSlot(new Set([1, 2, 3, 4, 5]), 30)).toBe(6);
  });

  it("throws when all slots are exhausted", () => {
    const taken = new Set<number>();
    for (let i = 1; i <= 30; i++) taken.add(i);
    expect(() => allocateSlot(taken, 30)).toThrow(/no slot available/i);
  });
});

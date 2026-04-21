export function allocateSlot(taken: ReadonlySet<number>, maxSlots: number): number {
  for (let i = 1; i <= maxSlots; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(`No slot available (capacity ${maxSlots})`);
}

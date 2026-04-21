export interface LockSyncTarget {
  id: string;
  nodeId: number;
  maxCodeSlots: number;
}

export interface LockWriter {
  setUserCode(nodeId: number, slot: number, pin: string): Promise<void>;
  clearUserCode(nodeId: number, slot: number): Promise<void>;
}

export type ReconcileOutcome = "ok" | "error" | "partial";

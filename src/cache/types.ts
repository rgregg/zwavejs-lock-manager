export type SlotStatus = "enabled" | "empty" | "unknown";

export interface SlotState {
  status: SlotStatus;
  userId?: string;
  pinFingerprint?: string;
  updatedAt: string;
}

export interface LockState {
  lastVerifiedAt?: string;
  lastReconcileAt?: string;
  lastReconcileOutcome?: "ok" | "error" | "partial";
  slots: Record<string, SlotState>;
}

export interface CacheFile {
  version: 1;
  locks: Record<string, LockState>;
}

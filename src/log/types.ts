export interface LoggedUnlock {
  ts: string;
  type: "unlock";
  lockId: string;
  lockName: string;
  userId?: string;
  userName?: string;
  slot?: number;
  source?: "keypad" | "doorLock";
}

export interface LoggedWrite {
  ts: string;
  type: "write";
  lockId: string;
  slot: number;
  outcome: "ok" | "error";
}

export interface LoggedNotificationFailed {
  ts: string;
  type: "notification_failed";
  reason: string;
  lockId: string;
  slot?: number;
}

export type LoggedEvent =
  | LoggedUnlock
  | LoggedWrite
  | LoggedNotificationFailed;

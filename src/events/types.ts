export interface UnlockEvent {
  ts: string;
  lockId: string;
  /** Keypad user-code slot, when the unlock was attributable to one. Absent for a
   *  Door Lock state-change fallback (e.g. fingerprint, thumbturn, key, or app). */
  slot?: number;
  /** How the unlock was detected: a keypad PIN notification, or the Door Lock
   *  state changing to unsecured (the fallback that catches non-keypad unlocks). */
  source?: "keypad" | "doorLock";
}

export interface ConnectionEvent {
  ts: string;
  source: "zwaveJs" | "homeAssistant";
  status: "connected" | "disconnected";
}

export interface AppEvents {
  unlock: UnlockEvent;
  connection: ConnectionEvent;
}

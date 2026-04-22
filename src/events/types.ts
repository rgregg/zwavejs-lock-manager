export interface UnlockEvent {
  ts: string;
  lockId: string;
  slot: number;
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

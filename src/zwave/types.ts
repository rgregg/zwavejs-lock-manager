export interface UserCodeSlot {
  slot: number;
  status: "enabled" | "empty" | "unknown";
  pin?: string;
}

export interface ZwaveNotification {
  type: "unlock" | "keypadCodeChanged";
  nodeId: number;
  slot: number;
}

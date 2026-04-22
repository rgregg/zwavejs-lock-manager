import type { Logger } from "pino";
import type { LockWriter } from "../reconciler/types.js";

export function createReadOnlyWriter(log: Logger): LockWriter {
  return {
    async setUserCode(nodeId, slot, pin) {
      log.warn(
        { nodeId, slot, pinLength: pin.length },
        "[READ ONLY] blocked setUserCode",
      );
    },
    async clearUserCode(nodeId, slot) {
      log.warn({ nodeId, slot }, "[READ ONLY] blocked clearUserCode");
    },
  };
}

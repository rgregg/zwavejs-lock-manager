import type { ConnectionStatus } from "../status.js";

export function renderStatusPartial(status: ConnectionStatus): string {
  const zwOk = status.zwaveJs !== "disconnected";
  const haOk = status.homeAssistant !== "disconnected";
  const allOk = zwOk && haOk;

  if (allOk && status.zwaveJs !== "unknown" && status.homeAssistant !== "unknown") {
    return `<span class="status-dot status-dot--ok" title="ZWave and Home Assistant connected"><span class="status-dot__circle"></span>Connected</span>`;
  }
  if (allOk) {
    return `<span class="status-dot" title="Connection status unknown"><span class="status-dot__circle"></span></span>`;
  }
  const parts: string[] = [];
  if (!zwOk) parts.push("ZWave gateway");
  if (!haOk) parts.push("Home Assistant");
  const label = parts.join(", ");
  return `<span class="status-dot status-dot--err" title="Disconnected: ${label}"><span class="status-dot__circle"></span><span>Disconnected: ${label}</span></span>`;
}

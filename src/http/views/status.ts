import type { ConnectionStatus } from "../status.js";

export function renderStatusPartial(status: ConnectionStatus): string {
  const disconnected: string[] = [];
  if (status.zwaveJs === "disconnected") disconnected.push("ZWave gateway");
  if (status.homeAssistant === "disconnected") disconnected.push("Home Assistant");

  if (disconnected.length === 0) {
    return `<div id="connection-banner"></div>`;
  }

  return `<div id="connection-banner">
  <div style="background:#fee;border:1px solid #c33;padding:0.5rem;margin:0.5rem 0">
    &#9888; <strong>Disconnected:</strong> ${disconnected.join(", ")}
  </div>
</div>`;
}

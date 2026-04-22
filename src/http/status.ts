export interface ConnectionStatus {
  zwaveJs: "connected" | "disconnected" | "unknown";
  homeAssistant: "connected" | "disconnected" | "unknown";
}

export class ConnectionStatusTracker {
  private state: ConnectionStatus = { zwaveJs: "unknown", homeAssistant: "unknown" };

  set(source: "zwaveJs" | "homeAssistant", status: "connected" | "disconnected"): void {
    this.state = { ...this.state, [source]: status };
  }

  get(): ConnectionStatus {
    return this.state;
  }
}

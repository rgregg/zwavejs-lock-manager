export interface DiscoverOpts {
  supervisorToken: string;
  /** Override the Supervisor base URL (defaults to http://supervisor). For tests. */
  supervisorUrl?: string;
}

interface DiscoveryEntry {
  service: string;
  config?: { host?: string; port?: number };
}

/**
 * Resolve the Z-Wave JS WebSocket URL from the Supervisor discovery API.
 *
 * The Z-Wave JS add-on registers a `zwave_js` discovery entry carrying the
 * host/port of its websocket server. We turn that into a `ws://host:port` URL.
 */
export async function discoverZwaveJsUrl(opts: DiscoverOpts): Promise<string> {
  const base = opts.supervisorUrl ?? "http://supervisor";
  const res = await fetch(`${base}/discovery`, {
    headers: { authorization: `Bearer ${opts.supervisorToken}` },
  });
  if (!res.ok) {
    throw new Error(`Supervisor discovery failed: ${res.status}`);
  }
  const body = (await res.json()) as { data?: { discovery?: DiscoveryEntry[] } };
  const zwave = body.data?.discovery?.find((d) => d.service === "zwave_js");
  if (!zwave) {
    throw new Error("zwave_js service not discovered by the Supervisor");
  }
  const host = zwave.config?.host;
  const port = zwave.config?.port ?? 3000;
  if (!host) {
    throw new Error("zwave_js discovery entry missing host");
  }
  return `ws://${host}:${port}`;
}

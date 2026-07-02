import net from "node:net";

/**
 * Well-known internal hostnames of the two standard Home Assistant Z-Wave JS
 * add-ons, on their default websocket port (3000):
 *   - `core-zwave-js`            — official "Z-Wave JS" add-on
 *   - `a0d7b954-zwavejs2mqtt`    — community "Z-Wave JS UI" add-on
 * Both are reachable by hostname from any add-on on the Supervisor network.
 */
export const DEFAULT_ZWAVE_CANDIDATES = [
  "ws://core-zwave-js:3000",
  "ws://a0d7b954-zwavejs2mqtt:3000",
];

export interface DiscoverOpts {
  /** URLs to probe, in priority order. Defaults to {@link DEFAULT_ZWAVE_CANDIDATES}. */
  candidates?: string[];
  /** Reachability probe (injectable for tests). Defaults to a TCP connect. */
  probe?: (url: string) => Promise<boolean>;
  /** Per-candidate connect timeout for the default TCP probe. */
  timeoutMs?: number;
}

/**
 * Resolve the Z-Wave JS websocket URL for add-on mode.
 *
 * Add-ons cannot use the Supervisor discovery API — `GET /discovery` is
 * restricted to Home Assistant Core (`@require_home_assistant`), and listing
 * add-ons needs a manager role we don't hold. Instead we probe the well-known
 * Z-Wave JS add-on hostnames, which are reachable add-on-to-add-on by hostname,
 * and use the first that accepts a connection. Set the `zwave_url` option to
 * override this (external server, non-default port, or an unusual add-on slug).
 */
export async function discoverZwaveJsUrl(opts: DiscoverOpts = {}): Promise<string> {
  const candidates = opts.candidates ?? DEFAULT_ZWAVE_CANDIDATES;
  const probe = opts.probe ?? ((url: string) => tcpProbe(url, opts.timeoutMs ?? 2000));

  for (const url of candidates) {
    if (await probe(url)) return url;
  }

  throw new Error(
    `Could not auto-detect a Z-Wave JS server on the add-on network ` +
      `(tried: ${candidates.join(", ")}). Set the "zwave_url" option to your ` +
      `Z-Wave JS add-on's websocket URL, e.g. ws://core-zwave-js:3000.`,
  );
}

/** Resolve true if a TCP connection to the URL's host:port succeeds within the timeout. */
function tcpProbe(url: string, timeoutMs: number): Promise<boolean> {
  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = parsed.port ? Number(parsed.port) : 3000;
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

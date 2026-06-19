interface DiscoverOpts {
  supervisorToken: string;
  supervisorUrl?: string;
}

interface DiscoveryEntry {
  service: string;
  config: { host?: string; port?: number };
}

export async function discoverZwaveJsUrl(opts: DiscoverOpts): Promise<string> {
  const base = opts.supervisorUrl ?? "http://supervisor";
  const res = await fetch(`${base}/discovery`, {
    headers: { authorization: `Bearer ${opts.supervisorToken}` },
  });
  if (!res.ok) throw new Error(`Supervisor discovery failed: ${res.status}`);
  const body = (await res.json()) as { data?: { discovery?: DiscoveryEntry[] } };
  const zwave = body.data?.discovery?.find((d) => d.service === "zwave_js");
  if (!zwave) throw new Error("zwave_js service not discovered by supervisor");
  const host = zwave.config.host;
  const port = zwave.config.port ?? 3000;
  if (!host) throw new Error("zwave_js discovery missing host");
  return `ws://${host}:${port}`;
}

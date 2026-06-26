export interface HaNotifierOptions {
  url: string;
  token: string;
  service: string; // e.g. "notify.mobile_app_ryan" or "ticker.notify"
  category?: string; // required by ticker.notify; included in the body when set
}

export interface NotifyUnlockInput {
  lockName: string;
  userName?: string;
  slot?: number;
}

export type NotifyResult = { ok: true } | { ok: false; error: string };

export class HaNotifier {
  constructor(private readonly opts: HaNotifierOptions) {}

  async notifyUnlock(input: NotifyUnlockInput): Promise<NotifyResult> {
    const message = input.userName
      ? `${input.userName} unlocked ${input.lockName}`
      : input.slot !== undefined
        ? `Unknown user (slot ${input.slot}) unlocked ${input.lockName}`
        : `${input.lockName} was unlocked`;

    const [domain, service] = this.opts.service.split(".");
    const endpoint = `${this.opts.url.replace(/\/$/, "")}/api/services/${domain}/${service}`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message,
          // ticker.notify requires both a category and a title (it rejects a
          // category-only body with HTTP 400); use the lock name as the title.
          ...(this.opts.category
            ? { category: this.opts.category, title: input.lockName }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `HA ${res.status}: ${body}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

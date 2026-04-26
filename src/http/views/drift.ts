import type { LockConfig } from "../../config/schema.js";
import type { LockState } from "../../cache/types.js";
import type { User } from "../../store/types.js";
import { escapeHtml, layout } from "./layout.js";
import type { LayoutOpts } from "./layout.js";

export function renderDriftPage(
  lock: LockConfig,
  state: LockState | undefined,
  users: readonly User[],
  opts?: LayoutOpts,
): string {
  const drifted = Object.entries(state?.slots ?? {})
    .filter(([, s]) => s.drifted)
    .map(([k, s]) => ({ slot: Number(k), slotState: s }))
    .sort((a, b) => a.slot - b.slot);

  const userBySlot = new Map(users.map((u) => [u.slot, u]));

  // Two distinct kinds of drift:
  //   "unknown_on_lock" — lock has a code we don't manage in users.json
  //   "missing_on_lock" — users.json expects a user here, lock has no code
  const unknownOnLock = drifted.filter(
    (d) => d.slotState.status === "enabled" && d.slotState.pin,
  );
  const missingOnLock = drifted.filter((d) => d.slotState.status !== "enabled");

  const adoptCards = unknownOnLock
    .map(({ slot, slotState }) => {
      const pin = slotState.pin ?? "";
      return `
    <div class="drift-card">
      <div class="drift-card__slot">Slot ${slot}</div>
      <div class="drift-card__pin">${escapeHtml(pin)}</div>
      <form method="post" action="/locks/${escapeHtml(lock.id)}/drift/adopt" class="drift-card__form">
        <input type="hidden" name="slot" value="${slot}" />
        <label class="field">Name
          <input name="name" placeholder="Slot ${slot} (adopted)" required />
        </label>
        <div style="display:flex;align-items:flex-end">
          <button type="submit">Adopt</button>
        </div>
      </form>
    </div>`;
    })
    .join("");

  const missingCards = missingOnLock
    .map(({ slot, slotState }) => {
      const user = userBySlot.get(slot);
      const expected = user
        ? `<strong>${escapeHtml(user.name)}</strong>${user.enabled ? "" : ' <span style="color:var(--text-muted)">(disabled)</span>'}`
        : '<span style="color:var(--text-muted)">(no user assigned)</span>';
      return `
    <div class="drift-card">
      <div class="drift-card__slot">Slot ${slot}</div>
      <div style="margin-bottom:0.75rem">Expected: ${expected}</div>
      <div style="font-size:0.82rem;color:var(--text-muted)">Lock state: <code>${escapeHtml(slotState.status)}</code></div>
    </div>`;
    })
    .join("");

  const sections: string[] = [];

  if (unknownOnLock.length > 0) {
    sections.push(`
  <h2 style="margin-top:1.5rem">Unknown codes on the lock</h2>
  <p style="color:var(--text-muted);margin-bottom:1rem">These slots have codes that don't match any user in this service. Adopt to create a user whose PIN matches what's on the lock — no write happens, drift resolves on the next verify.</p>
  <div class="drift-grid">${adoptCards}</div>`);
  }

  if (missingOnLock.length > 0) {
    sections.push(`
  <h2 style="margin-top:1.5rem">Lock missing your code</h2>
  <p style="color:var(--text-muted);margin-bottom:1rem">These slots are empty (or in an unknown state) on the lock, but <code>users.json</code> has a user expecting them. The reconciler will write each user's PIN once you flip out of read-only mode and clear drift.</p>
  <div class="drift-grid">${missingCards}</div>`);
  }

  const body = `
  <p style="margin-bottom:1rem"><a href="/locks">&larr; Back to locks</a></p>
  <h1>Drift: ${escapeHtml(lock.name)}</h1>
  ${
    drifted.length === 0
      ? `<p class="card" style="color:var(--text-muted)">No drift on this lock.</p>`
      : `${sections.join("")}
  <hr style="border:none;border-top:1px solid var(--border);margin:1.5rem 0" />
  <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:0.75rem">Force resync clears drift on every drifted slot at once and lets the reconciler push <code>users.json</code> to the lock. In read-only mode this just clears the flags — actual writes happen when you flip <code>readOnly: false</code>.</p>
  <form method="post" action="/locks/${escapeHtml(lock.id)}/drift/clear">
    <button type="submit" class="btn-warning" onclick="return confirm('This will clear drift on all drifted slots and queue a reconcile. Proceed?')">Force resync (overwrite lock)</button>
  </form>`
  }`;
  return layout(`Drift: ${lock.name}`, body, { ...opts, activeNav: "locks" });
}

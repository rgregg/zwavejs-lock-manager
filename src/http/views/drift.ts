import type { LockConfig } from "../../config/schema.js";
import type { LockState } from "../../cache/types.js";
import { escapeHtml, layout } from "./layout.js";
import type { LayoutOpts } from "./layout.js";

export function renderDriftPage(
  lock: LockConfig,
  state: LockState | undefined,
  opts?: LayoutOpts,
): string {
  const drifted = Object.entries(state?.slots ?? {})
    .filter(([, s]) => s.drifted)
    .map(([k, s]) => ({ slot: Number(k), slotState: s }))
    .sort((a, b) => a.slot - b.slot);

  const cards = drifted
    .map(({ slot, slotState }) => {
      const pin = slotState.pin ?? "";
      const hasPin = pin !== "";
      return `
    <div class="drift-card">
      <div class="drift-card__slot">Slot ${slot}</div>
      <div class="drift-card__pin">${hasPin ? escapeHtml(pin) : '<em style="font-style:italic;font-size:0.85rem;color:var(--text-muted)">unknown — verify to reveal</em>'}</div>
      ${hasPin
        ? `<form method="post" action="/locks/${escapeHtml(lock.id)}/drift/adopt" class="drift-card__form">
          <input type="hidden" name="slot" value="${slot}" />
          <label class="field">Name
            <input name="name" placeholder="Slot ${slot} (adopted)" required />
          </label>
          <div style="display:flex;align-items:flex-end">
            <button type="submit">Adopt</button>
          </div>
        </form>`
        : ""}
    </div>`;
    })
    .join("");

  const body = `
  <p style="margin-bottom:1rem"><a href="/locks">&larr; Back to locks</a></p>
  <h1>Drift: ${escapeHtml(lock.name)}</h1>
  ${drifted.length === 0
    ? `<p class="card" style="color:var(--text-muted)">No drift on this lock.</p>`
    : `<p style="color:var(--text-muted);margin-bottom:1rem">These slots have codes that don't match any user in this service. Adopt to create a user whose PIN matches what's on the lock (nothing is written; drift resolves on the next verify).</p>
  <div class="drift-grid">${cards}</div>
  <hr style="border:none;border-top:1px solid var(--border);margin:1.5rem 0" />
  <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:0.75rem">Or overwrite all drifted slots on this lock with what <code>users.json</code> says (will clear any keypad-set codes):</p>
  <form method="post" action="/locks/${escapeHtml(lock.id)}/drift/clear">
    <button type="submit" class="btn-warning" onclick="return confirm('This will overwrite drifted slots with the desired state. Proceed?')">Force resync (overwrite lock)</button>
  </form>`}`;
  return layout(`Drift: ${lock.name}`, body, { ...opts, activeNav: "locks" });
}

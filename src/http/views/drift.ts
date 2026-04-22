import type { LockConfig } from "../../config/schema.js";
import type { LockState } from "../../cache/types.js";
import { escapeHtml, layout } from "./layout.js";

export function renderDriftPage(
  lock: LockConfig,
  state: LockState | undefined,
  opts?: { readOnly?: boolean },
): string {
  const drifted = Object.entries(state?.slots ?? {})
    .filter(([, s]) => s.drifted)
    .map(([k, s]) => ({ slot: Number(k), slotState: s }))
    .sort((a, b) => a.slot - b.slot);

  const rows = drifted
    .map(({ slot, slotState }) => {
      const pin = slotState.pin ?? "";
      const hasPin = pin !== "";
      return `
      <tr>
        <td>${slot}</td>
        <td>${escapeHtml(slotState.status)}</td>
        <td>${hasPin ? escapeHtml(pin) : "<em>unknown (verify to reveal)</em>"}</td>
        <td>
          ${
            hasPin
              ? `<form method="post" action="/locks/${escapeHtml(lock.id)}/drift/adopt" class="inline">
                  <input type="hidden" name="slot" value="${slot}" />
                  <label>Name <input name="name" placeholder="Slot ${slot} (adopted)" required /></label>
                  <button type="submit">Adopt</button>
                </form>`
              : ""
          }
        </td>
      </tr>`;
    })
    .join("");

  const body = `
  <h1>Drift: ${escapeHtml(lock.name)}</h1>
  <p><a href="/locks">&larr; back to locks</a></p>
  ${
    drifted.length === 0
      ? "<p>No drift on this lock.</p>"
      : `<p>These slots have codes that don't match any user in this service. Adopt to create a user whose PIN matches what's on the lock (nothing is written; drift resolves on the next verify).</p>
  <table>
    <thead><tr><th>Slot</th><th>Lock state</th><th>PIN on lock</th><th>Action</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p>Or: force-resync to overwrite all drifted slots on this lock with what <code>users.json</code> says (will clear the keypad-set code):</p>
  <form method="post" action="/locks/${escapeHtml(lock.id)}/drift/clear">
    <button type="submit" onclick="return confirm('This will overwrite drifted slots with the desired state. Proceed?')">Force resync (overwrite lock)</button>
  </form>`
  }`;
  return layout(`Drift: ${lock.name}`, body, opts);
}

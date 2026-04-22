import type { LockConfig } from "../../config/schema.js";
import type { LockState } from "../../cache/types.js";
import { escapeHtml, layout } from "./layout.js";

export function renderLocksPage(
  locks: readonly LockConfig[],
  cache: (id: string) => LockState | undefined,
): string {
  const rows = locks
    .map((lock) => {
      const st = cache(lock.id);
      const outcome = st?.lastReconcileOutcome ?? "unknown";
      const driftedSlots = st
        ? Object.values(st.slots).filter((s) => s?.drifted).length
        : 0;
      const driftBadge =
        driftedSlots > 0
          ? `<span class="drift-badge">&#9888; Drift: ${driftedSlots} slot(s)</span>`
          : "";
      const driftClearForm =
        driftedSlots > 0
          ? `<form class="inline" method="post" action="/locks/${lock.id}/drift/clear">
            <button type="submit">Accept desired (force resync)</button>
          </form>`
          : "";
      return `
      <tr>
        <td>${escapeHtml(lock.name)}${driftBadge}</td>
        <td>node ${lock.nodeId}</td>
        <td class="status-${outcome}">${outcome}</td>
        <td>${escapeHtml(st?.lastReconcileAt ?? "never")}</td>
        <td>${escapeHtml(st?.lastVerifiedAt ?? "never")}</td>
        <td>
          <form class="inline" method="post" action="/locks/${lock.id}/resync">
            <button type="submit">Resync</button>
          </form>
          <form class="inline" method="post" action="/locks/${lock.id}/verify"
                onsubmit="return confirm('Verify will wake the lock. Proceed?');">
            <button type="submit">Verify now</button>
          </form>
          ${driftClearForm}
        </td>
      </tr>`;
    })
    .join("");
  const body = `
  <h1>Locks</h1>
  <table>
    <thead><tr><th>Name</th><th>Node</th><th>Last outcome</th><th>Last reconcile</th><th>Last verify</th><th>Actions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  return layout("Locks", body);
}

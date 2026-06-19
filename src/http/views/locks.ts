import type { LockConfig } from "../../config/schema.js";
import type { LockState } from "../../cache/types.js";
import { escapeHtml, layout, withBase } from "./layout.js";
import type { LayoutOpts } from "./layout.js";

export function renderLocksPage(
  locks: readonly LockConfig[],
  cache: (id: string) => LockState | undefined,
  opts?: LayoutOpts,
): string {
  const link = (p: string) => withBase(opts, p);
  const rows = locks
    .map((lock) => {
      const st = cache(lock.id);
      const outcome = st?.lastReconcileOutcome ?? "unknown";
      const driftedSlots = st
        ? Object.values(st.slots).filter((s) => s?.drifted).length
        : 0;
      const driftBadge = driftedSlots > 0
        ? `<a href="${link(`/locks/${lock.id}/drift`)}" class="drift-badge">&#9888; Drift: ${driftedSlots} slot(s)</a>`
        : "";
      const driftClearForm = driftedSlots > 0
        ? `<form class="inline" method="post" action="${link(`/locks/${lock.id}/drift/clear`)}">
            <button type="submit" class="btn-warning">Force resync (overwrite)</button>
          </form>`
        : "";
      return `
      <tr>
        <td>${escapeHtml(lock.name)}${driftBadge}</td>
        <td><span class="mono">node ${lock.nodeId}</span></td>
        <td class="status-${outcome}">${outcome}</td>
        <td><span class="mono">${escapeHtml(st?.lastReconcileAt ?? "never")}</span></td>
        <td><span class="mono">${escapeHtml(st?.lastVerifiedAt ?? "never")}</span></td>
        <td>
          <div class="actions">
            <form class="inline" method="post" action="${link(`/locks/${lock.id}/resync`)}">
              <button type="submit" class="btn-secondary">Resync</button>
            </form>
            <form class="inline" method="post" action="${link(`/locks/${lock.id}/verify`)}"
                  onsubmit="return confirm('Verify will wake the lock. Proceed?');">
              <button type="submit" class="btn-secondary">Verify now</button>
            </form>
            ${driftClearForm}
          </div>
        </td>
      </tr>`;
    })
    .join("");
  const body = `
  <h1>Locks</h1>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Node</th>
          <th>Last outcome</th>
          <th>Last reconcile</th>
          <th>Last verify</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="color:var(--text-muted);text-align:center;padding:1.5rem">No locks configured.</td></tr>'}</tbody>
    </table>
  </div>`;
  return layout("Locks", body, { ...opts, activeNav: "locks" });
}

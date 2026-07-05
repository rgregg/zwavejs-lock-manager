import type { LockConfig } from "../../config/schema.js";
import type { LockState } from "../../cache/types.js";
import type { User } from "../../store/types.js";
import { escapeHtml, layout } from "./layout.js";
import type { LayoutOpts } from "./layout.js";
import { buildDriftReport } from "../../drift/report.js";

export function renderDriftPage(
  lock: LockConfig,
  state: LockState | undefined,
  users: readonly User[],
  secret: string,
  opts?: LayoutOpts,
): string {
  const report = buildDriftReport(state, users, secret);
  const lockId = escapeHtml(lock.id);

  const hasDrift =
    report.lockCodes.length > 0 || report.userRows.some((r) => r.status !== "in_place");

  const userRowsHtml = report.userRows
    .map(({ user, status, foundInSlot }) => {
      let badge: string;
      let actions = "";
      if (status === "in_place") {
        badge = `<span class="status-ok">✓ in place</span>`;
      } else if (status === "wrong_slot") {
        badge = `<span class="drift-badge">🔀 found in slot ${foundInSlot}</span>`;
        actions = `
        <form method="post" action="/locks/${lockId}/drift/move" class="inline">
          <input type="hidden" name="userId" value="${escapeHtml(user.id)}" />
          <input type="hidden" name="toSlot" value="${foundInSlot}" />
          <button type="submit" class="btn-secondary">Move to slot ${foundInSlot}</button>
        </form>
        <form method="post" action="/locks/${lockId}/drift/rewrite" class="inline">
          <input type="hidden" name="assignedSlot" value="${user.slot}" />
          <input type="hidden" name="straySlot" value="${foundInSlot}" />
          <button type="submit" class="btn-warning">Rewrite slot ${user.slot}</button>
        </form>`;
      } else {
        badge = `<span class="drift-badge">❌ not on lock</span>`;
        actions = `<span style="color:var(--text-muted);font-size:0.85rem">will be written when not read-only</span>`;
      }
      return `
      <tr>
        <td class="col-num">${user.slot}</td>
        <td>${escapeHtml(user.name)}</td>
        <td>${badge}</td>
        <td class="actions">${actions}</td>
      </tr>`;
    })
    .join("");

  const codeCards = report.lockCodes
    .map((c) => {
      const note = c.matchesUser
        ? `matches <strong>${escapeHtml(c.matchesUser.name)}</strong>'s PIN (assigned slot ${c.matchesUser.assignedSlot})`
        : `unknown code`;
      let actions: string;
      if (c.assignedUser) {
        actions = `
        <div style="color:var(--warning);font-size:0.82rem;margin-bottom:0.5rem">Slot assigned to <strong>${escapeHtml(c.assignedUser.name)}</strong></div>
        <div class="drift-card__form">
          <form method="post" action="/locks/${lockId}/drift/replace" class="inline">
            <input type="hidden" name="slot" value="${c.slot}" />
            <button type="submit" class="btn-secondary">Replace ${escapeHtml(c.assignedUser.name)}'s PIN</button>
          </form>
          <form method="post" action="/locks/${lockId}/drift/adopt-free" class="inline">
            <input type="hidden" name="slot" value="${c.slot}" />
            <button type="submit">Adopt to free slot</button>
          </form>
        </div>`;
      } else {
        actions = `
        <form method="post" action="/locks/${lockId}/drift/adopt" class="drift-card__form">
          <input type="hidden" name="slot" value="${c.slot}" />
          <label class="field">Name
            <input name="name" placeholder="Slot ${c.slot} (adopted)" />
          </label>
          <div style="display:flex;align-items:flex-end">
            <button type="submit">Adopt</button>
          </div>
        </form>`;
      }
      return `
    <div class="drift-card">
      <div class="drift-card__slot">Slot ${c.slot}</div>
      <div class="drift-card__pin">${escapeHtml(c.pin)}</div>
      <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.5rem">${note}</div>
      ${actions}
    </div>`;
    })
    .join("");

  const sections: string[] = [];
  if (report.userRows.length > 0) {
    sections.push(`
  <h2 style="margin-top:1.5rem">Your users</h2>
  <p style="color:var(--text-muted);margin-bottom:1rem">Each managed user and whether their PIN is where it should be on the lock.</p>
  <div class="table-wrap"><table>
    <thead><tr><th class="col-num">Slot</th><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${userRowsHtml}</tbody>
  </table></div>`);
  }
  if (report.lockCodes.length > 0) {
    sections.push(`
  <h2 style="margin-top:1.5rem">Codes on the lock</h2>
  <p style="color:var(--text-muted);margin-bottom:1rem">Codes on the lock that don't match the user assigned to their slot. Adopt an unknown code to manage it; if the slot already belongs to a user, replace that user's PIN or adopt the code into a free slot.</p>
  <div class="drift-grid">${codeCards}</div>`);
  }

  const body = `
  <p style="margin-bottom:1rem"><a href="/locks">&larr; Back to locks</a></p>
  <h1>Drift: ${escapeHtml(lock.name)}</h1>
  ${
    !hasDrift
      ? `<p class="card" style="color:var(--text-muted)">No drift on this lock.</p>`
      : `${sections.join("")}
  <hr style="border:none;border-top:1px solid var(--border);margin:1.5rem 0" />
  <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:0.75rem">Force resync clears drift on every slot and lets the reconciler push <code>users.json</code> to the lock. In read-only mode this just clears the flags — actual writes happen when you set <code>readOnly: false</code>.</p>
  <form method="post" action="/locks/${lockId}/drift/clear">
    <button type="submit" class="btn-warning" onclick="return confirm('This will clear drift on all slots and queue a reconcile. Proceed?')">Force resync (overwrite lock)</button>
  </form>`
  }`;
  return layout(`Drift: ${lock.name}`, body, { ...opts, activeNav: "locks" });
}

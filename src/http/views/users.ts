import type { User } from "../../store/types.js";
import { escapeHtml, layout, withBase } from "./layout.js";
import type { LayoutOpts } from "./layout.js";

export function renderUserRow(user: User, opts?: LayoutOpts): string {
  const id = user.id;
  const link = (p: string) => withBase(opts, p);
  return `<tr id="user-${id}">
  <td class="col-num"><span class="mono">${user.slot}</span></td>
  <td>${escapeHtml(user.name)}</td>
  <td><code>${escapeHtml(user.pin)}</code></td>
  <td>${user.enabled ? "Enabled" : '<span style="color:var(--text-muted)">Disabled</span>'}</td>
  <td>
    <div class="actions">
      <button class="btn-secondary" hx-get="${link(`/users/${id}/edit-form`)}" hx-target="#user-${id}" hx-swap="outerHTML">Edit</button>
      <form class="inline" method="post" action="${link(`/users/${id}/toggle`)}">
        <button type="submit" class="btn-secondary">${user.enabled ? "Disable" : "Enable"}</button>
      </form>
      <form class="inline" method="post" action="${link(`/users/${id}/delete`)}"
            onsubmit="return confirm('Delete ${escapeHtml(user.name)}?');">
        <button type="submit" class="btn-danger">Delete</button>
      </form>
    </div>
  </td>
</tr>`;
}

export function renderUserRowEdit(user: User, opts?: LayoutOpts): string {
  const id = user.id;
  const link = (p: string) => withBase(opts, p);
  return `<tr id="user-${id}">
  <td class="col-num"><span class="mono">${user.slot}</span></td>
  <td><input form="edit-${id}" name="name" value="${escapeHtml(user.name)}" required aria-label="Name" /></td>
  <td><input form="edit-${id}" name="pin" value="${escapeHtml(user.pin)}" pattern="[0-9]{4,10}" aria-label="PIN" class="input-mono" /></td>
  <td>${user.enabled ? "Enabled" : '<span style="color:var(--text-muted)">Disabled</span>'}</td>
  <td>
    <div class="actions">
      <form id="edit-${id}" class="inline"
            hx-post="${link(`/users/${id}/edit`)}"
            hx-target="#user-${id}"
            hx-swap="outerHTML">
        <button type="submit">Save</button>
      </form>
      <button class="btn-secondary" hx-get="${link(`/users/${id}/row`)}" hx-target="#user-${id}" hx-swap="outerHTML">Cancel</button>
    </div>
  </td>
</tr>`;
}

export function renderUsersPage(users: readonly User[], opts?: LayoutOpts): string {
  const link = (p: string) => withBase(opts, p);
  const rows = [...users]
    .sort((a, b) => a.slot - b.slot)
    .map((u) => renderUserRow(u, opts))
    .join("");
  const body = `
  <h1>Users</h1>
  <div class="card" style="margin-bottom:1.5rem">
    <form method="post" action="${link("/users")}">
      <div class="form-grid">
        <label class="field">Name
          <input name="name" required placeholder="e.g. Alice" />
        </label>
        <label class="field">PIN
          <input name="pin" required pattern="[0-9]{4,10}" placeholder="4–10 digits" class="input-mono" />
        </label>
        <div style="display:flex;align-items:flex-end">
          <button type="submit">Add user</button>
        </div>
      </div>
    </form>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="col-num">Slot</th>
          <th>Name</th>
          <th>PIN</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5" style="color:var(--text-muted);text-align:center;padding:1.5rem">No users yet.</td></tr>'}</tbody>
    </table>
  </div>`;
  return layout("Users", body, { ...opts, activeNav: "users" });
}

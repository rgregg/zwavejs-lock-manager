import type { User } from "../../store/types.js";
import { escapeHtml, layout } from "./layout.js";

export function renderUserRow(user: User): string {
  const id = user.id;
  return `<tr id="user-${id}">
  <td>${user.slot}</td>
  <td>${escapeHtml(user.name)}</td>
  <td>${escapeHtml(user.pin)}</td>
  <td>${user.enabled ? "Enabled" : "Disabled"}</td>
  <td class="actions">
    <button hx-get="/users/${id}/edit-form" hx-target="#user-${id}" hx-swap="outerHTML">Edit</button>
    <form class="inline" method="post" action="/users/${id}/toggle">
      <button type="submit">${user.enabled ? "Disable" : "Enable"}</button>
    </form>
    <form class="inline" method="post" action="/users/${id}/delete"
          onsubmit="return confirm('Delete ${escapeHtml(user.name)}?');">
      <button type="submit">Delete</button>
    </form>
  </td>
</tr>`;
}

export function renderUserRowEdit(user: User): string {
  const id = user.id;
  return `<tr id="user-${id}">
  <td>${user.slot}</td>
  <td><input form="edit-${id}" name="name" value="${escapeHtml(user.name)}" required aria-label="Name" /></td>
  <td><input form="edit-${id}" name="pin" value="${escapeHtml(user.pin)}" pattern="[0-9]{4,10}" required aria-label="PIN" /></td>
  <td>${user.enabled ? "Enabled" : "Disabled"}</td>
  <td class="actions">
    <form id="edit-${id}" class="inline"
          hx-post="/users/${id}/edit"
          hx-target="#user-${id}"
          hx-swap="outerHTML">
      <button type="submit">Save</button>
    </form>
    <button hx-get="/users/${id}/row" hx-target="#user-${id}" hx-swap="outerHTML">Cancel</button>
  </td>
</tr>`;
}

export function renderUsersPage(users: readonly User[], opts?: { readOnly?: boolean }): string {
  const rows = users.map(renderUserRow).join("");
  const body = `
  <h1>Users</h1>
  <form method="post" action="/users">
    <label>Name <input name="name" required /></label>
    <label>PIN <input name="pin" required pattern="[0-9]{4,10}" /></label>
    <button type="submit">Add</button>
  </form>
  <table>
    <thead><tr><th>Slot</th><th>Name</th><th>PIN</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No users yet.</td></tr>'}</tbody>
  </table>`;
  return layout("Users", body, opts);
}

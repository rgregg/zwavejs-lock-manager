import type { User } from "../../store/types.js";
import { escapeHtml, layout } from "./layout.js";

export function renderUsersPage(users: readonly User[]): string {
  const rows = users
    .map(
      (u) => `
  <tr>
    <td>${u.slot}</td>
    <td>${escapeHtml(u.name)}</td>
    <td>${u.enabled ? "Enabled" : "Disabled"}</td>
    <td>
      <details>
        <summary>Edit</summary>
        <form method="post" action="/users/${u.id}/edit" style="margin-top:0.5rem">
          <label>Name <input name="name" value="${escapeHtml(u.name)}" required /></label>
          <label>New PIN <input name="pin" pattern="[0-9]{4,10}" placeholder="Leave blank to keep current" /></label>
          <button type="submit">Save</button>
        </form>
      </details>
      <form class="inline" method="post" action="/users/${u.id}/toggle">
        <button type="submit">${u.enabled ? "Disable" : "Enable"}</button>
      </form>
      <form class="inline" method="post" action="/users/${u.id}/delete"
            onsubmit="return confirm('Delete ${escapeHtml(u.name)}?');">
        <button type="submit">Delete</button>
      </form>
    </td>
  </tr>`,
    )
    .join("");
  const body = `
  <h1>Users</h1>
  <form method="post" action="/users">
    <label>Name <input name="name" required /></label>
    <label>PIN <input name="pin" required pattern="[0-9]{4,10}" /></label>
    <button type="submit">Add</button>
  </form>
  <table>
    <thead><tr><th>Slot</th><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No users yet.</td></tr>'}</tbody>
  </table>`;
  return layout("Users", body);
}

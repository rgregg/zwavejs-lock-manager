import type { LoggedEvent } from "../../log/types.js";
import { escapeHtml, layout } from "./layout.js";

export function renderEventsPage(events: readonly LoggedEvent[]): string {
  const rows = events
    .slice()
    .reverse()
    .map((e) => {
      const description = describeEvent(e);
      return `<tr><td>${escapeHtml(e.ts)}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(description)}</td></tr>`;
    })
    .join("");
  const body = `
  <h1>Events</h1>
  <p><small>Stream: <span hx-get="/events/stream" hx-trigger="load" hx-swap="none"></span></small></p>
  <table>
    <thead><tr><th>Time</th><th>Type</th><th>Details</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No events yet.</td></tr>'}</tbody>
  </table>`;
  return layout("Events", body);
}

function describeEvent(e: LoggedEvent): string {
  switch (e.type) {
    case "unlock":
      return e.userName
        ? `${e.userName} unlocked ${e.lockName}`
        : `Unknown slot ${e.slot} unlocked ${e.lockName}`;
    case "write":
      return `Write slot ${e.slot} on ${e.lockId}: ${e.outcome}`;
    case "keypad_change":
      return `Keypad change on ${e.lockId} slot ${e.slot}`;
    case "notification_failed":
      return `Notification failed for ${e.lockId} slot ${e.slot}: ${e.reason}`;
  }
}

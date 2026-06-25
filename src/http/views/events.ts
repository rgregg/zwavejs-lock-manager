import type { LoggedEvent } from "../../log/types.js";
import { escapeHtml, layout } from "./layout.js";
import type { LayoutOpts } from "./layout.js";

export function renderEventsPage(events: readonly LoggedEvent[], opts?: LayoutOpts): string {
  const reversed = events.slice().reverse();
  const grouped = groupByDay(reversed);
  const sections = grouped
    .map(({ dayLabel, events: dayEvents }) => {
      const rows = dayEvents
        .map((e) => {
          const time = formatTime(e.ts);
          const desc = describeEvent(e);
          const badgeClass = `badge badge--${e.type}`;
          return `<div class="event-row">
  <span class="event-time">${time}</span>
  <span class="${badgeClass}">${escapeHtml(e.type)}</span>
  <span>${escapeHtml(desc)}</span>
</div>`;
        })
        .join("");
      return `<div class="event-day">
  <div class="event-day__heading">${escapeHtml(dayLabel)}</div>
  ${rows}
</div>`;
    })
    .join("");
  const body = `
  <h1>Events</h1>
  <p><small>Stream: <span hx-get="/events/stream" hx-trigger="load" hx-swap="none"></span></small></p>
  ${sections || '<p style="color:var(--text-muted)">No events yet.</p>'}`;
  return layout("Events", body, { ...opts, activeNav: "events" });
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(11, 16);
  } catch {
    return ts.slice(0, 5);
  }
}

function dayKey(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return ts.slice(0, 10);
  }
}

function formatDayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  const yesterday = new Date(todayKey);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (key === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  try {
    return new Date(key + "T00:00:00Z").toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
    });
  } catch {
    return key;
  }
}

function groupByDay(events: readonly LoggedEvent[]): Array<{ dayLabel: string; events: LoggedEvent[] }> {
  const todayKey = new Date().toISOString().slice(0, 10);
  const map = new Map<string, LoggedEvent[]>();
  for (const e of events) {
    const k = dayKey(e.ts);
    const arr = map.get(k);
    if (arr) arr.push(e);
    else map.set(k, [e]);
  }
  return Array.from(map.entries()).map(([k, evts]) => ({
    dayLabel: formatDayLabel(k, todayKey),
    events: evts,
  }));
}

function describeEvent(e: LoggedEvent): string {
  switch (e.type) {
    case "unlock":
      return e.userName
        ? `${e.userName} unlocked ${e.lockName}`
        : e.slot !== undefined
          ? `Unknown slot ${e.slot} unlocked ${e.lockName}`
          : `${e.lockName} was unlocked`;
    case "write":
      return `Write slot ${e.slot} on ${e.lockId}: ${e.outcome}`;
    case "notification_failed":
      return `Notification failed for ${e.lockId} slot ${e.slot}: ${e.reason}`;
  }
}

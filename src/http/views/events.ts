import type { LoggedEvent } from "../../log/types.js";
import { escapeHtml, layout } from "./layout.js";
import type { LayoutOpts } from "./layout.js";

/** One event row. Shared by the initial page render and the live SSE feed, so a
 *  streamed event looks exactly like the same event after a reload. */
export function renderEventRow(e: LoggedEvent): string {
  return `<div class="event-row">
  <span class="event-time">${formatTime(e.ts)}</span>
  <span class="badge badge--${escapeHtml(e.type)}">${escapeHtml(e.type)}</span>
  <span>${escapeHtml(describeEvent(e))}</span>
</div>`;
}

export function renderEventsPage(events: readonly LoggedEvent[], opts?: LayoutOpts): string {
  const reversed = events.slice().reverse();
  const grouped = groupByDay(reversed);
  const sections = grouped
    .map(({ dayLabel, events: dayEvents }) => {
      const rows = dayEvents.map(renderEventRow).join("");
      return `<div class="event-day">
  <div class="event-day__heading">${escapeHtml(dayLabel)}</div>
  ${rows}
</div>`;
    })
    .join("");
  const body = `
  <h1>Events</h1>
  <p><small>Stream: <span id="stream-status" class="status-dot"><span class="status-dot__circle"></span><span id="stream-status-text">connecting…</span></span></small></p>
  <div id="event-live"></div>
  ${sections || '<p id="events-empty" style="color:var(--text-muted)">No events yet.</p>'}
  ${STREAM_SCRIPT}`;
  return layout("Events", body, { ...opts, activeNav: "events" });
}

// Live feed. New events are prepended to #event-live, above the day sections,
// so they appear without a reload; a refresh then files them under their day.
const STREAM_SCRIPT = `<script>
(function () {
  var live = document.getElementById("event-live");
  var dot = document.getElementById("stream-status");
  var text = document.getElementById("stream-status-text");
  if (!live || !window.EventSource) return;
  function setStatus(cls, label) {
    dot.className = "status-dot " + cls;
    text.textContent = label;
  }
  // The page may be served under a Home Assistant ingress prefix, so derive the
  // stream URL from where this page actually lives rather than from "/".
  var base = location.pathname.replace(/\\/events\\/?$/, "");
  var es = new EventSource(base + "/events/stream");
  es.onopen = function () { setStatus("status-dot--ok", "live"); };
  es.onerror = function () { setStatus("status-dot--err", "reconnecting…"); };
  es.addEventListener("log", function (msg) {
    var payload = JSON.parse(msg.data);
    var empty = document.getElementById("events-empty");
    if (empty) empty.remove();
    live.insertAdjacentHTML("afterbegin", payload.html);
  });
})();
</script>`;

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

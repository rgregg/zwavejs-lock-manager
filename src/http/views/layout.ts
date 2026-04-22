export function layout(title: string, body: string, opts?: { readOnly?: boolean }): string {
  const banner = opts?.readOnly
    ? `<div style="background:#fe7;border:1px solid #c90;padding:0.5rem;margin:0 0 0.5rem">🔒 <strong>READ ONLY mode</strong> — no codes will be written to your locks.</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <script src="https://unpkg.com/htmx.org@2.0.3"></script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    nav a { margin-right: 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #ddd; }
    .status-ok { color: #080; } .status-error { color: #c00; } .status-unknown { color: #888; }
    form.inline { display: inline; }
  </style>
</head>
<body>
  <nav>
    <a href="/users">Users</a>
    <a href="/locks">Locks</a>
    <a href="/events">Events</a>
  </nav>
  ${banner}
  <div hx-get="/status" hx-trigger="load, every 5s" hx-swap="innerHTML"></div>
  ${body}
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

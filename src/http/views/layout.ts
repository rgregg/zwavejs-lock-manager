export type ActiveNav = "users" | "locks" | "events";

export interface LayoutOpts {
  readOnly?: boolean;
  activeNav?: ActiveNav;
}

export function layout(title: string, body: string, opts?: LayoutOpts): string {
  const readOnly = opts?.readOnly ?? false;
  const activeNav = opts?.activeNav;

  const navLink = (href: string, label: string, key: ActiveNav) => {
    const active = activeNav === key;
    return `<a href="${href}" class="nav-tab${active ? " nav-tab--active" : ""}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
  };

  const readOnlyBadge = readOnly
    ? `<span class="ro-badge" title="No codes will be written to your locks in this mode.">&#128274; READ ONLY</span>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — Lock Users</title>
  <script src="https://unpkg.com/htmx.org@2.0.3"></script>
  <style>
    :root {
      --bg: #f5f5f7;
      --surface: #ffffff;
      --text: #1a1a1a;
      --text-muted: #6b7280;
      --accent: #2563eb;
      --success: #16a34a;
      --warning: #d97706;
      --error: #dc2626;
      --border: #e2e8f0;
      --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1419;
        --surface: #1a2030;
        --text: #e8eaed;
        --text-muted: #8b949e;
        --accent: #60a5fa;
        --success: #4ade80;
        --warning: #fbbf24;
        --error: #f87171;
        --border: #2d3748;
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 15px; line-height: 1.6;
      background: var(--bg); color: var(--text);
      margin: 0; padding: 0;
    }
    a { color: var(--accent); }
    a:hover { text-decoration: underline; }
    h1 { font-size: 1.4rem; margin: 0 0 1rem; }
    h2 { font-size: 1.1rem; margin: 0 0 0.75rem; color: var(--text-muted); }
    p { margin: 0 0 0.75rem; }
    code { font-family: var(--mono); font-size: 0.85em; background: var(--border); padding: 0.1em 0.35em; border-radius: 3px; }
    pre { font-family: var(--mono); font-size: 0.85em; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; overflow-x: auto; white-space: pre-wrap; }
    small { color: var(--text-muted); }
    .app-header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 1rem; }
    .app-header__inner { max-width: 1100px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; height: 52px; gap: 1rem; }
    .app-header__brand { font-size: 1rem; font-weight: 600; color: var(--text); text-decoration: none; letter-spacing: -0.01em; }
    .app-header__right { display: flex; align-items: center; gap: 0.75rem; }
    .ro-badge { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; border-radius: 4px; padding: 0.2em 0.55em; cursor: default; }
    @media (prefers-color-scheme: dark) { .ro-badge { background: #451a03; color: #fbbf24; border-color: #92400e; } }
    .status-dot { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; color: var(--text-muted); }
    .status-dot__circle { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; }
    .status-dot--ok .status-dot__circle { background: var(--success); }
    .status-dot--warn .status-dot__circle { background: var(--warning); }
    .status-dot--err .status-dot__circle { background: var(--error); }
    .app-nav { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 1rem; }
    .app-nav__inner { max-width: 1100px; margin: 0 auto; display: flex; gap: 0; }
    .nav-tab { display: inline-block; padding: 0.6rem 1rem; font-size: 0.9rem; font-weight: 500; color: var(--text-muted); text-decoration: none; border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; white-space: nowrap; }
    .nav-tab:hover { color: var(--text); text-decoration: none; }
    .nav-tab--active { color: var(--accent); border-bottom-color: var(--accent); }
    main { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border); }
    table { border-collapse: collapse; width: 100%; background: var(--surface); }
    thead { position: sticky; top: 0; z-index: 1; background: var(--surface); }
    th { padding: 0.65rem 0.85rem; text-align: left; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); border-bottom: 1px solid var(--border); background: var(--surface); }
    td { padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tbody tr:nth-child(even) { background: color-mix(in srgb, var(--border) 25%, transparent); }
    th.col-num, td.col-num { text-align: right; }
    .mono { font-family: var(--mono); font-size: 0.85em; }
    button, .btn { display: inline-flex; align-items: center; justify-content: center; height: 34px; padding: 0 0.85rem; font-size: 0.85rem; font-weight: 500; border-radius: 5px; border: 1px solid transparent; cursor: pointer; transition: opacity 0.15s, background 0.15s; white-space: nowrap; font-family: inherit; background: var(--accent); color: #fff; min-width: 0; }
    button:hover { opacity: 0.85; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button.btn-secondary { background: transparent; color: var(--text); border-color: var(--border); }
    button.btn-secondary:hover { background: var(--border); opacity: 1; }
    button.btn-danger { background: var(--error); color: #fff; }
    button.btn-warning { background: var(--warning); color: #fff; }
    .actions { white-space: nowrap; display: flex; gap: 0.35rem; align-items: center; }
    form.inline { display: inline; }
    input[type="text"], input:not([type]) { height: 36px; padding: 0 0.65rem; font-size: 0.9rem; font-family: inherit; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 5px; transition: border-color 0.15s, box-shadow 0.15s; width: 100%; }
    input[type="text"]:focus, input:not([type]):focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
    input.input-mono { font-family: var(--mono); letter-spacing: 0.05em; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; }
    .card + .card { margin-top: 1rem; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.75rem; align-items: end; }
    label.field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.83rem; font-weight: 500; color: var(--text-muted); }
    .drift-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .drift-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
    .drift-card__slot { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 0.25rem; }
    .drift-card__pin { font-family: var(--mono); font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; }
    .drift-card__form { display: flex; gap: 0.5rem; align-items: flex-end; flex-wrap: wrap; }
    .drift-card__form label.field { flex: 1; min-width: 120px; }
    .badge { display: inline-block; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.03em; padding: 0.15em 0.5em; border-radius: 3px; vertical-align: middle; text-transform: lowercase; }
    .badge--unlock { background: #dcfce7; color: #166534; }
    .badge--write { background: #dbeafe; color: #1e40af; }
    .badge--notification_failed { background: #fee2e2; color: #991b1b; }
    @media (prefers-color-scheme: dark) {
      .badge--unlock { background: #14532d; color: #86efac; }
      .badge--write { background: #1e3a5f; color: #93c5fd; }
      .badge--notification_failed { background: #450a0a; color: #fca5a5; }
    }
    .event-day { margin: 1.5rem 0 0.5rem; }
    .event-day__heading { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding-bottom: 0.4rem; border-bottom: 1px solid var(--border); margin-bottom: 0; }
    .event-row { display: flex; gap: 0.75rem; align-items: baseline; padding: 0.45rem 0; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
    .event-row:last-child { border-bottom: none; }
    .event-time { font-family: var(--mono); font-size: 0.8rem; color: var(--text-muted); flex-shrink: 0; width: 3.5rem; }
    .status-ok { color: var(--success); font-weight: 500; }
    .status-error { color: var(--error); font-weight: 500; }
    .status-unknown, .status-partial { color: var(--text-muted); }
    .drift-badge { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.78rem; font-weight: 600; background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; border-radius: 4px; padding: 0.1em 0.4em; margin-left: 0.5rem; text-decoration: none; }
    .drift-badge:hover { opacity: 0.85; text-decoration: none; }
    @media (prefers-color-scheme: dark) { .drift-badge { background: #451a03; color: #fbbf24; border-color: #92400e; } }
    .config-error-page { max-width: 680px; }
    .config-error-page h1 { font-size: 1.6rem; color: var(--error); }
    @media (max-width: 600px) {
      .form-grid { grid-template-columns: 1fr; }
      .drift-grid { grid-template-columns: 1fr; }
      th, td { padding: 0.55rem 0.6rem; }
    }
  </style>
</head>
<body>
  <header class="app-header">
    <div class="app-header__inner">
      <a class="app-header__brand" href="/users">Lock Users</a>
      <div class="app-header__right">
        ${readOnlyBadge}
        <div hx-get="/status" hx-trigger="load, every 5s" hx-swap="innerHTML"></div>
      </div>
    </div>
  </header>
  <nav class="app-nav" aria-label="Main">
    <div class="app-nav__inner">
      ${navLink("/users", "Users", "users")}
      ${navLink("/locks", "Locks", "locks")}
      ${navLink("/events", "Events", "events")}
    </div>
  </nav>
  <main>
    ${body}
  </main>
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

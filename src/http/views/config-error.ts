import { escapeHtml, layout } from "./layout.js";

export function renderConfigErrorPage(message: string): string {
  const body = `
  <div class="config-error-page">
    <h1>Configuration error</h1>
    <p>The service started in error mode because the configuration could not be loaded.</p>
    <pre>${escapeHtml(message)}</pre>
    <p>Common causes:</p>
    <ul>
      <li>Missing or unparseable <code>/data/locks.yaml</code></li>
      <li>Missing required fields in <code>locks.yaml</code> (zwaveJs URL, homeAssistant URL, etc.)</li>
      <li>Duplicate lock ids or node ids</li>
      <li>Missing <code>LOCAL_SECRET</code> environment variable</li>
    </ul>
    <p>Fix the configuration on the mounted <code>/data</code> volume and restart the container.</p>
  </div>`;
  return layout("Configuration error", body);
}

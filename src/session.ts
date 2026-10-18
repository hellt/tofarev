import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Repo, Sha } from './types.js';

const Record = z.record(z.string(), z.unknown());
export const SessionSnapshotSchema = z.strictObject({
  version: z.literal(1), repository: Repo, head: Sha,
  updatedAt: z.iso.datetime(), state: z.enum(['running', 'completed', 'failed']),
  info: z.object({ id: z.string().regex(/^ses_[a-zA-Z0-9]+$/), title: z.string().optional() }).passthrough(),
  messages: z.array(z.object({ info: z.object({ role: z.enum(['user', 'assistant']) }).passthrough(),
    parts: z.array(z.object({ type: z.string() }).passthrough()) })),
  report: z.string().optional(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export function html(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
const css = `:root{color-scheme:light dark;--bg:#f7f8fb;--fg:#202536;--panel:#fff;--border:#dbe0eb;--muted:#616c80;--accent:#5146d8}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:32px 22px 80px}a{color:var(--accent)}header{margin-bottom:26px}h1{font-size:30px;line-height:1.2;margin:12px 0}h2{font-size:20px}p{margin:10px 0}.muted,time{color:var(--muted)}.badge{font-size:12px;border:1px solid var(--border);padding:4px 9px;border-radius:20px}.toolbar{position:sticky;top:0;background:var(--bg);padding:14px 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap;z-index:1}input[type=search]{flex:1;min-width:200px;padding:10px;background:var(--panel);color:inherit;border:1px solid var(--border);border-radius:8px}button{padding:8px 12px;background:var(--panel);color:inherit;border:1px solid var(--border);border-radius:8px;cursor:pointer}article,.report,.entry{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px 22px;margin:16px 0}article>header{margin-bottom:10px;display:flex;justify-content:space-between;gap:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;font:13px/1.65 ui-monospace,monospace}details{border-left:3px solid var(--border);padding:5px 12px;margin:12px 0}summary{cursor:pointer;font-weight:600}.reasoning{color:var(--muted)}[hidden]{display:none!important}.error{color:#d34848}@media(prefers-color-scheme:dark){:root{--bg:#13151d;--fg:#e1e5f0;--panel:#1b1e29;--border:#303647;--muted:#a1abc1;--accent:#a9a2ff}}`;
const script = `const search=document.querySelector('#search');const tools=document.querySelector('#tools');const reasoning=document.querySelector('#reasoning');function filter(){for(const article of document.querySelectorAll('article'))article.hidden=!article.textContent.toLowerCase().includes(search.value.toLowerCase());for(const part of document.querySelectorAll('.tool'))part.hidden=!tools.checked;for(const part of document.querySelectorAll('.reasoning'))part.hidden=!reasoning.checked;}search.addEventListener('input',filter);tools.addEventListener('change',filter);reasoning.addEventListener('change',filter);document.querySelector('#expand').addEventListener('click',()=>{const list=[...document.querySelectorAll('details')];const open=list.some(d=>!d.open);for(const detail of list)detail.open=open;});`;
export function document(title: string, body: string, live = false, interactive = false): string {
  const hash = createHash('sha256').update(script).digest('base64');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer">${live ? '<meta http-equiv="refresh" content="60">' : ''}<title>${html(title)}</title><style>${css}</style></head><body><main>${body}</main>${interactive ? `<script>${script}</script>` : ''}</body></html>\n`;
}
function pretty(value: unknown) { return html(typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }
export function renderSession(input: unknown): string {
  const s = SessionSnapshotSchema.parse(input);
  const count = s.messages.reduce((n, m) => n + m.parts.filter(p => p.type === 'tool').length, 0);
  let body = `<header><a href="../../../">ToFaRev sessions</a><h1>${html(s.info.title ?? 'Review session')}</h1><p><a href="https://github.com/${html(s.repository)}/commit/${s.head}">${html(s.repository)} · ${s.head.slice(0, 12)}</a></p><p><span class="badge">${s.state}</span> · ${s.messages.length} messages · ${count} tool calls</p><p class="muted">Last snapshot: <time>${s.updatedAt}</time>${s.state === 'running' ? ' · Refreshes every 60 seconds. Publication follows the configured snapshot interval.' : ''}</p><p><a href="session.json" download>Download session JSON</a> · <a href="#transcript">Full transcript</a></p></header>`;
  if (s.report) body += `<section class="report"><h2>Final review</h2><pre>${html(s.report)}</pre></section>`;
  body += '<div class="toolbar"><input id="search" type="search" placeholder="Search messages and tool output" aria-label="Search transcript"><label><input id="tools" type="checkbox" checked> Tools</label><label><input id="reasoning" type="checkbox" checked> Reasoning</label><button id="expand" type="button">Expand / collapse details</button></div><section id="transcript" aria-label="Session transcript">';
  for (const [i, m] of s.messages.entries()) {
    const time = m.info.time as { created?: number } | undefined;
    const timestamp = typeof time?.created === 'number' && Number.isFinite(new Date(time.created).valueOf()) ? new Date(time.created).toISOString() : '';
    body += `<article id="message-${i + 1}"><header><strong>${m.info.role === 'user' ? 'User' : 'Assistant'} · ${i + 1}</strong><time>${timestamp}</time></header>`;
    for (const p of m.parts) {
      if (p.type === 'text') body += `<pre>${html(p.text)}</pre>`;
      else if (p.type === 'reasoning') body += `<details class="reasoning"><summary>Reasoning</summary><pre>${html(p.text)}</pre></details>`;
      else if (p.type === 'tool') {
        const state = Record.parse(p.state ?? {});
        body += `<details class="tool"><summary>${html(p.tool)} · ${html(state.status)}</summary><h3>Input</h3><pre>${pretty(state.input)}</pre><h3>Output</h3><pre>${pretty(state.output ?? state.error ?? '')}</pre><details><summary>Tool metadata</summary><pre>${pretty(p)}</pre></details></details>`;
      } else body += `<details><summary>${html(p.type)}</summary><pre>${pretty(p)}</pre></details>`;
    }
    if (m.info.error) body += `<pre class="error">${pretty(m.info.error)}</pre>`;
    body += `<details><summary>Message metadata</summary><pre>${pretty(m.info)}</pre></details></article>`;
  }
  body += '</section><footer class="muted">Captured by ToFaRev from the local OpenCode session API.</footer>';
  return document(`ToFaRev · ${s.repository}`, body, s.state === 'running', true);
}

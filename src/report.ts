import { FOOTER, marker } from './requests.js';
import { type Finding, type Manifest, type Request, type Result, RequestSchema, ResultSchema, validateLocations } from './types.js';

// Literal text fields: encode Markdown/HTML punctuation before assembling trusted markup.
export function escape(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[&<>"'`|@\[\]()*_#!\\:]/g, c => `&#${c.charCodeAt(0)};`);
}
export function sourceLink(r: Request, f: Finding): string {
  const sha = f.location.revision === 'head' ? r.head : r.mergeBase;
  if (!sha) throw new Error('Missing source revision');
  const encoded = f.location.path.split('/').map(p => encodeURIComponent(p).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)).join('/');
  return `[${escape(f.location.path)}:${f.location.start}-${f.location.end}](https://github.com/${r.repository}/blob/${sha}/${encoded}#L${f.location.start}-L${f.location.end})`;
}

// Grammar v1 is deliberately restricted to GitHub-compatible, non-interactive
// flowcharts and sequence messages. This parser is versioned with the bot, and
// emits only the accepted source; it never executes Mermaid/HTML directives.
export const DIAGRAM_GRAMMAR = 1;
export function diagram(input?: string): string | null {
  if (!input || input.length > 4000) return null;
  const lines = input.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 60) return null;
  const first = lines.shift()!;
  const ids = new Set<string>(); let edges = 0;
  const reserved = /^(end|subgraph|direction|click|style|classdef|class|linkstyle|flowchart|graph|loop|alt|else|par|and|opt|rect|note|activate|deactivate|create|destroy|break|critical|option)$/i;
  if (/^flowchart (TD|TB|LR|RL|BT)$/.test(first)) {
    for (const line of lines) {
      const node = line.match(/^([A-Za-z][A-Za-z0-9_]*)\["([A-Za-z0-9 ,._()/+-]{1,100})"\]$/);
      if (node) { if (reserved.test(node[1]!) || ids.has(node[1]!)) return null; ids.add(node[1]!); continue; }
      const edge = line.match(/^([A-Za-z][A-Za-z0-9_]*) --> ([A-Za-z][A-Za-z0-9_]*)$/);
      if (!edge || !ids.has(edge[1]!) || !ids.has(edge[2]!)) return null; edges++;
    }
  } else if (first === 'sequenceDiagram') {
    for (const line of lines) {
      const participant = line.match(/^participant ([A-Za-z][A-Za-z0-9_]*)(?: as [A-Za-z0-9 ,._()/+-]{1,100})?$/);
      if (participant) { if (reserved.test(participant[1]!) || ids.has(participant[1]!)) return null; ids.add(participant[1]!); continue; }
      const edge = line.match(/^([A-Za-z][A-Za-z0-9_]*)(?:->>|-->>)([A-Za-z][A-Za-z0-9_]*): [A-Za-z0-9 ,._()/+-]{1,150}$/);
      if (!edge || !ids.has(edge[1]!) || !ids.has(edge[2]!)) return null; edges++;
    }
  } else return null;
  return edges ? [first, ...lines].join('\n') : null;
}

export function renderReport(request: Request, result: Result | null, manifest: Manifest | null,
  options: { notes?: string[]; currentHead?: string; maxBytes?: number } = {}): { body: string; request: Request } {
  const r = RequestSchema.parse(request);
  const checked = result && manifest ? validateLocations(ResultSchema.parse(result), manifest) : null;
  const notes = [...new Set([...(options.notes ?? []), ...(checked?.coverage.notes ?? []), ...(manifest?.notes ?? [])])];
  let findings = [...(checked?.findings ?? [])].sort((a, b) => a.priority.localeCompare(b.priority) || a.location.path.localeCompare(b.location.path) || a.location.start - b.location.start);
  const total = findings.length;
  let shownNotes = Math.min(8, notes.length);
  const maxBytes = options.maxBytes ?? 60_000;
  for (;;) {
    const omitted = total - findings.length;
    r.state = !checked ? 'failed' : (!checked.coverage.complete || manifest?.incomplete || options.notes?.length || omitted) ? 'partial' : 'completed';
    let body = `${marker(r)}\n## ToFaRev review — ${r.state}\n\n`;
    if (r.head) body += `Reviewed [${r.head.slice(0, 12)}](https://github.com/${r.repository}/commit/${r.head}) · [Workflow run](${r.runUrl})\n\n`;
    else body += `[Workflow run](${r.runUrl})\n\n`;
    if (options.currentHead && options.currentHead !== r.head) body += '**Newer commits are present; they were not reviewed.**\n\n';
    if (r.state === 'partial') body += '**Partial review. The findings below do not cover all changes.**\n\n';
    if (r.state === 'failed') body += '**Review could not be completed. This is not a clean review.**\n\n';
    body += 'Source inspection only; PR code, tests, and benchmarks were not executed.\n\n';
    if (notes.length) {
      body += notes.slice(0, shownNotes).map(n => `- ${escape(n.slice(0, 250))}`).join('\n') + '\n';
      if (notes.length > shownNotes) body += `- ${notes.length - shownNotes} additional coverage limitations were recorded.\n`;
      body += '\n';
    }
    if (omitted) body += `**${omitted} findings omitted to fit the comment size limit.**\n\n`;
    if (findings.length) {
      body += '| Finding | Location |\n| --- | --- |\n';
      for (const f of findings) body += `| **${f.priority} - ${escape(f.title)}** | ${sourceLink(r, f)} |\n`;
      body += '\n';
      for (const f of findings) {
        body += `<details>\n<summary>${f.priority} - ${escape(f.title)}</summary>\n\n**Location:** ${sourceLink(r, f)}\n\n`;
        for (const [label, content] of [['Problem', f.problem], ['Trigger', f.trigger], ['Impact', f.impact], ['Suggested correction', f.suggestion]]) {
          body += `**${label}:** ${escape(content!)}\n\n`;
        }
        const d = diagram(f.diagram); if (d) body += `\`\`\`mermaid\n${d}\n\`\`\`\n\n`;
        body += '</details>\n\n';
      }
    } else if (checked && !omitted) body += r.state === 'completed' ? 'No actionable findings were found within the reviewed scope.\n\n' : 'No validated findings are available within the incomplete reviewed scope.\n\n';
    body += `---\n${FOOTER}`;
    if (Buffer.byteLength(body) <= maxBytes) return { body, request: r };
    if (findings.length) findings = findings.slice(0, -1);
    else if (shownNotes) shownNotes--;
    else throw new Error('Report metadata exceeds the configured size limit');
  }
}

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Source text for digests. OpenCode's webfetch cannot read PDFs (1.19 decodes
// the bytes as text; 2.x rejects them, and its read tool hands raw PDFs to the
// model, which OpenAI-compatible models cannot use). ToFaRev therefore fetches
// each pick's pdf: link itself and extracts the text with pdf.js. Parsing runs
// in a child process whose environment holds no credentials, because PDFs are
// untrusted input. Links that cannot be read locally can go to Tavily Extract.
export type SourceRequest = { url: string; maxChars: number };
export type SourceResult = { url: string; text?: string; error?: string; via?: 'pdf' | 'tavily' };
export const SourceLimits = {
  maxBytes: 25 * 1024 * 1024, fetchMs: 30_000, maxPages: 60, concurrency: 4, redirects: 4,
  workerMs: 300_000, outputBytes: 16 * 1024 * 1024, tavilyBatch: 20, tavilyMs: 90_000,
} as const;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) ToFaRev/0.1 (+https://github.com/hellt/tofarev)';

// https only, a DNS name, no credentials, no loopback or internal names.
export function safeUrl(raw: string, allowLoopback = false): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  if (allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1') return url;
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')
    || host === 'localhost' || /\.(localhost|internal|local)$/.test(host) || host === 'metadata.google.internal') return null;
  return url;
}

export async function pdfText(data: Uint8Array, maxChars: number): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js 6 has no eval path (isEvalSupported is gone); fonts are not loaded.
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    let text = '';
    for (let n = 1; n <= Math.min(doc.numPages, SourceLimits.maxPages) && text.length < maxChars; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      text += content.items.map(i => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('') + '\n\n';
      page.cleanup();
    }
    return text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
  } finally { await task.destroy(); }
}

export async function fetchPdf(raw: string, allowLoopback = false): Promise<Uint8Array> {
  let url = safeUrl(raw, allowLoopback);
  for (let hop = 0; ; hop++) {
    if (!url) throw new Error('URL not allowed');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(SourceLimits.fetchMs),
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf,*/*;q=0.8' } });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      if (hop >= SourceLimits.redirects) throw new Error('Too many redirects');
      url = safeUrl(new URL(location, url).href, allowLoopback);
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > SourceLimits.maxBytes) throw new Error('PDF exceeds size limit');
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Not a PDF');
    return new Uint8Array(data);
  }
}

export async function readPdfs(requests: SourceRequest[], allowLoopback = false): Promise<SourceResult[]> {
  const out: SourceResult[] = new Array(requests.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(SourceLimits.concurrency, requests.length) }, async () => {
    while (next < requests.length) {
      const i = next++; const { url, maxChars } = requests[i]!;
      try { out[i] = { url, text: await pdfText(await fetchPdf(url, allowLoopback), maxChars), via: 'pdf' }; }
      catch (e) { out[i] = { url, error: e instanceof Error ? e.message.slice(0, 200) : 'PDF could not be read' }; }
    }
  }));
  return out;
}

// The worker inherits nothing but PATH: no inference key, no tokens.
export function workerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin' };
}

function runWorker(requests: SourceRequest[], allowLoopback: boolean): Promise<SourceResult[]> {
  const failed = (error: string) => requests.map(r => ({ url: r.url, error }));
  return new Promise(resolve => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./pdf-worker.js', import.meta.url))],
      { env: workerEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), SourceLimits.workerMs);
    const chunks: Buffer[] = []; let bytes = 0;
    child.stdout.on('data', (d: Buffer) => { bytes += d.length; if (bytes > SourceLimits.outputBytes) child.kill('SIGKILL'); else chunks.push(d); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ requests, allowLoopback }));
    child.on('error', () => { clearTimeout(timer); resolve(failed('PDF worker failed to start')); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const results = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SourceResult[];
        if (code !== 0 || !Array.isArray(results) || results.length !== requests.length) throw new Error('bad output');
        resolve(results.map((r, i) => ({ url: requests[i]!.url, ...(typeof r.text === 'string' ? { text: r.text.slice(0, requests[i]!.maxChars), via: 'pdf' as const } : { error: String(r.error ?? 'PDF could not be read') }) })));
      } catch { resolve(failed('PDF worker failed')); }
    });
  });
}

export async function tavilyExtract(requests: SourceRequest[], key: string, transport: typeof fetch = fetch): Promise<SourceResult[]> {
  const byUrl = new Map<string, SourceResult>();
  for (let i = 0; i < requests.length; i += SourceLimits.tavilyBatch) {
    const batch = requests.slice(i, i + SourceLimits.tavilyBatch);
    try {
      const response = await transport('https://api.tavily.com/extract', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(SourceLimits.tavilyMs),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: batch.map(r => r.url), extract_depth: 'advanced', format: 'text', timeout: 60 }) });
      if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
      const data = await response.json() as { results?: { url?: string; raw_content?: string }[]; failed_results?: { url?: string; error?: string }[] };
      for (const r of data.results ?? []) if (r.url && typeof r.raw_content === 'string' && r.raw_content.trim()) byUrl.set(r.url, { url: r.url, text: r.raw_content, via: 'tavily' });
      for (const r of data.failed_results ?? []) if (r.url && !byUrl.has(r.url)) byUrl.set(r.url, { url: r.url, error: `Tavily: ${String(r.error ?? 'failed').slice(0, 150)}` });
    } catch (e) { for (const r of batch) if (!byUrl.has(r.url)) byUrl.set(r.url, { url: r.url, error: e instanceof Error ? e.message.slice(0, 150) : 'Tavily failed' }); }
  }
  return requests.map(r => {
    const hit = byUrl.get(r.url);
    return hit?.text ? { ...hit, text: hit.text.slice(0, r.maxChars) } : hit ?? { url: r.url, error: 'Tavily returned nothing' };
  });
}

export async function readSources(requests: SourceRequest[], options: { allowLoopback?: boolean; tavilyKey?: string; transport?: typeof fetch } = {}): Promise<SourceResult[]> {
  if (!requests.length) return [];
  const local = await runWorker(requests, options.allowLoopback ?? false);
  const missing = requests.filter((_, i) => !local[i]!.text);
  if (!options.tavilyKey || !missing.length) return local;
  const remote = new Map((await tavilyExtract(missing, options.tavilyKey, options.transport)).map(r => [r.url, r]));
  return local.map(r => r.text ? r : remote.get(r.url)?.text ? remote.get(r.url)! : { url: r.url, error: `${r.error}; ${remote.get(r.url)?.error ?? 'Tavily failed'}` });
}

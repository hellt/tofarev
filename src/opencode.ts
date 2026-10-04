import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { type Config, ENDPOINT, MODEL, apiKey } from './config.js';
import { ResultSchema, type ReviewOutput, ManifestSchema, validateLocations } from './types.js';
import { formatInlineCode, renderSessionReview } from './report.js';
import { shareSession, startSharedSession } from './sharing.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function policyText() { return readFile(path.join(root, 'prompts/containerlab-review.md'), 'utf8'); }
export async function policyHash() { return createHash('sha256').update(await policyText()).digest('hex'); }
export const contract = `First provide a complete, readable Markdown review: a summary table ordered P0-P4, details for each finding (location, problem, trigger, impact, correction), and honest coverage notes. Use headings, complete sentences, and inline code for symbols, filenames, commands, environment variables, and configuration keys. Include a diagram only when useful. Describe the same findings as the JSON.\nThen emit the machine result in one FINAL fenced json block matching this schema, with no text after it:\n${JSON.stringify(z.toJSONSchema(ResultSchema))}\nPriorities: P0 catastrophic/severe security blocker; P1 high-impact merge blocker; P2 correctness/reliability defect; P3 minor defect; P4 optional actionable improvement.\nUse revision 'base' for removed lines (the comparison merge base), 'head' otherwise. Diagrams use plain flowchart edges or sequenceDiagram participants/messages only. Use inline code in JSON text fields when referring to symbols. Use the supplied immutable GitHub link roots in Markdown file references, with URL-encoded paths and #Lstart-Lend anchors. Do not put publishing metadata or URLs in the JSON.`;
export function parseReviewResult(text: string) {
  const blocks = [...text.matchAll(/^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?=\r?\n|$)/gm)];
  const last = blocks.at(-1);
  if (last && text.slice(last.index! + last[0].length).trim()) throw new Error('Result must end with its JSON block');
  return ResultSchema.parse(JSON.parse(last ? last[1]! : text));
}

export function reviewerConfig(c: Config, source: string, system: string, endpoint: string) {
  // With a fresh non-Git working directory OpenCode uses / as its worktree.
  // v1.18.33 read permissions match paths relative to that worktree.
  const access = { '*': 'deny', [`${source.slice(1)}/*`]: 'allow' };
  const permission = { '*': 'deny', read: access, grep: 'allow', glob: 'allow',
    external_directory: { '*': 'deny', [source]: 'allow', [`${source}/*`]: 'allow' } };
  return { $schema: 'https://opencode.ai/config.json', share: c.shareSessions ? 'manual' : 'disabled', autoupdate: false,
    enabled_providers: ['tofarev'], model: `tofarev/${MODEL}`, small_model: `tofarev/${MODEL}`,
    plugin: [], mcp: {}, lsp: false, formatter: false, instructions: [],
    compaction: { auto: true, prune: false }, permission,
    provider: { tofarev: { npm: '@ai-sdk/openai-compatible', name: 'Nebius Token Factory',
      options: { baseURL: endpoint, apiKey: 'local-proxy', timeout: c.limits.durationMs },
      models: { [MODEL]: { name: MODEL, tool_call: true, limit: { context: c.limits.contextTokens, output: c.limits.outputTokens } } } } },
    agent: { tofarev: { mode: 'primary', description: 'Containerlab review only', prompt: system,
      ...(c.limits.turns ? { steps: Math.max(1, c.limits.turns - 2) } : {}), permission }, title: { disable: true }, summary: { disable: true },
      build: { disable: true }, plan: { disable: true }, explore: { disable: true }, general: { disable: true } },
  };
}

// Only the proxy has the real key. It bounds requests and any explicit call cap;
// OpenCode receives a disposable placeholder credential for the loopback endpoint.
export async function inferenceProxy(c: Config, key: string, transport: typeof fetch = fetch) {
  let turns = 0, finalized = false; let failure: string | null = null; const controller = new AbortController();
  const started = Date.now();
  const deadline = setTimeout(() => { failure = 'Reviewer deadline reached.'; controller.abort(); }, c.limits.durationMs);
  const server = createServer(async (req, res) => {
    const reject = (status: number, message: string) => { failure = message; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message } })); };
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') return reject(400, 'Unsupported inference request.');
    const chunks: Buffer[] = []; let bytes = 0;
    try {
      for await (const chunk of req) {
        bytes += chunk.length; chunks.push(chunk);
        // This is a transport bound, not a token count. OpenCode manages the
        // configured token window using provider usage and context compaction.
        if (bytes > c.limits.requestBytes) return reject(400, 'Inference request byte limit exceeded.');
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body.model !== MODEL || !Array.isArray(body.messages)) return reject(400, 'Unexpected inference model or input.');
      turns++;
      if (c.limits.turns !== undefined && turns > c.limits.turns) return reject(400, 'Model turn budget exceeded.');
      const deadlineNear = Date.now() - started >= c.limits.durationMs - Math.min(180_000, c.limits.durationMs / 3);
      if (deadlineNear || (c.limits.turns !== undefined && turns >= Math.max(1, c.limits.turns - 2))) {
        finalized = true;
        delete body.tools; delete body.tool_choice;
        body.messages.push({ role: 'system', content: `The review ${deadlineNear ? 'deadline' : 'call allowance'} is nearly exhausted. Finalize now with the Markdown review followed by JSON, using supported findings already investigated. Do not call tools. Set coverage.complete=false and describe unfinished scope in coverage.notes.\n${contract}` });
      }
      body.max_tokens = Math.min(Number(body.max_tokens) || c.limits.outputTokens, c.limits.outputTokens);
      body.reasoning_effort = c.reasoningEffort;
      delete body.max_completion_tokens;
      const call = turns, callStarted = Date.now();
      console.error(`Token Factory call ${call} started (effort=${c.reasoningEffort}, request=${bytes} bytes).`);
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try { response = await transport(`${ENDPOINT}/chat/completions`, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
        catch { if (controller.signal.aborted || attempt >= 3) return reject(400, 'Token Factory request failed.'); await new Promise(r => setTimeout(r, 250 * 2 ** attempt)); continue; }
        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt < 3 && !controller.signal.aborted) {
            await response.body?.cancel(); await new Promise(r => setTimeout(r, 250 * 2 ** attempt)); continue;
          }
          return reject(400, response.status === 401 || response.status === 403 ? 'Token Factory authentication failed.' : 'Token Factory model request failed.');
        }
        console.error(`Token Factory call ${call} response headers received in ${Math.round((Date.now() - callStarted) / 1000)}s.`);
        res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'application/json' });
        let tail = '', received = false;
        if (response.body) for await (const chunk of response.body) {
          if (!received) { received = true; console.error(`Token Factory call ${call} first data received in ${Math.round((Date.now() - callStarted) / 1000)}s.`); }
          res.write(chunk);
          // [DONE] completes an OpenAI stream even if its HTTP socket stays open.
          if (body.stream) {
            tail += Buffer.from(chunk).toString('utf8');
            if (/(?:^|\n)data: *\[DONE\]\r?\n/.test(tail)) break;
            tail = tail.slice(-128);
          }
        }
        res.end(); console.error(`Token Factory call ${call} completed in ${Math.round((Date.now() - callStarted) / 1000)}s.`); return;
      }
    } catch { if (!res.headersSent) reject(400, 'Inference stream failed.'); else { failure = 'Inference stream failed.'; res.end(); } }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { endpoint: `http://127.0.0.1:${address.port}/v1`, get failure() { return failure; }, get turns() { return turns; }, get finalized() { return finalized; },
    close: async () => { clearTimeout(deadline); controller.abort(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } };
}

export function cliEnvironment(working: string, cfg: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH, XDG_CONFIG_HOME: path.join(working, 'config'), XDG_DATA_HOME: path.join(working, 'data'),
    XDG_CACHE_HOME: path.join(working, 'cache'), XDG_STATE_HOME: path.join(working, 'state'),
    OPENCODE_CONFIG: cfg, OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_PURE: 'true',
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: 'true', OPENCODE_DISABLE_FFF: 'true',
  };
}

export async function runCli(executable: string, working: string, cfg: string, message: string, duration: number, sessionId?: string, endpoint?: string): Promise<{ text: string; failed: boolean; sessionId?: string }> {
  return new Promise(resolve => {
    const child = spawn(executable, ['run', '--pure', '--format', 'json', '--agent', 'tofarev', '--model', `tofarev/${MODEL}`,
      ...(sessionId ? ['--session', sessionId] : []), ...(endpoint ? ['--attach', endpoint] : [])], {
      cwd: working, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: cliEnvironment(working, cfg),
    });
    // v1.18.33 escapes positional prompt arguments. Stdin preserves plain text.
    child.stdin.on('error', () => {}); child.stdin.end(message);
    let pending = '', text = '', bytes = 0, failed = false;
    const stop = () => { failed = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const timer = setTimeout(stop, duration);
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length; if (bytes > 4_000_000) { stop(); return; }
      pending += data.toString();
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const e = JSON.parse(line);
          if (typeof e.sessionID === 'string' && /^ses_[a-zA-Z0-9]+$/.test(e.sessionID)) sessionId = e.sessionID;
          if (e.type === 'step_start') text = '';
          if (e.type === 'text' && typeof e.part?.text === 'string') text += e.part.text;
          if (e.type === 'error') failed = true;
        } catch { /* Non-event CLI startup text is not a review result. */ }
      }
    });
    child.stderr.on('data', () => {}); // Do not expose provider errors or raw source in Actions logs.
    child.on('error', () => { clearTimeout(timer); resolve({ text: '', failed: true }); });
    child.on('close', code => { clearTimeout(timer); resolve({ text, failed: failed || code !== 0, sessionId }); });
  });
}

export async function review(source: string, c: Config, options: { transport?: typeof fetch; executable?: string; key?: string } = {}): Promise<ReviewOutput> {
  source = await realpath(source);
  const key = options.key ?? apiKey();
  const working = await mkdtemp(path.join(os.tmpdir(), 'tofarev-review-'));
  const proxy = await inferenceProxy(c, key, options.transport);
  const started = Date.now();
  let shared: Awaited<ReturnType<typeof startSharedSession>>;
  try {
    const manifest = ManifestSchema.parse(JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8')));
    const cfg = path.join(working, 'opencode.json');
    await mkdir(path.join(working, 'config'), { recursive: true });
    await writeFile(cfg, JSON.stringify(reviewerConfig(c, source, `${await policyText()}\n\n${contract}`, proxy.endpoint)));
    const intro = `Review the read-only PR snapshot at ${source}.\nRead standards.json and its referenced rules, then diff.txt and relevant head/ and base/ files. Track all ${manifest.changed.length} changed paths from the diff. Complete checks for each changed path and relevant callers, tests, docs, and schema before finalizing. Source-only review can be complete without executing tests; disclose that limitation. Use read offsets for truncated output and group independent tool calls. Use glob/grep for surrounding code. Return the trusted result schema.\nHead: ${manifest.head}. Comparison base: ${manifest.mergeBase}. Target base: ${manifest.base}.\nGitHub permalink roots: head=https://github.com/${c.repository}/blob/${manifest.head}/; base=https://github.com/${c.repository}/blob/${manifest.mergeBase}/.\nSnapshot incomplete: ${manifest.incomplete}. The full inventory and omission details are in manifest.json; consult it when needed. ${manifest.incomplete ? 'Report incomplete coverage.' : ''}`;
    const executable = options.executable ?? path.join(root, `node_modules/opencode-${process.platform}-${process.arch}/bin/opencode`);
    let best: ReviewOutput = { result: null, notes: [], failed: true };
    if (c.shareSessions) {
      shared = await startSharedSession(executable, working, cliEnvironment(working, cfg));
      if (shared?.url) console.error(`OpenCode review session: ${shared.url}`);
      else console.error('OpenCode live session link unavailable; review will continue.');
    }
    let sessionId: string | undefined = shared?.sessionId;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = c.limits.durationMs - (Date.now() - started);
      if (remaining <= 0 || proxy.failure) break;
      const run = await runCli(executable, working, cfg, attempt && sessionId
        ? 'Your previous output was invalid. Use your existing investigation, recheck any invalid locations, and return the complete Markdown review followed by a final fenced JSON result matching the system schema. Do not restart the review.'
        : intro, remaining, sessionId, shared?.endpoint);
      sessionId = run.sessionId;
      try {
        const parsed = parseReviewResult(shared ? await shared.resultText() : run.text);
        const validated = validateLocations(parsed, manifest);
        best = { result: formatInlineCode(validated), notes: [], failed: false };
        if (run.failed) best.notes.push('Reviewer execution ended before normal completion.');
        if (validated.findings.length === parsed.findings.length || attempt === 1) break;
      } catch { best.notes.push('Reviewer did not return a valid result.'); }
    }
    if (proxy.failure) best.notes.push(proxy.failure);
    if (proxy.finalized && best.result) best.result.coverage = { complete: false,
      notes: [...best.result.coverage.notes, 'Review finalized before the configured call allowance or deadline; some analysis may be unfinished.'] };
    if (Date.now() - started >= c.limits.durationMs) best.notes.push('Reviewer deadline reached.');
    if (c.shareSessions && sessionId) {
      if (shared && best.result) {
        try { await shared.renderResult(renderSessionReview({ repository: c.repository, head: manifest.head, mergeBase: manifest.mergeBase }, best.result, manifest)); }
        catch { best.notes.push('The shared session final report could not be formatted.'); }
      }
      const sharing = shared ? { url: shared.url, synced: Boolean(await shared.waitForSync()) }
        : await shareSession(executable, working, cliEnvironment(working, cfg), sessionId);
      if (sharing?.url) {
        best.sessionUrl = sharing.url;
        if (!sharing.synced) best.sessionSyncPending = true;
      }
    }
    return best;
  } finally { await shared?.close(); await proxy.close(); await rm(working, { recursive: true, force: true }); }
}

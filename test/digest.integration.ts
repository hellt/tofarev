import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { Limits, WRITTEN_BY, digest } from '../src/digest.js';
import { item, promptText } from './digest.test.js';

// Same stream shape as opencode.integration.ts; importing it would rerun that suite.
const sse = (delta: unknown, finish = 'stop') => {
  const chunk = (d: unknown, f: string | null) => `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1,
    model: 'zai-org/GLM-5.3-Flash', choices: [{ index: 0, delta: d, finish_reason: f }] })}\n\n`;
  return new Response(chunk(delta, null) + chunk({}, finish) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
};

const json = (content: string) => new Response(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: 'zai-org/GLM-5.3-Flash',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
const digestText = (url: string) => `# Netdev 0x1A — Digest\n\n## Core\n\n### Talk number 1: lossless fabric study\n\n*Speaker 1*\n\n- **Links**: [page](${url}), [made up](https://invented.example/paper.pdf)\n- **What**: ENRICHED from the fetched page.\n\n## Themes\n\n- Fabrics.\n`;

test('the writer agent exposes only webfetch, enriches from a program link and returns a checked digest', { timeout: 90_000 }, async () => {
  const page = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body><h1>Talk</h1><p>ENRICHMENT-EVIDENCE: 75K GPUs.</p></body></html>'); });
  await new Promise<void>(r => page.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(page.address() as { port: number }).port}/talk/1.html`;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tofarev-digest-it-'));
  try {
    const file = path.join(dir, 'prompt.md');
    await writeFile(file, promptText(`## Session type: talk\n\n${item(1).replace(/page: \S+/, `page: ${url}`)}\n\n${item(2)}\n\n${item(3)}`));
    const calls: any[] = [];
    const out = await digest(file, config({ limits: { durationMs: 60_000 } }), { key: 'fake-digest-token', today: '2026-10-31', transport: (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); calls.push(body);
      if (calls.length === 1) {
        assert.equal(body.stream, true);
        const system = body.messages.filter((m: any) => m.role === 'system').map((m: any) => JSON.stringify(m.content)).join('\n');
        assert.ok(system.includes('You are helping a product manager.') && system.includes('How ToFaRev runs this prompt'));
        const tools = body.tools.map((t: any) => t.function.name);
        assert.ok(tools.includes('webfetch'), JSON.stringify(tools));
        assert.ok(tools.every((n: string) => ['webfetch', 'invalid'].includes(n)), JSON.stringify(tools));
        assert.ok(JSON.stringify(body.messages).includes('The full program follows.'));
        return sse({ role: 'assistant', tool_calls: [{ index: 0, id: 'fetch_1', type: 'function', function: { name: 'webfetch', arguments: JSON.stringify({ url, format: 'markdown' }) } }] }, 'tool_calls');
      }
      assert.ok(JSON.stringify(body.messages.filter((m: any) => m.role === 'tool')).includes('ENRICHMENT-EVIDENCE'));
      return sse({ role: 'assistant', content: digestText(url) });
    }) as typeof fetch });
    assert.equal(out.failed, false, JSON.stringify(out));
    assert.equal(out.key, 'netdev-0x1a');
    assert.equal(out.stats.mode, 'single-pass');
    assert.equal(out.stats.calls, 2);
    assert.equal(out.stats.linksRemoved, 1);
    assert.ok(out.markdown!.includes(`written_by: ${WRITTEN_BY}`));
    assert.ok(out.markdown!.includes(`[page](${url})`) && !out.markdown!.includes('invented.example'));
    assert.ok(!JSON.stringify(calls).includes('fake-digest-token'));
  } finally { page.close(); await rm(dir, { recursive: true, force: true }); }
});

test('large programs are staged before OpenCode writes, and an empty writer gets one tool-free retry', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tofarev-digest-staged-'));
  try {
    const count = Math.ceil(Limits.singlePassChars / 500) + 100;
    const file = path.join(dir, 'prompt.md');
    await writeFile(file, promptText(`## Session type: talk\n\n${Array.from({ length: count }, (_, i) => item(i + 1, 'q'.repeat(500))).join('\n\n')}`));
    const kinds: string[] = [];
    const out = await digest(file, config({ limits: { durationMs: 60_000 } }), { key: 'fake', today: '2026-10-31', transport: (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const system = String(body.messages[0].content);
      const user = String(body.messages.at(-1).content);
      if (system.includes('stage 1 (shortlist)')) {
        kinds.push('shortlist');
        const ids = [...user.matchAll(/^\[(P\d{4})\]/gm)].map(m => m[1]);
        return json(JSON.stringify({ candidates: ids.slice(0, 15).map(id => ({ id, tier: 'core', why: 'fabric' })) }));
      }
      if (system.includes('stage 2 (selection)')) { kinds.push('select'); return json(JSON.stringify({ selected: [{ id: 'P0001', tier: 'core' }, { id: 'P0002', tier: 'wildcard' }] })); }
      if (body.stream) {
        kinds.push('opencode');
        assert.ok(JSON.stringify(body.messages).includes('pre-selected 2 of the'));
        return sse({ role: 'assistant', content: 'I am unable to write this.' });
      }
      kinds.push('retry');
      assert.ok(system.includes('This attempt has no tools.'));
      return json(digestText('https://netdevconf.info/0x1A/sessions/talk/1.html'));
    }) as typeof fetch });
    assert.equal(out.failed, false, JSON.stringify(out.notes));
    assert.equal(out.stats.mode, 'staged');
    assert.equal(out.stats.selected, 2);
    assert.ok(kinds.filter(k => k === 'shortlist').length >= 2);
    assert.deepEqual(kinds.slice(-3), ['select', 'opencode', 'retry']);
    assert.ok(out.notes.some(n => n.includes('tool-free retry')));
    assert.ok(out.markdown!.includes('[page](https://netdevconf.info/0x1A/sessions/talk/1.html)'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

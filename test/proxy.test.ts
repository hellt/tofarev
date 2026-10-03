import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferenceProxy, runCli } from '../src/opencode.js';
import { config, MODEL, apiKey } from '../src/config.js';
import { cases, score } from '../src/evaluation.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const input = { model: MODEL, messages: [{ role: 'user', content: 'review' }], max_tokens: 999999 };
const send = (endpoint: string, body: unknown = input) => fetch(`${endpoint}/chat/completions`, { method: 'POST', body: JSON.stringify(body) });
test('proxy requires key and fixed model, caps output, retries transient failures and bounds turns', async () => {
  assert.throws(() => apiKey({}), /TOFAREV_API_KEY/);
  let calls = 0;
  const p = await inferenceProxy(config({ limits: { turns: 1 } }), 'secret', (async (url, init) => {
    assert.equal(url, 'https://api.tokenfactory.nebius.com/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret');
    assert.equal(JSON.parse(String(init?.body)).max_tokens, 8192);
    assert.equal(JSON.parse(String(init?.body)).reasoning_effort, 'high');
    if (++calls === 1) return new Response('retry', { status: 503 });
    return new Response('ok');
  }) as typeof fetch);
  try {
    assert.equal(await (await send(p.endpoint, { ...input, reasoning_effort: 'max' })).text(), 'ok'); assert.equal(calls, 2);
    assert.equal((await send(p.endpoint)).status, 400); assert.match(p.failure!, /turn budget/);
  } finally { await p.close(); }
});
test('trusted effort overrides are forwarded on every request', async () => {
  for (const reasoningEffort of ['low', 'max'] as const) {
    const p = await inferenceProxy(config({ reasoningEffort }), 'key', (async (_url, init) => {
      assert.equal(JSON.parse(String(init!.body)).reasoning_effort, reasoningEffort);
      return new Response('ok');
    }) as typeof fetch);
    try { assert.equal((await send(p.endpoint)).status, 200); } finally { await p.close(); }
  }
});
test('authentication, request size and fallback errors are sanitized', async () => {
  for (const [body, transport, message] of [
    [input, async () => new Response('secret provider details', { status: 401 }), 'authentication'],
    [{ ...input, model: 'fallback' }, async () => { throw new Error('should not call'); }, 'Unexpected'],
    [{ ...input, messages: ['x'.repeat(config().limits.requestBytes)] }, async () => { throw new Error('should not call'); }, 'byte limit'],
  ] as const) {
    const p = await inferenceProxy(config(), 'key', transport as typeof fetch);
    try { const response = await send(p.endpoint, body); assert.equal(response.status, 400); const text = await response.text(); assert.match(text, new RegExp(message)); assert.ok(!text.includes('secret')); }
    finally { await p.close(); }
  }
});
test('request bytes are independent of the token window', async () => {
  let calls = 0;
  const p = await inferenceProxy(config(), 'key', (async () => { calls++; return new Response('ok'); }) as typeof fetch);
  try {
    const response = await send(p.endpoint, { ...input, messages: [{ role: 'user', content: 'code '.repeat(40_000) }] });
    assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(p.failure, null);
  } finally { await p.close(); }
});
test('default configuration has no proxy call cap or agent step cap', async () => {
  const { reviewerConfig } = await import('../src/opencode.js');
  assert.equal(reviewerConfig(config(), '/source', '', 'http://127.0.0.1/v1').agent.tofarev.steps, undefined);
  const p = await inferenceProxy(config(), 'key', (async (_url, init) => {
    assert.ok(JSON.parse(String(init!.body)).tools);
    return new Response('ok');
  }) as typeof fetch);
  try {
    for (let i = 0; i < 85; i++) assert.equal((await send(p.endpoint, { ...input, tools: [{ type: 'function' }] })).status, 200);
    assert.equal(p.turns, 85); assert.equal(p.finalized, false); assert.equal(p.failure, null);
  } finally { await p.close(); }
});
test('the final allowance requests JSON without tools instead of discarding investigated findings', async () => {
  const p = await inferenceProxy(config({ limits: { turns: 4 } }), 'key', (async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    if (p.turns === 1) assert.ok(body.tools);
    else { assert.equal(body.tools, undefined); assert.equal(body.tool_choice, undefined); assert.match(body.messages.at(-1).content, /coverage.complete=false/); }
    return new Response('ok');
  }) as typeof fetch);
  try {
    const body = { ...input, tools: [{ type: 'function' }], tool_choice: 'auto' };
    assert.equal((await send(p.endpoint, body)).status, 200); assert.equal(p.finalized, false);
    assert.equal((await send(p.endpoint, body)).status, 200); assert.equal(p.finalized, true);
  } finally { await p.close(); }
});
test('hanging provider obeys deadline and CLI process group is killed', async () => {
  const p = await inferenceProxy(config({ limits: { durationMs: 1000 } }), 'key', ((_u, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('secret abort')));
  })) as typeof fetch);
  try { assert.equal((await send(p.endpoint)).status, 400); assert.ok(p.failure); } finally { await p.close(); }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tofarev-timeout-'));
  try {
    const executable = path.join(dir, 'hang'); await writeFile(executable, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
    const start = Date.now(); const result = await runCli(executable, dir, '/unused', '', 100);
    assert.equal(result.failed, true); assert.ok(Date.now() - start < 3000);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('evaluation scoring counts duplicate findings as false positives and checks severity/coverage', () => {
  assert.equal(cases.length, 10);
  const c = cases.find(c => c.name === 'duplicate-root-causes')!;
  const f = { priority: 'P2' as const, title: 'Division by zero', location: { revision: 'head' as const, path: 'core/ratio.go', start: 2, end: 2 }, problem: 'panic', impact: 'crash', trigger: 'zero', suggestion: 'guard' };
  assert.deepEqual(score(c, { version: 1, findings: [f, f], coverage: { complete: true, notes: [] } }), { name: c.name, expected: 1, matched: 1, missed: 0, falsePositives: 1, correctSeverity: 1, completeCoverage: true });
  assert.equal(score(c, null).missed, 1);
});

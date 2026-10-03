import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { reviewerConfig, cliEnvironment, inferenceProxy, runCli } from '../src/opencode.js';
import { shareSession } from '../src/sharing.js';

test('native session sharing waits for full sync and never publishes runner credentials', { timeout: 60_000 }, async () => {
  const working = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tofarev-share-test-')));
  const source = path.join(working, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'evidence.go'), 'package main\n// share-source-evidence\n');
  let data: any[] = [], denied = false, syncs = 0;
  const backend = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk.toString();
    res.setHeader('content-type', 'application/json');
    if (denied) { res.writeHead(503); res.end('{}'); return; }
    if (req.url === '/api/share') res.end(JSON.stringify({ id: 'test1234', secret: 'delete-only-secret', url: 'https://opncd.ai/share/test1234' }));
    else if (req.url === '/api/share/test1234/sync') { data = JSON.parse(body).data; syncs++; res.end('{}'); }
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  let calls = 0;
  const c = config({ shareSessions: true, limits: { durationMs: 30_000 } });
  const proxy = await inferenceProxy(c, 'real-inference-secret', (async () => {
    const delta = ++calls === 1 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read_1', type: 'function', function: {
      name: 'read', arguments: JSON.stringify({ filePath: `${source}/evidence.go` }),
    } }] } : { role: 'assistant', content: '{"version":1,"findings":[],"coverage":{"complete":true,"notes":[]}}' };
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1,
      model: 'zai-org/GLM-5.3-Flash', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    return new Response(chunk(delta, null) + chunk({}, calls === 1 ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch);
  try {
    const cfg = path.join(working, 'opencode.json');
    await writeFile(cfg, JSON.stringify({ ...reviewerConfig(c, source, 'Inspect the read-only source and return JSON.', proxy.endpoint), enterprise: { url: backendUrl } }));
    const executable = fileURLToPath(new URL(`../../node_modules/opencode-${process.platform}-${process.arch}/bin/opencode`, import.meta.url));
    const env = cliEnvironment(working, cfg);
    const run = await runCli(executable, working, cfg, 'Review the source.', 20_000);
    assert.equal(run.failed, false); assert.ok(run.sessionId); assert.equal(JSON.parse(run.text).version, 1);
    let polls = 0, observedIncomplete = false;
    const transport = (async (url, init) => {
      if (!String(url).startsWith('https://opncd.ai/')) return fetch(url, init);
      polls++;
      if (data.length && !observedIncomplete) { observedIncomplete = true; return Response.json(data.filter(d => d.type !== 'part')); }
      return Response.json(data);
    }) as typeof fetch;
    assert.equal(await shareSession(executable, working, env, run.sessionId!, transport, 10_000), 'https://opncd.ai/share/test1234');
    assert.ok(polls >= 2); assert.equal(observedIncomplete, true); assert.ok(syncs);
    const transcript = JSON.stringify(data);
    assert.ok(transcript.includes('share-source-evidence')); assert.ok(transcript.includes('coverage'));
    for (const secret of ['real-inference-secret', 'delete-only-secret', 'TOFAREV_GITHUB_TOKEN']) assert.ok(!transcript.includes(secret));
    assert.equal(await shareSession(executable, working, env, run.sessionId!, (async (url, init) =>
      String(url).startsWith('https://opncd.ai/') ? Response.json([]) : fetch(url, init)) as typeof fetch, 2500), undefined);
    denied = true;
    assert.equal(await shareSession(executable, working, env, run.sessionId!, transport, 10_000), undefined);
  } finally {
    await proxy.close(); backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve()));
    await rm(working, { recursive: true, force: true });
  }
});

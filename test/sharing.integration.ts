import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { reviewerConfig, cliEnvironment, inferenceProxy, runCli, parseReviewResult } from '../src/opencode.js';
import { renderSessionReview } from '../src/report.js';
import { shareSession, startSharedSession } from '../src/sharing.js';

test('native session sharing waits for full sync and never publishes runner credentials', { timeout: 60_000 }, async () => {
  const working = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tofarev-share-test-')));
  const source = path.join(working, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'evidence.go'), 'package main\n// share-source-evidence\n');
  let data: any[] = [], denied = false, syncs = 0, shares = 0;
  const backend = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk.toString();
    res.setHeader('content-type', 'application/json');
    if (denied) { res.writeHead(503); res.end('{}'); return; }
    if (req.url === '/api/share') { shares++; res.end(JSON.stringify({ id: 'test1234', secret: 'delete-only-secret', url: 'https://opncd.ai/share/test1234' })); }
    else if (req.url === '/api/share/test1234/sync') {
      for (const item of JSON.parse(body).data) {
        const index = data.findIndex(d => d.type === item.type && d.data.id === item.data.id);
        if (index < 0) data.push(item); else data[index] = item;
      }
      syncs++; res.end('{}');
    }
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  let calls = 0;
  const c = config({ shareSessions: true, limits: { durationMs: 30_000 } });
  const proxy = await inferenceProxy(c, 'real-inference-secret', (async () => {
    const delta = ++calls === 1 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read_1', type: 'function', function: {
      name: 'read', arguments: JSON.stringify({ filePath: `${source}/evidence.go` }),
    } }] } : { role: 'assistant', content: '# Review\n\nNo findings.\n\n```json\n{"version":1,"findings":[],"coverage":{"complete":true,"notes":[]}}\n```' };
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1,
      model: 'zai-org/GLM-5.3-Flash', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    return new Response(chunk(delta, null) + chunk({}, calls === 1 ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch);
  try {
    const cfg = path.join(working, 'opencode.json');
    await writeFile(cfg, JSON.stringify({ ...reviewerConfig(c, source, 'Inspect the read-only source and return JSON.', proxy.endpoint), enterprise: { url: backendUrl } }));
    const executable = fileURLToPath(new URL(`../../node_modules/opencode-${process.platform}-${process.arch}/bin/opencode`, import.meta.url));
    const env = cliEnvironment(working, cfg);
    let polls = 0, observedIncomplete = false, stale: any[] | undefined;
    const transport = (async (url, init) => {
      if (!String(url).startsWith('https://opncd.ai/')) return fetch(url, init);
      polls++;
      if (stale) { const prior = stale; stale = undefined; return Response.json(prior); }
      if (data.length && !observedIncomplete) { observedIncomplete = true; return Response.json(data.filter(d => d.type !== 'part')); }
      return Response.json(data);
    }) as typeof fetch;
    const shared = await startSharedSession(executable, working, env, transport, 10_000);
    assert.ok(shared); assert.equal(shared.url, 'https://opncd.ai/share/test1234');
    assert.equal(calls, 0); assert.ok(data.some(d => d.type === 'session'));
    let run;
    try {
      run = await runCli(executable, working, cfg, 'Review the source.', 20_000, shared.sessionId, shared.endpoint);
      assert.equal(run.failed, false); assert.equal(run.sessionId, shared.sessionId); assert.equal(parseReviewResult(await shared.resultText()).version, 1);
      assert.equal(await shared.waitForSync(), shared.url);
      assert.equal(shares, 1);
      const result = parseReviewResult(await shared.resultText());
      const markdown = renderSessionReview({ repository: 'srl-labs/containerlab', head: 'a'.repeat(40), mergeBase: 'b'.repeat(40) }, result);
      stale = structuredClone(data);
      await shared.renderResult(markdown);
      assert.equal(await shared.resultText(), markdown);
      const before = polls;
      // Serve existing part IDs with stale content once; sync must compare content.
      const synced = shared.waitForSync();
      assert.equal(await synced, shared.url);
      assert.ok(polls >= before + 2);
      assert.ok(data.some(d => d.type === 'part' && d.data.text === markdown));
    } finally { await shared.close(); }
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

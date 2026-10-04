import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture } from './source.test.js';
import { event } from './requests.test.js';
import { sse } from './opencode.integration.js';
import { config } from '../src/config.js';
import { GitHub } from '../src/github.js';
import { git } from '../src/source.js';
import { prepare, progress, publish } from '../src/pipeline.js';
import { review } from '../src/opencode.js';

test('offline end-to-end: admission, immutable snapshot, OpenCode/model, validation, trusted publication and recovery', { timeout: 60_000 }, async () => {
  const f = await fixture(); const work = await mkdtemp(path.join(os.tmpdir(), 'tofarev-e2e-'));
  let comment: any = null, calls = 0, posts = 0, rejectPublication = false, moved = false;
  const e = event();
  const api = new GitHub('publisher-secret', (async (url, init) => {
    calls++; const u = String(url), method = init?.method;
    if (u.endsWith('/issues/comments/7')) return Response.json({ ...e.comment, issue_url: 'https://api.github.com/repos/srl-labs/containerlab/issues/42' });
    if (u.includes('/pulls/')) return Response.json({ state: 'open', head: { sha: moved ? 'f'.repeat(40) : f.request.head }, base: { sha: f.request.base } });
    if (method === 'POST') { posts++; comment = { id: 8, user: { type: 'Bot', login: 'tofarev[bot]' }, ...JSON.parse(String(init?.body)) }; return Response.json(comment); }
    if (method === 'PATCH') { if (rejectPublication) return new Response('publisher-secret', { status: 403 }); comment.body = JSON.parse(String(init?.body)).body; return Response.json(comment); }
    if (u.endsWith('/issues/comments/8')) return Response.json(comment);
    return Response.json(comment ? [comment] : []);
  }) as typeof fetch, async () => {});
  try {
    git(f.dir, ['update-ref', 'refs/pull/42/head', f.request.head!]);
    assert.equal(await prepare(event('intruder'), 'issue_comment', config(), api, work, f.request.runUrl), null); assert.equal(calls, 0);
    const p = await prepare(e, 'issue_comment', config(), api, work, f.request.runUrl, `file://${f.dir}/.git`);
    assert.ok(p?.ready); assert.equal(p.manifest?.incomplete, true); // unsupported changed files disclosed
    const session = { url: 'https://opncd.ai/share/test1234' };
    assert.equal((await progress(p, session, config({ shareSessions: true }), api)).skipped, false);
    assert.ok(comment.body.indexOf('[Live OpenCode session]') < comment.body.indexOf('[Workflow run]'));
    await assert.rejects(progress(p, { url: 'https://attacker.example/session' }, config({ shareSessions: true }), api));
    let modelCalls = 0;
    const out = await review(path.join(work, 'source'), config({ limits: { durationMs: 30_000 } }), { key: 'inference-secret', transport: (async () => {
      modelCalls++;
      return sse({ role: 'assistant', content: JSON.stringify({ version: 1, findings: [{ priority: 'P4', title: 'Fixture finding', location: { revision: 'head', path: 'new.go', start: 1, end: 1 }, problem: 'fixture evidence', trigger: 'fixture trigger', impact: 'fixture cost', suggestion: 'fixture fix' }], coverage: { complete: true, notes: [] } }) });
    }) as typeof fetch });
    assert.equal(modelCalls, 1); assert.ok(out.result);
    moved = true;
    rejectPublication = true;
    await assert.rejects(publish(p, out, config(), api), e => e instanceof Error && !e.message.includes('publisher-secret'));
    rejectPublication = false;
    assert.equal((await publish(p, out, config(), api)).state, 'partial');
    assert.match(comment.body, /Newer commits/); assert.match(comment.body, /<details>/); assert.match(comment.body, /Powered by/);
    assert.ok(comment.body.includes(`/blob/${f.request.head}/new.go#L1-L1`));
    assert.equal(await prepare(e, 'issue_comment', config(), api, work, f.request.runUrl, `file://${f.dir}/.git`), null); assert.equal(posts, 1);
    assert.equal((await publish(p, out, config(), api)).skipped, true);
    assert.equal((await progress(p, session, config({ shareSessions: true }), api)).skipped, true);
    // Restore the trusted running marker to test malformed/missing untrusted results.
    const { statusBody } = await import('../src/requests.js');
    comment.body = statusBody(p.request, 'Running');
    assert.equal((await publish(p, { ...out, repository: 'attacker/repo' }, config(), api)).state, 'failed');
    assert.match(comment.body, /not a clean review/);
    comment.body = statusBody(p.request, 'Running');
    assert.equal((await publish(p, null, config(), api)).state, 'failed');
    comment.body = statusBody(p.request, 'Running');
    const providerFailure = await review(path.join(work, 'source'), config({ limits: { durationMs: 10_000 } }), { key: 'bad-key', transport: (async () => new Response('private provider details', { status: 401 })) as typeof fetch });
    assert.equal(providerFailure.failed, true);
    assert.equal((await publish(p, providerFailure, config(), api, 'failure')).state, 'failed');
    assert.ok(!comment.body.includes('private provider details'));
    comment.body = statusBody(p.request, 'Running');
    assert.equal((await publish(p, out, config(), api, 'failure')).state, 'partial');
    assert.match(comment.body, /Reviewer job did not complete successfully/);
    // The final artifact can lose its share URL after a sync outage or crash.
    comment.body = statusBody(p.request, 'Running', session.url);
    assert.equal((await publish(p, out, config({ shareSessions: true }), api)).state, 'partial');
    assert.ok(comment.body.includes(session.url));
    assert.match(comment.body, /Final report synchronization could not be confirmed/);
    assert.match(comment.body, /<details>/);
    assert.ok(!comment.body.includes('session link unavailable'));
    comment.body = statusBody(p.request, 'Running', session.url);
    assert.equal((await publish(p, null, config({ shareSessions: true }), api)).state, 'failed');
    assert.ok(comment.body.includes(session.url));
    // A sharing outage does not make complete source coverage partial.
    comment.body = statusBody(p.request, 'Running', session.url);
    const complete = { ...p, manifest: { ...p.manifest!, incomplete: false } };
    assert.equal((await publish(complete, out, config({ shareSessions: true }), api)).state, 'completed');
    assert.ok(comment.body.includes(session.url));
    comment.body = statusBody(p.request, 'Running', session.url);
    assert.equal((await publish(complete, { ...out, sessionUrl: session.url, sessionSyncPending: true }, config({ shareSessions: true }), api)).state, 'completed');
    assert.ok(comment.body.includes(session.url));
    const tampered = { ...p, request: { ...p.request, repository: 'attacker/repo' } };
    await assert.rejects(publish(tampered, out, config(), api), /mismatch/);
  } finally { await rm(f.dir, { recursive: true, force: true }); await rm(work, { recursive: true, force: true }); }
});

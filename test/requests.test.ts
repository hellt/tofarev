import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { GitHub } from '../src/github.js';
import { admit, beginRequest, marker, parseMarker, publishedSessionUrl } from '../src/requests.js';
import type { Request } from '../src/types.js';

export function event(user = 'hellt'): any {
  return { action: 'created', repository: { id: 290960521, full_name: 'srl-labs/containerlab' },
    issue: { number: 42, pull_request: {} }, comment: { id: 7, body: '/tofarev review', user: { login: user, type: 'User' } } };
}
export const request: Request = { version: 1, key: '290960521:7', repository: 'srl-labs/containerlab', repositoryId: 290960521,
  pr: 42, triggerId: 7, head: 'a'.repeat(40), base: 'b'.repeat(40), mergeBase: 'c'.repeat(40),
  policy: 'd'.repeat(64), runUrl: 'https://github.com/srl-labs/containerlab/actions/runs/1', state: 'running' };
test('admission uses comment identity and exact command, never sender or PR config', () => {
  for (const name of config().allowedUsers) assert.ok(admit(event(name), 'issue_comment', config()));
  assert.equal(admit(event('other'), 'issue_comment', config()), null);
  for (const edit of [(e: any) => e.comment.body = 'quote /tofarev review', (e: any) => e.action = 'edited',
    (e: any) => delete e.issue.pull_request, (e: any) => e.repository.id++, (e: any) => e.repository.full_name = 'other/repo',
    (e: any) => e.comment.user.type = 'Bot']) {
    const e = event(); edit(e); assert.equal(admit(e, 'issue_comment', config()), null);
  }
  assert.equal(admit(event(), 'pull_request_review_comment', config()), null);
  const e = event(); e.comment.body = ' \n/tofarev review\n '; assert.ok(admit(e, 'issue_comment', config()));
});
test('status markers require the bot author and expected request identity', () => {
  const comment = { id: 8, user: { type: 'Bot', login: 'tofarev[bot]' }, body: marker(request) };
  const a = admit(event(), 'issue_comment', config())!;
  assert.deepEqual(parseMarker(comment, config(), a), request);
  assert.equal(parseMarker({ ...comment, user: { type: 'User', login: 'hellt' } }, config(), a), null);
  assert.equal(parseMarker(comment, config(), { ...a, key: '290960521:8' }), null);
});
test('completed request avoids PR resolution and preserves report', async () => {
  const calls: string[] = [];
  const api = new GitHub('secret', (async (url: string) => {
    calls.push(url);
    return Response.json(url.includes('/issues/comments/7') ? { ...event().comment, issue_url: 'https://api.github.com/repos/srl-labs/containerlab/issues/42' } :
      [{ id: 8, user: { type: 'Bot', login: 'tofarev[bot]' }, body: marker({ ...request, state: 'completed' }) }]);
  }) as typeof fetch);
  const result = await beginRequest(api, config(), admit(event(), 'issue_comment', config())!, request.policy, request.runUrl);
  assert.equal(result?.skip, true); assert.equal(calls.length, 2);
});
test('ambiguous creation is recovered without duplicate POST and transient GET retries are bounded', async () => {
  let created = false, posts = 0, gets = 0;
  const api = new GitHub('do-not-leak', (async (url: string, init: RequestInit) => {
    if (url.includes('/issues/comments/7')) return Response.json({ ...event().comment, issue_url: 'https://api.github.com/repos/srl-labs/containerlab/issues/42' });
    if (url.includes('/pulls/')) { gets++; if (gets === 1) return new Response('', { status: 500 }); return Response.json({ state: 'open', head: { sha: request.head }, base: { sha: request.base } }); }
    if (init.method === 'POST') { posts++; created = true; throw new Error('lost response do-not-leak'); }
    return Response.json(created ? [{ id: 8, user: { type: 'Bot', login: 'tofarev[bot]' }, body: marker(request) }] : []);
  }) as typeof fetch, async () => {});
  assert.equal((await beginRequest(api, config(), admit(event(), 'issue_comment', config())!, request.policy, request.runUrl))?.commentId, 8);
  assert.equal(posts, 1); assert.equal(gets, 2);
  let retries = 0;
  const broken = new GitHub('secret', (async () => { retries++; throw new Error('secret'); }) as typeof fetch, async () => {});
  await assert.rejects(broken.pull('srl-labs/containerlab', 1), e => e instanceof Error && !e.message.includes('secret'));
  assert.equal(retries, 4);
});

test('recovery preserves source revision, paginates comments, and closed PRs fail without inference', async () => {
  for (const state of ['open', 'closed']) {
    let update: any;
    const seen: string[] = [];
    const api = new GitHub('secret', (async (url: string, init: RequestInit) => {
      seen.push(url);
      if (url.includes('/issues/comments/7')) return Response.json({ ...event().comment, issue_url: 'https://api.github.com/repos/srl-labs/containerlab/issues/42' });
      if (new URL(url).searchParams.get('page') === '1') return Response.json(Array.from({ length: 100 }, (_, id) => ({ id, body: 'unrelated', user: { type: 'User', login: 'other' } })));
      if (new URL(url).searchParams.get('page') === '2') return Response.json([{ id: 8, body: marker({ ...request, state: 'failed' }), user: { type: 'Bot', login: 'tofarev[bot]' } }]);
      if (url.includes('/pulls/')) return Response.json({ state, head: { sha: 'e'.repeat(40) }, base: { sha: 'f'.repeat(40) } });
      update = JSON.parse(String(init.body)); return Response.json({ id: 8 });
    }) as typeof fetch);
    const result = await beginRequest(api, config(), admit(event(), 'issue_comment', config())!, request.policy, request.runUrl);
    assert.equal(result?.request.head, request.head);
    assert.equal(result?.skip, state === 'closed');
    assert.ok(seen.some(x => x.includes('page=2')));
    assert.match(update.body, state === 'closed' ? /closed or unavailable/ : /queued/);
  }
});

test('published session links accept only the fixed status label and OpenCode domain', () => {
  assert.equal(publishedSessionUrl('[Live OpenCode session](https://opncd.ai/share/test1234)'), 'https://opncd.ai/share/test1234');
  assert.equal(publishedSessionUrl('[Live OpenCode session](https://evil.example/session)'), undefined);
  assert.equal(publishedSessionUrl('[Other session](https://opncd.ai/share/test1234)'), undefined);
});

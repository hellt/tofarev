import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { SessionSnapshotSchema, renderSession } from '../src/session.js';
import { allowedSessionUrl, publishSession, sessionPath, writeSessionSite } from '../src/pages.js';

const snapshot = { version: 1, repository: 'srl-labs/containerlab', head: 'a'.repeat(40), updatedAt: '2026-10-18T12:00:00.000Z', state: 'running',
  info: { id: 'ses_test123', title: 'Test review' }, messages: [{ info: { role: 'assistant', tokens: { input: 3 } }, parts: [
    { type: 'reasoning', text: 'Check </script><script>alert(1)</script>' },
    { type: 'text', text: '<img src=x onerror=alert(1)> final review' },
    { type: 'tool', tool: '<script>read</script>', state: { status: 'completed', input: { filePath: 'head/test.go' }, output: 'tool-evidence <iframe>' } },
  ] }], report: 'Validated final review' };

test('session HTML includes the transcript, escapes hostile text, and refreshes only running sessions', () => {
  const rendered = renderSession(snapshot);
  for (const value of ['tool-evidence', 'head/test.go', 'Check', 'final review', 'tokens', 'Validated final review', 'Download session JSON']) assert.ok(rendered.includes(value));
  assert.ok(!rendered.includes('<script>alert')); assert.ok(!rendered.includes('<img src=x'));
  assert.ok(!rendered.includes('<iframe>')); assert.ok(rendered.includes('&lt;script&gt;'));
  assert.match(rendered, /Content-Security-Policy/); assert.match(rendered, /http-equiv="refresh"/);
  assert.ok(!renderSession({ ...snapshot, state: 'completed' }).includes('http-equiv="refresh"'));
  assert.equal(SessionSnapshotSchema.safeParse({ ...snapshot, messages: [{ info: { role: 'system' }, parts: [] }] }).success, false);
  assert.throws(() => sessionPath(1, '../bad', '1'));
  const c = config();
  assert.equal(allowedSessionUrl('https://hellt.github.io/tofarev/sessions/290960521/123-1/', c), true);
  for (const url of ['https://evil.github.io/tofarev/sessions/290960521/123-1/', 'https://hellt.github.io/other/sessions/290960521/123-1/', 'https://hellt.github.io/tofarev/sessions/123/123-1/', 'https://evil.example/']) assert.equal(allowedSessionUrl(url, c), false);
});

test('concurrent Pages pushes preserve both sessions, update snapshots in place, and keep the deployment workflow', { timeout: 30_000 }, async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'tofarev-pages-test-'));
  const run = promisify(execFile);
  const git = (...args: string[]) => run('git', args, { cwd: work });
  try {
    const remote = path.join(work, 'remote.git'), seed = path.join(work, 'seed');
    await git('init', '--bare', '--initial-branch=gh-pages', remote);
    await git('init', '--initial-branch=gh-pages', seed);
    await mkdir(path.join(seed, '.github/workflows'), { recursive: true });
    await writeFile(path.join(seed, '.github/workflows/pages.yml'), 'workflow-preserved');
    await git('-C', seed, 'add', '.');
    await git('-C', seed, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Seed');
    await git('-C', seed, 'push', remote, 'HEAD:gh-pages');
    const c = config({ shareSessions: true });
    const options = { fetchUrl: remote, pushUrl: remote };
    const values = await Promise.all([publishSession(snapshot, c, '123', '1', '', options), publishSession(snapshot, c, '456', '1', '', options)]);
    assert.match(values[0]!.url, /123-1\/$/);
    const catalog = JSON.parse((await git('--git-dir', remote, 'show', 'gh-pages:index.json')).stdout);
    assert.equal(catalog.length, 2);
    await publishSession({ ...snapshot, state: 'completed', updatedAt: '2026-10-18T12:01:00.000Z' }, c, '123', '1', '', options);
    const saved = JSON.parse((await git('--git-dir', remote, 'show', 'gh-pages:sessions/290960521/123-1/session.json')).stdout);
    assert.equal(saved.state, 'completed'); assert.equal(saved.messages[0].parts[2].state.output, 'tool-evidence <iframe>');
    assert.equal((await git('--git-dir', remote, 'show', 'gh-pages:.github/workflows/pages.yml')).stdout, 'workflow-preserved');
    await assert.rejects(publishSession(snapshot, config(), '1', '1', '', options), /disabled/);
    await assert.rejects(publishSession({ ...snapshot, repository: 'attacker/repo' }, c, '1', '1', '', options), /mismatch/);
    await assert.rejects(writeSessionSite(seed, '../escape/', snapshot), /destination/);
    await writeSessionSite(seed, 'sessions/290960521/123-1/', snapshot);
    assert.ok((await readFile(path.join(seed, 'index.html'), 'utf8')).includes('123-1/'));
  } finally { await rm(work, { recursive: true, force: true }); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git, snapshot, changedFiles, fetchSource } from '../src/source.js';
import { config, Rules } from '../src/config.js';
import type { Request } from '../src/types.js';

export async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tofarev-git-'));
  git(dir, ['init', '-b', 'main']);
  const put = async (p: string, text: string | Buffer) => { await mkdir(path.dirname(path.join(dir, p)), { recursive: true }); await writeFile(path.join(dir, p), text); };
  const commit = () => { git(dir, ['add', '.']); git(dir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture']); return git(dir, ['rev-parse', 'HEAD']).toString().trim(); };
  await put('old.go', 'package main\n// stable content for rename\n'); await put('removed.go', 'package main\n');
  for (const rule of Rules) await put(rule, 'trusted base rule');
  const base = commit();
  await rename(path.join(dir, 'old.go'), path.join(dir, 'renamed.go'));
  await rm(path.join(dir, 'removed.go')); await put('new.go', 'package main\n// changed\n');
  await put('docs/é space.md', 'read me\n'); await put('empty.go', ''); await put('binary', Buffer.from([0, 1]));
  await put('large.txt', 'x'.repeat(1000)); await put('lfs', 'version https://git-lfs.github.com/spec/v1\noid sha256:abc');
  await put(Rules[0], 'PR tries to override policy'); await symlink('/etc/passwd', path.join(dir, 'escape'));
  git(dir, ['update-index', '--add', '--cacheinfo', `160000,${base},vendor/submodule`]);
  const head = commit();
  const request: Request = { version: 1, key: '290960521:7', repository: 'srl-labs/containerlab', repositoryId: 290960521,
    pr: 42, triggerId: 7, head, base, mergeBase: null, policy: 'd'.repeat(64), runUrl: 'https://github.com/srl-labs/containerlab/actions/runs/1', state: 'running' };
  return { dir, request, put, commit };
}
test('source snapshots preserve revision links and never materialize symlinks or unsupported content', async () => {
  const f = await fixture(); const dest = await mkdtemp(path.join(os.tmpdir(), 'tofarev-source-'));
  try {
    const m = await snapshot(f.dir, dest, f.request, config({ limits: { blobBytes: 500 } }));
    assert.equal(m.mergeBase, f.request.base); assert.equal(m.incomplete, true);
    assert.ok(m.changed.some(c => c.path === 'renamed.go' && c.oldPath === 'old.go'));
    assert.ok(m.files.some(x => x.revision === 'base' && x.path === 'removed.go' && x.lines === 1));
    assert.ok(m.files.some(x => x.path === 'empty.go' && x.lines === 0));
    for (const p of ['escape', 'binary', 'large.txt', 'lfs', 'vendor/submodule']) assert.ok(!m.files.some(x => x.revision === 'head' && x.path === p));
    assert.ok(m.files.some(x => x.path === 'docs/é space.md'));
    const rules = JSON.parse(await readFile(path.join(dest, 'standards.json'), 'utf8'));
    assert.equal(await readFile(path.join(dest, rules[0].file), 'utf8'), 'trusted base rule'); assert.equal(rules[0].revision, f.request.base);
    assert.throws(() => changedFiles(Buffer.from('A\0../../bad\0')));
    assert.throws(() => changedFiles(Buffer.from('A\0.git/config\0')));
  } finally { await rm(f.dir, { recursive: true, force: true }); await rm(dest, { recursive: true, force: true }); }
});
test('snapshot and diff budgets report omissions and missing rules', async () => {
  const f = await fixture(); const dest = await mkdtemp(path.join(os.tmpdir(), 'tofarev-budget-'));
  try {
    const m = await snapshot(f.dir, dest, { ...f.request, base: f.request.head }, config({ limits: { snapshotBytes: 1, diffBytes: 1 } }));
    assert.ok(m.notes.length > 0); assert.equal(m.files.length, 2); // the empty file costs no bytes in either snapshot
  } finally { await rm(f.dir, { recursive: true, force: true }); await rm(dest, { recursive: true, force: true }); }
});

test('fetch uses recorded commits even if the PR ref moves, and deepens history for merge base', async () => {
  const f = await fixture(); const fetched = await mkdtemp(path.join(os.tmpdir(), 'tofarev-fetch-'));
  try {
    const originalHead = f.request.head!;
    for (let i = 0; i < 70; i++) git(f.dir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', `history ${i}`]);
    const later = git(f.dir, ['rev-parse', 'HEAD']).toString().trim();
    git(f.dir, ['update-ref', 'refs/pull/42/head', later]);
    await fetchSource(fetched, { ...f.request, head: later }, `file://${f.dir}/.git`);
    assert.equal(git(fetched, ['merge-base', f.request.base!, later]).toString().trim(), f.request.base);
    const separate = await mkdtemp(path.join(os.tmpdir(), 'tofarev-race-'));
    try {
      await fetchSource(separate, f.request, `file://${f.dir}/.git`);
      assert.equal(git(separate, ['rev-parse', `${originalHead}^{commit}`]).toString().trim(), originalHead);
    } finally { await rm(separate, { recursive: true, force: true }); }
  } finally { await rm(f.dir, { recursive: true, force: true }); await rm(fetched, { recursive: true, force: true }); }
});

test('missing recorded-base standards and long changed lines make coverage partial', async () => {
  const f = await fixture(); const dest = await mkdtemp(path.join(os.tmpdir(), 'tofarev-rules-'));
  try {
    await rm(path.join(f.dir, Rules[0])); const base = f.commit();
    await f.put('long.go', '// ' + 'x'.repeat(2100) + '\n'); const head = f.commit();
    const m = await snapshot(f.dir, dest, { ...f.request, base, head }, config());
    assert.equal(m.incomplete, true);
    assert.ok(m.notes.some(n => n.includes('Repository review rule unavailable')));
    assert.ok(m.notes.some(n => n.includes('Long lines in head:long.go')));
    const index = await readFile(path.join(dest, 'manifest.json'), 'utf8');
    assert.ok(index.split('\n').length > 10);
  } finally { await rm(f.dir, { recursive: true, force: true }); await rm(dest, { recursive: true, force: true }); }
});

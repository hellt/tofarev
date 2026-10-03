import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Config, Rules } from './config.js';
import { type Changed, type Manifest, type Request, RelativePath, Sha } from './types.js';

export function git(dir: string, args: string[], maxBuffer = 12 * 1024 * 1024): Buffer {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null',
    '-c', 'diff.external=', '-C', dir, ...args], { maxBuffer, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } });
}
export async function fetchSource(dir: string, request: Request, fixtureRemote?: string) {
  if (!request.head || !request.base) throw new Error('Missing PR revision');
  await mkdir(dir, { recursive: true }); git(dir, ['init', '--bare']);
  const url = fixtureRemote ?? `https://github.com/${request.repository}.git`;
  git(dir, ['fetch', '--no-tags', '--depth=64', url, `${request.base}:refs/tofarev/base`, `refs/pull/${request.pr}/head:refs/tofarev/head`]);
  // The ref may move between API resolution and fetch. Fetch the recorded object,
  // never silently review the newer ref. Full history is needed if the merge base is older.
  git(dir, ['fetch', '--no-tags', url, request.head]);
  git(dir, ['cat-file', '-e', `${Sha.parse(request.head)}^{commit}`]);
  git(dir, ['cat-file', '-e', `${Sha.parse(request.base)}^{commit}`]);
  try { git(dir, ['merge-base', request.base, request.head]); }
  catch { git(dir, ['fetch', '--no-tags', '--unshallow', url, request.base, request.head]); }
}
export function changedFiles(raw: Buffer): Changed[] {
  const parts = raw.toString('utf8').split('\0'); const changed: Changed[] = [];
  for (let i = 0; i < parts.length - 1;) {
    const status = parts[i++]!; const first = RelativePath.parse(parts[i++]);
    if (/^[RC]/.test(status)) changed.push({ status, oldPath: first, path: RelativePath.parse(parts[i++]) });
    else changed.push({ status, path: first });
  }
  return changed;
}
export async function snapshot(dir: string, dest: string, r: Request, c: Config): Promise<Manifest> {
  const head = Sha.parse(r.head), base = Sha.parse(r.base);
  const mergeBase = Sha.parse(git(dir, ['merge-base', base, head]).toString().trim());
  if (r.mergeBase && r.mergeBase !== mergeBase) throw new Error('Recorded comparison base changed');
  const changed = changedFiles(git(dir, ['diff', '--name-status', '-z', '--find-renames', mergeBase, head]));
  const manifest: Manifest = { version: 1, head, base, mergeBase, changed, files: [], notes: [], incomplete: false };
  const important = new Set(changed.flatMap(f => [f.path, f.oldPath ?? f.path]));
  let bytes = 0;
  await mkdir(dest, { recursive: true });
  for (const [revision, sha] of [['head', head], ['base', mergeBase]] as const) {
    const entries = git(dir, ['ls-tree', '-rz', '--long', sha]).toString().split('\0').filter(Boolean).map(line => {
      const tab = line.indexOf('\t'); const [mode, type, oid, size] = line.slice(0, tab).trim().split(/\s+/);
      return { mode, type, oid: Sha.parse(oid), size: Number(size), path: line.slice(tab + 1) };
    });
    entries.sort((a, b) => {
      const rank = (p: string) => important.has(p) ? 0 : p === 'schemas/clab.schema.json' || p.startsWith('docs/') ? 1 : 2;
      return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
    });
    for (const file of entries) {
      let reason = '';
      if (!RelativePath.safeParse(file.path).success) reason = 'unsafe path';
      else if (!['100644', '100755'].includes(file.mode!) || file.type !== 'blob') reason = 'symlink or submodule';
      else if (file.size > c.limits.blobBytes) reason = 'file size limit';
      else if (bytes + file.size > c.limits.snapshotBytes) reason = 'snapshot size limit';
      let data: Buffer | undefined;
      if (!reason) {
        data = git(dir, ['cat-file', 'blob', file.oid], c.limits.blobBytes + 1);
        if (data.includes(0) || !Buffer.from(data.toString('utf8')).equals(data)) reason = 'binary/non-UTF8 content';
        if (data.subarray(0, 100).toString().startsWith('version https://git-lfs.github.com/spec/v1')) reason = 'LFS pointer';
      }
      if (reason) {
        manifest.notes.push(`Skipped ${revision}:${file.path.slice(0, 200)} (${reason}).`);
        if (important.has(file.path)) manifest.incomplete = true;
        continue;
      }
      const target = path.join(dest, revision, file.path); await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data!, { flag: 'wx', mode: 0o444 }); bytes += data!.length;
      const text = data!.toString();
      if (text.split('\n').some(line => line.length > 2000)) {
        manifest.notes.push(`Long lines in ${revision}:${file.path.slice(0, 200)} exceed the read tool's per-line display limit.`);
        if (important.has(file.path)) manifest.incomplete = true;
      }
      manifest.files.push({ revision, path: file.path, bytes: data!.length,
        lines: text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0) });
    }
  }
  let diff = '';
  for (const file of changed) {
    const names = file.oldPath ? [file.oldPath, file.path] : [file.path];
    try {
      const chunk = git(dir, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--unified=5', mergeBase, head, '--', ...names], c.limits.diffBytes);
      if (Buffer.byteLength(diff) + chunk.length > c.limits.diffBytes) throw new Error('diff budget');
      diff += chunk.toString();
    } catch { manifest.incomplete = true; manifest.notes.push(`Diff omitted for ${file.path.slice(0, 200)} (diff budget); inspect source snapshots if available.`); }
  }
  const standards: { path: string; revision: string; file: string }[] = [];
  await mkdir(path.join(dest, 'standards'), { recursive: true });
  for (const rule of Rules) {
    try {
      const text = git(dir, ['show', `${base}:${rule}`], 64_000).toString();
      const file = `standards/${path.basename(rule)}`;
      await writeFile(path.join(dest, file), text, { flag: 'wx', mode: 0o444 });
      standards.push({ path: rule, revision: base, file });
    } catch { manifest.incomplete = true; manifest.notes.push(`Repository review rule unavailable: ${rule}.`); }
  }
  await writeFile(path.join(dest, 'diff.txt'), diff);
  await writeFile(path.join(dest, 'standards.json'), JSON.stringify(standards, null, 2));
  await writeFile(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

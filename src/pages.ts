import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { SessionSnapshotSchema, renderSession, html, document } from './session.js';
import { Repo, SessionUrl, Sha } from './types.js';

const run = promisify(execFile);
export const PAGES_BRANCH = 'gh-pages';
export function pagesBase(c: Config): string {
  const [owner, repo] = c.sessionPages.repository.split('/');
  return `https://${owner!.toLowerCase()}.github.io/${repo}/`;
}
export function sessionPath(repositoryId: number, runId: string, attempt: string): string {
  z.number().int().positive().parse(repositoryId);
  if (!/^[1-9]\d*$/.test(runId) || !/^[1-9]\d*$/.test(attempt)) throw new Error('Invalid workflow run identity');
  return `sessions/${repositoryId}/${runId}-${attempt}/`;
}
export function allowedSessionUrl(url: string, c: Config) {
  return SessionUrl.safeParse(url).success && (url.startsWith('https://opncd.ai/') ||
    (url.startsWith(`${pagesBase(c)}sessions/${c.repositoryId}/`) && new URL(url).pathname.endsWith('/')));
}
const Entry = z.strictObject({ path: z.string().regex(/^sessions\/\d+\/\d+-\d+\/$/), repository: Repo, head: Sha,
  title: z.string().optional(), updatedAt: z.iso.datetime(), state: z.enum(['running', 'completed', 'failed']) });
const Catalog = z.array(Entry);
export async function writeSessionSite(directory: string, relative: string, input: unknown) {
  if (!/^sessions\/\d+\/\d+-\d+\/$/.test(relative)) throw new Error('Invalid session destination');
  const snapshot = SessionSnapshotSchema.parse(input);
  const dest = path.join(directory, relative);
  await mkdir(dest, { recursive: true });
  await writeFile(path.join(dest, 'index.html'), renderSession(snapshot));
  await writeFile(path.join(dest, 'session.json'), JSON.stringify(snapshot, null, 2) + '\n');
  let catalog: z.infer<typeof Catalog> = [];
  try { catalog = Catalog.parse(JSON.parse(await readFile(path.join(directory, 'index.json'), 'utf8'))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  catalog = [{ path: relative, repository: snapshot.repository, head: snapshot.head, title: snapshot.info.title, updatedAt: snapshot.updatedAt, state: snapshot.state },
    ...catalog.filter(e => e.path !== relative)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await writeFile(path.join(directory, 'index.json'), JSON.stringify(catalog, null, 2) + '\n');
  await writeFile(path.join(directory, 'index.html'), document('ToFaRev sessions', `<header><h1>ToFaRev sessions</h1><p class="muted">Review transcripts with prompts, reasoning, tool calls, and final results.</p></header>${catalog.length ? catalog.map(e => `<div class="entry"><a href="${e.path}"><strong>${html(e.title ?? e.repository)}</strong> · ${html(e.repository)} · ${e.head.slice(0, 12)}</a><p><span class="badge">${e.state}</span> · <time>${e.updatedAt}</time> · Run ${e.path.split('/')[2]}</p></div>`).join('') : '<p>Session exports will appear here after the first review.</p>'}`));
  await writeFile(path.join(directory, '.nojekyll'), '');
}

// Fetch anonymously; use a repository-scoped SSH deploy key only for the push.
// Rebase each attempt on the current branch so concurrent reviews keep each other's exports.
export async function publishSession(input: unknown, c: Config, runId: string, attempt: string,
  key: string, options: { fetchUrl?: string; pushUrl?: string } = {}): Promise<{ url: string }> {
  if (!c.shareSessions) throw new Error('Session publishing is disabled');
  const snapshot = SessionSnapshotSchema.parse(input);
  if (snapshot.repository !== c.repository) throw new Error('Session repository mismatch');
  const relative = sessionPath(c.repositoryId, runId, attempt);
  if (!key && !options.pushUrl) throw new Error('TOFAREV_PAGES_DEPLOY_KEY is required');
  const working = await mkdtemp(path.join(os.tmpdir(), 'tofarev-pages-'));
  try {
    const checkout = path.join(working, 'site'); await mkdir(checkout);
    const privateKey = path.join(working, 'key'), knownHosts = path.join(working, 'known_hosts');
    await writeFile(privateKey, key + '\n', { mode: 0o600 });
    // GitHub's published Ed25519 host key, also available from https://api.github.com/meta.
    await writeFile(knownHosts, 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n');
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: `ssh -i ${privateKey} -o IdentitiesOnly=yes -o IdentityAgent=none -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${knownHosts} -o ConnectTimeout=15 -o BatchMode=yes` };
    const git = (...args: string[]) => run('git', args, { cwd: checkout, env, timeout: 60_000, maxBuffer: 1_048_576 });
    const fetchUrl = options.fetchUrl ?? `https://github.com/${c.sessionPages.repository}.git`;
    const pushUrl = options.pushUrl ?? `git@github.com:${c.sessionPages.repository}.git`;
    await git('init', '--quiet');
    for (let retry = 0; ; retry++) {
      await git('fetch', '--quiet', '--depth=1', fetchUrl, `refs/heads/${PAGES_BRANCH}`);
      await git('checkout', '--quiet', '--force', 'FETCH_HEAD');
      await writeSessionSite(checkout, relative, snapshot);
      await git('add', '--', relative, 'index.html', 'index.json', '.nojekyll');
      const diff = await git('diff', '--cached', '--name-only');
      if (!diff.stdout.trim()) break;
      await git('-c', 'user.name=ToFaRev', '-c', 'user.email=tofarev@users.noreply.github.com',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', `Export ${c.repository} review ${runId}-${attempt} (${snapshot.state})`);
      try { await git('push', '--quiet', pushUrl, `HEAD:refs/heads/${PAGES_BRANCH}`); break; }
      catch (e) { if (retry >= 2) throw e; }
    }
    return { url: SessionUrl.parse(`${pagesBase(c)}${relative}`) };
  } finally { await rm(working, { recursive: true, force: true }); }
}

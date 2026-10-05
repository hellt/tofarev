import { z } from 'zod';
import type { Config } from './config.js';
import { GitHub, GitHubError, type Comment } from './github.js';
import { RequestSchema, type Request, Sha, SessionUrl } from './types.js';

const Event = z.object({ action: z.literal('created'), repository: z.object({ id: z.number().int(), full_name: z.string() }),
  issue: z.object({ number: z.number().int().positive(), pull_request: z.object({}).passthrough() }),
  comment: z.object({ id: z.number().int().positive(), body: z.string(), user: z.object({ login: z.string(), type: z.literal('User') }) }) });
export type Admission = { repository: string; repositoryId: number; pr: number; triggerId: number; key: string; author: string };
export function admit(event: unknown, eventName: string, c: Config): Admission | null {
  const parsed = Event.safeParse(event); if (eventName !== 'issue_comment' || !parsed.success) return null;
  const e = parsed.data;
  if (e.repository.full_name !== c.repository || e.repository.id !== c.repositoryId ||
    e.comment.body.trim() !== '/tofarev review' ||
    !c.allowedUsers.some(u => u.toLowerCase() === e.comment.user.login.toLowerCase())) return null;
  return { repository: c.repository, repositoryId: c.repositoryId, pr: e.issue.number,
    triggerId: e.comment.id, key: `${c.repositoryId}:${e.comment.id}`, author: e.comment.user.login };
}
export function marker(request: Request): string { return `<!-- tofarev:v1:${Buffer.from(JSON.stringify(RequestSchema.parse(request))).toString('base64')} -->`; }
export function parseMarker(comment: Comment, c: Config, a: Admission): Request | null {
  if (comment.user.type !== 'Bot' || comment.user.login !== `${c.appSlug}[bot]`) return null;
  const encoded = comment.body.match(/<!-- tofarev:v1:([A-Za-z0-9+/=]+) -->/)?.[1];
  if (!encoded || encoded.length > 8192) return null;
  try {
    const r = RequestSchema.parse(JSON.parse(Buffer.from(encoded, 'base64').toString()));
    if (r.key !== a.key || r.repository !== a.repository || r.repositoryId !== a.repositoryId ||
      r.pr !== a.pr || r.triggerId !== a.triggerId) return null;
    return r;
  } catch { return null; }
}
export async function findRequest(api: GitHub, c: Config, a: Admission) {
  for (const comment of await api.comments(a.repository, a.pr)) {
    const request = parseMarker(comment, c, a); if (request) return { request, commentId: comment.id };
  }
  return null;
}
// Read only the known status-link label, after verifying bot/request identity.
export function publishedSessionUrl(body: string): string | undefined {
  const candidate = body.match(/\[Live OpenCode session\]\(([^)\s]+)\)/)?.[1];
  const parsed = SessionUrl.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
const BRAND_ASSETS = 'https://raw.githubusercontent.com/hellt/tofarev/11341daf301af9b89b711528df08d0a9e9139bca/assets';
export const FOOTER = `Powered by <a href="https://tokenfactory.nebius.com/"><picture><source media="(prefers-color-scheme: dark)" srcset="${BRAND_ASSETS}/nebius-token-factory-dark.svg"><img src="${BRAND_ASSETS}/nebius-token-factory-light.svg" alt="Nebius Token Factory" height="22" align="absmiddle"></picture></a>`;
export function statusBody(r: Request, message: string, sessionUrl?: string) {
  if (sessionUrl) SessionUrl.parse(sessionUrl);
  return `${marker(r)}\n## ToFaRev review — ${r.state}\n\n${message}\n\n${sessionUrl ? `[Live OpenCode session](${sessionUrl}) · ` : ''}[Workflow run](${r.runUrl})\n\n---\n${FOOTER}`;
}
export async function beginRequest(api: GitHub, c: Config, a: Admission, policy: string, runUrl: string) {
  const trigger = await api.comment(a.repository, a.triggerId);
  if (trigger.user.type !== 'User' || trigger.user.login !== a.author || trigger.body.trim() !== '/tofarev review' ||
    trigger.issue_url !== `https://api.github.com/repos/${a.repository}/issues/${a.pr}`) return null;
  const existing = await findRequest(api, c, a);
  if (existing && ['completed', 'partial'].includes(existing.request.state)) return { ...existing, skip: true };
  let head: string | null = existing?.request.head ?? null;
  let base: string | null = existing?.request.base ?? null;
  let failed = false;
  try {
    const pr = await api.pull(a.repository, a.pr);
    if (pr.state !== 'open') failed = true;
    else { head ??= Sha.parse(pr.head.sha); base ??= Sha.parse(pr.base.sha); }
  } catch (e) { if (e instanceof GitHubError && e.status === 404) failed = true; else throw e; }
  const request = RequestSchema.parse({ version: 1, key: a.key, repository: a.repository, repositoryId: a.repositoryId,
    pr: a.pr, triggerId: a.triggerId, head, base, mergeBase: existing?.request.mergeBase ?? null,
    policy, runUrl, state: failed ? 'failed' : 'running' });
  const body = statusBody(request, failed ? 'Review could not proceed: the pull request is closed or unavailable.' : 'Review queued.');
  if (existing) { await api.update(a.repository, existing.commentId, body); return { request, commentId: existing.commentId, skip: failed }; }
  for (let attempt = 0; ; attempt++) {
    try { const comment = await api.create(a.repository, a.pr, body); return { request, commentId: comment.id, skip: failed }; }
    catch (e) {
      if (!(e instanceof GitHubError) || (e.status !== 0 && e.status !== 429 && e.status < 500)) throw e;
      const recovered = await findRequest(api, c, a);
      if (recovered) return { ...recovered, skip: failed || ['completed', 'partial'].includes(recovered.request.state) };
      if (attempt >= 3) throw e;
    }
  }
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { GitHub } from './github.js';
import { admit, beginRequest, parseMarker, statusBody } from './requests.js';
import { policyHash } from './opencode.js';
import { fetchSource, snapshot } from './source.js';
import { ManifestSchema, RequestSchema, ReviewOutputSchema, SessionUrl } from './types.js';
import { renderReport } from './report.js';

export const PreparedSchema = z.strictObject({ request: RequestSchema, commentId: z.number().int().positive(),
  manifest: ManifestSchema.nullable(), ready: z.boolean() });
export type Prepared = z.infer<typeof PreparedSchema>;
export async function prepare(event: unknown, eventName: string, c: Config, api: GitHub, work: string, runUrl: string,
  fixtureRemote?: string): Promise<Prepared | null> {
  const admission = admit(event, eventName, c); if (!admission) return null;
  const start = await beginRequest(api, c, admission, await policyHash(), runUrl);
  if (!start || start.skip) return null;
  const p: Prepared = { request: start.request, commentId: start.commentId, manifest: null, ready: false };
  await mkdir(work, { recursive: true });
  try {
    await fetchSource(path.join(work, 'git'), p.request, fixtureRemote);
    p.manifest = await snapshot(path.join(work, 'git'), path.join(work, 'source'), p.request, c);
    p.request.mergeBase = p.manifest.mergeBase;
    await api.update(c.repository, p.commentId, statusBody(p.request, 'Reviewing the recorded pull request revision.'));
    p.ready = true;
  } catch {
    p.request.state = 'failed';
    await api.update(c.repository, p.commentId, statusBody(p.request, 'Source preparation failed. No complete review is available.'));
  }
  await writeFile(path.join(work, 'prepared.json'), JSON.stringify(p));
  return p;
}
async function publicationContext(prepared: unknown, c: Config, api: GitHub) {
  const p = PreparedSchema.parse(prepared); const r = p.request;
  if (r.repository !== c.repository || r.repositoryId !== c.repositoryId || !p.ready) throw new Error('Publication context mismatch');
  if (!p.manifest || p.manifest.head !== r.head || p.manifest.base !== r.base || p.manifest.mergeBase !== r.mergeBase) throw new Error('Source manifest mismatch');
  const a = { repository: r.repository, repositoryId: r.repositoryId, key: r.key, pr: r.pr, triggerId: r.triggerId, author: '' };
  const current = parseMarker(await api.comment(r.repository, p.commentId), c, a);
  if (!current || current.head !== r.head || current.base !== r.base || current.mergeBase !== r.mergeBase || current.runUrl !== r.runUrl || current.policy !== r.policy) throw new Error('Publication marker mismatch');
  return { p, r, current };
}
export async function progress(prepared: unknown, session: unknown, c: Config, api: GitHub) {
  const url = z.strictObject({ url: SessionUrl }).parse(session).url;
  if (!c.shareSessions) return { skipped: true };
  const { p, r, current } = await publicationContext(prepared, c, api);
  if (current.state !== 'running') return { skipped: true };
  await api.update(r.repository, p.commentId, statusBody(r, 'Reviewing the recorded pull request revision.', url));
  return { skipped: false };
}
export async function publish(prepared: unknown, output: unknown, c: Config, api: GitHub, reviewJobStatus?: string) {
  const { p, r, current } = await publicationContext(prepared, c, api);
  if (current.state !== 'running') return { skipped: true };
  const parsed = ReviewOutputSchema.safeParse(output);
  const value = parsed.success ? parsed.data : { result: null, failed: true, notes: ['Reviewer result was unavailable or invalid.'] };
  const notes = [...value.notes];
  if (reviewJobStatus && reviewJobStatus !== 'success') notes.push('Reviewer job did not complete successfully.');
  if (value.failed) notes.push('Reviewer did not complete successfully.');
  let currentHead: string | undefined;
  try { currentHead = (await api.pull(r.repository, r.pr)).head.sha; }
  catch { notes.push('Unable to check whether newer commits are present.'); }
  const rendered = renderReport(r, value.result, p.manifest, { notes, currentHead, maxBytes: c.limits.reportBytes,
    sessionUrl: value.sessionUrl, sharingEnabled: c.shareSessions });
  await api.update(r.repository, p.commentId, rendered.body);
  return { skipped: false, state: rendered.request.state };
}
export async function readJson(file: string, maxBytes = 20_000_000): Promise<unknown> {
  const { stat } = await import('node:fs/promises');
  if ((await stat(file)).size > maxBytes) throw new Error('Input exceeds size limit');
  return JSON.parse(await readFile(file, 'utf8'));
}

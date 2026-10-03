import { z } from 'zod';

export const Sha = z.string().regex(/^[a-f0-9]{40}$/);
export const Repo = z.string().max(201).regex(/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/);
export const RelativePath = z.string().min(1).max(4096).refine(p =>
  !p.startsWith('/') && !p.includes('\\') && !/[\x00-\x1f\x7f]/.test(p) &&
  p.split('/').every(s => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git'), 'unsafe source path');
export const RequestSchema = z.strictObject({
  version: z.literal(1), key: z.string().max(64).regex(/^\d+:\d+$/), repository: Repo,
  repositoryId: z.number().int().positive(), pr: z.number().int().positive(), triggerId: z.number().int().positive(),
  head: Sha.nullable(), base: Sha.nullable(), mergeBase: Sha.nullable(),
  policy: z.string().regex(/^[a-f0-9]{64}$/),
  runUrl: z.string().max(512).regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/),
  state: z.enum(['running', 'completed', 'partial', 'failed']),
});
export type Request = z.infer<typeof RequestSchema>;
export const LocationSchema = z.strictObject({
  revision: z.enum(['head', 'base']), path: RelativePath,
  start: z.number().int().positive(), end: z.number().int().positive(),
}).refine(x => x.end >= x.start, 'invalid range');
const Text = z.string().trim().min(1).max(8000);
export const FindingSchema = z.strictObject({
  priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']), title: z.string().trim().min(1).max(200),
  location: LocationSchema, problem: Text, trigger: Text, impact: Text, suggestion: Text,
  diagram: z.string().max(4000).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;
export const ResultSchema = z.strictObject({
  version: z.literal(1), findings: z.array(FindingSchema).max(100),
  coverage: z.strictObject({ complete: z.boolean(), notes: z.array(z.string().max(2000)).max(100) }),
});
export type Result = z.infer<typeof ResultSchema>;
export type Changed = { status: string; path: string; oldPath?: string };
export type SourceFile = { revision: 'head' | 'base'; path: string; lines: number; bytes: number };
export const ManifestSchema = z.strictObject({
  version: z.literal(1), head: Sha, base: Sha, mergeBase: Sha,
  files: z.array(z.strictObject({ revision: z.enum(['head', 'base']), path: RelativePath,
    lines: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() })),
  changed: z.array(z.strictObject({ status: z.string(), path: RelativePath, oldPath: RelativePath.optional() })),
  notes: z.array(z.string()), incomplete: z.boolean(),
});
export type Manifest = z.infer<typeof ManifestSchema>;
export const SessionUrl = z.string().max(200).regex(/^https:\/\/opncd\.ai\/(?:s|share)\/[A-Za-z0-9_-]+$/);
export const ReviewOutputSchema = z.strictObject({ result: ResultSchema.nullable(), notes: z.array(z.string().max(2000)).max(100), failed: z.boolean(), sessionUrl: SessionUrl.optional() });
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export function validateLocations(result: Result, manifest: Manifest): Result {
  const notes = [...result.coverage.notes];
  const findings = result.findings.filter(f => {
    const file = manifest.files.find(x => x.revision === f.location.revision && x.path === f.location.path);
    if (file && f.location.end <= file.lines) return true;
    notes.push('A finding was omitted because its source location could not be verified.');
    return false;
  });
  return { ...result, findings, coverage: { complete: result.coverage.complete && findings.length === result.findings.length,
    notes: [...new Set(notes)] } };
}

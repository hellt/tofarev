import { z } from 'zod';
import { ENDPOINT } from './config.js';

// Model selection. A trusted default comes from configuration; an allowed
// commenter may override it per request: `/tofarev review model=glm 5.3`.
// Selectors are free text ("glm5.3", "z.ai/glm 5.3", "kimi k3", "deepseek v4.1
// flash", an exact id) resolved against Token Factory's live catalog, limited
// to the Kimi, GLM and DeepSeek families with tool calling.

// Printable, single line, no shell or Markdown metacharacters.
export const Selector = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9 ._/:-]*$/, 'unsupported model selector');
export const ModelId = z.string().max(100).regex(/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/);

// Vendor (the id prefix) and the words people use for it.
export const FAMILIES: Record<string, string[]> = {
  'zai-org': ['glm', 'zai', 'z.ai', 'z-ai', 'zhipu', 'zhipuai', 'zai-org'],
  moonshotai: ['kimi', 'moonshot', 'moonshotai', 'moonshot-ai'],
  'deepseek-ai': ['deepseek', 'deepseek-ai', 'ds'],
};
const ALIAS = new Map(Object.entries(FAMILIES).flatMap(([vendor, words]) => words.map(w => [w, vendor] as const)));
const FAMILY_NAMES = 'Kimi, GLM or DeepSeek';

export type CatalogModel = { id: string; created: number };
export type Resolution = { id: string } | { error: string };

type Parsed = { vendor?: string; versions: string[]; revisions: string[]; words: string[] };
const isVersion = (t: string) => /^\d{1,3}(\.\d+)*$/.test(t);
const isRevision = (t: string) => /^\d{4,}$/.test(t);

// "z.ai/GLM5.3-Flash" -> vendor zai-org, versions [5.3], words [flash].
export function parse(raw: string): Parsed {
  const out: Parsed = { versions: [], revisions: [], words: [] };
  let s = raw.trim().toLowerCase();
  const slash = s.lastIndexOf('/');
  if (slash >= 0) { out.vendor = ALIAS.get(s.slice(0, slash).trim()) ?? ALIAS.get(s.slice(0, slash).trim().replace(/\s+/g, '')); s = s.slice(slash + 1); }
  // Vendor words written with punctuation ("z.ai", "z-ai") are whole tokens.
  const spaced = s.split(/[\s_/:]+/).flatMap(t => ALIAS.has(t) ? [t] : [t.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')]).join(' ');
  const parts = spaced.split(/[\s_/:-]+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i]!.replace(/^\.+|\.+$/g, '');
    if (!t) continue;
    if (ALIAS.has(t)) { out.vendor ??= ALIAS.get(t); continue; }
    if ((t === 'v' || t === 'k') && isVersion(parts[i + 1] ?? '')) continue; // V4.1, K3
    if (isRevision(t)) out.revisions.push(t);
    else if (isVersion(t)) out.versions.push(t);
    else out.words.push(t);
  }
  return out;
}

const vendorOf = (id: string) => id.split('/')[0]!.toLowerCase();
const compareVersions = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

export function resolveModel(selector: string, catalog: CatalogModel[]): Resolution {
  const wanted = Selector.safeParse(selector);
  if (!wanted.success) return { error: `Model selector \`${selector.slice(0, 64)}\` is not valid.` };
  const models = catalog.filter(m => vendorOf(m.id) in FAMILIES);
  const exact = models.find(m => m.id.toLowerCase() === wanted.data.toLowerCase())
    ?? models.filter(m => m.id.split('/')[1]!.toLowerCase() === wanted.data.toLowerCase()).at(0);
  if (exact) return { id: exact.id };
  const q = parse(wanted.data);
  if (!q.vendor && !q.versions.length && !q.words.length && !q.revisions.length) return { error: `Model selector \`${wanted.data}\` names no model.` };
  const scored = models.flatMap(m => {
    const c = parse(m.id);
    if (q.vendor && c.vendor !== q.vendor) return [];
    if (!q.words.every(w => c.words.includes(w))) return [];
    if (!q.revisions.every(r => c.revisions.includes(r))) return [];
    let prefix = 0;
    for (const v of q.versions) {
      if (c.versions.includes(v)) continue;
      if (c.versions.some(cv => cv.startsWith(`${v}.`))) { prefix++; continue; }
      return [];
    }
    // Prefer exact versions, then the plain model over variants (glm 5.3 ->
    // GLM-5.3, not GLM-5.3-Flash), then the newest version and release.
    return [{ m, c, prefix, extra: c.words.filter(w => !q.words.includes(w)).length }];
  });
  if (!scored.length) {
    const near = models.filter(m => !q.vendor || vendorOf(m.id) === q.vendor).map(m => m.id).sort();
    return { error: `Model \`${wanted.data}\` matches no ${FAMILY_NAMES} model with tool calling on Token Factory. Available: ${near.map(id => `\`${id}\``).join(', ') || 'none'}.` };
  }
  const vendors = new Set(scored.map(s => vendorOf(s.m.id)));
  if (!q.vendor && vendors.size > 1) {
    return { error: `Model \`${wanted.data}\` is ambiguous across vendors; add kimi, glm or deepseek. Candidates: ${scored.map(s => `\`${s.m.id}\``).sort().join(', ')}.` };
  }
  scored.sort((a, b) => a.prefix - b.prefix || a.extra - b.extra
    || compareVersions(b.c.versions[0] ?? '0', a.c.versions[0] ?? '0') || b.m.created - a.m.created || a.m.id.localeCompare(b.m.id));
  return { id: scored[0]!.m.id };
}

// Chat models in the three families that support tool calling (review and
// digest agents both need tools).
export async function fetchCatalog(key: string, transport: typeof fetch = fetch): Promise<CatalogModel[]> {
  const response = await transport(`${ENDPOINT}/models?verbose=true`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Token Factory model catalog unavailable');
  const data = await response.json() as { data?: { id?: unknown; created?: unknown; supported_features?: unknown }[] };
  return (data.data ?? []).flatMap(m => typeof m.id === 'string' && ModelId.safeParse(m.id).success && vendorOf(m.id) in FAMILIES
    && Array.isArray(m.supported_features) && m.supported_features.includes('tools')
    ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []);
}

// A trusted exact id is used as is; anything else is resolved against the catalog.
export async function selectModel(defaultModel: string, requested: string | undefined, key: string,
  catalog: CatalogModel[] | (() => Promise<CatalogModel[]>) = () => fetchCatalog(key)): Promise<Resolution & { requested?: string }> {
  const selector = requested?.trim() || defaultModel;
  if (!requested?.trim() && ModelId.safeParse(selector).success) return { id: selector };
  let models: CatalogModel[];
  try { models = Array.isArray(catalog) ? catalog : await catalog(); }
  catch { return { error: 'The Token Factory model catalog could not be read, so the requested model could not be resolved.', requested: selector }; }
  return { ...resolveModel(selector, models), requested: selector };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL } from '../src/config.js';
import { type CatalogModel, fetchCatalog, parse, resolveModel, selectModel } from '../src/models.js';

// Token Factory catalog rows (id, created, tools) as of 2026-10-31.
const rows: [string, number, boolean][] = [
  ['Qwen/Qwen3.5-397B-A17B', 1771286400, true],
  ['deepseek-ai/DeepSeek-V4-Flash-0731', 1786581299, true],
  ['deepseek-ai/DeepSeek-V4-Pro', 1793482164, true],
  ['deepseek-ai/DeepSeek-V4-Pro-0813', 1791525427, true],
  ['deepseek-ai/DeepSeek-V4.1-Flash', 1789509523, false],
  ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 1792629387, true],
  ['moonshotai/Kimi-K2.6', 1778544000, true],
  ['moonshotai/Kimi-K2.7-Code', 1781740800, true],
  ['moonshotai/Kimi-K3', 1785110400, true],
  ['openai/gpt-oss-120b', 1793482162, true],
  ['zai-org/GLM-5.1', 1793482163, true],
  ['zai-org/GLM-5.2', 1781481600, true],
  ['zai-org/GLM-5.3', 1789085803, true],
  ['zai-org/GLM-5.3-Flash', 1789524983, true],
];
const verbose = { data: rows.map(([id, created, tools]) => ({ id, created, supported_features: tools ? ['tools', 'reasoning'] : ['reasoning'] })) };
export const catalog: CatalogModel[] = rows.filter(([id, , tools]) => tools && /^(zai-org|moonshotai|deepseek-ai)\//.test(id)).map(([id, created]) => ({ id, created }));

test('selectors are tokenized into vendor, versions, revisions and words', () => {
  assert.deepEqual(parse('z.ai/GLM5.3-Flash'), { vendor: 'zai-org', versions: ['5.3'], revisions: [], words: ['flash'] });
  assert.deepEqual(parse('deepseek-ai/DeepSeek-V4.1-Flash-1017'), { vendor: 'deepseek-ai', versions: ['4.1'], revisions: ['1017'], words: ['flash'] });
  assert.deepEqual(parse('moonshotai/Kimi-K2.7-Code'), { vendor: 'moonshotai', versions: ['2.7'], revisions: [], words: ['code'] });
  assert.deepEqual(parse('kimi k3'), { vendor: 'moonshotai', versions: ['3'], revisions: [], words: [] });
});

test('free-form selectors resolve to the intended Kimi, GLM and DeepSeek models', () => {
  const cases: [string, string][] = [
    ['glm5.3', 'zai-org/GLM-5.3'], ['glm 5.3', 'zai-org/GLM-5.3'], ['GLM-5.3', 'zai-org/GLM-5.3'], ['z.ai/glm 5.3', 'zai-org/GLM-5.3'],
    ['z.ai glm 5.3', 'zai-org/GLM-5.3'], ['zai/glm5.3', 'zai-org/GLM-5.3'], ['Z.AI/GLM-5.3', 'zai-org/GLM-5.3'], ['zai-org/GLM-5.3', 'zai-org/GLM-5.3'],
    ['glm', 'zai-org/GLM-5.3'], ['glm 5', 'zai-org/GLM-5.3'], ['glm 5.2', 'zai-org/GLM-5.2'], ['zhipu glm-5.1', 'zai-org/GLM-5.1'],
    ['glm flash', 'zai-org/GLM-5.3-Flash'], ['glm 5.3 flash', 'zai-org/GLM-5.3-Flash'], ['GLM5.3-Flash', 'zai-org/GLM-5.3-Flash'], ['GLM-5.3-Flash', 'zai-org/GLM-5.3-Flash'],
    ['kimi', 'moonshotai/Kimi-K3'], ['kimi k3', 'moonshotai/Kimi-K3'], ['Kimi-K3', 'moonshotai/Kimi-K3'], ['moonshot kimi 3', 'moonshotai/Kimi-K3'],
    ['kimi k2.6', 'moonshotai/Kimi-K2.6'], ['kimi 2.6', 'moonshotai/Kimi-K2.6'], ['kimi code', 'moonshotai/Kimi-K2.7-Code'], ['moonshotai/kimi k2.7 code', 'moonshotai/Kimi-K2.7-Code'],
    ['deepseek', 'deepseek-ai/DeepSeek-V4.1-Flash-1017'], ['deepseek v4.1 flash', 'deepseek-ai/DeepSeek-V4.1-Flash-1017'], ['ds flash', 'deepseek-ai/DeepSeek-V4.1-Flash-1017'],
    ['deepseek-ai/DeepSeek-V4.1-Flash', 'deepseek-ai/DeepSeek-V4.1-Flash-1017'], ['deepseek v4 flash', 'deepseek-ai/DeepSeek-V4-Flash-0731'],
    ['deepseek pro', 'deepseek-ai/DeepSeek-V4-Pro'], ['deepseek v4 pro 0813', 'deepseek-ai/DeepSeek-V4-Pro-0813'], ['DeepSeek-V4-Pro-0813', 'deepseek-ai/DeepSeek-V4-Pro-0813'],
  ];
  for (const [selector, id] of cases) assert.deepEqual(resolveModel(selector, catalog), { id }, selector);
});

test('unknown, ambiguous, foreign and malformed selectors fail with an actionable message', () => {
  const error = (s: string) => { const r = resolveModel(s, catalog); assert.ok('error' in r, s); return r.error; };
  assert.match(error('flash'), /ambiguous across vendors.*DeepSeek-V4.1-Flash-1017.*GLM-5.3-Flash/);
  assert.match(error('glm 9'), /matches no Kimi, GLM or DeepSeek model.*`zai-org\/GLM-5.3`/);
  assert.doesNotMatch(error('glm 9'), /Kimi-K3/);
  assert.match(error('qwen 3.5'), /matches no/);
  assert.match(error('Qwen/Qwen3.5-397B-A17B'), /matches no/);
  assert.match(error('gpt-oss-120b'), /matches no/);
  assert.match(error('glm; rm -rf /'), /not valid/);
  assert.match(error('`glm`'), /not valid/);
});

test('the catalog keeps tool-capable models of the three families, and trusted ids skip it', async () => {
  const fetched = await fetchCatalog('k', (async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.tokenfactory.nebius.com/v1/models?verbose=true');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer k');
    return Response.json(verbose);
  }) as typeof fetch);
  assert.deepEqual(fetched.map(m => m.id).sort(), catalog.map(m => m.id).sort());
  const never = async () => { throw new Error('catalog must not be read'); };
  assert.deepEqual(await selectModel(MODEL, undefined, 'k', never), { id: MODEL });
  assert.deepEqual(await selectModel(MODEL, ' ', 'k', never), { id: MODEL });
  assert.deepEqual(await selectModel(MODEL, 'glm 5.3', 'k', catalog), { id: 'zai-org/GLM-5.3', requested: 'glm 5.3' });
  assert.deepEqual(await selectModel('kimi', undefined, 'k', catalog), { id: 'moonshotai/Kimi-K3', requested: 'kimi' });
  assert.match((await selectModel(MODEL, 'kimi', 'k', never) as { error: string }).error, /catalog could not be read/);
});

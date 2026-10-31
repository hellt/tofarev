import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { review } from '../src/opencode.js';
import { digest } from '../src/digest.js';
import { evaluationSource, cases } from '../src/evaluation.js';
import { item, promptText } from './digest.test.js';

const catalog = [
  { id: 'zai-org/GLM-5.3', created: 1789085803 }, { id: 'zai-org/GLM-5.3-Flash', created: 1789524983 },
  { id: 'moonshotai/Kimi-K3', created: 1785110400 }, { id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', created: 1792629387 },
];
const sse = (content: string) => {
  const chunk = (d: unknown, f: string | null) => `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, choices: [{ index: 0, delta: d, finish_reason: f }] })}\n\n`;
  return new Response(chunk({ role: 'assistant', content }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
};

test('a requested model is resolved, the only model the proxy forwards, and reported', { timeout: 60_000 }, async () => {
  const dir = await evaluationSource(cases[cases.length - 1]!);
  try {
    const seen: string[] = [];
    const out = await review(dir, config({ limits: { durationMs: 45_000 } }), { key: 'fake', model: 'z.ai/glm 5.3', catalog, transport: (async (_u: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)).model);
      return sse(JSON.stringify({ version: 1, findings: [], coverage: { complete: true, notes: [] } }));
    }) as typeof fetch });
    assert.equal(out.failed, false, JSON.stringify(out));
    assert.equal(out.model, 'zai-org/GLM-5.3');
    assert.ok(seen.length >= 1 && seen.every(m => m === 'zai-org/GLM-5.3'), JSON.stringify(seen));
    let calls = 0;
    const unknown = await review(dir, config(), { key: 'fake', model: 'glm 9', catalog, transport: (async () => { calls++; throw new Error('no inference'); }) as typeof fetch });
    assert.equal(unknown.failed, true); assert.equal(calls, 0);
    assert.match(unknown.modelError!, /`glm 9` matches no Kimi, GLM or DeepSeek model/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the digest writer runs on the configured model and names it in written_by', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tofarev-model-digest-'));
  try {
    const file = path.join(dir, 'prompt.md');
    await writeFile(file, promptText(`## Session type: talk\n\n${item(1)}\n\n${item(2)}\n\n${item(3)}`));
    const seen: string[] = [];
    const out = await digest(file, config({ model: 'kimi', limits: { durationMs: 45_000 } }), { key: 'fake', catalog, today: '2026-10-31',
      transport: (async (_u: string, init: RequestInit) => {
        seen.push(JSON.parse(String(init.body)).model);
        return sse('# Digest\n\n## Core\n\n### Talk number 1: lossless fabric study\n\n- **Why**: x\n\n## Themes\n\n- y\n');
      }) as typeof fetch });
    assert.equal(out.failed, false, JSON.stringify(out.notes));
    assert.ok(out.markdown!.includes('written_by: ToFaRev (moonshotai/Kimi-K3)'));
    assert.ok(seen.every(m => m === 'moonshotai/Kimi-K3'), JSON.stringify(seen));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

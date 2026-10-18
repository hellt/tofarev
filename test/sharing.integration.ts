import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config } from '../src/config.js';
import { review } from '../src/opencode.js';
import { evaluationSource, cases } from '../src/evaluation.js';
import { SessionSnapshotSchema, renderSession } from '../src/session.js';

function sse(delta: unknown, finish = 'stop') {
  const event = (delta: unknown, reason: string | null) => `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1,
    model: 'zai-org/GLM-5.3-Flash', choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
  return new Response(event(delta, null) + event({}, finish) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
test('OpenCode without sharing exports live tools and a final transcript before deleting local state', { timeout: 60_000 }, async () => {
  const source = await realpath(await evaluationSource(cases.at(-1)!));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tofarev-export-test-'));
  let calls = 0;
  let initial: any, live: any;
  try {
    const result = await review(source, config({ shareSessions: true, limits: { durationMs: 45_000 } }), {
      key: 'inference-secret-sentinel', sessionDirectory: directory,
      transport: (async () => {
        calls++;
        if (calls === 1) {
          initial = JSON.parse(await readFile(path.join(directory, 'snapshot.json'), 'utf8'));
          return sse({ role: 'assistant', tool_calls: [{ index: 0, id: 'read_1', type: 'function', function: {
            name: 'read', arguments: JSON.stringify({ filePath: `${source}/diff.txt` }),
          } }] }, 'tool_calls');
        }
        await new Promise(resolve => setTimeout(resolve, 16_000));
        live = SessionSnapshotSchema.parse(JSON.parse(await readFile(path.join(directory, 'snapshot.json'), 'utf8')));
        return sse({ role: 'assistant', reasoning_content: 'Check the supplied evidence.', content: '```json\n{"version":1,"findings":[],"coverage":{"complete":true,"notes":[]}}\n```' });
      }) as typeof fetch,
    });
    assert.equal(result.failed, false); assert.equal(calls, 2);
    assert.equal(initial.state, 'running'); assert.equal(live.state, 'running');
    assert.ok(live.messages.some((m: any) => m.parts.some((p: any) => p.type === 'tool' && p.state.status === 'completed')), JSON.stringify(live.messages.map((m: any) => m.parts.map((p: any) => ({ type: p.type, status: p.state?.status })))));
    const text = await readFile(path.join(directory, 'snapshot.json'), 'utf8');
    const final = SessionSnapshotSchema.parse(JSON.parse(text));
    assert.equal(final.state, 'completed'); assert.ok(final.report?.includes('ToFaRev review'));
    assert.ok(final.messages.some(m => m.parts.some(p => p.type === 'text' && String(p.text).includes('coverage'))));
    assert.ok(renderSession(final).includes('Download session JSON'));
    assert.ok(!text.includes('inference-secret-sentinel'));
  } finally { await rm(source, { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); }
});

test('a failed review preserves the available transcript and exports a failed state', { timeout: 30_000 }, async () => {
  const source = await realpath(await evaluationSource(cases.at(-1)!));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tofarev-failed-export-'));
  try {
    const result = await review(source, config({ shareSessions: true, limits: { durationMs: 20_000 } }), {
      key: 'inference-secret', sessionDirectory: directory,
      transport: (async () => sse({ role: 'assistant', content: 'Malformed result retained for introspection.' })) as typeof fetch,
    });
    assert.equal(result.failed, true);
    const saved = SessionSnapshotSchema.parse(JSON.parse(await readFile(path.join(directory, 'snapshot.json'), 'utf8')));
    assert.equal(saved.state, 'failed');
    assert.ok(JSON.stringify(saved.messages).includes('Malformed result retained for introspection.'));
  } finally { await rm(source, { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); }
});

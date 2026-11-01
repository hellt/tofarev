import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { Limits, WRITTEN_BY, batches, finalizeDigest, parseJson, parsePrompt, segments, splitItems, stage, triageContext, writerInput } from '../src/digest.js';

const metadata = '<!--\nconference: Netdev 0x1A\ntype: vendor\nsource_url: https://netdevconf.info/0x1A/\ngenerated: 2026-09-03\nregistry_key: netdev-0x1a\n-->';
export function promptText(program: string) {
  return `>>> HOW TO RUN THIS <<<\nSave it as digests/netdev-0x1a.md.\n${'='.repeat(64)}\n\nYou are helping a product manager.\n\n## How to read this program\n\nVendor program.\n\n## Enriching from the source material (best effort)\n\nFetch pdf: links.\n\n## What to produce\n\nCore, Adjacent, Wildcard tiers.\n\n## Output format\n\nBegin the output with this metadata:\n\n${metadata}\n\nThen the digest.\n\n============================ PROGRAM TEXT ============================\n\n${program}\n`;
}
export function item(n: number, body = 'An abstract about datacenter fabrics and RDMA congestion control.') {
  return `### Talk number ${n}: lossless fabric study\nSpeakers: Speaker ${n}\npage: https://netdevconf.info/0x1A/sessions/talk/${n}.html\n${body}`;
}

test('prompts are split into instructions, metadata and program items', () => {
  const p = parsePrompt(promptText(`## Session type: talk\n\n${item(1)}\n\n${item(2)}\n\n## Session type: workshop\n\n${item(3)}`));
  assert.ok(p.instructions.startsWith('You are helping a product manager.'));
  assert.ok(!p.instructions.includes('HOW TO RUN THIS'));
  assert.equal(p.metadata, metadata);
  assert.equal(p.key, 'netdev-0x1a');
  assert.equal(p.sourceUrl, 'https://netdevconf.info/0x1A/');
  const items = splitItems(p.program);
  assert.deepEqual(items.map(i => [i.id, i.group, i.title]), [
    ['P0001', 'Session type: talk', 'Talk number 1: lossless fabric study'],
    ['P0002', 'Session type: talk', 'Talk number 2: lossless fabric study'],
    ['P0003', 'Session type: workshop', 'Talk number 3: lossless fabric study']]);
  assert.ok(items[0]!.text.includes('page: https://netdevconf.info/0x1A/sessions/talk/1.html'));
  assert.throws(() => parsePrompt('no separator here'), /PROGRAM TEXT/);
  assert.throws(() => parsePrompt(promptText('{PROGRAM_TEXT}')), /no program text/);
  const context = triageContext(p.instructions);
  assert.ok(context.includes('## What to produce'));
  assert.ok(!context.includes('## Output format') && !context.includes('## Enriching'));
});

test('unstructured pasted programs fall back to paragraph runs and batches stay bounded', () => {
  const pasted = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'x'.repeat(300)}`).join('\n\n');
  const runs = segments(pasted, 1_000);
  assert.ok(runs.length > 5 && runs.every(r => r.text.length <= 1_400));
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `P${i}`, group: '', title: `t${i}`, text: 'y'.repeat(2_000) }));
  const groups = batches(many, 10_000);
  assert.equal(groups.flat().length, 100);
  assert.ok(groups.every(g => g.length >= 1 && g.length <= 5));
});

test('stage JSON is recovered from fences, prose and reasoning tags', () => {
  const schema = z.object({ a: z.number() });
  assert.deepEqual(parseJson('{"a":1}', schema), { a: 1 });
  assert.deepEqual(parseJson('Here you go:\n```json\n{"a":2}\n```\nDone.', schema), { a: 2 });
  assert.deepEqual(parseJson('<think>{"a":9}</think>Result: {"a":3} as requested', schema), { a: 3 });
  assert.throws(() => parseJson('no json', schema));
});

test('small programs go to the writer whole; large programs are shortlisted then selected', async () => {
  const small = parsePrompt(promptText(`## Session type: talk\n\n${item(1)}\n\n${item(2)}\n\n${item(3)}`));
  const calls: string[] = [];
  const single = await stage(small, async s => { calls.push(s); return '{}'; }, []);
  assert.equal(single.mode, 'single-pass'); assert.equal(calls.length, 0);
  assert.ok(writerInput(small, single).includes(small.program));

  const count = Math.ceil(Limits.singlePassChars / 500) + 200;
  const large = parsePrompt(promptText(`## Session type: talk\n\n${Array.from({ length: count }, (_, i) => item(i + 1, 'z'.repeat(500))).join('\n\n')}`));
  const notes: string[] = [];
  let shortlists = 0, selections = 0;
  const staged = await stage(large, async (system, user) => {
    assert.ok(!system.includes('## Output format'));
    if (system.includes('stage 1 (shortlist)')) {
      shortlists++;
      if (user.startsWith('Batch 2 ')) return 'not json at all';
      const ids = [...user.matchAll(/^\[(P\d{4})\]/gm)].map(m => m[1]);
      return JSON.stringify({ candidates: [...ids.slice(0, 12).map(id => ({ id, tier: 'Core', why: 'fabric' })), { id: 'P9999', tier: 'core' }] });
    }
    selections++;
    assert.ok(system.includes('stage 2 (selection)'));
    const ids = [...user.matchAll(/^\[(P\d{4})\]/gm)].map(m => m[1]);
    return '```json\n' + JSON.stringify({ selected: [...ids.slice(0, 18).map(id => ({ id, tier: 'core' })), { id: 'P0002', tier: 'wildcard' }] }) + '\n```';
  }, notes);
  assert.equal(staged.mode, 'staged');
  assert.ok(staged.batches >= 3);
  assert.equal(shortlists, staged.batches + 1, 'the malformed batch is retried once');
  assert.equal(selections, 1);
  assert.ok(notes.some(n => n.startsWith('Shortlist batch 2 of')));
  assert.equal(staged.shortlisted, 12 * (staged.batches - 1));
  assert.ok(staged.picks!.length <= Limits.maxPicks + 5 && staged.picks!.length >= 18);
  assert.ok(staged.picks!.every(p => p.item.id !== 'P9999'));
  const input = writerInput(large, staged);
  assert.ok(input.includes(`pre-selected ${staged.picks!.length} of the ${count} program items`));
  assert.ok(input.includes('Proposed tier: core'));
});

test('finalized digests carry canonical metadata, program-only links and checked headings', () => {
  const p = parsePrompt(promptText(`## Session type: talk\n\n${item(1)}\n\n${item(2)}`));
  const raw = '```markdown\n<!--\nconference: wrong\n-->\n\nSure! Here is the digest.\n\n# Netdev 0x1A — Digest\n\n## Core\n\n### Talk number 1: lossless fabric study\n\n- **Links**: [page](https://netdevconf.info/0x1A/sessions/talk/1.html), [slides](https://evil.example/x.pdf)\n\n### An invented talk about nothing\n\n- **Why**: hmm. See [source](https://netdevconf.info/0x1A/).\n```';
  const out = finalizeDigest(raw, p, splitItems(p.program), true, '2026-10-31');
  assert.ok(out.markdown!.startsWith('<!--\nconference: Netdev 0x1A\n'));
  assert.ok(out.markdown!.includes('generated: 2026-10-31\nregistry_key: netdev-0x1a\nwritten_by: ' + WRITTEN_BY + '\n-->\n\n# Netdev 0x1A — Digest'));
  assert.ok(!out.markdown!.includes('Sure! Here is') && !out.markdown!.includes('conference: wrong') && !out.markdown!.includes('```'));
  assert.ok(out.markdown!.includes('[page](https://netdevconf.info/0x1A/sessions/talk/1.html)'));
  assert.ok(out.markdown!.includes('[source](https://netdevconf.info/0x1A/)'));
  assert.ok(out.markdown!.includes(', slides') && !out.markdown!.includes('evil.example'));
  assert.equal(out.linksRemoved, 1); assert.equal(out.unverified, 1); assert.equal(out.picks, 2);
  assert.ok(out.notes.some(n => n.includes('An invented talk about nothing')));
  assert.ok(out.notes.some(n => n.includes('no `## Themes` section')));
  assert.equal(finalizeDigest('I cannot help with that.', p, [], true, '2026-10-31').markdown, null);
  // Picks written as bullets instead of ### headings are flagged, not passed as clean.
  const bullets = finalizeDigest('# D\n\n## Core\n\n- **Talk number 1** — why it matters\n\n## Themes\n\n- one', p, splitItems(p.program), true, '2026-10-31');
  assert.equal(bullets.picks, 0);
  assert.ok(bullets.notes.some(n => n.includes('no `###` pick headings')));
});

test('digest-files writes the validated digest and fails closed on a failed result', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tofarev-digest-files-'));
  const run = promisify(execFile);
  const stats = { mode: 'single-pass', items: 2, batches: 0, shortlisted: 0, selected: 2, picks: 1, calls: 1, linksRemoved: 0, unverifiedHeadings: 0, seconds: 3, sources: 0, sourceFailures: 0 };
  try {
    await writeFile(path.join(dir, 'ok.json'), JSON.stringify({ version: 1, key: 'netdev-0x1a', markdown: '# Digest\n', failed: false, notes: [], stats }));
    await run(process.execPath, ['dist/src/cli.js', 'digest-files', path.join(dir, 'ok.json'), path.join(dir, 'out')]);
    assert.equal(await readFile(path.join(dir, 'out/digest.md'), 'utf8'), '# Digest\n');
    await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ version: 1, key: null, markdown: null, failed: true, notes: ['x'], stats }));
    await assert.rejects(run(process.execPath, ['dist/src/cli.js', 'digest-files', path.join(dir, 'bad.json'), path.join(dir, 'bad')]));
    await writeFile(path.join(dir, 'evil.json'), JSON.stringify({ version: 1, key: '../x', markdown: '# x', failed: false, notes: [], stats }));
    await assert.rejects(run(process.execPath, ['dist/src/cli.js', 'digest-files', path.join(dir, 'evil.json'), path.join(dir, 'evil')]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

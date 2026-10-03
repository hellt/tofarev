import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport, diagram, sourceLink } from '../src/report.js';
import { ResultSchema, validateLocations, type Finding, type Manifest } from '../src/types.js';
import { FOOTER } from '../src/requests.js';

export const r = { version: 1 as const, key: '290960521:7', repository: 'srl-labs/containerlab', repositoryId: 290960521, pr: 42, triggerId: 7,
  head: 'a'.repeat(40), base: 'b'.repeat(40), mergeBase: 'c'.repeat(40), policy: 'd'.repeat(64), runUrl: 'https://github.com/srl-labs/containerlab/actions/runs/1', state: 'running' as const };
export const finding: Finding = { priority: 'P2', title: 'Repeated runtime query per node', location: { revision: 'head', path: 'nodes/é space.go', start: 2, end: 3 },
  problem: 'The loop repeats the same runtime query.', trigger: 'Deploy a topology with many nodes.', impact: 'Startup incurs an extra runtime round trip per node.', suggestion: 'Fetch once before iterating.' };
export const manifest: Manifest = { version: 1, head: r.head, base: r.base, mergeBase: r.mergeBase, changed: [], incomplete: false, notes: [],
  files: [{ revision: 'head', path: finding.location.path, lines: 5, bytes: 100 }, { revision: 'base', path: 'removed.go', lines: 3, bytes: 30 }] };
test('review failure reasons remain visible ahead of a large snapshot warning list', () => {
  const warnings = Array.from({ length: 100 }, (_, i) => `Skipped unrelated image ${i}`);
  const { body, request } = renderReport(r, null, { ...manifest, notes: warnings }, { notes: ['Inference request byte limit exceeded.'] });
  assert.equal(request.state, 'failed');
  assert.ok(body.indexOf('Inference request byte limit exceeded.') < body.indexOf(warnings[0]!));
  assert.match(body, /93 additional coverage limitations/);
});
test('finding schema and immutable links reject invalid locations and metadata injection', () => {
  const result = ResultSchema.parse({ version: 1, findings: [finding], coverage: { complete: true, notes: [] } });
  assert.match(sourceLink(r, finding), /blob\/a{40}\/nodes\/%C3%A9%20space.go#L2-L3/);
  const deleted: Finding = { ...finding, location: { revision: 'base', path: 'removed.go', start: 1, end: 2 } };
  assert.match(sourceLink(r, deleted), /blob\/c{40}\/removed.go/);
  for (const patch of [{ priority: 'P7' }, { repository: 'attacker/repo' }, { location: { ...finding.location, path: '../secret' } }]) {
    assert.equal(ResultSchema.safeParse({ ...result, findings: [{ ...finding, ...patch }] }).success, false);
  }
  const invalid = validateLocations({ ...result, findings: [{ ...finding, location: { ...finding.location, end: 999 } }] }, manifest);
  assert.equal(invalid.findings.length, 0); assert.equal(invalid.coverage.complete, false);
});
test('table and details match, sort P0 to P4, and always include footer', () => {
  const findings = ['P4', 'P2', 'P0', 'P3', 'P1'].map(priority => ({ ...finding, priority }));
  const result = ResultSchema.parse({ version: 1, findings, coverage: { complete: true, notes: [] } });
  const { body } = renderReport(r, result, manifest);
  assert.ok(body.indexOf('| **P0') < body.indexOf('| **P1'));
  assert.equal((body.match(/<details>/g) ?? []).length, 5);
  assert.equal((body.match(/<summary>P\d - Repeated/g) ?? []).length, 5);
  assert.ok(!body.includes('<details open'));
  assert.ok(body.endsWith(FOOTER));
  const empty = renderReport(r, { ...result, findings: [] }, manifest).body;
  assert.match(empty, /No actionable findings/); assert.ok(!empty.includes('| Finding |'));
  for (const variant of [renderReport(r, null, manifest), renderReport(r, result, { ...manifest, incomplete: true }),
    renderReport(r, result, manifest, { currentHead: 'e'.repeat(40) })]) assert.ok(variant.body.endsWith(FOOTER));
});
test('a native session link replaces details while preserving findings and file links', () => {
  const result = ResultSchema.parse({ version: 1, findings: [finding], coverage: { complete: true, notes: [] } });
  const shared = renderReport(r, result, manifest, { sessionUrl: 'https://opncd.ai/share/test1234', sharingEnabled: true });
  assert.match(shared.body, /\| \*\*P2 - Repeated/); assert.match(shared.body, /blob\/a{40}/);
  assert.match(shared.body, /\[Live OpenCode session\]\(https:\/\/opncd.ai\/share\/test1234\)/);
  assert.ok(shared.body.indexOf('[Live OpenCode session]') < shared.body.indexOf('[Workflow run]'));
  assert.ok(!shared.body.includes('<details>')); assert.ok(shared.body.endsWith(FOOTER));
  assert.equal(shared.request.state, 'completed');
  const fallback = renderReport(r, result, manifest, { sharingEnabled: true });
  assert.match(fallback.body, /<details>/); assert.match(fallback.body, /session link unavailable/);
  assert.equal(fallback.request.state, 'completed');
  assert.throws(() => renderReport(r, result, manifest, { sessionUrl: 'https://evil.example/steal' }));
});
test('renderer escapes arbitrary markup and truncates complete findings by byte budget', () => {
  const result = ResultSchema.parse({ version: 1, findings: Array.from({ length: 20 }, () => ({ ...finding,
    title: '</summary> | @hellt [link](https://evil.example)', problem: 'é'.repeat(5000) })), coverage: { complete: true, notes: [] } });
  const { body, request } = renderReport(r, result, manifest, { maxBytes: 12000 });
  assert.ok(Buffer.byteLength(body) <= 12000); assert.equal(request.state, 'partial'); assert.match(body, /findings omitted/);
  assert.equal((body.match(/<details>/g) ?? []).length, (body.match(/<\/details>/g) ?? []).length);
  assert.ok(!body.includes('@hellt')); assert.ok(!body.includes('](https://evil'));
  assert.ok(body.endsWith(FOOTER));
});
test('restricted Mermaid grammar supports useful diagrams and rejects executable/invalid forms', () => {
  assert.ok(diagram('flowchart TD\nA["Node loop"]\nB["Runtime query"]\nA --> B'));
  assert.ok(diagram('sequenceDiagram\nparticipant A as CLI\nparticipant B as Runtime\nA->>B: Query'));
  for (const value of ['flowchart TD\nclick A "https://evil"', 'flowchart TD\nA["<script>"]', '%%{init:{}}%%\nflowchart TD',
    'flowchart TD\nA --> Missing', 'sequenceDiagram\nparticipant A\nA->>B: Hi']) assert.equal(diagram(value), null);
});

test('hostile fields stay literal, reserved Mermaid words are rejected and metadata respects small byte budgets', () => {
  const hostile = '<script> @hellt | ```mermaid [evil](https://evil.example)';
  const result = ResultSchema.parse({ version: 1, findings: [{ ...finding, title: hostile, problem: hostile, suggestion: hostile }], coverage: { complete: true, notes: [] } });
  const normal = renderReport(r, result, manifest).body;
  assert.match(normal, /&#60;script&#62;/); assert.match(normal, /&#64;hellt/); assert.match(normal, /&#96;&#96;&#96;/);
  assert.ok(!normal.includes('](https://evil')); assert.equal((normal.match(/<details>/g) ?? []).length, 1);
  assert.equal(diagram('flowchart TD\nend["End"]\nA["A"]\nA --> end'), null);
  const limited = renderReport(r, result, manifest, { maxBytes: 4000, notes: Array.from({ length: 10 }, (_, i) => `${i}${'&'.repeat(2000)}`) });
  assert.ok(Buffer.byteLength(limited.body) <= 4000); assert.ok(limited.body.endsWith(FOOTER)); assert.match(limited.body, /additional coverage limitations/);
});

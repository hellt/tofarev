import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config, apiKey, MODEL, ENDPOINT } from './config.js';
import { review } from './opencode.js';
import type { Finding, Manifest, Result } from './types.js';

export type Case = { name: string; before: Record<string, string>; after: Record<string, string>;
  expected: { path: string; pattern: string; priorities: Finding['priority'][] }[] };
export const cases: Case[] = [
  { name: 'missing-docs', before: { 'cmd/deploy.go': 'package cmd\n// timeout defaults to 30 seconds\nconst Timeout = 30\n', 'docs/cmd/deploy.md': 'Deploy waits 30 seconds by default.\n' },
    after: { 'cmd/deploy.go': 'package cmd\n// timeout defaults to 60 seconds\nconst Timeout = 60\n' }, expected: [{ path: 'cmd/deploy.go', pattern: 'doc|30|60', priorities: ['P2', 'P3'] }] },
  { name: 'removed-behavior-docs', before: { 'cmd/deploy.go': 'package cmd\nvar Flags = []string{"--legacy"}\n', 'docs/cmd/deploy.md': 'Pass --legacy to deploy older labs.\n' },
    after: { 'cmd/deploy.go': 'package cmd\nvar Flags = []string{}\n' }, expected: [{ path: 'cmd/deploy.go', pattern: 'doc|legacy', priorities: ['P2', 'P3'] }] },
  { name: 'topology-schema', before: { 'types/node.go': 'package types\ntype Node struct { Name string `yaml:"name"` }\n', 'schemas/clab.schema.json': '{"type":"object","properties":{"name":{"type":"string"}},"additionalProperties":false}\n' },
    after: { 'types/node.go': 'package types\ntype Node struct { Name string `yaml:"name"`; BootDelay int `yaml:"boot-delay"` }\n', 'docs/topology.md': 'boot-delay configures startup delay in seconds.\n' }, expected: [{ path: 'types/node.go', pattern: 'schema|boot-delay', priorities: ['P2'] }] },
  { name: 'internal-api-no-schema', before: { 'core/helper.go': 'package core\nfunc sum(a, b int) int { return a+b }\nfunc total() int { return sum(1,2) }\n' },
    after: { 'core/helper.go': 'package core\nfunc sum(a, b, c int) int { return a+b+c }\nfunc total() int { return sum(1,2,3) }\n' }, expected: [] },
  { name: 'compatible-helper-reuse', before: { 'core/ports.go': 'package core\nimport "strings"\nfunc normalized(s string) string { return strings.TrimSpace(s) }\nfunc port(s string) string { return s }\n' },
    after: { 'core/ports.go': 'package core\nimport "strings"\nfunc normalized(s string) string { return strings.TrimSpace(s) }\nfunc port(s string) string { return strings.TrimSpace(s) }\n' }, expected: [{ path: 'core/ports.go', pattern: 'duplicat|reuse|normalized', priorities: ['P4'] }] },
  { name: 'unnecessary-abstraction', before: { 'core/name.go': 'package core\nfunc name() string { return "lab" }\n' },
    after: { 'core/name.go': 'package core\ntype NameProvider interface { Name() string }\ntype staticName struct{}\nfunc (staticName) Name() string { return "lab" }\nfunc name() string { var p NameProvider = staticName{}; return p.Name() }\n' }, expected: [{ path: 'core/name.go', pattern: 'abstract|interface|simpl', priorities: ['P4'] }] },
  { name: 'repeated-expensive-work', before: { 'core/lookup.go': 'package core\nimport "os"\nfunc lookup(names []string) ([]byte,error) { return os.ReadFile("inventory.json") }\n' },
    after: { 'core/lookup.go': 'package core\nimport "os"\n// names can contain thousands of nodes; inventory is constant during this operation.\nfunc lookup(names []string) ([]byte,error) { var out []byte; for range names { b,e:=os.ReadFile("inventory.json"); if e!=nil{return nil,e}; out=b }; return out,nil }\n' }, expected: [{ path: 'core/lookup.go', pattern: 'read|loop|repeat|I/O', priorities: ['P2', 'P3'] }] },
  { name: 'justified-ponytail-tradeoff', before: { 'core/name.go': 'package core\nfunc name(s string) string { return s }\n' },
    after: { 'core/name.go': 'package core\nimport "strings"\n// ponytail: Keep this one-off CLI normalization inline; the other helper lowercases identifiers and would change case-sensitive node names.\nfunc name(s string) string { return strings.TrimSpace(s) }\nfunc normalized(s string) string { return strings.ToLower(strings.TrimSpace(s)) }\n' }, expected: [] },
  { name: 'duplicate-root-causes', before: { 'core/ratio.go': 'package core\nfunc ratio(a,b int) int { if b==0{return 0};return a/b }\nfunc nodeRatio(n int) int {return ratio(10,n)}\nfunc linkRatio(n int) int {return ratio(20,n)}\n' },
    after: { 'core/ratio.go': 'package core\nfunc ratio(a,b int) int { return a/b }\nfunc nodeRatio(n int) int {return ratio(10,n)}\nfunc linkRatio(n int) int {return ratio(20,n)}\n' }, expected: [{ path: 'core/ratio.go', pattern: 'zero|divi|panic', priorities: ['P2'] }] },
  { name: 'no-defect', before: { 'core/add.go': 'package core\nfunc add(a,b int) int {return a+b}\n' },
    after: { 'core/add.go': 'package core\n// add returns the sum.\nfunc add(a,b int) int {return a+b}\n' }, expected: [] },
];
export function score(test: Case, result: Result | null) {
  const remaining = [...(result?.findings ?? [])]; let matched = 0, severity = 0;
  for (const expected of test.expected) {
    const i = remaining.findIndex(f => f.location.path === expected.path && new RegExp(expected.pattern, 'i').test(`${f.title} ${f.problem} ${f.impact}`));
    if (i >= 0) { const [f] = remaining.splice(i, 1); matched++; if (expected.priorities.includes(f!.priority)) severity++; }
  }
  return { name: test.name, expected: test.expected.length, matched, missed: test.expected.length - matched,
    falsePositives: remaining.length, correctSeverity: severity, completeCoverage: result?.coverage.complete ?? false };
}
export async function evaluationSource(test: Case) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tofarev-eval-'));
  const m: Manifest = { version: 1, head: 'a'.repeat(40), base: 'b'.repeat(40), mergeBase: 'b'.repeat(40), files: [], changed: [], notes: [], incomplete: false };
  const after = { ...test.before, ...test.after };
  for (const [rev, files] of [['base', test.before], ['head', after]] as const) for (const [file, text] of Object.entries(files)) {
    const dest = path.join(dir, rev, file); await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, text);
    m.files.push({ revision: rev, path: file, lines: text.split('\n').length - Number(text.endsWith('\n')), bytes: Buffer.byteLength(text) });
  }
  m.changed = Object.keys(test.after).map(p => ({ status: p in test.before ? 'M' : 'A', path: p }));
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  await writeFile(path.join(dir, 'diff.txt'), Object.entries(test.after).map(([p, text]) => `--- base/${p}\n+++ head/${p}\n${(test.before[p] ?? '').split('\n').map(l => '-'+l).join('\n')}\n${text.split('\n').map(l => '+'+l).join('\n')}`).join('\n'));
  await writeFile(path.join(dir, 'standards.json'), JSON.stringify([{ path: 'evaluation-only', revision: m.base, file: 'evaluation-standards.txt' }], null, 2));
  await writeFile(path.join(dir, 'evaluation-standards.txt'), 'Karpathy: prefer clear, minimal changes and evidence. Ponytail: avoid unnecessary abstraction; respect a documented ponytail: tradeoff when justified. These are synthetic evaluation standards, not production repository rules.');
  return dir;
}
function live() { if (process.env.TOFAREV_LIVE !== '1') throw new Error('Set TOFAREV_LIVE=1 to opt into paid inference'); return apiKey(); }
export async function probe() {
  const key = live(); const models = await fetch(`${ENDPOINT}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
  if (!models.ok) throw new Error('Token Factory model access unavailable');
  const catalog = await models.json() as { data?: { id: string }[] };
  if (!catalog.data?.some(m => m.id === MODEL)) throw new Error('Required model unavailable');
  const dir = await evaluationSource(cases[cases.length - 1]!); let toolEvidence = false;
  try {
    const transport: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)); toolEvidence ||= body.messages.some((m: { role: string }) => m.role === 'tool');
      return fetch(url, init);
    };
    const out = await review(dir, config(), { key, transport });
    if (out.failed || !out.result || !toolEvidence) throw new Error('Live model/tool-calling compatibility probe failed');
    return { model: MODEL, modelAccess: true, toolCalling: true, structuredResult: true };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export async function evaluate(selected?: string) {
  const key = live(); const selectedCases = selected ? cases.filter(c => c.name === selected) : cases;
  if (!selectedCases.length) throw new Error('Unknown evaluation case');
  const scores = [];
  for (const test of selectedCases) {
    const dir = await evaluationSource(test);
    try { const out = await review(dir, config(), { key }); scores.push({ ...score(test, out.result), executionFailed: out.failed, notes: out.notes }); }
    finally { await rm(dir, { recursive: true, force: true }); }
  }
  return { model: MODEL, scores };
}

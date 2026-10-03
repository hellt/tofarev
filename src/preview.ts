import type { Finding, Manifest, Request, Result } from './types.js';
import { renderReport } from './report.js';
export function exampleReport(mode = 'findings') {
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const request: Request = { version: 1, repository: 'srl-labs/containerlab', repositoryId: 290960521,
    key: '290960521:1', pr: 1, triggerId: 1, head, base, mergeBase: base, policy: 'd'.repeat(64),
    runUrl: 'https://github.com/srl-labs/containerlab/actions/runs/1', state: 'running' };
  const manifest: Manifest = { version: 1, head, base, mergeBase: base,
    files: [{ revision: 'head', path: 'core/lab.go', lines: 100, bytes: 1000 }], changed: [], notes: [], incomplete: false };
  const findings: Finding[] = ['P0', 'P1', 'P2', 'P3', 'P4'].map((priority, i) => ({
    priority: priority as Finding['priority'], title: `Example finding at ${priority}`, location: { revision: 'head', path: 'core/lab.go', start: i + 1, end: i + 1 },
    problem: 'Illustrative issue; this is not a review of real Containerlab code.', trigger: 'The changed branch receives the input described here.',
    impact: 'Describe a concrete consequence and justify severity.', suggestion: 'Describe the smallest practical correction.',
    ...(i === 2 ? { diagram: 'flowchart TD\nA["Input"]\nB["Changed behavior"]\nA --> B' } : {}),
  }));
  const result: Result = { version: 1, findings: mode === 'empty' ? [] : findings, coverage: { complete: mode !== 'partial', notes: mode === 'partial' ? ['Some changed files were omitted.'] : [] } };
  return renderReport(request, mode === 'failed' ? null : result, manifest, { currentHead: mode === 'stale' ? 'c'.repeat(40) : head }).body;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'yaml';
import { consumerWorkflow } from '../src/consumer.js';
import { exampleReport } from '../src/preview.js';

test('workflow pins dependencies and confines credentials to their jobs and steps', async () => {
  const workflow = parse(await readFile('.github/workflows/review.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.jobs), ['prepare', 'review', 'progress', 'publish']);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  for (const [name, job] of Object.entries(workflow.jobs) as [string, any][]) {
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout')) assert.equal(step.with['persist-credentials'], false);
    }
    const json = JSON.stringify(job);
    assert.equal(json.includes('secrets.TOFAREV_API_KEY'), name === 'review');
    assert.equal(json.includes('secrets.TOFAREV_APP_PRIVATE_KEY'), name !== 'review');
    assert.ok(!json.includes('secrets: inherit'));
  }
  const review = JSON.stringify(workflow.jobs.review);
  for (const flag of ['--read-only', '--cap-drop ALL', 'no-new-privileges', 'dst=/source,readonly', '/home/node:rw']) assert.ok(review.includes(flag));
  assert.ok(!review.includes('TOFAREV_GITHUB_TOKEN')); assert.ok(!review.includes('docker.sock'));
  assert.match(workflow.jobs.publish.if, /always\(\)/);
  assert.deepEqual(workflow.jobs.publish.needs, ['prepare', 'review', 'progress']);
  assert.equal(workflow.jobs.progress.permissions.actions, 'read');
  assert.equal(workflow.jobs.progress['continue-on-error'], true);
  const consumerText = consumerWorkflow('owner/tofarev', 'a'.repeat(40));
  assert.equal(await readFile('docs/examples/containerlab-workflow.yml', 'utf8'), consumerText);
  const consumer = parse(consumerText);
  assert.deepEqual(consumer.on.issue_comment.types, ['created']);
  assert.equal(consumer.jobs.review.secrets.TOFAREV_API_KEY, '${{ secrets.TOFAREV_API_KEY }}');
  for (const key of Object.keys(consumer.jobs.review.with)) assert.ok(workflow.on.workflow_call.inputs[key]);
  for (const key of Object.keys(consumer.jobs.review.secrets)) assert.ok(workflow.on.workflow_call.secrets[key]);
  assert.throws(() => consumerWorkflow('owner/tofarev', 'main'));
});
test('golden report previews match deterministic renderer', async () => {
  for (const mode of ['findings', 'empty', 'partial', 'stale', 'failed', 'shared']) {
    assert.equal(await readFile(`docs/examples/${mode}.md`, 'utf8'), exampleReport(mode) + '\n');
  }
});
test('review workflow exposes the live link before completion and preserves the container exit code', async () => {
  const workflow = parse(await readFile('.github/workflows/review.yml', 'utf8'));
  const work = await mkdtemp(path.join(os.tmpdir(), 'tofarev-background-test-'));
  try {
    await mkdir(path.join(work, '.work/source'), { recursive: true });
    await writeFile(path.join(work, 'docker'), '#!/bin/sh\necho "OpenCode review session: https://opncd.ai/share/test1234" >&2\nsleep 3\necho "{}"\nexit 7\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${work}:${process.env.PATH}`, TRUSTED_CONFIG: '{}', GITHUB_OUTPUT: path.join(work, 'outputs') };
    const run = promisify(execFile);
    const step = (name: string) => workflow.jobs.review.steps.find((s: any) => s.name === name).run;
    await run('/bin/bash', ['-e', '-c', step('Run isolated reviewer')], { cwd: work, env });
    assert.deepEqual(JSON.parse(await readFile(path.join(work, '.work/session.json'), 'utf8')), { url: 'https://opncd.ai/share/test1234' });
    await assert.rejects(access(path.join(work, '.work/reviewer.exit')));
    await assert.rejects(run('/bin/bash', ['-e', '-c', step('Wait for isolated reviewer')], { cwd: work, env }), (e: any) => e.code === 7 && e.stdout.includes('OpenCode review session:'));
    assert.equal((await readFile(path.join(work, '.work/reviewer.exit'), 'utf8')).trim(), '7');
  } finally { await rm(work, { recursive: true, force: true }); }
});

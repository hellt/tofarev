import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { consumerWorkflow } from '../src/consumer.js';
import { exampleReport } from '../src/preview.js';

test('workflow pins dependencies and confines credentials to their jobs and steps', async () => {
  const workflow = parse(await readFile('.github/workflows/review.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.jobs), ['prepare', 'review', 'publish']);
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
  for (const mode of ['findings', 'empty', 'partial', 'stale', 'failed']) {
    assert.equal(await readFile(`docs/examples/${mode}.md`, 'utf8'), exampleReport(mode) + '\n');
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('failed review emits a finalizable JSON artifact and exits unsuccessfully', () => {
  const env = { ...process.env }; delete env.TOFAREV_API_KEY;
  const result = spawnSync(process.execPath, ['dist/src/cli.js', 'review', '/missing-source'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.failed, true); assert.equal(output.result, null); assert.ok(output.notes.length);
});

test('live probe and evaluator require opt-in and credentials without leaking them', () => {
  for (const command of ['probe', 'evaluate']) for (const optIn of ['', '1']) {
    const env: NodeJS.ProcessEnv = { ...process.env, TOFAREV_LIVE: optIn }; delete env.TOFAREV_API_KEY;
    const result = spawnSync(process.execPath, ['dist/src/cli.js', command], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /TOFAREV_LIVE=1.*TOFAREV_API_KEY.*GLM-5.3-Flash/); assert.equal(result.stdout, '');
  }
});

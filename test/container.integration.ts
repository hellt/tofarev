import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';

test('production container runs non-root with read-only source/root and no publisher credentials', async () => {
  assert.equal(process.getuid!(), 1000);
  assert.equal(process.env.TOFAREV_GITHUB_TOKEN, undefined);
  assert.equal(process.env.TOFAREV_APP_PRIVATE_KEY, undefined);
  assert.ok(await readFile('/source/containerlab-review.md', 'utf8'));
  await assert.rejects(writeFile('/source/SHOULD_NOT_EXIST', 'bad'));
  await assert.rejects(writeFile('/app/SHOULD_NOT_EXIST', 'bad'));
});

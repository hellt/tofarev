import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiKey, config, ENDPOINT, MODEL } from '../src/config.js';

test('production configuration is explicit and invalid settings fail closed', () => {
  const c = config();
  assert.equal(c.repositoryId, 290960521);
  assert.deepEqual(c.allowedUsers, ['hellt', 'flosch62', 'kaelemc']);
  assert.equal(c.limits.turns, undefined);
  assert.equal(MODEL, 'zai-org/GLM-5.3-Flash');
  assert.equal(ENDPOINT, 'https://api.tokenfactory.nebius.com/v1');
  for (const bad of [{ repository: '../x' }, { allowedUsers: [] }, { model: 'other' }, { limits: { turns: 0 } }]) {
    assert.throws(() => config(bad));
  }
  assert.throws(() => apiKey({}), /TOFAREV_API_KEY/);
  assert.equal(apiKey({ TOFAREV_API_KEY: 'test-key' }), 'test-key');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { FEATURE_CATALOG, featureAllowed } = require('../lib/feature-access');

test('Super Admin catalog includes all available games', () => {
  const gameKeys = FEATURE_CATALOG.filter(item => item.kind === 'game').map(item => item.key);
  assert.deepEqual(gameKeys, ['games', 'batalha', 'caca', 'bichinho', 'tres', 'duelo', 'corda', 'quiz']);
});

test('CORDA honors its own permission while keeping legacy account behavior', () => {
  assert.equal(featureAllowed({ role: 'user', features: { duelo: false } }, 'corda'), false);
  assert.equal(featureAllowed({ role: 'user', features: { duelo: false, corda: true } }, 'corda'), true);
  assert.equal(featureAllowed({ role: 'user', features: { duelo: true, corda: false } }, 'duelo'), true);
  assert.equal(featureAllowed({ role: 'user', features: { duelo: true, corda: false } }, 'corda'), false);
});

test('admins and accounts without explicit feature restrictions keep access', () => {
  assert.equal(featureAllowed({ role: 'admin', features: { quiz: false } }, 'quiz'), true);
  assert.equal(featureAllowed({ role: 'user', features: {} }, 'quiz'), true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCredentialFlags } from '../src/args.js';

const VAULT = { user: 'admin', pass: 'vault-secret' };

test('without flags the Trellis credentials are used', () => {
  assert.deepEqual(applyCredentialFlags(VAULT, {}), VAULT);
});

test('--user overrides the Trellis username and keeps the vault password', () => {
  assert.deepEqual(applyCredentialFlags(VAULT, { user: 'jasper' }), { user: 'jasper', pass: 'vault-secret' });
});

test('--user and --pass both override', () => {
  assert.deepEqual(applyCredentialFlags(VAULT, { user: 'jasper', pass: 'own' }), { user: 'jasper', pass: 'own' });
});

test('empty flags keep the Trellis values', () => {
  assert.deepEqual(applyCredentialFlags(VAULT, { user: '', pass: '' }), VAULT);
});

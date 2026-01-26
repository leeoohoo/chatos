import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBoolEnv } from './env-utils.js';

test('resolveBoolEnv handles truthy values', () => {
  assert.equal(resolveBoolEnv('true', false), true);
  assert.equal(resolveBoolEnv('1', false), true);
  assert.equal(resolveBoolEnv(' yes ', false), true);
  assert.equal(resolveBoolEnv('ON', false), true);
});

test('resolveBoolEnv handles falsey values', () => {
  assert.equal(resolveBoolEnv('false', true), false);
  assert.equal(resolveBoolEnv('0', true), false);
  assert.equal(resolveBoolEnv(' no ', true), false);
  assert.equal(resolveBoolEnv('off', true), false);
});

test('resolveBoolEnv falls back when unknown', () => {
  assert.equal(resolveBoolEnv('maybe', true), true);
  assert.equal(resolveBoolEnv('maybe', false), false);
  assert.equal(resolveBoolEnv('', true), true);
  assert.equal(resolveBoolEnv(undefined, false), false);
});

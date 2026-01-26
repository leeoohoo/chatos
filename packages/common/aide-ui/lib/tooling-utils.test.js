import assert from 'node:assert/strict';
import test from 'node:test';

import { inferToolKind, normalizeToolStatus } from './tooling-utils.js';

test('inferToolKind recognizes code maintainer tools', () => {
  assert.equal(inferToolKind('mcp_code_maintainer_apply_patch'), 'code_maintainer');
});

test('normalizeToolStatus maps statuses and color fallback', () => {
  assert.equal(normalizeToolStatus('success'), 'ok');
  assert.equal(normalizeToolStatus('timed_out'), 'timeout');
  assert.equal(normalizeToolStatus('', { color: 'red' }), 'error');
  assert.equal(normalizeToolStatus('unknown', { fallback: 'unknown' }), 'unknown');
});

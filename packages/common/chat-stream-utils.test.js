import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFinalTextFromChunks } from './chat-stream-utils.js';

test('buildFinalTextFromChunks joins map entries in numeric order', () => {
  const chunks = new Map([
    [2, 'c'],
    [0, 'a'],
    [1, 'b'],
  ]);
  assert.equal(buildFinalTextFromChunks(chunks), 'abc');
});

test('buildFinalTextFromChunks joins object entries and stringifies values', () => {
  const chunks = {
    1: 'b',
    0: 'a',
    2: 3,
  };
  assert.equal(buildFinalTextFromChunks(chunks), 'ab3');
});

test('buildFinalTextFromChunks ignores non-numeric keys', () => {
  const chunks = {
    foo: 'x',
    2: 'c',
    1: 'b',
  };
  assert.equal(buildFinalTextFromChunks(chunks), 'bc');
});

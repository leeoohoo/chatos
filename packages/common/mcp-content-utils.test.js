import assert from 'node:assert/strict';
import test from 'node:test';

import { approxSize, extractContentText } from './mcp-content-utils.js';

test('extractContentText trims text blocks when requested', () => {
  const blocks = [
    { type: 'text', text: '  hello  ' },
    { type: 'text', text: 'world' },
  ];
  const result = extractContentText(blocks, { trimText: true, trimResult: true });
  assert.equal(result, 'hello\nworld');
});

test('extractContentText includes non-text blocks when enabled', () => {
  const blocks = [
    { type: 'text', text: 'hello' },
    { type: 'resource_link', uri: 'http://example.test' },
    { type: 'image', mimeType: 'image/png', data: 'a'.repeat(2048) },
  ];
  const result = extractContentText(blocks, { includeNonText: true, trimText: true });
  assert.ok(result.includes('hello'));
  assert.ok(result.includes('http://example.test'));
  assert.ok(result.includes('image/png'));
});

test('approxSize estimates base64 size', () => {
  assert.equal(approxSize('AAAA'), '3B');
  assert.equal(approxSize('a'.repeat(2048)), '1.5KB');
});

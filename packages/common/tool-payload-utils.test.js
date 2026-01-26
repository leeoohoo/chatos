import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePatchPayload, resolveWritePayload } from './tool-payload-utils.js';

test('resolveWritePayload decodes base64 contents', () => {
  const encoded = Buffer.from('hello', 'utf8').toString('base64');
  const text = resolveWritePayload({ contents_base64: encoded }, { fallbackToRaw: true });
  assert.equal(text, 'hello');
});

test('resolveWritePayload joins chunk payloads', () => {
  const encoded = Buffer.from('b', 'utf8').toString('base64');
  const text = resolveWritePayload(
    {
      chunks: [
        { content: 'a', encoding: 'plain' },
        { content: encoded, encoding: 'base64' },
      ],
    },
    { fallbackToRaw: true }
  );
  assert.equal(text, 'ab');
});

test('resolvePatchPayload can ensure trailing newline', () => {
  const text = resolvePatchPayload({ patch: 'diff' }, { ensureTrailingNewline: true });
  assert.equal(text, 'diff\n');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseToolArguments } from './client-helpers.js';

test('parseToolArguments returns empty object for blank input', () => {
  assert.deepEqual(parseToolArguments('noop', '', { type: 'object', properties: {} }), {});
  assert.deepEqual(parseToolArguments('noop', '   ', { type: 'object', properties: {} }), {});
});

test('parseToolArguments repairs unescaped quotes/commas inside string values', () => {
  const schema = {
    type: 'object',
    properties: {
      folder: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  const raw = `{"folder":"x","title":"y","content":"{\n  "a": "b",\n}","tags":["t"]}`;
  const parsed = parseToolArguments('mcp_com_leeoohoo_notepad_manager_create_note', raw, schema);
  assert.equal(parsed.folder, 'x');
  assert.equal(parsed.title, 'y');
  assert.equal(parsed.content, '{\n  "a": "b",\n}');
  assert.deepEqual(parsed.tags, ['t']);
});

test('parseToolArguments keeps nested JSON-like snippets inside content', () => {
  const schema = {
    type: 'object',
    properties: {
      folder: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  const raw = `{"folder":"x","title":"y","content":"{\n  "name": "Alice",\n  "age": 30,\n  "meta": {"k": "v"}\n}","tags":["t"]}`;
  const parsed = parseToolArguments('mcp_com_leeoohoo_notepad_manager_create_note', raw, schema);
  assert.equal(
    parsed.content,
    '{\n  "name": "Alice",\n  "age": 30,\n  "meta": {"k": "v"}\n}'
  );
});

test('parseToolArguments repairs single-quoted strings and unquoted keys', () => {
  const schema = {
    type: 'object',
    properties: {
      folder: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  const raw = `{folder:'x' title:'y',content:'{"a": "b"}',tags:['t']}`;
  const parsed = parseToolArguments('mcp_com_leeoohoo_notepad_manager_create_note', raw, schema);
  assert.equal(parsed.folder, 'x');
  assert.equal(parsed.title, 'y');
  assert.equal(parsed.content, '{"a": "b"}');
  assert.deepEqual(parsed.tags, ['t']);
});

test('parseToolArguments closes truncated JSON objects', () => {
  const schema = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      contents: { type: 'string' },
    },
  };

  const raw = `{"path":"x","contents":"hello"`;
  const parsed = parseToolArguments('mcp_code_maintainer_write_file', raw, schema);
  assert.equal(parsed.path, 'x');
  assert.equal(parsed.contents, 'hello');
});


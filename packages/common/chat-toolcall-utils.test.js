import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeToolCallMessages } from './chat-toolcall-utils.js';

test('normalizeToolCallMessages drops dangling tool calls in drop mode', () => {
  const messages = [
    { role: 'assistant', content: 'a', tool_calls: [{ id: 'call_1' }] },
    { role: 'user', content: 'next' },
  ];
  const { messages: normalized } = normalizeToolCallMessages(messages, { pendingMode: 'drop' });
  assert.deepEqual(normalized, [{ role: 'user', content: 'next' }]);
});

test('normalizeToolCallMessages assigns missing tool_call_id when enabled', () => {
  const messages = [
    { role: 'assistant', content: 'a', tool_calls: [{ id: 'call_1' }] },
    { role: 'tool', content: 'ok' },
  ];
  const { messages: normalized } = normalizeToolCallMessages(messages, {
    pendingMode: 'drop',
    assignMissingToolCallId: true,
    ensureUniqueToolCallIds: true,
  });
  assert.equal(normalized[1].tool_call_id, 'call_1');
});

test('normalizeToolCallMessages strips toolCalls when pending breaks', () => {
  const messages = [
    { role: 'assistant', content: 'a', toolCalls: [{ id: 'tool_1' }] },
    { role: 'user', content: 'next' },
  ];
  const { messages: normalized } = normalizeToolCallMessages(messages, {
    toolCallsKey: 'toolCalls',
    toolCallIdKey: 'toolCallId',
    pendingMode: 'strip',
  });
  assert.deepEqual(normalized[0].toolCalls, []);
  assert.equal(normalized[0].content, 'a');
  assert.equal(normalized[1].role, 'user');
});

test('normalizeToolCallMessages keeps toolCalls without ids in strip mode', () => {
  const messages = [
    { role: 'assistant', content: 'a', toolCalls: [{ name: 'noop' }] },
  ];
  const { messages: normalized } = normalizeToolCallMessages(messages, {
    toolCallsKey: 'toolCalls',
    toolCallIdKey: 'toolCallId',
    pendingMode: 'strip',
  });
  assert.deepEqual(normalized[0].toolCalls, [{ name: 'noop' }]);
});

import { normalizeToolCallMessages } from '../../packages/common/chat-toolcall-utils.js';
import { buildUserMessageContent } from '../../packages/common/chat-utils.js';
import { normalizeId } from './normalize.js';

export function normalizeConversationMessages(messages) {
  const { messages: normalized } = normalizeToolCallMessages(messages, {
    toolCallsKey: 'toolCalls',
    toolCallIdKey: 'toolCallId',
    normalizeId,
    pendingMode: 'strip',
  });
  return normalized;
}

export function buildChatSessionFromMessages({
  ChatSession,
  sessionId,
  systemPrompt,
  messages,
  allowVisionInput,
  extraSystemPrompts,
  trailingSystemPrompts,
} = {}) {
  const { messages: normalizedMessages } = normalizeToolCallMessages(messages, {
    toolCallsKey: 'toolCalls',
    toolCallIdKey: 'toolCallId',
    normalizeId,
    pendingMode: 'strip',
  });
  const chatSession = new ChatSession(systemPrompt || null, {
    sessionId,
    ...(extraSystemPrompts ? { extraSystemPrompts } : {}),
  });
  if (trailingSystemPrompts) {
    chatSession.setTrailingSystemPrompts(trailingSystemPrompts);
  }
  normalizedMessages.forEach((msg) => {
    const role = msg?.role;
    if (role === 'user') {
      const content = buildUserMessageContent({
        text: msg?.content || '',
        attachments: msg?.attachments,
        allowVisionInput,
      });
      if (content) {
        chatSession.addUser(content);
      }
      return;
    }
    if (role === 'assistant') {
      const toolCalls = Array.isArray(msg?.toolCalls) ? msg.toolCalls.filter(Boolean) : null;
      const usableToolCalls = toolCalls && toolCalls.length > 0 ? toolCalls : null;
      const rawContent = msg?.content;
      const normalizedContent =
        usableToolCalls && (!rawContent || (typeof rawContent === 'string' && !rawContent.trim()))
          ? null
          : rawContent || '';
      chatSession.addAssistant(normalizedContent, usableToolCalls);
      return;
    }
    if (role === 'tool') {
      const callId = normalizeId(msg?.toolCallId);
      if (!callId) return;
      chatSession.addToolResult(callId, msg?.content || '', msg?.toolName || msg?.name);
    }
  });
  return chatSession;
}

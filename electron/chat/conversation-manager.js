import {
  SUMMARY_MESSAGE_NAME,
  appendSummaryText,
  extractLatestSummaryText,
  pickLatestSummaryMessage,
} from '../../packages/common/chat-summary-utils.js';
import { computeTailStartIndex } from '../../packages/common/chat-tail-utils.js';
import { normalizeId } from './normalize.js';
import { buildChatSessionFromMessages, normalizeConversationMessages } from './chat-session-utils.js';

export function createConversationManager({
  store,
  sessionId,
  userMessageId,
  initialAssistantMessageId,
  systemPrompt,
  allowVisionInput,
  summaryThreshold,
  summaryKeepRatio,
  summaryConfigPath,
  ChatSession,
  estimateTokenCount,
  summarizeSession,
  throwIfAborted,
  client,
  modelName,
  touchSessionUpdatedAt,
  notifyMessagesRefresh,
} = {}) {
  if (!store) throw new Error('store is required');
  const sid = typeof sessionId === 'string' ? sessionId : '';
  const safeTouch = typeof touchSessionUpdatedAt === 'function' ? touchSessionUpdatedAt : () => {};
  const safeNotify = typeof notifyMessagesRefresh === 'function' ? notifyMessagesRefresh : () => {};

  const listSessionMessages = () => store.messages.list(sid);
  const getConversationSnapshot = () => {
    const all = listSessionMessages();
    const summaryRecord = pickLatestSummaryMessage(all);
    const filtered = all
      .filter((msg) => msg?.id !== initialAssistantMessageId)
      .filter((msg) => msg?.role !== 'system');
    const conversation = normalizeConversationMessages(filtered);
    return { all, summaryRecord, conversation };
  };
  const buildRequestSession = () => {
    const snapshot = getConversationSnapshot();
    const summaryRecord = snapshot.summaryRecord;
    const trailingPrompts =
      summaryRecord && typeof summaryRecord?.content === 'string' && summaryRecord.content.trim()
        ? [{ content: summaryRecord.content, name: SUMMARY_MESSAGE_NAME }]
        : null;
    return buildChatSessionFromMessages({
      ChatSession,
      sessionId: sid,
      systemPrompt,
      messages: snapshot.conversation,
      allowVisionInput,
      trailingSystemPrompts: trailingPrompts,
    });
  };
  let chatSession = buildRequestSession();
  const rebuildChatSession = () => {
    chatSession = buildRequestSession();
    return chatSession;
  };

  const estimateConversationTokens = (conversation, summaryRecord) => {
    const parts = [];
    if (systemPrompt) {
      parts.push({ role: 'system', content: systemPrompt });
    }
    if (summaryRecord && typeof summaryRecord.content === 'string' && summaryRecord.content.trim()) {
      parts.push({ role: 'system', content: summaryRecord.content });
    }
    parts.push(...(Array.isArray(conversation) ? conversation : []));
    return estimateTokenCount(parts);
  };

  const summarizeConversation = async ({ force = false, signal } = {}) => {
    const defaultThreshold = 60000;
    const threshold = Number.isFinite(summaryThreshold) ? summaryThreshold : defaultThreshold;
    const targetThreshold = threshold > 0 ? threshold : defaultThreshold;
    if (!force && !(threshold > 0)) return false;
    const keepRatio =
      Number.isFinite(summaryKeepRatio) && summaryKeepRatio > 0 && summaryKeepRatio < 1
        ? summaryKeepRatio
        : 0.3;
    const maxPasses = force ? 6 : 3;
    let didSummarize = false;

    for (let pass = 0; pass < maxPasses; pass += 1) {
      if (typeof throwIfAborted === 'function') {
        throwIfAborted(signal);
      } else if (signal?.aborted) {
        throw new Error('aborted');
      }
      const snapshot = getConversationSnapshot();
      const conversation = snapshot.conversation;
      if (conversation.length < 2) return didSummarize;
      const tokenCount = estimateConversationTokens(conversation, snapshot.summaryRecord);
      if (!force && tokenCount <= threshold) return didSummarize;
      if (force && tokenCount <= targetThreshold && pass > 0) return didSummarize;

      const summarySession = buildChatSessionFromMessages({
        ChatSession,
        sessionId: sid,
        systemPrompt,
        messages: conversation,
        allowVisionInput,
        extraSystemPrompts:
          snapshot.summaryRecord && typeof snapshot.summaryRecord.content === 'string'
            ? [{ content: snapshot.summaryRecord.content, name: SUMMARY_MESSAGE_NAME }]
            : null,
      });

      let changed = false;
      try {
        changed = await summarizeSession(summarySession, client, modelName, {
          keepRatio,
          signal,
          configPath: summaryConfigPath || undefined,
        });
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) {
          throw err;
        }
        console.error(`[summary] Failed: ${err?.message || String(err)}`);
        return didSummarize;
      }

      if (!changed) return didSummarize;
      const summaryText = extractLatestSummaryText(summarySession.messages);
      if (!summaryText) return didSummarize;
      const maxTailTokens = Math.max(2000, Math.floor(targetThreshold * 0.4));
      let effectiveKeepRatio = keepRatio;
      let tailStartIndex = computeTailStartIndex(conversation, effectiveKeepRatio, estimateTokenCount);
      if (tailStartIndex > 0) {
        let tailTokens = estimateTokenCount(conversation.slice(tailStartIndex));
        let guard = 0;
        while (tailTokens > maxTailTokens && effectiveKeepRatio > 0.05 && guard < 5) {
          effectiveKeepRatio = Math.max(0.05, effectiveKeepRatio * 0.5);
          tailStartIndex = computeTailStartIndex(conversation, effectiveKeepRatio, estimateTokenCount);
          if (tailStartIndex <= 0) break;
          tailTokens = estimateTokenCount(conversation.slice(tailStartIndex));
          guard += 1;
        }
      }
      if (tailStartIndex <= 0) return didSummarize;

      const tail = conversation.slice(tailStartIndex);
      const keepIds = new Set(tail.map((msg) => normalizeId(msg?.id)).filter(Boolean));
      const assistantId = normalizeId(initialAssistantMessageId);
      if (assistantId) keepIds.add(assistantId);
      const currentUserId = normalizeId(userMessageId);
      if (currentUserId) keepIds.add(currentUserId);

      let summaryId = null;
      if (snapshot.summaryRecord?.id) {
        summaryId = normalizeId(snapshot.summaryRecord.id);
        if (summaryId) {
          const combined = appendSummaryText(snapshot.summaryRecord.content, summaryText);
          store.messages.update(summaryId, {
            content: combined,
            name: SUMMARY_MESSAGE_NAME,
            hidden: true,
          });
        }
      } else {
        const created = store.messages.create({
          sessionId: sid,
          role: 'system',
          content: summaryText,
          name: SUMMARY_MESSAGE_NAME,
          hidden: true,
        });
        summaryId = normalizeId(created?.id);
      }
      if (summaryId) keepIds.add(summaryId);

      snapshot.all.forEach((msg) => {
        const mid = normalizeId(msg?.id);
        if (!mid || keepIds.has(mid)) return;
        store.messages.remove(mid);
      });
      safeTouch();
      safeNotify();
      didSummarize = true;
    }

    if (didSummarize) {
      rebuildChatSession();
    }
    return didSummarize;
  };

  const hardTrimConversation = () => {
    const all = listSessionMessages();
    const summaryRecord = pickLatestSummaryMessage(all);
    const lastUser = (() => {
      for (let i = all.length - 1; i >= 0; i -= 1) {
        const msg = all[i];
        if (msg && msg.role === 'user') return msg;
      }
      return null;
    })();
    const keepIds = new Set();
    const assistantId = normalizeId(initialAssistantMessageId);
    if (assistantId) keepIds.add(assistantId);
    const currentUserId = normalizeId(userMessageId);
    if (currentUserId) keepIds.add(currentUserId);
    const summaryId = normalizeId(summaryRecord?.id);
    if (summaryId) keepIds.add(summaryId);
    const lastUserId = normalizeId(lastUser?.id);
    if (lastUserId) keepIds.add(lastUserId);
    all.forEach((msg) => {
      const mid = normalizeId(msg?.id);
      if (!mid || keepIds.has(mid)) return;
      store.messages.remove(mid);
    });
    safeTouch();
    safeNotify();
    rebuildChatSession();
  };

  return {
    getChatSession: () => chatSession,
    getConversationSnapshot,
    estimateConversationTokens,
    summarizeConversation,
    hardTrimConversation,
  };
}

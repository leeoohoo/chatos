import * as colors from '../colors.js';
import { generateSessionId } from '../session.js';

import { runWithContextLengthRecovery } from '../../shared/context-recovery-utils.js';
import { extractErrorInfo, isContextLengthError, normalizeErrorText } from '../../shared/error-utils.js';
import { normalizeToolCallMessages } from '../../shared/chat-toolcall-utils.js';
import { summarizeSession, throwIfAborted } from './summary.js';

async function chatWithContextRecovery({ client, model, session, options, summaryManager }) {
  // If a previous run was aborted mid-tool-call, the session may contain an assistant tool_calls
  // message without all tool results. Providers will 400 on that; repair it up-front.
  repairDanglingToolCalls(session, { preserveLatestUser: true });
  const runChat = async () => {
    try {
      return await client.chat(model, session, options);
    } catch (err) {
      if (!isToolCallProtocolError(err)) {
        throw err;
      }
      const signal = options?.signal;
      throwIfAborted(signal);
      const repaired = repairDanglingToolCalls(session, { preserveLatestUser: true });
      if (repaired) {
        console.log(colors.yellow('检测到悬挂的 tool_calls，已自动清理并重试。'));
        throwIfAborted(signal);
        return await client.chat(model, session, options);
      }
      console.log(colors.yellow('检测到 tool_calls 协议错误，但未能修复，继续抛出。'));
      throw err;
    }
  };

  const signal = options?.signal;
  let summaryError = null;
  const summarizeForContext = async () => {
    summaryError = null;
    let summarized = false;
    try {
      if (summaryManager?.forceSummarize) {
        summarized = await summaryManager.forceSummarize(session, client, model, { signal });
      } else {
        summarized = await summarizeSession(session, client, model, { signal });
      }
    } catch (errSummary) {
      summaryError = errSummary;
      const summaryMessage = normalizeErrorText(errSummary?.message || errSummary);
      console.log(colors.yellow(`自动总结失败${summaryMessage ? `：${summaryMessage}` : ''}`));
    }
    return summarized;
  };

  const hardTrimForContext = ({ reason, error } = {}) => {
    if (reason === 'summary_failed') {
      const reasonText = summaryError ? '自动总结失败' : '自动总结未缩短上下文';
      console.log(colors.yellow(`${reasonText}，将裁剪为最小上下文后重试。`));
    } else if (reason === 'summary_exceeded') {
      const nextInfo = parseContextLengthError(error);
      const nextDetail = formatContextErrorDetail(nextInfo);
      console.log(colors.yellow(`总结后仍超长，已强制裁剪为最小上下文后重试${nextDetail}`));
    }
    hardTrimSession(session);
  };

  const handleContextError = (err) => {
    const info = parseContextLengthError(err);
    const detail = formatContextErrorDetail(info);
    console.log(colors.yellow(`上下文过长，准备自动总结后重试${detail}`));
  };

  return await runWithContextLengthRecovery({
    run: runChat,
    summarize: summarizeForContext,
    hardTrim: hardTrimForContext,
    isContextLengthError,
    throwIfAborted,
    signal,
    retryIfSummarizeFailed: false,
    onContextError: handleContextError,
  });
}

function isToolCallProtocolError(err) {
  const message = String(err?.message || '');
  if (!message) return false;
  const lower = message.toLowerCase();
  // OpenAI-style error: "An assistant message with 'tool_calls' must be followed by tool messages..."
  return (
    lower.includes('tool_calls') &&
    (lower.includes('tool_call_id') ||
      lower.includes('tool messages') ||
      lower.includes('insufficient tool') ||
      lower.includes("role 'tool'") ||
      lower.includes('role \"tool\"') ||
      lower.includes('messages with role') ||
      lower.includes('must be a response to a preceding message'))
  );
}

function parseContextLengthError(err) {
  const info = extractErrorInfo(err);
  const messages = info.messages;
  const text = messages.join('\n');
  const structured = extractStructuredTokenCounts(err);
  const parsed = extractTokenCountsFromText(text);
  const maxTokens = structured.maxTokens ?? parsed.maxTokens;
  const requestedTokens = structured.requestedTokens ?? parsed.requestedTokens;
  if (
    !info.status &&
    !info.message &&
    !info.code &&
    !info.type &&
    !maxTokens &&
    !requestedTokens
  ) {
    return null;
  }
  return {
    status: info.status,
    code: info.code || undefined,
    type: info.type || undefined,
    message: info.message || undefined,
    rawMessages: messages,
    maxTokens,
    requestedTokens,
  };
}

function formatContextErrorDetail(info) {
  if (!info) return '';
  const parts = [];
  if (Number.isFinite(info.status)) parts.push(`status ${info.status}`);
  if (info.code) parts.push(`code ${info.code}`);
  if (info.type) parts.push(`type ${info.type}`);
  if (Number.isFinite(info.maxTokens)) parts.push(`max ${info.maxTokens}`);
  if (Number.isFinite(info.requestedTokens)) parts.push(`requested ${info.requestedTokens}`);
  if (info.message) parts.push(`message: ${truncateText(info.message, 140)}`);
  return parts.length > 0 ? `（${parts.join(', ')}）` : '';
}


function extractStructuredTokenCounts(err) {
  const maxTokens = pickNumber(
    err?.error?.max_tokens,
    err?.error?.maxTokens,
    err?.error?.context_length,
    err?.error?.context_length_max,
    err?.error?.context_window,
    err?.error?.limit,
    err?.response?.data?.error?.max_tokens,
    err?.response?.data?.error?.maxTokens,
    err?.response?.data?.error?.context_length,
    err?.response?.data?.error?.context_length_max,
    err?.response?.data?.error?.context_window,
    err?.response?.data?.error?.limit,
    err?.response?.data?.max_tokens,
    err?.response?.data?.maxTokens,
    err?.response?.data?.context_length,
    err?.response?.data?.context_window,
    err?.data?.error?.max_tokens,
    err?.data?.max_tokens
  );
  const requestedTokens = pickNumber(
    err?.error?.requested_tokens,
    err?.error?.requestedTokens,
    err?.error?.total_tokens,
    err?.error?.prompt_tokens,
    err?.response?.data?.error?.requested_tokens,
    err?.response?.data?.error?.requestedTokens,
    err?.response?.data?.error?.total_tokens,
    err?.response?.data?.error?.prompt_tokens,
    err?.response?.data?.requested_tokens,
    err?.response?.data?.total_tokens,
    err?.data?.error?.requested_tokens,
    err?.data?.requested_tokens
  );
  return { maxTokens, requestedTokens };
}

function extractTokenCountsFromText(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return {};
  const comparePatterns = [
    /(\d+)\s*tokens?\s*(?:>|>=|exceeds|over|greater than)\s*(\d+)\s*tokens?/i,
    /(\d+)\s*token(?:s)?\s*(?:超过|大于|超出|高于)\s*(\d+)\s*token(?:s)?/i,
  ];
  for (const pattern of comparePatterns) {
    const match = source.match(pattern);
    if (match) {
      const requestedTokens = toNumber(match[1]);
      const maxTokens = toNumber(match[2]);
      return { maxTokens, requestedTokens };
    }
  }
  const maxPatterns = [
    /maximum context length is (\d+)\s*tokens?/i,
    /maximum context length.*?(\d+)\s*tokens?/i,
    /context(?:\s*length)?(?:\s*limit| window)?\s*(?:is|:)?\s*(\d+)\s*tokens?/i,
    /max(?:imum)?\s*(?:is|:)?\s*(\d+)\s*tokens?/i,
    /max(?:imum)?\s*tokens?\s*(?:is|:)?\s*(\d+)/i,
    /token(?:s)?\s*limit(?:\s*is|:)?\s*(\d+)/i,
    /(?:up to|at most)\s*(\d+)\s*tokens?/i,
    /最大[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /上限[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /最多[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /上下文[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
  ];
  let maxTokens;
  for (const pattern of maxPatterns) {
    const match = source.match(pattern);
    if (match) {
      maxTokens = toNumber(match[1]);
      if (Number.isFinite(maxTokens)) break;
    }
  }
  const requestedPatterns = [
    /requested\s*(\d+)\s*tokens?/i,
    /you requested\s*(\d+)\s*tokens?/i,
    /request(?:ed)?\s*token(?:s)?\s*(\d+)/i,
    /input.*?(\d+)\s*tokens?/i,
    /prompt.*?(\d+)\s*tokens?/i,
    /请求[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /输入[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /已用[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /使用[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
  ];
  let requestedTokens;
  for (const pattern of requestedPatterns) {
    const match = source.match(pattern);
    if (match) {
      requestedTokens = toNumber(match[1]);
      if (Number.isFinite(requestedTokens)) break;
    }
  }
  return { maxTokens, requestedTokens };
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function pickNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return undefined;
}

function truncateText(text, maxLength = 160) {
  const value = typeof text === 'string' ? text.trim() : String(text ?? '');
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function hardTrimSession(session) {
  if (!session || !Array.isArray(session.messages)) {
    return;
  }
  const lastUser = (() => {
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const msg = session.messages[i];
      if (msg && msg.role === 'user') {
        return { ...msg };
      }
    }
    return null;
  })();
  const retained = [];
  if (session.systemPrompt) {
    retained.push({ role: 'system', content: session.systemPrompt });
  }
  if (typeof session.getExtraSystemPrompts === 'function') {
    retained.push(...session.getExtraSystemPrompts());
  }
  retained.push({
    role: 'system',
    content: '【会话裁剪】因上下文过长，已丢弃历史细节；如需保留关键信息，请在下一条消息补充要点。',
    name: 'conversation_trim_notice',
  });
  if (lastUser) {
    retained.push(lastUser);
  }
  session.messages = retained;
}

function ensureSessionId(session, seedText = '') {
  if (!session) return null;
  if (session.sessionId) {
    process.env.MODEL_CLI_SESSION_ID = session.sessionId;
    return session.sessionId;
  }
  const generated = generateSessionId(seedText);
  session.setSessionId(generated);
  process.env.MODEL_CLI_SESSION_ID = generated;
  console.log(colors.green(`Session ID: ${generated}`));
  return generated;
}

function discardLatestTurn(session) {
  if (!session || !Array.isArray(session.messages) || session.messages.length === 0) {
    return;
  }
  // Remove any assistant/tool messages produced after the latest user message,
  // then drop that user message as well. This prevents dangling tool_calls after abort.
  while (session.messages.length > 0) {
    const last = session.messages[session.messages.length - 1];
    if (!last || last.role !== 'user') {
      session.messages.pop();
      continue;
    }
    session.messages.pop();
    break;
  }
  repairDanglingToolCalls(session);
}

function repairDanglingToolCalls(session, options = {}) {
  if (!session || !Array.isArray(session.messages) || session.messages.length === 0) {
    return false;
  }
  const preserveLatestUser = options?.preserveLatestUser === true;
  const original = session.messages;

  const normalizeId = (value) => {
    if (typeof value === 'string') return value.trim();
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };

  let counter = 0;
  const generateId = () => {
    counter += 1;
    return `call_${generateSessionId(`tool-${counter}`)}`;
  };

  const latestUserText = preserveLatestUser
    ? (() => {
        for (let i = original.length - 1; i >= 0; i -= 1) {
          const msg = original[i];
          if (msg && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
            return msg.content;
          }
        }
        return '';
      })()
    : '';

  const { messages: repaired, changed } = normalizeToolCallMessages(original, {
    toolCallsKey: 'tool_calls',
    toolCallIdKey: 'tool_call_id',
    normalizeId,
    generateId,
    assignMissingToolCallId: true,
    ensureUniqueToolCallIds: true,
    stripEmptyToolCalls: true,
    pendingMode: 'drop',
  });

  if (!changed) {
    return false;
  }

  session.messages = repaired;
  if (preserveLatestUser && latestUserText) {
    const hasUser = session.messages.some(
      (msg) => msg && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()
    );
    if (!hasUser) {
      try {
        session.addUser(latestUserText);
      } catch {
        // ignore
      }
    }
  }
  return true;
}

export { chatWithContextRecovery, discardLatestTurn, ensureSessionId };

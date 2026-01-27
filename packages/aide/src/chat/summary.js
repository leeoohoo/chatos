import * as colors from '../colors.js';
import { ChatSession } from '../session.js';
import { ModelClient } from '../client.js';
import { estimateTokenCount, extractPlainText } from './token-utils.js';
import { isContextLengthError } from '../../shared/error-utils.js';
import { normalizePromptLanguage } from '../../shared/mcp-utils.js';
import { normalizeKey } from '../../shared/text-utils.js';
import { throwIfAborted } from '../client-helpers.js';
import { computeTailStartIndex } from '../../../common/chat-tail-utils.js';
import { extractLatestSummaryText, SUMMARY_MESSAGE_NAME } from '../../../common/chat-summary-utils.js';

const DEFAULT_SUMMARY_PROMPT = {
  system:
    '你是一名 AI 助理，负责在对话过长前压缩上下文。请在保持关键信息和待办事项的情况下，用简洁中文总结。输出格式：\n1. 对话要点\n2. 待处理事项',
  user: '{{history}}\n\n请按照上述格式，生成不超过 800 字的总结。',
};

function createSummaryManager(options = {}) {
  const defaultThreshold = 60000;
  const envRaw = process.env.MODEL_CLI_SUMMARY_TOKENS;
  const envThreshold =
    envRaw === undefined || envRaw === null || String(envRaw).trim() === ''
      ? undefined
      : Number(envRaw);
  const configuredThreshold =
    options.summaryThreshold === undefined ? undefined : Number(options.summaryThreshold);
  const threshold = [configuredThreshold, envThreshold, defaultThreshold].find((value) =>
    Number.isFinite(value)
  );
  const enabled = threshold > 0;
  const keepRatio = resolveKeepRatio();
  const promptRecords = Array.isArray(options.promptRecords) ? options.promptRecords : [];
  const promptLanguage = typeof options.promptLanguage === 'string' ? options.promptLanguage : '';
  const eventLogger =
    options.eventLogger && typeof options.eventLogger.log === 'function'
      ? options.eventLogger
      : null;
  let pendingPromise = null;
  const runSummaries = async (session, client, modelName, { force = false, signal } = {}) => {
    if (!session || !client) {
      return false;
    }
    let didSummarize = false;
    let lastSummaryText = '';
    let lastBefore = null;
    let lastAfter = null;
    const targetThreshold = force ? (threshold > 0 ? threshold : defaultThreshold) : threshold;
    const maxPasses = force ? 6 : 3;
    let emitted = false;
    const emitSummaryIfNeeded = () => {
      if (emitted) return;
      emitted = true;
      if (!didSummarize) return;
      const text = typeof lastSummaryText === 'string' ? lastSummaryText.trim() : '';
      if (!text) return;
      const payload = {
        text,
        forced: Boolean(force),
        threshold: targetThreshold,
        keep_ratio: keepRatio,
        before_tokens: Number.isFinite(lastBefore) ? lastBefore : undefined,
        after_tokens: Number.isFinite(lastAfter) ? lastAfter : undefined,
        session_id: typeof session?.sessionId === 'string' ? session.sessionId : null,
      };
      try {
        eventLogger?.log?.('summary', payload);
      } catch {
        // ignore
      }
    };
    for (let pass = 0; pass < maxPasses; pass += 1) {
      throwIfAborted(signal);
      const tokenCount = estimateTokenCount(session.messages);
      if (!force && tokenCount <= threshold) {
        emitSummaryIfNeeded();
        return didSummarize;
      }
      if (force && tokenCount <= targetThreshold && pass > 0) {
        emitSummaryIfNeeded();
        return didSummarize;
      }
      const before = tokenCount;
      const changed = await summarizeSession(session, client, modelName, {
        keepRatio,
        signal,
        promptRecords,
        promptLanguage,
      });
      const after = estimateTokenCount(session.messages);
      if (!changed || after >= before) {
        emitSummaryIfNeeded();
        return didSummarize;
      }
      didSummarize = true;
      lastBefore = before;
      lastAfter = after;
      const latestSummary = extractLatestSummaryText(session.messages);
      if (latestSummary) {
        lastSummaryText = latestSummary;
      }
      console.log(
        colors.dim(
          `[summary] ${force ? 'Force' : 'Auto'} summary: ~${before} → ~${after} tokens (threshold ~${targetThreshold})`
        )
      );
      if ((!force && after <= threshold) || (force && after <= targetThreshold)) {
        emitSummaryIfNeeded();
        return didSummarize;
      }
    }
    emitSummaryIfNeeded();
    return didSummarize;
  };
  return {
    maybeSummarize: async (session, client, modelName, summaryOptions = {}) => {
      if (!enabled) {
        return false;
      }
      if (pendingPromise) {
        return await pendingPromise;
      }
      const signal = summaryOptions?.signal;
      pendingPromise = runSummaries(session, client, modelName, { signal })
        .catch((err) => {
          if (err?.name === 'AbortError' || signal?.aborted) {
            throw err;
          }
          console.error(colors.yellow(`[summary] Failed to summarize conversation: ${err.message}`));
          return false;
        })
        .finally(() => {
          pendingPromise = null;
        });
      return await pendingPromise;
    },
    forceSummarize: async (session, client, modelName, summaryOptions = {}) => {
      if (pendingPromise) {
        return await pendingPromise;
      }
      const signal = summaryOptions?.signal;
      pendingPromise = runSummaries(session, client, modelName, { force: true, signal })
        .catch((err) => {
          if (err?.name === 'AbortError' || signal?.aborted) {
            throw err;
          }
          console.error(colors.yellow(`[summary] Failed to summarize conversation: ${err.message}`));
          return false;
        })
        .finally(() => {
          pendingPromise = null;
        });
      return await pendingPromise;
    },
    get threshold() {
      return threshold;
    },
    get keepRatio() {
      return keepRatio;
    },
  };

  function resolveKeepRatio() {
    const fallback = 0.3; // Keep the latest ~30% raw; summarize the older ~70%.
    const raw = process.env.MODEL_CLI_SUMMARY_KEEP_RATIO;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(0.95, Math.max(0.05, parsed));
  }
}

async function summarizeSession(session, client, modelName, options = {}) {
  if (!session || !client) {
    return false;
  }
  const signal = options?.signal;
  const keepRatio =
    options && Number.isFinite(options.keepRatio) && options.keepRatio > 0 && options.keepRatio < 1
      ? Number(options.keepRatio)
      : 0.3;

  const baseMessages = [];
  if (session.systemPrompt) {
    baseMessages.push({ role: 'system', content: session.systemPrompt });
  }
  if (typeof session.getExtraSystemPrompts === 'function') {
    baseMessages.push(...session.getExtraSystemPrompts());
  }
  const baseCount = baseMessages.length;
  const all = Array.isArray(session.messages) ? session.messages : [];
  const body = all.slice(baseCount);
  if (body.length < 2) {
    return false;
  }

  const tailStartIndex = computeTailStartIndex(body, keepRatio, estimateTokenCount);
  if (tailStartIndex <= 0) return false;

  const toSummarize = body.slice(0, tailStartIndex);
  const tail = body.slice(tailStartIndex);

  const targetModel = modelName || client.getDefaultModel();
  const summarizer = new ModelClient(client.config);
  const promptConfig = loadSummaryPromptConfig({
    prompts: options?.promptRecords,
    language: options?.promptLanguage,
  });
  let maxBytes = 60000;
  const minBytes = 4000;
  let summaryText = '';
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    throwIfAborted(signal);
    const summaryPrompt = buildSummaryPrompt(toSummarize, { maxBytes, promptConfig });
    const summarySession = new ChatSession(summaryPrompt.system);
    summaryPrompt.messages.forEach((msg) => summarySession.messages.push({ ...msg }));
    try {
      summaryText = await summarizer.chat(targetModel, summarySession, {
        stream: false,
        disableTools: true,
        maxToolPasses: 1,
        signal,
      });
      break;
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      if (isContextLengthError(err) && maxBytes > minBytes) {
        maxBytes = Math.max(minBytes, Math.floor(maxBytes * 0.5));
        continue;
      }
      throw err;
    }
  }
  const trimmed = (summaryText || '').trim();
  const stamp = new Date().toLocaleString();
  const summaryMessage = trimmed
    ? `【会话总结 ${stamp}】\n${trimmed}`
    : `【会话总结 ${stamp}】\n（自动总结失败${lastError ? `：${lastError.message}` : ''}）`;
  const summaryEntry = {
    role: 'system',
    content: summaryMessage,
    name: SUMMARY_MESSAGE_NAME,
  };

  // 保留：系统 prompt + 用户 prompt + 最新总结 + 最近 ~30% 的原始对话（提升保真）
  session.messages = baseMessages.concat(summaryEntry, tail.map((msg) => ({ ...msg })));
  return true;
}

function buildSummaryPrompt(messages, options = {}) {
  const maxBytes =
    options && Number.isFinite(options.maxBytes) && options.maxBytes > 0
      ? Math.floor(options.maxBytes)
      : undefined;
  const history = renderHistoryForSummary(messages, maxBytes);
  const promptConfig = options?.promptConfig || DEFAULT_SUMMARY_PROMPT;
  const system =
    typeof promptConfig?.system === 'string' && promptConfig.system.trim()
      ? promptConfig.system.trim()
      : DEFAULT_SUMMARY_PROMPT.system;
  const template =
    typeof promptConfig?.user === 'string' && promptConfig.user.trim()
      ? promptConfig.user
      : DEFAULT_SUMMARY_PROMPT.user;
  const userContent = renderSummaryUserTemplate(template, { history });
  return {
    system,
    messages: [{ role: 'user', content: userContent }],
  };
}

function loadSummaryPromptConfig({ prompts, language } = {}) {
  const promptMap = buildPromptMap(prompts);
  const systemInfo = resolvePromptText(promptMap, 'summary_prompt', language);
  const userInfo = resolvePromptText(promptMap, 'summary_prompt_user', language);
  return {
    path: '(admin.db)',
    systemName: systemInfo.name,
    userName: userInfo.name,
    system: systemInfo.content || DEFAULT_SUMMARY_PROMPT.system,
    user: userInfo.content || DEFAULT_SUMMARY_PROMPT.user,
  };
}

function renderSummaryUserTemplate(template, { history } = {}) {
  const historyText = typeof history === 'string' ? history : String(history ?? '');
  const rawTemplate = typeof template === 'string' ? template : '';
  if (!rawTemplate.trim()) {
    return renderSummaryUserTemplate(DEFAULT_SUMMARY_PROMPT.user, { history: historyText });
  }
  if (rawTemplate.includes('{{history}}')) {
    return rawTemplate.replaceAll('{{history}}', historyText).trim();
  }
  return `${historyText}\n\n${rawTemplate}`.trim();
}

function buildPromptMap(prompts) {
  const map = new Map();
  (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
    if (!prompt) return;
    const name = normalizeKey(prompt?.name);
    if (!name) return;
    const content = typeof prompt?.content === 'string' ? prompt.content.trim() : '';
    if (!content) return;
    map.set(name, content);
  });
  return map;
}

function resolvePromptText(promptMap, baseName, language) {
  const lang = normalizePromptLanguage(language);
  const preferred = lang === 'en' ? `${baseName}__en` : baseName;
  const fallback = lang === 'en' ? baseName : `${baseName}__en`;
  const preferredKey = normalizeKey(preferred);
  if (promptMap.has(preferredKey)) {
    return { name: preferred, content: promptMap.get(preferredKey) };
  }
  const fallbackKey = normalizeKey(fallback);
  if (promptMap.has(fallbackKey)) {
    return { name: fallback, content: promptMap.get(fallbackKey) };
  }
  return { name: preferred, content: '' };
}

function renderHistoryForSummary(messages, maxBytes = 60000) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '（无内容）';
  }
  const collected = [];
  const budget =
    Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 60000;
  let usedBytes = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i];
    if (!entry) continue;
    const role = entry.role || 'unknown';
    const label = role === 'user'
      ? '用户'
      : role === 'assistant'
        ? '助手'
        : role === 'tool'
          ? `工具(${entry.tool_call_id || entry.name || 'tool'})`
          : '系统';
    const prefix = `${label}: `;
    const separator = collected.length > 0 ? '\n\n' : '';
    const headerBytes = Buffer.byteLength(separator + prefix, 'utf8');
    const remaining = budget - usedBytes - headerBytes;
    if (remaining <= 0) {
      break;
    }
    const rawText = extractPlainText(entry.content);
    const ellipsis = '…';
    const ellipsisBytes = Buffer.byteLength(ellipsis, 'utf8');
    const primary = truncateUtf8ByBytes(rawText, remaining);
    let text = primary.text;
    let bodyBytes = primary.usedBytes;
    if (primary.truncated && remaining > ellipsisBytes) {
      const trimmed = truncateUtf8ByBytes(rawText, remaining - ellipsisBytes);
      text = `${trimmed.text}${ellipsis}`;
      bodyBytes = trimmed.usedBytes + ellipsisBytes;
    }
    collected.push(`${prefix}${text}`);
    usedBytes += headerBytes + bodyBytes;
    if (usedBytes >= budget) {
      break;
    }
  }
  return collected.reverse().join('\n\n');
}

function truncateUtf8ByBytes(text, maxBytes) {
  const input = String(text ?? '');
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0;
  if (limit <= 0) {
    return { text: '', usedBytes: 0, truncated: input.length > 0 };
  }
  let used = 0;
  const parts = [];
  for (const ch of input) {
    const codePoint = ch.codePointAt(0);
    const bytes =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (used + bytes > limit) {
      return { text: parts.join(''), usedBytes: used, truncated: true };
    }
    parts.push(ch);
    used += bytes;
  }
  return { text: parts.join(''), usedBytes: used, truncated: false };
}

export {
  createSummaryManager,
  estimateTokenCount,
  loadSummaryPromptConfig,
  summarizeSession,
  throwIfAborted,
};

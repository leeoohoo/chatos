import { normalizeText } from './text-utils.js';

export const SUMMARY_MESSAGE_NAME = 'conversation_summary';
export const SUMMARY_SEPARATOR = '\n\n---\n\n';

export function isSummaryMessage(message) {
  if (!message || message.role !== 'system') return false;
  return normalizeText(message?.name) === SUMMARY_MESSAGE_NAME;
}

export function pickLatestSummaryMessage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (isSummaryMessage(list[i])) return list[i];
  }
  return null;
}

export function extractLatestSummaryText(messages) {
  const msg = pickLatestSummaryMessage(messages);
  if (!msg) return '';
  const content = normalizeText(msg?.content);
  return content || '';
}

export function appendSummaryText(existing, addition, separator = SUMMARY_SEPARATOR) {
  const base = normalizeText(existing);
  const extra = normalizeText(addition);
  if (!base) return extra;
  if (!extra) return base;
  return `${base}${separator}${extra}`;
}

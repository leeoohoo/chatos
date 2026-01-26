export function computeTailStartIndex(messages, keepRatio, estimateTokenCount, options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length < 2) return -1;
  const estimator = typeof estimateTokenCount === 'function' ? estimateTokenCount : null;
  if (!estimator) return -1;
  const totalTokens = estimator(list);
  if (!(totalTokens > 0)) return -1;
  const ratio =
    Number.isFinite(keepRatio) && keepRatio > 0 && keepRatio < 1 ? Number(keepRatio) : 0.3;
  const keepTargetTokens = Math.max(1, Math.ceil(totalTokens * ratio));
  const estimateMessageTokens =
    typeof options.estimateMessageTokens === 'function'
      ? options.estimateMessageTokens
      : (message) => estimator([message]);

  let keepTokens = 0;
  let tailStartIndex = list.length - 1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    keepTokens += estimateMessageTokens(list[i]);
    tailStartIndex = i;
    if (keepTokens >= keepTargetTokens) break;
  }

  let lastUserIndex = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex >= 0 && tailStartIndex > lastUserIndex) {
    tailStartIndex = lastUserIndex;
  }
  if (tailStartIndex <= 0) return -1;
  return tailStartIndex;
}

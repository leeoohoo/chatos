function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMetaValue(meta, keys = []) {
  if (!meta || typeof meta !== 'object') return '';
  for (const key of keys) {
    if (!key) continue;
    const value = normalizeText(meta[key]);
    if (value) return value;
  }
  return '';
}

function truncateText(value, maxLen = 140) {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function buildStepSummary(step, stage) {
  if (!step || typeof step !== 'object') return '';
  const type = normalizeText(step.type);
  if (stage === 'done') {
    return '子代理执行完成';
  }
  if (type === 'assistant') {
    const text = normalizeText(step.text) || normalizeText(step.reasoning);
    return text ? `AI 思考: ${truncateText(text, 120)}` : 'AI 思考';
  }
  if (type === 'tool_call') {
    const tool = normalizeText(step.tool);
    return tool ? `调用 ${tool}` : '调用工具';
  }
  if (type === 'tool_result') {
    const tool = normalizeText(step.tool);
    return tool ? `结果 ${tool}` : '工具结果';
  }
  if (type === 'notice') {
    const text = normalizeText(step.text);
    return text ? `提示: ${truncateText(text, 120)}` : '提示';
  }
  const fallback = normalizeText(step.text);
  return fallback ? truncateText(fallback, 120) : '';
}

export function createSubagentProgressEmitter(server, meta = {}) {
  const transport = server?.server;
  if (!transport || typeof transport.notification !== 'function') {
    return null;
  }
  const sessionId = normalizeMetaValue(meta, ['sessionId', 'session_id']);
  const toolCallId = normalizeMetaValue(meta, ['toolCallId', 'tool_call_id', 'callId', 'call_id']);
  const runId = normalizeMetaValue(meta, ['runId', 'run_id']) || normalizeText(process.env.MODEL_CLI_RUN_ID);
  const base = {
    kind: 'subagent_step',
    ...(sessionId ? { sessionId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(runId ? { runId } : {}),
  };

  return (payload = {}) => {
    if (!payload || typeof payload !== 'object') return;
    const step = payload.step && typeof payload.step === 'object' ? payload.step : null;
    const stage = normalizeText(payload.stage);
    const text = normalizeText(payload.text) || buildStepSummary(step, stage);
    const params = {
      ...base,
      ...payload,
      ...(text ? { text } : {}),
      ...(stage ? { stage } : {}),
      ...(step ? { step } : {}),
    };
    if (stage === 'done' || payload.done === true) {
      params.done = true;
      params.status = normalizeText(payload.status) || 'completed';
    }
    try {
      void transport.notification({ method: 'notifications/progress', params });
    } catch {
      // ignore notification errors
    }
  };
}

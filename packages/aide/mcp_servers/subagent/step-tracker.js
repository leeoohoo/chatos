export function createSubagentStepTracker({
  eventLogger,
  agentId,
  progress,
  normalizeStepText,
  stepTextLimit = 8000,
  stepReasoningLimit = 6000,
} = {}) {
  const steps = [];
  const toolTimings = new Map();
  const emitProgress = typeof progress === 'function' ? progress : null;
  const agent = typeof agentId === 'string' ? agentId : '';
  const normalize =
    typeof normalizeStepText === 'function'
      ? normalizeStepText
      : (value) => ({ text: String(value ?? ''), truncated: false, length: 0 });

  const pushStep = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const step = { ts: new Date().toISOString(), index: steps.length, ...entry };
    steps.push(step);
    if (emitProgress) {
      try {
        emitProgress({ step, index: step.index, stage: 'step' });
      } catch {
        // ignore progress failures
      }
    }
  };

  const onAssistantStep = ({ text, reasoning: stepReasoning, toolCalls, iteration, model } = {}) => {
    const textInfo = normalize(text, stepTextLimit);
    const reasoningInfo = normalize(stepReasoning, stepReasoningLimit);
    const calls = (Array.isArray(toolCalls) ? toolCalls : [])
      .map((call) => ({
        tool: call?.function?.name || call?.name || 'tool',
        call_id: call?.id || '',
      }))
      .filter((call) => call.tool);
    if (!textInfo.text && !reasoningInfo.text && calls.length === 0) {
      return;
    }
    pushStep({
      type: 'assistant',
      text: textInfo.text,
      text_truncated: textInfo.truncated,
      text_length: textInfo.length,
      reasoning: reasoningInfo.text,
      reasoning_truncated: reasoningInfo.truncated,
      reasoning_length: reasoningInfo.length,
      tool_calls: calls,
      iteration,
      model,
    });
  };

  const onToolCall = ({ tool, callId, args, trace: callTrace } = {}) => {
    const argsInfo = normalize(args, stepTextLimit);
    if (callId) {
      toolTimings.set(callId, Date.now());
    }
    pushStep({
      type: 'tool_call',
      tool,
      call_id: callId || '',
      args: argsInfo.text,
      args_truncated: argsInfo.truncated,
      args_length: argsInfo.length,
    });
    eventLogger?.log?.('subagent_tool_call', {
      agent,
      tool,
      callId,
      args,
      trace: callTrace || undefined,
    });
  };

  const onToolResult = ({ tool, callId, result, trace: callTrace, isError } = {}) => {
    const preview = typeof result === 'string' ? result : JSON.stringify(result || {});
    const resultInfo = normalize(result, stepTextLimit);
    const started = callId ? toolTimings.get(callId) : null;
    const elapsedMs = started ? Date.now() - started : null;
    if (callId) {
      toolTimings.delete(callId);
    }
    pushStep({
      type: 'tool_result',
      tool,
      call_id: callId || '',
      result: resultInfo.text,
      result_truncated: resultInfo.truncated,
      result_length: resultInfo.length,
      is_error: Boolean(isError),
      ...(Number.isFinite(elapsedMs) ? { elapsed_ms: elapsedMs } : {}),
    });
    eventLogger?.log?.('subagent_tool_result', {
      agent,
      tool,
      callId,
      result: preview,
      isError,
      trace: callTrace || undefined,
    });
  };

  const getStats = (startedAt) => {
    const base = Number.isFinite(startedAt) ? startedAt : Date.now();
    const elapsedMs = Date.now() - base;
    const toolCallCount = steps.filter((step) => step?.type === 'tool_call').length;
    const toolResultCount = steps.filter((step) => step?.type === 'tool_result').length;
    return {
      elapsedMs,
      toolCallCount,
      toolResultCount,
      stepsCount: steps.length,
    };
  };

  return {
    steps,
    emitProgress,
    pushStep,
    onAssistantStep,
    onToolCall,
    onToolResult,
    getStats,
  };
}

function buildStatsPayload(stats = {}) {
  return {
    elapsed_ms: stats.elapsedMs ?? 0,
    steps: stats.stepsCount ?? 0,
    tool_calls: stats.toolCallCount ?? 0,
    tool_results: stats.toolResultCount ?? 0,
  };
}

export function logSubagentStart({ eventLogger, agentId, task, commandId, model, traceMeta } = {}) {
  eventLogger?.log?.('subagent_start', {
    agent: agentId,
    task,
    command: commandId || null,
    model,
    trace: traceMeta || undefined,
  });
}

export function finalizeSubagentRun({
  eventLogger,
  agentId,
  commandId,
  model,
  response,
  traceMeta,
  stats,
  emitProgress,
} = {}) {
  const responsePreview = typeof response === 'string' ? response : JSON.stringify(response || {});
  eventLogger?.log?.('subagent_done', {
    agent: agentId,
    model,
    command: commandId || null,
    responsePreview,
    trace: traceMeta || undefined,
  });
  const statsPayload = buildStatsPayload(stats);
  if (emitProgress) {
    try {
      emitProgress({
        stage: 'done',
        done: true,
        stats: statsPayload,
      });
    } catch {
      // ignore progress failures
    }
  }
  return statsPayload;
}

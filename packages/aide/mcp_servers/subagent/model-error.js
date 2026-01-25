export async function handleSubagentModelError({
  err,
  state,
  config,
  targetModel,
  fallbackModel,
  configuredModel,
  normalizedCallerModel,
  defaultModel,
  adminServices,
  sessionRoot,
  mcpConfigPath,
  eventLogger,
  loadAppConfig,
  getClient,
  resolveSubagentInvocationModel,
  describeModelError,
  getModelAuthDebug,
  shouldFallbackToCurrentModelOnError,
  agentId,
  traceMeta,
  serverName = 'subagent_router',
} = {}) {
  const info =
    typeof describeModelError === 'function'
      ? describeModelError(err)
      : { reason: '', name: err?.name || 'Error', status: err?.status, message: err?.message };
  const currentState = state && typeof state === 'object' ? state : {};
  let loggedAuthDebug = currentState.loggedAuthDebug === true;
  let refreshedConfig = currentState.refreshedConfig === true;
  let usedFallbackModel = currentState.usedFallbackModel === true;
  let nextConfig = config;
  let nextClient = null;
  let nextTargetModel = targetModel;
  const agent = typeof agentId === 'string' ? agentId : '';
  const trace = traceMeta || undefined;

  if (!loggedAuthDebug && (info.reason === 'auth_error' || info.reason === 'config_error')) {
    loggedAuthDebug = true;
    const debugInfo = typeof getModelAuthDebug === 'function' ? getModelAuthDebug(config, targetModel) : null;
    const authDebugPayload = {
      model: targetModel,
      configuredModel,
      callerModel: normalizedCallerModel || null,
      dbPath: adminServices?.dbPath || null,
      sessionRoot,
      mcpConfigPath,
      modelInfo: debugInfo,
      error: info,
    };
    eventLogger?.log?.('subagent_auth_debug', authDebugPayload);
    console.error(`[${serverName}] auth_debug`, authDebugPayload);
  }

  if (!refreshedConfig && (info.reason === 'auth_error' || info.reason === 'config_error')) {
    refreshedConfig = true;
    if (typeof loadAppConfig === 'function') {
      nextConfig = await loadAppConfig({ force: true });
      if (typeof getClient === 'function') {
        nextClient = getClient(nextConfig);
      }
      if (typeof resolveSubagentInvocationModel === 'function') {
        nextTargetModel = resolveSubagentInvocationModel({
          configuredModel,
          currentModel: normalizedCallerModel,
          client: nextClient || getClient?.(nextConfig),
          defaultModel,
        });
      }
      if (nextTargetModel) {
        return {
          action: 'retry',
          state: { loggedAuthDebug, refreshedConfig, usedFallbackModel },
          config: nextConfig,
          client: nextClient,
          targetModel: nextTargetModel,
        };
      }
    }
  }

  if (
    !usedFallbackModel &&
    fallbackModel &&
    typeof shouldFallbackToCurrentModelOnError === 'function' &&
    shouldFallbackToCurrentModelOnError(err)
  ) {
    const failedModel = targetModel;
    const detail = [info.reason, info.status ? `HTTP ${info.status}` : null, info.message]
      .filter(Boolean)
      .join(' - ');
    const notice = `子流程模型 "${failedModel}" 调用失败（${detail || info.name}），本轮回退到主流程模型 "${fallbackModel}"。`;
    usedFallbackModel = true;
    nextTargetModel = fallbackModel;
    try {
      eventLogger?.log?.('subagent_notice', {
        agent,
        text: notice,
        source: 'system',
        kind: 'agent',
        fromModel: failedModel,
        toModel: fallbackModel,
        reason: info.reason,
        error: info,
        trace,
      });
    } catch {
      // ignore
    }
    return {
      action: 'retry',
      state: { loggedAuthDebug, refreshedConfig, usedFallbackModel },
      config: nextConfig,
      client: nextClient,
      targetModel: nextTargetModel,
    };
  }

  return {
    action: 'throw',
    state: { loggedAuthDebug, refreshedConfig, usedFallbackModel },
    config: nextConfig,
    client: nextClient,
    targetModel: nextTargetModel,
  };
}

export function createRunState({ config, client, targetModel, fallbackModel } = {}) {
  return {
    config,
    client,
    targetModel,
    fallbackModel,
    loggedAuthDebug: false,
    refreshedConfig: false,
    usedFallbackModel: false,
  };
}

export function applyModelErrorResult(runState, errorResult) {
  if (!runState || !errorResult) return;
  if (errorResult.state) {
    runState.loggedAuthDebug = errorResult.state.loggedAuthDebug;
    runState.refreshedConfig = errorResult.state.refreshedConfig;
    runState.usedFallbackModel = errorResult.state.usedFallbackModel;
  }
  if (errorResult.config) {
    runState.config = errorResult.config;
  }
  if (errorResult.client) {
    runState.client = errorResult.client;
  }
  if (errorResult.targetModel) {
    runState.targetModel = errorResult.targetModel;
  }
}

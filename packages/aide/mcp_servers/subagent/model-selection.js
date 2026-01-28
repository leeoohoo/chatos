export function resolveSubagentModels({
  modelOverride,
  commandModel,
  agentModel,
  callerModel,
  config,
  client,
  resolveSubagentInvocationModel,
  defaultModelName,
} = {}) {
  const normalizedCallerModel = typeof callerModel === 'string' ? callerModel.trim() : '';
  const configuredModel =
    modelOverride || // explicit override from request
    commandModel || // model declared on the command, if any
    agentModel || // per-agent model from plugin manifest
    null;
  const defaultModel = typeof defaultModelName === 'string' ? defaultModelName.trim() : '';
  const configDefaultModel =
    config && typeof config.getModel === 'function' ? config.getModel(null).name : null;
  const targetModel = resolveSubagentInvocationModel({
    configuredModel,
    currentModel: normalizedCallerModel,
    client,
    defaultModel,
  });
  if (!targetModel) {
    throw new Error('Target model could not be resolved; check configuration.');
  }
  const fallbackModel =
    normalizedCallerModel && normalizedCallerModel !== targetModel ? normalizedCallerModel : '';
  return {
    configuredModel,
    normalizedCallerModel,
    defaultModel,
    configDefaultModel,
    targetModel,
    fallbackModel,
  };
}

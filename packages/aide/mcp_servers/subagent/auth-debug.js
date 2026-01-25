export function getModelAuthDebug(config, modelName) {
  if (!config || typeof config.getModel !== 'function') return null;
  try {
    const settings = config.getModel(modelName);
    const rawKey = settings?.api_key ?? settings?.apiKey ?? '';
    const key = typeof rawKey === 'string' ? rawKey.trim() : String(rawKey || '').trim();
    const keySuffix = key ? key.slice(-4) : '';
    return {
      model: settings?.name || modelName,
      provider: settings?.provider || null,
      base_url: settings?.base_url || null,
      api_key_env: settings?.api_key_env || settings?.apiKeyEnv || null,
      key_length: key ? key.length : 0,
      key_suffix: keySuffix || null,
    };
  } catch {
    return null;
  }
}

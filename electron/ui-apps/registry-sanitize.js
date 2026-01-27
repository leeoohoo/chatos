export function sanitizeAiForUi(ai) {
  if (!ai || typeof ai !== 'object') return null;
  const mcp = ai?.mcp && typeof ai.mcp === 'object' ? ai.mcp : null;
  const mcpPrompt = ai?.mcpPrompt && typeof ai.mcpPrompt === 'object' ? ai.mcpPrompt : null;
  const agent = ai?.agent && typeof ai.agent === 'object' ? ai.agent : null;
  const sanitizePromptSource = (src) => {
    if (!src || typeof src !== 'object') return null;
    const p = typeof src.path === 'string' ? src.path : '';
    return p ? { path: p } : null;
  };
  return {
    mcp: mcp
      ? {
          name: mcp.name || '',
          url: mcp.url || '',
          description: mcp.description || '',
          tags: Array.isArray(mcp.tags) ? mcp.tags : [],
          enabled: typeof mcp.enabled === 'boolean' ? mcp.enabled : undefined,
        }
      : null,
    mcpPrompt: mcpPrompt
      ? {
          title: mcpPrompt.title || '',
          zh: sanitizePromptSource(mcpPrompt.zh),
          en: sanitizePromptSource(mcpPrompt.en),
          names: mcpPrompt.names || null,
        }
      : null,
    agent: agent
      ? {
          name: agent.name || '',
          description: agent.description || '',
          modelId: agent.modelId || '',
        }
      : null,
  };
}

export function sanitizeAppForUi(app) {
  return {
    ...app,
    ai: sanitizeAiForUi(app?.ai),
  };
}

export function readRegistrySnapshot(services) {
  const db = services?.mcpServers?.db || services?.prompts?.db || null;
  if (!db || typeof db.list !== 'function') {
    return { mcpServers: [], prompts: [], mcpGrants: [], promptGrants: [] };
  }
  try {
    return {
      mcpServers: db.list('registryMcpServers') || [],
      prompts: db.list('registryPrompts') || [],
      mcpGrants: db.list('mcpServerGrants') || [],
      promptGrants: db.list('promptGrants') || [],
    };
  } catch {
    return { mcpServers: [], prompts: [], mcpGrants: [], promptGrants: [] };
  }
}

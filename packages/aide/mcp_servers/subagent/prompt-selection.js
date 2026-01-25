function resolveCommand(plugin, commandId) {
  if (!plugin || !commandId) return null;
  const needle = String(commandId).toLowerCase().trim();
  if (plugin.commandMap && plugin.commandMap.size > 0) {
    for (const [id, cmd] of plugin.commandMap.entries()) {
      const name = cmd?.name || '';
      if (id.toLowerCase() === needle || name.toLowerCase() === needle) {
        return { plugin, command: cmd };
      }
    }
  }
  if (Array.isArray(plugin.commands)) {
    const hit = plugin.commands.find((cmd) => {
      const id = String(cmd?.id || '').toLowerCase();
      const name = String(cmd?.name || '').toLowerCase();
      return id === needle || name === needle;
    });
    if (hit) {
      return { plugin, command: hit };
    }
  }
  return null;
}

export function resolveSubagentPrompt({
  manager,
  agentRef,
  task,
  normalizedSkills = [],
  commandId,
} = {}) {
  if (!manager) {
    throw new Error('Missing subagent prompt manager');
  }
  if (!agentRef) {
    throw new Error('Missing subagent reference');
  }
  const commands = Array.isArray(agentRef.plugin?.commands) ? agentRef.plugin.commands : [];
  const effectiveCommandId =
    commandId ||
    agentRef.agent.defaultCommand ||
    (commands.length === 1 ? commands[0]?.id || commands[0]?.name || null : null);

  if (effectiveCommandId) {
    const commandRef = resolveCommand(agentRef.plugin, effectiveCommandId);
    if (!commandRef) {
      throw new Error(`Sub-agent ${agentRef.agent.id} does not contain command ${effectiveCommandId}`);
    }
    const promptInfo = manager.buildCommandPrompt(commandRef, task);
    return {
      systemPrompt: promptInfo.systemPrompt,
      internalPrompt: promptInfo.internalPrompt || '',
      reasoning: promptInfo.extra?.reasoning !== false,
      commandModel: commandRef.command.model || null,
      commandMeta: {
        id: commandRef.command.id || commandRef.command.name || effectiveCommandId,
        name: commandRef.command.name || commandRef.command.id || effectiveCommandId,
      },
      usedSkills: [],
    };
  }

  const promptInfo = manager.buildSystemPrompt(agentRef, normalizedSkills);
  return {
    systemPrompt: promptInfo.systemPrompt,
    internalPrompt: promptInfo.internalPrompt || '',
    reasoning: promptInfo.extra?.reasoning !== false,
    commandModel: null,
    commandMeta: null,
    usedSkills: promptInfo.usedSkills || normalizedSkills,
  };
}

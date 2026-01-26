export function summarizeAgentForPrompt(agent = {}) {
  const skills = Array.isArray(agent.skills) ? agent.skills : [];
  const commands = Array.isArray(agent.commands) ? agent.commands : [];
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    category: agent.category || agent.pluginCategory,
    skills: skills.map((skill) => skill?.id).filter(Boolean),
    commands: commands
      .map((cmd) => (typeof cmd === 'string' ? cmd : cmd?.id || cmd?.name))
      .filter(Boolean),
  };
}

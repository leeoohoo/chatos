import { buildAgentSuggestionPrompt, requestAgentSuggestion, resolveSuggestionModel } from './ai-suggestion.js';
import { summarizeAgentForPrompt } from './agent-summary.js';
import { filterAgents } from './utils.js';

function hasCommand(agentOrRef, commandId) {
  if (!commandId) return true;
  const needle = String(commandId).toLowerCase().trim();
  if (!needle) return true;
  if (!agentOrRef) return false;

  // `hasCommand` is used with two different shapes:
  // 1) items from `manager.listAgents()` which include a `commands` array
  // 2) an `{ plugin, agent }` ref from `manager.getAgent()`
  const commands =
    (Array.isArray(agentOrRef.commands) && agentOrRef.commands) ||
    (Array.isArray(agentOrRef.agent?.commands) && agentOrRef.agent.commands) ||
    (Array.isArray(agentOrRef.plugin?.commands) && agentOrRef.plugin.commands) ||
    [];

  if (commands.length > 0) {
    return commands.some((c) => {
      const id = typeof c === 'string' ? c : c?.id || '';
      const name = typeof c === 'string' ? c : c?.name || '';
      return id.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
    });
  }

  // Fallback for plugins that only expose a commandMap.
  const map = agentOrRef.plugin?.commandMap;
  if (map && typeof map.get === 'function') {
    for (const [id, cmd] of map.entries()) {
      const name = cmd?.name || '';
      if (String(id).toLowerCase().includes(needle) || String(name).toLowerCase().includes(needle)) {
        return true;
      }
    }
  }

  return false;
}

async function suggestAgentWithAI({
  agents,
  task,
  hints = {},
  loadAppConfig,
  getClient,
  defaultModelName,
  ChatSession,
  generateSessionId,
  logToken,
} = {}) {
  if (typeof loadAppConfig !== 'function' || typeof getClient !== 'function') {
    return null;
  }
  if (typeof ChatSession !== 'function' || typeof generateSessionId !== 'function') {
    return null;
  }

  const summaries = Array.isArray(agents) ? agents.map(summarizeAgentForPrompt) : [];
  const systemPrompt = buildAgentSuggestionPrompt({ summaries, task, hints });

  const config = await loadAppConfig();
  const client = getClient(config);

  // Use the default model for routing (matching CLI behavior).
  const model = resolveSuggestionModel({ config, client, defaultModelName });
  if (!model) {
    return null;
  }

  try {
    return await requestAgentSuggestion({
      client,
      model,
      systemPrompt,
      ChatSession,
      generateSessionId,
      logToken,
    });
  } catch (err) {
    console.error('[suggestAgentWithAI] Error:', err);
    return null;
  }
}

export function createAgentSelector({
  manager,
  selectAgent,
  loadAppConfig,
  getClient,
  defaultModelName,
  ChatSession,
  generateSessionId,
  logToken,
} = {}) {
  if (!manager) throw new Error('Missing subagent manager');
  if (typeof selectAgent !== 'function') throw new Error('Missing subagent selector');

  const suggestWithAI = async (agents, task, hints) =>
    suggestAgentWithAI({
      agents,
      task,
      hints,
      loadAppConfig,
      getClient,
      defaultModelName,
      ChatSession,
      generateSessionId,
      logToken,
    });

  const pickAgent = async ({
    agentId,
    category,
    skills = [],
    query,
    commandId,
    task,
  } = {}) => {
    if (agentId) {
      const ref = manager.getAgent(agentId);
      if (!ref) return null;
      if (commandId && !hasCommand(ref, commandId)) return null;
      return ref;
    }

    // Try AI-based suggestion if task is provided.
    if (task) {
      try {
        const aiResult = await suggestWithAI(manager.listAgents(), task, { category, query, commandId });
        if (aiResult && aiResult.agent_id && aiResult.confidence > 0.6) {
          const aiRef = manager.getAgent(aiResult.agent_id);
          if (aiRef) {
            return aiRef;
          }
        }
      } catch (err) {
        // ignore AI errors and fall back to rule-based
      }
    }

    const candidates = filterAgents(manager.listAgents(), {
      filterCategory: category,
      query: commandId ? commandId : query,
    }).filter((agent) => (commandId ? hasCommand(agent, commandId) : true));
    if (candidates.length === 0) {
      return selectAgent(manager, { category, skills, query: commandId || query });
    }
    const first = candidates[0];
    return manager.getAgent(first.id) || selectAgent(manager, { category, skills, query });
  };

  return { pickAgent };
}

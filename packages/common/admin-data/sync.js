import {
  buildMcpConfig,
  buildModelsYamlPayload,
  buildSubagentsPayload,
  writeJson,
  writeYaml,
} from './sync-helpers.js';

function buildPromptsYaml(prompts = [], options = {}) {
  const include = options?.include ? new Set(options.include) : null;
  const exclude = options?.exclude ? new Set(options.exclude) : null;
  const payload = {};
  prompts.forEach((p) => {
    const name = p?.name;
    if (!name) return;
    if (include && !include.has(name)) return;
    if (exclude && exclude.has(name)) return;
    payload[name] = p.content || '';
  });
  if (include) {
    include.forEach((name) => {
      if (!(name in payload)) {
        payload[name] = '';
      }
    });
  }
  return payload;
}

function buildPromptFile(prompts = [], name) {
  const promptName = typeof name === 'string' ? name.trim() : '';
  const list = Array.isArray(prompts) ? prompts : [];
  const record = list.find((p) => p?.name === promptName) || null;
  const title =
    typeof record?.title === 'string' && record.title.trim()
      ? record.title.trim()
      : promptName;
  const type =
    typeof record?.type === 'string' && record.type.trim()
      ? record.type.trim()
      : 'system';
  const content = typeof record?.content === 'string' ? record.content : '';

  return {
    name: promptName,
    title,
    type,
    content,
  };
}

function buildTasksPayload(tasks = []) {
  return { tasks: tasks.map((t) => ({ ...t })) };
}

function buildEventsPayload(events = []) {
  return events.map((e) => ({
    ...e,
    payload: e.payload,
  }));
}

export function syncAdminToFiles(snapshot, paths) {
  if (!paths) return;
  const summary = {};

  if (paths.modelsPath && Array.isArray(snapshot?.models)) {
    writeYaml(paths.modelsPath, buildModelsYamlPayload(snapshot.models));
    summary.modelsPath = paths.modelsPath;
  }
  if (paths.mcpConfigPath && Array.isArray(snapshot?.mcpServers)) {
    writeJson(paths.mcpConfigPath, buildMcpConfig(snapshot.mcpServers));
    summary.mcpConfigPath = paths.mcpConfigPath;
  }
  if (paths.subagentsPath && Array.isArray(snapshot?.subagents)) {
    writeJson(paths.subagentsPath, buildSubagentsPayload(snapshot.subagents));
    summary.subagentsPath = paths.subagentsPath;
  }
  if (paths.promptsPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.promptsPath,
      buildPromptFile(snapshot.prompts, 'internal_main')
    );
    summary.promptsPath = paths.promptsPath;
  }
  if (paths.systemDefaultPromptPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.systemDefaultPromptPath,
      buildPromptFile(snapshot.prompts, 'default')
    );
    summary.systemDefaultPromptPath = paths.systemDefaultPromptPath;
  }
  if (paths.systemUserPromptPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.systemUserPromptPath,
      buildPromptFile(snapshot.prompts, 'user_prompt')
    );
    summary.systemUserPromptPath = paths.systemUserPromptPath;
  }
  if (paths.subagentPromptsPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.subagentPromptsPath,
      buildPromptFile(snapshot.prompts, 'internal_subagent')
    );
    summary.subagentPromptsPath = paths.subagentPromptsPath;
  }
  if (paths.subagentUserPromptPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.subagentUserPromptPath,
      buildPromptFile(snapshot.prompts, 'subagent_user_prompt')
    );
    summary.subagentUserPromptPath = paths.subagentUserPromptPath;
  }
  if (paths.tasksPath && Array.isArray(snapshot?.tasks)) {
    writeJson(paths.tasksPath, buildTasksPayload(snapshot.tasks));
    summary.tasksPath = paths.tasksPath;
  }
  return summary;
}

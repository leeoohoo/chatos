import { buildModelsYamlPayload, buildSubagentsPayload, writeJson, writeYaml } from '../../packages/common/admin-data/sync-helpers.js';

function buildPromptsYaml(prompts = []) {
  const payload = {};
  prompts.forEach((p) => {
    payload[p.name] = p.content || '';
  });
  return payload;
}

export function syncAdminToFiles(snapshot, paths) {
  if (!paths) return;
  const summary = {};

  if (paths.modelsPath && Array.isArray(snapshot?.models)) {
    writeYaml(paths.modelsPath, buildModelsYamlPayload(snapshot.models, { mode: 'minimal' }));
    summary.modelsPath = paths.modelsPath;
  }
  if (paths.subagentsPath && Array.isArray(snapshot?.subagents)) {
    writeJson(paths.subagentsPath, buildSubagentsPayload(snapshot.subagents, { mode: 'minimal' }));
    summary.subagentsPath = paths.subagentsPath;
  }
  if (paths.promptsPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(paths.promptsPath, buildPromptsYaml(snapshot.prompts));
    summary.promptsPath = paths.promptsPath;
  }

  return summary;
}

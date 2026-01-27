import { buildModelsYamlPayload, buildSubagentsPayload, writeJson, writeYaml } from '../../packages/common/admin-data/sync-helpers.js';

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
  return summary;
}

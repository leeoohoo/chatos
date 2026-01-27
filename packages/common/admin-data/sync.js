import { buildModelsYamlPayload, buildSubagentsPayload, writeJson, writeYaml } from './sync-helpers.js';

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
  if (paths.subagentsPath && Array.isArray(snapshot?.subagents)) {
    writeJson(paths.subagentsPath, buildSubagentsPayload(snapshot.subagents));
    summary.subagentsPath = paths.subagentsPath;
  }
  if (paths.tasksPath && Array.isArray(snapshot?.tasks)) {
    writeJson(paths.tasksPath, buildTasksPayload(snapshot.tasks));
    summary.tasksPath = paths.tasksPath;
  }
  return summary;
}

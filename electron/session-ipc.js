export function registerSessionIpcHandlers({ ipcMain, sessionApi, workspaceOps } = {}) {
  if (!ipcMain || !sessionApi || !workspaceOps) return;

  ipcMain.handle('config:read', async () => {
    sessionApi.startTasksWatcher();
    return sessionApi.readConfigPayload();
  });
  ipcMain.handle('session:read', async () => {
    sessionApi.startSessionWatcher();
    return sessionApi.readSessionPayload();
  });
  ipcMain.handle('events:read', async () => {
    sessionApi.startEventsWatcher();
    return sessionApi.readEventsPayload();
  });
  ipcMain.handle('fileChanges:read', async () => {
    sessionApi.startFileChangesWatcher();
    return sessionApi.readFileChangesPayload();
  });
  ipcMain.handle('uiPrompts:read', async () => {
    sessionApi.startUiPromptsWatcher();
    return sessionApi.readUiPromptsPayload();
  });
  ipcMain.handle('runs:read', async () => {
    sessionApi.startRunsWatcher();
    return sessionApi.readRunsPayload();
  });
  ipcMain.handle('uiPrompts:request', async (_event, payload = {}) => sessionApi.requestUiPrompt(payload));
  ipcMain.handle('uiPrompts:respond', async (_event, payload = {}) => sessionApi.respondUiPrompt(payload));

  ipcMain.handle('file:read', async (_event, payload = {}) => workspaceOps.readWorkspaceFile(payload));
  ipcMain.handle('dir:list', async (_event, payload = {}) => workspaceOps.listWorkspaceDirectory(payload));
  ipcMain.handle('tasks:watch', async () => {
    sessionApi.startTasksWatcher();
    return { ok: true };
  });
  ipcMain.handle('session:clearCache', async () => sessionApi.clearAllCaches());
}

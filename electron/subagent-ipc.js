import { syncAdminToFiles } from '../packages/common/admin-data/sync.js';

export function registerSubagentIpcHandlers({
  ipcMain,
  adminDefaults,
  adminServices,
  defaultPaths,
  sessionApi,
  subAgentManager,
  uiFlags,
  exposeSubagents,
  createActionId,
  logInstall,
  mainWindowGetter,
  sanitizeAdminForUi,
} = {}) {
  if (!ipcMain || !adminDefaults || !adminServices || !defaultPaths || !sessionApi || !subAgentManager) return;

  const allowManage = Boolean(exposeSubagents);
  const log = typeof logInstall === 'function' ? logInstall : () => {};
  const createId = typeof createActionId === 'function' ? createActionId : () => '';
  const getWindow = typeof mainWindowGetter === 'function' ? mainWindowGetter : () => null;
  const sanitize = typeof sanitizeAdminForUi === 'function' ? sanitizeAdminForUi : (snapshot) => snapshot;

  const syncAdminSnapshot = () => {
    const snapshot = adminServices.snapshot();
    syncAdminToFiles(snapshot, {
      modelsPath: defaultPaths.models,
      mcpConfigPath: defaultPaths.mcpConfig,
      subagentsPath: defaultPaths.installedSubagents,
      promptsPath: defaultPaths.systemPrompt,
      systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
      systemUserPromptPath: defaultPaths.systemUserPrompt,
      subagentPromptsPath: defaultPaths.subagentSystemPrompt,
      subagentUserPromptPath: defaultPaths.subagentUserPrompt,
      tasksPath: null,
    });
    const windowRef = getWindow();
    if (windowRef) {
      windowRef.webContents.send('admin:update', {
        data: sanitize(snapshot),
        dbPath: adminServices.dbPath,
        uiFlags,
      });
      windowRef.webContents.send('config:update', sessionApi.readConfigPayload());
    }
    return snapshot;
  };

  ipcMain.handle('subagents:setModel', async (_event, payload = {}) => {
    const result = adminDefaults.setSubagentModels(payload);
    adminDefaults.maybeReseedSubagentsFromPlugins();
    syncAdminSnapshot();
    return result;
  });

  ipcMain.handle('subagents:marketplace:list', async () => {
    try {
      return {
        ok: true,
        marketplace: subAgentManager.listMarketplace(),
        sources: allowManage ? subAgentManager.listMarketplaceSources() : [],
      };
    } catch (err) {
      return { ok: false, message: err?.message || String(err), marketplace: [], sources: [] };
    }
  });

  ipcMain.handle('subagents:marketplace:addSource', async (_event, payload = {}) => {
    if (!allowManage) {
      return { ok: false, message: 'Sub-agents 管理未开启（需要开发者模式或开启 Sub-agents 暴露开关）。' };
    }
    const source = typeof payload?.source === 'string' ? payload.source.trim() : '';
    if (!source) {
      return { ok: false, message: 'source is required' };
    }
    try {
      const result = subAgentManager.addMarketplaceSource(source);
      const windowRef = getWindow();
      if (windowRef) {
        windowRef.webContents.send('config:update', sessionApi.readConfigPayload());
      }
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });

  ipcMain.handle('subagents:plugins:install', async (_event, payload = {}) => {
    const actionId = createId('subagent_install');
    if (!allowManage) {
      log('warn', 'subagents.install.denied', { actionId });
      return {
        ok: false,
        message: 'Sub-agents 管理未开启（需要开发者模式或开启 Sub-agents 暴露开关）。',
        logId: actionId,
      };
    }
    const pluginId =
      typeof payload?.id === 'string'
        ? payload.id.trim()
        : typeof payload?.pluginId === 'string'
          ? payload.pluginId.trim()
          : '';
    if (!pluginId) {
      log('warn', 'subagents.install.missing_id', { actionId });
      return { ok: false, message: 'pluginId is required', logId: actionId };
    }
    try {
      log('info', 'subagents.install.start', { actionId, pluginId });
      const changed = subAgentManager.install(pluginId);
      adminDefaults.maybeReseedSubagentsFromPlugins();
      syncAdminSnapshot();
      log('info', 'subagents.install.complete', { actionId, pluginId, changed });
      return { ok: true, changed, logId: actionId };
    } catch (err) {
      log('error', 'subagents.install.failed', { actionId, pluginId }, err);
      return { ok: false, message: err?.message || String(err), logId: actionId };
    }
  });

  ipcMain.handle('subagents:plugins:uninstall', async (_event, payload = {}) => {
    const actionId = createId('subagent_uninstall');
    if (!allowManage) {
      log('warn', 'subagents.uninstall.denied', { actionId });
      return {
        ok: false,
        message: 'Sub-agents 管理未开启（需要开发者模式或开启 Sub-agents 暴露开关）。',
        logId: actionId,
      };
    }
    const pluginId =
      typeof payload?.id === 'string'
        ? payload.id.trim()
        : typeof payload?.pluginId === 'string'
          ? payload.pluginId.trim()
          : '';
    if (!pluginId) {
      log('warn', 'subagents.uninstall.missing_id', { actionId });
      return { ok: false, message: 'pluginId is required', logId: actionId };
    }
    try {
      log('info', 'subagents.uninstall.start', { actionId, pluginId });
      const removed = subAgentManager.uninstall(pluginId);
      adminDefaults.maybeReseedSubagentsFromPlugins();
      syncAdminSnapshot();
      log('info', 'subagents.uninstall.complete', { actionId, pluginId, removed });
      return { ok: true, removed, logId: actionId };
    } catch (err) {
      log('error', 'subagents.uninstall.failed', { actionId, pluginId }, err);
      return { ok: false, message: err?.message || String(err), logId: actionId };
    }
  });
}

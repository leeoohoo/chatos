import { installUiAppsPlugins } from './ui-apps/plugin-installer.js';
import { createLspInstaller } from './lsp-installer.js';

export function registerUiAppsPluginInstallerIpc({
  ipcMain,
  dialog,
  getWindow,
  createActionId,
  logInstall,
  stateDir,
  logger,
} = {}) {
  if (!ipcMain) return;
  const resolveWindow = typeof getWindow === 'function' ? getWindow : () => null;
  const log = typeof logInstall === 'function' ? logInstall : () => {};
  const createId = typeof createActionId === 'function' ? createActionId : () => '';

  ipcMain.handle('uiApps:plugins:install', async (_event, payload = {}) => {
    const actionId = createId('uiapps_install');
    log('info', 'uiapps.install.start', {
      actionId,
      fromDialog: !payload?.path,
      platform: process.platform,
    });
    let selectedPath = typeof payload?.path === 'string' ? payload.path.trim() : '';
    if (!selectedPath) {
      if (!dialog || typeof dialog.showOpenDialog !== 'function') {
        log('error', 'uiapps.install.dialog_unavailable', { actionId });
        return { ok: false, message: 'dialog not available', logId: actionId };
      }
      let result = null;
      const windowRef = resolveWindow() || undefined;
      if (process.platform === 'win32') {
        let mode = typeof payload?.mode === 'string' ? payload.mode.trim().toLowerCase() : '';
        if (!mode && dialog && typeof dialog.showMessageBox === 'function') {
          const selection = await dialog.showMessageBox(windowRef, {
            type: 'question',
            title: '导入应用包',
            message: '请选择应用包类型',
            detail: 'Windows 的文件选择器在“目录/文件混选”模式下可能看不到 .zip。',
            buttons: ['选择 .zip', '选择目录', '取消'],
            defaultId: 0,
            cancelId: 2,
          });
          if (selection?.response === 2) {
            log('info', 'uiapps.install.canceled', { actionId, stage: 'mode_select' });
            return { ok: false, canceled: true, logId: actionId };
          }
          mode = selection?.response === 1 ? 'dir' : 'zip';
        }
        if (mode !== 'dir' && mode !== 'zip') {
          mode = 'zip';
        }
        result = await dialog.showOpenDialog(windowRef, {
          title: mode === 'dir' ? '选择应用包目录' : '选择应用包（.zip）',
          properties: mode === 'dir' ? ['openDirectory'] : ['openFile'],
          ...(mode === 'zip' ? { filters: [{ name: 'App package', extensions: ['zip'] }] } : null),
        });
      } else {
        result = await dialog.showOpenDialog(windowRef, {
          title: '选择应用包（目录或 .zip）',
          properties: ['openFile', 'openDirectory'],
          filters: [{ name: 'App package', extensions: ['zip'] }],
        });
      }
      if (result.canceled) {
        log('info', 'uiapps.install.canceled', { actionId, stage: 'path_select' });
        return { ok: false, canceled: true, logId: actionId };
      }
      selectedPath = Array.isArray(result.filePaths) ? result.filePaths[0] : '';
      if (!selectedPath) {
        log('info', 'uiapps.install.canceled', { actionId, stage: 'path_empty' });
        return { ok: false, canceled: true, logId: actionId };
      }
    }

    try {
      log('info', 'uiapps.install.selected', { actionId, selectedPath });
      const result = await installUiAppsPlugins({
        inputPath: selectedPath,
        stateDir,
        logger,
        actionId,
      });
      log('info', 'uiapps.install.complete', {
        actionId,
        pluginCount: Array.isArray(result?.plugins) ? result.plugins.length : 0,
        pluginsRoot: result?.pluginsRoot || '',
      });
      return { ...result, logId: actionId };
    } catch (err) {
      log('error', 'uiapps.install.failed', { actionId, selectedPath }, err);
      return { ok: false, message: err?.message || String(err), logId: actionId };
    }
  });
}

export function registerLspInstallerIpc({
  ipcMain,
  rootDir,
  logger,
  env,
  createActionId,
  logInstall,
} = {}) {
  if (!ipcMain) return null;
  const log = typeof logInstall === 'function' ? logInstall : () => {};
  const createId = typeof createActionId === 'function' ? createActionId : () => '';
  const lspInstaller = createLspInstaller({ rootDir, logger, env });

  ipcMain.handle('lsp:catalog', async () => {
    try {
      return await lspInstaller.getCatalog();
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });
  ipcMain.handle('lsp:install', async (_event, payload = {}) => {
    const actionId = createId('lsp_install');
    try {
      const ids = Array.isArray(payload?.ids) ? payload.ids : [];
      const timeout_ms = payload?.timeout_ms;
      log('info', 'lsp.install.start', { actionId, ids, timeout_ms });
      const result = await lspInstaller.install({ ids, timeout_ms, actionId });
      log('info', 'lsp.install.complete', {
        actionId,
        ok: result?.ok === true,
        results: Array.isArray(result?.results) ? result.results.length : 0,
      });
      return { ...result, logId: actionId };
    } catch (err) {
      log('error', 'lsp.install.failed', { actionId }, err);
      return { ok: false, message: err?.message || String(err), logId: actionId };
    }
  });

  return lspInstaller;
}

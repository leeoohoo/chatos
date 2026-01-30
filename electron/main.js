import path from 'path';
import fs from 'fs';
import os from 'os';
// electron 是 CommonJS，需要用 default import 解构
import electron from 'electron';
import { fileURLToPath, pathToFileURL } from 'url';
import { registerAdminApi, sanitizeAdminSnapshot } from './backend/api.js';
import { registerRegistryApi } from './backend/registry.js';
import { initRegistryCenter } from './backend/registry-center.js';
import {
  resolveExistingAppDbPath,
  syncRegistryFromAppDb,
  syncRegistryFromServices,
} from './backend/registry-sync.js';
import { registerUiAppsApi } from './ui-apps/index.js';
import { createConfigManager } from './config-manager/index.js';
import { registerConfigIpcHandlers } from './config-manager/ipc-handlers.js';
import { registerQuickSwitchHandlers } from './config-manager/quick-switch.js';
import { createAdminDefaultsManager } from './admin-defaults.js';
import { createWorkspaceOps } from './workspace.js';
import { listSessions, killSession, killAllSessions, restartSession, stopSession, readSessionLog } from './sessions.js';
import { createSessionApi } from './session-api.js';
import { createCliShim } from './cli-shim.js';
import { createTerminalManager } from './terminal-manager.js';
import { registerChatApi } from './chat/index.js';
import { ensureAllSubagentsInstalled, maybePurgeUiAppsSyncedAdminData, readLegacyState } from './main-helpers.js';
import {
  createActionId,
  createInstallLog,
  createRuntimeLogReader,
  patchProcessPath,
  resolveAppIconPath,
} from './main-utils.js';
import { registerLspInstallerIpc, registerUiAppsPluginInstallerIpc } from './main-installer-ipc.js';
import { createCliIpcHandlers } from './cli-ipc.js';
import { registerSessionIpcHandlers } from './session-ipc.js';
import { registerSubagentIpcHandlers } from './subagent-ipc.js';
import { resolveEngineRoot } from '../src/engine-paths.js';
import { resolveSessionRoot, persistSessionRoot } from '../src/session-root.js';
import { ensureAppStateDir } from '../packages/common/state-core/state-paths.js';
import { createRuntimeLogger } from '../packages/common/state-core/runtime-log.js';
import { createDb } from '../packages/common/admin-data/storage.js';
import { createAdminServices } from '../packages/common/admin-data/services/index.js';
import { syncAdminToFiles } from '../packages/common/admin-data/sync.js';
import { buildAdminSeed } from '../packages/common/admin-data/legacy.js';
import { ConfigApplier } from '../packages/core/session/ConfigApplier.js';
import { resolveEngineModule } from '../src/engine-loader.js';
import { resolveBoolEnv } from './shared/env-utils.js';

const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu } = electron;
const APP_DISPLAY_NAME = 'chatos';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const baseEnv = { ...process.env };
const runtimeEnv = { ...baseEnv, MODEL_CLI_HOST_APP: 'chatos' };
// 会话根：桌面端默认使用 home（可通过环境变量显式覆盖），避免被 CLI 的 last-session-root 影响。
const explicitSessionRoot =
  typeof baseEnv.MODEL_CLI_SESSION_ROOT === 'string' && baseEnv.MODEL_CLI_SESSION_ROOT.trim()
    ? baseEnv.MODEL_CLI_SESSION_ROOT.trim()
    : '';
const sessionRoot = resolveSessionRoot({ preferHome: true, env: runtimeEnv });
runtimeEnv.MODEL_CLI_SESSION_ROOT = sessionRoot;
if (explicitSessionRoot) {
  persistSessionRoot(sessionRoot, { env: runtimeEnv });
}

const engineRoot = resolveEngineRoot({ projectRoot });
if (!engineRoot) {
  throw new Error('Engine sources not found (expected ./packages/aide relative to chatos).');
}
const { createSubAgentManager } = await import(
  pathToFileURL(resolveEngineModule({ engineRoot, relativePath: 'subagents/index.js' })).href
);

const appIconPath = resolveAppIconPath(projectRoot);
const hostApp =
  String(runtimeEnv.MODEL_CLI_HOST_APP || 'chatos')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'chatos';
const stateDir = ensureAppStateDir(sessionRoot, { hostApp, fallbackHostApp: 'chatos', env: runtimeEnv });
const authDir = path.join(stateDir, 'auth');
const terminalsDir = path.join(stateDir, 'terminals');

const installLogger = createRuntimeLogger({
  sessionRoot,
  hostApp,
  scope: 'INSTALL',
  runId: 'desktop',
  env: runtimeEnv,
});
const logInstall = createInstallLog(installLogger);
const readRuntimeLog = createRuntimeLogReader({ sessionRoot, hostApp, runtimeEnv });

let mainWindow = null;
let chatApi = null;
let sessionApi = null;
let terminalManager = null;
let uiAppsManager = null;
const MAX_VIEW_FILE_BYTES = 512 * 1024;
const MAX_LIST_DIR_ENTRIES = 600;
const UI_TERMINAL_STDIO = ['pipe', 'ignore', 'ignore'];
// 桌面 App 里安装的终端命令（无需系统 Node.js）
const DEFAULT_CLI_COMMAND_NAME = 'chatos';
// Windows 上桌面版通过 WindowsApps 放一个 .cmd，很容易和 npm 全局安装的 `chatos` 发生 PATH 冲突；
// 默认改成另一个名字，避免覆盖/抢占用户的终端命令。
const WINDOWS_DESKTOP_CLI_COMMAND_NAME = 'chatos-desktop';
const CLI_COMMAND_NAME = process.platform === 'win32' ? WINDOWS_DESKTOP_CLI_COMMAND_NAME : DEFAULT_CLI_COMMAND_NAME;
const LEGACY_CLI_COMMAND_NAME = DEFAULT_CLI_COMMAND_NAME;
const UI_DEVELOPER_MODE = (!app?.isPackaged) || runtimeEnv.MODEL_CLI_UI_DEVELOPER_MODE === '1';
const UI_EXPOSE_SUBAGENTS = resolveBoolEnv(runtimeEnv.MODEL_CLI_UI_EXPOSE_SUBAGENTS, true);
const UI_WEB_SECURITY = resolveBoolEnv(runtimeEnv.MODEL_CLI_UI_WEB_SECURITY, true);
const UI_FLAGS = { developerMode: UI_DEVELOPER_MODE, aideInstalled: true, exposeSubagents: UI_EXPOSE_SUBAGENTS };
const ENABLE_ALL_SUBAGENTS = resolveBoolEnv(runtimeEnv.MODEL_CLI_ENABLE_ALL_SUBAGENTS, Boolean(app?.isPackaged));
// IMPORTANT: keep UI Apps scanning read-only by default; only enable DB sync explicitly via env.
const UIAPPS_SYNC_AI_CONTRIBUTES = resolveBoolEnv(runtimeEnv.MODEL_CLI_UIAPPS_SYNC_AI_CONTRIBUTES, false);
const BUILTIN_UI_APPS_DIR = path.join(projectRoot, 'ui_apps', 'plugins');
const REGISTRY_KNOWN_APPS = Array.from(new Set([hostApp, 'git_app', 'wsl'].filter(Boolean)));
const sanitizeAdminForUi = (snapshot) => {
  const sanitized = sanitizeAdminSnapshot(snapshot);
  if (UI_DEVELOPER_MODE || UI_EXPOSE_SUBAGENTS) return sanitized;
  if (!sanitized || typeof sanitized !== 'object') return sanitized;
  return { ...sanitized, subagents: [] };
};

patchProcessPath(runtimeEnv);
try {
  if (app && typeof app.setName === 'function') app.setName(APP_DISPLAY_NAME);
} catch {
  // ignore
}



registerUiAppsPluginInstallerIpc({
  ipcMain,
  dialog,
  getWindow: () => mainWindow,
  createActionId,
  logInstall,
  stateDir,
  logger: installLogger,
});

registerLspInstallerIpc({
  ipcMain,
  rootDir: projectRoot,
  logger: installLogger,
  env: runtimeEnv,
  createActionId,
  logInstall,
});

const defaultPaths = {
  defaultsRoot: engineRoot,
  models: path.join(authDir, 'models.yaml'),
  sessionReport: path.join(authDir, 'session-report.html'),
  events: path.join(stateDir, 'events.jsonl'),
  fileChanges: path.join(stateDir, 'file-changes.jsonl'),
  uiPrompts: path.join(stateDir, 'ui-prompts.jsonl'),
  runs: path.join(stateDir, 'runs.jsonl'),
  marketplace: path.join(engineRoot, 'subagents', 'marketplace.json'),
  marketplaceUser: path.join(stateDir, 'subagents', 'marketplace.json'),
  pluginsDir: path.join(engineRoot, 'subagents', 'plugins'),
  pluginsDirUser: path.join(stateDir, 'subagents', 'plugins'),
  installedSubagents: path.join(stateDir, 'subagents.json'),
  adminDb: path.join(stateDir, `${hostApp}.db.sqlite`),
};

const legacyAdminDb = path.join(stateDir, `${hostApp}.db.json`);
if (ENABLE_ALL_SUBAGENTS) {
  ensureAllSubagentsInstalled({
    installedSubagentsPath: defaultPaths.installedSubagents,
    pluginsDirList: [defaultPaths.pluginsDir, defaultPaths.pluginsDirUser],
    enableAllSubagents: ENABLE_ALL_SUBAGENTS,
  });
}
const adminDb = createDb({
  dbPath: defaultPaths.adminDb,
  seed: readLegacyState(legacyAdminDb) || buildAdminSeed(defaultPaths),
});
const adminServices = createAdminServices(adminDb);
const configManager = createConfigManager(adminDb, { adminServices });
const registryCenter = initRegistryCenter({ db: adminDb });
const adminDefaults = createAdminDefaultsManager({ defaultPaths, adminDb, adminServices, env: runtimeEnv });
adminDefaults.maybeReseedModelsFromYaml();
adminDefaults.maybeReseedSubagentsFromPlugins();
if (ENABLE_ALL_SUBAGENTS) {
  try {
    const current = adminServices.subagents.list() || [];
    current.forEach((record) => {
      if (!record?.id) return;
      if (record.enabled === false) {
        adminServices.subagents.update(record.id, { enabled: true });
      }
    });
  } catch {
    // ignore subagent enable failures
  }
}
adminDefaults.refreshModelsFromDefaults();
adminDefaults.refreshBuiltinsFromDefaults();
adminDefaults.refreshMcpServersFromDefaults();
if (!UIAPPS_SYNC_AI_CONTRIBUTES) {
  maybePurgeUiAppsSyncedAdminData({ stateDir, adminServices, hostApp, env: runtimeEnv });
}

registerConfigIpcHandlers(ipcMain, configManager, { getWindow: () => mainWindow });

if (!app.isPackaged) {
  configManager.migrateLegacyConfig().catch((err) => {
    console.error('[config:migrate]', err?.message || err);
  });
}

syncAdminToFiles(adminServices.snapshot(), {
  modelsPath: defaultPaths.models,
  subagentsPath: defaultPaths.installedSubagents,
  tasksPath: null,
});

const workspaceOps = createWorkspaceOps({
  maxViewFileBytes: MAX_VIEW_FILE_BYTES,
  maxListDirEntries: MAX_LIST_DIR_ENTRIES,
});

const subAgentManager = createSubAgentManager({
  baseDir: path.join(engineRoot, 'subagents'),
  stateDir,
});

sessionApi = createSessionApi({
  defaultPaths,
  adminDb,
  adminServices,
  mainWindowGetter: () => mainWindow,
  sessions: { killAllSessions: () => killAllSessions({ sessionRoot, env: runtimeEnv }) },
  uiFlags: UI_FLAGS,
});

const cliShim = createCliShim({ projectRoot: engineRoot, commandName: CLI_COMMAND_NAME, env: runtimeEnv });
const legacyCliShim =
  process.platform === 'win32' && CLI_COMMAND_NAME !== LEGACY_CLI_COMMAND_NAME
    ? createCliShim({ projectRoot: engineRoot, commandName: LEGACY_CLI_COMMAND_NAME, env: runtimeEnv })
    : null;

terminalManager = createTerminalManager({
  projectRoot: engineRoot,
  terminalsDir,
  sessionRoot,
  defaultPaths,
  adminServices,
  mainWindowGetter: () => mainWindow,
  uiTerminalStdio: UI_TERMINAL_STDIO,
  env: runtimeEnv,
});

registerAdminApi(ipcMain, adminServices, () => mainWindow, {
  exposeSubagents: UI_DEVELOPER_MODE || UI_EXPOSE_SUBAGENTS,
  uiFlags: UI_FLAGS,
  onChange: async () => {
    const snapshot = adminServices.snapshot();
    syncAdminToFiles(snapshot, {
      modelsPath: defaultPaths.models,
      subagentsPath: defaultPaths.installedSubagents,
      tasksPath: defaultPaths.tasks,
    });
    if (mainWindow) {
      mainWindow.webContents.send('config:update', sessionApi.readConfigPayload());
    }
  },
});

const syncAdminAndBroadcast = async () => {
  const snapshot = adminServices.snapshot();
  syncAdminToFiles(snapshot, {
    modelsPath: defaultPaths.models,
    subagentsPath: defaultPaths.installedSubagents,
    tasksPath: defaultPaths.tasks,
  });
  if (mainWindow) {
    mainWindow.webContents.send('config:update', sessionApi.readConfigPayload());
    mainWindow.webContents.send('admin:update', {
      data: sanitizeAdminForUi(snapshot),
      dbPath: adminServices.dbPath,
      uiFlags: UI_FLAGS,
    });
  }
};

const configApplier = new ConfigApplier({
  configManager,
  adminServices,
  onApplied: async () => {
    await syncAdminAndBroadcast();
  },
});
registerQuickSwitchHandlers(ipcMain, configApplier);

uiAppsManager = registerUiAppsApi(ipcMain, {
  projectRoot,
  stateDir,
  adminServices,
  onAdminMutation: syncAdminAndBroadcast,
  syncAiContributes: UIAPPS_SYNC_AI_CONTRIBUTES,
  builtinPluginsDir: BUILTIN_UI_APPS_DIR,
});
if (uiAppsManager && typeof uiAppsManager.listRegistry === 'function') {
  uiAppsManager.listRegistry().catch(() => {});
}
registerRegistryApi(ipcMain, { sessionRoot, knownApps: REGISTRY_KNOWN_APPS });

Promise.resolve()
  .then(async () => {
    try {
      syncRegistryFromServices({
        registry: registryCenter,
        providerAppId: hostApp,
        services: adminServices,
      });
    } catch {
      // ignore
    }

    const otherApps = REGISTRY_KNOWN_APPS.filter((appId) => appId !== hostApp);
    for (const appId of otherApps) {
      const { dbPath, dbExists } = resolveExistingAppDbPath({ sessionRoot, hostApp: appId });
      if (dbExists) {
        await syncRegistryFromAppDb({ registry: registryCenter, providerAppId: appId, dbPath });
        continue;
      }

    }
  })
  .catch(() => {});

chatApi = registerChatApi(ipcMain, {
  adminDb,
  adminServices,
  defaultPaths,
  sessionRoot,
  workspaceRoot: process.cwd(),
  subAgentManager,
  uiApps: uiAppsManager,
  mainWindowGetter: () => mainWindow,
});

registerSessionIpcHandlers({
  ipcMain,
  sessionApi,
  workspaceOps,
});

ipcMain.handle('dialog:selectDirectory', async (_event, payload = {}) => {
  const preferred = typeof payload?.defaultPath === 'string' ? payload.defaultPath.trim() : '';
  const fallback = runtimeEnv.HOME || runtimeEnv.USERPROFILE || os.homedir() || process.cwd();
  const defaultPath = preferred && fs.existsSync(preferred) ? preferred : fallback;
  try {
    if (!dialog || typeof dialog.showOpenDialog !== 'function') {
      return { ok: false, message: 'dialog not available' };
    }
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: '选择工作目录',
      defaultPath,
      properties: ['openDirectory'],
    });
    if (result.canceled) {
      return { ok: false, canceled: true };
    }
    const selected = Array.isArray(result.filePaths) ? result.filePaths[0] : '';
    if (!selected) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: selected };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});

createCliIpcHandlers({
  ipcMain,
  createActionId,
  logInstall,
  cliShim,
  legacyCliShim,
  commandName: CLI_COMMAND_NAME,
});

registerSubagentIpcHandlers({
  ipcMain,
  adminDefaults,
  adminServices,
  defaultPaths,
  sessionApi,
  subAgentManager,
  uiFlags: UI_FLAGS,
  exposeSubagents: UI_DEVELOPER_MODE || UI_EXPOSE_SUBAGENTS,
  createActionId,
  logInstall,
  mainWindowGetter: () => mainWindow,
  sanitizeAdminForUi,
});

ipcMain.handle('sessions:list', async () => listSessions({ sessionRoot, env: runtimeEnv }));
ipcMain.handle('sessions:kill', async (_event, payload = {}) =>
  killSession({ sessionRoot, name: payload?.name, env: runtimeEnv })
);
ipcMain.handle('sessions:killAll', async () => killAllSessions({ sessionRoot, env: runtimeEnv }));
ipcMain.handle('sessions:restart', async (_event, payload = {}) =>
  restartSession({ sessionRoot, name: payload?.name, env: runtimeEnv })
);
ipcMain.handle('sessions:stop', async (_event, payload = {}) =>
  stopSession({ sessionRoot, name: payload?.name, env: runtimeEnv })
);
ipcMain.handle('sessions:readLog', async (_event, payload = {}) =>
  readSessionLog({
    sessionRoot,
    name: payload?.name,
    lineCount: payload?.lineCount,
    maxBytes: payload?.maxBytes,
    env: runtimeEnv,
  })
);
ipcMain.handle('runtimeLog:read', async (_event, payload = {}) =>
  readRuntimeLog({
    lineCount: payload?.lineCount,
    maxBytes: payload?.maxBytes,
  })
);

ipcMain.handle('terminalStatus:list', async () => terminalManager.listStatusesWithWatcher());
ipcMain.handle('terminal:dispatch', async (_event, payload = {}) => terminalManager.dispatchMessage(payload));
ipcMain.handle('terminal:action', async (_event, payload = {}) => terminalManager.sendAction(payload));
ipcMain.handle('terminal:intervene', async (_event, payload = {}) => terminalManager.intervene(payload));
ipcMain.handle('terminal:stop', async (_event, payload = {}) => terminalManager.stopRun(payload));
ipcMain.handle('terminal:terminate', async (_event, payload = {}) => terminalManager.terminateRun(payload));
ipcMain.handle('terminal:close', async (_event, payload = {}) => terminalManager.closeRun(payload));

app.whenReady().then(() => {
  if (process.platform === 'darwin' && appIconPath) {
    try {
      const dockIcon = nativeImage.createFromPath(appIconPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    } catch {
      // ignore
    }
  }
  // Remove the default Electron application menu (all platforms).
  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate([]));
  } catch {
    // ignore
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  terminalManager?.cleanupLaunchedCli?.();
});

function createWindow() {
  const options = {
    width: 1280,
    height: 860,
    title: APP_DISPLAY_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: UI_WEB_SECURITY,
    },
  };
  if (appIconPath) {
    options.icon = appIconPath;
  }
  mainWindow = new BrowserWindow(options);
  try {
    // Hide menu bar on Windows/Linux even if a menu is set elsewhere.
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setMenu(null);
  } catch {
    // ignore
  }
  try {
    // With the app menu removed, wire up basic clipboard/edit shortcuts manually.
    registerBasicEditShortcuts(mainWindow);
  } catch {
    // ignore
  }
  try {
    mainWindow.setTitle(APP_DISPLAY_NAME);
  } catch {
    // ignore
  }
  const htmlPath = path.join(__dirname, '..', 'apps', 'ui', 'dist', 'index.html');
  mainWindow.loadFile(htmlPath);
  mainWindow.on('closed', () => {
    mainWindow = null;
    sessionApi?.dispose?.();
    terminalManager?.dispose?.();
    chatApi?.dispose?.();
  });
}

function registerBasicEditShortcuts(window) {
  if (!window?.webContents) return;
  const { webContents } = window;
  webContents.on('before-input-event', (event, input) => {
    if (!input || input.type !== 'keyDown') return;
    const isMac = process.platform === 'darwin';
    const modifierPressed = isMac ? input.meta : input.control;
    if (!modifierPressed) return;
    const key = String(input.key || '').toLowerCase();
    switch (key) {
      case 'c':
        webContents.copy();
        event.preventDefault();
        break;
      case 'v':
        webContents.paste();
        event.preventDefault();
        break;
      case 'x':
        webContents.cut();
        event.preventDefault();
        break;
      case 'a':
        webContents.selectAll();
        event.preventDefault();
        break;
      case 'z':
        if (input.shift) {
          webContents.redo();
        } else {
          webContents.undo();
        }
        event.preventDefault();
        break;
      case 'y':
        if (!isMac) {
          webContents.redo();
          event.preventDefault();
        }
        break;
      default:
        break;
    }
  });
}

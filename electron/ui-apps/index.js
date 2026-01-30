import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { isUiAppsPluginTrusted, setUiAppsPluginTrust } from './trust-store.js';
import { scanPluginsDir } from './registry-scan.js';
import { sanitizeAppForUi } from './registry-sanitize.js';
import { syncAiContributes, syncRegistryCenterFromUiApps } from './registry-sync.js';
import { createRuntimeLogger } from '../../packages/common/state-core/runtime-log.js';
import { resolveBoolEnv } from '../shared/env-utils.js';
import { readPromptSource } from './prompt-source.js';

const DEFAULT_MANIFEST_FILE = 'plugin.json';
const DEFAULT_MAX_MANIFEST_BYTES = 256 * 1024;
const DEFAULT_MAX_PROMPT_BYTES = 128 * 1024;

function isPathInsideRoot(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  if (relative === '') return true;
  if (relative === '..') return false;
  if (relative.startsWith(`..${path.sep}`)) return false;
  return !path.isAbsolute(relative);
}

function rmForce(targetPath) {
  const normalized = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!normalized) return;
  try {
    fs.rmSync(normalized, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function createUiAppsManager(options = {}) {
  return new UiAppsManager(options);
}

export function registerUiAppsApi(ipcMain, options = {}) {
  const manager = createUiAppsManager(options);
  ipcMain.handle('uiApps:list', async () => manager.listRegistry());
  ipcMain.handle('uiApps:ai:get', async (_event, payload = {}) => {
    try {
      const data = await manager.getAiContribution(payload);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });
  ipcMain.handle('uiApps:invoke', async (_event, payload = {}) => manager.invoke(payload));
  ipcMain.handle('uiApps:plugins:trust', async (_event, payload = {}) => manager.setPluginTrust(payload));
  ipcMain.handle('uiApps:plugins:uninstall', async (_event, payload = {}) => manager.uninstallPlugin(payload));
  return manager;
}

class UiAppsManager {
  constructor(options = {}) {
    this.projectRoot = typeof options.projectRoot === 'string' ? options.projectRoot : process.cwd();
    this.stateDir = typeof options.stateDir === 'string' ? options.stateDir : null;
    this.sessionRoot =
      typeof options.sessionRoot === 'string'
        ? options.sessionRoot
        : this.stateDir
          ? path.dirname(this.stateDir)
          : null;
    this.manifestFile =
      typeof options.manifestFile === 'string' && options.manifestFile.trim()
        ? options.manifestFile.trim()
        : DEFAULT_MANIFEST_FILE;
    this.maxManifestBytes = Number.isFinite(options.maxManifestBytes)
      ? options.maxManifestBytes
      : DEFAULT_MAX_MANIFEST_BYTES;
    this.maxPromptBytes = Number.isFinite(options.maxPromptBytes) ? options.maxPromptBytes : DEFAULT_MAX_PROMPT_BYTES;
    this.adminServices = options.adminServices || null;
    this.onAdminMutation = typeof options.onAdminMutation === 'function' ? options.onAdminMutation : null;
    this.syncAiContributes = typeof options.syncAiContributes === 'boolean' ? options.syncAiContributes : false;

    this.builtinPluginsDir =
      typeof options.builtinPluginsDir === 'string' && options.builtinPluginsDir.trim()
        ? path.resolve(options.builtinPluginsDir.trim())
        : path.join(this.projectRoot, 'ui_apps', 'plugins');

    this.userPluginsDir =
      typeof options.userPluginsDir === 'string' && options.userPluginsDir.trim()
        ? path.resolve(options.userPluginsDir.trim())
        : this.stateDir
          ? path.join(this.stateDir, 'ui_apps', 'plugins')
          : null;

    this.dataRootDir = this.stateDir ? path.join(this.stateDir, 'ui_apps', 'data') : null;

    this.registryMap = new Map();
    this.backendCache = new Map();
    this.loggedErrorKeys = new Set();
    this.runtimeLogger =
      this.stateDir && this.stateDir.trim()
        ? createRuntimeLogger({
            filePath: path.join(this.stateDir, 'runtime-log.jsonl'),
            scope: 'UI_APPS',
          })
        : null;
  }

  async listRegistry() {
    const pluginDirs = {
      builtin: this.builtinPluginsDir,
      user: this.userPluginsDir,
    };

    this.#ensureDir(this.userPluginsDir);
    this.#ensureDir(this.dataRootDir);

    const errors = [];
    const scanOptions = {
      manifestFile: this.manifestFile,
      maxManifestBytes: this.maxManifestBytes,
      stateDir: this.stateDir,
      sessionRoot: this.sessionRoot,
      projectRoot: this.projectRoot,
      dataRootDir: this.dataRootDir,
      isPluginTrusted: (plugin) => this.#isPluginTrusted(plugin),
      errors,
    };
    const builtin = scanPluginsDir({
      dirPath: this.builtinPluginsDir,
      source: 'builtin',
      ...scanOptions,
    });
    const user = this.userPluginsDir
      ? scanPluginsDir({
          dirPath: this.userPluginsDir,
          source: 'user',
          ...scanOptions,
        })
      : [];

    const byId = new Map();
    builtin.forEach((plugin) => {
      byId.set(plugin.id, plugin);
    });
    user.forEach((plugin) => {
      byId.set(plugin.id, plugin);
    });

    const pluginsInternal = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));

    if (this.adminServices) {
      try {
        syncRegistryCenterFromUiApps({
          adminServices: this.adminServices,
          pluginsInternal,
          maxPromptBytes: this.maxPromptBytes,
          errors,
        });
      } catch (err) {
        errors.push({
          dir: '(uiApps registry sync)',
          source: 'registry',
          message: err?.message || String(err),
        });
      }
    }

    let didMutateAdmin = false;
    if (this.syncAiContributes && this.adminServices) {
      try {
        didMutateAdmin = syncAiContributes({
          adminServices: this.adminServices,
          pluginsInternal,
          maxPromptBytes: this.maxPromptBytes,
          errors,
        });
      } catch (err) {
        errors.push({
          dir: '(uiApps ai sync)',
          source: 'ai',
          message: err?.message || String(err),
        });
      }
      if (didMutateAdmin && this.onAdminMutation) {
        try {
          await this.onAdminMutation();
        } catch (err) {
          errors.push({
            dir: '(uiApps ai sync)',
            source: 'ai',
            message: `Failed to broadcast admin change: ${err?.message || String(err)}`,
          });
        }
      }
    }

    const plugins = pluginsInternal.map((plugin) => ({
      id: plugin.id,
      providerAppId: plugin.providerAppId || '',
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      source: plugin.source,
      trusted: plugin.trusted === true,
      backend: plugin.backend ? { entry: plugin.backend.entry, available: Boolean(plugin.backend.resolved) } : null,
      apps: plugin.apps.map(sanitizeAppForUi),
    }));
    const apps = pluginsInternal
      .flatMap((plugin) =>
        plugin.apps.map((app) => ({
          ...sanitizeAppForUi(app),
          plugin: {
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            source: plugin.source,
            trusted: plugin.trusted === true,
            backend: plugin.backend ? { entry: plugin.backend.entry, available: Boolean(plugin.backend.resolved) } : null,
          },
        }))
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    this.registryMap = byId;
    if (errors.length > 0) {
      errors.forEach((entry) => {
        const key = `${entry?.source || 'unknown'}:${entry?.dir || ''}:${entry?.message || ''}`;
        this.#logRuntimeOnce(key, 'warn', 'UI Apps registry error', entry);
      });
    }
    return { ok: true, pluginDirs, plugins, apps, errors };
  }

  async getAiContribution(payload = {}) {
    const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
    const appId = typeof payload?.appId === 'string' ? payload.appId.trim() : '';
    if (!pluginId || !appId) return null;

    if (!this.registryMap.size) {
      await this.listRegistry();
    }
    let plugin = this.registryMap.get(pluginId);
    if (!plugin) {
      await this.listRegistry();
      plugin = this.registryMap.get(pluginId);
    }
    if (!plugin) return null;

    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
    if (!pluginDir) return null;

    const app = (Array.isArray(plugin?.apps) ? plugin.apps : []).find(
      (entry) => String(entry?.id || '').trim() === appId
    );
    const ai = app?.ai && typeof app.ai === 'object' ? app.ai : null;
    if (!ai) return null;

    const mcp = ai?.mcp && typeof ai.mcp === 'object' ? ai.mcp : null;
    const mcpPrompt = ai?.mcpPrompt && typeof ai.mcpPrompt === 'object' ? ai.mcpPrompt : null;
    let zh = '';
    let en = '';
    if (mcpPrompt) {
      try {
        zh = readPromptSource({
          pluginDir,
          source: mcpPrompt.zh,
          label: 'ai.mcpPrompt.zh',
          maxPromptBytes: this.maxPromptBytes,
        });
      } catch {
        zh = '';
      }
      try {
        en = readPromptSource({
          pluginDir,
          source: mcpPrompt.en,
          label: 'ai.mcpPrompt.en',
          maxPromptBytes: this.maxPromptBytes,
        });
      } catch {
        en = '';
      }
    }

    return {
      pluginId,
      appId,
      pluginDir,
      mcp: mcp && typeof mcp.url === 'string' && mcp.url.trim() ? mcp : null,
      mcpPrompt: mcpPrompt
        ? {
            title: typeof mcpPrompt?.title === 'string' ? mcpPrompt.title : '',
            names: mcpPrompt?.names && typeof mcpPrompt.names === 'object' ? mcpPrompt.names : null,
            zh,
            en,
          }
        : null,
      agent: ai?.agent && typeof ai.agent === 'object' ? ai.agent : null,
    };
  }

  async setPluginTrust(payload = {}) {
    const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
    if (!pluginId) return { ok: false, message: 'pluginId is required' };
    if (!this.stateDir) return { ok: false, message: 'stateDir not available' };
    const trusted = payload?.trusted === true;

    if (!this.registryMap.size) {
      await this.listRegistry();
    }
    let plugin = this.registryMap.get(pluginId);
    if (!plugin) {
      await this.listRegistry();
      plugin = this.registryMap.get(pluginId);
    }
    if (!plugin) {
      return { ok: false, message: `Plugin not found: ${pluginId}` };
    }

    setUiAppsPluginTrust({ pluginId, stateDir: this.stateDir, trusted, pluginDir: plugin?.pluginDir });
    await this.listRegistry();
    return { ok: true, trusted };
  }

  async uninstallPlugin(payload = {}) {
    const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
    if (!pluginId) return { ok: false, message: 'pluginId is required' };
    if (!this.userPluginsDir) return { ok: false, message: 'user plugins dir not available' };

    if (!this.registryMap.size) {
      await this.listRegistry();
    }
    let plugin = this.registryMap.get(pluginId);
    if (!plugin) {
      await this.listRegistry();
      plugin = this.registryMap.get(pluginId);
    }
    if (!plugin) return { ok: false, message: `Plugin not found: ${pluginId}` };
    if (plugin.source !== 'user') {
      return { ok: false, message: 'builtin plugin cannot be uninstalled' };
    }

    const rootDir = path.resolve(this.userPluginsDir);
    const pluginDir = typeof plugin?.pluginDir === 'string' ? path.resolve(plugin.pluginDir) : '';
    if (!pluginDir || !isPathInsideRoot(rootDir, pluginDir)) {
      return { ok: false, message: 'pluginDir is outside user plugins root' };
    }

    rmForce(pluginDir);
    if (this.dataRootDir) {
      const dataDir = path.join(this.dataRootDir, pluginId);
      const resolvedDataDir = path.resolve(dataDir);
      if (isPathInsideRoot(path.resolve(this.dataRootDir), resolvedDataDir)) {
        rmForce(resolvedDataDir);
      }
    }
    if (this.stateDir) {
      setUiAppsPluginTrust({ pluginId, stateDir: this.stateDir, trusted: false, pluginDir: '' });
    }

    await this.listRegistry();
    return { ok: true, removed: true, pluginId };
  }

  async invoke(payload = {}) {
    const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
    const method = typeof payload?.method === 'string' ? payload.method.trim() : '';
    const params = payload?.params;
    if (!pluginId) return { ok: false, message: 'pluginId is required' };
    if (!method) return { ok: false, message: 'method is required' };

    if (!this.registryMap.size) {
      await this.listRegistry();
    }
    let plugin = this.registryMap.get(pluginId);
    if (!plugin) {
      await this.listRegistry();
      plugin = this.registryMap.get(pluginId);
    }
    if (!plugin) {
      this.#logRuntime('warn', 'UI Apps invoke failed: plugin not found', { pluginId, method });
      return { ok: false, message: `Plugin not found: ${pluginId}` };
    }
    if (!plugin.backend?.resolved) {
      this.#logRuntime('warn', 'UI Apps invoke failed: backend not configured', { pluginId, method });
      return { ok: false, message: `Plugin backend not configured: ${pluginId}` };
    }

    try {
      const backend = await this.#getBackend(plugin);
      const fn = backend?.methods?.[method];
      if (typeof fn !== 'function') {
        this.#logRuntime('warn', 'UI Apps invoke failed: method not found', { pluginId, method });
        return { ok: false, message: `Method not found: ${method}` };
      }
      const result = await fn(params, this.#buildInvokeContext(pluginId, plugin));
      return { ok: true, result };
    } catch (err) {
      this.#logRuntime('error', 'UI Apps invoke failed', { pluginId, method }, err);
      return { ok: false, message: err?.message || String(err) };
    }
  }

  #logRuntime(level, message, meta, err) {
    const logger = this.runtimeLogger;
    if (!logger) return;
    const fn = typeof logger[level] === 'function' ? logger[level] : logger.info;
    if (typeof fn !== 'function') return;
    fn(message, meta, err);
  }

  #logRuntimeOnce(key, level, message, meta, err) {
    if (!key) {
      this.#logRuntime(level, message, meta, err);
      return;
    }
    if (this.loggedErrorKeys.has(key)) return;
    this.loggedErrorKeys.add(key);
    this.#logRuntime(level, message, meta, err);
  }

  #isPluginTrusted(plugin) {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
    if (!pluginId) return false;
    return isUiAppsPluginTrusted({
      pluginId,
      source: plugin?.source,
      pluginDir: plugin?.pluginDir,
      stateDir: this.stateDir,
      env: process.env,
    });
  }

  #allowUntrustedBackend() {
    return resolveBoolEnv(process.env.MODEL_CLI_UIAPPS_ALLOW_UNTRUSTED_BACKEND, false);
  }

  #ensureDir(dirPath) {
    const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
    if (!normalized) return;
    try {
      fs.mkdirSync(normalized, { recursive: true });
    } catch {
      // ignore
    }
  }

  #buildInvokeContext(pluginId, plugin) {
    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
    const dataDir = this.dataRootDir ? path.join(this.dataRootDir, pluginId) : '';
    this.#ensureDir(dataDir);
    return {
      pluginId,
      pluginDir,
      dataDir,
      stateDir: this.stateDir,
      sessionRoot: this.sessionRoot,
      projectRoot: this.projectRoot,
    };
  }

  async #getBackend(plugin) {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
    if (!pluginId) throw new Error('pluginId is required');
    const trusted = this.#isPluginTrusted(plugin);
    if (!trusted && !this.#allowUntrustedBackend()) {
      throw new Error(`Plugin backend disabled for untrusted plugin: ${pluginId}`);
    }
    const backendResolved = plugin?.backend?.resolved;
    if (!backendResolved) throw new Error(`Plugin backend not available: ${pluginId}`);

    let stat = null;
    try {
      stat = fs.statSync(backendResolved);
    } catch {
      // ignore
    }
    const mtimeMs = Number.isFinite(stat?.mtimeMs)
      ? stat.mtimeMs
      : Number.isFinite(plugin?.backend?.mtimeMs)
        ? plugin.backend.mtimeMs
        : 0;

    const cached = this.backendCache.get(pluginId);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached;
    }

    if (cached?.dispose) {
      try {
        await cached.dispose();
      } catch {
        // ignore dispose errors
      }
    }
    this.backendCache.delete(pluginId);

    const moduleUrl = `${pathToFileURL(backendResolved).toString()}?mtime=${encodeURIComponent(
      String(mtimeMs || Date.now())
    )}`;
    const mod = await import(moduleUrl);
    const create = mod?.createUiAppsBackend;
    if (typeof create !== 'function') {
      throw new Error(`Plugin backend must export "createUiAppsBackend" (${pluginId})`);
    }
    const ctx = this.#buildInvokeContext(pluginId, plugin);
    const instance = await create(ctx);
    const methods = instance?.methods;
    if (!methods || typeof methods !== 'object') {
      throw new Error(`createUiAppsBackend() must return { methods } (${pluginId})`);
    }
    const dispose = typeof instance?.dispose === 'function' ? instance.dispose.bind(instance) : null;
    const next = { mtimeMs, methods, dispose };
    this.backendCache.set(pluginId, next);
    return next;
  }
}

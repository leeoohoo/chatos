import { BaseService } from './base-service.js';
import { DEFAULT_RUNTIME_SETTINGS, runtimeSettingsSchema } from '../schema.js';
import {
  coerceRuntimeNumber,
  normalizeMcpLogLevel,
  normalizePromptLogMode,
  normalizeRuntimeLanguage,
  normalizeShellSafetyMode,
  normalizeSymlinkPolicy,
} from '../../runtime-settings-utils.js';

export class SettingsService extends BaseService {
  constructor(db) {
    super(db, 'settings', runtimeSettingsSchema);
  }

  ensureRuntime(defaults = {}) {
    const LEGACY_DEFAULTS = {
      maxToolPasses: 60,
      mcpTimeoutMs: 300_000,
      mcpMaxTimeoutMs: 600_000,
    };
    const list = this.list();
    const existing = list.find((item) => item?.id === 'runtime') || list[0];
    if (!existing) {
      return this.create({ ...DEFAULT_RUNTIME_SETTINGS, ...defaults });
    }
    const patch = {};
    Object.entries({ ...DEFAULT_RUNTIME_SETTINGS, ...defaults }).forEach(([key, value]) => {
      if (existing[key] === undefined) {
        patch[key] = value;
        return;
      }
      if (Object.prototype.hasOwnProperty.call(LEGACY_DEFAULTS, key)) {
        const current = Number(existing[key]);
        if (Number.isFinite(current) && current === LEGACY_DEFAULTS[key]) {
          patch[key] = value;
        }
      }
    });
    if (Object.keys(patch).length > 0) {
      return this.update(existing.id, patch);
    }
    return existing;
  }

  getRuntime() {
    return this.ensureRuntime();
  }

  saveRuntime(payload = {}) {
    const current = this.ensureRuntime();
    return this.update(current.id, payload);
  }

  getRuntimeConfig() {
    const runtime = this.ensureRuntime();
    if (!runtime) return null;
    const base = { ...DEFAULT_RUNTIME_SETTINGS, ...runtime };
    const normalizeWorkdir = (value) => (typeof value === 'string' ? value.trim() : '');
    const normalizeModel = (value) => (typeof value === 'string' ? value.trim() : '');
    return {
      maxToolPasses: coerceRuntimeNumber(base.maxToolPasses),
      promptLanguage: normalizeRuntimeLanguage(base.promptLanguage, DEFAULT_RUNTIME_SETTINGS.promptLanguage),
      landConfigId: typeof base.landConfigId === 'string' ? base.landConfigId.trim() : '',
      subagentDefaultModel: normalizeModel(base.subagentDefaultModel),
      summaryTokenThreshold: coerceRuntimeNumber(base.summaryTokenThreshold),
      autoRoute: Boolean(base.autoRoute),
      logRequests: Boolean(base.logRequests),
      streamRaw: Boolean(base.streamRaw),
      toolPreviewLimit: coerceRuntimeNumber(base.toolPreviewLimit),
      retry: coerceRuntimeNumber(base.retry),
      mcpTimeoutMs: coerceRuntimeNumber(base.mcpTimeoutMs),
      mcpMaxTimeoutMs: coerceRuntimeNumber(base.mcpMaxTimeoutMs),
      shellSafetyMode: normalizeShellSafetyMode(base.shellSafetyMode, {
        fallback: DEFAULT_RUNTIME_SETTINGS.shellSafetyMode,
      }),
      shellMaxBufferBytes: coerceRuntimeNumber(base.shellMaxBufferBytes),
      filesystemSymlinkPolicy: normalizeSymlinkPolicy(base.filesystemSymlinkPolicy, {
        fallback: DEFAULT_RUNTIME_SETTINGS.filesystemSymlinkPolicy,
      }),
      filesystemMaxFileBytes: coerceRuntimeNumber(base.filesystemMaxFileBytes),
      filesystemMaxWriteBytes: coerceRuntimeNumber(base.filesystemMaxWriteBytes),
      mcpToolLogLevel: normalizeMcpLogLevel(base.mcpToolLogLevel, DEFAULT_RUNTIME_SETTINGS.mcpToolLogLevel),
      mcpToolLogMaxBytes: coerceRuntimeNumber(base.mcpToolLogMaxBytes),
      mcpToolLogMaxLines: coerceRuntimeNumber(base.mcpToolLogMaxLines),
      mcpToolLogMaxFieldChars: coerceRuntimeNumber(base.mcpToolLogMaxFieldChars),
      mcpStartupConcurrency: coerceRuntimeNumber(base.mcpStartupConcurrency),
      uiPromptLogMode: normalizePromptLogMode(base.uiPromptLogMode, DEFAULT_RUNTIME_SETTINGS.uiPromptLogMode),
      injectSecretsToEnv: Boolean(base.injectSecretsToEnv),
      uiPromptWorkdir: normalizeWorkdir(base.uiPromptWorkdir),
    };
  }
}

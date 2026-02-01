import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { safeRead } from '../packages/aide/shared/data/legacy.js';
import { getHostApp } from '../packages/common/host-app.js';
import { appendEventLog as appendEventLogCore } from '../packages/common/event-log-utils.js';
import { resolveAppStateDir } from '../packages/common/state-core/state-paths.js';
import { createRuntimeLogger } from '../packages/common/state-core/runtime-log.js';
import { normalizeUiTerminalMode } from '../packages/common/runtime-settings-utils.js';

import { isPidAlive, listProcessTreePidsFromPs, tryKillPid, tryKillProcessGroup } from './shared/process-utils.js';
import { resolveCliEntrypointPath } from './shared/cli-entrypoint.js';
import { isPendingSystemTerminalLaunch, launchCliInSystemTerminal } from './terminal-manager/system-terminal.js';
import { createTerminalDispatch } from './terminal-manager/dispatch.js';
import { createRunRegistry, parseRuns } from './terminal-manager/run-registry.js';
import { createPidRegistry } from './terminal-manager/pid-registry.js';
import { createTerminalStatusStore } from './terminal-manager/status-store.js';

export function createTerminalManager({
  projectRoot,
  terminalsDir,
  sessionRoot,
  defaultPaths,
  adminServices,
  mainWindowGetter,
  uiTerminalStdio = ['pipe', 'ignore', 'ignore'],
  env,
} = {}) {
  const runtimeEnv = env && typeof env === 'object' ? env : process.env;
  const baseProjectRoot =
    typeof projectRoot === 'string' && projectRoot.trim() ? path.resolve(projectRoot) : process.cwd();
  const baseSessionRoot =
    typeof sessionRoot === 'string' && sessionRoot.trim() ? path.resolve(sessionRoot) : process.cwd();
  const resolvedHostApp = getHostApp(runtimeEnv) || 'chatos';
  const resolveCliHostApp = () => {
    const explicit =
      typeof runtimeEnv.MODEL_CLI_CLI_HOST_APP === 'string' ? runtimeEnv.MODEL_CLI_CLI_HOST_APP.trim() : '';
    return explicit || 'aide';
  };
  const cliHostApp = resolveCliHostApp();
  const baseTerminalsDir =
    typeof terminalsDir === 'string' && terminalsDir.trim()
      ? path.resolve(terminalsDir)
      : path.join(
          resolveAppStateDir(baseSessionRoot, { hostApp: resolvedHostApp, fallbackHostApp: 'chatos' }),
          'terminals'
        );
  const runtimeLogger = createRuntimeLogger({
    sessionRoot: baseSessionRoot,
    hostApp: resolvedHostApp,
    scope: 'TERMINAL',
    runId: 'desktop',
    env: runtimeEnv,
  });
  const getMainWindow = typeof mainWindowGetter === 'function' ? mainWindowGetter : () => null;
  const cliStateDir = resolveAppStateDir(baseSessionRoot, { hostApp: cliHostApp, fallbackHostApp: 'chatos' });
  const runsPath = path.join(cliStateDir, 'runs.jsonl');

  const runRegistry = createRunRegistry({ runsPath, safeRead, isPidAlive });
  const { getRunPidFromRegistry, isRunPidAliveFromRegistry } = runRegistry;

  const pidRegistry = createPidRegistry({ baseTerminalsDir });
  const { listRunPidRegistry, listRunPidRecords } = pidRegistry;

  const statusStore = createTerminalStatusStore({ baseTerminalsDir, getMainWindow });
  const {
    appendTerminalControl,
    appendTerminalInbox,
    broadcastTerminalStatuses,
    listTerminalStatuses,
    readTerminalStatus,
    startTerminalStatusWatcher,
    waitForTerminalState,
    waitForTerminalStatus,
    dispose: disposeStatusStore,
  } = statusStore;

  const launchedCli = new Map();
  const pendingSystemTerminalLaunch = new Map();

  let healthCheckInterval = null;

  function cleanupLaunchedCli() {
    launchedCli.forEach((child) => {
      try {
        if (child && !child.killed) {
          child.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    });
    launchedCli.clear();
  }

  function resolveUiTerminalMode() {
    const fromSettings = (() => {
      try {
        const runtime = adminServices?.settings?.getRuntime?.();
        const normalized = normalizeUiTerminalMode(runtime?.uiTerminalMode, '');
        if (normalized) return normalized;
      } catch {
        // ignore settings lookup failures
      }
      return '';
    })();
    if (fromSettings && fromSettings !== 'auto') {
      return fromSettings;
    }

    if (fromSettings === 'auto') {
      return fromSettings;
    }
    return process.platform === 'darwin' || process.platform === 'win32' ? 'system' : 'headless';
  }

  function resolveLandConfigId() {
    try {
      const runtime = adminServices?.settings?.getRuntime?.();
      const raw = typeof runtime?.landConfigId === 'string' ? runtime.landConfigId.trim() : '';
      return raw;
    } catch {
      return '';
    }
  }

  function generateRunId() {
    const short = crypto.randomUUID().split('-')[0];
    return `run-${Date.now().toString(36)}-${short}`;
  }

  function resolveCliEntrypointPathForTerminal() {
    return resolveCliEntrypointPath({ baseProjectRoot });
  }

  function startHealthChecker() {
    if (healthCheckInterval) return;
    healthCheckInterval = setInterval(() => {
      launchedCli.forEach((child, rid) => {
        if (child && child.killed) {
          launchedCli.delete(rid);
          broadcastTerminalStatuses();
          return;
        }
        if (child && child.exitCode !== null) {
          launchedCli.delete(rid);
          broadcastTerminalStatuses();
          return;
        }
        // Check if process is still alive using pid
        if (child && child.pid && !isPidAlive(child.pid)) {
          launchedCli.delete(rid);
          broadcastTerminalStatuses();
        }
      });
    }, 30000); // 30 seconds
    if (healthCheckInterval.unref) healthCheckInterval.unref();
  }

  function appendEventLog(type, payload, runId) {
    const eventPath = path.join(cliStateDir, 'events.jsonl');
    appendEventLogCore(eventPath, type, payload, runId);
  }

  async function intervene(payload = {}) {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) return { ok: false, message: 'text is required' };
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) return { ok: false, message: 'runId is required' };
    const targetRaw = typeof payload?.target === 'string' ? payload.target.trim().toLowerCase() : '';
    const requestedTarget = targetRaw || 'auto';

    const aliveWorkers = listRunPidRecords(runId).filter(
      (rec) => rec && rec.kind === 'subagent_worker' && isPidAlive(rec.pid)
    );
    const inprocActive = listRunPidRecords(runId).some(
      (rec) => rec && rec.kind === 'subagent_inproc' && isPidAlive(rec.pid)
    );

    const resolvedTarget =
      requestedTarget === 'auto'
        ? aliveWorkers.length > 0
          ? 'subagent_worker'
          : inprocActive
            ? 'subagent_inproc'
            : 'cli'
        : requestedTarget === 'main'
          ? 'cli'
          : requestedTarget;

    if (resolvedTarget === 'subagent_worker') {
      if (aliveWorkers.length === 0) {
        // Auto mode should never hit this, but keep a friendly message for explicit targeting.
        return { ok: false, reason: 'no_worker', message: '未检测到正在运行的子进程(subagent_worker)，无法发送纠正。' };
      }
      try {
        appendTerminalInbox(runId, {
          ts: new Date().toISOString(),
          type: 'correction',
          runId,
          target: 'subagent_worker',
          text,
          source: 'ui',
        });
        appendEventLog('ui_correction', { target: 'subagent_worker', text }, runId);
        return { ok: true, runId, target: 'subagent_worker' };
      } catch (err) {
        return { ok: false, message: err?.message || String(err) };
      }
    }

    if (resolvedTarget === 'subagent_inproc') {
      if (!inprocActive) {
        return { ok: false, reason: 'no_inproc', message: '未检测到正在运行的子流程(in-process sub-agent)，无法发送纠正。' };
      }
      try {
        appendTerminalInbox(runId, {
          ts: new Date().toISOString(),
          type: 'correction',
          runId,
          target: 'subagent_inproc',
          text,
          source: 'ui',
        });
        appendEventLog('ui_correction', { target: 'subagent_inproc', text }, runId);
        return { ok: true, runId, target: 'subagent_inproc' };
      } catch (err) {
        return { ok: false, message: err?.message || String(err) };
      }
    }

    // Fallback: treat correction as an interrupt+send for the main CLI.
    if (resolvedTarget === 'cli') {
      const result = await dispatchMessage({ text, runId, force: true });
      if (result?.ok === false) {
        return { ...result, target: 'cli' };
      }
      appendEventLog('ui_correction', { target: 'cli', text }, runId);
      return { ...result, target: 'cli' };
    }

    return { ok: false, message: `unsupported target: ${resolvedTarget}` };
  }

  function cleanupTerminalArtifacts(runId) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return;
    const targets = [
      path.join(baseTerminalsDir, `${rid}.status.json`),
      path.join(baseTerminalsDir, `${rid}.control.jsonl`),
      path.join(baseTerminalsDir, `${rid}.cursor`),
      path.join(baseTerminalsDir, `${rid}.inbox.jsonl`),
      path.join(baseTerminalsDir, `${rid}.launch.command`),
      path.join(baseTerminalsDir, `${rid}.launch.cmd`),
      path.join(baseTerminalsDir, `${rid}.pids.jsonl`),
    ];
    targets.forEach((target) => {
      try {
        if (fs.existsSync(target)) {
          fs.unlinkSync(target);
        }
      } catch {
        // ignore cleanup failures
      }
    });
  }

  async function forceKillRun(runId, options = {}) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return { ok: false, message: 'runId is required' };

    const pidSet = new Set();
    const hinted = Number(options?.pidHint);
    if (Number.isFinite(hinted) && hinted > 0) {
      pidSet.add(hinted);
    }

    const child = launchedCli.get(rid);
    if (child && Number.isFinite(child.pid) && child.pid > 0) {
      pidSet.add(child.pid);
    }

    const status = readTerminalStatus(rid);
    const statusPid = Number(status?.pid);
    if (Number.isFinite(statusPid) && statusPid > 0) {
      pidSet.add(statusPid);
    }

    const registryPid = getRunPidFromRegistry(rid);
    if (Number.isFinite(registryPid) && registryPid > 0) {
      pidSet.add(registryPid);
    }

    listRunPidRegistry(rid).forEach((pid) => {
      if (Number.isFinite(pid) && pid > 0) pidSet.add(pid);
    });

    pidSet.delete(process.pid);

    const rootPids = Array.from(pidSet);
    const killList = await listProcessTreePidsFromPs(rootPids);
    const errors = [];
    const killed = [];

    // Best-effort: kill the process group led by the CLI pid (common on macOS Terminal),
    // so we don't rely on `ps` to discover short-lived descendants.
    const groupLeader = [statusPid, hinted, registryPid, child?.pid].find(
      (pid) => Number.isFinite(Number(pid)) && Number(pid) > 0
    );
    if (Number.isFinite(Number(groupLeader)) && Number(groupLeader) > 0 && isPidAlive(groupLeader)) {
      tryKillProcessGroup(groupLeader, 'SIGTERM', errors);
      await new Promise((resolve) => setTimeout(resolve, 120));
      tryKillProcessGroup(groupLeader, 'SIGKILL', errors);
    }

    const killAll = (signal) => {
      killList.forEach((pid) => {
        if (!Number.isFinite(pid) || pid <= 0) return;
        if (pid === process.pid) return;
        const ok = tryKillPid(pid, signal, errors);
        if (ok) killed.push({ pid, signal });
      });
    };

    // Try SIGTERM then SIGKILL (fast, but still gives a brief chance to clean up).
    killAll('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
    killAll('SIGKILL');

    // Wait briefly for processes to exit.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const stillAlive = killList.filter((pid) => pid && pid !== process.pid && isPidAlive(pid));
    const ok = stillAlive.length === 0;

    if (ok && options?.cleanupArtifacts !== false) {
      cleanupTerminalArtifacts(rid);
    }

    // Even when everything is dead, keep the pid registry around unless we explicitly cleaned artifacts.
    if (ok && options?.cleanupArtifacts) {
      try {
        launchedCli.delete(rid);
      } catch {
        // ignore
      }
    }

    return {
      ok,
      runId: rid,
      rootPids,
      killList,
      stillAlive,
      errors,
      killed,
      message: ok ? undefined : '进程仍在运行（已尝试 SIGTERM/SIGKILL）',
    };
  }

  const isSystemTerminalLaunchPending = (runId) =>
    isPendingSystemTerminalLaunch({ runId, pendingSystemTerminalLaunch, readTerminalStatus });

  const { ensureCliRunning, dispatchMessage } = createTerminalDispatch({
    baseSessionRoot,
    baseTerminalsDir,
    launchedCli,
    pendingSystemTerminalLaunch,
    runsPath,
    parseRuns,
    safeRead,
    resolveCliEntrypointPath: resolveCliEntrypointPathForTerminal,
    resolveUiTerminalMode,
    resolveLandConfigId,
    uiTerminalStdio,
    runtimeLogger,
    env: runtimeEnv,
    isPidAlive,
    isRunPidAliveFromRegistry,
    readTerminalStatus,
    waitForTerminalStatus,
    appendTerminalControl,
    startTerminalStatusWatcher,
    startHealthChecker,
    broadcastTerminalStatuses,
    launchCliInSystemTerminal,
    generateRunId,
    isSystemTerminalLaunchPending,
  });

  async function sendAction(payload = {}) {
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      return { ok: false, message: 'runId is required' };
    }
    const action = typeof payload?.action === 'string' ? payload.action.trim() : '';
    const supported = new Set(['summary_now']);
    if (!supported.has(action)) {
      return { ok: false, message: `unsupported action: ${action || '(empty)'}` };
    }

    let status = readTerminalStatus(runId);
    if (!status) {
      // Best-effort: wait briefly so a freshly launched CLI can pick up the control file.
      status = await waitForTerminalStatus(runId, 1500);
    }
    const alive = status?.pid ? isPidAlive(status.pid) : isRunPidAliveFromRegistry(runId);
    if (!alive) {
      return { ok: false, message: 'terminal is not running' };
    }

    appendTerminalControl(runId, {
      type: 'action',
      action,
      ts: new Date().toISOString(),
      source: 'ui',
    });
    return { ok: true, runId, queued: true };
  }

  async function stopRun(payload = {}) {
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      return { ok: false, message: 'runId is required' };
    }
    const status = readTerminalStatus(runId);
    const alive = status?.pid ? isPidAlive(status.pid) : isRunPidAliveFromRegistry(runId);
    if (!alive) {
      return { ok: false, message: 'terminal is not running' };
    }
    appendTerminalControl(runId, {
      type: 'stop',
      ts: new Date().toISOString(),
    });
    runtimeLogger?.info('terminal.stop', { runId });
    return { ok: true };
  }

  async function terminateRun(payload = {}) {
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      return { ok: false, message: 'runId is required' };
    }
    const result = await forceKillRun(runId, { cleanupArtifacts: true });
    runtimeLogger?.info('terminal.terminate', { runId, ok: result?.ok === true });
    return result;
  }

  async function closeRun(payload = {}) {
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      return { ok: false, message: 'runId is required' };
    }
    const force = payload?.force === true;

    let status = readTerminalStatus(runId);
    let pid = status?.pid || getRunPidFromRegistry(runId) || null;
    let alive = pid ? isPidAlive(pid) : isRunPidAliveFromRegistry(runId);

    if (alive && !status) {
      status = await waitForTerminalStatus(runId, 1200);
      pid = status?.pid || pid;
    }

    alive = pid ? isPidAlive(pid) : isRunPidAliveFromRegistry(runId);
    const busy = alive && status?.state === 'running';
    const missingStatus = alive && !status;
    if ((busy || missingStatus) && !force) {
      return {
        ok: false,
        reason: 'busy',
        runId,
        currentMessage:
          typeof status?.currentMessage === 'string'
            ? status.currentMessage
            : missingStatus
              ? '（该终端未上报状态，无法确定是否正在执行）'
              : '',
      };
    }

    if (alive && (busy || force)) {
      try {
        appendTerminalControl(runId, { type: 'stop', ts: new Date().toISOString() });
      } catch {
        // ignore
      }
      await waitForTerminalState(runId, (next) => !next || next.state !== 'running', 2500);
    }

    const terminated = await forceKillRun(runId, { cleanupArtifacts: true, pidHint: pid });
    pendingSystemTerminalLaunch.delete(runId);
    broadcastTerminalStatuses();
    runtimeLogger?.info('terminal.close', { runId, force, ok: terminated?.ok === true });
    return terminated;
  }

  function listStatusesWithWatcher() {
    startTerminalStatusWatcher();
    return { statuses: listTerminalStatuses() };
  }

  function stopHealthChecker() {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  }

  function dispose() {
    stopHealthChecker();
    disposeStatusStore();
  }

  return {
    cleanupLaunchedCli,
    closeRun,
    sendAction,
    dispatchMessage,
    dispose,
    intervene,
    listStatusesWithWatcher,
    stopRun,
    terminateRun,
  };
}

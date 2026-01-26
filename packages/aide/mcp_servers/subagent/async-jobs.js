import { fork } from 'child_process';
import { appendRunPid } from './process-utils.js';
import { normalizeMetaValue } from './meta-utils.js';

function buildJobResultPayload(result) {
  if (!result || !result.agentRef || !result.agentRef.agent || !result.agentRef.plugin) {
    return null;
  }
  return {
    agent_id: result.agentRef.agent.id,
    agent_name: result.agentRef.agent.name,
    plugin: result.agentRef.plugin.id,
    model: result.targetModel,
    skills: result.usedSkills,
    command: result.commandMeta,
    response: result.response,
    steps: Array.isArray(result.steps) ? result.steps : [],
    stats: result.stats || null,
    trace: result.trace || null,
  };
}

export function createAsyncJobManager(options = {}) {
  const {
    performance,
    eventLogger,
    mcpConfigPath,
    sessionRoot,
    workspaceRoot,
    eventLogPath,
    currentFile,
    runId,
    heartbeatIntervalMs = 10000,
    heartbeatStaleMs = 120000,
    executeSubAgent,
  } = options;
  const perfNow = typeof performance?.now === 'function' ? () => performance.now() : () => Date.now();
  const resolvedSessionRoot = typeof sessionRoot === 'string' ? sessionRoot : '';
  const resolvedWorkspaceRoot = typeof workspaceRoot === 'string' ? workspaceRoot : '';
  const resolvedRunId = typeof runId === 'string' ? runId : '';

  const jobStore = new Map();

  function createAsyncJob(params) {
    const id = `job_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    const now = new Date().toISOString();
    const nowMono = perfNow();
    const job = {
      id,
      status: 'pending',
      params: { ...params },
      createdAt: now,
      updatedAt: now,
      updatedAtMono: nowMono,
      result: null,
      error: null,
      heartbeatStale: false,
    };
    jobStore.set(id, job);
    return job;
  }

  function formatJobStatus(job) {
    const heartbeatAgeMs =
      job && Number.isFinite(job.updatedAtMono)
        ? Math.max(0, perfNow() - job.updatedAtMono)
        : null;
    return {
      job_id: job.id,
      status: job.status,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      heartbeat_age_ms: heartbeatAgeMs,
      heartbeat_stale: Boolean(job.heartbeatStale),
      result: job.status === 'done' ? job.result : null,
      error: job.error,
    };
  }

  function startAsyncJob(job) {
    const current = jobStore.get(job.id);
    if (!current) return;
    current.status = 'running';
    current.updatedAt = new Date().toISOString();
    current.updatedAtMono = perfNow();
    current.heartbeatStale = false;
    const progressEmitter = typeof current.progress === 'function' ? current.progress : null;
    const progressMeta = current.progressMeta && typeof current.progressMeta === 'object' ? current.progressMeta : null;
    const progressSessionId = normalizeMetaValue(progressMeta, ['sessionId', 'session_id']);
    const progressToolCallId = normalizeMetaValue(progressMeta, ['toolCallId', 'tool_call_id', 'callId', 'call_id']);
    eventLogger?.log?.('subagent_async_start', {
      job_id: job.id,
      session_id: progressSessionId || null,
      tool_call_id: progressToolCallId || null,
    });

    if (!currentFile) {
      current.status = 'error';
      current.updatedAt = new Date().toISOString();
      current.error = 'Failed to start sub-agent worker: missing current file path';
      return;
    }

    let child;
    try {
      const env = {
        ...process.env,
        SUBAGENT_JOB_DATA: JSON.stringify(current.params || {}),
        SUBAGENT_CONFIG_PATH: mcpConfigPath,
        SUBAGENT_WORKER: '1',
        MODEL_CLI_SESSION_ROOT: resolvedSessionRoot,
        MODEL_CLI_WORKSPACE_ROOT: resolvedWorkspaceRoot,
        MODEL_CLI_EVENT_LOG: eventLogPath,
      };
      child = fork(currentFile, ['--worker'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
    } catch (err) {
      current.status = 'error';
      current.updatedAt = new Date().toISOString();
      current.error = `Failed to start sub-agent worker: ${err?.message || err}`;
      return;
    }

    current.workerPid = Number.isFinite(child.pid) ? child.pid : null;
    current.worker = child;
    appendRunPid({
      pid: child.pid,
      kind: 'subagent_worker',
      name: current.id,
      runId: resolvedRunId,
      sessionRoot: resolvedSessionRoot,
    });

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk?.toString?.() || '';
        if (text.trim().length > 0) {
          console.error(`[subagent_router worker] ${text.trimEnd()}`);
        }
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk?.toString?.() || '';
        if (text.trim().length > 0) {
          console.error(`[subagent_router worker] ${text.trimEnd()}`);
        }
      });
    }

    const finalize = (updater, { force } = {}) => {
      const entry = jobStore.get(job.id);
      if (!entry) return;
      if (!force && (entry.status === 'done' || entry.status === 'error')) return;
      updater(entry);
      entry.updatedAt = new Date().toISOString();
      entry.updatedAtMono = perfNow();
      entry.heartbeatStale = false;
    };

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'heartbeat') {
        const entry = jobStore.get(job.id);
        if (!entry || entry.status !== 'running') {
          return;
        }
        entry.updatedAt = new Date().toISOString();
        entry.updatedAtMono = perfNow();
        entry.heartbeatStale = false;
        return;
      }
      if (msg.type === 'progress') {
        const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : null;
        const payloadWithJob =
          payload && typeof payload === 'object'
            ? { ...payload, job_id: job.id, jobId: job.id }
            : null;
        if (payloadWithJob && progressEmitter) {
          try {
            progressEmitter(payloadWithJob);
          } catch {
            // ignore progress relay failures
          }
        }
        const entry = jobStore.get(job.id);
        if (entry && entry.status === 'running') {
          entry.updatedAt = new Date().toISOString();
          entry.updatedAtMono = perfNow();
          entry.heartbeatStale = false;
        }
        if (payloadWithJob || payload) {
          const stepSource = payloadWithJob || payload;
          const step = stepSource.step && typeof stepSource.step === 'object' ? stepSource.step : null;
          eventLogger?.log?.('subagent_async_progress', {
            job_id: job.id,
            stage: stepSource.stage || null,
            done: stepSource.done === true,
            step_index: typeof step?.index === 'number' ? step.index : null,
            step_type: step?.type || null,
            tool: step?.tool || null,
            call_id: step?.call_id || null,
            meta: progressMeta || null,
          });
        }
        return;
      }
      if (msg.type === 'result') {
        finalize(
          (entry) => {
            entry.status = 'done';
            entry.result = msg.result || null;
            entry.error = null;
          },
          { force: true }
        );
      } else if (msg.type === 'error') {
        finalize(
          (entry) => {
            entry.status = 'error';
            entry.error = msg.error || 'Sub-agent worker error';
          },
          { force: true }
        );
      }
    });

    child.on('error', (err) => {
      finalize(
        (entry) => {
          entry.status = 'error';
          entry.error = `Sub-agent worker process error: ${err?.message || err}`;
        },
        { force: true }
      );
    });

    child.on('exit', (code, signal) => {
      const entry = jobStore.get(job.id);
      if (entry && entry.worker === child) {
        entry.worker = null;
      }
      const status = jobStore.get(job.id);
      if (!status || status.status === 'done' || status.status === 'error') {
        return;
      }
      finalize((entry) => {
        entry.status = 'error';
        const parts = [];
        if (signal) {
          parts.push(`signal ${signal}`);
        }
        if (Number.isFinite(code)) {
          parts.push(`exit code ${code}`);
        }
        const reason = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        entry.error = `Sub-agent worker exited unexpectedly${reason}`;
      });
    });
  }

  async function runWorkerJob() {
    appendRunPid({
      pid: process.pid,
      kind: 'subagent_worker',
      name: 'worker',
      runId: resolvedRunId,
      sessionRoot: resolvedSessionRoot,
    });
    const raw = process.env.SUBAGENT_JOB_DATA;
    if (!raw) {
      console.error('[subagent_router worker] missing SUBAGENT_JOB_DATA');
      process.exit(1);
      return;
    }
    if (typeof executeSubAgent !== 'function') {
      console.error('[subagent_router worker] missing executeSubAgent');
      process.exit(1);
      return;
    }
    let params;
    try {
      params = JSON.parse(raw);
    } catch (err) {
      console.error('[subagent_router worker] invalid job payload:', err?.message || err);
      process.exit(1);
      return;
    }
    let heartbeat;
    try {
      const intervalMs = Number.isFinite(heartbeatIntervalMs) ? heartbeatIntervalMs : 10000;
      heartbeat = setInterval(() => {
        try {
          if (process.send) {
            process.send({ type: 'heartbeat', ts: Date.now() });
          }
        } catch {
          // ignore transport errors
        }
      }, intervalMs);
      const progress = (payload) => {
        try {
          if (process.send) {
            process.send({ type: 'progress', payload });
          }
        } catch {
          // ignore transport errors
        }
      };
      const result = await executeSubAgent({ ...params, progress });
      const payload = buildJobResultPayload(result);
      if (payload && process.send) {
        process.send({ type: 'result', result: payload });
      } else if (!payload) {
        throw new Error('Sub-agent worker missing result payload');
      }
    } catch (err) {
      if (process.send) {
        process.send({ type: 'error', error: err?.message || String(err) });
      }
      console.error('[subagent_router worker] failed to execute job:', err?.message || err);
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      process.exit(1);
      return;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    process.exit(0);
  }

  function hydrateStaleStatus(job) {
    if (job.status !== 'running') return;
    const last = Number.isFinite(job.updatedAtMono) ? job.updatedAtMono : NaN;
    if (!Number.isFinite(last)) {
      job.heartbeatStale = false;
      return;
    }
    const ageMs = perfNow() - last;
    job.heartbeatStale = ageMs > heartbeatStaleMs;
  }

  return {
    jobStore,
    buildJobResultPayload,
    createAsyncJob,
    formatJobStatus,
    startAsyncJob,
    runWorkerJob,
    hydrateStaleStatus,
  };
}

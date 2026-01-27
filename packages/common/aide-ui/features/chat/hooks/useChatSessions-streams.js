import {
  buildFinalTextFromChunks,
  mergeSubagentSteps,
  normalizeProgressKind,
  normalizeStepsPayload,
  pickToolCallId,
  resolveProgressDone,
  resolveProgressJobId,
} from '../../../../chat-stream-utils.js';
import { normalizeId } from '../../../../text-utils.js';

const MAX_MCP_STREAM_ITEMS = 200;
const MAX_SUBAGENT_STEPS = 240;

function isMcpStreamDone(method, params) {
  const status = typeof params?.status === 'string' ? params.status.toLowerCase() : '';
  const normalizedMethod = typeof method === 'string' ? method : '';
  if (params?.done === true) return true;
  if (normalizedMethod.endsWith('.done') || normalizedMethod.endsWith('.completed')) return true;
  return ['completed', 'failed', 'aborted', 'cancelled'].includes(status);
}

function buildMcpStreamText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const params = payload?.params && typeof payload.params === 'object' ? payload.params : null;
  if (typeof params?.text === 'string' && params.text.trim()) return params.text;
  if (typeof params?.finalText === 'string' && params.finalText.trim()) return params.finalText;
  if (params?.event?.event?.type) {
    const status = params?.event?.event?.item?.status || params?.event?.event?.status || '';
    return status ? `${params.event.event.type} (${status})` : params.event.event.type;
  }
  if (typeof params?.status === 'string' && params.status.trim()) return `status ${params.status}`;
  return '';
}

export function isRunSubAgentToolName(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return name.includes('run_sub_agent');
}

export function createStreamHandlers({
  setStreamBuffers,
  streamBuffersRef,
  setMcpStreams,
  mcpStreamsRef,
  setSubagentStreams,
  subagentStreamsRef,
}) {
  const mergeStreamBuffer = (sessionId, list) => {
    const sid = normalizeId(sessionId);
    if (!sid) return Array.isArray(list) ? list : [];
    const buffer = streamBuffersRef.current[sid];
    if (!buffer || typeof buffer !== 'object') return Array.isArray(list) ? list : [];
    const mid = normalizeId(buffer.messageId);
    if (!mid) return Array.isArray(list) ? list : [];
    const content = typeof buffer.content === 'string' ? buffer.content : '';
    const reasoning = typeof buffer.reasoning === 'string' ? buffer.reasoning : '';
    const messagesList = Array.isArray(list) ? list : [];
    const idx = messagesList.findIndex((msg) => normalizeId(msg?.id) === mid);
    if (idx < 0) {
      return [
        ...messagesList,
        { id: mid, sessionId: sid, role: 'assistant', content, reasoning },
      ];
    }
    const existing = messagesList[idx] || {};
    const next = messagesList.slice();
    const patch = { ...existing };
    const existingContent = typeof existing?.content === 'string' ? existing.content : '';
    const existingReasoning = typeof existing?.reasoning === 'string' ? existing.reasoning : '';
    if (content && content.length >= existingContent.length) {
      patch.content = content;
    }
    if (reasoning && reasoning.length >= existingReasoning.length) {
      patch.reasoning = reasoning;
    }
    next[idx] = patch;
    return next;
  };

  const updateStreamBuffer = (sessionId, messageId, updater) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    const mid = normalizeId(messageId);
    if (!mid) return;
    setStreamBuffers((prev) => {
      const next = { ...(prev || {}) };
      const current =
        next[sid] && typeof next[sid] === 'object'
          ? next[sid]
          : { sessionId: sid, messageId: mid, content: '', reasoning: '' };
      const reset = normalizeId(current.messageId) !== mid;
      const base = reset
        ? { sessionId: sid, messageId: mid, content: '', reasoning: '' }
        : { ...current, sessionId: sid, messageId: mid };
      const updated = typeof updater === 'function' ? updater(base) : base;
      next[sid] = updated;
      streamBuffersRef.current = next;
      return next;
    });
  };

  const updateMcpStream = (sessionId, payload) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    const incoming = payload && typeof payload === 'object' ? payload : null;
    const params = incoming?.params && typeof incoming.params === 'object' ? incoming.params : null;
    const runId = normalizeId(params?.runId);
    const method = typeof incoming?.method === 'string' ? incoming.method : '';
    const receivedAt = typeof incoming?.receivedAt === 'string' ? incoming.receivedAt : new Date().toISOString();
    const textRaw = buildMcpStreamText(incoming);
    const done = isMcpStreamDone(method, params);

    setMcpStreams((prev) => {
      const next = { ...(prev || {}) };
      const current = next[sid] && typeof next[sid] === 'object'
        ? next[sid]
        : { sessionId: sid, runId: '', items: [], chunks: {}, finalText: '', done: false };
      let items = Array.isArray(current.items) ? current.items.slice() : [];
      let chunks = current.chunks && typeof current.chunks === 'object' ? { ...current.chunks } : {};
      let finalText = typeof current.finalText === 'string' ? current.finalText : '';
      let activeRunId = typeof current.runId === 'string' ? current.runId : '';
      let doneFlag = current.done === true;

      if (runId && activeRunId && runId !== activeRunId) {
        items = [];
        chunks = {};
        finalText = '';
        doneFlag = false;
      }
      if (runId && !activeRunId) {
        activeRunId = runId;
      }

      const chunkText =
        typeof params?.finalText === 'string' && params.finalText.trim()
          ? params.finalText
          : params?.final === true && typeof params?.text === 'string'
            ? params.text
            : '';
      if (chunkText) {
        if (params?.finalTextChunk === true) {
          const idx = Number.isFinite(params?.chunkIndex) ? params.chunkIndex : Object.keys(chunks).length;
          chunks[idx] = chunkText;
          finalText = buildFinalTextFromChunks(chunks);
        } else {
          finalText = chunkText;
        }
      }

      const displayText = textRaw || (done ? (params?.status ? `done (${params.status})` : 'done') : '');
      if (displayText) {
        items.push({
          id: `${receivedAt}-${items.length}`,
          ts: receivedAt,
          text: displayText,
          status: typeof params?.status === 'string' ? params.status : '',
        });
        if (items.length > MAX_MCP_STREAM_ITEMS) {
          items = items.slice(-MAX_MCP_STREAM_ITEMS);
        }
      }

      if (done) {
        doneFlag = true;
      }

      next[sid] = {
        sessionId: sid,
        runId: activeRunId,
        items,
        chunks,
        finalText,
        done: doneFlag,
        status: typeof params?.status === 'string' ? params.status : '',
        server: typeof incoming?.server === 'string' ? incoming.server : '',
        method,
      };
      mcpStreamsRef.current = next;
      return next;
    });
  };

  const updateSubagentStream = (sessionId, payload) => {
    const sid = normalizeId(sessionId);
    if (!sid || !payload || typeof payload !== 'object') return;
    const params = payload?.params && typeof payload.params === 'object' ? payload.params : null;
    if (!params) return;
    const kind = normalizeProgressKind(params);
    if (kind && kind !== 'subagent_step' && kind !== 'subagent_progress') return;
    const callId = pickToolCallId(params);
    if (!callId) return;
    const incomingSteps = normalizeStepsPayload(params);
    const jobId = resolveProgressJobId(params);
    const statusRaw = typeof params?.status === 'string' ? params.status : '';
    const done = resolveProgressDone(params);
    if (incomingSteps.length === 0 && !done && !jobId) return;

    setSubagentStreams((prev) => {
      const next = { ...(prev || {}) };
      const sessionMap = next[sid] && typeof next[sid] === 'object' ? { ...next[sid] } : {};
      const current = sessionMap[callId] && typeof sessionMap[callId] === 'object' ? sessionMap[callId] : {};
      const steps = mergeSubagentSteps(current.steps, incomingSteps, MAX_SUBAGENT_STEPS);

      sessionMap[callId] = {
        ...current,
        steps,
        done: current.done || done,
        status: statusRaw || current.status,
        jobId: jobId || current.jobId,
        updatedAt: new Date().toISOString(),
      };
      next[sid] = sessionMap;
      subagentStreamsRef.current = next;
      return next;
    });
  };

  const applyPersistedSubagentStreams = (sessionId, entries = []) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    const list = Array.isArray(entries) ? entries : [];
    setSubagentStreams((prev) => {
      const next = { ...(prev || {}) };
      const prevSession = next[sid] && typeof next[sid] === 'object' ? { ...next[sid] } : {};
      const sessionMap = {};
      if (list.length === 0) {
        next[sid] = sessionMap;
        subagentStreamsRef.current = next;
        return next;
      }
      list.forEach((entry) => {
        const callId = pickToolCallId(entry);
        if (!callId) return;
        const existing = prevSession[callId] && typeof prevSession[callId] === 'object' ? prevSession[callId] : {};
        const steps = mergeSubagentSteps(existing.steps, entry?.steps, MAX_SUBAGENT_STEPS);
        const done = entry?.done === true;
        const status = typeof entry?.status === 'string' ? entry.status : existing.status;
        const jobId = resolveProgressJobId(entry) || existing.jobId;
        sessionMap[callId] = {
          ...existing,
          steps,
          done: existing.done || done,
          status,
          jobId,
          updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : existing.updatedAt,
        };
      });
      next[sid] = sessionMap;
      subagentStreamsRef.current = next;
      return next;
    });
  };

  const clearSubagentStream = (sessionId, toolCallId) => {
    const sid = normalizeId(sessionId);
    const callId = normalizeId(toolCallId);
    if (!sid || !callId) return;
    setSubagentStreams((prev) => {
      if (!prev || !prev[sid]) return prev;
      const sessionMap = { ...prev[sid] };
      if (!sessionMap[callId]) return prev;
      delete sessionMap[callId];
      const next = { ...prev, [sid]: sessionMap };
      subagentStreamsRef.current = next;
      return next;
    });
  };

  const clearMcpStream = (sessionId) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    setMcpStreams((prev) => {
      if (!prev || !prev[sid]) return prev;
      const next = { ...prev };
      delete next[sid];
      mcpStreamsRef.current = next;
      return next;
    });
  };

  return {
    mergeStreamBuffer,
    updateStreamBuffer,
    updateMcpStream,
    updateSubagentStream,
    applyPersistedSubagentStreams,
    clearSubagentStream,
    clearMcpStream,
  };
}

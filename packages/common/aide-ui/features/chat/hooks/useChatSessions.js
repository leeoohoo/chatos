import { useEffect, useMemo, useRef, useState } from 'react';
import { message as toast } from 'antd';

import { api, hasApi } from '../../../lib/api.js';
import { isContextLengthError, normalizeErrorText } from '../../../../error-utils.js';
import { normalizeId } from '../../../../text-utils.js';
import {
  buildFinalTextFromChunks,
  mergeSubagentSteps,
  normalizeProgressKind,
  normalizeStepsPayload,
  pickToolCallId,
  resolveProgressDone,
  resolveProgressJobId,
} from '../../../../chat-stream-utils.js';

function collectErrorHints(payload) {
  const hints = [];
  const push = (value) => {
    const text = normalizeErrorText(value);
    if (text) hints.push(text);
  };
  push(payload?.message);
  push(payload?.error?.message);
  push(payload?.error?.detail);
  push(payload?.error?.details);
  push(payload?.error?.type);
  push(payload?.error?.code);
  push(payload?.error?.error?.message);
  push(payload?.error?.error?.type);
  push(payload?.error?.error?.code);
  push(payload?.code);
  push(payload?.type);
  return hints;
}

function extractErrorMessage(payload) {
  const hints = collectErrorHints(payload);
  if (hints.length > 0) return hints[0];
  return '';
}

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

function isRunSubAgentToolName(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return name.includes('run_sub_agent');
}

export function useChatSessions() {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [composerText, setComposerText] = useState('');
  const [composerAttachments, setComposerAttachments] = useState([]);
  const [streamStates, setStreamStates] = useState({});
  const [streamBuffers, setStreamBuffers] = useState({});
  const [mcpStreams, setMcpStreams] = useState({});
  const [subagentStreams, setSubagentStreams] = useState({});
  const [sessionErrors, setSessionErrors] = useState({});

  const selectedSessionIdRef = useRef('');
  const streamStatesRef = useRef({});
  const streamBuffersRef = useRef({});
  const mcpStreamsRef = useRef({});
  const subagentStreamsRef = useRef({});

  const currentSession = useMemo(
    () => sessions.find((s) => normalizeId(s?.id) === normalizeId(selectedSessionId)) || null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    selectedSessionIdRef.current = normalizeId(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    streamStatesRef.current = streamStates;
  }, [streamStates]);

  useEffect(() => {
    streamBuffersRef.current = streamBuffers;
  }, [streamBuffers]);

  useEffect(() => {
    mcpStreamsRef.current = mcpStreams;
  }, [mcpStreams]);

  useEffect(() => {
    subagentStreamsRef.current = subagentStreams;
  }, [subagentStreams]);

  useEffect(() => {
    if (!hasApi) return undefined;
    const sid = normalizeId(selectedSessionId);
    if (!sid) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.invoke('chat:subagent:streams', { sessionId: sid });
        if (cancelled) return;
        if (res?.ok === false) return;
        const streams = Array.isArray(res?.streams) ? res.streams : [];
        applyPersistedSubagentStreams(sid, streams);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  const currentStreamState = useMemo(() => {
    const sid = normalizeId(selectedSessionId);
    if (!sid) return null;
    return streamStates[sid] || null;
  }, [selectedSessionId, streamStates]);

  const currentMcpStream = useMemo(() => {
    const sid = normalizeId(selectedSessionId);
    if (!sid) return null;
    return mcpStreams[sid] || null;
  }, [selectedSessionId, mcpStreams]);

  const currentSubagentStream = useMemo(() => {
    const sid = normalizeId(selectedSessionId);
    if (!sid) return {};
    const entry = subagentStreams[sid];
    return entry && typeof entry === 'object' ? entry : {};
  }, [selectedSessionId, subagentStreams]);

  const sessionStatusById = useMemo(() => {
    const list = Array.isArray(sessions) ? sessions : [];
    const next = {};
    for (const session of list) {
      const sid = normalizeId(session?.id);
      if (!sid) continue;
      const hasStream = Boolean(streamStates?.[sid]);
      const isRunning = Boolean(session?.running) || hasStream;
      const hasError = Boolean(sessionErrors?.[sid]);
      next[sid] = isRunning ? 'running' : hasError ? 'error' : 'idle';
    }
    return next;
  }, [sessions, streamStates, sessionErrors]);

  const clearSessionError = (sessionId) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    setSessionErrors((prev) => {
      if (!prev || !prev[sid]) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    });
  };

  const setSessionError = (sessionId, errorMessage) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    const message = typeof errorMessage === 'string' ? errorMessage.trim() : '';
    setSessionErrors((prev) => ({
      ...(prev || {}),
      [sid]: { message, at: new Date().toISOString() },
    }));
  };

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
        const callId = normalizeId(entry?.toolCallId || entry?.tool_call_id || entry?.callId || entry?.call_id);
        if (!callId) return;
        const existing = prevSession[callId] && typeof prevSession[callId] === 'object' ? prevSession[callId] : {};
        const steps = mergeSubagentSteps(existing.steps, entry?.steps, MAX_SUBAGENT_STEPS);
        const done = entry?.done === true;
        const status = typeof entry?.status === 'string' ? entry.status : existing.status;
        const jobId = normalizeId(entry?.jobId || entry?.job_id) || existing.jobId;
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

  const refreshSessions = async () => {
    const res = await api.invoke('chat:sessions:list');
    if (res?.ok === false) throw new Error(res?.message || '加载会话失败');
    setSessions(Array.isArray(res?.sessions) ? res.sessions : []);
  };

  const PAGE_SIZE = 50;

  const refreshMessages = async (sessionId, options = {}) => {
    const sid = normalizeId(sessionId);
    if (!sid) {
      setMessages([]);
      setMessagesHasMore(false);
      return;
    }
    const limit = Number.isFinite(options?.limit) ? options.limit : PAGE_SIZE;
    const res = await api.invoke('chat:messages:list', { sessionId: sid, limit });
    if (res?.ok === false) throw new Error(res?.message || '加载消息失败');
    const list = Array.isArray(res?.messages) ? res.messages : [];
    setMessages(mergeStreamBuffer(sid, list));
    setMessagesHasMore(Boolean(res?.hasMore));
  };

  const refreshAll = async () => {
    setLoading(true);
    try {
      await refreshSessions();
      await refreshMessages(selectedSessionIdRef.current);
    } catch (err) {
      toast.error(err?.message || '刷新失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasApi) {
      setLoading(false);
      return undefined;
    }
    (async () => {
      setLoading(true);
      try {
        const ensured = await api.invoke('chat:agents:ensureDefault');
        const ensuredAgentId = normalizeId(ensured?.agent?.id);
        const sessionsRes = await api.invoke('chat:sessions:list');
        const nextSessions = Array.isArray(sessionsRes?.sessions) ? sessionsRes.sessions : [];
        setSessions(nextSessions);

        const preferredSessionId = normalizeId(nextSessions?.[0]?.id);
        if (preferredSessionId) {
          setSelectedSessionId(preferredSessionId);
          setSelectedAgentId(normalizeId(nextSessions?.[0]?.agentId));
          await refreshMessages(preferredSessionId);
          return;
        }

        const created = await api.invoke('chat:sessions:ensureDefault', { agentId: ensuredAgentId });
        const sid = normalizeId(created?.session?.id);
        await refreshSessions();
        if (sid) {
          setSelectedSessionId(sid);
          setSelectedAgentId(normalizeId(created?.session?.agentId));
          await refreshMessages(sid);
        }
      } catch (err) {
        toast.error(err?.message || '初始化 Chat 失败');
      } finally {
        setLoading(false);
      }
    })();

    const unsub = api.on('chat:event', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const type = String(payload.type || '');
      if (type === 'notice') {
        const text = typeof payload.message === 'string' ? payload.message : '';
        if (text) toast.info(text);
        return;
      }
      if (type === 'assistant_start') {
        const record = payload.message;
        if (!record || typeof record !== 'object') return;
        const mid = normalizeId(record?.id);
        const sid = normalizeId(record?.sessionId);
        if (!mid || !sid) return;
        clearSessionError(sid);
        setStreamStates((prev) => ({ ...prev, [sid]: { sessionId: sid, messageId: mid } }));
        updateStreamBuffer(sid, mid, (base) => ({
          ...base,
          content: typeof record?.content === 'string' ? record.content : '',
          reasoning: typeof record?.reasoning === 'string' ? record.reasoning : '',
        }));
        if (normalizeId(selectedSessionIdRef.current) === sid) {
          setMessages((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (list.some((m) => normalizeId(m?.id) === mid)) return list;
            return [...list, record];
          });
        }
        return;
      }
      if (type === 'assistant_delta') {
        const mid = normalizeId(payload.messageId);
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        const sid = normalizeId(payload.sessionId);
        if (!mid || !delta || !sid) return;
        updateStreamBuffer(sid, mid, (base) => ({
          ...base,
          content: `${base.content || ''}${delta}`,
        }));
        if (normalizeId(selectedSessionIdRef.current) !== sid) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const idx = list.findIndex((m) => normalizeId(m?.id) === mid);
          if (idx < 0) {
            return [...list, { id: mid, sessionId: sid, role: 'assistant', content: delta }];
          }
          const next = list.slice();
          const existing = next[idx];
          next[idx] = { ...existing, content: `${existing?.content || ''}${delta}` };
          return next;
        });
        return;
      }
      if (type === 'assistant_reasoning_delta') {
        const mid = normalizeId(payload.messageId);
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        const sid = normalizeId(payload.sessionId);
        if (!mid || !delta || !sid) return;
        updateStreamBuffer(sid, mid, (base) => ({
          ...base,
          reasoning: `${base.reasoning || ''}${delta}`,
        }));
        if (normalizeId(selectedSessionIdRef.current) !== sid) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const idx = list.findIndex((m) => normalizeId(m?.id) === mid);
          if (idx < 0) {
            return [...list, { id: mid, sessionId: sid, role: 'assistant', content: '', reasoning: delta }];
          }
          const next = list.slice();
          const existing = next[idx];
          next[idx] = { ...existing, reasoning: `${existing?.reasoning || ''}${delta}` };
          return next;
        });
        return;
      }
      if (type === 'tool_result') {
        const record = payload.message;
        if (!record || typeof record !== 'object') return;
        const sid = normalizeId(record?.sessionId);
        const callId = normalizeId(record?.toolCallId);
        const hasSubagentStream = Boolean(subagentStreamsRef.current?.[sid]?.[callId]);
        if (sid && callId && !isRunSubAgentToolName(record?.toolName) && !hasSubagentStream) {
          clearSubagentStream(sid, callId);
        }
        if (normalizeId(record?.sessionId) !== normalizeId(selectedSessionIdRef.current)) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const rid = normalizeId(record?.id);
          if (rid && list.some((m) => normalizeId(m?.id) === rid)) return list;
          return [...list, record];
        });
        return;
      }
      if (type === 'mcp_stream') {
        const sid = normalizeId(payload.sessionId);
        if (!sid) return;
        const streamPayload = payload.payload && typeof payload.payload === 'object' ? payload.payload : null;
        if (!streamPayload) return;
        const streamServer = typeof streamPayload.server === 'string' ? streamPayload.server.trim().toLowerCase() : '';
        if (streamServer === 'subagent_router') {
          updateSubagentStream(sid, streamPayload);
        }
        updateMcpStream(sid, streamPayload);
        return;
      }
      if (type === 'messages_refresh') {
        const sid = normalizeId(payload.sessionId);
        if (sid && normalizeId(selectedSessionIdRef.current) === sid) {
          void refreshMessages(sid).catch(() => {});
        }
        void refreshSessions().catch(() => {});
        return;
      }
      if (type === 'assistant_done' || type === 'assistant_error' || type === 'assistant_aborted') {
        const mid = normalizeId(payload.messageId);
        const sid = normalizeId(payload.sessionId);
        if (sid) {
          setStreamStates((prev) => {
            if (!prev || !prev[sid]) return prev;
            const next = { ...prev };
            delete next[sid];
            return next;
          });
          setStreamBuffers((prev) => {
            if (!prev || !prev[sid]) return prev;
            const next = { ...prev };
            delete next[sid];
            streamBuffersRef.current = next;
            return next;
          });
          if (normalizeId(selectedSessionIdRef.current) === sid) {
            void refreshMessages(sid).catch(() => {});
          }
        }
        if (type === 'assistant_error') {
          const errorMessage = extractErrorMessage(payload);
          setSessionError(sid, errorMessage || payload?.message || '');
          const isContextLength = isContextLengthError(payload);
          const friendlyMessage = isContextLength
            ? '上下文过长，系统正在自动恢复…'
            : '';
          if (isContextLength) {
            toast.loading({ content: friendlyMessage, duration: 2 });
          } else {
            toast.error(errorMessage || '请求失败');
          }
          if (mid && (!sid || normalizeId(selectedSessionIdRef.current) === sid)) {
            setMessages((prev) =>
              prev.map((m) => {
                if (normalizeId(m?.id) !== mid) return m;
                const existing = typeof m?.content === 'string' ? m.content.trim() : '';
                if (existing) return m;
                const detail = isContextLength
                  ? `${friendlyMessage}${errorMessage ? `（${errorMessage}）` : ''}`
                  : errorMessage || '请求失败';
                return { ...m, content: `[error] ${detail}` };
              })
            );
          }
        }
        if (type === 'assistant_aborted') {
          toast.info('已停止');
          clearSessionError(sid);
        }
        void refreshSessions();
      }
    });

    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const selectSession = async (sessionId) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    try {
      setSelectedSessionId(sid);
      const session = sessions.find((s) => normalizeId(s?.id) === sid) || null;
      setSelectedAgentId(normalizeId(session?.agentId));
      await refreshMessages(sid);
    } catch (err) {
      toast.error(err?.message || '加载会话失败');
    }
  };

  const loadMoreMessages = async () => {
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid || loadingMore || !messagesHasMore) return;
    const firstId = normalizeId(messages?.[0]?.id);
    setLoadingMore(true);
    try {
      const res = await api.invoke('chat:messages:list', { sessionId: sid, limit: PAGE_SIZE, beforeId: firstId });
      if (res?.ok === false) throw new Error(res?.message || '加载更多失败');
      const nextBatch = Array.isArray(res?.messages) ? res.messages : [];
      setMessages((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const seen = new Set(list.map((m) => normalizeId(m?.id)).filter(Boolean));
        const prefix = nextBatch.filter((m) => !seen.has(normalizeId(m?.id)));
        return mergeStreamBuffer(sid, [...prefix, ...list]);
      });
      setMessagesHasMore(Boolean(res?.hasMore));
    } catch (err) {
      toast.error(err?.message || '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const createSession = async ({ agentId } = {}) => {
    const aid = normalizeId(agentId) || normalizeId(selectedAgentId);
    if (!aid) {
      toast.error('请先选择 Agent（会话为空时需先在上方选择）');
      return;
    }
    try {
      const res = await api.invoke('chat:sessions:create', {
        title: '新会话',
        agentId: aid,
      });
      if (res?.ok === false) throw new Error(res?.message || '创建会话失败');
      const sid = normalizeId(res?.session?.id);
      await refreshSessions();
      if (sid) {
        setSelectedSessionId(sid);
        setSelectedAgentId(aid);
        await refreshMessages(sid);
      }
    } catch (err) {
      toast.error(err?.message || '创建会话失败');
    }
  };

  const deleteSession = async (sessionId, options = {}) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    const force = options?.force === true;
    const status = sessionStatusById?.[sid] || '';
    if (status === 'running' && !force) {
      toast.info('会话正在执行中，无法删除');
      return;
    }
    try {
      const res = await api.invoke('chat:sessions:delete', { id: sid, force });
      if (res?.ok === false) throw new Error(res?.message || '删除会话失败');
      const nextSessions = sessions.filter((s) => normalizeId(s?.id) !== sid);
      setSessions(nextSessions);
      clearSessionError(sid);
      if (normalizeId(selectedSessionIdRef.current) === sid) {
        const fallback = normalizeId(nextSessions?.[0]?.id);
        if (fallback) {
          setSelectedSessionId(fallback);
          setSelectedAgentId(normalizeId(nextSessions?.[0]?.agentId));
          await refreshMessages(fallback);
        } else {
          setSelectedSessionId('');
          await refreshMessages('');
        }
      }
    } catch (err) {
      toast.error(err?.message || '删除会话失败');
    }
  };

  const renameSession = async (sessionId, title) => {
    const sid = normalizeId(sessionId);
    const name = typeof title === 'string' ? title.trim() : '';
    if (!sid || !name) return;
    try {
      const res = await api.invoke('chat:sessions:update', { id: sid, data: { title: name } });
      if (res?.ok === false) throw new Error(res?.message || '重命名失败');
      await refreshSessions();
    } catch (err) {
      toast.error(err?.message || '重命名失败');
    }
  };

  const changeAgent = async (agentId) => {
    const aid = normalizeId(agentId);
    if (!aid) return;
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid) {
      setSelectedAgentId(aid);
      toast.info('已选择 Agent，新会话将使用该 Agent');
      return;
    }
    const previous = selectedAgentId;
    setSelectedAgentId(aid);
    try {
      const res = await api.invoke('chat:sessions:update', { id: sid, data: { agentId: aid } });
      if (res?.ok === false) throw new Error(res?.message || '更新会话 Agent 失败');
      await refreshSessions();
    } catch (err) {
      setSelectedAgentId(previous);
      toast.error(err?.message || '更新会话 Agent 失败');
    }
  };

  const setWorkspaceRoot = async (workspaceRoot) => {
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid) return;
    const next = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
    try {
      const res = await api.invoke('chat:sessions:update', { id: sid, data: { workspaceRoot: next } });
      if (res?.ok === false) throw new Error(res?.message || '更新工作目录失败');
      toast.success('已更新工作目录');
      await refreshSessions();
    } catch (err) {
      toast.error(err?.message || '更新工作目录失败');
    }
  };

  const pickWorkspaceRoot = async () => {
    const current = sessions.find((s) => normalizeId(s?.id) === normalizeId(selectedSessionIdRef.current)) || null;
    const preferred = typeof current?.workspaceRoot === 'string' ? current.workspaceRoot.trim() : '';
    try {
      const result = await api.invoke('dialog:selectDirectory', { defaultPath: preferred || undefined });
      if (result?.ok && typeof result?.path === 'string' && result.path.trim()) {
        const picked = result.path.trim();
        await setWorkspaceRoot(picked);
        return picked;
      }
    } catch (err) {
      toast.error(err?.message || '选择目录失败');
    }
    return '';
  };

  const clearWorkspaceRoot = async () => {
    await setWorkspaceRoot('');
  };

  const sendMessage = async () => {
    const text = typeof composerText === 'string' ? composerText.trim() : '';
    const attachments = Array.isArray(composerAttachments) ? composerAttachments.filter(Boolean) : [];
    const currentSid = normalizeId(selectedSessionIdRef.current);
    if ((!text && attachments.length === 0) || (currentSid && streamStatesRef.current[currentSid])) return;
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid) {
      toast.error('请先创建会话');
      return;
    }
    try {
      clearSessionError(sid);
      const res = await api.invoke('chat:send', { sessionId: sid, text, attachments });
      if (res?.ok === false) throw new Error(res?.message || '发送失败');

      const userMessageId = normalizeId(res?.userMessageId);
      const assistantMessageId = normalizeId(res?.assistantMessageId);
      const now = new Date().toISOString();
      setComposerText('');
      setComposerAttachments([]);
      setMessages((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const seen = new Set(list.map((m) => normalizeId(m?.id)).filter(Boolean));
        const next = list.slice();
        const userId = userMessageId || `user_${now}`;
        if (userId && !seen.has(userId)) {
          next.push({ id: userId, sessionId: sid, role: 'user', content: text, attachments, createdAt: now, updatedAt: now });
          seen.add(userId);
        }
        const assistantId = assistantMessageId || `assistant_${now}`;
        if (assistantId && !seen.has(assistantId)) {
          next.push({ id: assistantId, sessionId: sid, role: 'assistant', content: '', createdAt: now, updatedAt: now });
        }
        return next;
      });
      if (sid) {
        setStreamStates((prev) => ({ ...prev, [sid]: { sessionId: sid, messageId: assistantMessageId } }));
        if (assistantMessageId) {
          updateStreamBuffer(sid, assistantMessageId, (base) => ({ ...base, content: '', reasoning: '' }));
        }
      }
    } catch (err) {
      toast.error(err?.message || '发送失败');
    }
  };

  const stopStreaming = async () => {
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid) return;
    try {
      await api.invoke('chat:abort', { sessionId: sid });
    } catch {
      // ignore
    }
  };

  return {
    loading,
    sessions,
    messages,
    messagesHasMore,
    loadingMore,
    selectedSessionId,
    selectedAgentId,
    composerText,
    composerAttachments,
    streamState: currentStreamState,
    mcpStreamState: currentMcpStream,
    subagentStreamState: currentSubagentStream,
    currentSession,
    sessionStatusById,
    setComposerText,
    setComposerAttachments,
    refreshSessions,
    refreshMessages,
    refreshAll,
    selectSession,
    loadMoreMessages,
    createSession,
    deleteSession,
    renameSession,
    changeAgent,
    setWorkspaceRoot,
    pickWorkspaceRoot,
    clearWorkspaceRoot,
    sendMessage,
    stopStreaming,
    clearMcpStream,
  };
}

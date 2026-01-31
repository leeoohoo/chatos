import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Empty, Select, Space, Tag, message } from 'antd';

import { api, hasApi } from '../../../lib/api.js';
import { formatDateTime, truncateText } from '../../../lib/format.js';
import { CodeBlock } from '../../../components/CodeBlock.jsx';
import { parseJsonSafe } from '../../../lib/parse.js';
import { parseTimestampMs } from '../../../lib/runs.js';
import { getFileChangeKey } from '../../../lib/file-changes.js';
import { normalizeId, normalizeText } from '../../../../text-utils.js';
import { isRunSubAgentToolName } from '../hooks/useChatSessions-streams.js';
import { ToolInvocationTag } from './tooling/ToolInvocationTag.jsx';
import { buildToolPresentation } from './tooling/tool-utils.js';
import { extractFileTags } from '../file-tags.js';

const TAB_KEYS = {
  tools: 'tools',
  tasks: 'tasks',
  files: 'files',
  sessions: 'sessions',
};

const DEFAULT_GROUP_PAGE_SIZE = 1;

function buildUserMessageGroups(messages = []) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  const groups = [];
  list.forEach((msg, idx) => {
    if (msg.role !== 'user') return;
    const contentRaw = typeof msg?.content === 'string' ? msg.content : String(msg?.content || '');
    const { text: contentClean, files: fileTags } = extractFileTags(contentRaw);
    const previewRaw = contentClean.trim();
    const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
    const preview = previewRaw
      ? truncateText(previewRaw, 64)
      : attachments.length > 0
        ? '（附件）'
        : fileTags.length > 0
          ? '（已选文件）'
        : '';
    const timeText = formatTimeShort(msg?.createdAt || msg?.ts || msg?.created_at);
    const startMs = parseTimestampMs(msg?.createdAt || msg?.ts || msg?.created_at);
    groups.push({
      key: normalizeId(msg?.id) || `user_${idx}`,
      userMessageId: normalizeId(msg?.id),
      userMessage: msg,
      preview,
      timeText,
      startMs,
    });
  });
  return groups;
}

function assignItemsToUserGroups(groups = [], items = [], _getItemMs, getItemUserMessageId) {
  const base = (Array.isArray(groups) ? groups : []).map((group) => ({
    ...group,
    items: [],
  }));
  const groupByUserId = new Map(
    base
      .map((group) => {
        const key = normalizeId(group.userMessageId || group.key);
        return key ? [key, group] : null;
      })
      .filter(Boolean)
  );
  const list = Array.isArray(items) ? items : [];
  list.forEach((item) => {
    const userMessageId = normalizeId(
      typeof getItemUserMessageId === 'function' ? getItemUserMessageId(item) : item?.userMessageId
    );
    if (!userMessageId) return;
    const group = groupByUserId.get(userMessageId);
    if (!group) return;
    group.items.push(item);
  });
  return base.filter((group) => group.items.length > 0);
}

function formatTimeShort(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString();
}

function getToolName(call) {
  const name = call?.function?.name;
  return typeof name === 'string' ? name.trim() : '';
}

function getToolArgs(call) {
  const args = call?.function?.arguments;
  if (typeof args === 'string') return args;
  if (args === undefined || args === null) return '';
  return String(args);
}

function normalizeToolName(value) {
  return normalizeText(value).toLowerCase();
}

function isShellSessionRunToolName(value) {
  const raw = normalizeToolName(value);
  if (!raw) return false;
  return raw.includes('session_run') && raw.includes('shell');
}

function parseToolArgs(argsText) {
  if (!argsText || typeof argsText !== 'string') return null;
  const parsed = parseJsonSafe(argsText, null);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function extractSessionNameFromText(text) {
  const raw = typeof text === 'string' ? text : String(text || '');
  const startedMatch = raw.match(/Started session\s+["']([^"']+)["']/i);
  if (startedMatch) return startedMatch[1];
  const sessionMatch = raw.match(/Session:\s*([^\n]+)/i);
  if (sessionMatch) return sessionMatch[1].trim();
  return '';
}

function buildSessionEntry({
  sessionName,
  displayName,
  command,
  cwd,
  toolName,
  source,
  reused,
  userMessageId,
  ts,
  key,
}) {
  const normalizedName = normalizeText(sessionName);
  const normalizedDisplay = normalizeText(displayName);
  const title = normalizedDisplay || normalizedName || '未命名会话';
  const name = normalizedName || normalizedDisplay || title;
  const subtitleParts = [];
  const commandText = normalizeText(command);
  if (commandText) subtitleParts.push(commandText);
  const cwdText = normalizeText(cwd);
  if (cwdText) subtitleParts.push(`cwd: ${cwdText}`);
  return {
    key: key || `${name}_${commandText || ''}_${userMessageId || ''}`,
    title,
    name,
    subtitle: subtitleParts.join(' · '),
    toolName: normalizeText(toolName),
    source,
    reused: reused === true,
    userMessageId,
    ts: typeof ts === 'string' ? ts : '',
  };
}

function dedupeSessionEntries(entries = []) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const byKey = new Map();
  const order = [];
  list.forEach((item, idx) => {
    const key = normalizeId(item?.key) || `${item?.title || 'session'}_${item?.userMessageId || ''}_${idx}`;
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, item);
  });
  return order.map((key) => byKey.get(key)).filter(Boolean);
}

function extractSessionEntriesFromSteps(steps = [], userMessageId) {
  const list = Array.isArray(steps) ? steps : [];
  const resultByCallId = new Map();
  list.forEach((step) => {
    if (step?.type !== 'tool_result') return;
    if (!isShellSessionRunToolName(step?.tool)) return;
    const callId = normalizeId(step?.call_id);
    if (callId) resultByCallId.set(callId, step);
  });
  const entries = [];
  list.forEach((step, idx) => {
    if (step?.type !== 'tool_call') return;
    if (!isShellSessionRunToolName(step?.tool)) return;
    const args = parseToolArgs(step?.args);
    const callId = normalizeId(step?.call_id);
    const result = callId ? resultByCallId.get(callId) : null;
    const resultText = typeof result?.result === 'string' ? result.result : '';
    const extractedName = extractSessionNameFromText(resultText);
    const displayName = normalizeText(args?.session);
    const sessionName = normalizeText(extractedName) || displayName || normalizeText(args?.name);
    const command = normalizeText(args?.command);
    const cwd = normalizeText(args?.cwd);
    const reused = resultText.toLowerCase().includes('reused');
    entries.push(
      buildSessionEntry({
        sessionName,
        displayName,
        command,
        cwd,
        toolName: step?.tool,
        source: 'subagent',
        reused,
        userMessageId,
        ts: step?.ts,
        key: callId || `${sessionName || 'session'}_${idx}`,
      })
    );
  });
  return entries;
}

function getToolResultText(results = []) {
  const parts = (Array.isArray(results) ? results : [])
    .map((msg) => {
      if (!msg) return '';
      if (typeof msg?.content === 'string') return msg.content;
      return String(msg?.content || '');
    })
    .map((text) => (typeof text === 'string' ? text.trim() : String(text || '').trim()))
    .filter(Boolean);
  return parts.join('\n\n');
}

function pickToolStructuredContent(results = []) {
  const list = Array.isArray(results) ? results : [];
  for (const msg of list) {
    const value = msg?.toolStructuredContent ?? msg?.structuredContent;
    if (value && typeof value === 'object') return value;
  }
  return null;
}

function pickToolIsError(results = []) {
  const list = Array.isArray(results) ? results : [];
  return list.some((msg) => msg?.toolIsError === true);
}

function inferInvocationStatus(invocation) {
  const structuredContent = invocation.structuredContent ?? pickToolStructuredContent(invocation.results);
  const toolIsError = invocation.toolIsError === true || pickToolIsError(invocation.results);
  const presentation = buildToolPresentation({
    toolName: invocation.name,
    argsText: invocation.argsText,
    resultText: invocation.resultText,
    structuredContent,
    toolIsError,
  });
  return presentation.status || '';
}

function buildToolGroupsByUser(messages = [], subagentStreams = {}) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  const toolResultsByCallId = new Map();

  list.forEach((msg) => {
    if (msg?.role !== 'tool') return;
    const callId = normalizeId(msg?.toolCallId);
    if (!callId) return;
    const existing = toolResultsByCallId.get(callId);
    if (existing) {
      existing.push(msg);
    } else {
      toolResultsByCallId.set(callId, [msg]);
    }
  });

  const groups = [];
  const groupByUserId = new Map();
  const consumedToolMessageIds = new Set();

  const ensureGroupForUserId = (userMessageId) => {
    const normalized = normalizeId(userMessageId);
    if (!normalized) return null;
    if (groupByUserId.has(normalized)) return groupByUserId.get(normalized);
    const group = {
      key: normalized,
      userMessageId: normalized,
      userMessage: null,
      preview: '',
      timeText: '',
      invocations: [],
    };
    groups.push(group);
    groupByUserId.set(normalized, group);
    return group;
  };

  list.forEach((msg, msgIdx) => {
    if (!msg) return;

    if (msg.role === 'user') {
      const contentRaw = typeof msg?.content === 'string' ? msg.content : String(msg?.content || '');
      const { text: contentClean, files: fileTags } = extractFileTags(contentRaw);
      const previewRaw = contentClean.trim();
      const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
      const preview = previewRaw
        ? truncateText(previewRaw, 64)
        : attachments.length > 0
          ? '（附件）'
          : fileTags.length > 0
            ? '（已选文件）'
          : '';
      const timeText = formatTimeShort(msg?.createdAt || msg?.ts || msg?.created_at);
      const userMessageId = normalizeId(msg?.id);
      if (!userMessageId) return;
      const group = ensureGroupForUserId(userMessageId);
      if (group) {
        group.userMessage = msg;
        group.preview = preview;
        group.timeText = timeText;
      }
      return;
    }

    if (msg.role === 'assistant') {
      const userMessageId = normalizeId(msg?.userMessageId);
      if (!userMessageId) return;
      const group = ensureGroupForUserId(userMessageId);
      if (!group) return;
      const calls = Array.isArray(msg?.toolCalls) ? msg.toolCalls.filter(Boolean) : [];
      if (calls.length === 0) return;
      calls.forEach((call, idx) => {
        const callId = normalizeId(call?.id);
        const results = callId ? toolResultsByCallId.get(callId) || [] : [];
        results.forEach((res) => {
          const mid = normalizeId(res?.id);
          if (mid) consumedToolMessageIds.add(mid);
        });

        const nameFromCall = getToolName(call);
        const nameFromResult =
          results.length > 0 && typeof results?.[0]?.toolName === 'string' ? results[0].toolName.trim() : '';
        const name = nameFromCall || nameFromResult || 'tool';
        const args = getToolArgs(call);
        const resultText = getToolResultText(results);
        const key = callId || `${normalizeId(msg?.id) || `assistant_${msgIdx}`}_${name}_${idx}`;
        const liveSteps =
          callId && subagentStreams && typeof subagentStreams === 'object'
            ? subagentStreams[callId]?.steps || []
            : [];

        group.invocations.push({
          key,
          name,
          callId,
          argsText: args,
          resultText,
          results,
          liveSteps,
        });
      });
      return;
    }

    if (msg.role === 'tool') {
      const mid = normalizeId(msg?.id);
      if (mid && consumedToolMessageIds.has(mid)) return;
      const userMessageId = normalizeId(msg?.userMessageId);
      if (!userMessageId) return;
      const group = ensureGroupForUserId(userMessageId);
      if (!group) return;
      const name = typeof msg?.toolName === 'string' ? msg.toolName.trim() : '';
      const callId = normalizeId(msg?.toolCallId);
      const content = typeof msg?.content === 'string' ? msg.content : String(msg?.content || '');
      const key = normalizeId(msg?.id) || `${name || 'tool'}_${callId || ''}_${msgIdx}`;
      group.invocations.push({
        key,
        name: name || 'tool',
        callId,
        argsText: '',
        resultText: content,
        results: [],
        structuredContent: msg?.toolStructuredContent ?? msg?.structuredContent ?? null,
        toolIsError: msg?.toolIsError === true,
      });
    }
  });

  return groups.filter((group) => group.invocations.length > 0);
}

function normalizeStatus(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'todo' || raw === 'doing' || raw === 'blocked' || raw === 'done') return raw;
  return raw;
}

function TaskStatusTag({ status }) {
  const statusColorMap = { done: 'green', doing: 'blue', blocked: 'red', todo: 'default' };
  const normalized = normalizeStatus(status);
  if (!normalized) return null;
  return <Tag color={statusColorMap[normalized] || 'default'}>{normalized}</Tag>;
}

function TaskPriorityTag({ priority }) {
  const priorityColorMap = { high: 'volcano', medium: 'blue', low: 'default' };
  const normalized = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
  if (!normalized) return null;
  return <Tag color={priorityColorMap[normalized] || 'default'}>{normalized}</Tag>;
}

function FileChangeTag({ changeType }) {
  if (changeType === 'created') return <Tag color="green">新增</Tag>;
  if (changeType === 'deleted') return <Tag color="red">删除</Tag>;
  return <Tag color="gold">修改</Tag>;
}

export function Workbar({
  messages,
  subagentStreams,
  tasks,
  fileChanges,
  sessionId,
  uiPrompt,
  uiPromptCount,
  onUiPromptRespond,
  expanded = true,
  onToggleExpanded,
  activeTab = TAB_KEYS.tools,
  onTabChange,
  previewLimit = 4,
}) {
  const [expandedGroups, setExpandedGroups] = useState({});
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [shellSessions, setShellSessions] = useState([]);
  const [shellSessionsLoading, setShellSessionsLoading] = useState(false);
  const [shellSessionsError, setShellSessionsError] = useState('');
  const [sessionLogOpen, setSessionLogOpen] = useState(false);
  const [sessionLogLoading, setSessionLogLoading] = useState(false);
  const [sessionLogError, setSessionLogError] = useState('');
  const [sessionLogPayload, setSessionLogPayload] = useState(null);
  const [sessionLogLines, setSessionLogLines] = useState(500);
  const [sessionLogTarget, setSessionLogTarget] = useState(null);
  const [groupPageByTab, setGroupPageByTab] = useState(() => ({
    [TAB_KEYS.tools]: DEFAULT_GROUP_PAGE_SIZE,
    [TAB_KEYS.tasks]: DEFAULT_GROUP_PAGE_SIZE,
    [TAB_KEYS.files]: DEFAULT_GROUP_PAGE_SIZE,
    [TAB_KEYS.sessions]: DEFAULT_GROUP_PAGE_SIZE,
  }));

  useEffect(() => {
    setGroupPageByTab({
      [TAB_KEYS.tools]: DEFAULT_GROUP_PAGE_SIZE,
      [TAB_KEYS.tasks]: DEFAULT_GROUP_PAGE_SIZE,
      [TAB_KEYS.files]: DEFAULT_GROUP_PAGE_SIZE,
      [TAB_KEYS.sessions]: DEFAULT_GROUP_PAGE_SIZE,
    });
  }, [sessionId]);

  const toolGroups = useMemo(
    () => buildToolGroupsByUser(messages, subagentStreams),
    [messages, subagentStreams]
  );

  const toolCount = useMemo(
    () => toolGroups.reduce((sum, group) => sum + group.invocations.length, 0),
    [toolGroups]
  );

  const userGroups = useMemo(() => buildUserMessageGroups(messages), [messages]);
  const userMessageIdSet = useMemo(
    () => new Set(userGroups.map((group) => normalizeId(group.userMessageId || group.key)).filter(Boolean)),
    [userGroups]
  );
  const tasksList = useMemo(() => (Array.isArray(tasks) ? tasks.filter(Boolean) : []), [tasks]);
  const taskRows = useMemo(() => {
    return [...tasksList].sort((a, b) => {
      const aMs = parseTimestampMs(a?.updatedAt || a?.createdAt || '');
      const bMs = parseTimestampMs(b?.updatedAt || b?.createdAt || '');
      return bMs - aMs;
    });
  }, [tasksList]);

  const fileChangeEntries = useMemo(() => {
    const list = Array.isArray(fileChanges?.entries) ? fileChanges.entries : [];
    return list;
  }, [fileChanges]);

  const boundTaskRows = useMemo(() => {
    return taskRows.filter((task) => {
      const id = normalizeId(task?.userMessageId);
      return id && userMessageIdSet.has(id);
    });
  }, [taskRows, userMessageIdSet]);

  const boundFileChanges = useMemo(() => {
    return fileChangeEntries.filter((item) => {
      const id = normalizeId(item?.userMessageId);
      return id && userMessageIdSet.has(id);
    });
  }, [fileChangeEntries, userMessageIdSet]);

  const fileChangesCount = boundFileChanges.length;
  const sessionRows = useMemo(() => {
    const entries = [];
    toolGroups.forEach((group) => {
      const userMessageId = normalizeId(group.userMessageId || group.key);
      group.invocations.forEach((invocation) => {
        if (!invocation) return;
        if (isShellSessionRunToolName(invocation.name)) {
          const args = parseToolArgs(invocation.argsText);
          const extractedName = extractSessionNameFromText(invocation.resultText);
          const displayName = normalizeText(args?.session);
          const sessionName = normalizeText(extractedName) || displayName || normalizeText(args?.name);
          const command = normalizeText(args?.command);
          const cwd = normalizeText(args?.cwd);
          const reused =
            typeof invocation.resultText === 'string' && invocation.resultText.toLowerCase().includes('reused');
          entries.push(
            buildSessionEntry({
              sessionName,
              displayName,
              command,
              cwd,
              toolName: invocation.name,
              source: 'direct',
              reused,
              userMessageId,
              key: invocation.callId || invocation.key,
            })
          );
          return;
        }
        if (isRunSubAgentToolName(invocation.name)) {
          const structured = invocation.structuredContent ?? pickToolStructuredContent(invocation.results);
          const steps = Array.isArray(invocation.liveSteps) && invocation.liveSteps.length > 0
            ? invocation.liveSteps
            : Array.isArray(structured?.steps)
              ? structured.steps
              : [];
          entries.push(...extractSessionEntriesFromSteps(steps, userMessageId));
        }
      });
    });
    return dedupeSessionEntries(entries);
  }, [toolGroups]);
  const boundSessionRows = useMemo(() => {
    return sessionRows.filter((item) => {
      const id = normalizeId(item?.userMessageId);
      return id && userMessageIdSet.has(id);
    });
  }, [sessionRows, userMessageIdSet]);
  const shellSessionMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(shellSessions) ? shellSessions : []).forEach((sess) => {
      const name = normalizeText(sess?.name);
      if (name) {
        map.set(name, sess);
      }
    });
    return map;
  }, [shellSessions]);

  const tabs = [
    { key: TAB_KEYS.tools, label: '工具', count: toolCount },
    { key: TAB_KEYS.tasks, label: '任务', count: boundTaskRows.length },
    { key: TAB_KEYS.files, label: '文件变更', count: fileChangesCount },
    { key: TAB_KEYS.sessions, label: '会话', count: boundSessionRows.length },
  ];

  const getGroupPageSize = (tabKey) => {
    const raw = groupPageByTab?.[tabKey];
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_GROUP_PAGE_SIZE;
    return Math.floor(raw);
  };

  const loadMoreGroups = (tabKey) => {
    setGroupPageByTab((prev) => {
      const current = prev && Number.isFinite(prev[tabKey]) ? prev[tabKey] : DEFAULT_GROUP_PAGE_SIZE;
      return { ...(prev || {}), [tabKey]: Math.max(DEFAULT_GROUP_PAGE_SIZE, current + 1) };
    });
  };

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => ({
      ...(prev || {}),
      [key]: !prev?.[key],
    }));
  };

  const refreshShellSessions = async ({ silent = false } = {}) => {
    if (!hasApi) {
      if (!silent) setShellSessionsError('IPC bridge not available');
      return;
    }
    try {
      setShellSessionsLoading(true);
      setShellSessionsError('');
      const result = await api.invoke('chat:shellSessions:list');
      if (result?.ok === false) {
        throw new Error(result?.message || '加载会话失败');
      }
      setShellSessions(Array.isArray(result?.sessions) ? result.sessions : []);
    } catch (err) {
      const msg = err?.message || '加载会话失败';
      setShellSessionsError(msg);
      if (!silent) message.error(msg);
    } finally {
      setShellSessionsLoading(false);
    }
  };

  const openSessionLog = async (sessionName) => {
    const name = normalizeText(sessionName);
    if (!name) return;
    setSessionLogTarget({ name });
    setSessionLogOpen(true);
    try {
      setSessionLogLoading(true);
      setSessionLogError('');
      const result = await api.invoke('chat:shellSessions:readLog', { name, lineCount: sessionLogLines });
      if (result?.ok === false) {
        throw new Error(result?.message || '加载会话日志失败');
      }
      setSessionLogPayload(result || null);
    } catch (err) {
      setSessionLogError(err?.message || '加载会话日志失败');
    } finally {
      setSessionLogLoading(false);
    }
  };

  const refreshSessionLog = async () => {
    const name = normalizeText(sessionLogTarget?.name);
    if (!name) return;
    try {
      setSessionLogLoading(true);
      setSessionLogError('');
      const result = await api.invoke('chat:shellSessions:readLog', { name, lineCount: sessionLogLines });
      if (result?.ok === false) {
        throw new Error(result?.message || '加载会话日志失败');
      }
      setSessionLogPayload(result || null);
    } catch (err) {
      setSessionLogError(err?.message || '加载会话日志失败');
    } finally {
      setSessionLogLoading(false);
    }
  };

  const stopShellSession = async (name) => {
    const sessionName = normalizeText(name);
    if (!sessionName) return;
    try {
      const result = await api.invoke('chat:shellSessions:stop', { name: sessionName });
      if (result?.ok === false) {
        throw new Error(result?.message || '停止失败');
      }
      message.success('已停止会话');
      void refreshShellSessions({ silent: true });
    } catch (err) {
      message.error(err?.message || '停止失败');
    }
  };

  const restartShellSession = async (name) => {
    const sessionName = normalizeText(name);
    if (!sessionName) return;
    try {
      const result = await api.invoke('chat:shellSessions:restart', { name: sessionName });
      if (result?.ok === false) {
        throw new Error(result?.message || '重启失败');
      }
      message.success('已重启会话');
      void refreshShellSessions({ silent: true });
    } catch (err) {
      message.error(err?.message || '重启失败');
    }
  };

  useEffect(() => {
    if (!hasApi) return;
    if (activeTab !== TAB_KEYS.sessions || !expanded) return;
    void refreshShellSessions({ silent: true });
  }, [activeTab, expanded, sessionId]);

  const renderGroupHeader = (group, label, count) => {
    const previewText = normalizeText(group.preview);
    const timeText = group.timeText || (group.userMessage?.createdAt ? formatDateTime(group.userMessage.createdAt) : '');
    const metaParts = [timeText, `${label} ${count}`].filter(Boolean);
    const metaText = metaParts.join(' · ');
    const expandedGroup = Boolean(expandedGroups?.[group.key]);
    return (
      <>
        <div className="ds-workbar-group-head">
          <div className="ds-workbar-group-title">用户消息</div>
          {metaText ? <div className="ds-workbar-group-meta">{metaText}</div> : null}
          <button
            type="button"
            className="ds-workbar-group-toggle"
            onClick={() => toggleGroup(group.key)}
          >
            {expandedGroup ? '折叠' : '展开'}
          </button>
        </div>
        {previewText ? <div className="ds-workbar-group-preview">“{previewText}”</div> : null}
      </>
    );
  };

  const renderTools = () => {
    if (toolGroups.length === 0) return <Empty description="暂无工具调用" />;

    const filteredGroups = toolGroups
      .map((group) => {
        const invocations = onlyErrors
          ? group.invocations.filter((inv) => {
              const status = inferInvocationStatus(inv);
              return status === 'error' || status === 'timeout';
            })
          : group.invocations;
        return { ...group, invocations };
      })
      .filter((group) => group.invocations.length > 0);

    if (filteredGroups.length === 0) return <Empty description="暂无失败工具调用" />;

    const visibleCount = getGroupPageSize(TAB_KEYS.tools);
    const visibleGroups = filteredGroups.slice(-visibleCount);
    const hiddenGroupCount = Math.max(filteredGroups.length - visibleGroups.length, 0);

    return (
        <div className="ds-workbar-groups">
        {visibleGroups.map((group) => {
          const expandedGroup = Boolean(expandedGroups?.[group.key]);
          const runSubAgentInvocations = group.invocations.filter((inv) => isRunSubAgentToolName(inv?.name));
          const otherInvocations = group.invocations.filter((inv) => !isRunSubAgentToolName(inv?.name));
          const groupFileChanges = boundFileChanges.filter(
            (item) => normalizeId(item?.userMessageId) === group.key
          );
          const fallbackFileChanges = groupFileChanges.length > 0 ? groupFileChanges : fileChangeEntries;
          const previewCount = Number.isFinite(previewLimit) && previewLimit > 0 ? previewLimit : 0;
          let displayRunSubAgent = runSubAgentInvocations;
          let displayOthers = otherInvocations;
          if (!expandedGroup && previewCount > 0) {
            const runCount = Math.min(runSubAgentInvocations.length, previewCount);
            displayRunSubAgent = runSubAgentInvocations.slice(0, runCount);
            const remaining = previewCount - displayRunSubAgent.length;
            displayOthers = remaining > 0 ? otherInvocations.slice(0, remaining) : [];
          }
          const displayedCount = displayRunSubAgent.length + displayOthers.length;
          const hiddenCount = Math.max(group.invocations.length - displayedCount, 0);

          return (
            <div key={group.key} className="ds-workbar-group">
              {renderGroupHeader(group, '工具', group.invocations.length)}
              {displayRunSubAgent.length > 0 ? (
                <div className="ds-workbar-tool-section ds-workbar-tool-section-subagent" data-kind="subagent">
                  <div className="ds-workbar-tool-section-title">子代理运行</div>
                  <div className="ds-workbar-tool-stack">
                    {displayRunSubAgent.map((invocation) => (
                      <ToolInvocationTag
                        key={invocation.key}
                        name={invocation.name}
                        callId={invocation.callId}
                        argsText={invocation.argsText}
                        resultText={invocation.resultText}
                        results={invocation.results}
                        liveSteps={invocation.liveSteps}
                        structuredContent={invocation.structuredContent}
                        toolIsError={invocation.toolIsError}
                        fileChanges={fallbackFileChanges}
                        maxWidth={640}
                        maxHeight={360}
                        uiPrompt={uiPrompt}
                        uiPromptCount={uiPromptCount}
                        onUiPromptRespond={onUiPromptRespond}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {displayOthers.length > 0 ? (
                <div className="ds-workbar-tool-section">
                  <div className="ds-workbar-tool-grid">
                    {displayOthers.map((invocation) => (
                      <ToolInvocationTag
                        key={invocation.key}
                        name={invocation.name}
                        callId={invocation.callId}
                        argsText={invocation.argsText}
                        resultText={invocation.resultText}
                        results={invocation.results}
                        liveSteps={invocation.liveSteps}
                        structuredContent={invocation.structuredContent}
                        toolIsError={invocation.toolIsError}
                        fileChanges={groupFileChanges}
                        maxWidth={640}
                        maxHeight={360}
                        uiPrompt={uiPrompt}
                        uiPromptCount={uiPromptCount}
                        onUiPromptRespond={onUiPromptRespond}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="ds-workbar-more"
                  onClick={() => toggleGroup(group.key)}
                >
                  +{hiddenCount} 更多
                </button>
              ) : null}
            </div>
          );
        })}
        {hiddenGroupCount > 0 ? (
          <button
            type="button"
            className="ds-workbar-more"
            onClick={() => loadMoreGroups(TAB_KEYS.tools)}
          >
            加载更多
          </button>
        ) : null}
      </div>
    );
  };

  const renderTasks = () => {
    if (boundTaskRows.length === 0) return <Empty description="暂无任务" />;
    const taskGroups = assignItemsToUserGroups(
      userGroups,
      boundTaskRows,
      (task) => parseTimestampMs(task?.createdAt || task?.updatedAt || ''),
      (task) => task?.userMessageId
    );
    if (taskGroups.length === 0) return <Empty description="暂无任务" />;

    const visibleCount = getGroupPageSize(TAB_KEYS.tasks);
    const visibleGroups = taskGroups.slice(-visibleCount);
    const hiddenGroupCount = Math.max(taskGroups.length - visibleGroups.length, 0);

    return (
      <div className="ds-workbar-groups">
        {visibleGroups.map((group) => {
          const expandedGroup = Boolean(expandedGroups?.[group.key]);
          const list = expandedGroup ? group.items : group.items.slice(0, previewLimit);
          const hiddenCount = Math.max(group.items.length - list.length, 0);
          return (
            <div key={group.key} className="ds-workbar-group">
              {renderGroupHeader(group, '任务', group.items.length)}
              <div className="ds-workbar-list">
                {list.map((task, idx) => {
                  const title = typeof task?.title === 'string' ? task.title.trim() : '';
                  const subtitle = typeof task?.details === 'string' ? truncateText(task.details.trim(), 80) : '';
                  const key = normalizeId(task?.id) || `task_${idx}`;
                  return (
                    <div key={key} className="ds-workbar-list-item">
                      <div className="ds-workbar-item-content">
                        <div className="ds-workbar-item-title">{title || '未命名任务'}</div>
                        {subtitle ? <div className="ds-workbar-item-subtitle">{subtitle}</div> : null}
                      </div>
                      <div className="ds-workbar-item-meta">
                        <TaskStatusTag status={task?.status} />
                        <TaskPriorityTag priority={task?.priority} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="ds-workbar-more"
                  onClick={() => toggleGroup(group.key)}
                >
                  +{hiddenCount} 更多
                </button>
              ) : null}
            </div>
          );
        })}
        {hiddenGroupCount > 0 ? (
          <button
            type="button"
            className="ds-workbar-more"
            onClick={() => loadMoreGroups(TAB_KEYS.tasks)}
          >
            加载更多
          </button>
        ) : null}
      </div>
    );
  };

  const renderFileChanges = () => {
    if (boundFileChanges.length === 0) return <Empty description="暂无文件变更" />;
    const fileGroups = assignItemsToUserGroups(
      userGroups,
      boundFileChanges,
      (item) => parseTimestampMs(item?.ts),
      (item) => item?.userMessageId
    );
    if (fileGroups.length === 0) return <Empty description="暂无文件变更" />;

    const visibleCount = getGroupPageSize(TAB_KEYS.files);
    const visibleGroups = fileGroups.slice(-visibleCount);
    const hiddenGroupCount = Math.max(fileGroups.length - visibleGroups.length, 0);

    return (
      <div className="ds-workbar-groups">
        {visibleGroups.map((group) => {
          const expandedGroup = Boolean(expandedGroups?.[group.key]);
          const list = expandedGroup ? group.items : group.items.slice(0, previewLimit);
          const hiddenCount = Math.max(group.items.length - list.length, 0);
          return (
            <div key={group.key} className="ds-workbar-group">
              {renderGroupHeader(group, '文件变更', group.items.length)}
              <div className="ds-workbar-list">
                {list.map((item, idx) => {
                  const key = getFileChangeKey(item) || item?.ts || `file_${idx}`;
                  const pathLabel = item?.path || item?.absolutePath || '未知文件';
                  const timeText = item?.ts ? formatDateTime(item.ts) : '';
                  return (
                    <div key={key} className="ds-workbar-list-item">
                      <div className="ds-workbar-item-content">
                        <div className="ds-workbar-item-title">{pathLabel}</div>
                        {timeText ? <div className="ds-workbar-item-subtitle">{timeText}</div> : null}
                      </div>
                      <div className="ds-workbar-item-meta">
                        <FileChangeTag changeType={item?.changeType} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="ds-workbar-more"
                  onClick={() => toggleGroup(group.key)}
                >
                  +{hiddenCount} 更多
                </button>
              ) : null}
            </div>
          );
        })}
        {hiddenGroupCount > 0 ? (
          <button
            type="button"
            className="ds-workbar-more"
            onClick={() => loadMoreGroups(TAB_KEYS.files)}
          >
            加载更多
          </button>
        ) : null}
      </div>
    );
  };

  const renderSessions = () => {
    if (boundSessionRows.length === 0) return <Empty description="暂无会话" />;
    const sessionGroups = assignItemsToUserGroups(
      userGroups,
      boundSessionRows,
      (item) => parseTimestampMs(item?.ts),
      (item) => item?.userMessageId
    );
    if (sessionGroups.length === 0) return <Empty description="暂无会话" />;

    const visibleCount = getGroupPageSize(TAB_KEYS.sessions);
    const visibleGroups = sessionGroups.slice(-visibleCount);
    const hiddenGroupCount = Math.max(sessionGroups.length - visibleGroups.length, 0);

    return (
      <div className="ds-workbar-groups">
        {shellSessionsError ? (
          <Alert type="warning" showIcon={false} message={shellSessionsError} style={{ marginBottom: 8 }} />
        ) : null}
        {visibleGroups.map((group) => {
          const expandedGroup = Boolean(expandedGroups?.[group.key]);
          const list = expandedGroup ? group.items : group.items.slice(0, previewLimit);
          const hiddenCount = Math.max(group.items.length - list.length, 0);
          return (
            <div key={group.key} className="ds-workbar-group">
              {renderGroupHeader(group, '会话', group.items.length)}
              <div className="ds-workbar-list">
                {list.map((item, idx) => {
                  const title = typeof item?.title === 'string' ? item.title.trim() : '';
                  const subtitle = typeof item?.subtitle === 'string' ? truncateText(item.subtitle.trim(), 80) : '';
                  const key = normalizeId(item?.key) || `session_${idx}`;
                  const runtimeSession = shellSessionMap.get(normalizeText(item?.name));
                  const running = runtimeSession?.running === true;
                  const port = runtimeSession?.port;
                  return (
                    <div key={key} className="ds-workbar-list-item">
                      <div className="ds-workbar-item-content">
                        <div className="ds-workbar-item-title">{title || '未命名会话'}</div>
                        {subtitle ? <div className="ds-workbar-item-subtitle">{subtitle}</div> : null}
                      </div>
                      <div className="ds-workbar-item-meta">
                        {item?.source === 'subagent' ? <Tag color="purple">subagent</Tag> : <Tag>shell</Tag>}
                        {Number.isFinite(port) ? <Tag color="geekblue">:{port}</Tag> : null}
                        <Tag color={running ? 'green' : 'default'}>{running ? '运行中' : '已停止'}</Tag>
                        {item?.reused ? <Tag color="geekblue">复用</Tag> : null}
                        <Button size="small" type="text" onClick={() => openSessionLog(item?.name)}>
                          日志
                        </Button>
                        <Button size="small" type="text" onClick={() => stopShellSession(item?.name)} disabled={!running}>
                          停止
                        </Button>
                        <Button size="small" type="text" onClick={() => restartShellSession(item?.name)}>
                          重启
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="ds-workbar-more"
                  onClick={() => toggleGroup(group.key)}
                >
                  +{hiddenCount} 更多
                </button>
              ) : null}
            </div>
          );
        })}
        {hiddenGroupCount > 0 ? (
          <button
            type="button"
            className="ds-workbar-more"
            onClick={() => loadMoreGroups(TAB_KEYS.sessions)}
          >
            加载更多
          </button>
        ) : null}
      </div>
    );
  };

  const renderBody = () => {
    if (activeTab === TAB_KEYS.tasks) return renderTasks();
    if (activeTab === TAB_KEYS.files) return renderFileChanges();
    if (activeTab === TAB_KEYS.sessions) return renderSessions();
    return renderTools();
  };

  return (
    <>
      <div className="ds-workbar" data-expanded={expanded ? 'true' : 'false'}>
        <div className="ds-workbar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="ds-workbar-tab"
            data-active={tab.key === activeTab ? 'true' : 'false'}
            onClick={() => onTabChange?.(tab.key)}
          >
            <span className="ds-workbar-tab-label">{tab.label}</span>
            <span className="ds-workbar-tab-count">{tab.count}</span>
          </button>
        ))}
        <div className="ds-workbar-spacer" />
        {expanded && activeTab === TAB_KEYS.tools ? (
          <button
            type="button"
            className="ds-workbar-action"
            data-active={onlyErrors ? 'true' : 'false'}
            onClick={() => setOnlyErrors((prev) => !prev)}
          >
            {onlyErrors ? '查看全部' : '仅看失败'}
          </button>
        ) : null}
        {expanded && activeTab === TAB_KEYS.sessions ? (
          <button
            type="button"
            className="ds-workbar-action"
            onClick={() => refreshShellSessions({ silent: false })}
            disabled={shellSessionsLoading}
          >
            {shellSessionsLoading ? '刷新中…' : '刷新会话'}
          </button>
        ) : null}
        <button type="button" className="ds-workbar-action" onClick={() => onToggleExpanded?.()}>
          {expanded ? '收起' : '展开'}
        </button>
        </div>
        {expanded ? <div className="ds-workbar-body">{renderBody()}</div> : null}
      </div>
      <Drawer
        title={sessionLogTarget?.name ? `会话日志 · ${sessionLogTarget.name}` : '会话日志'}
        open={sessionLogOpen}
        onClose={() => {
          setSessionLogOpen(false);
          setSessionLogError('');
          setSessionLogPayload(null);
        }}
        width={860}
        destroyOnClose
        styles={{ body: { display: 'flex', flexDirection: 'column', minHeight: 0 } }}
        extra={
          <Space size={8} wrap>
            <Select
              size="small"
              value={sessionLogLines}
              onChange={(val) => setSessionLogLines(Number(val) || 500)}
              options={[200, 500, 2000, 10_000].map((v) => ({ label: `${v} 行`, value: v }))}
              style={{ width: 120 }}
            />
            <Button size="small" onClick={refreshSessionLog} loading={sessionLogLoading}>
              刷新
            </Button>
          </Space>
        }
      >
        {shellSessionsError ? (
          <Alert type="warning" showIcon={false} message={shellSessionsError} style={{ marginBottom: 12 }} />
        ) : null}
        {sessionLogError ? (
          <Alert type="error" showIcon={false} message={sessionLogError} style={{ marginBottom: 12 }} />
        ) : null}
        <div style={{ flex: 1, minHeight: 0 }}>
          <CodeBlock
            text={sessionLogPayload?.content || ''}
            maxHeight={600}
            highlight={false}
            language="text"
            wrap={false}
            alwaysExpanded={false}
          />
        </div>
      </Drawer>
    </>
  );
}

export { TAB_KEYS as WORKBAR_TABS };

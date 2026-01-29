import React, { useMemo, useState } from 'react';
import { Empty, Tag } from 'antd';

import { formatDateTime, truncateText } from '../../../lib/format.js';
import { dedupeFileChanges, getFileChangeKey } from '../../../lib/file-changes.js';
import { normalizeId } from '../../../../text-utils.js';
import { ToolInvocationTag } from './tooling/ToolInvocationTag.jsx';
import { buildToolPresentation } from './tooling/tool-utils.js';

const TAB_KEYS = {
  tools: 'tools',
  tasks: 'tasks',
  files: 'files',
};

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const consumedToolMessageIds = new Set();
  let currentGroup = null;

  const pushGroup = (msg, idx) => {
    const contentRaw = typeof msg?.content === 'string' ? msg.content : String(msg?.content || '');
    const previewRaw = contentRaw.trim();
    const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
    const preview = previewRaw
      ? truncateText(previewRaw, 64)
      : attachments.length > 0
        ? '（附件）'
        : '';
    const timeText = formatTimeShort(msg?.createdAt || msg?.ts || msg?.created_at);
    const group = {
      key: normalizeId(msg?.id) || `user_${idx}`,
      userMessage: msg,
      preview,
      timeText,
      invocations: [],
    };
    groups.push(group);
    return group;
  };

  const ensureFallbackGroup = () => {
    if (currentGroup) return currentGroup;
    const fallback = {
      key: 'system',
      userMessage: null,
      preview: '（无用户消息）',
      timeText: '',
      invocations: [],
    };
    groups.push(fallback);
    currentGroup = fallback;
    return fallback;
  };

  list.forEach((msg, msgIdx) => {
    if (!msg) return;

    if (msg.role === 'user') {
      currentGroup = pushGroup(msg, msgIdx);
      return;
    }

    if (msg.role === 'assistant') {
      const calls = Array.isArray(msg?.toolCalls) ? msg.toolCalls.filter(Boolean) : [];
      if (calls.length === 0) return;
      const group = currentGroup || ensureFallbackGroup();
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
      const group = currentGroup || ensureFallbackGroup();
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
  expanded = true,
  onToggleExpanded,
  activeTab = TAB_KEYS.tools,
  onTabChange,
  previewLimit = 4,
}) {
  const [expandedGroups, setExpandedGroups] = useState({});
  const [onlyErrors, setOnlyErrors] = useState(false);

  const toolGroups = useMemo(
    () => buildToolGroupsByUser(messages, subagentStreams),
    [messages, subagentStreams]
  );

  const toolCount = useMemo(
    () => toolGroups.reduce((sum, group) => sum + group.invocations.length, 0),
    [toolGroups]
  );

  const tasksList = useMemo(() => (Array.isArray(tasks) ? tasks.filter(Boolean) : []), [tasks]);
  const taskRows = useMemo(() => {
    const parseMs = (ts) => {
      const ms = Date.parse(ts);
      return Number.isFinite(ms) ? ms : 0;
    };
    return [...tasksList].sort((a, b) => {
      const aMs = parseMs(a?.updatedAt || a?.createdAt || '');
      const bMs = parseMs(b?.updatedAt || b?.createdAt || '');
      return bMs - aMs;
    });
  }, [tasksList]);

  const dedupedFileChanges = useMemo(() => {
    const list = Array.isArray(fileChanges?.entries) ? fileChanges.entries : [];
    return dedupeFileChanges(list);
  }, [fileChanges]);

  const fileChangesCount = dedupedFileChanges.length;

  const tabs = [
    { key: TAB_KEYS.tools, label: '工具', count: toolCount },
    { key: TAB_KEYS.tasks, label: '任务', count: taskRows.length },
    { key: TAB_KEYS.files, label: '文件变更', count: fileChangesCount },
  ];

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => ({
      ...(prev || {}),
      [key]: !prev?.[key],
    }));
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

    return (
      <div className="ds-workbar-groups">
        {filteredGroups.map((group) => {
          const expandedGroup = Boolean(expandedGroups?.[group.key]);
          const list = expandedGroup ? group.invocations : group.invocations.slice(0, previewLimit);
          const hiddenCount = Math.max(group.invocations.length - list.length, 0);
          const previewText = normalizeText(group.preview);
          const timeText =
            group.timeText ||
            (group.userMessage?.createdAt ? formatDateTime(group.userMessage.createdAt) : '');
          const metaParts = [timeText, `工具 ${group.invocations.length}`].filter(Boolean);
          const metaText = metaParts.join(' · ');

          return (
            <div key={group.key} className="ds-workbar-group">
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
              <div className="ds-workbar-tool-grid">
                {list.map((invocation) => (
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
                    maxWidth={640}
                    maxHeight={360}
                  />
                ))}
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
      </div>
    );
  };

  const renderTasks = () => {
    if (taskRows.length === 0) return <Empty description="暂无任务" />;
    const list = taskRows.slice(0, previewLimit);
    const hiddenCount = Math.max(taskRows.length - list.length, 0);
    return (
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
        {hiddenCount > 0 ? <div className="ds-workbar-more">+{hiddenCount} 更多</div> : null}
      </div>
    );
  };

  const renderFileChanges = () => {
    if (dedupedFileChanges.length === 0) return <Empty description="暂无文件变更" />;
    const list = dedupedFileChanges.slice(0, previewLimit);
    const hiddenCount = Math.max(dedupedFileChanges.length - list.length, 0);
    return (
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
        {hiddenCount > 0 ? <div className="ds-workbar-more">+{hiddenCount} 更多</div> : null}
      </div>
    );
  };

  const renderBody = () => {
    if (activeTab === TAB_KEYS.tasks) return renderTasks();
    if (activeTab === TAB_KEYS.files) return renderFileChanges();
    return renderTools();
  };

  return (
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
        <button type="button" className="ds-workbar-action" onClick={() => onToggleExpanded?.()}>
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      {expanded ? <div className="ds-workbar-body">{renderBody()}</div> : null}
    </div>
  );
}

export { TAB_KEYS as WORKBAR_TABS };

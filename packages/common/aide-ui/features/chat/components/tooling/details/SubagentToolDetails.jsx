import React, { useRef, useState } from 'react';
import { Collapse, Space, Tag, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';

import { MarkdownBlock } from '../../../../../components/MarkdownBlock.jsx';
import { formatDateTime } from '../../../../../lib/format.js';
import { dedupeFileChanges, getFileChangeKey } from '../../../../../lib/file-changes.js';
import { parseJsonSafe } from '../../../../../lib/parse.js';
import { ToolBlock, ToolJsonPreview, ToolList, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatJson, formatSummaryValue, normalizeText } from './detail-utils.js';
import { SubagentProcessPanel } from './SubagentProcessPanel.jsx';

const { Text } = Typography;

function formatElapsed(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function RawJsonSection({ title, label, text }) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  return (
    <ToolSection title={title}>
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'raw',
            label: label || '查看原始 JSON',
            children: <ToolBlock text={raw} />,
          },
        ]}
      />
    </ToolSection>
  );
}

function PopoverRawSection({ items = [] }) {
  const list = items.filter((item) => item && typeof item.text === 'string' && item.text.trim());
  if (list.length === 0) return null;
  const collapseItems = list.map((item) => ({
    key: item.key || item.label || 'raw',
    label: item.label,
    children: <ToolBlock text={item.text} />,
  }));
  return (
    <div className="ds-subagent-popover-raw">
      <div className="ds-subagent-popover-section-title">Raw data</div>
      <Collapse ghost size="small" items={collapseItems} className="ds-subagent-raw-collapse" />
    </div>
  );
}

function buildStepTitle(step) {
  const type = step?.type || 'notice';
  const tool = typeof step?.tool === 'string' ? step.tool : '';
  if (type === 'assistant') {
    const text = typeof step?.text === 'string' ? step.text : '';
    const reasoning = typeof step?.reasoning === 'string' ? step.reasoning : '';
    const summarySource = text || reasoning;
    if (summarySource) return formatSummaryValue(summarySource.replace(/\s+/g, ' '), 48);
    return 'AI';
  }
  if (type === 'tool_call') return tool ? `Call ${tool}` : 'Tool Call';
  if (type === 'tool_result') return tool ? `Result ${tool}` : 'Tool Result';
  return 'Notice';
}

function buildStepSummary(step) {
  const toolCallsText = step?.tool_calls
    ? step.tool_calls
        .map((call) => {
          const name = typeof call?.tool === 'string' ? call.tool : 'tool';
          const callId = typeof call?.call_id === 'string' ? call.call_id : '';
          return callId ? `${name} (${callId})` : name;
        })
        .join(', ')
    : '';
  const text = typeof step?.text === 'string' ? step.text : '';
  const reasoning = typeof step?.reasoning === 'string' ? step.reasoning : '';
  const argsText = typeof step?.args === 'string' ? step.args : '';
  const resultText = typeof step?.result === 'string' ? step.result : '';
  const notice = typeof step?.text === 'string' ? step.text : '';
  const summaryText = (text || reasoning || resultText || argsText || toolCallsText || notice || '').replace(/\s+/g, ' ');
  return summaryText;
}

function extractRunSubAgentResponse(payload, resultText) {
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'response')) {
    const response = payload.response;
    if (typeof response === 'string') return response.trim();
    if (Array.isArray(response)) {
      const joined = response
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry && typeof entry === 'object' && typeof entry.text === 'string') return entry.text;
          return '';
        })
        .join('');
      return joined.trim();
    }
    if (response && typeof response === 'object') return formatJson(response);
  }
  return typeof resultText === 'string' ? resultText.trim() : '';
}

function FileChangeTag({ changeType }) {
  if (changeType === 'created') return <Tag color="green">新增</Tag>;
  if (changeType === 'deleted') return <Tag color="red">删除</Tag>;
  return <Tag color="gold">修改</Tag>;
}

function parseTaskLines(resultText) {
  const lines = String(resultText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const tasks = [];
  lines.forEach((line) => {
    const match = line.match(/^\[([^\]/]+)\/([^\]]+)\]\s+(.+?)\s+\(id=([^\s,)]+)(?:, session=([^)]+))?\)(.*)$/);
    if (!match) return;
    const tagText = match[6] || '';
    const tags = tagText
      .split('#')
      .map((tag) => tag.trim())
      .filter(Boolean);
    tasks.push({
      status: match[1],
      priority: match[2],
      title: match[3],
      id: match[4],
      session: match[5] || '',
      tags,
    });
  });
  return tasks;
}

function normalizeTaskEntry(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const title = normalizeText(value);
    return title ? { title } : null;
  }
  if (typeof value !== 'object') return null;
  const title =
    normalizeText(value.title) ||
    normalizeText(value.name) ||
    normalizeText(value.task) ||
    normalizeText(value.summary);
  const id = normalizeText(value.id) || normalizeText(value.task_id) || normalizeText(value.taskId);
  const status = normalizeText(value.status);
  const priority = normalizeText(value.priority);
  const tags = Array.isArray(value.tags) ? value.tags.filter(Boolean) : [];
  const session = normalizeText(value.session) || normalizeText(value.sessionId);
  return title || id ? { title, id, status, priority, tags, session } : null;
}

function collectTasksFromObject(source, buckets) {
  if (!source || typeof source !== 'object') return;
  const addAll = (list = [], target) => {
    list.forEach((item) => {
      const normalized = normalizeTaskEntry(item);
      if (normalized) target.push(normalized);
    });
  };
  if (Array.isArray(source.created)) addAll(source.created, buckets.created);
  if (Array.isArray(source.deduped)) addAll(source.deduped, buckets.deduped);
  if (Array.isArray(source.tasks)) addAll(source.tasks, buckets.listed);
  if (Array.isArray(source.updated)) addAll(source.updated, buckets.updated);
  if (Array.isArray(source.removed)) addAll(source.removed, buckets.removed);
  if (source.task) {
    const normalized = normalizeTaskEntry(source.task);
    if (normalized) buckets.updated.push(normalized);
  }
}

function dedupeTasks(list = []) {
  const seen = new Set();
  return list.filter((task) => {
    const key = task?.id || task?.title;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSubagentTasks(payload, steps = []) {
  const buckets = {
    created: [],
    deduped: [],
    listed: [],
    updated: [],
    removed: [],
  };
  collectTasksFromObject(payload, buckets);
  collectTasksFromObject(payload?.response, buckets);
  collectTasksFromObject(payload?.result, buckets);
  collectTasksFromObject(payload?.output, buckets);
  collectTasksFromObject(payload?.data, buckets);
  const list = Array.isArray(steps) ? steps : [];
  list.forEach((step) => {
    if (step?.type !== 'tool_result') return;
    const toolName = normalizeText(step?.tool).toLowerCase();
    if (!toolName || !toolName.includes('task')) return;
    const resultText = typeof step?.result === 'string' ? step.result : '';
    const parsed = parseJsonSafe(resultText, null);
    if (parsed) {
      collectTasksFromObject(parsed, buckets);
      collectTasksFromObject(parsed?.data, buckets);
      collectTasksFromObject(parsed?.result, buckets);
      collectTasksFromObject(parsed?.output, buckets);
      return;
    }
    const parsedTasks = parseTaskLines(resultText);
    if (parsedTasks.length > 0) {
      const bucketKey =
        toolName.includes('add_task') || toolName.includes('create_task')
          ? 'created'
          : toolName.includes('update_task') || toolName.includes('set_task') || toolName.includes('complete_task')
            ? 'updated'
            : toolName.includes('remove_task') || toolName.includes('delete_task')
              ? 'removed'
              : toolName.includes('list_task') || toolName.includes('list_tasks')
                ? 'listed'
                : 'listed';
      parsedTasks.forEach((task) => {
        const normalized = normalizeTaskEntry(task);
        if (normalized) buckets[bucketKey].push(normalized);
      });
    }
  });
  buckets.created = dedupeTasks(buckets.created);
  buckets.deduped = dedupeTasks(buckets.deduped);
  buckets.listed = dedupeTasks(buckets.listed);
  buckets.updated = dedupeTasks(buckets.updated);
  buckets.removed = dedupeTasks(buckets.removed);
  return buckets;
}

function mapTaskStatusTone(status) {
  const value = normalizeText(status);
  if (value === 'blocked') return 'error';
  if (value === 'done') return 'ok';
  return '';
}

function buildTaskMeta(task, bucketLabel) {
  const status = normalizeText(task.status);
  const priority = normalizeText(task.priority);
  const tags = Array.isArray(task.tags) ? task.tags.filter(Boolean) : [];
  const items = [];
  if (bucketLabel) {
    const color =
      bucketLabel === 'created'
        ? 'green'
        : bucketLabel === 'deduped'
          ? 'blue'
          : bucketLabel === 'updated'
            ? 'gold'
            : bucketLabel === 'removed'
              ? 'red'
              : 'default';
    items.push(
      <Tag color={color} key={`bucket-${bucketLabel}`}>
        {bucketLabel}
      </Tag>
    );
  }
  if (status) {
    const color = status === 'done' ? 'green' : status === 'blocked' ? 'red' : status === 'doing' ? 'gold' : 'blue';
    items.push(
      <Tag color={color} key={`status-${status}`}>
        {status}
      </Tag>
    );
  }
  if (priority) {
    const color = priority === 'high' ? 'red' : priority === 'medium' ? 'orange' : 'blue';
    items.push(
      <Tag color={color} key={`priority-${priority}`}>
        {priority}
      </Tag>
    );
  }
  tags.forEach((tag) => {
    items.push(<Tag key={`tag-${tag}`}>#{tag}</Tag>);
  });
  if (items.length === 0) return null;
  return (
    <Space size={4} wrap>
      {items}
    </Space>
  );
}

function buildTaskItems(tasks = [], bucketLabel) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.map((task, idx) => ({
    key: task.id || `${bucketLabel || 'task'}-${idx}`,
    title: normalizeText(task.title) || normalizeText(task.id) || `task ${idx + 1}`,
    subtitle: task.id ? `id: ${task.id}` : task.session ? `session: ${task.session}` : '',
    meta: buildTaskMeta(task, bucketLabel),
    tone: mapTaskStatusTone(task.status),
  }));
}

function buildToolCallList(calls = []) {
  const list = Array.isArray(calls) ? calls : [];
  if (list.length === 0) return '';
  return list
    .map((call) => {
      const name = typeof call?.tool === 'string' ? call.tool : 'tool';
      const callId = typeof call?.call_id === 'string' ? call.call_id : '';
      return `- ${name}${callId ? ` (${callId})` : ''}`;
    })
    .join('\n');
}

function TimelineDetailBlock({ label, text, tone }) {
  if (!text) return null;
  return (
    <div className="ds-subagent-step-block">
      <div className="ds-subagent-step-label">{label}</div>
      <ToolBlock text={text} tone={tone} />
    </div>
  );
}

function buildTimelineDetailBlocks(step) {
  if (!step) return [];
  const toolCallsText = step?.tool_calls ? buildToolCallList(step.tool_calls) : '';
  const argsText = typeof step?.args === 'string' ? step.args : '';
  const resultText = typeof step?.result === 'string' ? step.result : '';
  const text = typeof step?.text === 'string' ? step.text : '';
  const reasoning = typeof step?.reasoning === 'string' ? step.reasoning : '';
  const notice = typeof step?.text === 'string' ? step.text : '';
  const blocks = [];
  if (step?.type === 'assistant') {
    blocks.push({ label: '输出', text });
    blocks.push({ label: '思考', text: reasoning, tone: 'warn' });
    blocks.push({ label: '工具调用', text: toolCallsText });
  } else if (step?.type === 'tool_call') {
    blocks.push({ label: '参数', text: argsText });
  } else if (step?.type === 'tool_result') {
    blocks.push({ label: '结果', text: resultText, tone: step?.is_error ? 'stderr' : undefined });
  } else if (step?.type === 'notice') {
    blocks.push({ label: '提示', text: notice });
  }
  return blocks.filter((block) => block.text);
}

export function SubagentToolDetails({
  toolName,
  argsRaw,
  argsParsed,
  resultText,
  structuredContent,
  liveSteps,
  fileChanges,
  display,
  callId,
  status,
  canCopyArgs,
  canCopyResult,
  canExpand,
  onCopyArgs,
  onCopyResult,
  onExpand,
  onClose,
}) {
  const summaryItems = [];
  const primaryItems = [];
  const secondaryItems = [];
  const parsedResult = parseJsonSafe(resultText, null);
  const payload =
    structuredContent && typeof structuredContent === 'object'
      ? structuredContent
      : parsedResult && typeof parsedResult === 'object'
        ? parsedResult
        : null;
  const toolNameText = normalizeText(toolName);
  const isRunSubAgent = toolNameText.toLowerCase().includes('run_sub_agent');
  const agentId = normalizeText(argsParsed?.agent_id) || normalizeText(payload?.agent_id);
  const category = normalizeText(argsParsed?.category);
  const task = normalizeText(argsParsed?.task);
  const skillsFromArgs = Array.isArray(argsParsed?.skills) ? argsParsed.skills.filter(Boolean) : [];
  const skillsFromPayload = Array.isArray(payload?.skills) ? payload.skills.filter(Boolean) : [];
  const skills = skillsFromArgs.length > 0 ? skillsFromArgs : skillsFromPayload;
  const agentName = normalizeText(payload?.agent_name);
  const plugin = normalizeText(payload?.plugin);
  const model = normalizeText(payload?.model);
  const commandName = normalizeText(payload?.command?.name || payload?.command?.id);
  const responseText = isRunSubAgent ? extractRunSubAgentResponse(payload, resultText) : '';
  const finalSteps = Array.isArray(payload?.steps) ? payload.steps : [];
  const liveStepList = Array.isArray(liveSteps) ? liveSteps : [];
  const effectiveSteps = finalSteps.length > 0 ? finalSteps : liveStepList;
  const isLiveSteps = finalSteps.length === 0 && liveStepList.length > 0;
  const stats = payload?.stats && typeof payload.stats === 'object' ? payload.stats : null;
  const errorText = normalizeText(payload?.error);
  const fallbackText = isRunSubAgent
    ? responseText
      ? ''
      : normalizeText(resultText)
    : payload
      ? formatJson(payload)
      : resultText;
  const rawArgsText = typeof argsRaw === 'string' ? argsRaw.trim() : '';
  const rawPayloadText = payload ? formatJson(payload) : '';
  const fileChangeItems = dedupeFileChanges(Array.isArray(fileChanges) ? fileChanges : []);
  const toolNames = Array.from(
    new Set(
      effectiveSteps
        .filter((step) => step?.type === 'tool_call' && typeof step?.tool === 'string')
        .map((step) => step.tool)
        .filter(Boolean)
    )
  );
  const taskBuckets = collectSubagentTasks(payload, effectiveSteps);
  const createdItems = buildTaskItems(taskBuckets.created, 'created');
  const dedupedItems = buildTaskItems(taskBuckets.deduped, 'deduped');
  const updatedItems = buildTaskItems(taskBuckets.updated, 'updated');
  const removedItems = buildTaskItems(taskBuckets.removed, 'removed');
  const listedItems = buildTaskItems(taskBuckets.listed, 'listed');
  const overriddenKeys = new Set([...updatedItems, ...removedItems].map((item) => item.key).filter(Boolean));
  const filteredCreated = createdItems.filter((item) => !overriddenKeys.has(item.key));
  const filteredDeduped = dedupedItems.filter((item) => !overriddenKeys.has(item.key));
  const primaryTaskItems = [...filteredCreated, ...filteredDeduped, ...updatedItems, ...removedItems];
  const taskItems = primaryTaskItems.length > 0 ? primaryTaskItems : listedItems;
  const uniqueTaskCount = dedupeTasks([
    ...taskBuckets.created,
    ...taskBuckets.deduped,
    ...taskBuckets.updated,
    ...taskBuckets.removed,
    ...taskBuckets.listed,
  ]).length;
  const [expandedStepKey, setExpandedStepKey] = useState(null);
  const [rawTab, setRawTab] = useState(() => (rawArgsText ? 'args' : rawPayloadText ? 'result' : 'args'));
  const rawSectionRef = useRef(null);
  const rawTabs = [
    { key: 'args', label: 'Args JSON', text: rawArgsText },
    { key: 'result', label: 'Result JSON', text: rawPayloadText },
  ].filter((item) => item.text);
  const activeRawKey = rawTabs.some((item) => item.key === rawTab) ? rawTab : rawTabs[0]?.key;
  const activeRaw = rawTabs.find((item) => item.key === activeRawKey);

  if (agentId) primaryItems.push({ label: 'agent', value: formatSummaryValue(agentId, 80) });
  if (skills.length > 0) primaryItems.push({ label: 'skills', value: formatSummaryValue(skills.join(', '), 120) });
  if (task) primaryItems.push({ label: 'task', value: formatSummaryValue(task, 140) });

  if (agentName) secondaryItems.push({ label: 'agent_name', value: formatSummaryValue(agentName, 80) });
  if (category) secondaryItems.push({ label: 'category', value: formatSummaryValue(category, 80) });
  if (plugin) secondaryItems.push({ label: 'plugin', value: formatSummaryValue(plugin, 80) });
  if (model) secondaryItems.push({ label: 'model', value: formatSummaryValue(model, 80) });
  if (commandName) secondaryItems.push({ label: 'command', value: formatSummaryValue(commandName, 80) });
  if (stats?.elapsed_ms) secondaryItems.push({ label: 'elapsed', value: formatElapsed(stats.elapsed_ms) });
  if (stats?.tool_calls) secondaryItems.push({ label: 'tools', value: String(stats.tool_calls) });
  if (effectiveSteps.length > 0) secondaryItems.push({ label: 'steps', value: String(effectiveSteps.length) });
  if (uniqueTaskCount > 0) secondaryItems.push({ label: 'tasks', value: String(uniqueTaskCount) });
  if (toolNames.length > 0) {
    secondaryItems.push({ label: 'tools_used', value: formatSummaryValue(toolNames.join(', '), 160) });
  }

  summaryItems.push(...primaryItems, ...secondaryItems);

  const statusLabels = {
    ok: 'Completed',
    pending: 'Running',
    error: 'Failed',
    canceled: 'Canceled',
    timeout: 'Timeout',
    partial: 'Partial',
  };
  const statusLabel = statusLabels[status] || (status ? status.toUpperCase() : 'Running');
  const liveLabel = isLiveSteps ? 'Live' : '';
  const metaCards = [
    { label: 'Agent', value: agentId || agentName },
    { label: 'Skills', value: skills.length > 0 ? skills.join(', ') : '' },
    { label: 'Model', value: model },
    { label: 'Command', value: commandName },
  ].filter((item) => item.value);
  const statsItems = [
    stats?.elapsed_ms ? { label: 'elapsed', value: formatElapsed(stats.elapsed_ms) } : null,
    stats?.tool_calls ? { label: 'tools', value: String(stats.tool_calls) } : null,
    effectiveSteps.length > 0 ? { label: 'steps', value: String(effectiveSteps.length) } : null,
    uniqueTaskCount > 0 ? { label: 'tasks', value: String(uniqueTaskCount) } : null,
  ].filter(Boolean);
  const previewSource = responseText || fallbackText;
  const previewText = previewSource ? formatSummaryValue(previewSource.replace(/\s+/g, ' '), 220) : '';
  const headerSubtitle = [callId, agentName || agentId, model].filter(Boolean).join(' - ').trim();
  const timelineSteps = (effectiveSteps || []).map((step, index) => {
    const title = buildStepTitle(step);
    const summaryText = buildStepSummary(step);
    const summary = summaryText ? formatSummaryValue(summaryText, 120) : '';
    const elapsed = formatElapsed(step?.elapsed_ms);
    const callId = typeof step?.call_id === 'string' ? step.call_id : '';
    const typeLabel =
      step?.type === 'assistant'
        ? 'AI'
        : step?.type === 'tool_call'
          ? 'Tool Call'
          : step?.type === 'tool_result'
            ? 'Tool Result'
            : 'Notice';
    const isError = Boolean(step?.is_error);
    const isTruncated = Boolean(
      step?.text_truncated || step?.reasoning_truncated || step?.args_truncated || step?.result_truncated
    );
    return {
      key: step?.ts || `${step?.type || 'step'}-${index}`,
      rawStep: step,
      index,
      title,
      summary,
      elapsed,
      callId,
      typeLabel,
      isError,
      isTruncated,
    };
  });

  if (isRunSubAgent && display === 'popover') {

    return (
      <div className="ds-subagent-popover">
        <div className="ds-subagent-popover-header">
          <div className="ds-subagent-popover-header-main">
            <span className="ds-subagent-popover-icon">
              <RobotOutlined />
            </span>
            <div className="ds-subagent-popover-title">
              <div className="ds-subagent-popover-title-text">{toolNameText || 'run_sub_agent'}</div>
              {headerSubtitle ? <div className="ds-subagent-popover-subtitle">{headerSubtitle}</div> : null}
            </div>
          </div>
          <div className="ds-subagent-popover-header-meta">
            <div className="ds-subagent-popover-chips">
              <span className="ds-subagent-header-chip">Agent</span>
              <span className="ds-subagent-header-chip" data-status={status}>
                {statusLabel}
              </span>
              {liveLabel ? <span className="ds-subagent-header-chip">{liveLabel}</span> : null}
            </div>
            <div className="ds-subagent-popover-actions">
              {canCopyArgs ? (
                <button type="button" className="ds-subagent-header-btn" onClick={onCopyArgs}>
                  Args
                </button>
              ) : null}
              {canCopyResult ? (
                <button type="button" className="ds-subagent-header-btn" onClick={onCopyResult}>
                  Result
                </button>
              ) : null}
              {canExpand ? (
                <button type="button" className="ds-subagent-header-btn" onClick={onExpand}>
                  Expand
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="ds-subagent-popover-body">
          <div className="ds-subagent-popover-column is-left">
            <div className="ds-subagent-popover-section">
              <div className="ds-subagent-popover-section-title">Summary</div>
              <div className="ds-subagent-meta-stack">
                {metaCards.map((item) => (
                  <div key={item.label} className="ds-subagent-meta-card">
                    <div className="ds-subagent-meta-label">{item.label}</div>
                    <div className="ds-subagent-meta-value">{formatSummaryValue(item.value, 120)}</div>
                  </div>
                ))}
              </div>
            </div>
            {task ? (
              <div className="ds-subagent-popover-section">
                <div className="ds-subagent-popover-section-title">Task</div>
                <div className="ds-subagent-meta-card">
                  <div className="ds-subagent-meta-value">{formatSummaryValue(task, 160)}</div>
                </div>
              </div>
            ) : null}
            {statsItems.length > 0 ? (
              <div className="ds-subagent-popover-section">
                <div className="ds-subagent-popover-section-title">Stats</div>
                <div className="ds-subagent-stats">
                  {statsItems.map((item) => (
                    <div key={item.label} className="ds-subagent-stat-card">
                      <div className="ds-subagent-stat-value">{item.value}</div>
                      <div className="ds-subagent-stat-label">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="ds-subagent-popover-column is-right">
            <div className="ds-subagent-popover-section">
              <div className="ds-subagent-popover-section-title">Process timeline</div>
              <div className="ds-subagent-timeline-scroll">
                {timelineSteps.length > 0 ? (
                  <div className="ds-subagent-timeline">
                  {timelineSteps.map((step, idx) => {
                    const detailBlocks = buildTimelineDetailBlocks(step.rawStep);
                    const hasDetails = detailBlocks.length > 0;
                    const isExpanded = expandedStepKey === step.key;
                    return (
                      <div
                        key={step.key}
                        className={[
                          'ds-subagent-timeline-item',
                          step.isError ? 'is-error' : '',
                          step.isTruncated ? 'is-truncated' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <div className="ds-subagent-timeline-track">
                          <span className="ds-subagent-timeline-dot" />
                          {idx < timelineSteps.length - 1 ? <span className="ds-subagent-timeline-line" /> : null}
                        </div>
                        <div className="ds-subagent-timeline-card">
                          <div className="ds-subagent-timeline-header">
                            <span className="ds-subagent-timeline-index">{step.index + 1}.</span>
                            <span className="ds-subagent-timeline-title">{step.title}</span>
                            <span className="ds-subagent-timeline-chip">{step.typeLabel}</span>
                            {step.callId ? <span className="ds-subagent-timeline-call">#{step.callId}</span> : null}
                            {step.elapsed ? <span className="ds-subagent-timeline-time">{step.elapsed}</span> : null}
                            {hasDetails ? (
                              <button
                                type="button"
                                className="ds-subagent-timeline-toggle"
                                data-align={step.elapsed ? undefined : 'right'}
                                onClick={() => setExpandedStepKey(isExpanded ? null : step.key)}
                              >
                                {isExpanded ? '收起' : '详情'}
                              </button>
                            ) : null}
                          </div>
                          {step.summary ? <div className="ds-subagent-timeline-summary">{step.summary}</div> : null}
                          {isExpanded && hasDetails ? (
                            <div className="ds-subagent-timeline-details">
                              {detailBlocks.map((block) => (
                                <TimelineDetailBlock
                                  key={block.label}
                                  label={block.label}
                                  text={block.text}
                                  tone={block.tone}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                ) : (
                  <Text type="secondary">No timeline</Text>
                )}
              </div>
            </div>
            {taskItems.length > 0 ? (
              <div className="ds-subagent-popover-section">
                <div className="ds-subagent-popover-section-title">Tasks</div>
                <ToolList items={taskItems} />
              </div>
            ) : null}
            <div className="ds-subagent-popover-section">
              <div className="ds-subagent-popover-section-title">Result preview</div>
              {previewText ? <div className="ds-subagent-preview">{previewText}</div> : <Text type="secondary">No preview</Text>}
            </div>
            {errorText ? (
              <div className="ds-subagent-popover-section">
                <div className="ds-subagent-popover-section-title">Error</div>
                <ToolBlock text={errorText} tone="stderr" />
              </div>
            ) : null}
            <PopoverRawSection
              items={[
                { key: 'args', label: 'Args JSON', text: rawArgsText },
                { key: 'result', label: 'Result JSON', text: rawPayloadText },
              ]}
            />
          </div>
        </div>
      </div>
    );
  }

  if (isRunSubAgent && display === 'drawer') {
    const keyNotes = [
      agentId ? `Agent: ${agentId}` : agentName ? `Agent: ${agentName}` : '',
      task ? `Task: ${formatSummaryValue(task, 120)}` : '',
      toolNames.length > 0 ? `Tools: ${formatSummaryValue(toolNames.join(', '), 140)}` : '',
      stats?.elapsed_ms ? `Elapsed: ${formatElapsed(stats.elapsed_ms)}` : '',
    ].filter(Boolean);
    const outputText = responseText || fallbackText;
    const outputPreview = outputText ? formatSummaryValue(outputText.replace(/\s+/g, ' '), 360) : '';
    const summaryMarkdown = outputText;
    const fileChangePanels = fileChangeItems.map((item, idx) => {
      const key = getFileChangeKey(item) || item?.ts || `change_${idx}`;
      const pathLabel = item?.path || item?.absolutePath || '未知文件';
      const timeText = item?.ts ? formatDateTime(item.ts) : '';
      const toolTag = item?.tool ? <Tag color="purple">tool: {item.tool}</Tag> : null;
      const modeTag = item?.mode ? <Tag color="geekblue">{item.mode}</Tag> : null;
      const serverTag = item?.server ? <Tag color="cyan">{item.server}</Tag> : null;
      return {
        key,
        label: (
          <Space size={6} wrap>
            <FileChangeTag changeType={item?.changeType} />
            <span>{pathLabel}</span>
            {toolTag}
            {modeTag}
            {serverTag}
          </Space>
        ),
        children: (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {timeText ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {timeText}
              </Text>
            ) : null}
            {item?.workspaceRoot ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                workspace: {item.workspaceRoot}
              </Text>
            ) : null}
            <ToolBlock text={item?.diff || '无 diff 内容'} />
          </Space>
        ),
      };
    });
    const timelineSubtitle = isLiveSteps ? 'Timeline view for live steps.' : 'Timeline view for completed steps.';
    const rawTabLabel = activeRaw?.label || '';
    const timelineScrollClass = 'ds-subagent-timeline-scroll is-fullscreen';

    return (
      <div className="ds-subagent-fullscreen">
        <div className="ds-subagent-fullscreen-header">
          <div className="ds-subagent-fullscreen-header-main">
            <span className="ds-subagent-fullscreen-icon">
              <RobotOutlined />
            </span>
            <div className="ds-subagent-fullscreen-title">
              <div className="ds-subagent-fullscreen-title-text">{toolNameText || 'run_sub_agent'}</div>
              {headerSubtitle ? <div className="ds-subagent-fullscreen-subtitle">{headerSubtitle}</div> : null}
            </div>
            <div className="ds-subagent-fullscreen-chips">
              <span className="ds-subagent-header-chip">Agent</span>
              <span className="ds-subagent-header-chip" data-status={status}>
                {statusLabel}
              </span>
              {liveLabel ? <span className="ds-subagent-header-chip">{liveLabel}</span> : null}
            </div>
          </div>
          <div className="ds-subagent-fullscreen-actions">
            {onClose ? (
              <button type="button" className="ds-subagent-fullscreen-action-btn" onClick={onClose}>
                Cancel
              </button>
            ) : null}
            {canCopyResult ? (
              <button type="button" className="ds-subagent-fullscreen-action-btn" onClick={onCopyResult}>
                Copy
              </button>
            ) : null}
            {rawTabs.length > 0 ? (
              <button
                type="button"
                className="ds-subagent-fullscreen-action-btn"
                onClick={() => rawSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Raw
              </button>
            ) : null}
          </div>
        </div>
        <div className="ds-subagent-fullscreen-body">
          <div className="ds-subagent-fullscreen-panel is-left">
            <div className="ds-subagent-fullscreen-panel-head">
              <div className="ds-subagent-fullscreen-panel-title">Process timeline</div>
              <div className="ds-subagent-fullscreen-panel-subtitle">{timelineSubtitle}</div>
            </div>
            {timelineSteps.length > 0 ? (
              <div className={timelineScrollClass}>
                <div className="ds-subagent-timeline">
                  {timelineSteps.map((step, idx) => {
                    const detailBlocks = buildTimelineDetailBlocks(step.rawStep);
                    const hasDetails = detailBlocks.length > 0;
                    const isExpanded = expandedStepKey === step.key;
                    return (
                      <div
                        key={step.key}
                        className={[
                          'ds-subagent-timeline-item',
                          step.isError ? 'is-error' : '',
                          step.isTruncated ? 'is-truncated' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <div className="ds-subagent-timeline-track">
                          <span className="ds-subagent-timeline-dot" />
                          {idx < timelineSteps.length - 1 ? <span className="ds-subagent-timeline-line" /> : null}
                        </div>
                        <div className="ds-subagent-timeline-card">
                          <div className="ds-subagent-timeline-header">
                            <span className="ds-subagent-timeline-index">{step.index + 1}.</span>
                            <span className="ds-subagent-timeline-title">{step.title}</span>
                            <span className="ds-subagent-timeline-chip">{step.typeLabel}</span>
                            {step.callId ? <span className="ds-subagent-timeline-call">#{step.callId}</span> : null}
                            {step.elapsed ? <span className="ds-subagent-timeline-time">{step.elapsed}</span> : null}
                            {hasDetails ? (
                              <button
                                type="button"
                                className="ds-subagent-timeline-toggle"
                                data-align={step.elapsed ? undefined : 'right'}
                                onClick={() => setExpandedStepKey(isExpanded ? null : step.key)}
                              >
                                {isExpanded ? '收起' : '详情'}
                              </button>
                            ) : null}
                          </div>
                          {step.summary ? <div className="ds-subagent-timeline-summary">{step.summary}</div> : null}
                          {isExpanded && hasDetails ? (
                            <div className="ds-subagent-timeline-details">
                              {detailBlocks.map((block) => (
                                <TimelineDetailBlock
                                  key={block.label}
                                  label={block.label}
                                  text={block.text}
                                  tone={block.tone}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <Text type="secondary">No timeline</Text>
            )}
            {keyNotes.length > 0 ? (
              <div className="ds-subagent-fullscreen-card">
                <div className="ds-subagent-fullscreen-card-title">Key notes</div>
                <div className="ds-subagent-fullscreen-notes">
                  {keyNotes.map((note, idx) => (
                    <div key={`${note}-${idx}`} className="ds-subagent-fullscreen-note">
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {outputPreview ? (
              <div className="ds-subagent-fullscreen-card">
                <div className="ds-subagent-fullscreen-card-title">Output preview</div>
                <div className="ds-subagent-fullscreen-preview">{outputPreview}</div>
              </div>
            ) : null}
          </div>
          <div className="ds-subagent-fullscreen-panel is-right">
            <div className="ds-subagent-fullscreen-panel-head">
              <div className="ds-subagent-fullscreen-panel-title">Result</div>
              <div className="ds-subagent-fullscreen-panel-subtitle">Final output and key metadata.</div>
            </div>
            {summaryMarkdown ? (
              <div className="ds-subagent-fullscreen-section">
                <div className="ds-subagent-fullscreen-section-title">Summary</div>
                <MarkdownBlock text={summaryMarkdown} alwaysExpanded container={false} copyable />
              </div>
            ) : null}
            {task ? (
              <div className="ds-subagent-fullscreen-section">
                <div className="ds-subagent-fullscreen-section-title">Task</div>
                <div className="ds-subagent-meta-card">
                  <div className="ds-subagent-meta-value">{formatSummaryValue(task, 200)}</div>
                </div>
              </div>
            ) : null}
            {taskItems.length > 0 ? (
              <div className="ds-subagent-fullscreen-section">
                <div className="ds-subagent-fullscreen-section-title">Tasks</div>
                <ToolList items={taskItems} />
              </div>
            ) : null}
            {fileChangePanels.length > 0 ? (
              <div className="ds-subagent-fullscreen-section">
                <div className="ds-subagent-fullscreen-section-title">文件变更</div>
                <Collapse ghost size="small" items={fileChangePanels} />
              </div>
            ) : null}
            {statsItems.length > 0 ? (
              <div className="ds-subagent-fullscreen-section">
                <div className="ds-subagent-fullscreen-section-title">Metrics</div>
                <div className="ds-subagent-stats">
                  {statsItems.map((item) => (
                    <div key={item.label} className="ds-subagent-stat-card">
                      <div className="ds-subagent-stat-value">{item.value}</div>
                      <div className="ds-subagent-stat-label">{item.label}</div>
                    </div>
                  ))}
                </div>
                {(model || skills.length > 0) && (
                  <div className="ds-subagent-fullscreen-meta-grid">
                    {model ? (
                      <div className="ds-subagent-fullscreen-meta-row">
                        <div className="ds-subagent-fullscreen-meta-label">Model</div>
                        <div className="ds-subagent-fullscreen-meta-value">{model}</div>
                      </div>
                    ) : null}
                    {skills.length > 0 ? (
                      <div className="ds-subagent-fullscreen-meta-row">
                        <div className="ds-subagent-fullscreen-meta-label">Skills</div>
                        <div className="ds-subagent-fullscreen-meta-value">{skills.join(', ')}</div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
            {metaCards.length > 0 ? (
              <div className="ds-subagent-fullscreen-section">
                <div className="ds-subagent-fullscreen-section-title">Metadata</div>
                <div className="ds-subagent-meta-stack">
                  {metaCards.map((item) => (
                    <div key={item.label} className="ds-subagent-meta-card">
                      <div className="ds-subagent-meta-label">{item.label}</div>
                      <div className="ds-subagent-meta-value">{formatSummaryValue(item.value, 120)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {errorText ? (
              <div className="ds-subagent-fullscreen-section">
                <div className="ds-subagent-fullscreen-section-title">Error</div>
                <ToolBlock text={errorText} tone="stderr" />
              </div>
            ) : null}
            {rawTabs.length > 0 ? (
              <div className="ds-subagent-fullscreen-section" ref={rawSectionRef}>
                <div className="ds-subagent-fullscreen-section-title">Raw data</div>
                <div className="ds-subagent-fullscreen-raw-tabs">
                  {rawTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className="ds-subagent-fullscreen-raw-tab"
                      data-active={tab.key === activeRawKey}
                      onClick={() => setRawTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="ds-subagent-fullscreen-raw-panel" aria-label={rawTabLabel}>
                  <ToolBlock text={activeRaw?.text || ''} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {summaryItems.length > 0 ? (
        <ToolSection title="摘要">
          <ToolSummary items={summaryItems} variant={isRunSubAgent ? 'subagent' : undefined} />
        </ToolSection>
      ) : null}
      {!isRunSubAgent && argsRaw ? (
        <ToolSection title="参数">
          <ToolJsonPreview text={argsRaw} />
        </ToolSection>
      ) : null}
      {isRunSubAgent ? (
        <>
          <RawJsonSection title="原始参数" label="查看原始参数" text={rawArgsText} />
          <RawJsonSection title="原始结果" label="查看原始结果" text={rawPayloadText} />
        </>
      ) : null}
      {effectiveSteps.length > 0 || isRunSubAgent ? (
        <ToolSection title={isLiveSteps ? '过程（实时）' : '过程'}>
          <SubagentProcessPanel steps={effectiveSteps} />
        </ToolSection>
      ) : null}
      {errorText ? (
        <ToolSection title="错误">
          <ToolBlock text={errorText} tone="stderr" />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        {responseText ? (
          <MarkdownBlock text={responseText} maxHeight={320} container={false} copyable />
        ) : (
          <ToolJsonPreview text={fallbackText} emptyText="（暂无结果）" />
        )}
      </ToolSection>
    </>
  );
}

import React from 'react';
import { Space, Tag, Typography } from 'antd';

import { ToolJsonPreview, ToolList, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatJson, formatSummaryValue, normalizeText } from './detail-utils.js';

const { Text } = Typography;

function countTasks(argsParsed) {
  if (!argsParsed || typeof argsParsed !== 'object') return 0;
  if (Array.isArray(argsParsed.tasks)) return argsParsed.tasks.length;
  return 0;
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

function mapStatusTone(status) {
  const value = normalizeText(status);
  if (value === 'blocked') return 'error';
  if (value === 'done') return 'ok';
  return '';
}

function buildTaskMeta(task) {
  const status = normalizeText(task.status);
  const priority = normalizeText(task.priority);
  const tags = Array.isArray(task.tags) ? task.tags.filter(Boolean) : [];
  const items = [];
  if (status) {
    const color = status === 'done' ? 'green' : status === 'blocked' ? 'red' : status === 'doing' ? 'gold' : 'blue';
    items.push(<Tag color={color} key={`status-${status}`}>{status}</Tag>);
  }
  if (priority) {
    const color = priority === 'high' ? 'red' : priority === 'medium' ? 'orange' : 'blue';
    items.push(<Tag color={color} key={`priority-${priority}`}>{priority}</Tag>);
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

export function TaskToolDetails({ toolName, argsRaw, argsParsed, resultText, structuredContent }) {
  const summaryItems = [];
  const title = normalizeText(argsParsed?.title);
  const status = normalizeText(argsParsed?.status);
  const priority = normalizeText(argsParsed?.priority);
  const tag = normalizeText(argsParsed?.tag);
  const tags = Array.isArray(argsParsed?.tags) ? argsParsed.tags.filter(Boolean) : [];
  const caller = normalizeText(structuredContent?.caller);
  const taskCount = countTasks(argsParsed);
  const created = Array.isArray(structuredContent?.created) ? structuredContent.created : [];
  const deduped = Array.isArray(structuredContent?.deduped) ? structuredContent.deduped : [];
  const totalCount = taskCount || created.length + deduped.length;

  if (title) summaryItems.push({ label: 'title', value: formatSummaryValue(title, 120) });
  if (totalCount) summaryItems.push({ label: 'count', value: String(totalCount) });
  if (status) summaryItems.push({ label: 'status', value: status });
  if (priority) summaryItems.push({ label: 'priority', value: priority });
  if (tag) summaryItems.push({ label: 'tag', value: tag });
  if (tags.length > 0) summaryItems.push({ label: 'tags', value: formatSummaryValue(tags.join(', '), 120) });
  if (caller) summaryItems.push({ label: 'caller', value: caller });
  if (toolName) summaryItems.push({ label: 'tool', value: formatSummaryValue(toolName, 80) });

  const changesText = structuredContent?.user_changes ? formatJson(structuredContent.user_changes) : '';
  const remark = normalizeText(structuredContent?.remark);
  const parsedTasks = parseTaskLines(resultText);

  const createdItems = created.map((task, idx) => ({
    key: task.id || `${idx}-created`,
    title: normalizeText(task.title) || normalizeText(task.id) || `task ${idx + 1}`,
    subtitle: task.id ? `id: ${task.id}` : '',
    meta: buildTaskMeta(task),
    tone: mapStatusTone(task.status),
  }));
  const dedupedItems = deduped.map((task, idx) => ({
    key: task.id || `${idx}-deduped`,
    title: normalizeText(task.title) || normalizeText(task.id) || `task ${idx + 1}`,
    subtitle: task.id ? `id: ${task.id}` : '',
    meta: buildTaskMeta(task),
    tone: mapStatusTone(task.status),
  }));
  const parsedItems = parsedTasks.map((task, idx) => ({
    key: task.id || `${idx}-parsed`,
    title: normalizeText(task.title) || normalizeText(task.id) || `task ${idx + 1}`,
    subtitle: task.session ? `session: ${task.session}` : '',
    meta: buildTaskMeta(task),
    tone: mapStatusTone(task.status),
  }));

  return (
    <>
      {summaryItems.length > 0 ? (
        <ToolSection title="摘要">
          <ToolSummary items={summaryItems} />
        </ToolSection>
      ) : null}
      {argsRaw ? (
        <ToolSection title="参数">
          <ToolJsonPreview text={argsRaw} />
        </ToolSection>
      ) : null}
      {createdItems.length > 0 ? (
        <ToolSection title="新建任务">
          <ToolList items={createdItems} />
        </ToolSection>
      ) : null}
      {dedupedItems.length > 0 ? (
        <ToolSection title="去重任务">
          <ToolList items={dedupedItems} />
        </ToolSection>
      ) : null}
      {createdItems.length === 0 && dedupedItems.length === 0 && parsedItems.length > 0 ? (
        <ToolSection title="任务列表">
          <ToolList items={parsedItems} />
        </ToolSection>
      ) : null}
      {changesText ? (
        <ToolSection title="变更">
          <ToolJsonPreview value={structuredContent?.user_changes} text={changesText} />
        </ToolSection>
      ) : null}
      {remark ? (
        <ToolSection title="备注">
          <ToolJsonPreview text={remark} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        <ToolJsonPreview text={resultText} emptyText="（暂无结果）" />
      </ToolSection>
    </>
  );
}

import React from 'react';
import { Typography } from 'antd';

import { ToolBlock, ToolJsonPreview, ToolList, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatJson, formatListLines, formatSummaryValue, normalizeText } from './detail-utils.js';

const { Text } = Typography;

function formatLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const title = normalizeText(entry.title);
  const ts = normalizeText(entry.ts);
  const tagText = Array.isArray(entry.tags) ? entry.tags.filter(Boolean).join(', ') : '';
  const suffix = [ts, tagText].filter(Boolean).join(' · ');
  return suffix ? `${title || 'log'} (${suffix})` : title || 'log';
}

function isPrimitiveValue(value) {
  return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
}

function buildKeyValueItems(value, { limit = 12 } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const entries = Object.entries(value).filter(([key]) => key && key !== '__proto__');
  const items = entries.slice(0, limit).map(([key, val]) => {
    const item = { key, title: key, subtitle: '', meta: '' };
    if (isPrimitiveValue(val)) {
      item.meta = formatSummaryValue(val, 120);
      return item;
    }
    if (Array.isArray(val)) {
      item.meta = `${val.length} 项`;
      return item;
    }
    if (val && typeof val === 'object') {
      const label = normalizeText(val?.title || val?.name || val?.label || val?.path || val?.id);
      if (label) item.subtitle = formatSummaryValue(label, 120);
      const keys = Object.keys(val).length;
      item.meta = `对象(${keys})`;
      return item;
    }
    item.meta = formatSummaryValue(val, 120);
    return item;
  });
  if (entries.length > limit) {
    items.push({ key: 'more', title: `... (${entries.length - limit} more)` });
  }
  return items;
}

function buildLogItems(logs, { limit = 12 } = {}) {
  const list = Array.isArray(logs) ? logs.filter(Boolean) : [];
  const items = list.slice(0, limit).map((entry, idx) => {
    const title = formatLogEntry(entry);
    const subtitle = normalizeText(entry?.summary || entry?.details || entry?.message);
    const meta = normalizeText(entry?.status || entry?.level || entry?.type);
    return {
      key: entry?.id || `${title}-${idx}`,
      title,
      subtitle,
      meta,
    };
  });
  if (list.length > limit) {
    items.push({ key: 'more', title: `... (${list.length - limit} more)` });
  }
  return items;
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function JournalToolDetails({ argsRaw, argsParsed, resultText, structuredContent, toolName }) {
  const toolNameText = typeof toolName === 'string' ? toolName.toLowerCase() : '';
  const isProjectInfo = toolNameText.includes('mcp_project_journal_get_project_info');
  const isExecLogs = toolNameText.includes('mcp_project_journal_list_exec_logs');
  const isPretty = isProjectInfo || isExecLogs;

  const summaryItems = [];
  const title = normalizeText(argsParsed?.title);
  const tag = normalizeText(argsParsed?.tag);
  const query = normalizeText(argsParsed?.query);
  const limit = argsParsed?.limit;
  const entry = structuredContent?.entry && typeof structuredContent.entry === 'object' ? structuredContent.entry : null;
  const logs = Array.isArray(structuredContent?.logs) ? structuredContent.logs : [];

  if (title) summaryItems.push({ label: 'title', value: formatSummaryValue(title, 120) });
  if (tag) summaryItems.push({ label: 'tag', value: formatSummaryValue(tag, 80) });
  if (query) summaryItems.push({ label: 'query', value: formatSummaryValue(query, 120) });
  if (limit !== undefined) summaryItems.push({ label: 'limit', value: formatSummaryValue(limit, 80) });
  if (entry?.title) summaryItems.push({ label: 'entry', value: formatSummaryValue(entry.title, 120) });
  if (entry?.ts) summaryItems.push({ label: 'ts', value: formatSummaryValue(entry.ts, 120) });
  if (Array.isArray(entry?.files)) summaryItems.push({ label: 'files', value: String(entry.files.length) });
  if (Array.isArray(entry?.highlights)) summaryItems.push({ label: 'highlights', value: String(entry.highlights.length) });
  if (Array.isArray(entry?.nextSteps)) summaryItems.push({ label: 'next', value: String(entry.nextSteps.length) });
  if (logs.length > 0) summaryItems.push({ label: 'logs', value: String(logs.length) });

  const entrySummaryText = entry
    ? [normalizeText(entry.summary), normalizeText(entry.details)].filter(Boolean).join('\n\n')
    : '';
  const filesText = formatListLines(entry?.files);
  const highlightsText = formatListLines(entry?.highlights);
  const nextStepsText = formatListLines(entry?.nextSteps);
  const logListText = formatListLines(logs, { formatter: formatLogEntry });
  const structuredText = entry ? formatJson(entry) : '';

  if (isPretty) {
    const projectInfo =
      structuredContent?.project ||
      structuredContent?.info ||
      structuredContent?.data ||
      (structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
        ? structuredContent
        : null);
    const statsInfo = structuredContent?.stats || structuredContent?.summary || structuredContent?.meta || null;
    const logEntries = Array.isArray(structuredContent?.logs)
      ? structuredContent.logs
      : Array.isArray(structuredContent?.entries)
        ? structuredContent.entries
        : Array.isArray(structuredContent?.recentLogs)
          ? structuredContent.recentLogs
          : Array.isArray(structuredContent)
            ? structuredContent
            : [];

    const projectItems = buildKeyValueItems(projectInfo);
    const statsItems = buildKeyValueItems(statsInfo);
    const logItems = buildLogItems(logEntries);
    const parsedResult = parseJsonSafe(resultText);
    const showRawResult = resultText && !parsedResult;

    return (
      <>
        {summaryItems.length > 0 ? (
          <ToolSection title="摘要">
            <ToolSummary items={summaryItems} />
          </ToolSection>
        ) : null}
        {isProjectInfo && projectItems.length > 0 ? (
          <ToolSection title="项目">
            <ToolList items={projectItems} />
          </ToolSection>
        ) : null}
        {isProjectInfo && statsItems.length > 0 ? (
          <ToolSection title="统计">
            <ToolList items={statsItems} />
          </ToolSection>
        ) : null}
        {logItems.length > 0 ? (
          <ToolSection title="记录">
            <ToolList items={logItems} />
          </ToolSection>
        ) : null}
        {!logItems.length && !projectItems.length && !statsItems.length ? (
          <ToolSection title="结果">
            {showRawResult ? <ToolBlock text={resultText} /> : <Text type="secondary">（暂无结构化结果）</Text>}
          </ToolSection>
        ) : null}
      </>
    );
  }

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
      {entrySummaryText ? (
        <ToolSection title="内容">
          <ToolJsonPreview text={entrySummaryText} />
        </ToolSection>
      ) : null}
      {filesText ? (
        <ToolSection title="文件">
          <ToolJsonPreview text={filesText} />
        </ToolSection>
      ) : null}
      {highlightsText ? (
        <ToolSection title="亮点">
          <ToolJsonPreview text={highlightsText} />
        </ToolSection>
      ) : null}
      {nextStepsText ? (
        <ToolSection title="下一步">
          <ToolJsonPreview text={nextStepsText} />
        </ToolSection>
      ) : null}
      {logListText ? (
        <ToolSection title="记录">
          <ToolJsonPreview text={logListText} />
        </ToolSection>
      ) : null}
      {structuredText && !entrySummaryText ? (
        <ToolSection title="结构化">
          <ToolJsonPreview value={entry} text={structuredText} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        <ToolJsonPreview text={resultText} emptyText="（暂无结果）" />
      </ToolSection>
    </>
  );
}

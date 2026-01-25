import React from 'react';
import { Typography } from 'antd';

import { ToolBlock, ToolSection, ToolSummary } from '../ToolPanels.jsx';
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

export function JournalToolDetails({ argsRaw, argsParsed, resultText, structuredContent }) {
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

  return (
    <>
      {summaryItems.length > 0 ? (
        <ToolSection title="摘要">
          <ToolSummary items={summaryItems} />
        </ToolSection>
      ) : null}
      {argsRaw ? (
        <ToolSection title="参数">
          <ToolBlock text={argsRaw} />
        </ToolSection>
      ) : null}
      {entrySummaryText ? (
        <ToolSection title="内容">
          <ToolBlock text={entrySummaryText} />
        </ToolSection>
      ) : null}
      {filesText ? (
        <ToolSection title="文件">
          <ToolBlock text={filesText} />
        </ToolSection>
      ) : null}
      {highlightsText ? (
        <ToolSection title="亮点">
          <ToolBlock text={highlightsText} />
        </ToolSection>
      ) : null}
      {nextStepsText ? (
        <ToolSection title="下一步">
          <ToolBlock text={nextStepsText} />
        </ToolSection>
      ) : null}
      {logListText ? (
        <ToolSection title="记录">
          <ToolBlock text={logListText} />
        </ToolSection>
      ) : null}
      {structuredText && !entrySummaryText ? (
        <ToolSection title="结构化">
          <ToolBlock text={structuredText} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        {resultText ? <ToolBlock text={resultText} /> : <Text type="secondary">（暂无结果）</Text>}
      </ToolSection>
    </>
  );
}

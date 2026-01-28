import React from 'react';
import { Typography } from 'antd';

import { ToolJsonPreview, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatSummaryValue, normalizeText } from './detail-utils.js';

const { Text } = Typography;

export function CodeMaintainerToolDetails({ argsRaw, argsParsed, resultText, structuredContent }) {
  const summaryItems = [];
  const path = normalizeText(argsParsed?.path) || normalizeText(structuredContent?.path);
  const from = normalizeText(argsParsed?.from) || normalizeText(structuredContent?.from);
  const to = normalizeText(argsParsed?.to) || normalizeText(structuredContent?.to);
  const startLine = Number.isFinite(argsParsed?.start_line) ? argsParsed.start_line : structuredContent?.start_line;
  const endLine = Number.isFinite(argsParsed?.end_line) ? argsParsed.end_line : structuredContent?.end_line;
  const totalLines = Number.isFinite(structuredContent?.total_lines) ? structuredContent.total_lines : null;
  const exists =
    structuredContent?.exists === true ? 'true' : structuredContent?.exists === false ? 'false' : '';
  const overwrite =
    argsParsed?.overwrite === true || structuredContent?.overwrite === true
      ? 'true'
      : argsParsed?.overwrite === false || structuredContent?.overwrite === false
        ? 'false'
        : '';
  const sizeBytes = Number.isFinite(structuredContent?.size_bytes) ? structuredContent.size_bytes : null;
  const sha256 = normalizeText(structuredContent?.sha256);

  if (path) summaryItems.push({ label: 'path', value: formatSummaryValue(path, 140) });
  if (from) summaryItems.push({ label: 'from', value: formatSummaryValue(from, 140) });
  if (to) summaryItems.push({ label: 'to', value: formatSummaryValue(to, 140) });
  if (startLine !== null && startLine !== undefined) summaryItems.push({ label: 'start', value: String(startLine) });
  if (endLine !== null && endLine !== undefined) summaryItems.push({ label: 'end', value: String(endLine) });
  if (totalLines !== null) summaryItems.push({ label: 'total', value: String(totalLines) });
  if (exists) summaryItems.push({ label: 'exists', value: exists });
  if (overwrite) summaryItems.push({ label: 'overwrite', value: overwrite });
  if (sizeBytes !== null) summaryItems.push({ label: 'size', value: formatSummaryValue(sizeBytes, 80) });
  if (sha256) summaryItems.push({ label: 'sha256', value: formatSummaryValue(sha256, 120) });

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
      <ToolSection title="结果">
        <ToolJsonPreview text={resultText} value={!resultText && structuredContent ? structuredContent : undefined} emptyText="（暂无结果）" />
      </ToolSection>
    </>
  );
}

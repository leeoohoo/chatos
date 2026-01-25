import React from 'react';
import { Tag, Typography } from 'antd';

import { ToolBlock, ToolList, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatJson, formatSummaryValue } from './detail-utils.js';

const { Text } = Typography;

const DIAG_SEVERITY = {
  1: { label: 'Error', color: 'red', tone: 'error' },
  2: { label: 'Warning', color: 'gold', tone: 'warn' },
  3: { label: 'Info', color: 'blue', tone: '' },
  4: { label: 'Hint', color: 'purple', tone: '' },
};

function pickDocumentPath(structuredContent) {
  const doc = structuredContent?.document && typeof structuredContent.document === 'object' ? structuredContent.document : null;
  if (!doc) return '';
  if (typeof doc.path === 'string' && doc.path.trim()) return doc.path.trim();
  if (typeof doc.uri === 'string' && doc.uri.trim()) return doc.uri.trim();
  return '';
}

function pickPosition(structuredContent) {
  const pos = structuredContent?.position && typeof structuredContent.position === 'object' ? structuredContent.position : null;
  if (!pos) return { line: null, character: null };
  const line = Number.isFinite(pos.line) ? pos.line : null;
  const character = Number.isFinite(pos.character) ? pos.character : null;
  return { line, character };
}

function extractDiagnostics(structuredContent) {
  const list = Array.isArray(structuredContent?.diagnostics)
    ? structuredContent.diagnostics
    : Array.isArray(structuredContent?.result)
      ? structuredContent.result
      : [];
  return list.filter((item) => item && typeof item === 'object' && typeof item.message === 'string' && item.range);
}

function formatRange(range) {
  const start = range?.start || {};
  const line = Number.isFinite(start.line) ? start.line + 1 : null;
  const character = Number.isFinite(start.character) ? start.character + 1 : null;
  if (line === null && character === null) return '';
  return `${line ?? '-'}:${character ?? '-'}`;
}

export function LspToolDetails({ argsRaw, argsParsed, resultText, structuredContent }) {
  const summaryItems = [];
  const path = typeof argsParsed?.path === 'string' ? argsParsed.path : pickDocumentPath(structuredContent);
  const line = Number.isFinite(argsParsed?.line) ? argsParsed.line : pickPosition(structuredContent).line;
  const character = Number.isFinite(argsParsed?.character) ? argsParsed.character : pickPosition(structuredContent).character;
  const serverId =
    typeof argsParsed?.server_id === 'string'
      ? argsParsed.server_id
      : typeof structuredContent?.server_id === 'string'
        ? structuredContent.server_id
        : '';
  const query =
    typeof argsParsed?.query === 'string'
      ? argsParsed.query
      : typeof structuredContent?.query === 'string'
        ? structuredContent.query
        : '';

  if (path) summaryItems.push({ label: 'path', value: formatSummaryValue(path, 120) });
  if (line !== null || character !== null) {
    const position = `${line ?? '-'}:${character ?? '-'}`;
    summaryItems.push({ label: 'position', value: position });
  }
  if (serverId) summaryItems.push({ label: 'server', value: formatSummaryValue(serverId, 80) });
  if (query) summaryItems.push({ label: 'query', value: formatSummaryValue(query, 120) });

  const diagnostics = extractDiagnostics(structuredContent);
  if (diagnostics.length > 0) {
    summaryItems.push({ label: 'diagnostics', value: String(diagnostics.length) });
  }

  const structuredResult =
    structuredContent?.result ??
    structuredContent?.servers ??
    structuredContent?.diagnostics ??
    structuredContent?.message ??
    null;
  const resolvedText = diagnostics.length > 0 ? '' : structuredResult ? formatJson(structuredResult) : resultText;

  const diagnosticItems = diagnostics.map((diag, idx) => {
    const severityInfo = DIAG_SEVERITY[diag.severity] || { label: 'Info', color: 'blue', tone: '' };
    const position = formatRange(diag.range);
    const source = typeof diag.source === 'string' ? diag.source.trim() : '';
    const code = typeof diag.code === 'string' || typeof diag.code === 'number' ? String(diag.code) : '';
    const subtitleParts = [
      path ? `${path}${position ? `:${position}` : ''}` : position,
      source || code ? [source, code].filter(Boolean).join(': ') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      key: `${diag.source || 'diag'}-${idx}`,
      title: formatSummaryValue(diag.message, 160),
      subtitle: subtitleParts,
      meta: <Tag color={severityInfo.color}>{severityInfo.label}</Tag>,
      tone: severityInfo.tone,
    };
  });

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
      {diagnosticItems.length > 0 ? (
        <ToolSection title="诊断">
          <ToolList items={diagnosticItems} />
        </ToolSection>
      ) : null}
      {diagnosticItems.length === 0 ? (
        <ToolSection title="结果">
          {resolvedText ? <ToolBlock text={resolvedText} /> : <Text type="secondary">（暂无结果）</Text>}
        </ToolSection>
      ) : null}
    </>
  );
}

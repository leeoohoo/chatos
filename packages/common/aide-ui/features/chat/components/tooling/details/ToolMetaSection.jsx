import React from 'react';
import { Collapse } from 'antd';

import { ToolBlock, ToolSummary } from '../ToolPanels.jsx';
import { formatJson, formatSummaryValue, normalizeText } from './detail-utils.js';

function buildMetaItems(chatos) {
  const items = [];
  const status = normalizeText(chatos?.status);
  const code = normalizeText(chatos?.code);
  const server = normalizeText(chatos?.server);
  const tool = normalizeText(chatos?.tool);
  const ts = normalizeText(chatos?.ts);
  const trace = chatos?.trace && typeof chatos.trace === 'object' ? chatos.trace : null;

  if (status) items.push({ label: 'status', value: formatSummaryValue(status, 60) });
  if (code) items.push({ label: 'code', value: formatSummaryValue(code, 80) });
  if (server) items.push({ label: 'server', value: formatSummaryValue(server, 80) });
  if (tool) items.push({ label: 'tool', value: formatSummaryValue(tool, 80) });
  if (ts) items.push({ label: 'ts', value: formatSummaryValue(ts, 120) });
  if (trace?.traceId) items.push({ label: 'trace', value: formatSummaryValue(trace.traceId, 120) });
  if (trace?.spanId) items.push({ label: 'span', value: formatSummaryValue(trace.spanId, 120) });
  if (trace?.parentSpanId) items.push({ label: 'parent', value: formatSummaryValue(trace.parentSpanId, 120) });
  return items;
}

function extractError(chatos) {
  const err = chatos?.error;
  if (!err) return { message: '', details: '' };
  if (typeof err === 'string') return { message: err.trim(), details: '' };
  if (typeof err === 'object') {
    const message = normalizeText(err.message) || normalizeText(err.type) || normalizeText(err.code);
    const details = formatJson(err);
    return { message, details };
  }
  return { message: String(err), details: '' };
}

export function ToolMetaSection({ structuredContent, showStructured = true }) {
  if (!structuredContent || typeof structuredContent !== 'object') return null;
  const chatos = structuredContent.chatos && typeof structuredContent.chatos === 'object' ? structuredContent.chatos : null;
  const items = buildMetaItems(chatos);
  const errorInfo = extractError(chatos);
  const hasErrorDetails = Boolean(errorInfo.details);
  const structuredText = showStructured ? formatJson(structuredContent) : '';
  const hasStructured =
    showStructured &&
    structuredText &&
    structuredText !== '{}' &&
    structuredText !== 'null' &&
    structuredText !== '""';

  if (items.length === 0 && !errorInfo.message && !hasStructured) return null;

  const children = (
    <div className="ds-tool-meta-body">
      {items.length > 0 ? <ToolSummary items={items} /> : null}
      {errorInfo.message ? (
        <div style={{ marginTop: items.length > 0 ? 8 : 0 }}>
          <ToolBlock text={errorInfo.message} tone="stderr" />
        </div>
      ) : null}
      {hasErrorDetails ? (
        <div style={{ marginTop: 8 }}>
          <ToolBlock text={errorInfo.details} tone="stderr" />
        </div>
      ) : null}
      {hasStructured ? (
        <div style={{ marginTop: 8 }}>
          <ToolBlock text={structuredText} />
        </div>
      ) : null}
    </div>
  );

  return (
    <Collapse
      ghost
      size="small"
      className="ds-tool-meta-collapse"
      items={[{ key: 'meta', label: '元信息', children }]}
    />
  );
}

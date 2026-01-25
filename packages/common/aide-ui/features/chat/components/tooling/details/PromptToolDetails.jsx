import React from 'react';
import { Typography } from 'antd';

import { ToolBlock, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatJson, formatSummaryValue, normalizeText } from './detail-utils.js';

const { Text } = Typography;

function buildValueItems(values, limit = 6) {
  if (!values || typeof values !== 'object') return { items: [], hasMore: false };
  const entries = Object.entries(values);
  const items = entries.slice(0, limit).map(([key, value]) => ({
    label: key,
    value: formatSummaryValue(value, 80),
  }));
  return { items, hasMore: entries.length > limit };
}

export function PromptToolDetails({ argsRaw, argsParsed, resultText, structuredContent }) {
  const summaryItems = [];
  const title = normalizeText(argsParsed?.title);
  const message = normalizeText(argsParsed?.message);
  const fields = Array.isArray(argsParsed?.fields) ? argsParsed.fields : [];
  const options = Array.isArray(argsParsed?.options) ? argsParsed.options : [];
  const allowCancel = argsParsed?.allow_cancel ?? argsParsed?.allowCancel;
  const multiple = argsParsed?.multiple;
  const timeout = argsParsed?.timeout_ms;

  if (title) summaryItems.push({ label: 'title', value: formatSummaryValue(title, 120) });
  if (message) summaryItems.push({ label: 'message', value: formatSummaryValue(message, 120) });
  if (fields.length > 0) summaryItems.push({ label: 'fields', value: String(fields.length) });
  if (options.length > 0) summaryItems.push({ label: 'options', value: String(options.length) });
  if (allowCancel !== undefined) summaryItems.push({ label: 'allow_cancel', value: allowCancel ? 'true' : 'false' });
  if (multiple !== undefined) summaryItems.push({ label: 'multiple', value: multiple ? 'true' : 'false' });
  if (timeout !== undefined) summaryItems.push({ label: 'timeout_ms', value: formatSummaryValue(timeout, 80) });

  const values = structuredContent?.values && typeof structuredContent.values === 'object' ? structuredContent.values : null;
  const selection = structuredContent?.selection;
  const selectionText = Array.isArray(selection) ? selection.join(', ') : normalizeText(selection);
  const { items: valueItems, hasMore } = buildValueItems(values);
  const detailText = values ? formatJson(values) : selectionText ? formatJson(selection) : '';

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
      {valueItems.length > 0 || selectionText ? (
        <ToolSection title="返回">
          <ToolSummary
            items={[
              ...valueItems,
              ...(selectionText ? [{ label: 'selection', value: formatSummaryValue(selectionText, 120) }] : []),
            ]}
          />
        </ToolSection>
      ) : null}
      {detailText && hasMore ? (
        <ToolSection title="详情">
          <ToolBlock text={detailText} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        {resultText ? <ToolBlock text={resultText} /> : <Text type="secondary">（暂无结果）</Text>}
      </ToolSection>
    </>
  );
}

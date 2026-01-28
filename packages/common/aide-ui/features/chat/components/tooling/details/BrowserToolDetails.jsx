import React from 'react';
import { Typography } from 'antd';

import { MarkdownBlock } from '../../../../../components/MarkdownBlock.jsx';
import { ToolJsonPreview, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatJson, formatSummaryValue, normalizeText } from './detail-utils.js';

const { Text } = Typography;

export function BrowserToolDetails({ argsRaw, argsParsed, resultText, structuredContent }) {
  const summaryItems = [];
  const url = normalizeText(argsParsed?.url) || normalizeText(structuredContent?.url);
  const action = normalizeText(argsParsed?.action);
  const selector = normalizeText(argsParsed?.selector);
  const text = normalizeText(argsParsed?.text);
  const query = normalizeText(argsParsed?.query);

  if (url) summaryItems.push({ label: 'url', value: formatSummaryValue(url, 120) });
  if (action) summaryItems.push({ label: 'action', value: formatSummaryValue(action, 80) });
  if (selector) summaryItems.push({ label: 'selector', value: formatSummaryValue(selector, 120) });
  if (text) summaryItems.push({ label: 'text', value: formatSummaryValue(text, 120) });
  if (query) summaryItems.push({ label: 'query', value: formatSummaryValue(query, 120) });

  const structuredText = structuredContent ? formatJson(structuredContent) : '';

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
      {structuredText && !resultText ? (
        <ToolSection title="结构化">
          <ToolJsonPreview value={structuredContent} text={structuredText} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        <ToolJsonPreview
          text={resultText}
          value={!resultText && structuredContent ? structuredContent : undefined}
          emptyText="（暂无结果）"
          renderFallback={(raw) => <MarkdownBlock text={raw} maxHeight={320} container={false} copyable />}
        />
      </ToolSection>
    </>
  );
}

import React from 'react';
import { Typography } from 'antd';

import { MarkdownBlock } from '../../../../../components/MarkdownBlock.jsx';
import { ToolJsonPreview, ToolSection } from '../ToolPanels.jsx';
import { formatJson } from './detail-utils.js';

const { Text } = Typography;

export function DefaultToolDetails({ argsRaw, resultText, structuredContent }) {
  const fallbackValue =
    structuredContent && typeof structuredContent === 'object' ? structuredContent : structuredContent ? formatJson(structuredContent) : '';
  return (
    <>
      {argsRaw ? (
        <ToolSection title="参数">
          <ToolJsonPreview text={argsRaw} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        <ToolJsonPreview
          text={resultText}
          value={!resultText && fallbackValue ? fallbackValue : undefined}
          emptyText="（暂无结果）"
          renderFallback={(raw) => <MarkdownBlock text={raw} maxHeight={320} container={false} copyable />}
        />
      </ToolSection>
    </>
  );
}

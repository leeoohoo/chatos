import React from 'react';
import { Typography } from 'antd';

import { MarkdownBlock } from '../../../../../components/MarkdownBlock.jsx';
import { ToolBlock, ToolSection } from '../ToolPanels.jsx';
import { formatJson } from './detail-utils.js';

const { Text } = Typography;

export function DefaultToolDetails({ argsRaw, resultText, structuredContent }) {
  const fallbackText = resultText || formatJson(structuredContent);
  return (
    <>
      {argsRaw ? (
        <ToolSection title="参数">
          <ToolBlock text={argsRaw} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        {fallbackText ? (
          resultText ? (
            <MarkdownBlock text={resultText} maxHeight={320} container={false} copyable />
          ) : (
            <ToolBlock text={fallbackText} />
          )
        ) : (
          <Text type="secondary">（暂无结果）</Text>
        )}
      </ToolSection>
    </>
  );
}

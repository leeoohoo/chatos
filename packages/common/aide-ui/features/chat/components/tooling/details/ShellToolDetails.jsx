import React from 'react';
import { Typography } from 'antd';

import { formatBytes } from '../../../../../lib/format.js';
import { ToolBlock, ToolJsonPreview, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatSummaryValue } from './detail-utils.js';

const { Text } = Typography;

export function ShellToolDetails({ argsRaw, argsParsed, resultText, shellResult }) {
  const summaryItems = [];
  const header = shellResult?.header || {};
  const command = typeof argsParsed?.command === 'string' ? argsParsed.command : header.command;
  const cwd = typeof argsParsed?.cwd === 'string' ? argsParsed.cwd : header.cwd;
  const session = typeof argsParsed?.session === 'string' ? argsParsed.session : '';
  const lines = argsParsed?.lines;
  const signal = typeof argsParsed?.signal === 'string' ? argsParsed.signal : header.signal;
  const enter = typeof argsParsed?.enter === 'boolean' ? argsParsed.enter : null;

  if (command) summaryItems.push({ label: 'command', value: formatSummaryValue(command, 120) });
  if (cwd) summaryItems.push({ label: 'cwd', value: formatSummaryValue(cwd, 120) });
  if (session) summaryItems.push({ label: 'session', value: formatSummaryValue(session, 80) });
  if (lines !== undefined) summaryItems.push({ label: 'lines', value: formatSummaryValue(lines, 80) });
  if (signal) summaryItems.push({ label: 'signal', value: formatSummaryValue(signal, 80) });
  if (enter !== null) summaryItems.push({ label: 'enter', value: enter ? 'true' : 'false' });

  if (header.exitCode !== undefined) {
    const tone = typeof header.exitCode === 'number' && header.exitCode !== 0 ? 'error' : 'ok';
    summaryItems.push({ label: 'exit', value: formatSummaryValue(header.exitCode, 80), tone });
  }
  if (header.elapsed) summaryItems.push({ label: 'elapsed', value: formatSummaryValue(header.elapsed, 80) });
  if (header.bytes !== undefined) {
    const bytesValue = typeof header.bytes === 'number' ? formatBytes(header.bytes) : header.bytes;
    summaryItems.push({ label: 'bytes', value: formatSummaryValue(bytesValue, 80) });
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
      <ToolSection title="输出">
        {shellResult ? (
          <div className="ds-tool-output-grid">
            <div className="ds-tool-output-panel" data-tone="stdout">
              <div className="ds-tool-output-title">STDOUT</div>
              {shellResult.stdout ? <ToolBlock text={shellResult.stdout} /> : <Text type="secondary">（空）</Text>}
            </div>
            <div className="ds-tool-output-panel" data-tone="stderr">
              <div className="ds-tool-output-title">STDERR</div>
              {shellResult.stderr ? (
                <ToolBlock text={shellResult.stderr} tone="stderr" />
              ) : (
                <Text type="secondary">（空）</Text>
              )}
            </div>
          </div>
        ) : resultText ? (
          <ToolJsonPreview text={resultText} />
        ) : (
          <Text type="secondary">（暂无结果）</Text>
        )}
      </ToolSection>
      {shellResult?.warnings ? (
        <ToolSection title="警告">
          <ToolBlock text={shellResult.warnings} tone="warn" />
        </ToolSection>
      ) : null}
    </>
  );
}

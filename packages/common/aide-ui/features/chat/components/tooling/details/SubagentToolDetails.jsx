import React from 'react';
import { Collapse, Typography } from 'antd';

import { MarkdownBlock } from '../../../../../components/MarkdownBlock.jsx';
import { parseJsonSafe } from '../../../../../lib/parse.js';
import { ToolBlock, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatJson, formatSummaryValue, normalizeText } from './detail-utils.js';
import { SubagentProcessPanel } from './SubagentProcessPanel.jsx';

const { Text } = Typography;

function formatElapsed(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function RawJsonSection({ title, label, text }) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  return (
    <ToolSection title={title}>
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'raw',
            label: label || '查看原始 JSON',
            children: <ToolBlock text={raw} />,
          },
        ]}
      />
    </ToolSection>
  );
}

export function SubagentToolDetails({ toolName, argsRaw, argsParsed, resultText, structuredContent, liveSteps }) {
  const summaryItems = [];
  const primaryItems = [];
  const secondaryItems = [];
  const parsedResult = parseJsonSafe(resultText, null);
  const payload =
    structuredContent && typeof structuredContent === 'object'
      ? structuredContent
      : parsedResult && typeof parsedResult === 'object'
        ? parsedResult
        : null;
  const toolNameText = normalizeText(toolName);
  const isRunSubAgent = toolNameText.includes('run_sub_agent');
  const agentId = normalizeText(argsParsed?.agent_id) || normalizeText(payload?.agent_id);
  const category = normalizeText(argsParsed?.category);
  const task = normalizeText(argsParsed?.task);
  const skillsFromArgs = Array.isArray(argsParsed?.skills) ? argsParsed.skills.filter(Boolean) : [];
  const skillsFromPayload = Array.isArray(payload?.skills) ? payload.skills.filter(Boolean) : [];
  const skills = skillsFromArgs.length > 0 ? skillsFromArgs : skillsFromPayload;
  const agentName = normalizeText(payload?.agent_name);
  const plugin = normalizeText(payload?.plugin);
  const model = normalizeText(payload?.model);
  const commandName = normalizeText(payload?.command?.name || payload?.command?.id);
  const responseText =
    isRunSubAgent && payload && Object.prototype.hasOwnProperty.call(payload, 'response')
      ? formatJson(payload.response)
      : '';
  const finalSteps = Array.isArray(payload?.steps) ? payload.steps : [];
  const liveStepList = Array.isArray(liveSteps) ? liveSteps : [];
  const effectiveSteps = finalSteps.length > 0 ? finalSteps : liveStepList;
  const isLiveSteps = finalSteps.length === 0 && liveStepList.length > 0;
  const stats = payload?.stats && typeof payload.stats === 'object' ? payload.stats : null;
  const errorText = normalizeText(payload?.error);
  const fallbackText = isRunSubAgent ? (!payload ? resultText : '') : payload ? formatJson(payload) : resultText;
  const rawArgsText = typeof argsRaw === 'string' ? argsRaw.trim() : '';
  const rawPayloadText = payload ? formatJson(payload) : '';
  const toolNames = Array.from(
    new Set(
      effectiveSteps
        .filter((step) => step?.type === 'tool_call' && typeof step?.tool === 'string')
        .map((step) => step.tool)
        .filter(Boolean)
    )
  );

  if (agentId) primaryItems.push({ label: 'agent', value: formatSummaryValue(agentId, 80) });
  if (skills.length > 0) primaryItems.push({ label: 'skills', value: formatSummaryValue(skills.join(', '), 120) });
  if (task) primaryItems.push({ label: 'task', value: formatSummaryValue(task, 140) });

  if (agentName) secondaryItems.push({ label: 'agent_name', value: formatSummaryValue(agentName, 80) });
  if (category) secondaryItems.push({ label: 'category', value: formatSummaryValue(category, 80) });
  if (plugin) secondaryItems.push({ label: 'plugin', value: formatSummaryValue(plugin, 80) });
  if (model) secondaryItems.push({ label: 'model', value: formatSummaryValue(model, 80) });
  if (commandName) secondaryItems.push({ label: 'command', value: formatSummaryValue(commandName, 80) });
  if (stats?.elapsed_ms) secondaryItems.push({ label: 'elapsed', value: formatElapsed(stats.elapsed_ms) });
  if (stats?.tool_calls) secondaryItems.push({ label: 'tools', value: String(stats.tool_calls) });
  if (effectiveSteps.length > 0) secondaryItems.push({ label: 'steps', value: String(effectiveSteps.length) });
  if (toolNames.length > 0) {
    secondaryItems.push({ label: 'tools_used', value: formatSummaryValue(toolNames.join(', '), 160) });
  }

  summaryItems.push(...primaryItems, ...secondaryItems);

  return (
    <>
      {summaryItems.length > 0 ? (
        <ToolSection title="摘要">
          <ToolSummary items={summaryItems} variant={isRunSubAgent ? 'subagent' : undefined} />
        </ToolSection>
      ) : null}
      {!isRunSubAgent && argsRaw ? (
        <ToolSection title="参数">
          <ToolBlock text={argsRaw} />
        </ToolSection>
      ) : null}
      {isRunSubAgent ? (
        <>
          <RawJsonSection title="原始参数" label="查看原始参数" text={rawArgsText} />
          <RawJsonSection title="原始结果" label="查看原始结果" text={rawPayloadText} />
        </>
      ) : null}
      {effectiveSteps.length > 0 || isRunSubAgent ? (
        <ToolSection title={isLiveSteps ? '过程（实时）' : '过程'}>
          <SubagentProcessPanel steps={effectiveSteps} />
        </ToolSection>
      ) : null}
      {errorText ? (
        <ToolSection title="错误">
          <ToolBlock text={errorText} tone="stderr" />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        {responseText ? (
          <MarkdownBlock text={responseText} maxHeight={320} container={false} copyable />
        ) : fallbackText ? (
          <ToolBlock text={fallbackText} />
        ) : (
          <Text type="secondary">（暂无结果）</Text>
        )}
      </ToolSection>
    </>
  );
}

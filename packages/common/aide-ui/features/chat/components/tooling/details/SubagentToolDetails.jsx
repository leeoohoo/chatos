import React from 'react';
import { Collapse, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';

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

function PopoverRawSection({ items = [] }) {
  const list = items.filter((item) => item && typeof item.text === 'string' && item.text.trim());
  if (list.length === 0) return null;
  const collapseItems = list.map((item) => ({
    key: item.key || item.label || 'raw',
    label: item.label,
    children: <ToolBlock text={item.text} />,
  }));
  return (
    <div className="ds-subagent-popover-raw">
      <div className="ds-subagent-popover-section-title">Raw data</div>
      <Collapse ghost size="small" items={collapseItems} className="ds-subagent-raw-collapse" />
    </div>
  );
}

function buildStepTitle(step) {
  const type = step?.type || 'notice';
  const tool = typeof step?.tool === 'string' ? step.tool : '';
  if (type === 'assistant') {
    const text = typeof step?.text === 'string' ? step.text : '';
    const reasoning = typeof step?.reasoning === 'string' ? step.reasoning : '';
    const summarySource = text || reasoning;
    if (summarySource) return formatSummaryValue(summarySource.replace(/\s+/g, ' '), 48);
    return 'AI';
  }
  if (type === 'tool_call') return tool ? `Call ${tool}` : 'Tool Call';
  if (type === 'tool_result') return tool ? `Result ${tool}` : 'Tool Result';
  return 'Notice';
}

function buildStepSummary(step) {
  const toolCallsText = step?.tool_calls
    ? step.tool_calls
        .map((call) => {
          const name = typeof call?.tool === 'string' ? call.tool : 'tool';
          const callId = typeof call?.call_id === 'string' ? call.call_id : '';
          return callId ? `${name} (${callId})` : name;
        })
        .join(', ')
    : '';
  const text = typeof step?.text === 'string' ? step.text : '';
  const reasoning = typeof step?.reasoning === 'string' ? step.reasoning : '';
  const argsText = typeof step?.args === 'string' ? step.args : '';
  const resultText = typeof step?.result === 'string' ? step.result : '';
  const notice = typeof step?.text === 'string' ? step.text : '';
  const summaryText = (text || reasoning || resultText || argsText || toolCallsText || notice || '').replace(/\s+/g, ' ');
  return summaryText;
}

export function SubagentToolDetails({
  toolName,
  argsRaw,
  argsParsed,
  resultText,
  structuredContent,
  liveSteps,
  display,
  callId,
  status,
  canCopyArgs,
  canCopyResult,
  canExpand,
  onCopyArgs,
  onCopyResult,
  onExpand,
}) {
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
  const isRunSubAgent = toolNameText.toLowerCase().includes('run_sub_agent');
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

  if (isRunSubAgent && display === 'popover') {
    const statusLabels = {
      ok: 'Completed',
      pending: 'Running',
      error: 'Failed',
      canceled: 'Canceled',
      timeout: 'Timeout',
      partial: 'Partial',
    };
    const statusLabel = statusLabels[status] || (status ? status.toUpperCase() : 'Running');
    const liveLabel = isLiveSteps ? 'Live' : '';
    const metaCards = [
      { label: 'Agent', value: agentId || agentName },
      { label: 'Skills', value: skills.length > 0 ? skills.join(', ') : '' },
      { label: 'Model', value: model },
      { label: 'Command', value: commandName },
    ].filter((item) => item.value);
    const statsItems = [
      stats?.elapsed_ms ? { label: 'elapsed', value: formatElapsed(stats.elapsed_ms) } : null,
      stats?.tool_calls ? { label: 'tools', value: String(stats.tool_calls) } : null,
      effectiveSteps.length > 0 ? { label: 'steps', value: String(effectiveSteps.length) } : null,
    ].filter(Boolean);
    const previewSource = responseText || fallbackText;
    const previewText = previewSource ? formatSummaryValue(previewSource.replace(/\s+/g, ' '), 220) : '';
    const headerSubtitle = [callId, agentName || agentId, model].filter(Boolean).join(' - ').trim();
    const timelineSteps = (effectiveSteps || []).map((step, index) => {
      const title = buildStepTitle(step);
      const summaryText = buildStepSummary(step);
      const summary = summaryText ? formatSummaryValue(summaryText, 120) : '';
      const elapsed = formatElapsed(step?.elapsed_ms);
      const callId = typeof step?.call_id === 'string' ? step.call_id : '';
      const typeLabel =
        step?.type === 'assistant'
          ? 'AI'
          : step?.type === 'tool_call'
            ? 'Tool Call'
            : step?.type === 'tool_result'
              ? 'Tool Result'
              : 'Notice';
      const isError = Boolean(step?.is_error);
      const isTruncated = Boolean(
        step?.text_truncated || step?.reasoning_truncated || step?.args_truncated || step?.result_truncated
      );
      return {
        key: step?.ts || `${step?.type || 'step'}-${index}`,
        index,
        title,
        summary,
        elapsed,
        callId,
        typeLabel,
        isError,
        isTruncated,
      };
    });

    return (
      <div className="ds-subagent-popover">
        <div className="ds-subagent-popover-header">
          <div className="ds-subagent-popover-header-main">
            <span className="ds-subagent-popover-icon">
              <RobotOutlined />
            </span>
            <div className="ds-subagent-popover-title">
              <div className="ds-subagent-popover-title-text">{toolNameText || 'run_sub_agent'}</div>
              {headerSubtitle ? <div className="ds-subagent-popover-subtitle">{headerSubtitle}</div> : null}
            </div>
          </div>
          <div className="ds-subagent-popover-header-meta">
            <div className="ds-subagent-popover-chips">
              <span className="ds-subagent-header-chip">Agent</span>
              <span className="ds-subagent-header-chip" data-status={status}>
                {statusLabel}
              </span>
              {liveLabel ? <span className="ds-subagent-header-chip">{liveLabel}</span> : null}
            </div>
            <div className="ds-subagent-popover-actions">
              {canCopyArgs ? (
                <button type="button" className="ds-subagent-header-btn" onClick={onCopyArgs}>
                  Args
                </button>
              ) : null}
              {canCopyResult ? (
                <button type="button" className="ds-subagent-header-btn" onClick={onCopyResult}>
                  Result
                </button>
              ) : null}
              {canExpand ? (
                <button type="button" className="ds-subagent-header-btn" onClick={onExpand}>
                  Expand
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="ds-subagent-popover-body">
          <div className="ds-subagent-popover-column is-left">
            <div className="ds-subagent-popover-section">
              <div className="ds-subagent-popover-section-title">Summary</div>
              <div className="ds-subagent-meta-stack">
                {metaCards.map((item) => (
                  <div key={item.label} className="ds-subagent-meta-card">
                    <div className="ds-subagent-meta-label">{item.label}</div>
                    <div className="ds-subagent-meta-value">{formatSummaryValue(item.value, 120)}</div>
                  </div>
                ))}
              </div>
            </div>
            {task ? (
              <div className="ds-subagent-popover-section">
                <div className="ds-subagent-popover-section-title">Task</div>
                <div className="ds-subagent-meta-card">
                  <div className="ds-subagent-meta-value">{formatSummaryValue(task, 160)}</div>
                </div>
              </div>
            ) : null}
            {statsItems.length > 0 ? (
              <div className="ds-subagent-popover-section">
                <div className="ds-subagent-popover-section-title">Stats</div>
                <div className="ds-subagent-stats">
                  {statsItems.map((item) => (
                    <div key={item.label} className="ds-subagent-stat-card">
                      <div className="ds-subagent-stat-value">{item.value}</div>
                      <div className="ds-subagent-stat-label">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="ds-subagent-popover-column is-right">
            <div className="ds-subagent-popover-section">
              <div className="ds-subagent-popover-section-title">Process timeline</div>
              {timelineSteps.length > 0 ? (
                <div className="ds-subagent-timeline">
                  {timelineSteps.map((step, idx) => (
                    <div
                      key={step.key}
                      className={[
                        'ds-subagent-timeline-item',
                        step.isError ? 'is-error' : '',
                        step.isTruncated ? 'is-truncated' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="ds-subagent-timeline-track">
                        <span className="ds-subagent-timeline-dot" />
                        {idx < timelineSteps.length - 1 ? <span className="ds-subagent-timeline-line" /> : null}
                      </div>
                      <div className="ds-subagent-timeline-card">
                        <div className="ds-subagent-timeline-header">
                          <span className="ds-subagent-timeline-index">{step.index + 1}.</span>
                          <span className="ds-subagent-timeline-title">{step.title}</span>
                          <span className="ds-subagent-timeline-chip">{step.typeLabel}</span>
                          {step.callId ? <span className="ds-subagent-timeline-call">#{step.callId}</span> : null}
                          {step.elapsed ? <span className="ds-subagent-timeline-time">{step.elapsed}</span> : null}
                        </div>
                        {step.summary ? <div className="ds-subagent-timeline-summary">{step.summary}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Text type="secondary">No timeline</Text>
              )}
            </div>
            <div className="ds-subagent-popover-section">
              <div className="ds-subagent-popover-section-title">Result preview</div>
              {previewText ? <div className="ds-subagent-preview">{previewText}</div> : <Text type="secondary">No preview</Text>}
            </div>
            {errorText ? (
              <div className="ds-subagent-popover-section">
                <div className="ds-subagent-popover-section-title">Error</div>
                <ToolBlock text={errorText} tone="stderr" />
              </div>
            ) : null}
            <PopoverRawSection
              items={[
                { key: 'args', label: 'Args JSON', text: rawArgsText },
                { key: 'result', label: 'Result JSON', text: rawPayloadText },
              ]}
            />
          </div>
        </div>
      </div>
    );
  }

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

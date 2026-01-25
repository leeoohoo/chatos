import React, { useMemo } from 'react';
import { Collapse, Space, Tag, Typography } from 'antd';
import { MessageOutlined, RobotOutlined, ToolOutlined } from '@ant-design/icons';

import { ToolBlock } from '../ToolPanels.jsx';
import { formatSummaryValue } from './detail-utils.js';

const { Text } = Typography;

const STEP_META = {
  assistant: { label: 'AI', icon: RobotOutlined },
  tool_call: { label: 'Tool Call', icon: ToolOutlined },
  tool_result: { label: 'Tool Result', icon: ToolOutlined },
  notice: { label: 'Notice', icon: MessageOutlined },
};

function formatElapsed(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function buildToolCallList(calls = []) {
  const list = Array.isArray(calls) ? calls : [];
  if (list.length === 0) return '';
  return list
    .map((call) => {
      const name = typeof call?.tool === 'string' ? call.tool : 'tool';
      const callId = typeof call?.call_id === 'string' ? call.call_id : '';
      return `- ${name}${callId ? ` (${callId})` : ''}`;
    })
    .join('\n');
}

function buildHeader(step, index) {
  const type = step?.type || 'notice';
  const meta = STEP_META[type] || STEP_META.notice;
  const Icon = meta.icon || MessageOutlined;
  const tool = typeof step?.tool === 'string' ? step.tool : '';
  const callId = typeof step?.call_id === 'string' ? step.call_id : '';
  const elapsed = formatElapsed(step?.elapsed_ms);
  const title =
    type === 'assistant'
      ? 'AI 思考'
      : type === 'tool_call'
        ? tool
          ? `调用 ${tool}`
          : '调用工具'
        : type === 'tool_result'
          ? tool
            ? `结果 ${tool}`
            : '工具结果'
          : '提示';
  const subtitleParts = [
    callId ? `#${callId}` : '',
    elapsed ? `耗时 ${elapsed}` : '',
    typeof step?.iteration === 'number' ? `迭代 ${step.iteration + 1}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const tags = [];
  if (step?.is_error) {
    tags.push(
      <Tag color="red" key="error">
        error
      </Tag>
    );
  }
  if (step?.text_truncated || step?.reasoning_truncated || step?.args_truncated || step?.result_truncated) {
    tags.push(
      <Tag color="gold" key="truncated">
        truncated
      </Tag>
    );
  }

  return (
    <Space size={6} wrap className="ds-subagent-step-header">
      <span className="ds-subagent-step-index">{index + 1}.</span>
      <Icon className="ds-subagent-step-icon" />
      <span className="ds-subagent-step-title">{title}</span>
      {subtitleParts ? <Text type="secondary">{subtitleParts}</Text> : null}
      {tags.length > 0 ? <Space size={4}>{tags}</Space> : null}
    </Space>
  );
}

function StepBlock({ label, text, tone }) {
  if (!text) return null;
  return (
    <div className="ds-subagent-step-block">
      <div className="ds-subagent-step-label">{label}</div>
      <ToolBlock text={text} tone={tone} />
    </div>
  );
}

export function SubagentProcessPanel({ steps = [] }) {
  const items = useMemo(() => {
    const list = Array.isArray(steps) ? steps.filter(Boolean) : [];
    return list.map((step, index) => {
      const toolCallsText = step?.tool_calls ? buildToolCallList(step.tool_calls) : '';
      const argsText = typeof step?.args === 'string' ? step.args : '';
      const resultText = typeof step?.result === 'string' ? step.result : '';
      const text = typeof step?.text === 'string' ? step.text : '';
      const reasoning = typeof step?.reasoning === 'string' ? step.reasoning : '';
      const notice = typeof step?.text === 'string' ? step.text : '';
      const summaryText = (text || reasoning || resultText || argsText || toolCallsText || notice || '').replace(
        /\s+/g,
        ' '
      );
      const summary =
        summaryText && summaryText.length > 140 ? `${summaryText.slice(0, 140)}...` : summaryText;
      const stepType = step?.type || 'notice';
      const hasError = Boolean(step?.is_error);
      const isTruncated = Boolean(
        step?.text_truncated || step?.reasoning_truncated || step?.args_truncated || step?.result_truncated
      );
      const itemClassName = [
        'ds-subagent-step',
        `ds-subagent-step-${stepType}`,
        hasError ? 'is-error' : '',
        isTruncated ? 'is-truncated' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const children = (
        <div className="ds-subagent-step-body">
          {step?.type === 'assistant' ? (
            <>
              <StepBlock label="输出" text={text} />
              <StepBlock label="思考" text={reasoning} tone="warn" />
              <StepBlock label="工具调用" text={toolCallsText} />
            </>
          ) : null}
          {step?.type === 'tool_call' ? (
            <>
              <StepBlock label="参数" text={argsText} />
            </>
          ) : null}
          {step?.type === 'tool_result' ? (
            <>
              <StepBlock label="结果" text={resultText} tone={step?.is_error ? 'stderr' : undefined} />
            </>
          ) : null}
          {step?.type === 'notice' ? <StepBlock label="提示" text={notice} /> : null}
        </div>
      );
      return {
        key: step?.ts || `${step?.type || 'step'}-${index}`,
        label: buildHeader(step, index),
        children,
        className: itemClassName,
        extra: summary ? (
          <span className="ds-subagent-step-summary" title={summaryText}>
            {formatSummaryValue(summary, 140)}
          </span>
        ) : null,
      };
    });
  }, [steps]);

  if (items.length === 0) {
    return <Text type="secondary">（暂无过程记录）</Text>;
  }

  return <Collapse ghost size="small" items={items} className="ds-subagent-process" />;
}

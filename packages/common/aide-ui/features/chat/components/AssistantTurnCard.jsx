import React, { useMemo, useState } from 'react';
import { Button, Collapse, Space, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

import { MarkdownBlock } from '../../../components/MarkdownBlock.jsx';
import { PopoverTag } from './PopoverTag.jsx';
import { copyPlainText } from '../../../lib/clipboard.js';
import { formatBytes, truncateText } from '../../../lib/format.js';
import { parseJsonSafe } from '../../../lib/parse.js';

const { Text } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString();
}

function getToolName(call) {
  const name = call?.function?.name;
  return typeof name === 'string' ? name.trim() : '';
}

function getToolArgs(call) {
  const args = call?.function?.arguments;
  if (typeof args === 'string') return args;
  if (args === undefined || args === null) return '';
  return String(args);
}

function getToolResultText(results = []) {
  const parts = (Array.isArray(results) ? results : [])
    .map((msg) => {
      if (!msg) return '';
      if (typeof msg?.content === 'string') return msg.content;
      return String(msg?.content || '');
    })
    .map((text) => (typeof text === 'string' ? text.trim() : String(text || '').trim()))
    .filter(Boolean);
  return parts.join('\n\n');
}

function parseToolArgsText(argsText) {
  const raw = typeof argsText === 'string' ? argsText.trim() : argsText === undefined || argsText === null ? '' : String(argsText);
  if (!raw) return { raw: '', parsed: null };
  return { raw, parsed: parseJsonSafe(raw, null) };
}

function inferToolKind(toolName) {
  const raw = typeof toolName === 'string' ? toolName.trim().toLowerCase() : '';
  if (!raw) return 'default';
  if (raw.includes('run_shell_command') || raw.includes('session_') || raw.includes('shell')) return 'shell';
  if (
    raw.includes('read_file') ||
    raw.includes('write_file') ||
    raw.includes('edit_file') ||
    raw.includes('apply_patch') ||
    raw.includes('delete_path') ||
    raw.includes('list_directory') ||
    raw.includes('list_workspace_files') ||
    raw.includes('search_text')
  ) {
    return 'filesystem';
  }
  if (raw.includes('lsp')) return 'lsp';
  if (raw.includes('task')) return 'task';
  if (raw.includes('subagent') || raw.includes('sub_agent')) return 'subagent';
  if (raw.includes('prompt')) return 'prompt';
  if (raw.includes('journal')) return 'journal';
  if (raw.includes('chrome') || raw.includes('browser') || raw.includes('devtools')) return 'browser';
  return 'default';
}

function parseShellHeader(line) {
  const header = {};
  const raw = typeof line === 'string' ? line : String(line ?? '');
  const parts = raw.split(' | ').map((part) => part.trim()).filter(Boolean);
  parts.forEach((part) => {
    if (part.startsWith('$ ')) {
      header.command = part.slice(2).trim();
      return;
    }
    if (part.startsWith('cwd: ')) {
      header.cwd = part.slice(5).trim();
      return;
    }
    if (part.startsWith('exit code: ')) {
      const value = Number(part.slice(11).trim());
      header.exitCode = Number.isFinite(value) ? value : part.slice(11).trim();
      return;
    }
    if (part.startsWith('signal: ')) {
      header.signal = part.slice(8).trim();
      return;
    }
    if (part === 'timed out') {
      header.timedOut = true;
      return;
    }
    if (part.startsWith('elapsed: ')) {
      header.elapsed = part.slice(9).trim();
      return;
    }
    if (part.startsWith('bytes: ')) {
      const value = Number(part.slice(7).trim());
      header.bytes = Number.isFinite(value) ? value : part.slice(7).trim();
    }
  });
  return header;
}

function parseShellResult(text) {
  const raw = typeof text === 'string' ? text.trim() : String(text ?? '').trim();
  if (!raw) return null;

  const warningMatch = raw.match(/\n\n\[Warnings\]\n([\s\S]*)$/);
  const warnings = warningMatch ? warningMatch[1].trim() : '';
  const body = warningMatch ? raw.slice(0, warningMatch.index) : raw;

  if (!body.includes('STDOUT:') && !body.includes('STDERR:')) {
    return null;
  }

  const headerLine = body.split('\n')[0] || '';
  const header = parseShellHeader(headerLine);
  const stdoutMatch = body.match(/STDOUT:\n?([\s\S]*?)(?:\n\nSTDERR:|\nSTDERR:|$)/);
  const stderrMatch = body.match(/STDERR:\n?([\s\S]*)$/);
  const stdoutRaw = stdoutMatch ? stdoutMatch[1] : '';
  const stderrRaw = stderrMatch ? stderrMatch[1] : '';
  const stdout = stdoutRaw.trim() === '<empty>' ? '' : stdoutRaw.trimEnd();
  const stderr = stderrRaw.trim() === '<empty>' ? '' : stderrRaw.trimEnd();

  return { header, stdout, stderr, warnings };
}

function formatSummaryValue(value, maxLen = 160) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return truncateText(value, maxLen);
  try {
    return truncateText(JSON.stringify(value), maxLen);
  } catch {
    return truncateText(String(value), maxLen);
  }
}

function inferToolStatus(resultText, shellResult) {
  if (!resultText) return 'pending';
  if (shellResult?.header?.timedOut) return 'timeout';
  if (typeof shellResult?.header?.exitCode === 'number' && shellResult.header.exitCode !== 0) return 'error';
  const lowered = String(resultText || '').toLowerCase();
  if (lowered.includes('[error]') || lowered.includes(' error ') || lowered.includes('failed')) return 'error';
  if (lowered.includes('canceled') || lowered.includes('cancelled') || lowered.includes('取消')) return 'canceled';
  if (lowered.includes('timeout') || lowered.includes('timed out') || lowered.includes('超时')) return 'timeout';
  if (lowered.includes('partial')) return 'partial';
  return 'ok';
}

function pickStatusColor(status) {
  switch (status) {
    case 'error':
    case 'timeout':
      return 'red';
    case 'canceled':
      return 'orange';
    case 'pending':
      return 'gold';
    case 'partial':
      return 'geekblue';
    case 'ok':
    default:
      return 'purple';
  }
}

function buildToolSubtitle(toolName, argsParsed) {
  if (!argsParsed || typeof argsParsed !== 'object') return '';
  const rawName = typeof toolName === 'string' ? toolName.toLowerCase() : '';
  if (typeof argsParsed.command === 'string' && argsParsed.command.trim()) {
    return truncateText(argsParsed.command.trim(), 90);
  }
  if (typeof argsParsed.path === 'string' && argsParsed.path.trim()) {
    return truncateText(argsParsed.path.trim(), 90);
  }
  if (Array.isArray(argsParsed.paths) && argsParsed.paths.length > 0) {
    return truncateText(String(argsParsed.paths[0]), 90);
  }
  if (typeof argsParsed.query === 'string' && argsParsed.query.trim()) {
    return `search: ${truncateText(argsParsed.query.trim(), 80)}`;
  }
  if (typeof argsParsed.session === 'string' && argsParsed.session.trim()) {
    return rawName.includes('session') ? `session: ${truncateText(argsParsed.session.trim(), 80)}` : argsParsed.session.trim();
  }
  return '';
}

function ToolSection({ title, children }) {
  return (
    <div className="ds-tool-section">
      <div className="ds-tool-section-title">{title}</div>
      {children}
    </div>
  );
}

function ToolSummary({ items = [] }) {
  const list = (Array.isArray(items) ? items : []).filter((item) => item && item.value !== '');
  if (list.length === 0) return null;
  return (
    <div className="ds-tool-summary">
      {list.map((item, idx) => (
        <div key={`${item.label}-${idx}`} className="ds-tool-summary-item" data-tone={item.tone || undefined}>
          <div className="ds-tool-summary-label">{item.label}</div>
          <div className="ds-tool-summary-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function ToolBlock({ text, tone }) {
  if (!text) return <Text type="secondary">（空）</Text>;
  return (
    <pre className="ds-tool-block" data-tone={tone || undefined}>
      {text}
    </pre>
  );
}

function renderShellDetails({ argsRaw, argsParsed, resultText, shellResult }) {
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
          <ToolBlock text={argsRaw} />
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
          <ToolBlock text={resultText} />
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

function renderFilesystemDetails({ argsRaw, argsParsed, resultText }) {
  const summaryItems = [];
  if (typeof argsParsed?.path === 'string') {
    summaryItems.push({ label: 'path', value: formatSummaryValue(argsParsed.path, 120) });
  }
  if (Array.isArray(argsParsed?.paths) && argsParsed.paths.length > 0) {
    summaryItems.push({ label: 'paths', value: formatSummaryValue(argsParsed.paths.join(', '), 160) });
  }
  if (typeof argsParsed?.mode === 'string') {
    summaryItems.push({ label: 'mode', value: formatSummaryValue(argsParsed.mode, 80) });
  }
  if (argsParsed?.depth !== undefined) {
    summaryItems.push({ label: 'depth', value: formatSummaryValue(argsParsed.depth, 80) });
  }
  if (typeof argsParsed?.query === 'string') {
    summaryItems.push({ label: 'query', value: formatSummaryValue(argsParsed.query, 120) });
  }
  if (argsParsed?.includeHidden !== undefined) {
    summaryItems.push({ label: 'hidden', value: argsParsed.includeHidden ? 'true' : 'false' });
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
          <ToolBlock text={argsRaw} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        {resultText ? <ToolBlock text={resultText} /> : <Text type="secondary">（暂无结果）</Text>}
      </ToolSection>
    </>
  );
}

function renderDefaultToolDetails({ argsRaw, resultText }) {
  return (
    <>
      {argsRaw ? (
        <ToolSection title="参数">
          <ToolBlock text={argsRaw} />
        </ToolSection>
      ) : null}
      <ToolSection title="结果">
        {resultText ? (
          <MarkdownBlock text={resultText} maxHeight={320} container={false} copyable />
        ) : (
          <Text type="secondary">（暂无结果）</Text>
        )}
      </ToolSection>
    </>
  );
}

function renderToolDetails({ toolKind, argsRaw, argsParsed, resultText, shellResult }) {
  if (toolKind === 'shell') {
    return renderShellDetails({ argsRaw, argsParsed, resultText, shellResult });
  }
  if (toolKind === 'filesystem') {
    return renderFilesystemDetails({ argsRaw, argsParsed, resultText });
  }
  return renderDefaultToolDetails({ argsRaw, resultText });
}

function extractThinkContent(text) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (!raw) return { content: '', reasoning: '' };
  const regex = /<think(?:\s[^>]*)?>([\s\S]*?)<\/think>/gi;
  let cleaned = '';
  let lastIndex = 0;
  const reasoningParts = [];
  let match;
  while ((match = regex.exec(raw)) !== null) {
    cleaned += raw.slice(lastIndex, match.index);
    if (match[1]) {
      reasoningParts.push(match[1]);
    }
    lastIndex = match.index + match[0].length;
  }
  const remainder = raw.slice(lastIndex);
  const openMatch = remainder.match(/<think(?:\s[^>]*)?>([\s\S]*)$/i);
  if (openMatch) {
    cleaned += remainder.slice(0, openMatch.index);
    if (openMatch[1]) {
      reasoningParts.push(openMatch[1]);
    }
  } else {
    cleaned += remainder;
  }
  const reasoning = reasoningParts
    .map((part) => (typeof part === 'string' ? part.trim() : String(part || '').trim()))
    .filter(Boolean)
    .join('\n\n');
  return { content: cleaned, reasoning };
}

export function AssistantTurnCard({ messages, streaming }) {
  const list = useMemo(() => (Array.isArray(messages) ? messages.filter(Boolean) : []), [messages]);
  const [copying, setCopying] = useState(false);
  const createdAt = useMemo(() => {
    const first = list.find((m) => m?.createdAt);
    return first?.createdAt || '';
  }, [list]);
  const timeText = useMemo(() => (createdAt ? formatTime(createdAt) : ''), [createdAt]);

  const blocks = useMemo(() => {
    const out = [];
    const toolResultsByCallId = new Map();

    list.forEach((msg) => {
      if (msg?.role !== 'tool') return;
      const callId = normalizeId(msg?.toolCallId);
      if (!callId) return;
      const existing = toolResultsByCallId.get(callId);
      if (existing) {
        existing.push(msg);
      } else {
        toolResultsByCallId.set(callId, [msg]);
      }
    });

    const consumedToolMessageIds = new Set();

    list.forEach((msg, msgIdx) => {
      if (!msg) return;

      if (msg.role === 'assistant') {
        const reasoning =
          typeof msg?.reasoning === 'string' ? msg.reasoning : String(msg?.reasoning || '');
        const contentRaw = typeof msg?.content === 'string' ? msg.content : String(msg?.content || '');
        const extracted = extractThinkContent(contentRaw);
        const combinedReasoning = [reasoning, extracted.reasoning]
          .map((part) => (typeof part === 'string' ? part.trim() : String(part || '').trim()))
          .filter(Boolean)
          .join('\n\n');
        if (combinedReasoning) {
          out.push({
            type: 'assistant_reasoning',
            key: `${normalizeId(msg?.id) || `assistant_${msgIdx}`}_reasoning`,
            content: combinedReasoning,
          });
        }

        const content = extracted.content;
        if (content.trim()) {
          out.push({
            type: 'assistant',
            key: normalizeId(msg?.id) || `assistant_${msgIdx}`,
            content,
          });
        }

        const calls = Array.isArray(msg?.toolCalls) ? msg.toolCalls.filter(Boolean) : [];
        if (calls.length > 0) {
          const invocations = calls.map((call, idx) => {
            const callId = normalizeId(call?.id);
            const results = callId ? toolResultsByCallId.get(callId) || [] : [];
            results.forEach((res) => {
              const mid = normalizeId(res?.id);
              if (mid) consumedToolMessageIds.add(mid);
            });

            const nameFromCall = getToolName(call);
            const nameFromResult =
              results.length > 0 && typeof results?.[0]?.toolName === 'string'
                ? results[0].toolName.trim()
                : '';
            const name = nameFromCall || nameFromResult || 'tool';

            return {
              callId,
              name,
              args: getToolArgs(call),
              resultText: getToolResultText(results),
              key: callId || `${normalizeId(msg?.id) || `assistant_${msgIdx}`}_${name}_${idx}`,
            };
          });

          out.push({
            type: 'tool_invocations',
            key: `${normalizeId(msg?.id) || `assistant_${msgIdx}`}_tool_invocations`,
            invocations,
            assistantId: normalizeId(msg?.id),
          });
        }

        return;
      }

      if (msg.role === 'tool') {
        const mid = normalizeId(msg?.id);
        if (mid && consumedToolMessageIds.has(mid)) {
          return;
        }
        const last = out[out.length - 1];
        if (last && last.type === 'tool_orphans') {
          last.results.push(msg);
          return;
        }
        out.push({ type: 'tool_orphans', key: mid || `tool_${msgIdx}`, results: [msg] });
      }
    });

    return out;
  }, [list]);

  const hasBlocks = blocks.length > 0;
  const isStreaming = Boolean(
    streaming?.messageId &&
      list.some((m) => normalizeId(m?.id) === normalizeId(streaming.messageId))
  );

  const copyText = useMemo(() => {
    const parts = blocks
      .filter((b) => b?.type === 'assistant')
      .map((b) => (typeof b?.content === 'string' ? b.content : String(b?.content || '')))
      .map((text) => text.trim())
      .filter(Boolean);
    return parts.join('\n\n');
  }, [blocks]);

  const onCopy = async () => {
    if (!copyText || copying) return;
    setCopying(true);
    try {
      await copyPlainText(copyText);
      message.success('已复制');
    } catch (err) {
      message.error(err?.message || '复制失败');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div style={{ width: '100%', padding: '4px 0' }}>
      <Space size={8} wrap>
        <Tag color="green" style={{ marginRight: 0 }}>
          AI
        </Tag>
        {timeText ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {timeText}
          </Text>
        ) : null}
        {isStreaming ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            （输出中…）
          </Text>
        ) : null}
      </Space>

      <div style={{ marginTop: 6 }}>
        {hasBlocks ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {blocks.map((block) => {
              if (block.type === 'assistant') {
                return <MarkdownBlock key={block.key} text={block.content} alwaysExpanded container={false} copyable />;
              }

              if (block.type === 'assistant_reasoning') {
                const reasoningText =
                  typeof block?.content === 'string' ? block.content : String(block?.content || '');
                const previewRaw = reasoningText.trim().replace(/\s+/g, ' ').slice(0, 86);
                const preview =
                  previewRaw && reasoningText.trim().length > previewRaw.length ? `${previewRaw}…` : previewRaw;

                return (
                  <Collapse
                    key={block.key}
                    ghost
                    size="small"
                    items={[
                      {
                        key: 'reasoning',
                        label: (
                          <Space size={6} wrap>
                            <Tag color="gold" style={{ marginRight: 0 }}>
                              思考过程
                            </Tag>
                            {preview ? <Text type="secondary">{preview}</Text> : null}
                          </Space>
                        ),
                        children: (
                          <MarkdownBlock text={reasoningText} maxHeight={240} alwaysExpanded container={false} copyable />
                        ),
                      },
                    ]}
                  />
                );
              }

              if (block.type === 'tool_invocations') {
                return (
                  <Space key={block.key} size={[4, 4]} wrap>
                    {(Array.isArray(block.invocations) ? block.invocations : []).map((invocation, idx) => {
                      const name = invocation?.name || 'tool';
                      const callId = normalizeId(invocation?.callId);
                      const args = typeof invocation?.args === 'string' ? invocation.args : String(invocation?.args || '');
                      const resultText =
                        typeof invocation?.resultText === 'string'
                          ? invocation.resultText
                          : String(invocation?.resultText || '');
                      const argsInfo = parseToolArgsText(args);
                      const toolKind = inferToolKind(name);
                      const shellResult = toolKind === 'shell' ? parseShellResult(resultText) : null;
                      const status = inferToolStatus(resultText, shellResult);
                      const subtitle = buildToolSubtitle(name, argsInfo.parsed);
                      const color = pickStatusColor(status);
                      const key = invocation?.key || callId || `${block.assistantId || block.key}_${name}_${idx}`;
                      const title = `${name}${callId ? ` · ${callId}` : ''}`;

                      return (
                        <PopoverTag
                          key={key}
                          color={color}
                          text={name}
                          title={title}
                          subtitle={subtitle}
                          status={status}
                          kind={toolKind}
                        >
                          {renderToolDetails({
                            toolKind,
                            argsRaw: argsInfo.raw,
                            argsParsed: argsInfo.parsed,
                            resultText,
                            shellResult,
                          })}
                        </PopoverTag>
                      );
                    })}
                  </Space>
                );
              }

              if (block.type === 'tool_orphans') {
                return (
                  <Space key={block.key} size={[4, 4]} wrap>
                    {(Array.isArray(block.results) ? block.results : []).map((result, idx) => {
                      const name = typeof result?.toolName === 'string' ? result.toolName.trim() : '';
                      const callId = normalizeId(result?.toolCallId);
                      const content = typeof result?.content === 'string' ? result.content : String(result?.content || '');
                      const toolKind = inferToolKind(name);
                      const shellResult = toolKind === 'shell' ? parseShellResult(content) : null;
                      const status = inferToolStatus(content, shellResult);
                      const color = pickStatusColor(status);
                      const key = normalizeId(result?.id) || `${name || 'tool'}_${callId || ''}_${idx}`;
                      const title = `${name || 'tool'}${callId ? ` · ${callId}` : ''}`;

                      return (
                        <PopoverTag
                          key={key}
                          color={color}
                          text={name || 'tool'}
                          title={title}
                          status={status}
                          kind={toolKind}
                        >
                          {renderToolDetails({
                            toolKind,
                            argsRaw: '',
                            argsParsed: null,
                            resultText: content,
                            shellResult,
                          })}
                        </PopoverTag>
                      );
                    })}
                  </Space>
                );
              }

              return null;
            })}
          </Space>
        ) : (
          <Text type="secondary">（无内容）</Text>
        )}
      </div>

      {copyText ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopy} loading={copying}>
            复制全部
          </Button>
        </div>
      ) : null}
    </div>
  );
}

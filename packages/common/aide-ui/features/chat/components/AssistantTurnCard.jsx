import React, { useMemo, useState } from 'react';
import { Button, Collapse, Space, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

import { MarkdownBlock } from '../../../components/MarkdownBlock.jsx';
import { copyPlainText } from '../../../lib/clipboard.js';
import { normalizeId } from '../../../../text-utils.js';

const { Text } = Typography;

function formatTime(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString();
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

        return;
      }

      if (msg.role === 'tool') return;
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
    <div className={`ds-chat-assistant${isStreaming ? ' is-streaming' : ''}`} style={{ width: '100%' }}>
      <div className="ds-chat-assistant-inner">
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
            <Text type="secondary" className="ds-chat-streaming-indicator" style={{ fontSize: 12 }}>
              （输出中…）
            </Text>
          ) : null}
        </Space>

        <div style={{ marginTop: 4 }}>
          {hasBlocks ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {blocks.map((block) => {
                if (block.type === 'assistant') {
                  return (
                    <MarkdownBlock key={block.key} text={block.content} alwaysExpanded container={false} showCodeActions={false} />
                  );
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
                            <MarkdownBlock text={reasoningText} maxHeight={240} alwaysExpanded container={false} showCodeActions={false} />
                          ),
                        },
                      ]}
                    />
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
              复制本轮
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

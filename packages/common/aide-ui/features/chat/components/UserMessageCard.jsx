import React, { useMemo } from 'react';
import { Space, Tag, Typography } from 'antd';

import { MarkdownBlock } from '../../../components/MarkdownBlock.jsx';
import { normalizeId } from '../../../../text-utils.js';
import { extractFileTags } from '../file-tags.js';

const { Text } = Typography;

function formatTime(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString();
}

export function UserMessageCard({ message }) {
  const createdAt = message?.createdAt;
  const timeText = useMemo(() => (createdAt ? formatTime(createdAt) : ''), [createdAt]);
  const contentRaw = typeof message?.content === 'string' ? message.content : String(message?.content || '');
  const { text: content, files: fileTags } = useMemo(() => extractFileTags(contentRaw), [contentRaw]);
  const hasContent = Boolean(content && content.trim());
  const hasFileTags = fileTags.length > 0;
  const images = useMemo(() => {
    const list = Array.isArray(message?.attachments) ? message.attachments : [];
    return list.filter(
      (att) =>
        att?.type === 'image' &&
        typeof att?.dataUrl === 'string' &&
        att.dataUrl.startsWith('data:image/')
    );
  }, [message?.attachments]);

  return (
    <div style={{ width: '100%', padding: '2px 0' }}>
      <Space size={8} wrap>
        <Tag color="blue" style={{ marginRight: 0 }}>
          你
        </Tag>
        {timeText ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {timeText}
          </Text>
        ) : null}
      </Space>

      <div style={{ marginTop: 4 }}>
        {hasFileTags ? (
          <div style={{ marginBottom: hasContent ? 6 : 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {fileTags.map((file) => (
              <Tag key={file} color="geekblue" style={{ marginRight: 0 }} title={file}>
                {file}
              </Tag>
            ))}
          </div>
        ) : null}
        {hasContent ? <MarkdownBlock text={content} alwaysExpanded container={false} /> : null}
        {!hasContent && images.length > 0 ? null : !hasContent && !hasFileTags ? <Text type="secondary">（空）</Text> : null}
        {images.length > 0 ? (
          <div style={{ marginTop: hasContent || hasFileTags ? 8 : 0, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {images.map((img) => (
              <a
                key={normalizeId(img.id) || img.dataUrl}
                href={img.dataUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block' }}
              >
                <img
                  src={img.dataUrl}
                  alt={img.name || 'image'}
                  style={{
                    maxWidth: 240,
                    maxHeight: 180,
                    borderRadius: 10,
                    border: '1px solid var(--ds-panel-border)',
                    background: 'var(--ds-panel-bg)',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

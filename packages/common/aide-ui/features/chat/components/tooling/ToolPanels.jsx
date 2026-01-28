import React from 'react';
import { Collapse, Typography } from 'antd';

import { truncateText } from '../../../../lib/format.js';
import { parseJsonSafe } from '../../../../lib/parse.js';

const { Text } = Typography;

export function ToolSection({ title, children }) {
  return (
    <div className="ds-tool-section">
      <div className="ds-tool-section-title">{title}</div>
      {children}
    </div>
  );
}

function isPrimitive(value) {
  return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
}

function pickObjectLabel(value) {
  if (!value || typeof value !== 'object') return '';
  const keys = ['title', 'name', 'label', 'path', 'id', 'url', 'file', 'command', 'task'];
  for (const key of keys) {
    const entry = value?.[key];
    if (typeof entry === 'string' && entry.trim()) return entry.trim();
    if (typeof entry === 'number') return String(entry);
  }
  return '';
}

function formatInlineValue(value, maxLen = 120) {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return truncateText(value, maxLen);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const primitives = value.filter(isPrimitive).slice(0, 3).map((item) => formatInlineValue(item, 40));
    if (primitives.length > 0) {
      return truncateText(`Array(${value.length}): ${primitives.join(', ')}`, maxLen);
    }
    return `Array(${value.length})`;
  }
  if (typeof value === 'object') {
    const label = pickObjectLabel(value);
    if (label) return truncateText(label, maxLen);
    const keys = Object.keys(value);
    return `Object(${keys.length})`;
  }
  return truncateText(String(value), maxLen);
}

function buildObjectSummary(value, maxKeys = 8) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { items: [], hidden: 0 };
  const entries = Object.entries(value).filter(([key]) => key && key !== '__proto__');
  const items = entries.slice(0, maxKeys).map(([key, val]) => ({
    label: key,
    value: formatInlineValue(val, 120),
  }));
  const hidden = Math.max(entries.length - items.length, 0);
  return { items, hidden };
}

function summarizeObjectInline(value, maxPairs = 3) {
  if (!value || typeof value !== 'object') return '';
  const entries = Object.entries(value).filter(([key]) => key && key !== '__proto__');
  const parts = entries.slice(0, maxPairs).map(([key, val]) => `${key}: ${formatInlineValue(val, 60)}`);
  return parts.join(' · ');
}

function buildArrayItems(value, maxItems = 8) {
  const list = Array.isArray(value) ? value : [];
  const items = list.slice(0, maxItems).map((item, idx) => {
    if (isPrimitive(item)) {
      return {
        key: `item-${idx}`,
        title: formatInlineValue(item, 140) || `item ${idx + 1}`,
      };
    }
    if (item && typeof item === 'object') {
      const title = pickObjectLabel(item) || `item ${idx + 1}`;
      const subtitle = summarizeObjectInline(item);
      return {
        key: item.id || `${title}-${idx}`,
        title: truncateText(title, 140),
        subtitle: subtitle ? truncateText(subtitle, 180) : '',
      };
    }
    return { key: `item-${idx}`, title: formatInlineValue(item, 140) || `item ${idx + 1}` };
  });
  if (list.length > maxItems) {
    items.push({
      key: 'more',
      title: `... (${list.length - maxItems} more)`,
    });
  }
  return items;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function normalizeSummaryKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

export function ToolSummary({ items = [], className = '', variant }) {
  const list = (Array.isArray(items) ? items : []).filter((item) => item && item.value !== '');
  if (list.length === 0) return null;
  const summaryClassName = ['ds-tool-summary', className].filter(Boolean).join(' ');
  const dataVariant = typeof variant === 'string' && variant.trim() ? variant.trim() : undefined;
  return (
    <div className={summaryClassName} data-variant={dataVariant}>
      {list.map((item, idx) => (
        <div
          key={`${item.label}-${idx}`}
          className="ds-tool-summary-item"
          data-tone={item.tone || undefined}
          data-key={normalizeSummaryKey(item.key || item.label) || undefined}
        >
          <div className="ds-tool-summary-label">{item.label}</div>
          <div className="ds-tool-summary-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function ToolList({ items = [] }) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div className="ds-tool-list">
      {list.map((item, idx) => {
        const key = item.key ?? `${item.title || 'item'}-${idx}`;
        return (
          <div key={key} className="ds-tool-list-item" data-tone={item.tone || undefined}>
            {item.icon ? <span className="ds-tool-list-icon">{item.icon}</span> : null}
            <div className="ds-tool-list-content">
              {item.title ? <div className="ds-tool-list-title">{item.title}</div> : null}
              {item.subtitle ? <div className="ds-tool-list-subtitle">{item.subtitle}</div> : null}
            </div>
            {item.meta ? <div className="ds-tool-list-meta">{item.meta}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function ToolBlock({ text, tone }) {
  if (!text) return <Text type="secondary">（空）</Text>;
  return (
    <pre className="ds-tool-block" data-tone={tone || undefined}>
      {text}
    </pre>
  );
}

export function ToolJsonPreview({
  text,
  value,
  tone,
  emptyText = '（暂无数据）',
  maxKeys = 8,
  maxItems = 8,
  rawLabel = '原始 JSON',
  showRawToggle = true,
  renderFallback,
}) {
  const rawText =
    typeof text === 'string'
      ? text.trim()
      : value !== undefined && value !== null && typeof value !== 'object'
        ? String(value).trim()
        : '';
  const parsed =
    value && typeof value === 'object'
      ? value
      : rawText
        ? parseJsonSafe(rawText, null)
        : null;
  const isJson = parsed && typeof parsed === 'object';

  if (!isJson) {
    if (rawText) {
      return renderFallback ? renderFallback(rawText) : <ToolBlock text={rawText} tone={tone} />;
    }
    return <Text type="secondary">{emptyText}</Text>;
  }

  const rawJson = rawText || safeStringify(parsed);
  const isArray = Array.isArray(parsed);
  const { items, hidden } = isArray ? { items: [], hidden: 0 } : buildObjectSummary(parsed, maxKeys);
  const listItems = isArray ? buildArrayItems(parsed, maxItems) : [];
  const hasSummary = isArray ? parsed.length > 0 : items.length > 0;
  const summaryItems = isArray
    ? [{ label: 'count', value: String(parsed.length) }]
    : hidden > 0
      ? [...items, { label: '...', value: `${hidden} more` }]
      : items;

  return (
    <div className="ds-tool-json-summary">
      {hasSummary ? (
        isArray ? (
          <ToolSummary items={summaryItems} />
        ) : (
          <ToolSummary items={summaryItems} />
        )
      ) : (
        <Text type="secondary">{Array.isArray(parsed) ? '（空数组）' : '（空对象）'}</Text>
      )}
      {isArray && listItems.length > 0 ? <ToolList items={listItems} /> : null}
      {showRawToggle && rawJson ? (
        <Collapse
          ghost
          size="small"
          className="ds-tool-json-collapse"
          items={[
            {
              key: 'raw',
              label: rawLabel,
              children: <ToolBlock text={rawJson} tone={tone} />,
            },
          ]}
        />
      ) : null}
    </div>
  );
}

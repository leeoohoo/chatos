import React from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

export function ToolSection({ title, children }) {
  return (
    <div className="ds-tool-section">
      <div className="ds-tool-section-title">{title}</div>
      {children}
    </div>
  );
}

export function ToolSummary({ items = [] }) {
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

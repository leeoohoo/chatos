import React, { useMemo, useState } from 'react';
import { Popover } from 'antd';
import {
  ApiOutlined,
  BuildOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FormOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { inferToolKind, normalizeToolStatus } from '../../../lib/tooling-utils.js';

const TOOL_KIND_META = {
  shell: { label: 'Shell', icon: CodeOutlined },
  filesystem: { label: '文件', icon: FolderOpenOutlined },
  lsp: { label: 'LSP', icon: ApiOutlined },
  task: { label: '任务', icon: CheckCircleOutlined },
  subagent: { label: 'Agent', icon: RobotOutlined },
  prompt: { label: 'Prompt', icon: FormOutlined },
  journal: { label: '日志', icon: FileTextOutlined },
  browser: { label: '浏览器', icon: ThunderboltOutlined },
  code_maintainer: { label: '维护', icon: BuildOutlined },
  default: { label: '工具', icon: ToolOutlined },
};

const STATUS_META = {
  ok: { label: '完成' },
  pending: { label: '处理中' },
  error: { label: '失败' },
  canceled: { label: '已取消' },
  timeout: { label: '超时' },
  partial: { label: '部分完成' },
};

function normalizeToken(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value) {
  return normalizeToken(value).toLowerCase();
}

function splitTitle(rawTitle) {
  const title = normalizeToken(rawTitle);
  if (!title) return { title: '', subtitle: '' };
  const parts = title.split(' · ');
  if (parts.length >= 2) {
    return { title: parts[0], subtitle: parts.slice(1).join(' · ') };
  }
  return { title, subtitle: '' };
}

export function PopoverTag({
  open: openProp,
  onOpenChange,
  color,
  text,
  dataToolName,
  title,
  subtitle,
  badgeSubtitle,
  status,
  kind,
  icon,
  actions,
  children,
  maxWidth = 720,
  maxHeight = 360,
  placement,
  autoAdjustOverflow = true,
  hideHeader = false,
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const safeText = normalizeToken(text) || 'tool';
  const safeTextLower = safeText.toLowerCase();
  const dataToolNameText = normalizeToken(dataToolName) || safeText;
  const dataToolNameLower = dataToolNameText.toLowerCase();
  const requestedKind = normalizeLower(kind);
  const derivedKind = TOOL_KIND_META[requestedKind] ? requestedKind : inferToolKind(safeText);
  const normalizedStatus = normalizeToolStatus(status, { color, fallback: 'unknown' });
  const { title: titleMain, subtitle: titleSubtitle } = splitTitle(title);
  const headerTitle = titleMain || safeText;
  const headerSubtitle = normalizeToken(subtitle) || titleSubtitle;
  const kindMeta = TOOL_KIND_META[derivedKind] || TOOL_KIND_META.default;
  const Icon = kindMeta.icon || ToolOutlined;
  const resolvedIcon = icon ?? <Icon />;
  const statusMeta = STATUS_META[normalizedStatus] || null;
  const popoverClassName = [
    'ds-tool-popover',
    `ds-tool-popover-kind-${derivedKind}`,
    normalizedStatus ? `ds-tool-popover-status-${normalizedStatus}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleOpenChange = (next) => {
    if (openProp === undefined) {
      setInnerOpen(next);
    }
    if (typeof onOpenChange === 'function') {
      onOpenChange(next);
    }
  };
  const open = openProp === undefined ? innerOpen : openProp;
  const badgeSubtitleText = useMemo(() => normalizeToken(badgeSubtitle), [badgeSubtitle]);

  const resolvedMaxWidth = typeof maxWidth === 'number' ? `min(${maxWidth}px, 92vw)` : maxWidth;
  const resolvedMaxHeight = typeof maxHeight === 'number' ? `min(${maxHeight}px, 78vh)` : maxHeight;
  const overlayStyle = resolvedMaxWidth ? { maxWidth: resolvedMaxWidth } : undefined;

  const headerNode = hideHeader ? null : (
    <div className="ds-tool-popover-header">
      <div className="ds-tool-popover-title">
        <span className="ds-tool-popover-icon">
          {resolvedIcon}
        </span>
        <div className="ds-tool-popover-text">
          <div className="ds-tool-popover-name">{headerTitle}</div>
          {headerSubtitle ? <div className="ds-tool-popover-subtitle">{headerSubtitle}</div> : null}
        </div>
      </div>
      <div className="ds-tool-popover-meta">
        <div className="ds-tool-popover-chips">
          <span className="ds-tool-chip" data-kind={derivedKind}>
            {kindMeta.label}
          </span>
          {statusMeta ? (
            <span className="ds-tool-chip" data-status={normalizedStatus}>
              {statusMeta.label}
            </span>
          ) : null}
        </div>
        {actions ? <div className="ds-tool-popover-actions">{actions}</div> : null}
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={handleOpenChange}
      placement={placement}
      autoAdjustOverflow={autoAdjustOverflow}
      overlayStyle={overlayStyle}
      classNames={{ root: popoverClassName }}
      title={headerNode}
      content={
        <div
          className="ds-tool-popover-body"
          style={{
            maxWidth: resolvedMaxWidth,
            width: '100%',
            maxHeight: resolvedMaxHeight,
            overflow: 'auto',
          }}
        >
          {children}
        </div>
      }
    >
      <button
        type="button"
        className="ds-tool-badge"
        data-kind={derivedKind}
        data-status={normalizedStatus}
        data-tool-name={dataToolNameLower}
        aria-label={headerTitle}
      >
        <span className="ds-tool-dot" />
        <span className="ds-tool-icon">
          {resolvedIcon}
        </span>
        <span className="ds-tool-badge-text">
          <span className="ds-tool-badge-label">{safeText}</span>
          {badgeSubtitleText ? <span className="ds-tool-badge-subtitle">{badgeSubtitleText}</span> : null}
        </span>
      </button>
    </Popover>
  );
}

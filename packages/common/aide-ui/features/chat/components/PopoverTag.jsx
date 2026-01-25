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

function inferToolKind(text) {
  const raw = normalizeLower(text);
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

function normalizeStatus(status, color) {
  const raw = normalizeLower(status);
  if (raw && Object.prototype.hasOwnProperty.call(STATUS_META, raw)) return raw;
  const tone = normalizeLower(color);
  if (tone === 'gold' || tone === 'yellow') return 'pending';
  if (tone === 'red' || tone === 'volcano') return 'error';
  if (tone === 'green' || tone === 'purple' || tone === 'geekblue') return 'ok';
  return 'unknown';
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
  title,
  subtitle,
  badgeSubtitle,
  status,
  kind,
  actions,
  children,
  maxWidth = 720,
  maxHeight = 360,
  placement,
  autoAdjustOverflow = true,
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const safeText = normalizeToken(text) || 'tool';
  const requestedKind = normalizeLower(kind);
  const derivedKind = TOOL_KIND_META[requestedKind] ? requestedKind : inferToolKind(safeText);
  const normalizedStatus = normalizeStatus(status, color);
  const { title: titleMain, subtitle: titleSubtitle } = splitTitle(title);
  const headerTitle = titleMain || safeText;
  const headerSubtitle = normalizeToken(subtitle) || titleSubtitle;
  const kindMeta = TOOL_KIND_META[derivedKind] || TOOL_KIND_META.default;
  const Icon = kindMeta.icon || ToolOutlined;
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

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={handleOpenChange}
      placement={placement}
      autoAdjustOverflow={autoAdjustOverflow}
      classNames={{ root: popoverClassName }}
      title={
        <div className="ds-tool-popover-header">
          <div className="ds-tool-popover-title">
            <span className="ds-tool-popover-icon">
              <Icon />
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
      }
      content={
        <div className="ds-tool-popover-body" style={{ maxWidth: resolvedMaxWidth, maxHeight: resolvedMaxHeight, overflow: 'auto' }}>
          {children}
        </div>
      }
    >
      <button
        type="button"
        className="ds-tool-badge"
        data-kind={derivedKind}
        data-status={normalizedStatus}
        aria-label={headerTitle}
      >
        <span className="ds-tool-dot" />
        <span className="ds-tool-icon">
          <Icon />
        </span>
        <span className="ds-tool-badge-text">
          <span className="ds-tool-badge-label">{safeText}</span>
          {badgeSubtitleText ? <span className="ds-tool-badge-subtitle">{badgeSubtitleText}</span> : null}
        </span>
      </button>
    </Popover>
  );
}

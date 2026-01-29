import React, { useMemo, useState } from 'react';
import { Button, Drawer, Space, Tooltip, message } from 'antd';
import { CopyOutlined, ExpandOutlined } from '@ant-design/icons';

import { copyPlainText } from '../../../../lib/clipboard.js';
import { truncateText } from '../../../../lib/format.js';
import { PopoverTag } from '../PopoverTag.jsx';
import { ToolDetails } from './ToolDetailPanels.jsx';
import { buildToolPresentation } from './tool-utils.js';
import { formatJson } from './details/detail-utils.js';
import runSubAgentIconSpin from '../../../../../../../assets/robot_head_spin.svg';
import runSubAgentIconStatic from '../../../../../../../assets/robot_head_static.svg';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickToolStructuredContent(results = []) {
  const list = Array.isArray(results) ? results : [];
  for (const msg of list) {
    const value = msg?.toolStructuredContent ?? msg?.structuredContent;
    if (value && typeof value === 'object') {
      return value;
    }
  }
  return null;
}

function pickToolIsError(results = []) {
  const list = Array.isArray(results) ? results : [];
  return list.some((msg) => msg?.toolIsError === true);
}

function buildDrawerTitle(name, callId) {
  const safeName = normalizeText(name) || 'tool';
  const safeCallId = normalizeText(callId);
  return safeCallId ? `${safeName} · ${safeCallId}` : safeName;
}

function buildCopyResultText(resultText, structuredContent) {
  const normalized = typeof resultText === 'string' ? resultText.trim() : '';
  if (normalized) return normalized;
  const structuredText = structuredContent ? formatJson(structuredContent) : '';
  return structuredText || '';
}

export function ToolInvocationTag({
  name,
  callId,
  argsText,
  resultText,
  results,
  liveSteps,
  fileChanges,
  structuredContent,
  toolIsError,
  maxWidth = 720,
  maxHeight = 360,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const toolNameText = normalizeText(name).toLowerCase();
  const isRunSubAgent = toolNameText.includes('run_sub_agent');
  const resolvedStructuredContent = structuredContent ?? pickToolStructuredContent(results);
  const resolvedIsError = toolIsError === true || pickToolIsError(results);

  const presentation = useMemo(
    () =>
      buildToolPresentation({
        toolName: name,
        argsText,
        resultText,
        structuredContent: resolvedStructuredContent,
        toolIsError: resolvedIsError,
      }),
    [argsText, name, resolvedIsError, resolvedStructuredContent, resultText]
  );

  const { argsInfo, toolKind, shellResult, status, subtitle, color } = presentation;
  const isSubagent = toolKind === 'subagent';
  const hidePopoverHeader = isSubagent && isRunSubAgent;
  const popoverMaxWidth = isRunSubAgent ? 960 : maxWidth;
  const popoverMaxHeight = isRunSubAgent ? 520 : maxHeight;
  const popoverPlacement = isSubagent ? 'bottomLeft' : undefined;
  const drawerWidth = isSubagent ? '100vw' : 780;
  const drawerClassName = isSubagent
    ? 'ds-tool-drawer ds-tool-drawer-wide ds-tool-drawer-full ds-tool-drawer-subagent'
    : 'ds-tool-drawer';
  const badgeSubtitle = subtitle ? truncateText(subtitle, 28) : '';
  const title = buildDrawerTitle(name, callId);
  const copyableArgs = normalizeText(argsInfo?.raw);
  const copyableResult = buildCopyResultText(resultText, resolvedStructuredContent);
  const canCopyArgs = Boolean(copyableArgs);
  const canCopyResult = Boolean(copyableResult);
  const canExpand =
    isSubagent ||
    (copyableArgs && copyableArgs.length > 320) ||
    (copyableResult && copyableResult.length > 320) ||
    Boolean(resolvedStructuredContent);
  const drawerStyles = isRunSubAgent
    ? {
        header: { display: 'none' },
        body: { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' },
      }
    : undefined;
  const drawerTitle = isRunSubAgent ? null : title;
  const runSubAgentIcon = isRunSubAgent ? (
    <img
      className="ds-tool-icon-img"
      src={status === 'pending' ? runSubAgentIconSpin : runSubAgentIconStatic}
      alt=""
      aria-hidden="true"
    />
  ) : null;

  const onCopyArgs = async () => {
    if (!copyableArgs) return;
    try {
      await copyPlainText(copyableArgs);
      message.success('已复制参数');
    } catch (err) {
      message.error(err?.message || '复制失败');
    }
  };

  const onCopyResult = async () => {
    if (!copyableResult) return;
    try {
      await copyPlainText(copyableResult);
      message.success('已复制结果');
    } catch (err) {
      message.error(err?.message || '复制失败');
    }
  };

  const drawerExtra = isRunSubAgent ? null : (
    <Space size={6}>
      {canCopyArgs ? (
        <Button size="small" icon={<CopyOutlined />} onClick={onCopyArgs}>
          参数
        </Button>
      ) : null}
      {canCopyResult ? (
        <Button size="small" icon={<CopyOutlined />} onClick={onCopyResult}>
          结果
        </Button>
      ) : null}
    </Space>
  );

  const onExpand = () => {
    setPopoverOpen(false);
    setDrawerOpen(true);
  };
  const onCloseDrawer = () => setDrawerOpen(false);

  const actions = (
    <Space size={4} className="ds-tool-popover-actions">
      {canCopyArgs ? (
        <Tooltip title="复制参数">
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopyArgs} className="ds-tool-action-btn" />
        </Tooltip>
      ) : null}
      {canCopyResult ? (
        <Tooltip title="复制结果">
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopyResult} className="ds-tool-action-btn" />
        </Tooltip>
      ) : null}
      {canExpand ? (
        <Tooltip title="展开详情">
          <Button size="small" type="text" icon={<ExpandOutlined />} onClick={onExpand} className="ds-tool-action-btn" />
        </Tooltip>
      ) : null}
    </Space>
  );

  return (
    <>
      <PopoverTag
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        color={color}
        text={name || 'tool'}
        title={title}
        subtitle={subtitle}
        badgeSubtitle={badgeSubtitle}
        status={status}
        kind={toolKind}
        icon={runSubAgentIcon}
        actions={actions}
        maxWidth={popoverMaxWidth}
        maxHeight={popoverMaxHeight}
        placement={popoverPlacement}
        hideHeader={hidePopoverHeader}
      >
        <ToolDetails
          toolName={name}
          toolKind={toolKind}
          argsRaw={argsInfo.raw}
          argsParsed={argsInfo.parsed}
          resultText={resultText}
        shellResult={shellResult}
        structuredContent={resolvedStructuredContent}
        liveSteps={liveSteps}
        fileChanges={fileChanges}
        display="popover"
        callId={callId}
        status={status}
        canCopyArgs={canCopyArgs}
          canCopyResult={canCopyResult}
          canExpand={canExpand}
          onCopyArgs={onCopyArgs}
          onCopyResult={onCopyResult}
          onExpand={onExpand}
        />
      </PopoverTag>
      <Drawer
        open={drawerOpen}
        onClose={onCloseDrawer}
        width={drawerWidth}
        destroyOnClose
        className={drawerClassName}
        title={drawerTitle}
        extra={drawerExtra}
        closable={!isRunSubAgent}
        styles={drawerStyles}
      >
        <ToolDetails
          toolName={name}
          toolKind={toolKind}
          argsRaw={argsInfo.raw}
          argsParsed={argsInfo.parsed}
          resultText={resultText}
          shellResult={shellResult}
          structuredContent={resolvedStructuredContent}
          liveSteps={liveSteps}
          fileChanges={fileChanges}
          display="drawer"
          callId={callId}
          status={status}
          onClose={onCloseDrawer}
        />
      </Drawer>
    </>
  );
}

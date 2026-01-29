import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Collapse, Input, InputNumber, Popconfirm, Select, Space, Switch, Tag, Typography, message } from 'antd';

import {
  FLOATING_ISLAND_COLLAPSED_STORAGE_KEY,
  RUN_FILTER_ALL,
  RUN_FILTER_AUTO,
  RUN_FILTER_UNKNOWN,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from '../../lib/storage.js';
import { normalizeRunId } from '../../lib/runs.js';
import { isActionablePromptKind } from '../../lib/ui-prompts.js';
import { formatAideDropText, getAideDragPayload, getAideDragText } from '../../lib/dnd.js';
import { FloatingIslandPrompt } from './floating-island/FloatingIslandPrompt.jsx';
import {
  coerceRuntimeNumber,
  normalizeMcpLogLevel,
  normalizePromptLogMode,
  normalizeShellSafetyMode,
  normalizeSymlinkPolicy,
  normalizeUiTerminalMode,
} from '../../../runtime-settings-utils.js';

const { Text } = Typography;
const { TextArea } = Input;

const FLOATING_SELECT_DROPDOWN_STYLE = { zIndex: 1301 };
const DEFAULT_ADVANCED_SETTINGS = {
  shellMaxBufferKb: 2048,
  filesystemMaxFileKb: 256,
  filesystemMaxWriteKb: 5120,
};

const getFloatingSelectContainer = (triggerNode) => {
  if (typeof document === 'undefined') return triggerNode?.parentElement || undefined;
  const inner = triggerNode?.closest?.('.ds-floating-island-inner');
  return inner || document.body;
};

function FloatingIsland({
  containerRef,
  input,
  onInputChange,
  onSend,
  onCorrect,
  onSummaryNow,
  sending,
  uiPrompt,
  uiPromptCount,
  onUiPromptRespond,
  runtimeSettings,
  onSaveSettings,
  landConfigs,
  runFilter,
  runOptions,
  onRunFilterChange,
  onOpenTasksDrawer,
  onClearCache,
  clearingCache,
  activeRunCwd,
  cwdPickerVisible,
  cwd,
  onPickCwd,
  onClearCwd,
  stopVisible,
  onStop,
  stopping,
  closeVisible,
  onClose,
  closing,
}) {
  const requestId = typeof uiPrompt?.requestId === 'string' ? uiPrompt.requestId.trim() : '';
  const prompt = uiPrompt?.prompt && typeof uiPrompt.prompt === 'object' ? uiPrompt.prompt : null;
  const promptKind = typeof prompt?.kind === 'string' ? prompt.kind.trim() : '';
  const promptActive = Boolean(requestId && isActionablePromptKind(promptKind, { includeResult: false }));
  const promptRunId = normalizeRunId(uiPrompt?.runId);
  const allowCancel = prompt?.allowCancel !== false;
  const pendingCount = Number.isFinite(Number(uiPromptCount)) ? Number(uiPromptCount) : 0;
  const [collapsed, setCollapsed] = useState(() => safeLocalStorageGet(FLOATING_ISLAND_COLLAPSED_STORAGE_KEY) === '1');
  const [dropActive, setDropActive] = useState(false);
  const dropCounterRef = useRef(0);
  const dispatchInputRef = useRef(null);

  useEffect(() => {
    safeLocalStorageSet(FLOATING_ISLAND_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    if (promptActive) setCollapsed(false);
  }, [promptActive, requestId]);

  const [settingsSaving, setSettingsSaving] = useState(false);

  const applyRuntimeSettingsPatch = async (patch) => {
    if (typeof onSaveSettings !== 'function') {
      message.error('IPC bridge not available');
      return;
    }
    if (!patch || typeof patch !== 'object') return;
    try {
      setSettingsSaving(true);
      await onSaveSettings(patch);
      message.success('已更新');
    } catch (err) {
      message.error(err?.message || '更新失败');
    } finally {
      setSettingsSaving(false);
    }
  };

  const confirmMainTaskCreate = runtimeSettings?.confirmMainTaskCreate === true;
  const confirmSubTaskCreate = runtimeSettings?.confirmSubTaskCreate === true;
  const confirmFileChanges = runtimeSettings?.confirmFileChanges === true;
  const landConfigId = typeof runtimeSettings?.landConfigId === 'string' ? runtimeSettings.landConfigId.trim() : '';
  const landConfigOptions = useMemo(() => {
    const list = Array.isArray(landConfigs) ? landConfigs : [];
    return list
      .filter((config) => config?.id)
      .map((config) => ({
        label: config?.name ? config.name : config?.id,
        value: config?.id,
      }));
  }, [landConfigs]);
  const landConfigIdSet = useMemo(
    () => new Set(landConfigOptions.map((option) => option.value).filter(Boolean)),
    [landConfigOptions]
  );
  const landConfigMissing = !landConfigId;
  const landConfigInvalid = Boolean(landConfigId && !landConfigIdSet.has(landConfigId));
  const landConfigHint = landConfigMissing
    ? landConfigOptions.length > 0
      ? '请先选择 land_config'
      : '暂无 land_config，请先在管理台创建'
    : '当前 land_config 已失效，请重新选择';
  const blockDispatch = landConfigMissing || landConfigInvalid;
  const uiTerminalMode = useMemo(() => {
    return normalizeUiTerminalMode(runtimeSettings?.uiTerminalMode, 'auto');
  }, [runtimeSettings]);
  const platformPrefersSystemTerminal = useMemo(() => {
    const platform = typeof navigator !== 'undefined' ? String(navigator.platform || '') : '';
    const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
    const haystack = `${platform} ${ua}`.toLowerCase();
    return haystack.includes('mac') || haystack.includes('win');
  }, []);
  const openSystemTerminalOnSend =
    uiTerminalMode === 'system' ? true : uiTerminalMode === 'headless' ? false : platformPrefersSystemTerminal;
  const shellSafetyMode = useMemo(() => {
    return normalizeShellSafetyMode(runtimeSettings?.shellSafetyMode, {
      allowAliases: true,
      fallback: 'strict',
    });
  }, [runtimeSettings]);
  const filesystemSymlinkPolicy = useMemo(() => {
    return normalizeSymlinkPolicy(runtimeSettings?.filesystemSymlinkPolicy, {
      allowAliases: true,
      fallback: 'allow',
    });
  }, [runtimeSettings]);
  const mcpToolLogLevel = useMemo(() => {
    return normalizeMcpLogLevel(runtimeSettings?.mcpToolLogLevel, 'info');
  }, [runtimeSettings]);
  const uiPromptLogMode = useMemo(() => {
    return normalizePromptLogMode(runtimeSettings?.uiPromptLogMode, 'full');
  }, [runtimeSettings]);
  const shellMaxBufferKb = useMemo(() => {
    const value = coerceRuntimeNumber(runtimeSettings?.shellMaxBufferBytes);
    return Number.isFinite(value)
      ? Math.max(16, Math.round(value / 1024))
      : DEFAULT_ADVANCED_SETTINGS.shellMaxBufferKb;
  }, [runtimeSettings]);
  const filesystemMaxFileKb = useMemo(() => {
    const value = coerceRuntimeNumber(runtimeSettings?.filesystemMaxFileBytes);
    return Number.isFinite(value)
      ? Math.max(1, Math.round(value / 1024))
      : DEFAULT_ADVANCED_SETTINGS.filesystemMaxFileKb;
  }, [runtimeSettings]);
  const filesystemMaxWriteKb = useMemo(() => {
    const value = coerceRuntimeNumber(runtimeSettings?.filesystemMaxWriteBytes);
    return Number.isFinite(value)
      ? Math.max(1, Math.round(value / 1024))
      : DEFAULT_ADVANCED_SETTINGS.filesystemMaxWriteKb;
  }, [runtimeSettings]);
  const shellSafetyOptions = [
    { label: 'Shell 严格', value: 'strict' },
    { label: 'Shell 宽松', value: 'relaxed' },
  ];
  const symlinkPolicyOptions = [
    { label: 'Symlink 允许', value: 'allow' },
    { label: 'Symlink 禁止逃逸', value: 'deny' },
  ];
  const mcpLogLevelOptions = [
    { label: 'MCP 日志: 关闭', value: 'off' },
    { label: 'MCP 日志: 普通', value: 'info' },
    { label: 'MCP 日志: 调试', value: 'debug' },
  ];
  const promptLogModeOptions = [
    { label: 'Prompt 日志: 完整', value: 'full' },
    { label: 'Prompt 日志: 最小', value: 'minimal' },
  ];

  const runLabel = useMemo(() => {
    const value = runFilter || RUN_FILTER_ALL;
    const options = Array.isArray(runOptions) ? runOptions : [];
    const found = options.find((opt) => opt && opt.value === value);
    if (found && typeof found.label === 'string' && found.label.trim()) return found.label.trim();
    return value;
  }, [runFilter, runOptions]);

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  const appendToInput = (text) => {
    if (typeof onInputChange !== 'function') return;
    const next = typeof text === 'string' ? text : '';
    if (!next.trim()) return;
    const current = typeof input === 'string' ? input : '';
    const separator = current && !current.endsWith('\n') ? '\n' : '';
    onInputChange(`${current || ''}${separator}${next}`);
    setTimeout(() => {
      dispatchInputRef.current?.focus?.();
    }, 0);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    dropCounterRef.current = 0;
    setDropActive(false);
    if (collapsed) setCollapsed(false);
    if (promptActive) {
      message.info('当前有待处理的确认项，暂不支持拖入输入框。');
      return;
    }

    const payload = getAideDragPayload(event);
    const formatted = payload ? formatAideDropText(payload) : '';
    const fallback = formatted || getAideDragText(event);
    if (!fallback || !fallback.trim()) return;
    appendToInput(fallback);
  };

  return (
    <div className="ds-floating-island" ref={containerRef}>
      <div
        className={`ds-floating-island-inner${collapsed ? ' is-collapsed' : ''}${dropActive ? ' is-drag-over' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          dropCounterRef.current += 1;
          setDropActive(true);
          if (collapsed) setCollapsed(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={() => {
          dropCounterRef.current = Math.max(0, dropCounterRef.current - 1);
          if (dropCounterRef.current === 0) setDropActive(false);
        }}
        onDrop={handleDrop}
      >
        <div
          className="ds-floating-island-handle"
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            e.preventDefault();
            toggleCollapsed();
          }}
        >
          <Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space size={8} align="center" wrap>
              <Text strong>灵动岛</Text>
              <Tag color="blue">
                <Text ellipsis={{ tooltip: runLabel }} style={{ maxWidth: 300 }}>
                  {runLabel}
                </Text>
              </Tag>
              {pendingCount > 0 ? <Tag color="purple">待处理 {pendingCount}</Tag> : null}
              {sending ? <Tag color="gold">发送中</Tag> : null}
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {collapsed ? '点击展开' : '点击收起'}
            </Text>
          </Space>
        </div>

        {collapsed ? null : (
          <div style={{ marginTop: 12 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space size={8} align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space size={8} align="center" wrap>
                  <Select
                    size="large"
                    value={landConfigId || ''}
                    onChange={(value) => applyRuntimeSettingsPatch({ landConfigId: value || '' })}
                    options={landConfigOptions}
                    style={{ minWidth: 220 }}
                    dropdownStyle={FLOATING_SELECT_DROPDOWN_STYLE}
                    getPopupContainer={getFloatingSelectContainer}
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择 land_config"
                    disabled={settingsSaving}
                  />
                  {blockDispatch ? <Text type="danger">{landConfigHint}</Text> : null}
                  <Select
                    size="large"
                    value={runFilter || RUN_FILTER_ALL}
                    onChange={(val) => (typeof onRunFilterChange === 'function' ? onRunFilterChange(val) : null)}
                    options={Array.isArray(runOptions) ? runOptions : [{ label: '全部终端', value: RUN_FILTER_ALL }]}
                    style={{ minWidth: 260 }}
                    dropdownStyle={FLOATING_SELECT_DROPDOWN_STYLE}
                    getPopupContainer={getFloatingSelectContainer}
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择终端(runId)"
                  />
                  {(() => {
                    const selected = typeof runFilter === 'string' ? runFilter.trim() : '';
                    const isConcrete =
                      selected &&
                      selected !== RUN_FILTER_AUTO &&
                      selected !== RUN_FILTER_ALL &&
                      selected !== RUN_FILTER_UNKNOWN;
                    if (!isConcrete) return null;
                    const cwdText = typeof activeRunCwd === 'string' ? activeRunCwd.trim() : '';
                    return (
                      <Text type="secondary" ellipsis={{ tooltip: cwdText || '未知' }} style={{ maxWidth: 420 }}>
                        目录: {cwdText || '未知'}
                      </Text>
                    );
                  })()}
                  <Button size="large" onClick={onOpenTasksDrawer}>
                    打开任务抽屉
                  </Button>
                  <Popconfirm
                    title="清除所有缓存?"
                    description="会移除任务列表、工具调用记录、会话/事件日志、文件改动记录与快照。"
                    okText="确认清除"
                    cancelText="再想想"
                    zIndex={1302}
                    onConfirm={onClearCache}
                  >
                    <Button size="large" danger loading={clearingCache}>
                      清除所有缓存
                    </Button>
                  </Popconfirm>
                  {cwdPickerVisible ? (
                    <Space size={6} align="center" wrap>
                      <Button size="large" onClick={onPickCwd}>
                        {cwd ? '更换目录' : '选择目录'}
                      </Button>
                      {cwd ? (
                        <Text type="secondary" ellipsis={{ tooltip: cwd }} style={{ maxWidth: 420 }}>
                          {cwd}
                        </Text>
                      ) : (
                        <Text type="secondary">未选择目录</Text>
                      )}
                      {cwd ? (
                        <Button size="large" onClick={onClearCwd}>
                          清除
                        </Button>
                      ) : null}
                    </Space>
                  ) : null}
                </Space>
              </Space>

              <Space size={10} align="center" wrap>
                <Text type="secondary">开关：</Text>
                <Space size={6} align="center">
                  <Switch
                    checked={confirmMainTaskCreate}
                    onChange={(checked) => applyRuntimeSettingsPatch({ confirmMainTaskCreate: checked })}
                    disabled={settingsSaving}
                  />
                  <Text>主流程任务创建确认</Text>
                </Space>
                <Space size={6} align="center">
                  <Switch
                    checked={confirmSubTaskCreate}
                    onChange={(checked) => applyRuntimeSettingsPatch({ confirmSubTaskCreate: checked })}
                    disabled={settingsSaving}
                  />
                  <Text>子流程任务创建确认</Text>
                </Space>
                <Space size={6} align="center">
                  <Switch
                    checked={confirmFileChanges}
                    onChange={(checked) => applyRuntimeSettingsPatch({ confirmFileChanges: checked })}
                    disabled={settingsSaving}
                  />
                  <Text>文件变更</Text>
                </Space>
                <Space size={6} align="center">
                  <Switch
                    checked={openSystemTerminalOnSend}
                    onChange={(checked) => applyRuntimeSettingsPatch({ uiTerminalMode: checked ? 'system' : 'headless' })}
                    disabled={settingsSaving}
                  />
                  <Text>拉起终端</Text>
                </Space>
              </Space>

              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'advanced',
                    label: '高级设置',
                    children: (
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Space size={10} align="center" wrap>
                          <Text type="secondary">安全/日志：</Text>
                          <Select
                            size="middle"
                            value={shellSafetyMode}
                            options={shellSafetyOptions}
                            onChange={(value) => applyRuntimeSettingsPatch({ shellSafetyMode: value })}
                            disabled={settingsSaving}
                            style={{ minWidth: 140 }}
                            dropdownStyle={FLOATING_SELECT_DROPDOWN_STYLE}
                            getPopupContainer={getFloatingSelectContainer}
                          />
                          <Select
                            size="middle"
                            value={filesystemSymlinkPolicy}
                            options={symlinkPolicyOptions}
                            onChange={(value) => applyRuntimeSettingsPatch({ filesystemSymlinkPolicy: value })}
                            disabled={settingsSaving}
                            style={{ minWidth: 160 }}
                            dropdownStyle={FLOATING_SELECT_DROPDOWN_STYLE}
                            getPopupContainer={getFloatingSelectContainer}
                          />
                          <Select
                            size="middle"
                            value={mcpToolLogLevel}
                            options={mcpLogLevelOptions}
                            onChange={(value) => applyRuntimeSettingsPatch({ mcpToolLogLevel: value })}
                            disabled={settingsSaving}
                            style={{ minWidth: 150 }}
                            dropdownStyle={FLOATING_SELECT_DROPDOWN_STYLE}
                            getPopupContainer={getFloatingSelectContainer}
                          />
                          <Select
                            size="middle"
                            value={uiPromptLogMode}
                            options={promptLogModeOptions}
                            onChange={(value) => applyRuntimeSettingsPatch({ uiPromptLogMode: value })}
                            disabled={settingsSaving}
                            style={{ minWidth: 150 }}
                            dropdownStyle={FLOATING_SELECT_DROPDOWN_STYLE}
                            getPopupContainer={getFloatingSelectContainer}
                          />
                        </Space>

                        <Space size={10} align="center" wrap>
                          <Text type="secondary">限制：</Text>
                          <Space size={6} align="center">
                            <Text>Shell 输出(KB)</Text>
                            <InputNumber
                              min={16}
                              max={51200}
                              step={64}
                              value={shellMaxBufferKb}
                              onChange={(value) =>
                                applyRuntimeSettingsPatch({
                                  shellMaxBufferBytes: Number.isFinite(value)
                                    ? Math.max(16, Math.round(value)) * 1024
                                    : DEFAULT_ADVANCED_SETTINGS.shellMaxBufferKb * 1024,
                                })
                              }
                              disabled={settingsSaving}
                            />
                          </Space>
                          <Space size={6} align="center">
                            <Text>文件读取(KB)</Text>
                            <InputNumber
                              min={1}
                              max={102400}
                              step={64}
                              value={filesystemMaxFileKb}
                              onChange={(value) => {
                                const nextKb = Number.isFinite(value)
                                  ? Math.max(1, Math.round(value))
                                  : DEFAULT_ADVANCED_SETTINGS.filesystemMaxFileKb;
                                const bytes = nextKb * 1024;
                                applyRuntimeSettingsPatch({ filesystemMaxFileBytes: bytes, filesystemMaxWriteBytes: bytes });
                              }}
                              disabled={settingsSaving}
                            />
                          </Space>
                          <Space size={6} align="center">
                            <Text>文件写入(KB)</Text>
                            <InputNumber
                              min={1}
                              max={102400}
                              step={128}
                              value={filesystemMaxWriteKb}
                              onChange={(value) => {
                                const nextKb = Number.isFinite(value)
                                  ? Math.max(1, Math.round(value))
                                  : DEFAULT_ADVANCED_SETTINGS.filesystemMaxWriteKb;
                                applyRuntimeSettingsPatch({ filesystemMaxWriteBytes: nextKb * 1024 });
                              }}
                              disabled={settingsSaving}
                            />
                          </Space>
                        </Space>
                      </Space>
                    ),
                  },
                ]}
              />

              {promptActive ? (
                <FloatingIslandPrompt
                  promptActive={promptActive}
                  promptKind={promptKind}
                  prompt={prompt}
                  requestId={requestId}
                  promptRunId={promptRunId}
                  allowCancel={allowCancel}
                  pendingCount={pendingCount}
                  onUiPromptRespond={onUiPromptRespond}
                />
              ) : (
                <>
                  <TextArea
                    className="ds-dispatch-input"
                    ref={dispatchInputRef}
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder={
                      stopVisible
                        ? '输入纠正内容...（Enter 纠正 / Shift+Enter 换行）'
                        : '输入要发送给 CLI 的内容...（Enter 发送 / Shift+Enter 换行）'
                    }
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      if (e.shiftKey) return;
                      e.preventDefault();
                      if (stopVisible) {
                        if (blockDispatch) {
                          message.warning(landConfigHint);
                          return;
                        }
                        if (typeof onCorrect === 'function') onCorrect();
                        return;
                      }
                      if (blockDispatch) {
                        message.warning(landConfigHint);
                        return;
                      }
                      if (typeof onSend === 'function') onSend();
                    }}
                    autoSize={{ minRows: 1, maxRows: 8 }}
                    style={{ width: '100%' }}
                    disabled={sending}
                    allowClear
                  />

                  <Space size={10} align="center" style={{ width: '100%', justifyContent: 'flex-end' }} wrap>
                    {closeVisible ? (
                      <Button size="large" danger loading={closing} onClick={onClose}>
                        关闭终端
                      </Button>
                    ) : null}
                    {stopVisible ? (
                      <Button size="large" danger loading={stopping} onClick={onStop}>
                        停止
                      </Button>
                    ) : null}
                    <Button
                      size="large"
                      onClick={() => (typeof onSummaryNow === 'function' ? onSummaryNow() : null)}
                      disabled={!closeVisible}
                    >
                      立即总结
                    </Button>
                    <Button
                      size="large"
                      danger
                      loading={sending}
                      onClick={() => {
                        if (blockDispatch) {
                          message.warning(landConfigHint);
                          return;
                        }
                        if (typeof onCorrect === 'function') onCorrect();
                      }}
                      disabled={!input || !input.trim() || blockDispatch}
                    >
                      纠正
                    </Button>
                    {stopVisible ? null : (
                      <Button
                        size="large"
                        type="primary"
                        loading={sending}
                        onClick={() => {
                          if (blockDispatch) {
                            message.warning(landConfigHint);
                            return;
                          }
                          onSend();
                        }}
                        disabled={!input || !input.trim() || blockDispatch}
                      >
                        发送
                      </Button>
                    )}
                  </Space>
                </>
              )}
            </Space>
          </div>
        )}
      </div>
    </div>
  );
}


export { FloatingIsland };

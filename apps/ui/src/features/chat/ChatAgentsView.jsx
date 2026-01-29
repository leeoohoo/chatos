import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  BarsOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FilterOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SortAscendingOutlined,
} from '@ant-design/icons';

import { normalizePromptLanguage } from 'mcp-utils.js';
import { normalizeId, normalizeKey } from 'text-utils.js';
import { AgentEditorModal } from './components/AgentEditorModal.jsx';
import { useChatAgents } from 'aide-ui/features/chat/hooks/useChatAgents.js';
import { useUiAppsRegistry } from 'aide-ui/features/apps/hooks/useUiAppsRegistry.js';

const { Text } = Typography;

function countList(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

function toUiAppKey(pluginId, appId) {
  const pid = typeof pluginId === 'string' ? pluginId.trim() : '';
  const aid = typeof appId === 'string' ? appId.trim() : '';
  if (!pid || !aid) return '';
  return `${pid}::${aid}`;
}

function resolveAgentStatus(agent) {
  const raw = typeof agent?.status === 'string' ? agent.status.trim().toLowerCase() : '';
  if (raw === 'active' || raw === 'draft' || raw === 'archived') return raw;
  if (agent?.archived === true) return 'archived';
  if (agent?.draft === true) return 'draft';
  return 'active';
}

function formatTimeAgo(value, now = Date.now()) {
  if (!value) return '—';
  const diff = Math.max(0, now - value);
  const minutes = Math.floor(diff / 60000);
  if (minutes <= 0) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

const MODE_OPTIONS = [
  { value: 'flow', label: 'Flow' },
  { value: 'custom', label: 'Custom' },
];

const BASE_PANEL_STYLE = {
  background: 'var(--ds-panel-bg)',
  border: '1px solid var(--ds-panel-border)',
  borderRadius: 16,
  boxShadow: 'var(--ds-panel-shadow)',
};

function StatCard({ color, value, label }) {
  return (
    <div
      style={{
        ...BASE_PANEL_STYLE,
        padding: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 88,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: color,
        }}
      />
      <div>
        <div style={{ fontSize: 20, fontWeight: 650, color: 'var(--ds-text-primary)' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>{label}</div>
      </div>
    </div>
  );
}

export function ChatAgentsView({ admin }) {
  const models = useMemo(() => (Array.isArray(admin?.models) ? admin.models : []), [admin]);
  const mcpServers = useMemo(() => (Array.isArray(admin?.mcpServers) ? admin.mcpServers : []), [admin]);
  const prompts = useMemo(() => (Array.isArray(admin?.prompts) ? admin.prompts : []), [admin]);
  const landConfigs = useMemo(() => (Array.isArray(admin?.landConfigs) ? admin.landConfigs : []), [admin]);
  const runtimeSettings = useMemo(
    () => (Array.isArray(admin?.settings) ? admin.settings.find((item) => item?.id === 'runtime') : null),
    [admin]
  );
  const promptLanguage = normalizePromptLanguage(runtimeSettings?.promptLanguage);
  const { data: uiAppsData, refresh: refreshUiApps } = useUiAppsRegistry();
  const uiApps = useMemo(() => (Array.isArray(uiAppsData?.apps) ? uiAppsData.apps : []), [uiAppsData]);

  const modelById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const landConfigById = useMemo(
    () => new Map(landConfigs.filter((cfg) => normalizeId(cfg?.id)).map((cfg) => [cfg.id, cfg])),
    [landConfigs]
  );

  const controller = useChatAgents({ models });
  const {
    agents,
    refreshAgents,
    agentModalOpen,
    agentModalInitial,
    openNewAgentModal,
    openEditAgentModal,
    openCloneAgentModal,
    closeAgentModal,
    saveAgent,
    deleteAgent,
  } = controller;

  const [searchText, setSearchText] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [statusFilter, setStatusFilter] = useState(() => STATUS_OPTIONS.map((item) => item.value));
  const [modeFilter, setModeFilter] = useState([]);
  const [modelFilter, setModelFilter] = useState([]);
  const [appFilter, setAppFilter] = useState([]);
  const [sortKey, setSortKey] = useState('name');
  const [viewMode, setViewMode] = useState('grid');
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!Array.isArray(agents)) return;
    setLastSyncAt(Date.now());
  }, [agents]);

  useEffect(() => {
    if (!bulkMode) setSelectedIds([]);
  }, [bulkMode]);

  const uiAppByKey = useMemo(() => {
    const map = new Map();
    (Array.isArray(uiApps) ? uiApps : []).forEach((app) => {
      const pluginId = normalizeId(app?.plugin?.id);
      const appId = normalizeId(app?.id);
      if (!pluginId || !appId) return;
      const key = toUiAppKey(pluginId, appId);
      const pluginLabel = app?.plugin?.name || pluginId;
      const appLabel = app?.name || appId;
      map.set(key, {
        key,
        pluginId,
        appId,
        label: `${appLabel} · ${pluginLabel}`,
        shortLabel: appLabel,
      });
    });
    return map;
  }, [uiApps]);

  const usedAppKeys = useMemo(() => {
    const set = new Set();
    (Array.isArray(agents) ? agents : []).forEach((agent) => {
      (Array.isArray(agent?.uiApps) ? agent.uiApps : []).forEach((ref) => {
        const key = toUiAppKey(ref?.pluginId, ref?.appId);
        if (key) set.add(key);
      });
    });
    return set;
  }, [agents]);

  const modelFilterOptions = useMemo(
    () =>
      (Array.isArray(models) ? models : [])
        .filter((m) => normalizeId(m?.id))
        .map((m) => ({ value: m.id, label: m.name || m.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [models]
  );

  const appFilterOptions = useMemo(() => {
    const keys = usedAppKeys.size > 0 ? Array.from(usedAppKeys) : Array.from(uiAppByKey.keys());
    return keys
      .map((key) => {
        const entry = uiAppByKey.get(key);
        return { value: key, label: entry?.label || key };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [uiAppByKey, usedAppKeys]);

  const handleRefresh = async () => {
    try {
      await Promise.all([refreshAgents?.(), refreshUiApps?.()]);
    } catch {
      // ignore refresh errors (toast handled upstream when applicable)
    } finally {
      setLastSyncAt(Date.now());
    }
  };

  const onDelete = (agent) => {
    const id = normalizeId(agent?.id);
    if (!id) return;
    Modal.confirm({
      title: `删除 Agent「${agent?.name || id}」？`,
      content: '如果该 Agent 仍被会话使用，会删除失败。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => deleteAgent(id),
    });
  };

  const totalAgents = Array.isArray(agents) ? agents.length : 0;
  const flowAgents = Array.isArray(agents) ? agents.filter((agent) => agent?.mode === 'flow').length : 0;
  const modelsInUse = useMemo(() => {
    const set = new Set();
    (Array.isArray(agents) ? agents : []).forEach((agent) => {
      const id = normalizeId(agent?.modelId);
      if (id) set.add(id);
    });
    return set.size;
  }, [agents]);
  const appsConnected = usedAppKeys.size > 0 ? usedAppKeys.size : uiApps.length;

  const filteredAgents = useMemo(() => {
    const list = Array.isArray(agents) ? [...agents] : [];
    const statusSet = new Set(statusFilter);
    const modeSet = new Set(modeFilter);
    const modelSet = new Set(modelFilter.map((item) => normalizeId(item)).filter(Boolean));
    const appSet = new Set(appFilter);
    const needle = normalizeKey(searchText);

    const matchesSearch = (agent) => {
      if (!needle) return true;
      const name = agent?.name || '';
      const description = agent?.description || '';
      const modelId = normalizeId(agent?.modelId);
      const modelName = modelId ? modelById.get(modelId)?.name || modelId : '';
      const mode = agent?.mode === 'flow' ? 'flow' : 'custom';
      const landConfig = normalizeId(agent?.landConfigId) ? landConfigById.get(agent.landConfigId) : null;
      const landLabel = landConfig?.name || agent?.landConfigId || '';
      const apps = (Array.isArray(agent?.uiApps) ? agent.uiApps : [])
        .map((ref) => {
          const key = toUiAppKey(ref?.pluginId, ref?.appId);
          const entry = key ? uiAppByKey.get(key) : null;
          return entry?.shortLabel || ref?.appId || '';
        })
        .filter(Boolean)
        .join(' ');
      const tokens = [name, description, modelName, modelId, mode, landLabel, apps].filter(Boolean).join(' ');
      return normalizeKey(tokens).includes(needle);
    };

    const filtered = list.filter((agent) => {
      if (statusSet.size > 0 && !statusSet.has(resolveAgentStatus(agent))) return false;
      if (modeSet.size > 0) {
        const mode = agent?.mode === 'flow' ? 'flow' : 'custom';
        if (!modeSet.has(mode)) return false;
      }
      if (modelSet.size > 0) {
        const modelId = normalizeId(agent?.modelId);
        if (!modelId || !modelSet.has(modelId)) return false;
      }
      if (appSet.size > 0) {
        const keys = (Array.isArray(agent?.uiApps) ? agent.uiApps : [])
          .map((ref) => toUiAppKey(ref?.pluginId, ref?.appId))
          .filter(Boolean);
        if (!keys.some((key) => appSet.has(key))) return false;
      }
      return matchesSearch(agent);
    });

    const sortByName = (a, b) => {
      const nameA = (a?.name || '').toLowerCase();
      const nameB = (b?.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    };

    filtered.sort((a, b) => {
      if (sortKey === 'model') {
        const modelA = normalizeId(a?.modelId) ? modelById.get(a.modelId)?.name || a.modelId : '';
        const modelB = normalizeId(b?.modelId) ? modelById.get(b.modelId)?.name || b.modelId : '';
        const cmp = String(modelA || '').localeCompare(String(modelB || ''));
        return cmp || sortByName(a, b);
      }
      if (sortKey === 'mode') {
        const rank = (agent) => (agent?.mode === 'flow' ? 0 : 1);
        const cmp = rank(a) - rank(b);
        return cmp || sortByName(a, b);
      }
      if (sortKey === 'apps') {
        const cmp = countList(b?.uiApps) - countList(a?.uiApps);
        return cmp || sortByName(a, b);
      }
      if (sortKey === 'recent') {
        const timeA = Date.parse(a?.updatedAt || a?.createdAt || '') || 0;
        const timeB = Date.parse(b?.updatedAt || b?.createdAt || '') || 0;
        const cmp = timeB - timeA;
        return cmp || sortByName(a, b);
      }
      return sortByName(a, b);
    });

    return filtered;
  }, [
    agents,
    statusFilter,
    modeFilter,
    modelFilter,
    appFilter,
    searchText,
    sortKey,
    modelById,
    landConfigById,
    uiAppByKey,
  ]);

  const sortOptions = useMemo(
    () => [
      { key: 'name', label: 'Name (A-Z)' },
      { key: 'model', label: 'Model' },
      { key: 'mode', label: 'Mode' },
      { key: 'apps', label: 'Apps count' },
      { key: 'recent', label: 'Recently updated' },
    ],
    []
  );

  const currentSortLabel = sortOptions.find((item) => item.key === sortKey)?.label || 'Sort';

  const viewOptions = [
    { key: 'grid', label: 'Grid', icon: <AppstoreOutlined /> },
    { key: 'list', label: 'List', icon: <BarsOutlined /> },
  ];

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const handleToggleSelect = (agentId, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(agentId);
      else next.delete(agentId);
      return Array.from(next);
    });
  };

  const handleClearFilters = () => {
    setSearchText('');
    setStatusFilter(STATUS_OPTIONS.map((item) => item.value));
    setModeFilter([]);
    setModelFilter([]);
    setAppFilter([]);
  };

  const renderFilterGroup = (title, options, value, onChange, maxHeight) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text-primary)' }}>{title}</div>
      <Checkbox.Group value={value} onChange={onChange}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: maxHeight || 'none',
            overflowY: maxHeight ? 'auto' : 'visible',
            paddingRight: maxHeight ? 4 : 0,
          }}
        >
          {options.length > 0 ? (
            options.map((option) => (
              <Checkbox key={option.value} value={option.value} style={{ color: 'var(--ds-text-muted)', fontSize: 12 }}>
                {option.label}
              </Checkbox>
            ))
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              —
            </Text>
          )}
        </div>
      </Checkbox.Group>
    </div>
  );

  const renderAgentCard = (agent) => {
    const id = normalizeId(agent?.id) || '';
    const name = agent?.name || 'Untitled Agent';
    const description = agent?.description || '';
    const mode = agent?.mode === 'flow' ? 'flow' : 'custom';
    const modelId = normalizeId(agent?.modelId);
    const modelName = modelId ? modelById.get(modelId)?.name || agent.modelId : '';
    const landConfig = normalizeId(agent?.landConfigId) ? landConfigById.get(agent.landConfigId) : null;
    const landLabel = landConfig?.name || agent?.landConfigId || '';
    const appsList = (Array.isArray(agent?.uiApps) ? agent.uiApps : [])
      .map((ref) => {
        const key = toUiAppKey(ref?.pluginId, ref?.appId);
        const entry = key ? uiAppByKey.get(key) : null;
        return entry?.shortLabel || ref?.appId || '';
      })
      .filter(Boolean);
    const appsSummary = appsList.length > 0 ? appsList.slice(0, 3).join(', ') : '—';
    const appsExtra = appsList.length > 3 ? ` +${appsList.length - 3}` : '';

    const tags = [];
    if (Array.isArray(agent?.promptIds) && agent.promptIds.length > 0) tags.push('Prompt');
    if (Array.isArray(agent?.mcpServerIds) && agent.mcpServerIds.length > 0) tags.push('MCP');
    if (Array.isArray(agent?.uiApps) && agent.uiApps.length > 0) tags.push('Apps');
    if (Array.isArray(agent?.skills) && agent.skills.length > 0) tags.push('Skills');
    if (Array.isArray(agent?.subagentIds) && agent.subagentIds.length > 0) tags.push('Subagents');

    return (
      <div
        key={id || name}
        style={{
          ...BASE_PANEL_STYLE,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 176,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {bulkMode ? (
            <Checkbox
              checked={selectedSet.has(id)}
              onChange={(event) => handleToggleSelect(id, event.target.checked)}
            />
          ) : null}
          <span style={{ fontWeight: 650, fontSize: 14, color: 'var(--ds-text-primary)' }}>{name}</span>
          <span
            style={{
              padding: '2px 10px',
              borderRadius: 999,
              fontSize: 12,
              background: mode === 'flow' ? 'var(--ds-pill-flow-bg)' : 'var(--ds-pill-custom-bg)',
              color: mode === 'flow' ? 'var(--ds-pill-flow-text)' : 'var(--ds-pill-custom-text)',
            }}
          >
            {mode === 'flow' ? 'Flow' : 'Custom'}
          </span>
          {mode === 'flow' && landLabel ? <Tag color="purple">{landLabel}</Tag> : null}
        </div>
        {description ? (
          <div style={{ fontSize: 12, color: 'var(--ds-text-secondary)', lineHeight: '18px' }}>{description}</div>
        ) : null}
        <div style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>{modelName ? `Model: ${modelName}` : 'Model: —'}</div>
        <div style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>{`Apps: ${appsSummary}${appsExtra}`}</div>
        {tags.length > 0 ? (
          <Space size={[6, 6]} wrap>
            {tags.slice(0, 4).map((tag) => (
              <Tag
                key={`${id}-${tag}`}
                style={{
                  marginInlineEnd: 0,
                  borderRadius: 10,
                  background: 'var(--ds-tag-bg)',
                  border: 'none',
                  color: 'var(--ds-tag-text)',
                  fontSize: 12,
                }}
              >
                {tag}
              </Tag>
            ))}
          </Space>
        ) : null}
        <Space size={8} wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditAgentModal(agent)}>
            Edit
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => openCloneAgentModal?.(agent)}>
            Clone
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(agent)}>
            Delete
          </Button>
        </Space>
      </div>
    );
  };

  return (
    <>
      <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 8px 16px' }}>
        <div
          style={{
            ...BASE_PANEL_STYLE,
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 650, fontSize: 20, color: 'var(--ds-text-primary)' }}>Agent Management</div>
            <div style={{ color: 'var(--ds-text-secondary)', fontSize: 13 }}>
              Manage chat agents, models, prompts, and app capabilities.
            </div>
          </div>
          <Space size={10} wrap>
            <Input
              allowClear
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              prefix={<SearchOutlined style={{ color: 'var(--ds-text-subtle)' }} />}
              placeholder="Search agents, models, tags"
              style={{ width: 240 }}
            />
            <Button icon={<FilterOutlined />} onClick={() => setShowFilters((prev) => !prev)}>
              Filter
            </Button>
            <Dropdown
              menu={{
                items: sortOptions.map((option) => ({ key: option.key, label: option.label })),
                onClick: ({ key }) => setSortKey(key),
              }}
              placement="bottomRight"
            >
              <Button icon={<SortAscendingOutlined />}>{currentSortLabel}</Button>
            </Dropdown>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openNewAgentModal?.()}>
              New Agent
            </Button>
          </Space>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          <StatCard color="#dbeafe" value={totalAgents} label="Total agents" />
          <StatCard color="#d1fae5" value={flowAgents} label="Flow agents" />
          <StatCard color="#fef3c7" value={modelsInUse} label="Models in use" />
          <StatCard color="#fee2e2" value={appsConnected} label="Apps connected" />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: showFilters ? '240px minmax(0, 1fr)' : 'minmax(0, 1fr)',
            gap: 16,
            minHeight: 0,
            flex: 1,
          }}
        >
          {showFilters ? (
            <div style={{ ...BASE_PANEL_STYLE, padding: 16, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 650, color: 'var(--ds-text-primary)', fontSize: 14 }}>Filters</div>
                <Button type="link" onClick={handleClearFilters} style={{ padding: 0, fontSize: 12 }}>
                  Clear all
                </Button>
              </div>
              {renderFilterGroup('Status', STATUS_OPTIONS, statusFilter, setStatusFilter)}
              {renderFilterGroup('Mode', MODE_OPTIONS, modeFilter, setModeFilter)}
              {renderFilterGroup('Model', modelFilterOptions, modelFilter, setModelFilter, 140)}
              {renderFilterGroup('Apps', appFilterOptions, appFilter, setAppFilter, 160)}
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
            <div
              style={{
                ...BASE_PANEL_STYLE,
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontWeight: 650, fontSize: 14, color: 'var(--ds-text-primary)' }}>Agents</div>
              <div style={{ color: 'var(--ds-text-muted)', fontSize: 12 }}>Last sync: {formatTimeAgo(lastSyncAt, now)}</div>
              <div style={{ flex: 1 }} />
              {bulkMode && selectedIds.length > 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {selectedIds.length} selected
                </Text>
              ) : null}
              <Space size={8} wrap>
                <Button size="small" onClick={() => setBulkMode((prev) => !prev)}>
                  Bulk
                </Button>
                <Dropdown
                  menu={{
                    items: viewOptions.map((option) => ({
                      key: option.key,
                      label: option.label,
                      icon: option.icon,
                    })),
                    onClick: ({ key }) => setViewMode(key),
                  }}
                  placement="bottomRight"
                >
                  <Button size="small">View</Button>
                </Dropdown>
                <Button size="small" icon={<ReloadOutlined />} onClick={handleRefresh}>
                  Refresh
                </Button>
              </Space>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
              {filteredAgents.length > 0 ? (
                <div
                  style={
                    viewMode === 'grid'
                      ? {
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                          gap: 16,
                        }
                      : { display: 'flex', flexDirection: 'column', gap: 12 }
                  }
                >
                  {filteredAgents.map((agent) => renderAgentCard(agent))}
                </div>
              ) : (
                <Empty description="No agents found" />
              )}
            </div>
          </div>
        </div>
      </div>

      <AgentEditorModal
        open={agentModalOpen}
        initialValues={agentModalInitial}
        models={models}
        mcpServers={mcpServers}
        prompts={prompts}
        uiApps={uiApps}
        landConfigs={landConfigs}
        promptLanguage={promptLanguage}
        onCancel={closeAgentModal}
        onSave={async (values) => saveAgent(values)}
      />
    </>
  );
}

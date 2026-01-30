import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Popconfirm, Space, Typography, message } from 'antd';
import { AppstoreOutlined, ReloadOutlined } from '@ant-design/icons';

import { useUiAppsRegistry } from 'aide-ui/features/apps/hooks/useUiAppsRegistry.js';
import { api, hasApi } from 'aide-ui/lib/api.js';
import { RuntimeLogModal } from '../../components/RuntimeLogModal.jsx';

const { Title, Text, Paragraph } = Typography;

export function AppsHubView({ onNavigate }) {
  const { loading, error, data, refresh } = useUiAppsRegistry();
  const apps = useMemo(() => (Array.isArray(data?.apps) ? data.apps : []), [data]);
  const pluginDirs = data?.pluginDirs || {};
  const loadErrors = useMemo(() => (Array.isArray(data?.errors) ? data.errors : []), [data]);

  const [packageInstalling, setPackageInstalling] = useState(false);
  const [installLogId, setInstallLogId] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [uninstallingId, setUninstallingId] = useState('');

  const installPackage = useCallback(async () => {
    if (!hasApi) {
      message.error('IPC bridge not available. Is preload loaded?');
      return;
    }
    setPackageInstalling(true);
    let logId = '';
    try {
      const result = await api.invoke('uiApps:plugins:install');
      logId = typeof result?.logId === 'string' ? result.logId.trim() : '';
      if (logId) setInstallLogId(logId);
      if (result?.ok === false) {
        if (result?.canceled) return;
        const errorMessage = result?.message || '导入失败';
        if (logId) {
          message.error(`${errorMessage}（日志ID: ${logId}）`);
          setLogOpen(true);
          return;
        }
        message.error(errorMessage);
        return;
      }
      const installed = Array.isArray(result?.plugins) ? result.plugins : [];
      const hint = installed.length ? `（${installed.length} 个插件）` : '';
      message.success(`应用包已导入${hint}。`);
      await refresh();
    } catch (err) {
      const errorMessage = err?.message || '导入失败';
      if (logId) {
        message.error(`${errorMessage}（日志ID: ${logId}）`);
        setLogOpen(true);
      } else {
        message.error(errorMessage);
      }
    } finally {
      setPackageInstalling(false);
    }
  }, [refresh]);

  const uninstallPlugin = useCallback(
    async (pluginId) => {
      if (!hasApi) {
        message.error('IPC bridge not available. Is preload loaded?');
        return;
      }
      const id = typeof pluginId === 'string' ? pluginId.trim() : '';
      if (!id) return;
      setUninstallingId(id);
      try {
        const result = await api.invoke('uiApps:plugins:uninstall', { pluginId: id });
        if (result?.ok === false) {
          message.error(result?.message || '卸载失败');
          return;
        }
        message.success('已卸载应用包');
        await refresh();
      } catch (err) {
        message.error(err?.message || '卸载失败');
      } finally {
        setUninstallingId('');
      }
    },
    [refresh]
  );

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Title level={4} style={{ margin: 0 }}>
          <Space size={10}>
            <AppstoreOutlined />
            应用
          </Space>
        </Title>
        <div style={{ flex: 1 }} />
        <Button type="primary" loading={packageInstalling} onClick={installPackage} disabled={loading}>
          导入应用包
        </Button>
        {installLogId ? (
          <Button onClick={() => setLogOpen(true)} disabled={loading || packageInstalling}>
            安装日志
          </Button>
        ) : null}
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            refresh();
          }}
          disabled={loading || packageInstalling}
        >
          刷新
        </Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 6, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error ? <Alert type="error" showIcon message="加载失败" description={error} /> : null}

        {loadErrors.length ? (
          <Alert
            type="warning"
            showIcon
            message="部分插件加载失败"
            description={
              <div style={{ display: 'grid', gap: 4 }}>
                {loadErrors.slice(0, 6).map((e, idx) => (
                  <Text key={`${e?.dir || 'err'}-${idx}`} type="secondary">
                    {(e?.dir ? `${e.dir}: ` : '') + (e?.message || 'unknown error')}
                  </Text>
                ))}
                {loadErrors.length > 6 ? (
                  <Text type="secondary">…还有 {loadErrors.length - 6} 条</Text>
                ) : null}
              </div>
            }
          />
        ) : null}

        {loading ? (
          <Paragraph>加载中…</Paragraph>
        ) : apps.length === 0 ? (
          <Card size="small" style={{ borderRadius: 14 }}>
            <Empty description="暂无应用插件" />
            {pluginDirs?.user ? (
              <Paragraph type="secondary" style={{ marginTop: 8 }}>
                将插件放入 <Text code>{pluginDirs.user}</Text>（每个插件一个目录，内含 <Text code>plugin.json</Text>）
              </Paragraph>
            ) : null}
            {pluginDirs?.builtin ? (
              <Paragraph type="secondary" style={{ marginTop: 0 }}>
                也可放入 <Text code>{pluginDirs.builtin}</Text>（内置/开发用）
              </Paragraph>
            ) : null}
          </Card>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 12,
              alignItems: 'stretch',
            }}
          >
            {apps.map((app) => {
              const pluginId = typeof app?.plugin?.id === 'string' ? app.plugin.id : '';
              const canUninstall = pluginId && app?.plugin?.source === 'user';
              return (
                <Card
                  key={`${app?.plugin?.id || 'plugin'}:${app?.id || 'app'}`}
                  size="small"
                  hoverable
                  style={{ borderRadius: 14 }}
                  onClick={() => (typeof onNavigate === 'function' && app?.route ? onNavigate(app.route) : null)}
                  title={<span style={{ fontWeight: 650 }}>{app?.name || app?.id || '未命名应用'}</span>}
                  extra={
                    <Space size={6}>
                      {app?.plugin?.name ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {app.plugin.name}
                        </Text>
                      ) : null}
                      {canUninstall ? (
                        <Popconfirm
                          title="确认卸载?"
                          description="卸载后将删除该应用包（仅用户插件）。"
                          okText="卸载"
                          cancelText="取消"
                          onConfirm={() => {
                            void uninstallPlugin(pluginId);
                          }}
                        >
                          <Button
                            size="small"
                            type="link"
                            danger
                            loading={uninstallingId === pluginId}
                            onClick={(e) => e.stopPropagation()}
                          >
                            卸载
                          </Button>
                        </Popconfirm>
                      ) : null}
                    </Space>
                  }
                >
                  {app?.description ? (
                    <Paragraph style={{ margin: 0 }}>{app.description}</Paragraph>
                  ) : (
                    <Text type="secondary">暂无描述</Text>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <RuntimeLogModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        actionId={installLogId}
        title="应用安装日志"
        emptyText="未找到相关日志记录。"
        refreshLabel="刷新日志"
      />
    </div>
  );
}

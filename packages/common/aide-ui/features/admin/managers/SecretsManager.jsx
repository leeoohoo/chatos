import React, { useMemo } from 'react';
import { Button, Popconfirm, Space, Tag, Typography } from 'antd';

import { EntityManager } from '../../../components/EntityManager.jsx';

const { Text, Paragraph } = Typography;

function SecretsManager({ data, onCreate, onUpdate, onDelete, loading }) {
  const columns = useMemo(
    () => [
      { title: '环境变量名', dataIndex: 'name', width: 180 },
      {
        title: '状态',
        dataIndex: 'hasValue',
        width: 90,
        render: (v) => (v ? <Tag color="green">已设置</Tag> : <Tag>未设置</Tag>),
      },
      {
        title: 'Key (masked)',
        dataIndex: 'value',
        width: 160,
        render: (v) => (v ? <Text code>{v}</Text> : '-'),
      },
      {
        title: '描述',
        dataIndex: 'description',
        render: (text) => (
          <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: false }}>
            {text || '-'}
          </Paragraph>
        ),
      },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, render: (v) => v || '-' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, render: (v) => v || '-' },
    ],
    []
  );

  const fields = useMemo(
    () => [
      {
        name: 'name',
        label: '环境变量名',
        required: true,
        placeholder: '如 DEEPSEEK_API_KEY',
        extra: '用于模型配置中的 apiKeyEnv / api_key_env 引用。',
      },
      {
        name: 'value',
        label: 'API Key',
        type: 'password',
        requiredOnCreate: true,
        omitInitialValue: true,
        placeholder: 'sk-xxxx',
        extra: '新建必填；编辑时留空表示不修改。',
      },
      { name: 'description', label: '描述', type: 'textarea', rows: 2 },
    ],
    []
  );

  const handleUpdate = async (id, values) => {
    const patch = { ...(values || {}) };
    if (typeof patch.value === 'string' && patch.value.trim() === '') {
      delete patch.value;
    }
    await onUpdate(id, patch);
  };

  return (
    <EntityManager
      title="API Keys"
      description="在 UI 中保存 API Key（模型调用只从这里读取；是否注入进程 env 可在灵动岛开关中控制）。"
      data={data}
      fields={fields}
      columns={columns}
      onCreate={onCreate}
      onUpdate={handleUpdate}
      onDelete={onDelete}
      loading={loading}
      tableProps={{ scroll: { x: 820 } }}
      renderActions={(record, { onEdit, onDelete: handleDelete }) => {
        return (
          <Space>
            <Button size="small" onClick={onEdit}>
              编辑
            </Button>
            <Popconfirm title="确认删除?" onConfirm={handleDelete}>
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      }}
    />
  );
}

export { SecretsManager };

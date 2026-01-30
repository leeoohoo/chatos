import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Space, Tag, Tooltip, TreeSelect, message } from 'antd';
import { CloseOutlined, PauseCircleOutlined, PictureOutlined, SendOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../../lib/api.js';
import { normalizeFileTags } from '../file-tags.js';

function generateId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

const IGNORE_RULES = {
  common: {
    dirs: ['.git', '.hg', '.svn', '.idea', '.vscode', '.cache', '.DS_Store'],
    files: ['.DS_Store', 'Thumbs.db'],
    exts: ['.log', '.tmp', '.swp'],
  },
  node: {
    dirs: ['node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.output', '.svelte-kit', '.turbo'],
    exts: ['.map'],
  },
  python: {
    dirs: ['__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.venv', 'venv'],
    exts: ['.pyc', '.pyo', '.pyd'],
  },
  java: {
    dirs: ['target', 'out', '.gradle'],
    exts: ['.class', '.jar', '.war', '.ear'],
  },
  dotnet: {
    dirs: ['bin', 'obj'],
    exts: ['.dll', '.exe', '.pdb'],
  },
  rust: {
    dirs: ['target'],
    exts: ['.rlib', '.rmeta'],
  },
  go: {
    dirs: ['bin'],
    exts: ['.a', '.o', '.exe'],
  },
  c: {
    dirs: ['CMakeFiles'],
    exts: ['.o', '.obj', '.a', '.so', '.dylib', '.dll', '.exe'],
  },
  mobile: {
    dirs: ['build', 'DerivedData'],
    exts: ['.apk', '.aab', '.xcarchive', '.app'],
  },
};

function buildIgnoreSets(rules) {
  const dirs = new Set();
  const files = new Set();
  const exts = new Set();
  Object.values(rules || {}).forEach((group) => {
    (Array.isArray(group?.dirs) ? group.dirs : []).forEach((name) => {
      if (name) dirs.add(String(name).toLowerCase());
    });
    (Array.isArray(group?.files) ? group.files : []).forEach((name) => {
      if (name) files.add(String(name).toLowerCase());
    });
    (Array.isArray(group?.exts) ? group.exts : []).forEach((ext) => {
      if (ext) exts.add(String(ext).toLowerCase());
    });
  });
  return { dirs, files, exts };
}

const IGNORE_SETS = buildIgnoreSets(IGNORE_RULES);

function normalizeRelPath(value) {
  const raw = String(value || '');
  if (!raw || raw === '.') return '.';
  const cleaned = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  return cleaned || '.';
}

function getPathBaseName(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function shouldIgnoreEntry(entry) {
  const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
  if (!name) return true;
  const lower = name.toLowerCase();
  if (IGNORE_SETS.files.has(lower)) return true;
  if (entry?.isDir) return IGNORE_SETS.dirs.has(lower);
  const dot = lower.lastIndexOf('.');
  if (dot > 0) {
    const ext = lower.slice(dot);
    if (IGNORE_SETS.exts.has(ext)) return true;
  }
  return false;
}

function buildTreeNodes(entries, dirKeys) {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .filter((entry) => !shouldIgnoreEntry(entry))
    .map((entry, idx) => {
      const key = normalizeRelPath(entry?.path || entry?.name || `unknown-${idx}`);
      const name = entry?.name || key.split('/').pop() || key;
      const isDir = Boolean(entry?.isDir);
      if (isDir && dirKeys) dirKeys.add(key);
      return {
        key,
        value: key,
        title: name,
        isLeaf: !isDir,
        checkable: !isDir,
      };
    });
}

function updateTreeChildren(list, key, children) {
  const normalizedKey = normalizeRelPath(key);
  return (Array.isArray(list) ? list : []).map((node) => {
    if (normalizeRelPath(node?.key) === normalizedKey) return { ...node, children };
    if (node?.children) return { ...node, children: updateTreeChildren(node.children, normalizedKey, children) };
    return node;
  });
}

export function ChatComposer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  files,
  onFilesChange,
  workspaceRoot,
  visionEnabled = false,
  onSend,
  onStop,
  sending,
}) {
  const fileInputRef = useRef(null);
  const workspaceRootValue = useMemo(
    () => (typeof workspaceRoot === 'string' ? workspaceRoot.trim() : ''),
    [workspaceRoot]
  );
  const prevWorkspaceRootRef = useRef(workspaceRootValue);
  const loadSeqRef = useRef(0);
  const loadedKeysRef = useRef(new Set());
  const dirKeysRef = useRef(new Set());
  const [treeData, setTreeData] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState('');
  const [treeExpandedKeys, setTreeExpandedKeys] = useState(['.']);
  const [treeOpen, setTreeOpen] = useState(false);
  const list = useMemo(() => (Array.isArray(attachments) ? attachments.filter(Boolean) : []), [attachments]);
  const selectedFiles = useMemo(() => normalizeFileTags(files), [files]);
  const hasFileTags = selectedFiles.length > 0;
  const images = useMemo(
    () =>
      list.filter((att) => att?.type === 'image' && typeof att?.dataUrl === 'string' && att.dataUrl.startsWith('data:image/')),
    [list]
  );
  const effectiveImages = visionEnabled ? images : [];
  const trimmedText = String(value || '').trim();
  const canSend = !sending && (trimmedText.length > 0 || effectiveImages.length > 0 || hasFileTags);

  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

  const addFiles = async (files) => {
    if (!visionEnabled) return;
    const next = [...effectiveImages];
    for (const file of Array.isArray(files) ? files : []) {
      if (next.length >= MAX_IMAGES) {
        message.warning(`最多只能添加 ${MAX_IMAGES} 张图片`);
        break;
      }
      if (!file || typeof file !== 'object') continue;
      const mimeType = typeof file.type === 'string' ? file.type : '';
      if (!mimeType.startsWith('image/')) {
        message.warning('仅支持图片文件');
        continue;
      }
      const size = Number.isFinite(file.size) ? file.size : 0;
      if (size > MAX_IMAGE_BYTES) {
        message.error('图片过大（单张上限 10MB）');
        continue;
      }
      let dataUrl = '';
      try {
        dataUrl = await readFileAsDataUrl(file);
      } catch {
        message.error('读取图片失败');
        continue;
      }
      if (!dataUrl.startsWith('data:image/')) {
        message.error('图片格式不支持');
        continue;
      }
      next.push({
        id: generateId(),
        type: 'image',
        name: typeof file.name === 'string' ? file.name : '',
        mimeType,
        dataUrl,
      });
    }
    onAttachmentsChange?.(next);
  };

  const removeImage = (id) => {
    const target = typeof id === 'string' ? id : '';
    if (!target) return;
    onAttachmentsChange?.(effectiveImages.filter((img) => img?.id !== target));
  };

  useEffect(() => {
    if (!visionEnabled && images.length > 0) {
      onAttachmentsChange?.([]);
    }
  }, [images.length, onAttachmentsChange, visionEnabled]);

  const resetFileTree = useCallback(() => {
    setTreeData([]);
    setTreeError('');
    setTreeExpandedKeys(['.']);
    loadedKeysRef.current = new Set();
    dirKeysRef.current = new Set();
  }, []);

  useEffect(() => {
    const prev = prevWorkspaceRootRef.current;
    if (prev === workspaceRootValue) return;
    prevWorkspaceRootRef.current = workspaceRootValue;
    resetFileTree();
    onFilesChange?.([]);
  }, [onFilesChange, resetFileTree, workspaceRootValue]);

  const loadDirectory = useCallback(
    async (dirKey) => {
      if (!hasApi) return;
      const root = workspaceRootValue;
      if (!root) {
        setTreeError('请先设置工作目录');
        return;
      }
      const normalized = normalizeRelPath(dirKey || '.');
      if (loadedKeysRef.current.has(normalized)) return;
      const seq = (loadSeqRef.current || 0) + 1;
      loadSeqRef.current = seq;
      setTreeLoading(true);
      setTreeError('');
      try {
        const data = await api.invoke('dir:list', { workspaceRoot: root, path: normalized });
        if (loadSeqRef.current !== seq) return;
        const dirKeys = new Set(dirKeysRef.current);
        const children = buildTreeNodes(data?.entries, dirKeys);
        const rootLabel = getPathBaseName(root) || 'workspace';
        setTreeData((prev) => {
          if (normalized === '.' || prev.length === 0) {
            return [
              {
                key: '.',
                value: '.',
                title: rootLabel,
                isLeaf: false,
                checkable: false,
                children,
              },
            ];
          }
          return updateTreeChildren(prev, normalized, children);
        });
        dirKeysRef.current = dirKeys;
        if (normalized === '.') {
          setTreeExpandedKeys(['.']);
        }
        loadedKeysRef.current.add(normalized);
      } catch (err) {
        if (loadSeqRef.current !== seq) return;
        setTreeError(err?.message || '读取目录失败');
      } finally {
        if (loadSeqRef.current === seq) setTreeLoading(false);
      }
    },
    [workspaceRootValue]
  );

  const handleLoadTreeData = useCallback(
    async (node) => {
      const key = normalizeRelPath(node?.key);
      if (!key || node?.isLeaf) return;
      await loadDirectory(key);
    },
    [loadDirectory]
  );

  useEffect(() => {
    if (!treeOpen) return;
    void loadDirectory('.');
  }, [loadDirectory, treeOpen]);

  const handleFilesChange = useCallback(
    (nextValue) => {
      const raw = Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [];
      const values = raw
        .map((item) => (typeof item === 'string' ? item : item?.value))
        .filter((item) => typeof item === 'string' && item.trim());
      const dirKeys = dirKeysRef.current || new Set();
      const filtered = values.filter((value) => !dirKeys.has(normalizeRelPath(value)));
      onFilesChange?.(normalizeFileTags(filtered));
    },
    [onFilesChange]
  );

  const renderFileTag = useCallback((tagProps) => {
    const rawValue = typeof tagProps?.value === 'string' ? tagProps.value : String(tagProps?.label || '');
    const label = getPathBaseName(rawValue) || rawValue;
    return (
      <Tooltip title={rawValue}>
        <Tag
          color="blue"
          closable={tagProps?.closable}
          onClose={tagProps?.onClose}
          style={{ marginInlineEnd: 4 }}
        >
          {label}
        </Tag>
      </Tooltip>
    );
  }, []);

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {visionEnabled && effectiveImages.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {effectiveImages.map((img) => (
            <div
              key={img.id}
              style={{
                position: 'relative',
                width: 132,
                height: 98,
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--ds-panel-border)',
                background: 'var(--ds-panel-bg)',
              }}
            >
              <img
                src={img.dataUrl}
                alt={img.name || 'attachment'}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <Button
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={() => removeImage(img.id)}
                disabled={sending}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 28,
                  height: 28,
                  padding: 0,
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.45)',
                  color: '#fff',
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <Input.TextArea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
        autoSize={{ minRows: 2, maxRows: 6 }}
        onPaste={(e) => {
          if (!visionEnabled || sending) return;
          const items = e.clipboardData?.items;
          if (!items || items.length === 0) return;
          const files = [];
          for (const item of items) {
            if (!item || !item.type || !String(item.type).startsWith('image/')) continue;
            const file = item.getAsFile?.();
            if (file) files.push(file);
          }
          if (files.length > 0) {
            void addFiles(files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (e.shiftKey) return;
          e.preventDefault();
          if (canSend) onSend?.();
        }}
        disabled={sending}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          {visionEnabled ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';
                  void addFiles(files);
                }}
              />
              <Button
                icon={<PictureOutlined />}
                onClick={() => fileInputRef.current?.click?.()}
                disabled={sending}
              >
                添加图片
              </Button>
              <span style={{ color: 'var(--ds-text-secondary)', fontSize: 12 }}>可粘贴图片</span>
            </>
          ) : (
            <span style={{ color: 'var(--ds-text-secondary)', fontSize: 12 }}>当前模型不支持图片输入</span>
          )}

          {typeof onFilesChange === 'function' ? (
            <TreeSelect
              value={selectedFiles}
              treeData={treeData}
              treeCheckable
              showCheckedStrategy={TreeSelect.SHOW_ALL}
              placeholder={workspaceRootValue ? '选择要发送的文件（可搜索）' : '请先设置工作目录'}
              allowClear
              multiple
              disabled={sending || !workspaceRootValue}
              onChange={handleFilesChange}
              loadData={handleLoadTreeData}
              onDropdownVisibleChange={(open) => setTreeOpen(open)}
              treeExpandedKeys={treeExpandedKeys}
              onTreeExpand={(keys) => setTreeExpandedKeys(Array.isArray(keys) ? keys : [])}
              treeNodeFilterProp="title"
              showSearch
              filterTreeNode={(input, node) => {
                const keyword = String(input || '').trim().toLowerCase();
                if (!keyword) return true;
                const title = String(node?.title || '').toLowerCase();
                const value = String(node?.value || '').toLowerCase();
                return title.includes(keyword) || value.includes(keyword);
              }}
              tagRender={renderFileTag}
              maxTagCount="responsive"
              loading={treeLoading}
              notFoundContent={
                treeLoading ? '加载中...' : treeError ? <span style={{ color: 'var(--ds-danger)' }}>{treeError}</span> : '暂无文件'
              }
              dropdownStyle={{ maxHeight: 360, overflow: 'auto' }}
              style={{ width: 260, maxWidth: '100%' }}
            />
          ) : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button icon={<PauseCircleOutlined />} onClick={() => onStop?.()} disabled={!sending}>
            停止
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={() => onSend?.()} disabled={!canSend}>
            发送
          </Button>
        </div>
      </div>
    </Space>
  );
}

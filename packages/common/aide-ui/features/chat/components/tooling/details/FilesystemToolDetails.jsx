import React from 'react';
import { Typography } from 'antd';
import { FileTextOutlined, FolderOpenOutlined, SearchOutlined } from '@ant-design/icons';

import { ToolBlock, ToolList, ToolSection, ToolSummary } from '../ToolPanels.jsx';
import { formatSummaryValue, normalizeText } from './detail-utils.js';

const { Text } = Typography;

function parseDirectoryListing(resultText) {
  const lines = String(resultText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  lines.forEach((line) => {
    if (!line.startsWith('📁') && !line.startsWith('📄')) return;
    const kind = line.startsWith('📁') ? 'dir' : 'file';
    const rest = line.slice(2).trim();
    const sizeIndex = rest.lastIndexOf('(');
    const hasSize = sizeIndex > 0 && rest.endsWith(')');
    const path = hasSize ? rest.slice(0, sizeIndex).trim() : rest;
    const size = hasSize ? rest.slice(sizeIndex + 1, -1).trim() : '';
    if (path) entries.push({ kind, path, size });
  });
  return entries;
}

function parseSearchResults(resultText) {
  const lines = String(resultText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const results = [];
  lines.forEach((line) => {
    const match = line.match(/^(.+?):(\d+)\s+(.*)$/);
    if (!match) return;
    results.push({
      path: match[1],
      line: Number(match[2]),
      preview: match[3],
    });
  });
  return results;
}

export function FilesystemToolDetails({ argsRaw, argsParsed, resultText, structuredContent }) {
  const summaryItems = [];
  if (typeof argsParsed?.path === 'string') {
    summaryItems.push({ label: 'path', value: formatSummaryValue(argsParsed.path, 120) });
  }
  if (Array.isArray(argsParsed?.paths) && argsParsed.paths.length > 0) {
    summaryItems.push({ label: 'paths', value: formatSummaryValue(argsParsed.paths.join(', '), 160) });
  }
  if (typeof argsParsed?.mode === 'string') {
    summaryItems.push({ label: 'mode', value: formatSummaryValue(argsParsed.mode, 80) });
  }
  if (argsParsed?.depth !== undefined) {
    summaryItems.push({ label: 'depth', value: formatSummaryValue(argsParsed.depth, 80) });
  }
  if (typeof argsParsed?.query === 'string') {
    summaryItems.push({ label: 'query', value: formatSummaryValue(argsParsed.query, 120) });
  }
  if (argsParsed?.includeHidden !== undefined) {
    summaryItems.push({ label: 'hidden', value: argsParsed.includeHidden ? 'true' : 'false' });
  }

  const normalizedResult = typeof resultText === 'string' ? resultText.trim() : '';
  const dirEntries = parseDirectoryListing(normalizedResult);
  const searchEntries = dirEntries.length === 0 ? parseSearchResults(normalizedResult) : [];
  const hasParsedResults = dirEntries.length > 0 || searchEntries.length > 0;
  const changedFiles = Array.isArray(structuredContent?.files)
    ? structuredContent.files.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  const dirItems = dirEntries.map((entry) => ({
    key: `${entry.kind}-${entry.path}`,
    icon: entry.kind === 'dir' ? <FolderOpenOutlined /> : <FileTextOutlined />,
    title: entry.path,
    meta: entry.size ? <span className="ds-tool-list-meta-text">{entry.size}</span> : null,
  }));

  const searchItems = searchEntries.map((entry) => ({
    key: `${entry.path}:${entry.line}`,
    icon: <SearchOutlined />,
    title: `${entry.path}:${entry.line}`,
    subtitle: entry.preview,
  }));

  const changeItems = changedFiles.map((file) => ({
    key: file,
    icon: <FileTextOutlined />,
    title: file,
  }));

  return (
    <>
      {summaryItems.length > 0 ? (
        <ToolSection title="摘要">
          <ToolSummary items={summaryItems} />
        </ToolSection>
      ) : null}
      {argsRaw ? (
        <ToolSection title="参数">
          <ToolBlock text={argsRaw} />
        </ToolSection>
      ) : null}
      {changeItems.length > 0 ? (
        <ToolSection title="变更文件">
          <ToolList items={changeItems} />
        </ToolSection>
      ) : null}
      {dirItems.length > 0 ? (
        <ToolSection title="目录">
          <ToolList items={dirItems} />
        </ToolSection>
      ) : null}
      {searchItems.length > 0 ? (
        <ToolSection title="搜索结果">
          <ToolList items={searchItems} />
        </ToolSection>
      ) : null}
      {!hasParsedResults ? (
        <ToolSection title="结果">
          {normalizedResult ? <ToolBlock text={normalizedResult} /> : <Text type="secondary">（暂无结果）</Text>}
        </ToolSection>
      ) : null}
    </>
  );
}

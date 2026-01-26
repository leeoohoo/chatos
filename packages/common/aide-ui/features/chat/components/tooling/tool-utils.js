import { parseJsonSafe } from '../../../../lib/parse.js';
import { truncateText } from '../../../../lib/format.js';
import { inferToolKind, normalizeToolStatus } from '../../../../lib/tooling-utils.js';

export { inferToolKind };

export function parseToolArgsText(argsText) {
  const raw =
    typeof argsText === 'string'
      ? argsText.trim()
      : argsText === undefined || argsText === null
        ? ''
        : String(argsText);
  if (!raw) return { raw: '', parsed: null };
  return { raw, parsed: parseJsonSafe(raw, null) };
}

function parseShellHeader(line) {
  const header = {};
  const raw = typeof line === 'string' ? line : String(line ?? '');
  const parts = raw.split(' | ').map((part) => part.trim()).filter(Boolean);
  parts.forEach((part) => {
    if (part.startsWith('$ ')) {
      header.command = part.slice(2).trim();
      return;
    }
    if (part.startsWith('cwd: ')) {
      header.cwd = part.slice(5).trim();
      return;
    }
    if (part.startsWith('exit code: ')) {
      const value = Number(part.slice(11).trim());
      header.exitCode = Number.isFinite(value) ? value : part.slice(11).trim();
      return;
    }
    if (part.startsWith('signal: ')) {
      header.signal = part.slice(8).trim();
      return;
    }
    if (part === 'timed out') {
      header.timedOut = true;
      return;
    }
    if (part.startsWith('elapsed: ')) {
      header.elapsed = part.slice(9).trim();
      return;
    }
    if (part.startsWith('bytes: ')) {
      const value = Number(part.slice(7).trim());
      header.bytes = Number.isFinite(value) ? value : part.slice(7).trim();
    }
  });
  return header;
}

export function parseShellResult(text) {
  const raw = typeof text === 'string' ? text.trim() : String(text ?? '').trim();
  if (!raw) return null;

  const warningMatch = raw.match(/\n\n\[Warnings\]\n([\s\S]*)$/);
  const warnings = warningMatch ? warningMatch[1].trim() : '';
  const body = warningMatch ? raw.slice(0, warningMatch.index) : raw;

  if (!body.includes('STDOUT:') && !body.includes('STDERR:')) {
    return null;
  }

  const headerLine = body.split('\n')[0] || '';
  const header = parseShellHeader(headerLine);
  const stdoutMatch = body.match(/STDOUT:\n?([\s\S]*?)(?:\n\nSTDERR:|\nSTDERR:|$)/);
  const stderrMatch = body.match(/STDERR:\n?([\s\S]*)$/);
  const stdoutRaw = stdoutMatch ? stdoutMatch[1] : '';
  const stderrRaw = stderrMatch ? stderrMatch[1] : '';
  const stdout = stdoutRaw.trim() === '<empty>' ? '' : stdoutRaw.trimEnd();
  const stderr = stderrRaw.trim() === '<empty>' ? '' : stderrRaw.trimEnd();

  return { header, stdout, stderr, warnings };
}

function readStructuredStatus(structuredContent) {
  if (!structuredContent || typeof structuredContent !== 'object') return '';
  const chatos = structuredContent.chatos && typeof structuredContent.chatos === 'object' ? structuredContent.chatos : null;
  const raw = chatos?.status || structuredContent.status || '';
  return normalizeToolStatus(raw);
}

export function inferToolStatus(resultText, shellResult, structuredContent, toolIsError) {
  const structuredStatus = readStructuredStatus(structuredContent);
  if (structuredStatus) return structuredStatus;
  if (toolIsError) return 'error';
  if (!resultText) return 'pending';
  if (shellResult?.header?.timedOut) return 'timeout';
  if (typeof shellResult?.header?.exitCode === 'number' && shellResult.header.exitCode !== 0) return 'error';
  const lowered = String(resultText || '').toLowerCase();
  if (lowered.includes('[error]') || lowered.includes(' error ') || lowered.includes('failed')) return 'error';
  if (lowered.includes('canceled') || lowered.includes('cancelled') || lowered.includes('取消')) return 'canceled';
  if (lowered.includes('timeout') || lowered.includes('timed out') || lowered.includes('超时')) return 'timeout';
  if (lowered.includes('partial')) return 'partial';
  return 'ok';
}

export function pickStatusColor(status) {
  switch (status) {
    case 'error':
    case 'timeout':
      return 'red';
    case 'canceled':
      return 'orange';
    case 'pending':
      return 'gold';
    case 'partial':
      return 'geekblue';
    case 'ok':
    default:
      return 'purple';
  }
}

function pickStructuredValue(structuredContent, key) {
  if (!structuredContent || typeof structuredContent !== 'object') return '';
  const value = structuredContent[key];
  if (value === undefined || value === null) return '';
  return value;
}

export function buildToolSubtitle(toolName, argsParsed, structuredContent) {
  if (argsParsed && typeof argsParsed === 'object') {
    const rawName = typeof toolName === 'string' ? toolName.toLowerCase() : '';
    if (typeof argsParsed.command === 'string' && argsParsed.command.trim()) {
      return truncateText(argsParsed.command.trim(), 90);
    }
    if (typeof argsParsed.path === 'string' && argsParsed.path.trim()) {
      return truncateText(argsParsed.path.trim(), 90);
    }
    if (Array.isArray(argsParsed.paths) && argsParsed.paths.length > 0) {
      return truncateText(String(argsParsed.paths[0]), 90);
    }
    if (typeof argsParsed.query === 'string' && argsParsed.query.trim()) {
      return `search: ${truncateText(argsParsed.query.trim(), 80)}`;
    }
    if (typeof argsParsed.session === 'string' && argsParsed.session.trim()) {
      return rawName.includes('session')
        ? `session: ${truncateText(argsParsed.session.trim(), 80)}`
        : argsParsed.session.trim();
    }
    if (typeof argsParsed.title === 'string' && argsParsed.title.trim()) {
      return truncateText(argsParsed.title.trim(), 90);
    }
    if (typeof argsParsed.task === 'string' && argsParsed.task.trim()) {
      return truncateText(argsParsed.task.trim(), 90);
    }
    if (typeof argsParsed.url === 'string' && argsParsed.url.trim()) {
      return truncateText(argsParsed.url.trim(), 90);
    }
    if (typeof argsParsed.server_id === 'string' && argsParsed.server_id.trim()) {
      return `server: ${truncateText(argsParsed.server_id.trim(), 80)}`;
    }
  }

  const command = pickStructuredValue(structuredContent, 'command');
  if (typeof command === 'string' && command.trim()) {
    return truncateText(command.trim(), 90);
  }
  const path = pickStructuredValue(structuredContent, 'path');
  if (typeof path === 'string' && path.trim()) {
    return truncateText(path.trim(), 90);
  }
  const paths = pickStructuredValue(structuredContent, 'paths');
  if (Array.isArray(paths) && paths.length > 0) {
    return truncateText(String(paths[0]), 90);
  }
  const requestId = pickStructuredValue(structuredContent, 'request_id');
  if (typeof requestId === 'string' && requestId.trim()) {
    return `request: ${truncateText(requestId.trim(), 80)}`;
  }
  const entry = pickStructuredValue(structuredContent, 'entry');
  if (entry && typeof entry === 'object' && typeof entry.title === 'string' && entry.title.trim()) {
    return truncateText(entry.title.trim(), 90);
  }
  const url = pickStructuredValue(structuredContent, 'url');
  if (typeof url === 'string' && url.trim()) {
    return truncateText(url.trim(), 90);
  }
  return '';
}

export function buildToolPresentation({ toolName, argsText, resultText, structuredContent, toolIsError }) {
  const argsInfo = parseToolArgsText(argsText);
  const toolKind = inferToolKind(toolName);
  const shellResult = toolKind === 'shell' ? parseShellResult(resultText) : null;
  const status = inferToolStatus(resultText, shellResult, structuredContent, toolIsError);
  const subtitle = buildToolSubtitle(toolName, argsInfo.parsed, structuredContent);
  const color = pickStatusColor(status);
  return {
    argsInfo,
    toolKind,
    shellResult,
    status,
    subtitle,
    color,
  };
}

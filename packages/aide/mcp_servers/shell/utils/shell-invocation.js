import path from 'path';

export function getShellInvocation(shellPath, commandText) {
  const shell = typeof shellPath === 'string' && shellPath.trim() ? shellPath.trim() : null;
  if (process.platform === 'win32') {
    const picked = shell || process.env.COMSPEC || process.env.ComSpec || 'cmd.exe';
    const base = path.basename(picked).toLowerCase();
    if (base === 'powershell.exe' || base === 'pwsh.exe' || base === 'powershell' || base === 'pwsh') {
      return { file: picked, args: ['-NoProfile', '-Command', commandText] };
    }
    return { file: picked, args: ['/d', '/s', '/c', commandText] };
  }

  const picked = shell || process.env.SHELL || '/bin/bash';
  return { file: picked, args: ['-c', commandText] };
}

export function ensureBashGuard(commandText, shellPath) {
  const shell = typeof shellPath === 'string' ? shellPath : '';
  const base = path.basename(shell).toLowerCase();
  if (!base.includes('bash')) return commandText;
  const guard = 'shopt -u promptvars nullglob extglob nocaseglob dotglob;';
  const trimmed = String(commandText || '').trimStart();
  if (trimmed.startsWith(guard)) return commandText;
  return `${guard} ${commandText}`;
}

import { spawn } from 'child_process';
import { stripAnsi } from './ansi-utils.js';
import { appendToRollingBuffer, isBinaryBuffer } from './buffer-utils.js';
import { detectInteractivePrompt, tailText } from './prompt-utils.js';
import { ensureBashGuard, getShellInvocation } from './shell-invocation.js';

export async function execCommandWithPromptAbort({
  command,
  options,
  maxTailChars,
  abortOnPrompt,
  promptIdleMs,
  abortSignal,
} = {}) {
  const tailLimit = Number.isFinite(Number(maxTailChars)) ? Math.max(256, Math.floor(Number(maxTailChars))) : 4000;
  const promptIdle = Number.isFinite(Number(promptIdleMs)) ? Math.max(100, Math.floor(Number(promptIdleMs))) : 500;
  const abortEnabled = abortOnPrompt !== false;

  return await new Promise((resolve) => {
    let combinedTail = '';
    let lastOutputAt = Date.now();
    let promptInfo = null;
    let promptTimer = null;
    let killedForPrompt = false;
    let timedOut = false;
    let aborted = false;
    let binaryDetected = false;
    let bytesReceived = 0;
    let exitCode = null;
    let exitSignal = null;
    let settled = false;

    const maxBufferBytes = options?.maxBuffer;
    const stdoutState = { chunks: [], bytes: 0, truncated: false };
    const stderrState = { chunks: [], bytes: 0, truncated: false };

    const sniffBuffers = [];
    const MAX_SNIFF_SIZE = 4096;
    let sniffedBytes = 0;
    let killedForTimeout = false;
    let requestedKill = false;

    const cleanup = (child, abortHandler) => {
      if (promptTimer) clearTimeout(promptTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (abortSignal && typeof abortSignal.removeEventListener === 'function' && abortHandler) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
      try {
        child?.stdout?.removeAllListeners?.('data');
      } catch {
        // ignore
      }
      try {
        child?.stderr?.removeAllListeners?.('data');
      } catch {
        // ignore
      }
    };

    const finalize = (child, abortHandler) => {
      if (settled) return;
      settled = true;
      cleanup(child, abortHandler);

      const interruptedForPrompt = killedForPrompt === true && Boolean(promptInfo);
      const stdoutBuf = stdoutState.chunks.length > 0 ? Buffer.concat(stdoutState.chunks) : Buffer.from('');
      const stderrBuf = stderrState.chunks.length > 0 ? Buffer.concat(stderrState.chunks) : Buffer.from('');

      const stdoutText = binaryDetected ? '' : stripAnsi(stdoutBuf.toString('utf8')).replace(/\r\n/g, '\n');
      const stderrText = binaryDetected ? '' : stripAnsi(stderrBuf.toString('utf8')).replace(/\r\n/g, '\n');

      const truncationNote =
        stdoutState.truncated || stderrState.truncated
          ? `\n[WARNING: Output truncated to last ${Math.round(
              (Number.isFinite(Number(maxBufferBytes)) ? Number(maxBufferBytes) : 2 * 1024 * 1024) / (1024 * 1024)
            )}MB per stream.]`
          : '';
      const binaryNote = binaryDetected ? `\n[NOTE: Binary output detected; received ${bytesReceived} bytes.]` : '';

      resolve({
        stdout: stdoutText + (stdoutText && truncationNote ? truncationNote : '') + (stdoutText && binaryNote ? binaryNote : ''),
        stderr: stderrText + (!stdoutText && truncationNote ? truncationNote : '') + (!stdoutText && binaryNote ? binaryNote : ''),
        exitCode,
        signal: exitSignal,
        timedOut,
        aborted,
        interruptedForPrompt,
        prompt: promptInfo,
        binaryDetected,
        bytesReceived,
        truncated: stdoutState.truncated || stderrState.truncated,
      });
    };

    const requestKill = async (child, reason) => {
      if (requestedKill) return;
      requestedKill = true;
      const pid = child?.pid;
      if (!pid) return;

      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        } catch {
          // ignore
        }
        return;
      }

      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }

      const killTimer = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }, 200);
      if (killTimer && typeof killTimer.unref === 'function') killTimer.unref();
    };

    const schedulePromptCheck = (child) => {
      if (!abortEnabled || !child || killedForPrompt) return;
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = setTimeout(() => {
        if (killedForPrompt) return;
        if (!promptInfo) return;
        const idleFor = Date.now() - lastOutputAt;
        if (idleFor >= promptIdle) {
          killedForPrompt = true;
          requestKill(child, 'prompt');
          return;
        }
        schedulePromptCheck(child);
      }, promptIdle);
      if (promptTimer && typeof promptTimer.unref === 'function') promptTimer.unref();
    };

    const timeoutMs = Number.isFinite(Number(options?.timeout)) ? Math.max(0, Math.floor(Number(options.timeout))) : 0;
    const timeoutTimer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killedForTimeout = true;
            requestKill(child, 'timeout');
          }, timeoutMs)
        : null;
    if (timeoutTimer && typeof timeoutTimer.unref === 'function') timeoutTimer.unref();

    const abortHandler = () => {
      aborted = true;
      requestKill(child, 'abort');
    };
    if (abortSignal && typeof abortSignal.addEventListener === 'function') {
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }

    let child = null;
    try {
      const usedShell = options?.shell;
      const guardedCommand = ensureBashGuard(command, usedShell);
      const { file, args } = getShellInvocation(usedShell, guardedCommand);
      child = spawn(file, args, {
        cwd: options?.cwd,
        env: options?.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (err) {
      exitCode = 1;
      exitSignal = null;
      appendToRollingBuffer(stderrState, Buffer.from(String(err?.message || err || 'spawn failed'), 'utf8'), maxBufferBytes);
      finalize(null, abortHandler);
      return;
    }

    const handleChunk = (chunk) => {
      lastOutputAt = Date.now();
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
      bytesReceived += buf.length;

      if (!binaryDetected && sniffedBytes < MAX_SNIFF_SIZE) {
        sniffBuffers.push(buf);
        sniffedBytes += buf.length;
        const sniffBuf = Buffer.concat(sniffBuffers);
        if (sniffBuf.length >= 32 && isBinaryBuffer(sniffBuf)) {
          binaryDetected = true;
        }
      }

      const chunkText = stripAnsi(buf.toString('utf8')).replace(/\r\n/g, '\n');
      combinedTail = tailText(combinedTail + chunkText, tailLimit);
      if (!abortEnabled || killedForPrompt || binaryDetected) return;
      const detected = detectInteractivePrompt(combinedTail);
      if (detected) {
        promptInfo = detected;
        schedulePromptCheck(child);
      }
    };

    try {
      if (child?.stdout && typeof child.stdout.on === 'function') {
        child.stdout.on('data', (chunk) => {
          appendToRollingBuffer(stdoutState, chunk, maxBufferBytes);
          handleChunk(chunk);
        });
      }
      if (child?.stderr && typeof child.stderr.on === 'function') {
        child.stderr.on('data', (chunk) => {
          appendToRollingBuffer(stderrState, chunk, maxBufferBytes);
          handleChunk(chunk);
        });
      }
    } catch {
      // ignore
    }

    child.on('error', (err) => {
      exitCode = 1;
      exitSignal = null;
      appendToRollingBuffer(stderrState, Buffer.from(String(err?.message || err || 'spawn error'), 'utf8'), maxBufferBytes);
      finalize(child, abortHandler);
    });

    child.on('exit', (code, signal) => {
      exitCode = typeof code === 'number' ? code : null;
      exitSignal = signal || null;
      // If we were killed for timeout, prefer timedOut=true even if signal isn't SIGTERM.
      if (killedForTimeout) {
        timedOut = true;
      }
      finalize(child, abortHandler);
    });
  });
}

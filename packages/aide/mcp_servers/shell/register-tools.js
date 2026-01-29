import fs from 'fs';
import path from 'path';
import { execCommandWithPromptAbort } from './utils/exec-command.js';
import { isInsideWorkspaceRoot, logFileChangesFromDiff } from './utils/diff-utils.js';

export function registerShellTools(context = {}) {
  const {
    server,
    z,
    serverName,
    workspaceNote,
    workspaceRoot,
    defaultTimeout,
    maxBuffer,
    defaultShell,
    execAsync,
    sessions,
    fsOps,
    ensurePath,
    safeStat,
    assertCommandPathsWithinRoot,
    clampNumber,
    shouldConfirmFileChanges,
    looksLikeFileMutationCommand,
    isSafeGitPreviewCommand,
    canPreviewGitDiff,
    getGitStatusPorcelain,
    getGitDiff,
    buildUntrackedPseudoDiff,
    rollbackGitWorkspace,
    promptFileChangeConfirm,
    normalizeEnv,
    formatCommandResult,
    textResponse,
    structuredResponse,
    truncateForUi,
    analyzeShellCommand,
    shellSafetyMode,
  } = context;

  if (!server) throw new Error('Missing MCP server');
  if (!z) throw new Error('Missing zod');
  if (!sessions) throw new Error('Missing session manager');
  const pickUserMessageId = (extra) => {
    const meta = extra?._meta && typeof extra._meta === 'object' ? extra._meta : {};
    const raw =
      typeof meta.userMessageId === 'string'
        ? meta.userMessageId
        : typeof meta.user_message_id === 'string'
          ? meta.user_message_id
          : '';
    return raw.trim();
  };

  server.registerTool(
    'run_shell_command',
    {
      title: 'Run shell command',
      description:
        [
          'Execute a command inside the restricted workspace root and return stdout/stderr. Use this for short-lived commands (seconds to ~1-2 minutes). For long-running/streaming/daemon tasks, use session_run + session_capture_output to avoid timeouts.',
          workspaceNote,
          'Short examples: {"command":"ls -la"}, {"command":"cat package.json"}, {"command":"npm test -- --help","cwd":"frontend"}, {"command":"git status"}.',
        ].join('\n'),
      inputSchema: z.object({
        command: z.string().min(1).describe('Full command to execute'),
        cwd: z.string().optional().describe('Working directory relative to root (default root)'),
        timeout_ms: z.number().int().min(1000).max(10 * 60 * 1000).optional().describe('Custom timeout (ms)'),
        shell: z.string().optional().describe('Optional shell override'),
        env: z.record(z.string()).optional().describe('Extra environment variables'),
      }),
    },
    async ({ command, cwd = '.', timeout_ms: timeout, shell, env }, extra) => {
      const userMessageId = pickUserMessageId(extra);
      const workingDir = await ensurePath(cwd);
      const usedShell = shell || defaultShell;
      const analysis = typeof analyzeShellCommand === 'function' ? analyzeShellCommand(command) : null;
      const safetyMode = typeof shellSafetyMode === 'string' ? shellSafetyMode : 'strict';
      if (analysis?.dangerous && safetyMode !== 'relaxed') {
        throw new Error('Command blocked: detected high-risk shell pattern. Please review or use a safer command.');
      }
      const referencedPaths = assertCommandPathsWithinRoot(command, workingDir, usedShell) || [];
      const effectiveTimeout = clampNumber(timeout, 1000, 15 * 60 * 1000, defaultTimeout);
      const confirmEnabled = shouldConfirmFileChanges();
      const looksMutating = looksLikeFileMutationCommand(command);
      const wantsChangeTracking = confirmEnabled || looksMutating;
      const gitPreviewCapable =
        wantsChangeTracking && isSafeGitPreviewCommand(command) && (await canPreviewGitDiff(workingDir));
      let preConfirmedRemark = '';
      const snapshotCandidates = [];
      if (
        wantsChangeTracking &&
        looksMutating &&
        !gitPreviewCapable &&
        workspaceRoot &&
        fsOps &&
        typeof fsOps.snapshotFiles === 'function' &&
        Array.isArray(referencedPaths) &&
        referencedPaths.length > 0
      ) {
        const root = path.resolve(String(workspaceRoot));
        for (const absPath of referencedPaths) {
          if (!absPath) continue;
          const resolved = path.resolve(String(absPath));
          if (!isInsideWorkspaceRoot(root, resolved)) continue;
          const rel = path.relative(root, resolved).replace(/\\/g, '/');
          if (!rel || rel === '.') continue;
          let stats = null;
          try {
            // eslint-disable-next-line no-await-in-loop
            stats = await safeStat(resolved);
          } catch {
            stats = null;
          }
          if (stats?.isDirectory?.()) continue;
          snapshotCandidates.push(rel);
          if (snapshotCandidates.length >= 25) break;
        }
      }

      const snapshotCapable =
        wantsChangeTracking &&
        looksMutating &&
        !gitPreviewCapable &&
        snapshotCandidates.length > 0 &&
        fsOps &&
        typeof fsOps.snapshotFiles === 'function' &&
        typeof fsOps.generateUnifiedDiff === 'function' &&
        typeof fsOps.logFileChange === 'function';
      const beforeSnapshots = snapshotCapable
        ? await fsOps.snapshotFiles(snapshotCandidates, path.resolve(String(workspaceRoot)))
        : null;

      if (confirmEnabled && looksMutating && !gitPreviewCapable && !snapshotCapable) {
        const pre = await promptFileChangeConfirm({
          title: '文件变更确认（Shell）',
          message:
            '检测到该命令可能会改动文件，但当前无法预览 diff（非 git 仓库/工作区不干净/命令不安全）。确认后将继续执行。',
          command,
          cwd: workingDir,
          diff: '',
          path: '',
          source: `${serverName}/run_shell_command`,
        });
        if (pre.status !== 'ok') {
          return structuredResponse(`✗ Canceled shell command.\n\n$ ${command}\ncwd: ${workingDir}`, {
            status: 'canceled',
            request_id: pre.requestId,
          });
        }
        preConfirmedRemark = pre.remark || '';
      }
      const options = {
        cwd: workingDir,
        timeout: effectiveTimeout,
        maxBuffer,
        shell: usedShell,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          PAGER: 'cat',
          GIT_PAGER: 'cat',
          GIT_TERMINAL_PROMPT: '0',
          ...normalizeEnv(env),
        },
      };
      let formatted = '';
      let execResult = {
        stdout: '',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        interruptedForPrompt: false,
        prompt: null,
      };
      const startedAt = Date.now();
      execResult = await execCommandWithPromptAbort({
        command,
        options,
        maxTailChars: 8000,
        abortOnPrompt: true,
        promptIdleMs: 500,
        abortSignal: extra?.signal,
      });
      const elapsedMs = Date.now() - startedAt;

      const warningBlock =
        analysis && Array.isArray(analysis.warnings) && analysis.warnings.length > 0
          ? `\n\n[Warnings]\n- ${analysis.warnings.join('\n- ')}`
          : '';
      formatted = formatCommandResult({
        command,
        cwd: workingDir,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        signal: execResult.signal,
        timedOut: execResult.timedOut,
        elapsedMs,
        bytesReceived: execResult.bytesReceived,
      }) + warningBlock;

      if (execResult.interruptedForPrompt) {
        const promptLine = execResult?.prompt?.line ? `\nDetected prompt: ${execResult.prompt.line}` : '';
        const hint = [
          formatted,
          '',
          'NOTE: Command appears to be waiting for interactive input (Y/n, password, multi-step prompt, etc.).',
          'The command was stopped early to avoid hanging until timeout.',
          'Next: re-run via mcp_shell_tasks_session_run, then use session_capture_output and session_send_input to respond.',
          'Alternatively: prefer non-interactive flags (--yes/--no-input/--force, ssh-keygen -f/-N, etc.).',
          promptLine.trim() ? promptLine : '',
        ]
          .filter(Boolean)
          .join('\n');
        return structuredResponse(hint, {
          status: 'needs_input',
          prompt_kind: execResult?.prompt?.kind || 'unknown',
          prompt_line: execResult?.prompt?.line || '',
        });
      }

      if (gitPreviewCapable) {
        const afterStatus = await getGitStatusPorcelain(workingDir);
        const trackedDiff = await getGitDiff(workingDir);
        const untrackedDiff = await buildUntrackedPseudoDiff(workingDir, afterStatus);
        const combinedDiff = `${trackedDiff || ''}${trackedDiff && untrackedDiff ? '\n' : ''}${untrackedDiff || ''}`;
        if (!combinedDiff.trim()) {
          return textResponse(formatted);
        }

        if (!confirmEnabled) {
          await logFileChangesFromDiff({
            diffText: combinedDiff,
            workspaceRoot,
            fsOps,
            tool: 'run_shell_command',
            mode: 'shell',
            userMessageId,
          });
          return textResponse(formatted);
        }

        const review = await promptFileChangeConfirm({
          title: '文件变更确认（Shell）',
          message: '检测到 shell 命令产生了文件变更。确认后保留变更，取消则回滚这些变更。',
          command,
          cwd: workingDir,
          diff: combinedDiff,
          path: '',
          source: `${serverName}/run_shell_command`,
        });
        if (review.status !== 'ok') {
          await rollbackGitWorkspace(workingDir);
          return structuredResponse(`${formatted}\n\n✗ 用户取消文件变更，已回滚。`, {
            status: 'canceled',
            request_id: review.requestId,
          });
        }

        await logFileChangesFromDiff({
          diffText: combinedDiff,
          workspaceRoot,
          fsOps,
          tool: 'run_shell_command',
          mode: 'shell',
          userMessageId,
        });

        const remark = review.remark ? `\n\nUser remark: ${review.remark}` : '';
        return structuredResponse(`${formatted}\n\n✓ 用户确认文件变更。${remark}`, {
          status: 'ok',
          confirmed: true,
          remark: review.remark || '',
          diff_truncated: truncateForUi(combinedDiff, 60_000),
        });
      }

      if (snapshotCapable && beforeSnapshots) {
        const afterSnapshots = await fsOps.snapshotFiles(snapshotCandidates, path.resolve(String(workspaceRoot)));
        const keys = new Set();
        beforeSnapshots.forEach((_v, key) => keys.add(key));
        afterSnapshots.forEach((_v, key) => keys.add(key));

        const changed = [];
        for (const relPath of Array.from(keys)) {
          const before = beforeSnapshots.get(relPath) || { exists: false, content: '' };
          const after = afterSnapshots.get(relPath) || { exists: false, content: '' };
          const beforeExists = Boolean(before?.exists);
          const afterExists = Boolean(after?.exists);
          const beforeContent = before?.content ?? '';
          const afterContent = after?.content ?? '';
          if (!beforeExists && !afterExists) continue;
          if (beforeExists && afterExists && beforeContent === afterContent) continue;
          const diff = await fsOps.generateUnifiedDiff(relPath, beforeContent, afterContent);
          changed.push({
            relPath,
            absolutePath: after?.absolutePath || before?.absolutePath || path.resolve(String(workspaceRoot), relPath),
            before: { exists: beforeExists, content: beforeContent },
            after: { exists: afterExists, content: afterContent },
            diff,
          });
        }

        if (changed.length === 0) {
          return textResponse(formatted);
        }

        const combinedDiff = changed.map((entry) => entry.diff).join('\n\n');
        if (!confirmEnabled) {
          for (const entry of changed) {
            const absPath = entry?.absolutePath;
            if (!absPath || !isInsideWorkspaceRoot(String(workspaceRoot), absPath)) continue;
            // eslint-disable-next-line no-await-in-loop
            await fsOps.logFileChange({
              relPath: entry.relPath,
              absolutePath: absPath,
              before: entry.before,
              after: entry.after,
              tool: 'run_shell_command',
              mode: 'shell',
              patchText: entry.diff,
              userMessageId,
            });
          }
          return textResponse(formatted);
        }

        const review = await promptFileChangeConfirm({
          title: '文件变更确认（Shell）',
          message: '检测到 shell 命令产生了文件变更。确认后保留变更，取消则回滚这些变更。',
          command,
          cwd: workingDir,
          diff: combinedDiff,
          path: changed[0]?.relPath || '',
          source: `${serverName}/run_shell_command`,
        });
        if (review.status !== 'ok') {
          for (const entry of changed) {
            const absPath = entry?.absolutePath;
            if (!absPath || !isInsideWorkspaceRoot(String(workspaceRoot), absPath)) continue;
            try {
              if (entry.before.exists) {
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.writeFile(absPath, entry.before.content || '', 'utf8');
              } else {
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.rm(absPath, { force: true });
              }
            } catch {
              // ignore rollback failures
            }
          }
          return structuredResponse(`${formatted}\n\n✗ 用户取消文件变更，已回滚。`, {
            status: 'canceled',
            request_id: review.requestId,
          });
        }

        for (const entry of changed) {
          const absPath = entry?.absolutePath;
          if (!absPath || !isInsideWorkspaceRoot(String(workspaceRoot), absPath)) continue;
          // eslint-disable-next-line no-await-in-loop
          await fsOps.logFileChange({
            relPath: entry.relPath,
            absolutePath: absPath,
            before: entry.before,
            after: entry.after,
            tool: 'run_shell_command',
            mode: 'shell',
            patchText: entry.diff,
            userMessageId,
          });
        }

        const remark = review.remark ? `\n\nUser remark: ${review.remark}` : '';
        return structuredResponse(`${formatted}\n\n✓ 用户确认文件变更。${remark}`, {
          status: 'ok',
          confirmed: true,
          remark: review.remark || '',
          diff_truncated: truncateForUi(combinedDiff, 60_000),
        });
      }

      if (confirmEnabled && looksMutating && !gitPreviewCapable) {
        const remark = preConfirmedRemark ? `\n\nUser remark: ${preConfirmedRemark}` : '';
        return structuredResponse(`${formatted}${remark}`, {
          status: 'ok',
          confirmed: true,
          remark: preConfirmedRemark || '',
          preview: 'unavailable',
        });
      }

      return textResponse(formatted);
    }
  );

  server.registerTool(
    'list_workspace_files',
    {
      title: 'List workspace files',
      description: ['Quickly list first-level files/directories under root (or a subpath).', workspaceNote].join('\n'),
      inputSchema: z.object({
        path: z.string().optional().describe('Start directory relative to root'),
      }),
    },
    async ({ path: listPath = '.' }) => {
      const target = await ensurePath(listPath);
      const stats = await safeStat(target);
      if (!stats || !stats.isDirectory()) {
        throw new Error('Target is not a directory.');
      }
      const entries = await fs.promises.readdir(target);
      const lines = entries.slice(0, 100).map((name) => `- ${name}`);
      return textResponse(lines.join('\n') || '<empty>');
    }
  );

  server.registerTool(
    'session_run',
    {
      title: 'Run long command in session',
      description:
        [
          'Start or reuse a long-running session for streaming/daemon commands (>~1-2 minutes: services/watch/build/log tail, etc.). Use session_capture_output to read output.',
          workspaceNote,
          'Long-run examples: {"command":"npm run dev","session":"frontend","cwd":"app"}, {"command":"mvn spring-boot:run","session":"svc"}, {"command":"pytest -vv --maxfail=1","session":"tests","cwd":"backend"}, {"command":"tail -f logs/app.log","session":"logs"}, {"command":"node server.js","session":"api"}.',
        ].join('\n'),
      inputSchema: z.object({
        command: z.string().min(1).describe('Full command to execute'),
        session: z.string().optional().describe('Session name (auto-generated if omitted)'),
        cwd: z.string().optional().describe('Working directory relative to root (default root)'),
        env: z.record(z.string()).optional().describe('Extra environment variables'),
        window: z.string().optional().describe('Optional window name'),
        preview_lines: z
          .number()
          .int()
          .min(10)
          .max(5000)
          .optional()
          .describe('After starting, include a preview of the latest output lines (default 120)'),
        preview_wait_ms: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .describe('Wait up to this long for initial output before previewing (default 300; 0 disables)'),
      }),
    },
    async ({ command, session, cwd = '.', env, window, preview_lines, preview_wait_ms }) => {
      const workingDir = await ensurePath(cwd);
      const analysis = typeof analyzeShellCommand === 'function' ? analyzeShellCommand(command) : null;
      const safetyMode = typeof shellSafetyMode === 'string' ? shellSafetyMode : 'strict';
      if (analysis?.dangerous && safetyMode !== 'relaxed') {
        throw new Error('Command blocked: detected high-risk shell pattern. Please review or use a safer command.');
      }
      assertCommandPathsWithinRoot(command, workingDir, defaultShell);
      const sessionName = sessions.sanitizeName(session || `sess_${Date.now().toString(36)}`);
      const windowName = window ? sessions.sanitizeName(window) : null;
      const envVars = normalizeEnv(env);
      const result = await sessions.start({
        sessionName,
        command,
        workingDir,
        envVars,
        windowName,
      });
      const paths = result.outputPath
        ? `\noutput: ${result.outputPath}\ncontrol: ${result.controlPath}\nstatus: ${result.statusPath}`
        : '';
      const reuseRemark = result.reused ? ' (reused)' : '';

      const previewLines = clampNumber(preview_lines, 10, 5000, 120);
      const previewWaitMs = clampNumber(preview_wait_ms, 0, 5000, 300);
      let previewText = '';
      if (previewWaitMs > 0) {
        const startAt = Date.now();
        // eslint-disable-next-line no-await-in-loop
        while (Date.now() - startAt <= previewWaitMs) {
          try {
            // eslint-disable-next-line no-await-in-loop
            previewText = await sessions.captureOutput({ sessionName: result.sessionName, lineCount: previewLines });
          } catch {
            previewText = '';
          }
          if (previewText && previewText.trim()) break;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 60));
        }
      } else if (previewWaitMs === 0) {
        previewText = '';
      }

      const warningBlock =
        analysis && Array.isArray(analysis.warnings) && analysis.warnings.length > 0
          ? `\n\n[Warnings]\n- ${analysis.warnings.join('\n- ')}`
          : '';
      const previewBlock =
        previewWaitMs > 0
          ? `\n\n--- preview (last ${previewLines} lines) ---\n${previewText || '<empty>'}\n--- end preview ---`
          : '';
      return textResponse(
        `Started session "${result.sessionName}"${reuseRemark}${result.windowName ? ` window "${result.windowName}"` : ''}.${paths}${warningBlock}${previewBlock}`
      );
    }
  );

  server.registerTool(
    'session_capture_output',
    {
      title: 'Capture session output',
      description: 'Fetch recent output from a session (paired with session_run). Example: {"session":"svc","lines":300}',
      inputSchema: z.object({
        session: z.string().min(1).describe('Session name'),
        lines: z.number().int().min(10).max(5000).optional().describe('Max lines to return (default 500)'),
      }),
    },
    async ({ session, lines }) => {
      const sessionName = sessions.sanitizeName(session);
      const lineCount = Number.isFinite(Number(lines)) ? Math.max(10, Math.min(5000, Math.floor(Number(lines)))) : 500;
      const output = await sessions.captureOutput({ sessionName, lineCount });
      return textResponse(`Session: ${sessionName}\nLines: ${lineCount}\n\n${output || '<empty>'}`);
    }
  );

  server.registerTool(
    'session_send_input',
    {
      title: 'Send input to session',
      description: 'Send text to a running session. Example: {"session":"svc","data":"q","enter":true}',
      inputSchema: z.object({
        session: z.string().min(1).describe('Session name'),
        data: z.string().optional().describe('Text to write'),
        enter: z.boolean().optional().describe('Append newline'),
      }),
    },
    async ({ session, data, enter }) => {
      const sessionName = sessions.sanitizeName(session);
      await sessions.sendInput({ sessionName, data: data || '', enter: enter === true });
      return textResponse(`OK: wrote to session "${sessionName}"${enter ? ' (enter)' : ''}.`);
    }
  );

  server.registerTool(
    'session_send_signal',
    {
      title: 'Send signal to session',
      description: 'Send a signal to a session. Example: {"session":"svc","signal":"SIGINT"}',
      inputSchema: z.object({
        session: z.string().min(1).describe('Session name'),
        signal: z.string().optional().describe('Signal (SIGINT/SIGTERM/SIGKILL/SIGHUP/SIGQUIT)'),
      }),
    },
    async ({ session, signal }) => {
      const sessionName = sessions.sanitizeName(session);
      const sig = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
      await sessions.sendSignal({ sessionName, signal: sig });
      return textResponse(`OK: sent ${sig} to session "${sessionName}".`);
    }
  );

  server.registerTool(
    'session_kill',
    {
      title: 'Kill session',
      description: 'Stop a long-running session. Example: {"session":"svc"}',
      inputSchema: z.object({
        session: z.string().min(1).describe('Session name'),
      }),
    },
    async ({ session }) => {
      const sessionName = sessions.sanitizeName(session);
      await sessions.killSession({ sessionName });
      return textResponse(`OK: kill requested for session "${sessionName}".`);
    }
  );

  server.registerTool(
    'session_list',
    {
      title: 'List sessions',
      description: 'List long-running sessions created by this server.',
      inputSchema: z.object({}),
    },
    async () => {
      const list = sessions.listSessions();
      return textResponse(JSON.stringify({ count: list.length, sessions: list }, null, 2));
    }
  );
}

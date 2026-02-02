import fs from 'fs';
import { spawn } from 'child_process';
import { clampNumber } from '../cli-utils.js';
import { applyTextEdits, normalizeTextEdits } from './utils/text-edits.js';
import { formatBytes, fromFileUri, guessLanguageId, hashContent, safeStat, toFileUri } from './utils/document-utils.js';

const fsp = fs.promises;
class LspClient {
  constructor({
    id,
    command,
    args,
    cwd,
    env,
    initializationOptions,
    rootUri,
    workspaceName,
    serverName,
    fsOps,
    allowWrites,
    maxFileBytes,
    defaultTimeoutMs,
  }) {
    this.id = id;
    this.command = command;
    this.args = Array.isArray(args) ? args : [];
    this.cwd = cwd;
    this.env = env && typeof env === 'object' ? env : null;
    this.initializationOptions = initializationOptions && typeof initializationOptions === 'object' ? initializationOptions : null;
    this.rootUri = rootUri;
    this.workspaceName = workspaceName || 'workspace';
    this.serverName = serverName || 'lsp_bridge';
    this.fsOps = fsOps;
    this.writesEnabled = Boolean(allowWrites);
    this.maxFileBytes = clampNumber(maxFileBytes, 1024, 5 * 1024 * 1024, 512 * 1024);
    this.defaultTimeoutMs = clampNumber(defaultTimeoutMs, 1000, 5 * 60 * 1000, 30 * 1000);

    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.nextRequestId = 1;
    this.pending = new Map();
    this.initialized = false;
    this.documentState = new Map(); // uri -> { version, sha256, absPath, languageId }
    this.diagnosticsByUri = new Map();
  }

  isRunning() {
    return Boolean(
      this.proc &&
        this.proc.exitCode === null &&
        this.proc.signalCode === null &&
        !this.proc.killed
    );
  }

  async start() {
    if (this.proc && this.isRunning()) {
      throw new Error(`LSP client already started: ${this.id}`);
    }
    if (this.proc && !this.isRunning()) {
      this.resetState();
    }
    const env = { ...process.env, ...(this.env || {}) };
    this.proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.proc.stderr.on('data', (chunk) => this.onStderr(chunk));
    this.proc.on('exit', (code, signal) => this.onExit(code, signal));
    this.proc.on('error', (err) => this.onError(err));

    await this.initialize();
  }

  async stop({ force } = {}) {
    const proc = this.proc;
    if (!proc) return;
    try {
      if (this.initialized) {
        await this.request('shutdown', null, { timeoutMs: 5000 }).catch(() => {});
        this.notify('exit', null);
      }
    } catch {
      // ignore
    }

    await waitForExit(proc, 1500).catch(() => {});
    if (!proc.killed) {
      if (force) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      } else {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    }
    this.resetState();
    this.rejectAllPending(new Error(`LSP server stopped: ${this.id}`));
  }

  onStdout(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (true) {
      const headerEnd = findHeaderEnd(this.buffer);
      if (headerEnd < 0) break;
      const headerText = this.buffer.slice(0, headerEnd).toString('ascii');
      const contentLength = parseContentLength(headerText);
      if (!Number.isFinite(contentLength) || contentLength < 0) {
        this.buffer = this.buffer.slice(headerEnd + headerDelimiterLength(this.buffer, headerEnd));
        continue;
      }
      const bodyStart = headerEnd + headerDelimiterLength(this.buffer, headerEnd);
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) break;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.slice(bodyEnd);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this.handleMessage(message).catch(() => {});
    }
  }

  onStderr(chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    const trimmed = text.trim();
    if (trimmed) {
      console.error(`[${this.serverName}:${this.id}] ${trimmed}`);
    }
  }

  onExit(code, signal) {
    const err = new Error(`LSP server exited: ${this.id} (code=${code ?? 'n/a'}, signal=${signal ?? 'n/a'})`);
    this.handleProcessExit(err);
  }

  onError(err) {
    const e = err instanceof Error ? err : new Error(String(err || 'LSP process error'));
    this.handleProcessExit(e);
  }

  handleProcessExit(err) {
    this.resetState();
    this.rejectAllPending(err);
  }

  resetState() {
    this.proc = null;
    this.initialized = false;
    this.buffer = Buffer.alloc(0);
    this.documentState.clear();
    this.diagnosticsByUri.clear();
  }

  rejectAllPending(err) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      if (entry.signal && entry.abortHandler) {
        try {
          entry.signal.removeEventListener('abort', entry.abortHandler);
        } catch {
          // ignore
        }
      }
      entry.reject(err);
    }
    this.pending.clear();
  }

  async initialize() {
    const capabilities = buildClientCapabilities();
    const params = {
      processId: process.pid,
      clientInfo: { name: this.serverName, version: '0.1.0' },
      rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: this.workspaceName }],
      capabilities,
      initializationOptions: this.initializationOptions || undefined,
    };
    await this.request('initialize', params, { timeoutMs: this.defaultTimeoutMs });
    this.notify('initialized', {});
    this.initialized = true;
  }

  send(message) {
    const proc = this.proc;
    if (!proc || !proc.stdin || proc.stdin.destroyed) {
      throw new Error(`LSP stdin not available: ${this.id}`);
    }
    const json = JSON.stringify(message);
    const bytes = Buffer.byteLength(json, 'utf8');
    const payload = `Content-Length: ${bytes}\r\n\r\n${json}`;
    proc.stdin.write(payload, 'utf8');
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params: params === undefined ? null : params });
  }

  request(method, params, { timeoutMs, signal } = {}) {
    const id = this.nextRequestId++;
    const msg = { jsonrpc: '2.0', id, method, params: params === undefined ? null : params };
    const ms = clampNumber(timeoutMs, 100, 5 * 60 * 1000, this.defaultTimeoutMs);
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        if (!this.pending.has(id)) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        this.sendCancelRequest(id);
        reject(new Error(`LSP request aborted: ${method}`));
      };
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.sendCancelRequest(id);
        if (signal && abortHandler) {
          try {
            signal.removeEventListener('abort', abortHandler);
          } catch {
            // ignore
          }
        }
        reject(new Error(`LSP request timeout: ${method} (${ms}ms)`));
      }, ms);
      this.pending.set(id, { resolve, reject, timeout, method, signal, abortHandler });
      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }
      try {
        this.send(msg);
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        if (signal && abortHandler) {
          try {
            signal.removeEventListener('abort', abortHandler);
          } catch {
            // ignore
          }
        }
        reject(err);
      }
    });
  }

  sendCancelRequest(id) {
    if (!Number.isFinite(id)) return;
    try {
      this.send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } });
    } catch {
      // ignore
    }
  }

  async handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const hasMethod = typeof message.method === 'string' && message.method;

    if (hasId && hasMethod) {
      const id = message.id;
      const method = message.method;
      try {
        const result = await this.handleServerRequest(method, message.params);
        this.send({ jsonrpc: '2.0', id, result: result === undefined ? null : result });
      } catch (err) {
        this.send({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err?.message || String(err || 'Internal error') },
        });
      }
      return;
    }

    if (hasId && !hasMethod) {
      const id = message.id;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      if (pending.signal && pending.abortHandler) {
        try {
          pending.signal.removeEventListener('abort', pending.abortHandler);
        } catch {
          // ignore
        }
      }
      if (message.error) {
        pending.reject(new Error(message.error.message || 'LSP error'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!hasId && hasMethod) {
      this.handleServerNotification(message.method, message.params);
    }
  }

  async handleServerRequest(method, params) {
    if (method === 'workspace/configuration') {
      const items = Array.isArray(params?.items) ? params.items : [];
      return items.map(() => ({}));
    }
    if (method === 'workspace/workspaceFolders') {
      return [{ uri: this.rootUri, name: this.workspaceName }];
    }
    if (method === 'client/registerCapability' || method === 'client/unregisterCapability') {
      return null;
    }
    if (method === 'window/workDoneProgress/create') {
      return null;
    }
    if (method === 'window/showMessageRequest') {
      return null;
    }
    return null;
  }

  handleServerNotification(method, params) {
    if (method === 'textDocument/publishDiagnostics') {
      const uri = typeof params?.uri === 'string' ? params.uri : '';
      const diagnostics = Array.isArray(params?.diagnostics) ? params.diagnostics : [];
      if (uri) {
        this.diagnosticsByUri.set(uri, diagnostics);
      }
      return;
    }
    // ignore: window/logMessage, $/progress, telemetry/event, etc.
  }

  getDiagnostics(uri) {
    return this.diagnosticsByUri.get(uri) || null;
  }

  async syncDocument({ path: filePathRel }) {
    if (!this.initialized) {
      throw new Error(`LSP client not initialized: ${this.id}`);
    }
    const absPath = await this.fsOps.ensurePath(filePathRel);
    const stats = await safeStat(absPath);
    if (!stats || !stats.isFile()) {
      throw new Error(`File not found: ${this.fsOps.relativePath(absPath)}`);
    }
    if (stats.size > this.maxFileBytes) {
      throw new Error(`File too large (${formatBytes(stats.size)}), exceeds limit ${formatBytes(this.maxFileBytes)}.`);
    }
    const rawContent = await fsp.readFile(absPath, { encoding: 'utf8' });
    const lineEnding = rawContent.includes('\r\n') ? '\r\n' : '\n';
    const content = lineEnding === '\r\n' ? rawContent.replace(/\r\n/g, '\n') : rawContent;
    const uri = toFileUri(absPath);
    const sha256 = hashContent(content);
    const existing = this.documentState.get(uri);
    const languageId = guessLanguageId(absPath);
    if (!existing) {
      const version = 1;
      this.documentState.set(uri, { version, sha256, absPath, languageId, lineEnding });
      this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId, version, text: content },
      });
      return { uri, path: this.fsOps.relativePath(absPath), version, sha256, language_id: languageId };
    }
    if (existing.sha256 !== sha256) {
      const version = clampNumber(existing.version + 1, 1, Number.MAX_SAFE_INTEGER, existing.version + 1);
      this.documentState.set(uri, { ...existing, version, sha256, absPath, languageId, lineEnding });
      this.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
      return { uri, path: this.fsOps.relativePath(absPath), version, sha256, language_id: languageId };
    }
    return { uri, path: this.fsOps.relativePath(absPath), version: existing.version, sha256: existing.sha256, language_id: languageId };
  }

  async applyTextEditsToDisk({ uri, edits, userMessageId, sessionId }) {
    if (!this.writesEnabled) {
      throw new Error('Writes are disabled. Start this MCP server with --write to apply edits.');
    }
    const absPath = fromFileUri(uri);
    if (!absPath) {
      throw new Error('Only file:// URIs are supported for applyTextEditsToDisk.');
    }
    const target = await this.fsOps.ensurePath(absPath);
    const before = await this.fsOps.readFileSnapshot(target);
    if (!before?.exists) {
      throw new Error(`Target does not exist: ${this.fsOps.relativePath(target)}`);
    }
    const currentRaw = before.content ?? '';
    const originalLineEnding = currentRaw.includes('\r\n') ? '\r\n' : '\n';
    const current = originalLineEnding === '\r\n' ? currentRaw.replace(/\r\n/g, '\n') : currentRaw;
    const normalizedEdits = normalizeTextEdits(edits);
    const applied = applyTextEdits(current, normalizedEdits);
    if (!applied.changed) {
      return { status: 'noop', path: this.fsOps.relativePath(target), edits: normalizedEdits.length };
    }
    const nextRaw = originalLineEnding === '\r\n' ? applied.text.replace(/\n/g, '\r\n') : applied.text;
    await fsp.writeFile(target, nextRaw, 'utf8');
    const after = await this.fsOps.readFileSnapshot(target);
    await this.fsOps.logFileChange({
      relPath: this.fsOps.relativePath(target),
      absolutePath: target,
      before,
      after,
      tool: 'lsp_apply_text_edits',
      mode: 'edit',
      userMessageId,
      sessionId,
    });
    return { status: 'ok', path: this.fsOps.relativePath(target), edits: normalizedEdits.length };
  }

  async applyWorkspaceEditToDisk(edit, { userMessageId, sessionId } = {}) {
    if (!this.writesEnabled) {
      throw new Error('Writes are disabled. Start this MCP server with --write to apply edits.');
    }
    if (!edit || typeof edit !== 'object') {
      throw new Error('Invalid WorkspaceEdit.');
    }
    if (edit.documentChanges) {
      throw new Error('WorkspaceEdit.documentChanges is not supported yet (only "changes" is supported).');
    }
    const changes = edit.changes && typeof edit.changes === 'object' ? edit.changes : null;
    if (!changes) {
      return { status: 'noop', files: 0, edits: 0 };
    }
    const uris = Object.keys(changes);
    let totalEdits = 0;
    const results = [];
    for (const uri of uris) {
      const edits = changes[uri];
      const applied = await this.applyTextEditsToDisk({ uri, edits, userMessageId, sessionId });
      totalEdits += Array.isArray(edits) ? edits.length : 0;
      results.push({ uri, ...applied });
    }
    return { status: 'ok', files: results.length, edits: totalEdits, results };
  }
}

function buildClientCapabilities() {
  return {
    workspace: {
      workspaceFolders: true,
      configuration: true,
    },
    textDocument: {
      synchronization: {
        dynamicRegistration: false,
        didSave: true,
        willSave: false,
        willSaveWaitUntil: false,
      },
      hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
      definition: { dynamicRegistration: false, linkSupport: true },
      references: { dynamicRegistration: false },
      completion: {
        dynamicRegistration: false,
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
          documentationFormat: ['markdown', 'plaintext'],
        },
      },
      documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
      rename: { dynamicRegistration: false, prepareSupport: false },
      formatting: { dynamicRegistration: false },
    },
  };
}

function findHeaderEnd(buffer) {
  const idxCrlf = buffer.indexOf('\r\n\r\n');
  if (idxCrlf !== -1) return idxCrlf;
  const idxLf = buffer.indexOf('\n\n');
  if (idxLf !== -1) return idxLf;
  return -1;
}

function headerDelimiterLength(buffer, headerEnd) {
  if (buffer.slice(headerEnd, headerEnd + 4).toString('ascii') === '\r\n\r\n') return 4;
  if (buffer.slice(headerEnd, headerEnd + 2).toString('ascii') === '\n\n') return 2;
  return 4;
}

function parseContentLength(headerText) {
  const match = headerText.match(/Content-Length:\s*(\d+)/i);
  if (!match) return NaN;
  return Number(match[1]);
}

function waitForExit(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('Process exit timeout'));
    }, timeoutMs);
    proc.once('exit', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

export { LspClient };

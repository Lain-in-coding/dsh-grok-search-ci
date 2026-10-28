import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { GrokSearchError, isRecord, timeoutError } from './errors.mjs';
import { decodeGrokResult, mapSearchResult } from './result-map.mjs';

const FRAME_BYTES = 1_048_576;
const SYSTEM_ENV = new Set([
  'PATH', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
]);
const GROK_ENV = /^(?:GROK_SEARCH_[A-Z0-9_]+|TAVILY_API_KEY|EXA_API_KEY|TINYFISH_API_KEY|FIRECRAWL_API_KEY)$/;
const failure = (code, message) => new GrokSearchError(code, message);
const safeLabel = value => typeof value === 'string' && /^[\w.+-]{1,80}$/.test(value) ? value : null;

// 继承模式只传系统、代理及已知上游变量；配置文件由子进程自行读取。
export function executionEnvironment(overrides = {}, configPath) {
  if (!isRecord(overrides)) throw new TypeError('环境覆盖必须是对象。');
  const values = new Map();
  const identity = key => process.platform === 'win32' ? key.toUpperCase() : key;
  for (const [key, value] of Object.entries(process.env)) {
    if (SYSTEM_ENV.has(key.toUpperCase()) || GROK_ENV.test(key.toUpperCase())) values.set(identity(key), [key, value]);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!key || /[=\0]/.test(key) || (value !== null && (typeof value !== 'string' || value.includes('\0')))) throw new TypeError('环境变量名称或值无效。');
    if (value === null) values.delete(identity(key)); else values.set(identity(key), [key, value]);
  }
  if (configPath !== undefined) values.set(identity('GROK_SEARCH_CONFIG'), ['GROK_SEARCH_CONFIG', configPath]);
  return Object.fromEntries(values.values());
}

// 只负责进程与公开 SDK framing，不实现 JSON-RPC 会话或读取 SDK 私有字段。
export class OwnedStdioTransport {
  constructor(child, sdk, { cleanupMs, maxMessageBytes = FRAME_BYTES, buffer } = {}) {
    this.child = child;
    this.cleanupMs = cleanupMs;
    this.maxMessageBytes = maxMessageBytes;
    this.buffer = buffer ?? new sdk.ReadBuffer({ maxBufferSize: maxMessageBytes + 1 });
    this.serialize = sdk.serializeMessage;
    this.stdoutBytes = 0;
    this.stderrBytes = 0;
    this.lineBytes = 0;
    this.lineHasText = false;
    this.exited = false;
    this.closing = false;
    this.started = false;
    this.whenExited = new Promise(resolve => { this.resolveExit = resolve; });
    this.fatal = new Promise((_, reject) => { this.rejectFatal = reject; });
    this.fatal.catch(() => {});
    this.spawned = new Promise((resolve, reject) => {
      child.once('spawn', () => {
        resolve();
        // 即使取消先于 spawn 通知，也只操作本次持有的 ChildProcess。
        if (this.closing && !this.exited) this.terminate('SIGKILL');
      });
      child.once('error', () => {
        const error = failure('GROK_PROCESS_ERROR', '无法启动或运行 Grok 程序，请检查可执行文件。');
        if (child.pid === undefined) this.markExited(null, null);
        this.fail(error);
        reject(error);
      });
    });
    this.spawned.catch(() => {});
    child.once('exit', (code, signal) => {
      this.markExited(code, signal);
      if (!this.closing) this.fail(failure('GROK_CHILD_EXIT', 'Grok 在查询完成前退出，请检查程序和配置。'));
      this.notifyClosed();
    });
    child.stdout.on('error', () => { if (!this.closing) this.fail(failure('GROK_STDOUT_ERROR', '读取 Grok 输出失败。')); });
    child.stdin.on('error', () => { if (!this.closing) this.fail(failure('GROK_STDIN_ERROR', '写入 Grok 请求失败。')); });
    // 不保存 stderr 原文，避免上游输出泄漏凭据。
    child.stderr.on('data', chunk => { this.stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, this.stderrBytes + chunk.length); });
    child.stderr.on('error', () => { if (!this.closing) this.fail(failure('GROK_STDERR_ERROR', '读取 Grok 诊断流失败。')); });
  }

  markExited(code, signal) {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.exitSignal = signal;
    this.resolveExit();
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    this.rejectFatal(error);
    this.onerror?.(error);
  }

  notifyClosed() {
    if (this.closedNotified) return;
    this.closedNotified = true;
    this.onclose?.();
  }

  receive(chunk) {
    this.stdoutBytes = Math.min(Number.MAX_SAFE_INTEGER, this.stdoutBytes + chunk.length);
    if (this.failure || this.closing) return;
    try {
      // 每行单独检查与解码；多个合并帧不会被误算为一条超限消息。
      for (let offset = 0; offset < chunk.length;) {
        const newline = chunk.indexOf(10, offset);
        const end = newline === -1 ? chunk.length : newline + 1;
        const piece = chunk.subarray(offset, end);
        this.lineBytes += piece.length - (newline === -1 ? 0 : 1);
        if (this.lineBytes > this.maxMessageBytes) throw failure('GROK_STDOUT_LIMIT', 'Grok 单条协议消息超过 1 MiB，请缩小结果。');
        for (const byte of piece) if (![9, 10, 13, 32].includes(byte)) { this.lineHasText = true; break; }
        this.buffer.append(piece);
        if (newline !== -1) {
          const message = this.buffer.readMessage();
          if (message === null && this.lineHasText) throw failure('GROK_PROTOCOL_ERROR', 'Grok 输出了无效协议消息，请检查程序版本。');
          this.lineBytes = 0;
          this.lineHasText = false;
          if (message !== null) this.onmessage?.(message);
        }
        offset = end;
      }
    } catch (error) {
      this.fail(error instanceof GrokSearchError ? error : failure('GROK_PROTOCOL_ERROR', 'Grok 输出了无效协议消息，请检查程序版本。'));
    }
  }

  async start() {
    if (this.started) throw failure('GROK_TRANSPORT_STARTED', 'Grok 通信层被重复启动。');
    this.started = true;
    this.child.stdout.on('data', chunk => this.receive(chunk));
    await this.spawned;
    if (this.failure) throw this.failure;
  }

  async send(message) {
    if (this.closing || this.exited || this.child.stdin.destroyed) throw failure('GROK_STDIN_CLOSED', 'Grok 输入已关闭。');
    await new Promise((resolve, reject) => {
      this.child.stdin.write(this.serialize(message), error => error ? reject(failure('GROK_STDIN_ERROR', '写入 Grok 请求失败。')) : resolve());
    });
  }

  terminate(signal) {
    if (this.exited || this.child.pid === undefined) return;
    try { if (!this.child.kill(signal)) this.killFailed = true; } catch { this.killFailed = true; }
  }

  async waitForExit(milliseconds) {
    if (this.exited || milliseconds <= 0) return;
    let timer;
    try { await Promise.race([this.whenExited, new Promise(resolve => { timer = setTimeout(resolve, milliseconds); })]); }
    finally { clearTimeout(timer); }
  }

  close() { return this.closeTask ??= this.reap(); }

  async reap() {
    this.closing = true;
    const deadline = performance.now() + this.cleanupMs;
    this.child.stdin.end();
    await this.waitForExit(Math.min(100, this.cleanupMs / 8));
    this.terminate('SIGTERM');
    await this.waitForExit(Math.min(250, Math.max(0, deadline - performance.now()) / 3));
    this.terminate('SIGKILL');
    await this.waitForExit(Math.max(0, deadline - performance.now()));
    this.buffer.clear();
    this.notifyClosed();
    if (!this.exited) {
      const error = failure('GROK_PROCESS_REAP_FAILED', '查询已停止，但本次 Grok 进程尚未回收；新查询已暂停。');
      Object.defineProperty(error, 'whenExited', { value: this.whenExited });
      Object.defineProperty(error, 'diagnostic', { value: this.diagnostic() });
      throw error;
    }
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.child.stderr.destroy();
  }

  diagnostic() {
    return { exited: this.exited, childPid: this.child.pid ?? null, exitCode: this.exitCode ?? null,
      exitSignal: this.exitSignal ?? null, stdoutBytes: this.stdoutBytes, stderrBytes: this.stderrBytes,
      killFailed: this.killFailed ?? false };
  }
}

const defaultSdkFactory = () => import('@modelcontextprotocol/client');

export async function runMcpSearch({
  executable, executableArgs = [], configPath, envOverrides = {}, request, signal,
  remainingMs = () => 118_000, cleanupMs = 2_000, maxMessageBytes = FRAME_BYTES,
  sdkFactory = defaultSdkFactory,
}) {
  if (typeof executable !== 'string' || !isAbsolute(executable) || executable.includes('\0')) throw new TypeError('Grok 程序必须使用绝对路径。');
  if (configPath !== undefined && (typeof configPath !== 'string' || !isAbsolute(configPath) || configPath.includes('\0'))) throw new TypeError('配置文件必须使用绝对路径。');
  if (!Array.isArray(executableArgs) || executableArgs.some(value => typeof value !== 'string' || value.includes('\0'))) throw new TypeError('程序参数无效。');
  if (!isRecord(request) || typeof request.query !== 'string' || !request.query.trim()) throw new TypeError('搜索查询不能为空。');
  if (request.maxResults !== undefined && (!Number.isSafeInteger(request.maxResults) || request.maxResults < 0)) throw new TypeError('maxResults 必须是非负整数。');
  if (typeof remainingMs !== 'function' || !Number.isFinite(remainingMs())) throw new TypeError('工作截止时间无效。');
  if (!Number.isSafeInteger(cleanupMs) || cleanupMs < 1 || cleanupMs > 2_000) throw new TypeError('回收预算必须在 1–2000 毫秒内。');
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 128 || maxMessageBytes > FRAME_BYTES) throw new TypeError('单条消息上限必须在 128 字节至 1 MiB 内。');
  signal?.throwIfAborted();
  const started = performance.now();
  const deadline = new AbortController();
  const initialRemaining = remainingMs();
  if (initialRemaining <= 0) throw timeoutError();
  const timer = setTimeout(() => deadline.abort(timeoutError()), Math.max(1, Math.ceil(initialRemaining)));
  const activeSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => {});
  const onAbort = () => rejectAbort(activeSignal.reason);
  activeSignal.addEventListener('abort', onAbort, { once: true });
  const budget = () => {
    activeSignal.throwIfAborted();
    const remaining = Math.ceil(remainingMs());
    if (remaining <= 0) throw timeoutError();
    return remaining;
  };
  let client, transport, result, error, payload, sdkEntry = null, serverVersion = null;
  let sourceRecovery = 'not-needed';
  try {
    const sdk = await Promise.race([Promise.resolve().then(sdkFactory), aborted]);
    if (sdkFactory === defaultSdkFactory) sdkEntry = import.meta.resolve('@modelcontextprotocol/client');
    budget();
    if (typeof sdk.Client !== 'function' || typeof sdk.ReadBuffer !== 'function' || typeof sdk.serializeMessage !== 'function') throw failure('GROK_SDK_UNSUPPORTED', 'MCP SDK 缺少所需公开接口，请检查依赖版本。');
    client = new sdk.Client({ name: 'dsh-grok-search', version: '0.1.0-beta.1' }, { capabilities: {}, versionNegotiation: { mode: 'legacy' } });
    // 所有可能拒绝的 framing 参数先校验，再启动本次进程。
    const buffer = new sdk.ReadBuffer({ maxBufferSize: maxMessageBytes + 1 });
    const child = spawn(executable, executableArgs, { env: executionEnvironment(envOverrides, configPath), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    transport = new OwnedStdioTransport(child, sdk, { cleanupMs, maxMessageBytes, buffer });
    const race = operation => Promise.race([operation, aborted, transport.fatal]);
    const options = () => ({ signal: activeSignal, timeout: budget(), resetTimeoutOnProgress: false });
    await race(client.connect(transport, options()));
    budget();
    serverVersion = safeLabel(client.getServerVersion()?.version);
    payload = decodeGrokResult(await race(client.callTool({ name: 'web_search', arguments: { query: request.query, response_format: 'concise' } }, options())));
    budget();
    const total = payload.sources_count ?? payload.total_sources ?? payload.sources.length;
    const missing = total - payload.sources.length;
    const capacity = request.maxResults === undefined ? missing : Math.min(missing, request.maxResults - payload.sources.length);
    if (missing > 0) payload = { ...payload, truncated: true };
    if (missing > 0 && capacity > 0 && typeof payload.session_id === 'string' && payload.session_id && remainingMs() > 0) {
      sourceRecovery = 'attempted';
      try {
        const extra = decodeGrokResult(await race(client.callTool({ name: 'get_sources', arguments: { session_id: payload.session_id, offset: payload.sources.length, limit: capacity } }, options())));
        budget();
        payload = { ...payload, sources: [...payload.sources, ...extra.sources], truncated: (payload.truncated ?? false) || (extra.truncated ?? false) || payload.sources.length + extra.sources.length < total };
        sourceRecovery = 'completed';
      } catch (caught) {
        activeSignal.throwIfAborted();
        if (transport.failure) throw transport.failure;
        if (caught instanceof GrokSearchError && caught.code !== 'GROK_TOOL_ERROR') throw caught;
        // 只允许普通远端补取失败保留部分结果；协议与取消不能转成成功。
        if (!(caught instanceof GrokSearchError && caught.code === 'GROK_TOOL_ERROR') && (!Number.isInteger(caught?.code) || !([-32601, -32603].includes(caught.code) || (caught.code <= -32000 && caught.code >= -32099)))) throw caught;
        payload = { ...payload, truncated: true };
        sourceRecovery = 'partial';
      }
    }
    budget();
    result = mapSearchResult(payload, { maxResults: request.maxResults });
    budget();
  } catch (caught) {
    error = activeSignal.aborted ? activeSignal.reason : caught instanceof GrokSearchError ? caught : failure('GROK_MCP_ERROR', 'Grok 初始化或搜索失败，请检查上游和配置。');
  } finally {
    clearTimeout(timer);
    activeSignal.removeEventListener('abort', onAbort);
    const cleanupDeadline = performance.now() + cleanupMs;
    if (transport) {
      try { await transport.close(); } catch (caught) { error = caught; }
    }
    if (client) {
      let closeTimer;
      try {
        const available = Math.max(1, cleanupDeadline - performance.now());
        await Promise.race([client.close(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(failure('GROK_CLOSE_ERROR', 'MCP 会话未在回收预算内关闭。')), available); })]);
      } catch (caught) { error ??= caught instanceof GrokSearchError ? caught : failure('GROK_CLOSE_ERROR', 'MCP 会话关闭失败。'); }
      finally { clearTimeout(closeTimer); }
    }
    if (activeSignal.aborted && error === undefined) error = activeSignal.reason;
  }
  const diagnostic = { serverVersion, sdkEntry, searchProvider: safeLabel(payload?.search_provider), fallbackUsed: payload?.fallback_used ?? null,
    sourceRecovery, elapsedMs: Math.round(performance.now() - started), ...(transport?.diagnostic() ?? { exited: true, childPid: null }) };
  if (error !== undefined) {
    if (error instanceof Error && Object.isExtensible(error) && !Object.hasOwn(error, 'diagnostic')) Object.defineProperty(error, 'diagnostic', { value: diagnostic });
    throw error;
  }
  Object.defineProperty(result, 'diagnostic', { value: diagnostic });
  return result;
}

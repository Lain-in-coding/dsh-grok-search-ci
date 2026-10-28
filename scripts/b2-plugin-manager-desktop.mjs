import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { candidateRuntime } from './lib/candidate-runtime.mjs';
import { connectRenderer, waitForRenderer } from './lib/renderer-cdp.mjs';
import {
  cleanEnvironment, commandResult, freshRun, project, receipt, redact, sha256, writeJson,
} from './lib/internal-candidate-utils.mjs';

const PRODUCT_BUNDLE = 'dsh-grok-search';
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!['--desktop-rc2', '--desktop-rc21', '--product-package'].includes(process.argv[index])
    || !process.argv[index + 1]) throw new Error('Expected named Desktop and package arguments.');
  options.set(process.argv[index], process.argv[index + 1]);
}
const runtimes = [candidateRuntime(options.get('--desktop-rc2')), candidateRuntime(options.get('--desktop-rc21'))]
  .filter(runtime => !process.env.DSH_B2_ONLY_VERSION || runtime.app.version === process.env.DSH_B2_ONLY_VERSION);
const targetVersions = (process.env.DSH_B2_TARGET_VERSIONS ?? '0.2.1-rc.2,0.2.1-rc.3').split(',').map(value => value.trim()).filter(Boolean);
assert.deepEqual(runtimes.map(runtime => runtime.app.version),
  process.env.DSH_B2_ONLY_VERSION ? [process.env.DSH_B2_ONLY_VERSION] : targetVersions);
const productTarball = resolve(options.get('--product-package'));
if (!existsSync(productTarball)) throw new Error('Package tarball is missing: ' + productTarball);

const { runId, directory } = freshRun('b2-plugin-manager-desktop');
const temporary = join(tmpdir(), 'dsh-deferred-desktop-manager-' + runId);
const replacements = [[temporary, '<TEMPORARY_RUN>'], [dirname(productTarball), '<PRODUCT_PACKAGE>'],
  ...runtimes.map(runtime => [dirname(runtime.executable), `<DESKTOP_${runtime.app.version}>`])];
const sanitize = value => redact(String(value), replacements);
const safe = value => JSON.parse(sanitize(JSON.stringify(value)));
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const results = [], children = [];
let serial = 0, currentVersion = null;

function packageReceipt(tarball) {
  const file = join(dirname(tarball), 'package-receipt.json');
  if (!existsSync(file)) throw new Error('Package receipt is missing: ' + file);
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value.sha256 !== sha256(tarball)) throw new Error('Package tarball hash does not match its receipt.');
  return value;
}

async function rendererSnapshot(host) {
  const renderer = await connectRenderer(host.debuggerPort);
  try {
    await waitForRenderer(renderer, async current => {
      const ready = await current.evaluate(`document.readyState === 'complete'
        && document.body?.innerText?.trim().length > 0
        && !/Loading plugins|正在加载插件/i.test(document.body.innerText)`);
      return ready ? true : null;
    });
    return await renderer.evaluate(`(() => ({
      title: document.title,
      href: location.href,
      text: document.body.innerText,
      elements: [...document.querySelectorAll('button,a,input,select,textarea,[role="button"],[role="tab"]')]
        .map(element => ({
          tag: element.tagName,
          text: (element.innerText || element.value || element.getAttribute('aria-label') || element.title || '').trim(),
          aria: element.getAttribute('aria-label'),
          role: element.getAttribute('role'),
          type: element.getAttribute('type'),
          name: element.getAttribute('name'),
          href: element.getAttribute('href'),
        }))
        .filter(item => item.text || item.aria || item.name || item.href)
        .slice(0, 400),
    }))()`);
  } finally {
    renderer.close();
  }
}

async function pluginManagerRendererSnapshot(host) {
  const renderer = await connectRenderer(host.debuggerPort);
  try {
    await waitForRenderer(renderer, current => current.evaluate(`[...document.querySelectorAll('button,[role="button"]')]
      .some(item => (item.getAttribute('aria-label') || item.innerText || '').trim() === '插件')`));
    const opened = await renderer.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find(item => (item.getAttribute('aria-label') || item.innerText || '').trim() === '插件');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(opened, true, 'Plugin Manager navigation button was not found.');
    await waitForRenderer(renderer, async current => {
      const ready = await current.evaluate(`(() => {
        const text = document.body?.innerText ?? '';
        return !/Loading plugins|正在加载插件/i.test(text)
          && /插件管理|Plugin Manager|已安装|Installed/i.test(text);
      })()`);
      return ready ? true : null;
    });
    const list = await renderer.evaluate(`(() => ({
      title: document.title,
      href: location.href,
      text: document.body.innerText,
      buttons: [...document.querySelectorAll('button,[role="button"]')]
        .map(element => ({
          text: (element.innerText || element.getAttribute('aria-label') || element.title || '').trim(),
          aria: element.getAttribute('aria-label'),
          checked: element.getAttribute('aria-checked'),
          disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
          visible: element.getClientRects().length > 0,
        }))
        .filter(item => item.text || item.aria)
        .slice(0, 500),
      inputs: [...document.querySelectorAll('input,textarea,select')]
        .map(element => ({ tag: element.tagName, type: element.getAttribute('type'),
          placeholder: element.getAttribute('placeholder'), value: element.value }))
        .slice(0, 100),
    }))()`);
    const detailOpened = await renderer.evaluate(`(() => {
      const button = [...document.querySelectorAll('button,[role="button"]')]
        .find(item => item.getAttribute('aria-label') === '查看 dsh-grok-search' && item.getClientRects().length > 0);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(detailOpened, true, 'Installed dsh-grok-search detail action was not visible.');
    await waitForRenderer(renderer, current => current.evaluate(
      `Boolean(document.querySelector('[data-plugin-detail="dsh-grok-search"]'))`));
    const detail = await renderer.evaluate(`(() => {
      const root = document.querySelector('[data-plugin-detail="dsh-grok-search"]');
      return {
        text: root.innerText,
        buttons: [...root.querySelectorAll('button,[role="button"],[role="switch"]')]
          .map(element => ({
            text: (element.innerText || element.getAttribute('aria-label') || element.title || '').trim(),
            aria: element.getAttribute('aria-label'),
            role: element.getAttribute('role'),
            checked: element.getAttribute('aria-checked'),
            disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
            visible: element.getClientRects().length > 0,
          }))
          .filter(item => item.text || item.aria),
      };
    })()`);
    return { list, detail };
  } finally {
    renderer.close();
  }
}

async function settingsStopRendererFlow(host) {
  const renderer = await connectRenderer(host.debuggerPort);
  try {
    const dumpConsole = async note => {
      try {
        await renderer.evaluate('1');
        writeJson(join(directory, currentVersion + '-settings-console.json'), safe({ note, entries: renderer.consoleEntries }));
      } catch {}
    };
    const beforeMore = await renderer.evaluate(`(() => ({
      text: document.body.innerText,
      buttons: [...document.querySelectorAll('button,[role="button"],[role="menuitem"]')]
        .map(item => ({ text: (item.innerText || '').trim(), aria: item.getAttribute('aria-label') }))
        .filter(item => item.text || item.aria),
    }))()`);
    writeJson(join(directory, currentVersion + '-settings-before-more-ui.json'), safe(beforeMore));
    assert.ok(beforeMore.buttons.some(item => item.text === '更多' || item.aria === '更多'),
      'More button was absent: ' + JSON.stringify(beforeMore.buttons));
    // The sidebar can still be on the Plugin Manager page; return to the main shell first.
    if (beforeMore.buttons.some(item => item.aria === '返回插件列表')) {
      await renderer.evaluate(`(() => {
        const back = [...document.querySelectorAll('button')]
          .find(item => item.getAttribute('aria-label') === '返回插件列表');
        back.click();
      })()`);
      const backToMain = await waitForRenderer(renderer, current => current.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')];
        return buttons.some(item => item.getAttribute('aria-label') === '账号菜单') ? {
          text: document.body.innerText,
          buttons: buttons.map(item => ({ text: (item.innerText || '').trim(), aria: item.getAttribute('aria-label') }))
            .filter(item => item.text || item.aria),
        } : null;
      })()`), 'Main shell did not return from Plugin detail', 10000);
      writeJson(join(directory, currentVersion + '-settings-after-back-ui.json'), safe(backToMain));
    }
    await renderer.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const button = buttons.find(item => item.getAttribute('aria-label') === '账号菜单')
        ?? buttons.find(item => (item.innerText || '').trim() === '更多');
      if (!button) throw new Error('More button was not found after returning to the shell.');
      button.click();
    })()`);
    const moreMenu = await waitForRenderer(renderer, current => current.evaluate(`(() => {
      const text = document.body?.innerText ?? '';
      return /设置|Settings/.test(text) ? {
        text,
        buttons: [...document.querySelectorAll('button,[role="menuitem"],[role="button"],a')]
          .map(item => ({ text: (item.innerText || '').trim(), aria: item.getAttribute('aria-label'), role: item.getAttribute('role') }))
          .filter(item => item.text || item.aria),
      } : null;
    })()`), 'More menu did not expose a settings entry', 10000);
    writeJson(join(directory, currentVersion + '-settings-more-menu-ui.json'), safe(moreMenu));
    const menuObserved = await waitForRenderer(renderer, current => current.evaluate(`(() => {
      const item = [...document.querySelectorAll('button,[role="menuitem"],[role="button"]')]
        .find(row => /设置|Settings/.test((row.getAttribute('aria-label') || row.innerText || '').trim()));
      return item ? true : null;
    })()`), 'Settings entry did not appear in the More menu', 10000);
    await renderer.evaluate(`(() => {
      const item = [...document.querySelectorAll('button,[role="menuitem"],[role="button"]')]
        .find(row => /设置|Settings/.test((row.getAttribute('aria-label') || row.innerText || '').trim()));
      item.click();
    })()`);
    const pluginsSectionObserved = await waitForRenderer(renderer, current => current.evaluate(
      `[...document.querySelectorAll('button,[role="tab"]')].some(item => (item.getAttribute('aria-label') || item.innerText || '').trim() === '内置插件')`),
      'Settings Plugins section did not appear', 20000);
    assert.equal(pluginsSectionObserved, true);
    const settingsEntry = await renderer.evaluate(`(() => ({
      text: document.body.innerText,
      tabs: [...document.querySelectorAll('button,[role="tab"]')]
        .map(item => ({ text: (item.innerText || '').trim(), aria: item.getAttribute('aria-label') }))
        .filter(item => item.text || item.aria),
    }))()`);
    writeJson(join(directory, currentVersion + '-settings-sections-ui.json'), safe(settingsEntry));
    await renderer.evaluate(`(() => {
      const section = [...document.querySelectorAll('button,[role="tab"]')]
        .find(item => (item.getAttribute('aria-label') || item.innerText || '').trim() === '内置插件');
      if (!section) throw new Error('Settings Plugins section was absent when clicked.');
      section.click();
    })()`);
    const pluginsPage = await waitForRenderer(renderer, current => current.evaluate(
      `/插件视图|Plugin views|暂无插件|No matching plugins|Grok 搜索/i.test(document.body?.innerText ?? '')`),
      'Settings Plugins page did not render its tabs', 10000);
    const pluginsPageView = await renderer.evaluate(`(() => ({
      text: document.body.innerText,
      tabs: [...document.querySelectorAll('button,[role="tab"]')]
        .map(item => ({ text: (item.innerText || '').trim(), aria: item.getAttribute('aria-label') }))
        .filter(item => item.text || item.aria),
    }))()`);
    writeJson(join(directory, currentVersion + '-settings-plugins-page-ui.json'), safe(pluginsPageView));
    const grokTabObserved = await waitForRenderer(renderer, current => current.evaluate(
      `[...document.querySelectorAll('button,[role="tab"]')].some(item => (item.getAttribute('aria-label') || item.innerText || '').trim() === 'Grok 搜索')`),
      'Grok tab did not appear in Settings Plugins after selecting the section', 10000);
    assert.equal(grokTabObserved, true);
    await renderer.evaluate(`(() => {
      const tab = [...document.querySelectorAll('button,[role="tab"]')]
        .find(item => (item.getAttribute('aria-label') || item.innerText || '').trim() === 'Grok 搜索');
      if (!tab) throw new Error('Grok settings tab was absent when clicked.');
      tab.click();
    })()`);
    const detailBeforeStop = await waitForRenderer(renderer, current => current.evaluate(`(() => {
      const loading = document.querySelector('[data-grok-search-loading]');
      if (loading) return { loading: true, text: loading.innerText };
      const error = document.querySelector('[data-grok-search-error]');
      if (error) return { failed: true, text: error.innerText };
      const root = document.querySelector('[data-grok-search-settings]');
      if (!root) return null;
      return {
        detail: true,
        text: document.body.innerText,
        buttons: [...document.querySelectorAll('button,[role="button"]')]
          .map(item => ({ text: (item.innerText || '').trim(), aria: item.getAttribute('aria-label') }))
          .filter(item => item.text || item.aria),
      };
    })()`), 'Grok settings tab did not appear in Settings Plugins', 30000);
    if (detailBeforeStop?.failed) {
      await dumpConsole('snapshot-failed');
      throw new Error('Grok settings snapshot failed: ' + detailBeforeStop.text);
    }
    writeJson(join(directory, currentVersion + '-settings-stop-entry-ui.json'), safe(detailBeforeStop));
    const before = await waitForRenderer(renderer, current => current.evaluate(`(() => {
      const root = document.querySelector('[data-grok-search-settings]');
      if (!root) return null;
      const button = [...root.querySelectorAll('button')]
        .find(item => (item.innerText || '').trim() === '停止接管并恢复原搜索');
      return button ? { text: root.innerText, buttonFound: true, buttonDisabled: button.disabled === true } : null;
    })()`), 'Grok settings panel disappeared before reading its stop button', 10000);
    const clicked = await renderer.evaluate(`(() => {
      const root = document.querySelector('[data-grok-search-settings]');
      const button = [...root.querySelectorAll('button')]
        .find(item => (item.innerText || '').trim() === '停止接管并恢复原搜索');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await waitForRenderer(renderer, current => current.evaluate(`(() => {
      const root = document.querySelector('[data-grok-search-settings]');
      return root && /已恢复原搜索|Original search restored/.test(root.innerText) ? true : null;
    })()`), 'Settings stop did not restore the original search state', 30000);
    const after = await renderer.evaluate(`(() => {
      const root = document.querySelector('[data-grok-search-settings]');
      return { text: root.innerText, error: root.querySelector('[role="alert"]')?.textContent ?? null };
    })()`);
    return { before, clicked, after, buttonFound: before.buttonFound };
  } finally {
    renderer.close();
  }
}

function auditCounterSource(runtime) {
  const modules = [
    ['web-runtime', 'dsh/node_modules/@deepseek-ai/dsh-web/lib/index.js'],
    ['web-tool', 'dsh/node_modules/@deepseek-ai/dsh-tool-web/lib/index.js'],
    ['web-search-deepseek', 'dsh/node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js'],
    ['session', 'dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js'],
  ];
  const evidence = modules.map(([role, file]) => {
    const source = runtime.archive.read(file).toString('utf8');
    return { role, file, sha256: runtime.archive.sha256(file),
      counterContractPresent: source.includes('web/deepseek-search-llm-request') };
  });
  const declared = role => evidence.find(row => row.role === role)?.counterContractPresent === true;
  const found = declared('web-search-deepseek') && declared('session');
  return { version: runtime.app.version, modules: evidence,
    officialCounterContractFound: found,
    adapterDecision: found ? 'canonical-session-event' : 'fail-closed-no-official-counter' };
}

async function unusedPort() {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}

async function prepare(runtime, folder) {
  const args = [join(project, 'scripts/deferred-release-desktop-prepare.mjs'), '--desktop', runtime.executable,
    '--run-root', folder, '--control-record-mode', 'versioned', '--entry-mode', 'plugin-manager'];
  const execution = await commandResult(process.execPath, args, { cwd: project, timeoutMs: 120000, sanitize });
  writeJson(join(directory, runtime.app.version + '-prepare.json'), receipt(execution));
  assert.equal(execution.exitCode, 0, execution.stderr);
  assert.equal(execution.timedOut, false);
  const value = JSON.parse(execution.rawStdout);
  assert.equal(value.dependencyInstall, false);
  assert.equal(value.originalAsarUnmodified, true);
}

async function start(runtime, folder, phase) {
  const control = JSON.parse(readFileSync(join(folder, 'local-control.json'), 'utf8'));
  const debuggerPort = await unusedPort();
  const addressPath = join(folder, 'address-' + (++serial) + '.json');
  const args = ['--user-data-dir=' + control.userData, '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + debuggerPort, '--lang=zh-CN'];
  const env = cleanEnvironment(folder, {
    DSH_HOME: control.dshHome,
    DSH_DESKTOP_FIXTURE_TOKEN: control.token,
    DSH_DESKTOP_FIXTURE_ADDRESS_FILE: addressPath,
    DSH_DESKTOP_OPEN_DEVTOOLS: '0',
    DSH_B2_CONTROL_RECORD: '1',
    DSH_B2_PRODUCT_COUNTER: '1',
    DSH_DESKTOP_OFFLINE_SENTINEL: 'offline-test-sentinel-not-a-real-key',
    DSH_PRODUCT_ANALYTICS_OTLP_URL: 'http://127.0.0.1:9',
    DSH_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '--dns-result-order=ipv4first',
    PNPM_HOME: join(temporary, 'pnpm-home'),
    PNPM_STORE_DIR: join(temporary, 'pnpm-store'),
    npm_config_update_notifier: 'false',
  });
  for (const name of ['pnpm-home', 'pnpm-store']) mkdirSync(join(temporary, name), { recursive: true });
  const prefix = runtime.app.version + '-' + phase + '-' + serial;
  const stdoutPath = join(directory, prefix + '-stdout.log');
  const stderrPath = join(directory, prefix + '-stderr.log');
  const stdout = openSync(stdoutPath, 'wx'), stderr = openSync(stderrPath, 'wx');
  writeJson(join(directory, prefix + '-command.json'), safe({
    executable: runtime.executable, args, cwd: folder,
    environment: Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith('DSH_') || name.startsWith('PNPM_') || name === 'NODE_OPTIONS')),
    packagedStartup: true, originalAsar: true, isolatedUserData: true, startedAt: new Date().toISOString(),
  }));
  const child = spawn(runtime.executable, args, { cwd: folder, env, windowsHide: true, shell: false,
    stdio: ['ignore', stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  const state = { prefix, child, folder, control, debuggerPort, exited: false, spawnError: null };
  state.closed = new Promise(done => {
    child.once('error', error => { state.spawnError = error.message; });
    child.once('close', (code, signal) => { state.exited = true; state.exitCode = code; state.signal = signal; done(); });
  });
  children.push(state);
  try {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      if (state.exited) throw new Error('Packaged Desktop exited during startup: ' + state.spawnError + ' ' + readFileSync(stderrPath, 'utf8').slice(-2500));
      if (existsSync(addressPath)) {
        const readAddress = () => JSON.parse(readFileSync(addressPath, 'utf8'));
        const post = async (op, args = {}) => {
          if (!state.address) throw new Error('Desktop probe address is unavailable.');
          const response = await fetch('http://127.0.0.1:' + state.address.port + '/probe', {
            method: 'POST', headers: { Authorization: control.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, args }), signal: AbortSignal.timeout(600000),
          });
          const value = await response.json();
          if (response.status !== 200 || !value.ok) {
            const error = new Error(value.error?.message ?? 'Desktop probe failed.');
            error.probeRejected = true;
            throw error;
          }
          return value.value;
        };
        state.address = readAddress();
        state.readAddress = readAddress;
        state.reconnect = async previous => {
          const until = Date.now() + 90000;
          let lastError;
          while (Date.now() < until) {
            if (state.exited) throw new Error('Packaged Desktop exited while reconnecting its probe.');
            try {
              const next = readAddress();
              if (!previous || next.port !== previous.port || next.pid !== previous.pid || next.instanceId !== previous.instanceId) {
                state.address = next;
                delete state.modelSession; delete state.cookie; delete state.rpc;
                return await state.probe('snapshot');
              }
            } catch (error) { lastError = error; }
            try { return await state.probe('snapshot'); } catch (error) { lastError = error; }
            await sleep(300);
          }
          throw lastError ?? new Error('Packaged Desktop probe did not reconnect.');
        };
        state.probe = async (op, args = {}) => {
          const until = Date.now() + 30000;
          let lastError;
          while (Date.now() < until) {
            try { state.address = readAddress(); return await post(op, args); }
            catch (error) { lastError = error; if (state.exited) throw error; await sleep(300); }
          }
          throw lastError ?? new Error('Desktop probe did not answer: ' + op);
        };
        state.probeMutation = async (op, args = {}) => {
          const previous = readAddress();
          state.address = previous;
          try { return await post(op, args); }
          catch (error) {
            if (error.probeRejected !== true) { error.transportLost = true; error.previousAddress = previous; }
            throw error;
          }
        };
        const snapshot = await state.probe('snapshot');
        state.initial = snapshot;
        if (snapshot.pluginManagerPresent && snapshot.runtimeWeb && snapshot.existingDependencyPresent) {
          writeJson(join(directory, prefix + '-initial.json'), safe(snapshot));
          return state;
        }
      }
      await sleep(200);
    }
    throw new Error('Packaged Desktop startup did not produce an isolated probe.');
  } catch (error) {
    await close(state);
    throw error;
  }
}

async function close(state) {
  if (!state.exited) {
    try {
      const response = await fetch('http://127.0.0.1:' + state.debuggerPort + '/json/version', { signal: AbortSignal.timeout(5000) });
      const info = await response.json();
      const socket = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((done, reject) => {
        socket.addEventListener('open', done, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      socket.close();
      const ended = await Promise.race([state.closed.then(() => true), sleep(20000).then(() => false)]);
      if (!ended) throw new Error('Official Browser.close did not finish within deadline.');
    } catch (error) {
      state.closeError = error.message;
      if (!state.exited) { state.forced = true; state.child.kill('SIGKILL'); await state.closed; }
    }
  }
  const identity = { prefix: state.prefix, pid: state.child.pid, exitCode: state.exitCode, signal: state.signal,
    forced: state.forced ?? false, closeError: state.closeError ?? null, finishedAt: new Date().toISOString() };
  if (!state.exitSaved) { writeJson(join(directory, state.prefix + '-exit.json'), safe(identity)); state.exitSaved = true; }
  return identity;
}

async function waitFor(host, predicate, label, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await host.probe('snapshot');
    if (predicate(last)) return last;
    await sleep(100);
  }
  throw new Error(label + ': ' + JSON.stringify(last));
}

async function modelTurn(host, mode) {
  if (!host.modelSession) {
    const auth = await host.probe('model-auth');
    const response = await fetch(auth.url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 303);
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);
    host.cookie = cookie;
    host.rpc = async (endpoint, request) => {
      const envelope = { type: 'client-request', rpcId: 'manager-rpc-' + (++serial), method: endpoint, payload: { args: { request } } };
      const result = await fetch(host.address.hostOrigin + '/api/' + endpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: host.address.hostOrigin, Cookie: host.cookie },
        body: JSON.stringify(envelope), signal: AbortSignal.timeout(20000) }).then(value => value.json());
      assert.equal(result?.result?.ok, true, JSON.stringify(result));
      return result.result.value;
    };
    const created = await host.rpc('session/create', { cwd: host.control.workspace });
    assert.ok(created.sessionId);
    host.modelSession = created.sessionId;
  }
  const before = await host.probe('snapshot');
  await host.rpc('session/prompt', { requestId: 'manager-prompt-' + (++serial), sessionId: host.modelSession,
    mode: 'queue', content: [{ type: 'text', text: mode }] });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const after = await host.probe('snapshot');
    const events = after.sessionEvents.slice(before.sessionEvents.length).filter(event => event.sessionId === host.modelSession);
    const final = events.findLast(event => event.type === 'assistant/message'
      && event.data.message.content.some(block => block.type === 'text' && block.text === '内部候选轮次完成'));
    const ended = final && events.find(event => event.type === 'turn/end'
      && event.data.turn === final.data.turn && event.data.reason?.kind === 'completed');
    const toolResult = final && events.findLast(event => event.type === 'tool/result' && event.data.turn === final.data.turn);
    if (after.completed > before.completed && ended && (mode === 'chat' || toolResult)) {
      return { mode, isError: toolResult?.data.message.isError === true,
        text: toolResult?.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '',
        beforeCalls: before.calls, afterCalls: after.calls };
    }
    await sleep(100);
  }
  throw new Error('Actual Desktop model turn did not complete: ' + mode);
}

function managerNames(state) {
  return state.bundles.map(bundle => bundle.name);
}

function assertManagerApplied(result, target, application = 'restart-required') {
  assert.equal(result.application, application, JSON.stringify(result));
  assert.equal(result.changed, true, JSON.stringify(result));
  assert.equal(result.target, target, JSON.stringify(result));
  assert.equal(result.error ?? null, null, JSON.stringify(result));
}

async function mutateWithObservation(host, op, args, observe, label) {
  try {
    return await host.probeMutation(op, args);
  } catch (error) {
    if (error.transportLost !== true) throw error;
    await host.reconnect(error.previousAddress);
    const observed = await observe();
    if (!observed) throw new Error(label + ' could not be confirmed after the Host probe reconnected.');
    return observed;
  }
}

async function installBundle(host, spec, name) {
  return mutateWithObservation(host, 'plugin-manager-install', { spec, enabled: true, requestId: randomUUID() },
    async () => {
      const state = await host.probe('plugin-manager-state');
      const row = state.bundles.find(bundle => bundle.name === name);
      return row?.enabled === true ? { application: 'restart-required', changed: true, target: name, bundle: name,
        enabled: true, transportLost: true, recoveredByObservation: true } : null;
    }, 'Install of ' + name);
}

async function setBundleEnabled(host, name, enabled) {
  return mutateWithObservation(host, 'plugin-manager-set-bundle', { name, enabled },
    async () => {
      const state = await host.probe('plugin-manager-state');
      const row = state.bundles.find(bundle => bundle.name === name);
      return row?.enabled === enabled ? { application: 'restart-required', changed: true, target: name,
        enabled, transportLost: true, recoveredByObservation: true } : null;
    }, (enabled ? 'Enable of ' : 'Disable of ') + name);
}

async function removeBundle(host, name) {
  return mutateWithObservation(host, 'plugin-manager-remove', { name },
    async () => {
      const state = await host.probe('plugin-manager-state');
      return state.bundles.some(bundle => bundle.name === name) ? null : { application: 'restart-required', changed: true,
        target: name, stage: 'remove', transportLost: true, recoveredByObservation: true };
    }, 'Removal of ' + name);
}

async function runVersion(runtime) {
  currentVersion = runtime.app.version;
  const folder = join(temporary, runtime.app.version);
  await prepare(runtime, folder);
  const profile = join(folder, 'dsh-home/profiles/desktop');
  const initialPackage = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
  assert.equal(initialPackage.dependencies[PRODUCT_BUNDLE], undefined);
  assert.ok(!initialPackage.dsh.profile.bundles.includes(PRODUCT_BUNDLE));

  const first = await start(runtime, folder, 'manager-install');
  const initialUi = await rendererSnapshot(first);
  writeJson(join(directory, runtime.app.version + '-plugin-manager-initial-ui.json'), safe(initialUi));
  const initialManager = await first.probe('plugin-manager-state');
  assert.ok(!managerNames(initialManager).includes(PRODUCT_BUNDLE));

  const productInstall = await installBundle(first, productTarball, PRODUCT_BUNDLE);
  assertManagerApplied(productInstall, PRODUCT_BUNDLE);
  assert.equal(productInstall.bundle, PRODUCT_BUNDLE);
  const afterProductManager = await first.probe('plugin-manager-state');
  assert.ok(managerNames(afterProductManager).includes(PRODUCT_BUNDLE));
  assert.equal(afterProductManager.bundles.find(bundle => bundle.name === PRODUCT_BUNDLE).enabled, true);
  const firstExit = await close(first);
  assert.equal(firstExit.exitCode, 0);
  assert.equal(firstExit.forced, false);

  const productHost = await start(runtime, folder, 'manager-product-startup');
  const productReady = await waitFor(productHost, snapshot => snapshot.productControl?.phase === 'required'
    && snapshot.productRecovery?.phase === 'still-selected' && snapshot.productRouteVerifier,
  'Product control and recovery entries did not load after PluginManager install and restart');
  const before = productReady.productControl.recordEnvelope;
  assert.equal(before.intent.policy, 'required');
  assert.equal(productReady.productRecovery.phase, 'still-selected');
  assert.equal(productReady.runtimeWeb.searchProviderId, 'grok-search');

  const installedBaseUi = await rendererSnapshot(productHost);
  writeJson(join(directory, runtime.app.version + '-plugin-manager-installed-base-ui.json'), safe(installedBaseUi));
  const installedUi = await pluginManagerRendererSnapshot(productHost);
  writeJson(join(directory, runtime.app.version + '-plugin-manager-installed-ui.json'), safe(installedUi));
  assert.match(installedUi.list.text, /已安装/);
  assert.match(installedUi.list.text, /dsh-grok-search/);
  assert.match(installedUi.detail.text, /0\.1\.0-beta\.1/);
  assert.match(installedUi.detail.text, /用你自己的 grok-search-rs（Grok）接管 DSH 内置网页搜索/);

  // D-28 single bundle: a plain disable drops every entry. The pending record survives the
  // deselection without an executor, and re-enabling restores takeover under D-26 authorization.
  const settingsStop = await settingsStopRendererFlow(productHost);
  writeJson(join(directory, runtime.app.version + '-settings-stop-ui.json'), safe(settingsStop));
  assert.equal(settingsStop.buttonFound, true);
  assert.match(settingsStop.after.text, /已恢复原搜索/);
  assert.equal(settingsStop.after.error, null);
  const stoppedSnapshot = await productHost.probe('snapshot');
  const stoppedRecord = stoppedSnapshot.recordEnvelope;
  assert.equal(stoppedRecord.intent.policy, 'released');
  assert.equal(stoppedRecord.intent.release.explicit, true);
  // The owner's own release task writes the completion; the bundled recovery entry must not
  // race it while the web route restore restarts the control fiber (D-28).
  assert.equal(stoppedRecord.intent.releaseCompletion.recordCommit.kind, 'explicit-release-completion');
  assert.equal(stoppedRecord.intent.recovery, undefined);
  assert.equal(stoppedRecord.intent.releaseCompletion.routeVerified, true);
  assert.equal(stoppedRecord.intent.releaseCompletion.routeEvidence.originalSearchDelta, 0);
  assert.equal(stoppedSnapshot.runtimeWeb.searchProviderId, 'candidate-original');

  const disabled = await setBundleEnabled(productHost, PRODUCT_BUNDLE, false);
  assertManagerApplied(disabled, PRODUCT_BUNDLE);
  const productExit = await close(productHost);
  assert.equal(productExit.exitCode, 0);
  assert.equal(productExit.forced, false);

  const releasedHost = await start(runtime, folder, 'manager-released-startup');
  const releasedState = await releasedHost.probe('snapshot');
  assert.equal(releasedState.productControl, null);
  assert.equal(releasedState.productRecovery, null);
  assert.equal(releasedState.productRouteVerifier, null);
  assert.deepEqual(releasedState.recordEnvelope, stoppedRecord);
  assert.equal(releasedState.runtimeWeb.searchProviderId, 'candidate-original');
  const enabled = await setBundleEnabled(releasedHost, PRODUCT_BUNDLE, true);
  assertManagerApplied(enabled, PRODUCT_BUNDLE);
  const releasedExit = await close(releasedHost);
  assert.equal(releasedExit.exitCode, 0);
  assert.equal(releasedExit.forced, false);

  const revivedHost = await start(runtime, folder, 'manager-revive-startup');
  const revived = await waitFor(revivedHost, snapshot => snapshot.productControl,
    'Product control did not reload after re-enabling the bundle');
  assert.equal(revived.productControl.phase, 'released');
  assert.deepEqual(revived.recordEnvelope, stoppedRecord);
  assert.equal(revived.runtimeWeb.searchProviderId, 'candidate-original');
  assert.equal(revived.runtimeWeb.fetchProviderId, 'candidate-fetch');
  const revivedFetch = await modelTurn(revivedHost, 'fetch');
  const revivedChat = await modelTurn(revivedHost, 'chat');
  assert.equal(revivedFetch.isError, false);
  assert.equal(revivedChat.isError, false);
  const disabledAgain = await setBundleEnabled(revivedHost, PRODUCT_BUNDLE, false);
  assertManagerApplied(disabledAgain, PRODUCT_BUNDLE);
  const revivedExit = await close(revivedHost);
  assert.equal(revivedExit.exitCode, 0);
  assert.equal(revivedExit.forced, false);

  const cleanupHost = await start(runtime, folder, 'manager-cleanup-startup');
  const cleanupInitial = await cleanupHost.probe('snapshot');
  assert.equal(cleanupInitial.productControl, null);
  assert.equal(cleanupInitial.productRecovery, null);
  assert.equal(cleanupInitial.productRouteVerifier, null);
  const cleanupManager = await cleanupHost.probe('plugin-manager-state');
  assert.equal(cleanupManager.bundles.find(bundle => bundle.name === PRODUCT_BUNDLE).enabled, false);

  const productRemove = await removeBundle(cleanupHost, PRODUCT_BUNDLE);
  assertManagerApplied(productRemove, PRODUCT_BUNDLE);
  const cleanedManager = await cleanupHost.probe('plugin-manager-state');
  assert.ok(!managerNames(cleanedManager).includes(PRODUCT_BUNDLE));
  const cleanedPackage = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
  assert.equal(cleanedPackage.dependencies[PRODUCT_BUNDLE], undefined);
  assert.deepEqual(cleanedPackage.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'candidate-offline-fixture']);
  const cleaned = await cleanupHost.probe('snapshot');
  assert.deepEqual(cleaned.recordEnvelope, stoppedRecord);
  assert.equal(cleaned.runtimeWeb.searchProviderId, 'candidate-original');
  assert.equal(cleaned.runtimeWeb.fetchProviderId, 'candidate-fetch');
  assert.equal(cleaned.existingDependencyPresent, true);
  assert.ok(Object.hasOwn(cleaned.webInject, 'candidateExistingDependency'));
  const authorSearch = await modelTurn(cleanupHost, 'search');
  const fetch = await modelTurn(cleanupHost, 'fetch');
  const chat = await modelTurn(cleanupHost, 'chat');
  assert.equal(authorSearch.isError, false);
  assert.ok(authorSearch.afterCalls.original > authorSearch.beforeCalls.original);
  assert.equal(fetch.isError, false);
  assert.equal(chat.isError, false);
  const cleanupExit = await close(cleanupHost);
  assert.equal(cleanupExit.exitCode, 0);
  assert.equal(cleanupExit.forced, false);

  const finalHost = await start(runtime, folder, 'manager-final-restart');
  const restarted = await finalHost.probe('snapshot');
  assert.equal(restarted.pluginManagerPresent, true);
  assert.equal(restarted.productControl, null);
  assert.equal(restarted.productRecovery, null);
  assert.equal(restarted.productRouteVerifier, null);
  assert.deepEqual(restarted.recordEnvelope, stoppedRecord);
  assert.equal(restarted.runtimeWeb.searchProviderId, 'candidate-original');
  assert.equal(restarted.runtimeWeb.fetchProviderId, 'candidate-fetch');
  assert.equal(restarted.existingDependencyPresent, true);
  const restartSearch = await modelTurn(finalHost, 'search');
  const restartFetch = await modelTurn(finalHost, 'fetch');
  const restartChat = await modelTurn(finalHost, 'chat');
  assert.equal(restartSearch.isError, false);
  assert.ok(restartSearch.afterCalls.original > restartSearch.beforeCalls.original);
  assert.equal(restartFetch.isError, false);
  assert.equal(restartChat.isError, false);
  const finalExit = await close(finalHost);
  assert.equal(finalExit.exitCode, 0);
  assert.equal(finalExit.forced, false);

  return { initialManager, productInstall, firstExit, before, settingsStop, stoppedRecord, productExit,
    releasedState, enabled, revived, revivedFetch, revivedChat, disabledAgain, revivedExit,
    uiDomValidated: true, productRemove, cleanedManager, cleaned, authorSearch, fetch, chat, cleanupExit,
    restarted, restartSearch, restartFetch, restartChat, finalExit };
}

let fatal = null;
const beforeHashes = Object.fromEntries(runtimes.map(runtime => [runtime.app.version,
  { executable: sha256(runtime.executable), asar: sha256(runtime.archivePath) }]));
try {
  for (const runtime of runtimes) {
    const evidence = await runVersion(runtime);
    results.push({ version: runtime.app.version, scenario: 'official-plugin-manager-install-enable-disable-remove-restart',
      status: 'pass', evidence });
  }
} catch (error) {
  fatal = { version: currentVersion, message: error.message, stack: error.stack };
  results.push({ version: currentVersion, scenario: 'official-plugin-manager-install-enable-disable-remove-restart',
    status: 'fail', error: { message: error.message } });
} finally {
  for (const child of children) await close(child);
  const afterHashes = Object.fromEntries(runtimes.map(runtime => [runtime.app.version,
    { executable: sha256(runtime.executable), asar: sha256(runtime.archivePath) }]));
  const unchanged = JSON.stringify(beforeHashes) === JSON.stringify(afterHashes);
  const passed = !fatal && unchanged;
  const summary = {
    runId, status: passed ? 'pass' : 'fail',
    counts: { pass: results.filter(row => row.status === 'pass').length,
      fail: results.filter(row => row.status === 'fail').length + (unchanged ? 0 : 1) },
    fatal: fatal ? safe(fatal) : null,
    scope: 'actual-packaged-official-Desktop-with-official-PluginManager-service',
    packagedDesktopStartupValidated: passed,
    pluginManagerValidated: passed,
    pluginManagerUiDomValidated: passed && results.length === runtimes.length
      && results.every(row => row.evidence?.uiDomValidated === true),
    desktopUiDomValidated: false,
    cleanupValidated: passed,
    releaseTransactionDesktopValidated: false,
    releaseControllerWired: false,
    routeCounterAdapter: 'fixture-and-canonical-session-event',
    realHostCounterAdapterValidated: false,
    officialCounterContractFound: runtimes.some(runtime => auditCounterSource(runtime).officialCounterContractFound),
    productIntegrated: false,
    hostCounterAudit: runtimes.map(auditCounterSource),
    packageReceipts: { product: packageReceipt(productTarball) },
    results: results.map(({ version, scenario, status, evidence, error }) => ({ version, scenario, status,
      ...(evidence ? { evidence } : {}), ...(error ? { error } : {}) })),
    originalHashes: { before: beforeHashes, after: afterHashes, unchanged },
    sourceHashes: ['src/index.mjs', 'src/control.mjs', 'src/recovery.mjs', 'src/route-verifier.mjs',
      'src/core/original-search-counter.mjs',
      'src/core/control-intent-store.mjs', 'src/core/startup-recovery.mjs', 'src/core/release-transaction.mjs',
      'src/core/product-control.mjs', 'fixtures/deferred-release/desktop-fixture.mjs',
      'fixtures/internal-candidate/host-fixture.mjs', 'scripts/deferred-release-desktop-prepare.mjs',
      'scripts/b2-plugin-manager-desktop.mjs', 'cordis.patch.yml']
      .map(file => ({ file, sha256: sha256(join(project, file)) })),
    exits: children.map(row => ({ prefix: row.prefix, exitCode: row.exitCode, signal: row.signal,
      forced: row.forced ?? false })),
  };
  writeJson(join(directory, 'summary.json'), safe(summary));
  console.log(JSON.stringify(safe(summary), null, 2));
  process.exitCode = passed ? 0 : 1;
}

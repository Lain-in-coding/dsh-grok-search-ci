import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { candidateRuntime } from './lib/candidate-runtime.mjs';
import { prepareDesktopFixture } from './deferred-release-desktop-prepare.mjs';
import { connectRenderer, requestDesktopShutdown, waitForRenderer } from './lib/renderer-cdp.mjs';
import { cleanEnvironment, commandResult, freshRun, project, sha256, writeJson } from './lib/internal-candidate-utils.mjs';
import { createSharedConfigStore, resolveSharedConfigPath, CONFIG_FIELDS } from '../src/core/shared-config.mjs';
import { createPrivatePreferences } from '../src/core/private-preferences.mjs';
import { findExistingGrok } from '../src/core/program-discovery.mjs';

// Opt-in live services, no live key ever enters arguments, screenshots or files.
const live = process.argv.includes('--allow-live');
const args = process.argv.slice(2).filter(value => value !== '--allow-live');
if (args.length < 2) throw new Error('Usage: node scripts/verify-search-log-desktop.mjs [--allow-live] <tgz> <official-executables...>');
const tarball = resolve(args[0]), runtimes = args.slice(1).map(candidateRuntime);
const packageReceipt = JSON.parse(readFileSync(join(dirname(tarball), 'package-receipt.json'), 'utf8'));
assert.equal(sha256(tarball), packageReceipt.sha256);
for (const row of packageReceipt.sourceHashes) assert.equal(sha256(join(project, row.file)), row.sha256);
const run = freshRun(live ? 'search-log-desktop-live' : 'search-log-desktop');
const temporary = join(realpathSync(tmpdir()), 'dsh-deferred-desktop-search-log-' + run.runId);
const sourceFiles = [...packageReceipt.sourceHashes.map(row => row.file),
  'scripts/verify-search-log-desktop.mjs', 'scripts/deferred-release-desktop-prepare.mjs',
  'fixtures/deferred-release/desktop-fixture.mjs', 'scripts/lib/renderer-cdp.mjs'];
const sourceHashes = sourceFiles.map(file => ({ file, sha256: sha256(join(project, file)) }));
const secrets = new Set(), results = [], exits = [];
const safeCode = error => /^[\w.-]{1,80}$/.test(error?.code ?? '') ? error.code : 'DESKTOP_VALIDATION_FAILED';
const safeError = error => {
  let message = String(error?.message ?? 'Desktop verification failed');
  for (const secret of secrets) message = message.split(secret).join('<REDACTED>');
  for (const path of [temporary, project]) message = message.split(path).join('<ISOLATED>');
  return { code: safeCode(error), message: message.slice(0, 1000) };
};
const sharedPath = live ? resolveSharedConfigPath() : null;
const sharedHash = live ? sha256(sharedPath) : null;
const values = live ? Object.fromEntries(Object.entries(createSharedConfigStore({ path: sharedPath }).readEffective())
  .map(([key, field]) => [key, field.value])) : null;
if (live) for (const [key, spec] of Object.entries(CONFIG_FIELDS)) if (spec.type === 'secret') {
  for (const secret of [values[key], ...String(values[key] ?? '').split(',')].filter(Boolean)) secrets.add(secret);
}
const key = 'dsh-desktop-log-' + randomUUID();
secrets.add(key);
let mode = 'ok', fatal = null, owned = null;
const requests = [];
const upstream = createServer(async (request, response) => {
  for await (const _ of request) { /* Never retain bodies or credentials. */ }
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  requests.push({ path, mode, method: request.method });
  response.setHeader('content-type', 'application/json');
  if (path === '/tavily/usage') response.end(JSON.stringify({ account: { plan_usage: 12, plan_limit: 1000 }, key: { usage: 12, limit: 1000 } }));
  else if (path === '/firecrawl/v2/team/credit-usage') response.end(JSON.stringify({ data: { remainingCredits: 890 } }));
  else if (path === '/tinyfish/v1/wallet') response.end(JSON.stringify({ available_balance: '12.345', currency: 'USD' }));
  else if (mode === 'failed' || mode === 'fallback' && path.includes('tavily')) {
    response.writeHead(429); response.end('{}');
  } else {
    const source = { url: 'https://example.test/desktop-evidence', title: 'Desktop search log evidence', content: 'isolated result', summary: 'isolated result' };
    response.end(JSON.stringify(path.includes('firecrawl')
      ? { data: { web: [source] }, creditsUsed: 2 }
      : { results: [source], usage: { credits: 1 }, costDollars: { total: 0.007 } }));
  }
});
await new Promise(done => upstream.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${upstream.address().port}`;
const q = selector => `(() => [document.querySelector('[data-dsg-route]')?.shadowRoot,
  document.querySelector('[data-dsg-layer]')?.shadowRoot].map(root => root?.querySelector(${JSON.stringify(selector)})).find(Boolean))()`;
const dom = (renderer, expression) => renderer.evaluate(expression);
const click = (renderer, selector) => dom(renderer, `(() => { const element=${q(selector)};
  if(!element || element.disabled) return false; element.click(); return true; })()`);
const until = (renderer, expression, timeoutMs = 30_000) => waitForRenderer(renderer, current => current.evaluate(expression), { timeoutMs });
const inside = path => {
  const rel = relative(temporary, resolve(path));
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'new run path only');
  return path;
};
async function rpc(renderer, service, method, args = {}) {
  return renderer.evaluate(`(async () => {
    const method=${JSON.stringify(service + '/' + method)};
    const response=await fetch('/api/'+method,{method:'POST',credentials:'same-origin',
      headers:{'content-type':'application/json'},signal:AbortSignal.timeout(90_000),
      body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args:${JSON.stringify(args)}}})});
    const result=(await response.json()).result;
    if(!result?.ok) throw new Error(result?.error?.code || 'RPC failed');
    return result.value;
  })()`);
}
async function probe(host, op, args = {}) {
  host.address = JSON.parse(readFileSync(host.addressPath, 'utf8'));
  const response = await fetch(`http://127.0.0.1:${host.address.port}/probe`, {
    method: 'POST', headers: { authorization: host.control.token, 'content-type': 'application/json' },
    body: JSON.stringify({ op, args }), signal: AbortSignal.timeout(90_000),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error?.code || 'Isolated probe failed');
  return result.value;
}
async function modelTurn(host, mode) {
  if (!host.modelSession) {
    const auth = await probe(host, 'model-auth');
    const response = await fetch(auth.url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 303);
    host.cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(host.cookie);
    secrets.add(host.cookie);
    host.modelRpc = async (method, request) => {
      const response = await fetch(host.address.hostOrigin + '/api/' + method, {
        method: 'POST', headers: { 'content-type': 'application/json', Origin: host.address.hostOrigin, Cookie: host.cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request } } }),
        signal: AbortSignal.timeout(20_000),
      });
      const message = await response.json();
      if (!message.result?.ok) throw new Error(message.result?.error?.code || 'Model RPC failed');
      return message.result.value;
    };
    host.modelSession = (await host.modelRpc('session/create', { cwd: host.control.workspace })).sessionId;
    assert.ok(host.modelSession);
  }
  const before = await probe(host, 'snapshot');
  await host.modelRpc('session/prompt', { requestId: randomUUID(), sessionId: host.modelSession,
    mode: 'queue', content: [{ type: 'text', text: mode }] });
  const deadline = Date.now() + 65_000;
  while (Date.now() < deadline) {
    const after = await probe(host, 'snapshot');
    const events = after.sessionEvents.slice(before.sessionEvents.length).filter(row => row.sessionId === host.modelSession);
    const final = events.findLast(row => row.type === 'assistant/message'
      && row.data.message.content.some(block => block.type === 'text' && block.text === '内部候选轮次完成'));
    const ended = final && events.find(row => row.type === 'turn/end'
      && row.data.turn === final.data.turn && row.data.reason?.kind === 'completed');
    const tool = final && events.findLast(row => row.type === 'tool/result' && row.data.turn === final.data.turn);
    if (ended && (mode === 'chat' || tool)) return {
      mode, isError: tool?.data.message.isError === true, completed: true,
      originalDelta: after.calls.original - before.calls.original,
      fetchDelta: after.calls.fetch - before.calls.fetch,
    };
    await new Promise(done => setTimeout(done, 150));
  }
  throw new Error('Session turn did not complete: ' + mode);
}
async function stop(host) {
  if (!host) return;
  host.renderer?.close();
  if (!host.ended) {
    try { await requestDesktopShutdown(host.port, host.closed, { timeoutMs: 20_000 }); }
    catch (error) {
      host.shutdownError = safeError(error);
      if (!host.ended) { host.forced = true; host.child.kill('SIGKILL'); await host.closed; }
    }
  }
  if (!host.exitSaved) {
    exits.push({ version: host.runtime.app.version, code: host.exitCode, forced: !!host.forced,
      stderrRetained: false, shutdownError: host.shutdownError ?? null });
    host.exitSaved = true;
  }
}
async function association() {
  if (process.platform !== 'win32') return null;
  const result = await commandResult(process.env.SystemRoot + '/System32/WindowsPowerShell/v1.0/powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command',
      "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\dsh\\shell\\open\\command');if($null -eq $k){Write-Output '<absent>'}else{Write-Output ([string]$k.GetValue(''));$k.Close()}"],
    { timeoutMs: 10_000 });
  assert.equal(result.exitCode, 0);
  return result.rawStdout;
}
const associationBefore = await association();
const binariesBefore = runtimes.map(runtime => ({ version: runtime.app.version, exe: sha256(runtime.executable), asar: sha256(runtime.archivePath) }));
try {
  const program = await findExistingGrok({ override: process.env.DSH_LOG_GROK_PROGRAM });
  assert.equal(program.found, true);
  for (const runtime of runtimes) {
    mode = 'ok';
    const version = runtime.app.version, folder = inside(join(temporary, version));
    prepareDesktopFixture(runtime.executable, folder, { versionedControlRecord: true, pluginManagerEntries: true, liveHmr: true });
    const control = JSON.parse(readFileSync(join(folder, 'local-control.json'), 'utf8'));
    secrets.add(control.token);
    const extraction = inside(join(folder, 'tarball'));
    mkdirSync(extraction);
    const extract = await commandResult(process.platform === 'win32' ? 'tar.exe' : 'tar',
      ['-xf', tarball, '-C', extraction], { timeoutMs: 30_000 });
    assert.equal(extract.exitCode, 0, 'isolated candidate extraction must succeed');
    const product = inside(join(control.profile, 'node_modules/dsh-grok-search'));
    renameSync(inside(join(extraction, 'package')), product);
    for (const row of packageReceipt.files) assert.equal(sha256(join(product, row.path)), sha256(join(project, row.path)));
    mkdirSync(join(product, 'node_modules'));
    for (const name of readdirSync(join(project, 'node_modules'))) {
      if (name.startsWith('.') || name === '@deepseek-ai') continue;
      symlinkSync(join(project, 'node_modules', name), join(product, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir');
    }
    const manifestPath = join(control.profile, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.dependencies['dsh-grok-search'] = packageReceipt.version;
    manifest.dsh.profile.bundles.push('dsh-grok-search');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const configPath = join(folder, 'not-written-config.toml');
    // Only executable/config location is put in the new profile. Keys stay in env.
    writeFileSync(join(control.profile, 'cordis.patch.yml'), JSON.stringify([
      { id: 'grok-search', config: { executable: program.path, configPath } },
    ]));
    const preferences = createPrivatePreferences({ path: join(control.profile, 'grok-search/preferences.json') });
    const initialPreferences = preferences.snapshot();
    preferences.save(initialPreferences.revision, { ...initialPreferences.value, grokEnabled: false, githubEnabled: false });
    const config = live ? values : {
      tavily_api_url: origin + '/tavily', tavily_api_key: key,
      exa_api_url: origin + '/exa', exa_api_key: key,
      firecrawl_api_url: origin + '/firecrawl', firecrawl_api_key: key,
      tinyfish_search_api_url: origin + '/tinyfish', tinyfish_api_key: key,
      source_providers: ['tavily', 'exa', 'firecrawl', 'tinyfish'],
      tavily_enabled: true, exa_enabled: true, firecrawl_enabled: true, tinyfish_enabled: true,
    };
    const envFields = Object.fromEntries(Object.entries(CONFIG_FIELDS).filter(([name]) => config[name] !== undefined)
      .map(([name, spec]) => [spec.env, Array.isArray(config[name]) ? config[name].join(',') : String(config[name])]));
    const { createServer: netServer } = await import('node:net');
    const reservation = netServer();
    await new Promise(done => reservation.listen(0, '127.0.0.1', done));
    const port = reservation.address().port;
    await new Promise(done => reservation.close(done));
    const addressPath = join(folder, 'probe-address.json');
    const env = cleanEnvironment(folder, {
      DSH_HOME: control.dshHome, DSH_DESKTOP_DSH_DIR: control.runtime,
      DSH_DESKTOP_PRIMARY_RUNTIME_DIR: control.primaryRuntime, DSH_DESKTOP_PNPM_ENTRY: control.pnpmEntry,
      DSH_DESKTOP_FIXTURE_TOKEN: control.token, DSH_DESKTOP_FIXTURE_ADDRESS_FILE: addressPath,
      DSH_DESKTOP_OPEN_DEVTOOLS: '0', DSH_B2_CONTROL_RECORD: '1', DSH_B2_PRODUCT_COUNTER: '1',
      DSH_DESKTOP_OFFLINE_SENTINEL: 'offline-test-sentinel-not-a-real-key',
      DSH_PRODUCT_ANALYTICS_OTLP_URL: 'http://127.0.0.1:9', GROK_SEARCH_CONFIG: configPath, ...envFields,
    });
    const child = spawn(control.electron, [...(process.platform === 'win32' ? [runtime.archivePath] : []), '--user-data-dir=' + control.userData,
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port, '--lang=zh-CN'],
    { cwd: folder, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume();
    const host = owned = { runtime, child, control, port, addressPath, ended: false };
    host.closed = new Promise(done => child.once('close', code => { host.ended = true; host.exitCode = code; done(); }));
    const checks = [];
    host.checks = checks;
    const check = (name, actual, expected = true) => {
      checks.push({ name, passed: JSON.stringify(actual) === JSON.stringify(expected) });
      assert.deepEqual(actual, expected, name);
    };
    console.log(JSON.stringify({ version, phase: 'starting-isolated-desktop', live }));
    const deadline = Date.now() + 90_000;
    while (!existsSync(addressPath) && !host.ended && Date.now() < deadline) await new Promise(done => setTimeout(done, 200));
    assert.equal(host.ended, false);
    assert.ok(existsSync(addressPath), 'Desktop probe ready');
    const renderer = host.renderer = await connectRenderer(port, { requestTimeoutMs: 100_000 });
    await renderer.send('Page.bringToFront');
    await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await until(renderer, `document.readyState==='complete' && [...document.querySelectorAll('button')]
      .some(e=>(e.getAttribute('aria-label')||e.innerText||'').trim()==='插件')`, 60_000);
    await dom(renderer, `(() => { [...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')||e.innerText||'').trim()==='插件').click(); })()`);
    await until(renderer, `[...document.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')==='查看 dsh-grok-search')`);
    await dom(renderer, `document.querySelector('button[aria-label="查看 dsh-grok-search"]').click()`);
    await until(renderer, `${q('#routeCard')} && ${q('#routeCard')}.dataset.s!=='load'`);
    check('official plugin detail mounts production Shadow DOM', await dom(renderer,
      `Boolean(document.querySelector('[data-plugin-detail="dsh-grok-search"]') && ${q('#logCard')} && !document.querySelector('#logCard'))`));
    check('same packaged client', sha256(join(product, 'src/client.js')), sha256(join(project, 'src/client.js')));
    await until(renderer, `${q('#logCard')}.innerText.includes('最近')`);
    // Lease registration is observable via a successful empty read; the UI has
    // its own lease, so wait one normal polling period before the first query.
    await new Promise(done => setTimeout(done, 2800));
    const before = await probe(host, 'snapshot');
    const answer = await probe(host, 'product-query-result', { query: 'DeepSeek Harness GitHub official repository', timeoutMs: live ? 30_000 : 5000 });
    check('host WebRuntime receives usable result', answer.sources.length > 0);
    await until(renderer, `${q('.log-entry')}?.dataset.kind==='sources'`);
    check('real request appears in log', await dom(renderer, `${q('.log-entry .le-q')}.textContent`), 'DeepSeek Harness GitHub official repository');
    check('log details expand', await click(renderer, '.log-entry .le-head'));
    check('actual source consumption rendered', await dom(renderer, `Boolean(${q('.log-entry .lu-charge')})`));
    const replayCalls = requests.length, baseline = (await probe(host, 'snapshot')).calls.original;
    check('user replay button', await click(renderer, '.log-entry [data-log-replay]'));
    await until(renderer, `!${q('#historyStage')}.hidden`);
    check('main graph historical full route', await dom(renderer,
      `[...${q('#historyRoute')}.querySelectorAll('.lnode')].map(e=>e.dataset.node)`), ['dsh', 'hub', 'tavily']);
    await until(renderer, `Boolean(${q('.hr-wires .packet')})`);
    check('approved packet glow retained', await dom(renderer, `(() => {const p=${q('.hr-wires .packet')};
      return [p.querySelector('.p-halo').getAttribute('r'),p.querySelector('.p-core').getAttribute('r')];})()`), ['7', '3.2']);
    check('replay stop', await click(renderer, '#historyStop'));
    await until(renderer, `${q('#historyStage')}.hidden`);
    check('replay can complete naturally', await click(renderer, '.log-entry [data-log-replay]'));
    await until(renderer, `${q('#historyBar')}?.dataset.phase==='done' && ${q('#historyStage')}.hidden`, 30_000);
    check('replay did not call loopback provider', requests.length, replayCalls);
    check('replay did not invoke original provider', (await probe(host, 'snapshot')).calls.original, baseline);
    check('privacy hides query', await click(renderer, '#logPrivacy'));
    check('query masked', await dom(renderer, `${q('.le-q')}.textContent`), '搜索内容已隐藏');
    await click(renderer, '#logPrivacy');
    const sessionSearch = await modelTurn(host, 'search');
    check('canonical session web_search succeeds', sessionSearch.isError, false);
    check('canonical search does not call original provider', sessionSearch.originalDelta, 0);
    await until(renderer, `${q('.le-q')}.textContent==='内部候选离线查询'`);
    check('canonical tool query appears in recent history', await dom(renderer, `${q('.le-q')}.textContent`), '内部候选离线查询');
    const fetched = await modelTurn(host, 'fetch');
    check('canonical fetch preserved', fetched.isError === false && fetched.fetchDelta === 1);
    const chat = await modelTurn(host, 'chat');
    check('ordinary chat completes without search', chat.completed && chat.originalDelta === 0 && chat.fetchDelta === 0);
    for (const provider of ['tavily', 'firecrawl', 'tinyfish', 'exa']) {
      check('open ' + provider + ' card', await click(renderer, `#colList .row[data-id=${provider}] .row-main`));
      await until(renderer, `${q('#quotaPanel')}?.dataset.provider===${JSON.stringify(provider)}`);
      if (provider === 'exa') {
        check('Exa has no fabricated balance endpoint', await dom(renderer, `${q('#quotaPanel')}.dataset.state`), 'unsupported');
      } else {
        check(provider + ' refresh permitted with hidden existing key', await click(renderer, '[data-a=quota-refresh]'));
        await until(renderer, `${q('#quotaPanel')}.dataset.state==='ready'`, 30_000);
        check(provider + ' queried via real authenticated settings service', await dom(renderer,
          `Boolean(${q('#quotaPanel .qp-value')}) && !${q('#quotaPanel')}.innerText.includes('查询失败')`));
        const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(run.directory, version + '-' + provider + '.png'), Buffer.from(image.data, 'base64'), { flag: 'wx' });
      }
      check('existing key not revealed by quota', await dom(renderer,
        `[...${q('#dialog')}.querySelectorAll('input[type=password]')].every(e=>e.value==='')`));
      await click(renderer, '[data-a=cancel]');
      await until(renderer, `${q('#overlay')}.hidden`);
    }
    if (!live) {
      mode = 'fallback';
      const fallback = await probe(host, 'product-query-result');
      check('429 falls through to next source', fallback.sources.length > 0);
      await until(renderer, `${q('.log-entry .lroute')}.innerText.includes('Exa')`);
      mode = 'failed';
      let failed = false;
      try { await probe(host, 'product-query-result'); } catch { failed = true; }
      check('all upstreams failed means explicit error', failed);
      await until(renderer, `${q('.log-entry')}?.dataset.kind==='failed'`);
      check('failure did not call original provider', (await probe(host, 'snapshot')).calls.original, before.calls.original);
      mode = 'ok';
    }
    check('clear log', await click(renderer, '#logClear'));
    await until(renderer, `${q('#logCard')}.querySelectorAll('.log-entry').length===0`);
    const nativeSwitch = `document.querySelector('[role="switch"][aria-label="启用 dsh-grok-search"]')`;
    check('native switch initially enabled', await dom(renderer, `${nativeSwitch}?.getAttribute('aria-checked')`), 'true');
    check('user clicks native plugin switch off', await dom(renderer, `(() => {
      const button=${nativeSwitch};if(!button||button.disabled)return false;button.click();return true;})()`));
    await until(renderer, `${nativeSwitch}?.getAttribute('aria-checked')==='false'`);
    await until(renderer, `!document.querySelector('[data-dsg-route]')`);
    const stopped = await probe(host, 'snapshot');
    check('hot disable restores previous author route', stopped.runtimeWeb.searchProviderId, 'candidate-original');
    const release = stopped.recordEnvelope?.intent?.releaseCompletion;
    check('completion revision committed separately from route change', release?.recordCommit?.kind, 'explicit-release-completion');
    check('route restoration receipt verified', release?.routeVerified, true);
    check('fetch provider preserved', stopped.runtimeWeb.fetchProviderId, before.runtimeWeb.fetchProviderId);
    check('existing dependency preserved', stopped.existingDependencyPresent);
    check('user clicks native plugin switch on', await dom(renderer, `(() => {
      const button=${nativeSwitch};if(!button||button.disabled)return false;button.click();return true;})()`));
    await until(renderer, `${nativeSwitch}?.getAttribute('aria-checked')==='true'`);
    await until(renderer, `${q('#routeCard')} && ${q('#routeCard')}.dataset.s!=='load'`);
    check('reenable takes over without restart', (await probe(host, 'snapshot')).runtimeWeb.searchProviderId, 'grok-search');
    check('new page has no private history', await dom(renderer, `${q('#logCard')}.querySelectorAll('.log-entry').length`), 0);
    const afterEnable = await probe(host, 'product-query-result', { query: 'reenabled isolated search', timeoutMs: live ? 30_000 : 5000 });
    check('reenabled search succeeds', afterEnable.sources.length > 0);
    await until(renderer, `${q('.le-q')}?.textContent==='reenabled isolated search'`);
    const retained = await probe(host, 'snapshot');
    check('reenabled search still bypasses original provider', retained.calls.original, before.calls.original);
    check('configuration not written', existsSync(configPath), false);
    check('no renderer exception', renderer.exceptions.length, 0);
    results.push({ version, passed: true, checks, live, officialCounterScope: 'isolated-provider-fixture-not-production',
      desktopRenderer: true, packagedStartup: process.platform === 'darwin', dependenciesInstalled: false });
    await stop(host); owned = null;
    check('owned desktop exited normally', exits.at(-1).code, 0);
    check('owned desktop not force-killed', exits.at(-1).forced, false);
    writeJson(join(run.directory, version + '-checks.json'), results.at(-1));
    console.log(JSON.stringify({ version, phase: 'passed', checks: checks.length }));
  }
} catch (error) {
  fatal = safeError(error);
  if (owned?.renderer) {
    try {
      const state = await dom(owned.renderer, `({body:document.body.innerText.slice(0,1500),
        mounted:Boolean(document.querySelector('[data-dsg-route]')),state:${q('#routeCard')}?.dataset.s,
        quota:${q('#quotaPanel')}?.dataset.state,
        nativeSwitches:[...document.querySelectorAll('[role=switch]')].map(e=>({aria:e.getAttribute('aria-label'),checked:e.getAttribute('aria-checked')}))})`);
      writeJson(join(run.directory, 'failed-state.json'), { ...state, checks: owned.checks });
    } catch { /* Original failure remains authoritative. */ }
  }
} finally {
  await stop(owned);
  upstream.closeAllConnections();
  await new Promise(done => upstream.close(done));
  const associationUnchanged = associationBefore === await association();
  const binariesAfter = runtimes.map(runtime => ({ version: runtime.app.version, exe: sha256(runtime.executable), asar: sha256(runtime.archivePath) }));
  const originalFilesUnchanged = JSON.stringify(binariesBefore) === JSON.stringify(binariesAfter);
  const sourceUnchanged = sourceHashes.every(row => sha256(join(project, row.file)) === row.sha256);
  const sharedConfigUnchanged = live ? sha256(sharedPath) === sharedHash : null;
  const summary = { runId: run.runId, passed: !fatal && sourceUnchanged && associationUnchanged
    && originalFilesUnchanged && sharedConfigUnchanged !== false && exits.every(exit => exit.code === 0 && !exit.forced),
    fatal, results, exits, live, requests, tarballSha256: packageReceipt.sha256, sourceHashes,
    sourceUnchanged, associationUnchanged, originalFilesUnchanged, sharedConfigUnchanged,
    scope: process.platform === 'win32' ? 'official-Desktop-default-app-original-ASAR-renderer-with-isolated-profile'
      : 'official-packaged-Desktop-renderer-with-isolated-profile',
    packagedStartupVerified: process.platform === 'darwin' && !fatal,
    primaryGrokVerified: false, published: false,
    keyFilesWritten: false, rawUpstreamResponsesSaved: false };
  for (const secret of secrets) assert.equal(JSON.stringify(summary).includes(secret), false);
  writeJson(join(run.directory, 'summary.json'), summary);
  console.log(JSON.stringify({ runId: run.runId, passed: summary.passed, fatal, versions: results.map(row => row.version) }));
  process.exitCode = summary.passed ? 0 : 1;
}

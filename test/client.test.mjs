import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { SETTINGS_DESCRIPTORS } from '../src/settings-ui.mjs';
import { createSearchLogView } from '../src/ui/search-log-view.mjs';
import { createQuotaView } from '../src/ui/quota-view.mjs';
import { createSourceChain } from '../src/core/source-chain.mjs';
import { createRouteController } from '../src/ui/route-controller.mjs';

function loadClient() {
  let factory;
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, style: {}, set textContent(_) {} }),
    head: { appendChild() {} },
  };
  const window = { __ModuleLoader__: { load(definition) { factory = definition.factory; } } };
  const context = { window, document, structuredClone, console, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), context,
    { filename: 'src/client.js' });
  assert.equal(typeof factory, 'function');
  const react = {
    useState: () => [null, () => {}],
    useCallback: value => value,
    useEffect() {},
    useMemo: value => value(),
    useRef: () => ({ current: null }),
  };
  const jsx = () => ({});
  return factory(name => name === 'react' ? react : { jsx, jsxs: jsx, Fragment: Symbol('Fragment') });
}

test('client exposes the real settings contribution and all route methods', () => {
  const client = loadClient();
  const methods = client.__test.descriptors.map(descriptor => descriptor.method);
  assert.equal(JSON.stringify(methods), JSON.stringify(SETTINGS_DESCRIPTORS.map(descriptor => descriptor.method)));
  assert.equal(JSON.stringify(client.__test.descriptors), JSON.stringify(SETTINGS_DESCRIPTORS));
  assert.equal(client.__test.descriptors.every(descriptor => descriptor.invocation.kind === 'direct'), true);
});

test('client declares the owners of its remote and keyed detail slot', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'));
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'));
});

test('production view embeds v74 inputs without mock actions or global presentation changes', () => {
  const code = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.match(code, /attachShadow/);
  assert.match(code, /restoreConfig/);
  assert.match(code, /diagnoseProvider/);
  assert.match(code, /theme\/change/);
  assert.doesNotMatch(code, /window\.mock|simulateFail|makeScene|masterSwitch|style\[data-dsg-style\]/);
  assert.doesNotMatch(code, /document\.body\.(?:style|dataset|classList)|document\.documentElement\.dataset/);
});

test('production embeds exact approved log/quota factories, not scene controls or synthesized balances', () => {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.ok(source.includes(createSearchLogView.toString()));
  assert.ok(source.includes(createQuotaView.toString()));
  for (const id of ['logCard', 'historyStage', 'historyRoute', 'logPrivacy']) assert.ok(source.includes(id));
  assert.doesNotMatch(source, /quotaFixture|LOG_SCENES|LOG_DEMO_QUERIES|mockbar|演示数据/);
  assert.match(source, /scope: JSON\.stringify\(\[id, base, S\.config\?\.quotaRevision/);
});

test('client embeds the exact host source-chain rules', () => {
  const client = loadClient();
  const fields = { source_providers: { value: ['exa', 'tavily'], readOnly: false }, exa_enabled: { value: false, readOnly: false } };
  const host = createSourceChain();
  assert.equal(JSON.stringify(client.__test.sourceChain.view(fields)), JSON.stringify(host.view(fields)));
  const change = { kind: 'order', order: ['tavily', 'exa', 'firecrawl', 'tinyfish'] };
  assert.equal(JSON.stringify(client.__test.sourceChain.plan(fields, change)), JSON.stringify(host.plan(fields, change)));
});

test('Grok form names protocols and credentials without implying a provider or key-prefix restriction', () => {
  const code = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.match(code, />Responses 接口<\/button>/);
  assert.match(code, />Chat Completions 接口<\/button>/);
  assert.match(code, /label: 'Base URL', k: 'gwUrl'/);
  assert.match(code, /label: 'API Key', k: 'gwKey'/);
  assert.match(code, /keyIn\('key', p\.key, 'xai-\.\.\.\/sk-\.\.\.'\)/);
  assert.doesNotMatch(code, /xAI Responses<\/button>|OpenAI 兼容网关<\/button>|直连 xAI 官方接口/);
});

test('generated client carries the current route controller and separates search errors from credential feedback', () => {
  const code = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.ok(code.includes(createRouteController.toString()), 'rebuild client after changing the route controller');
  assert.match(code, /class="note search-result"/);
  assert.match(code, /GROK_SOURCES_EMPTY: \['来源', '未返回引用链接'\]/);
  assert.doesNotMatch(code, /没有可核验来源|没有可核验回答/);
});

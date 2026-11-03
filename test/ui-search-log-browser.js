async page => {
  await page.reload();
  await page.waitForFunction(() => Boolean(window.harness));
  const run = await page.evaluate(async () => (await fetch('/begin', { method: 'POST' })).json());
  const checks = [], errors = [], external = [];
  const origin = await page.evaluate(() => location.origin);
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (!request.url().startsWith(origin) && /^https?:/.test(request.url())) external.push(request.url()); });
  const check = (name, actual, expected = true) => {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, passed, ...(passed ? {} : { actual, expected }) });
    if (!passed) throw new Error(name + ': ' + JSON.stringify(actual));
  };
  const read = fn => page.evaluate(fn);
  const refresh = async () => {
    await page.evaluate(() => window.harness.refresh());
    await page.waitForFunction(() => window.harness.state.calls.some(call => call.method === 'readSearchLog'));
  };
  const rows = () => page.locator('.log-entry');
  const logs = [
    { id: 'search-log-3', at: 1800000002000, q: '<script>private query</script>', kind: 'fallback',
      served: 'tavily', ms: 1200, reason: 'grok_auth_error', official: null, detail: '',
      calls: [{ provider: 'grok', result: 'failed', code: 'HTTP_401' },
        { provider: 'tavily', result: 'ok', keyIndex: 0, charge: { basis: 'reported', amount: 1, unit: 'credits' } }] },
    { id: 'search-log-2', at: 1800000001000, q: 'unknown source', kind: 'fallback', served: 'grok-sources', ms: 300, reason: 'grok_provider_error' },
    { id: 'search-log-1', at: 1800000000000, q: 'all failed', kind: 'failed', served: null, ms: 500, reason: 'SOURCE_ALL_FAILED', calls: [] },
  ];
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.harness.reset('returning'));
    await page.locator('#routeCard:not([data-s=load])').waitFor();
    check('empty log below route', await page.locator('#logCard').evaluate(el => el.previousElementSibling.id), 'routeCard');
    await page.evaluate(() => {
      const view = document.querySelector('[data-dsg-route]').shadowRoot;
      view.querySelector('#colList .row[data-id=grok] .row-main').click();
      document.querySelector('[data-dsg-layer]').shadowRoot.querySelector('input[data-k=url]').focus();
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check('opening RAF respects an already focused input', await page.locator('input[data-k=url]').evaluate(el => el.getRootNode().activeElement === el));
    await page.locator('[data-a=cancel]').click();
    await page.locator('#overlay').waitFor({ state: 'hidden' });
    await page.evaluate(logs => { window.harness.configure({ logs }); window.harness.refresh(); }, logs);
    await rows().first().waitFor();
    check('three real gateway-shaped records render', await rows().count(), 3);
    check('query is escaped', await rows().first().locator('.le-q').textContent(), logs[0].q);
    check('no query-created script', await rows().first().locator('script').count(), 0);
    await rows().first().locator('.le-head').click();
    check('reported credits display', await rows().first().locator('.lu-charge').textContent(), '1 credits接口报告');
    check('missing usage remains unknown', await rows().first().locator('.lu-unknown').count(), 1);
    check('no invented official count', await page.locator('.lofficial').count(), 0);
    const before = await read(() => window.harness.state.calls.filter(call => ['diagnoseProvider', 'testSearch', 'save', 'savePreferences', 'accountQuota'].includes(call.method)).length);
    await rows().first().locator('[data-log-replay]').click();
    check('replay overlays main graph', await page.locator('#historyStage').isVisible());
    check('same complete chain in header', await page.locator('#historyRoute .lnode').evaluateAll(nodes => nodes.map(node => node.dataset.node)), ['dsh', 'hub', 'grok', 'tavily']);
    check('overlay provider row does not corrupt live configuration', await page.locator('#colList .row[data-id]').count(), 6);
    const historyMarks = await page.locator('#historyStage .hr-port').evaluateAll(nodes => nodes.map(node => node.dataset.mark || ''));
    const readsBefore = await read(() => window.harness.state.calls.filter(call => call.method === 'readSearchLog').length);
    await page.evaluate(() => window.harness.refresh());
    await page.waitForFunction(count => window.harness.state.calls.filter(call => call.method === 'readSearchLog').length > count, readsBefore);
    check('live polling never changes historical ports', await page.locator('#historyStage .hr-port').evaluateAll(nodes => nodes.map(node => node.dataset.mark || '')), historyMarks);
    check('replay does not issue paid or config RPC', await read(() => window.harness.state.calls.filter(call => ['diagnoseProvider', 'testSearch', 'save', 'savePreferences', 'accountQuota'].includes(call.method)).length), before);
    await page.locator('#historyStop').click();
    check('stop restores current graph', await page.locator('#historyStage').isHidden());
    await page.locator('#logPrivacy').click();
    check('privacy masks rendered query', await rows().first().locator('.le-q').textContent(), '搜索内容已隐藏');
    await rows().first().locator('[data-log-replay]').click();
    check('privacy masks replay query too', await page.locator('#historyQuery').textContent(), '搜索内容已隐藏');
    await page.locator('#historyStop').click();
    await page.locator('[data-logfilter=failed]').click();
    check('failed filter only', await rows().count(), 1);
    await page.locator('[data-logfilter=all]').click();
    await page.locator('#logPrivacy').click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await rows().first().locator('[data-log-replay]').click();
    await page.waitForFunction(() => document.querySelector('[data-dsg-route]').shadowRoot.querySelector('.hr-wires .packet'));
    check('real packet shares core and halo sizes', await page.locator('.hr-wires .packet').first().evaluate(el =>
      [el.querySelector('.p-halo').getAttribute('r'), el.querySelector('.p-core').getAttribute('r')]), ['7', '3.2']);
    await page.locator('#historyStop').click();
    check('packet cleared after stop', await page.locator('.hr-wires .packet').count(), 0);
    await rows().first().locator('[data-log-replay]').click();
    await page.locator('#historyBar[data-phase=done]').waitFor();
    check('full replay completes and restores configuration', await page.locator('#historyStage').isHidden());
    await rows().nth(1).locator('[data-log-replay]').click();
    await page.locator('#historyStage').waitFor();
    check('unknown source does not pick a provider', await page.locator('.hr-node[data-history-node=unknown]').count(), 1);
    await page.locator('#historyStop').click();
    await page.evaluate(() => window.harness.theme('dark'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-dsg-route]').shadowRoot.querySelector('#routeCard')).backgroundColor === 'rgb(22, 24, 28)');
    await page.screenshot({ path: run.directory + '/log-dark.png', fullPage: true });
    await page.evaluate(() => window.harness.theme('light'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-dsg-route]').shadowRoot.querySelector('#routeCard')).backgroundColor === 'rgb(255, 255, 255)');
    await page.screenshot({ path: run.directory + '/log-light.png', fullPage: true });

    await page.locator('#colList .row[data-id=tavily] .row-main').click();
    await page.locator('#dialog').waitFor();
    check('quota header includes compact console link', await page.locator('.qp-heading .qp-console').count(), 1);
    check('console typography matches approved detail', await page.locator('.qp-console').evaluate(el => {
      const style = getComputedStyle(el); return [style.fontSize, style.fontWeight];
    }), ['11px', '550']);
    const quotaCalls = await read(() => window.harness.state.calls.filter(call => call.method === 'accountQuota').length);
    check('opening config does not query or reveal credentials', quotaCalls, 0);
    await page.evaluate(() => window.harness.configure({ quotas: { tavily: { kind: 'credits', used: 45, remaining: 955, plan: 1000,
      keyUsed: 5, keyLimit: 100, keyRemaining: 95, note: '真实数据格式，离线夹具' } } }));
    await page.locator('[data-a=quota-refresh]').click();
    await page.locator('#quotaPanel[data-state=ready]').waitFor();
    check('used and remaining are distinct', await page.locator('.qp-stats .qp-value').allTextContents(), ['45', '955']);
    await page.locator('[data-a=quota-details]').click();
    check('key detail not duplicated in main stats', await page.locator('[data-key-stat=remaining]').textContent(), '95 credits');
    await page.evaluate(() => window.harness.configure({ quotaError: true }));
    await page.locator('[data-a=quota-refresh]').click();
    await page.locator('#quotaPanel[data-state=error]').waitFor();
    check('query failure retains explicitly stale value', await page.locator('.qp-updated').textContent().then(text => text.includes('保留上次结果')));
    await page.locator('input[data-k=url]').fill('https://custom.test');
    check('changed URL does not reuse old balance', await page.locator('#quotaPanel').getAttribute('data-state'), 'changed');
    check('dirty destination cannot query', await page.locator('[data-a=quota-refresh]').isDisabled());
    await page.locator('[data-a=cancel]').click();
    await page.locator('#overlay').waitFor({ state: 'hidden' });
    await page.locator('#colList .row[data-id=exa] .row-main').click();
    check('Exa no fake refresh request', await page.locator('[data-a=quota-refresh]').count(), 0);
    check('Exa compact not failed', await page.locator('#quotaPanel').getAttribute('data-state'), 'unsupported');
    await page.locator('[data-a=cancel]').click();
    await page.locator('#overlay').waitFor({ state: 'hidden' });
    await page.locator('#logClear').click();
    await page.waitForFunction(() => window.harness.state.calls.some(call => call.method === 'clearSearchLog'));
    check('clear removes records', await rows().count(), 0);
    await page.evaluate(() => window.harness.unmount());
    check('unmount closes private lease', await read(() => window.harness.state.calls.some(call => call.method === 'closeSearchLog')));
    check('all layer hosts removed', await page.locator('[data-dsg-layer]').count(), 0);
    check('no runtime error', errors.length, 0);
    check('no external request', external.length, 0);
    const summary = { ...run, passed: checks.length, failed: 0, checks, errors, external,
      fixtureOnly: true, realHostVerified: false };
    const recorded = await page.evaluate(async summary => {
      const response = await fetch('/evidence', { method: 'POST', body: JSON.stringify(summary) });
      return { ok: response.ok, text: await response.text() };
    }, summary);
    if (!recorded.ok) throw new Error(recorded.text);
    console.log(JSON.stringify({ runId: run.runId, passed: checks.length, failed: 0 }));
  } catch (error) {
    await page.screenshot({ path: run.directory + '/failed.png', fullPage: true });
    const summary = { ...run, checks, errors, external, failed: 1, error: String(error), fixtureOnly: true };
    await page.evaluate(summary => fetch('/evidence', { method: 'POST', body: JSON.stringify(summary) }), summary);
    throw error;
  }
}

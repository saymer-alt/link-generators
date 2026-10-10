// Owner UX acceptance: actual clicks, viewport/focus, intercepted network,
// identical graph controls in both consumers. No real controller traffic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');
const root = path.resolve(process.env.OWNER_UX_ROOT || path.join(__dirname, '..'));
const engine = process.env.OWNER_UX_BROWSER || 'chromium';
const link = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#Owner-A';
let passed = 0, failed = 0;
const results = [];
async function check(name, fn) {
  if (process.env.OWNER_UX_FILTER && !name.includes(process.env.OWNER_UX_FILTER)) return;
  try { await fn(); passed++; results.push({ name, pass: true }); console.log('PASS', name); }
  catch (e) { failed++; results.push({ name, pass: false, error: e.message }); console.error('FAIL', name, process.env.OWNER_UX_DEBUG ? e.stack : e.message); }
}
(async () => {
  const browser = await playwright[engine].launch({ headless: true,
    ...(engine === 'chromium' && process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const pages = [];
  async function fresh() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } }); pages.push(page);
    page.setDefaultTimeout(5000);
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    // Any non-CDN network must be explicitly intercepted by a scenario.
    await page.route(/https?:\/\/(?!cdn\.jsdelivr\.net)/, r => r.abort());
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => globalThis.web4core && globalThis.jsyaml);
    await page.locator('.tab', { hasText: 'Mihomo Config Builder' }).click();
    await page.locator('#cfgSubMode').uncheck();
    await page.locator('#cfgPolicyRouting').check();
    return page;
  }
  async function screenshot(page, selector, name) {
    if (!process.env.OWNER_UX_SCREENSHOTS) return;
    fs.mkdirSync(process.env.OWNER_UX_SCREENSHOTS, { recursive: true });
    await page.locator(selector).screenshot({ path: path.join(process.env.OWNER_UX_SCREENSHOTS, engine + '-' + name + '.png') });
  }
  async function build(page) {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID');
  }
  const names = page => page.locator('#policyCards .policy-name').evaluateAll(xs => xs.map(x => x.value));
  const p = await fresh();
  const disclosure = await fresh();
  await check('UX09 chevrons follow native open state and nested keyboard toggles', async () => {
    const ids = ['wgDialerAdvanced', 'routingDiagnostics', 'ruleProviderExplorer',
      'domainCoveragePanel', 'physicalTopologyPanel', 'ptRuntimePanel', 'perProxyAdvancedDetails'];
    for (const id of ids) {
      const details = disclosure.locator('#' + id);
      const marker = details.locator(':scope > summary > .disclosure-chevron');
      assert.equal(await marker.count(), 1, id + ': missing marker');
      assert.equal(await marker.getAttribute('aria-hidden'), 'true');
      await details.evaluate(d => { d.open = false; });
      await disclosure.waitForFunction(id => document.querySelector('#' + id + ' > summary > .disclosure-chevron').textContent === '▶', id);
      await details.evaluate(d => { d.open = true; });
      await disclosure.waitForFunction(id => document.querySelector('#' + id + ' > summary > .disclosure-chevron').textContent === '▼', id);
      await details.evaluate(d => { d.open = false; });
      await disclosure.waitForFunction(id => document.querySelector('#' + id + ' > summary > .disclosure-chevron').textContent === '▶', id);
    }
    const diag = disclosure.locator('#routingDiagnostics');
    await diag.locator(':scope > summary').click();
    assert.equal(await diag.evaluate(d => d.open), true, 'mouse toggles Diagnostics');
    const explorer = disclosure.locator('#ruleProviderExplorer');
    await explorer.locator(':scope > summary').focus();
    await disclosure.keyboard.press('Enter');
    assert.equal(await explorer.evaluate(d => d.open), true, 'keyboard opens nested Explorer');
    await disclosure.keyboard.press('Enter');
    assert.equal(await explorer.evaluate(d => d.open), false, 'keyboard closes nested Explorer');
    const topology = disclosure.locator('#physicalTopologyPanel');
    await topology.locator(':scope > summary').click();
    assert.equal(await topology.evaluate(d => d.open), true, 'mouse opens Physical Topology');
    const runtime = disclosure.locator('#ptRuntimePanel');
    await runtime.locator(':scope > summary').click();
    assert.equal(await runtime.evaluate(d => d.open), true, 'mouse opens nested Runtime Evidence');
    // The shared native-toggle marker also covers the legacy per-proxy control.
    const perProxy = disclosure.locator('#perProxyAdvancedDetails');
    await perProxy.locator(':scope > summary').click();
    await disclosure.waitForFunction(() => document.getElementById('perProxyDisclosureMarker').textContent === '▼');
    await perProxy.locator(':scope > summary').click();
    await disclosure.waitForFunction(() => document.getElementById('perProxyDisclosureMarker').textContent === '▶');
  });
  await check('UX01 add controls precede cards and separate import', async () => {
    assert.equal(await p.evaluate(() => !!(document.getElementById('btnPolicyAdd').compareDocumentPosition(document.getElementById('policyCards')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  });
  await check('UX01/02 four visible focused cards in append order', async () => {
    for (let i = 0; i < 4; i++) {
      await p.locator('#btnPolicyAdd').click();
      const current = p.locator('#policyCards .policy-name').last();
      assert.equal(await current.evaluate(el => el === document.activeElement), true);
      assert.equal(await current.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true);
    }
    assert.deepEqual(await names(p), ['AI', 'AI-2', 'AI-3', 'AI-4']);
    assert.match(await p.locator('[role=status]#policyAddStatus').textContent(), /Политика добавлена/);
  });
  await check('UX01 doubleclick creates exactly one card', async () => {
    const before = (await names(p)).length;
    await p.locator('#btnPolicyAdd').dblclick();
    assert.equal((await names(p)).length, before + 1);
  });
  await check('UX02 delete and re-add reuses free name without renaming', async () => {
    await p.locator('#policyCards .policy-card').nth(1).locator('.policy-del').click();
    const before = await names(p);
    await p.locator('#btnPolicyAdd').click();
    assert.deepEqual(await names(p), [...before, 'AI-2']);
  });
  await check('UX02 manual duplicate remains strict validation', async () => {
    await p.locator('#mihomoInput').fill(link);
    await p.locator('#policyCards .policy-name').last().fill('AI');
    const result = await p.evaluate(() => { try { collectPolicyRouting(); return ''; } catch(e) { return e.message; } });
    assert.match(result, /Дублирующееся имя/);
    await p.locator('#policyCards .policy-name').last().fill('AI-2');
    await build(p);
  });
  await check('UX02 imported names and order survive manual addition', async () => {
    // Use the actual file input and import preview; synthetic export fixture.
    const payload = { groups: ['AI', 'MEDIA'].map((name, index) => ({ id: 'owner-' + index, name, interface: 'mitun0', enable: true,
      rules: Array.from({ length: 80 }, (_, i) => ({ id: 'r-' + index + '-' + i, type: 'namespace', rule: 'd' + i + '.example', enable: 'True' })) })) };
    await p.locator('#mtImportFile').setInputFiles({ name: 'owner.mtrickle', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
    await p.locator('#mtImportApply').click();
    const before = await names(p);
    await p.locator('#btnPolicyAdd').click();
    const after = await names(p);
    assert.deepEqual(after.slice(0, -1), before);
    assert.equal(new Set(after).size, after.length);
    assert.equal(await p.locator('#policyCards .policy-name').last().evaluate(el => el === document.activeElement && el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= innerHeight), true);
  });
  await check('UX02 project roundtrip retains policy names and priority', async () => {
    const before = await names(p);
    await p.evaluate(() => { const project = rbCollectProject(); rbApplyProject(project); });
    assert.deepEqual(await names(p), before);
  });

  const c = await fresh();
  await c.locator('#cfgServerList').check();
  await c.evaluate(() => { document.getElementById('runtimeImportDetails').open = true; document.getElementById('subscriptionPreviewDetails')?.setAttribute('open', ''); });
  const requests = [];
  await c.route('**/providers/proxies', async r => { requests.push({ url: r.request().url(), headers: r.request().headers(), method: r.request().method() }); await r.fulfill({ json: { providers: { P: { proxies: [{ name: 'safe-node', alive: true }] } } } }); });
  await check('UX04 no automatic request; empty field defaults only on Fetch', async () => {
    assert.equal(requests.length, 0);
    await c.locator('#rtFetchBtn').click();
    await c.waitForFunction(() => document.getElementById('rtStatus').textContent.includes('✔'));
    assert.equal(requests.at(-1).url, 'http://192.168.1.1:9090/providers/proxies');
    assert.equal(await c.locator('#rtControllerInput').inputValue(), '');
    assert.equal(requests.at(-1).method, 'GET');
  });
  await check('UX04 default secret requires target confirmation and cancel sends nothing', async () => {
    await c.locator('#rtSecretInput').fill('synthetic-owner-secret');
    const count = requests.length;
    let target = '';
    c.once('dialog', d => { target = d.message(); return d.dismiss(); });
    await c.locator('#rtFetchBtn').click();
    assert.match(target, /http:\/\/192\.168\.1\.1:9090/);
    assert.equal(requests.length, count);
    c.once('dialog', d => d.accept());
    await c.locator('#rtFetchBtn').click();
    await c.waitForFunction(() => document.getElementById('rtStatus').textContent.includes('✔'));
    assert.equal(requests.at(-1).headers.authorization, 'Bearer synthetic-owner-secret');
  });
  await check('UX05 UI URL normalization, prefix, IPv6 and credentials rejection', async () => {
    const actual = await c.evaluate(() => {
      const inputs = ['', '192.168.1.2:9191', '[::1]:9090', 'http://192.168.1.1:9090/ui/#/overview', 'https://router.example/ui#/rules', 'https://router.example/api/mihomo/', 'https://router.example/api/ui/#/logs'];
      const outputs = inputs.map(normalizeRuntimeController);
      for (const bad of ['ftp://host:1', 'javascript:alert(1)', 'http://u:p@host:9090']) {
        try { normalizeRuntimeController(bad); outputs.push('UNSAFE'); } catch (_) { outputs.push('REJECT'); }
      }
      return outputs;
    });
    assert.deepEqual(actual, ['http://192.168.1.1:9090', 'http://192.168.1.2:9191', 'http://[::1]:9090', 'http://192.168.1.1:9090', 'https://router.example', 'https://router.example/api/mihomo', 'https://router.example/api/ui', 'REJECT', 'REJECT', 'REJECT']);
    await c.locator('#rtControllerInput').fill('http://192.168.1.1:9090/ui/#/proxies');
    await c.locator('#rtFetchBtn').click();
    await c.waitForFunction(() => document.getElementById('rtStatus').textContent.includes('✔'));
    assert.equal(requests.at(-1).url, 'http://192.168.1.1:9090/providers/proxies');
  });
  await check('UX06 HTTP, malformed JSON and unknown network failure stay distinct', async () => {
    await c.locator('#rtControllerInput').fill('http://192.168.1.1:9090');
    await c.locator('#rtSecretInput').fill('');
    for (const status of [401, 403, 404]) {
      await c.route('**/providers/proxies', r => r.fulfill({ status, body: '{}' }));
      await c.locator('#rtFetchBtn').click();
      await c.waitForFunction(status => document.getElementById('rtStatus').textContent.includes('HTTP ' + status), status);
    }
    await c.route('**/providers/proxies', r => r.fulfill({ body: 'not JSON' }));
    await c.locator('#rtFetchBtn').click();
    await c.waitForFunction(() => /JSON/.test(document.getElementById('rtStatus').textContent));
    assert.ok(!(await c.locator('#rtStatus').textContent()).includes('✔'));
    await c.route('**/providers/proxies', r => r.abort());
    await c.locator('#rtFetchBtn').click();
    await c.waitForFunction(() => /причина не установлена/.test(document.getElementById('rtStatus').textContent));
    assert.match(await c.locator('#rtStatus').textContent(), /Console.*JSON/);
  });
  await check('UX06 timeout uses existing eight second abort', async () => {
    await c.locator('#rtControllerInput').fill('http://192.168.1.1:9090');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await c.route('**/providers/proxies', async r => { await gate; try { await r.abort(); } catch (_) {} });
    try {
      await c.locator('#rtFetchBtn').click();
      // No competing 8.5s mock close: only the application's unchanged 8s abort.
      await c.waitForFunction(() => /Время ожидания/.test(document.getElementById('rtStatus').textContent), null, { timeout: 15000 });
    } catch (e) {
      const state = await c.evaluate(() => ({ status: document.getElementById('rtStatus').textContent, aborted: rtImportAbort?.signal.aborted }));
      throw new Error(e.message + '; captured state: ' + JSON.stringify(state));
    } finally { release(); }
  });

  const d = await fresh();
  await d.evaluate(() => { document.getElementById('routingDiagnostics').open = true; document.getElementById('domainCoveragePanel').open = true; });
  await check('UX07 empty Inspector offers normal Build then default offline probe', async () => {
    await d.locator('#mihomoInput').fill(link);
    await d.locator('#btnPolicyAdd').click();
    await d.locator('#rdTestBtn').click();
    assert.equal(await d.locator('#rdBuildCheckBtn').isVisible(), true);
    await d.locator('#rdBuildCheckBtn').click();
    await d.waitForFunction(() => document.getElementById('rdResult').textContent.includes('Победившее правило'));
    assert.match(await d.locator('#rdResult').textContent(), /AI/);
    assert.equal(await d.locator('#rdEffectiveInput').textContent(), 'Офлайн-проверка: gemini.google.com');
    assert.equal(await d.locator('#rdTestInput').inputValue(), '');
  });
  await check('UX08 stale coverage offers rebuild and retains chosen domains', async () => {
    await d.locator('#dcInput').fill('chat.openai.com\nowner.example');
    await d.locator('#policyCards .policy-target').first().selectOption('DIRECT');
    await d.locator('#dcRunBtn').click();
    assert.equal(await d.locator('#dcBuildCheckBtn').isVisible(), true);
    assert.ok(!(await d.locator('#dcResults').textContent()).includes('SELECT-группа'));
    await d.locator('#dcBuildCheckBtn').click();
    await d.waitForFunction(() => document.getElementById('dcResults').textContent.includes('→ DIRECT'));
    assert.equal(await d.locator('#dcInput').inputValue(), 'chat.openai.com\nowner.example');
  });
  await check('UX07 network Build cancel does not send or mutate project', async () => {
    await d.locator('#mihomoInput').fill('https://owner-sub.example.invalid/sub');
    await d.locator('#rdTestBtn').click();
    const before = await d.locator('#mihomoOutput').inputValue();
    let count = 0; await d.route('**/owner-sub.example.invalid/**', r => { count++; return r.abort(); });
    let message = ''; d.once('dialog', dialog => { message = dialog.message(); return dialog.dismiss(); });
    await d.locator('#rdBuildCheckBtn').click();
    assert.match(message, /fallback-воркер/); assert.equal(count, 0);
    assert.equal(await d.locator('#mihomoOutput').inputValue(), before);
  });
  await check('UX07 consent uses normal subscription Build and custom domain', async () => {
    let hits = 0;
    await d.route('https://owner-sub.example.invalid/sub', r => { hits++; return r.fulfill({ body: link }); });
    await d.locator('#rdTestInput').fill('custom.owner.example');
    d.once('dialog', dialog => dialog.accept());
    await d.locator('#rdBuildCheckBtn').click();
    await d.waitForFunction(() => document.getElementById('rdResult').textContent.includes('Fallback:'));
    assert.equal(hits, 1);
    assert.equal(await d.locator('#rdTestInput').inputValue(), 'custom.owner.example');
  });
  await check('UX07 pending diagnostic cannot overwrite changed query/settings', async () => {
    await d.locator('#mihomoInput').fill('https://owner-slow.example.invalid/sub');
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await d.route('https://owner-slow.example.invalid/sub', async r => { started(); await gate; await r.fulfill({ body: link }); });
    await d.locator('#rdTestBtn').click();
    d.once('dialog', dialog => dialog.accept());
    await d.locator('#rdBuildCheckBtn').click(); await ready;
    await d.locator('#rdTestInput').fill('new.owner.example');
    await d.locator('#mihomoInput').fill(link + '#changed');
    release();
    await d.waitForTimeout(100);
    assert.ok(!(await d.locator('#rdResult').textContent()).includes('Победившее правило'));
    assert.equal(await d.evaluate(() => diagnosticsCurrent()), false);
    assert.equal(await d.locator('#rdBuildCheckBtn').isEnabled(), true);
  });

  await check('UX07 async policy mutation rejects old Build commit', async () => {
    await d.locator('#mihomoInput').fill('https://owner-policy-race.example.invalid/sub');
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await d.route('https://owner-policy-race.example.invalid/sub', async r => { started(); await gate; await r.fulfill({ body: link }); });
    await d.locator('#rdTestBtn').click();
    const before = await d.locator('#mihomoOutput').inputValue();
    d.once('dialog', dialog => dialog.accept());
    await d.locator('#rdBuildCheckBtn').click(); await ready;
    await d.locator('#btnPolicyAdd').click(); // DOM mutation via click, no input/change event
    release();
    await d.waitForFunction(() => !document.getElementById('rdBuildCheckBtn').disabled);
    assert.equal(await d.locator('#mihomoOutput').inputValue(), before, 'old Build must not publish after policy insertion');
    assert.equal(await d.evaluate(() => diagnosticsCurrent()), false);
  });

  const g = await fresh();
  await g.locator('#mihomoInput').fill(Array.from({ length: 19 }, (_, i) => 'vless://00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0') + '@192.0.2.' + (i + 1) + ':443#Owner-' + i).join('\n'));
  await g.locator('#btnPolicyAdd').click();
  await build(g);
  await g.evaluate(() => { document.getElementById('routingDiagnostics').open = true; document.getElementById('vrgPanel').open = true; });
  await check('UX03 real normal Build with 19+ nodes and unchanged YAML', async () => {
    const yaml = await g.locator('#mihomoOutput').inputValue();
    assert.ok(await g.evaluate(() => cdgBuildGraph(lastRoutingDoc).nodes.length >= 19));
    for (const action of ['fit', 'in', 'out', 'reset']) await g.locator('#vrgSvgWrapNav [data-vrg-action=' + action + ']').click();
    assert.equal(await g.locator('#mihomoOutput').inputValue(), yaml);
    assert.equal(await g.evaluate(() => diagnosticsCurrent()), true);
    await g.locator('#ruleProviderExplorer > summary').click();
    await g.locator('#rpeProviders .rpe-provider > summary').first().click();
    await g.locator('#rpeProviders .rpe-search').first().fill('gemini');
    assert.equal(await g.evaluate(() => diagnosticsCurrent()), true, 'lazy Explorer search must not dirty Build');
    await g.locator('#policyPresetSelect').selectOption('telegram');
    assert.equal(await g.evaluate(() => diagnosticsCurrent()), true, 'template choice alone must not dirty Build');
  });
  // 19 nodes/31 edges exactly: 12 proxies + two groups + 5 rules.
  const graphDoc = count => ({ proxies: Array.from({ length: count }, (_, i) => ({ name: i === 0 ? 'secret-graph-token' : 'Node-' + i + '-long-label-'.repeat(4), type: 'ss', server: '192.0.2.1', port: 443, password: 'secret-graph-token', cipher: 'aes-128-gcm', ...(i === 1 || i === 2 ? { 'dialer-proxy': 'secret-graph-token' } : {}) })),
    'proxy-groups': [{ name: 'Primary', type: 'select', proxies: Array.from({ length: count }, (_, i) => i === 0 ? 'secret-graph-token' : 'Node-' + i + '-long-label-'.repeat(4)) }, { name: 'Secondary', type: 'fallback', proxies: Array.from({ length: count }, (_, i) => i === 0 ? 'secret-graph-token' : 'Node-' + i + '-long-label-'.repeat(4)) }],
    rules: ['DOMAIN,a.example,Primary', 'DOMAIN,b.example,Primary', 'DOMAIN,c.example,Secondary', 'DOMAIN,d.example,Secondary', 'MATCH,Primary'] });
  for (const count of [1, 12, 50, 100]) {
    await check('UX03 Builder graph navigation/redaction count=' + count, async () => {
      const doc = graphDoc(count);
      if (count === 1) { doc['proxy-groups'].pop(); doc.rules = ['MATCH,Primary']; }
      const size = await g.evaluate(doc => { lastRoutingDoc = doc; vrgFocusId = ''; renderVrgBuilder(); const graph = cdgBuildGraph(doc); return { nodes: graph.nodes.length, edges: graph.edges.length }; }, doc);
      if (count === 1) assert.equal(size.nodes, 3);
      if (count === 12) assert.deepEqual(size, { nodes: 19, edges: 31 });
      const prefix = '#vrgSvgWrap';
      const nav = g.locator(prefix + 'Nav');
      await nav.locator('[data-vrg-action=fit]').click();
      assert.equal(await g.locator(prefix).evaluate(el => { const svg = el.querySelector('svg').getBoundingClientRect(); return svg.width <= el.clientWidth + 1 && svg.height <= el.clientHeight + 1; }), true);
      if (count === 12) await screenshot(g, '#vrgPanel', 'builder-19-fit');
      const before = await g.locator(prefix + ' svg').getAttribute('width');
      await nav.locator('[data-vrg-action=out]').click();
      assert.ok(Number(await g.locator(prefix + ' svg').getAttribute('width')) <= Number(before), 'minus must not enlarge a fitted graph below 25%');
      await nav.locator('[data-vrg-action=fit]').click();
      await nav.locator('[data-vrg-action=in]').click();
      assert.ok(Number(await g.locator(prefix + ' svg').getAttribute('width')) > Number(before));
      await nav.locator('[data-vrg-action=out]').click();
      await nav.locator('[data-vrg-action=reset]').click();
      assert.equal(await nav.locator('.vrg-scale').textContent(), '100%');
      await nav.locator('[data-vrg-action=out]').focus();
      await g.keyboard.press('Tab'); await g.keyboard.press('Enter');
      assert.equal(await nav.locator('.vrg-scale').textContent(), '125%');
      const node = g.locator(prefix + ' g[tabindex]').first();
      await node.focus(); await g.keyboard.press('Enter');
      const selected = await g.evaluate(() => vrgFocusId); assert.ok(selected);
      await nav.locator('[data-vrg-action=in]').click();
      assert.equal(await g.evaluate(() => vrgFocusId), selected);
      await nav.locator('[data-vrg-action=all]').click();
      assert.equal(await g.evaluate(() => vrgFocusId), '');
      assert.ok(!(await g.locator(prefix).textContent()).includes('secret-graph-token'));
      assert.ok(!(await g.locator('#vrgTextAltOut').textContent()).includes('secret-graph-token'));
      assert.ok((await g.locator('#vrgTextAltOut').textContent()).includes('Узлы'));
    });
  }
  await check('UX03 pan uses real pointer movement; wheel without modifier keeps scale', async () => {
    const nav = g.locator('#vrgSvgWrapNav');
    await nav.locator('[data-vrg-action=reset]').click();
    const wrap = g.locator('#vrgSvgWrap'); await wrap.scrollIntoViewIfNeeded();
    const box = await wrap.boundingBox();
    await g.mouse.move(box.x + 10, box.y + Math.min(box.height - 10, 170));
    await g.mouse.down(); await g.mouse.move(box.x + 10, box.y + 20, { steps: 8 }); await g.mouse.up();
    assert.ok(await wrap.evaluate(el => el.scrollTop > 50));
    assert.equal(await g.evaluate(() => vrgFocusId), '');
    const scale = await nav.locator('.vrg-scale').textContent();
    await g.mouse.wheel(0, 50); assert.equal(await nav.locator('.vrg-scale').textContent(), scale);
    await nav.locator('[data-vrg-action=fit]').click();
    await wrap.scrollIntoViewIfNeeded();
    const fitted = await wrap.boundingBox();
    await g.mouse.move(fitted.x + fitted.width / 2, fitted.y + fitted.height / 2);
    const pageY = await g.evaluate(() => scrollY);
    const fitScale = await nav.locator('.vrg-scale').textContent();
    await g.mouse.wheel(0, 200);
    await g.waitForFunction(y => scrollY > y + 20, pageY);
    assert.equal(await nav.locator('.vrg-scale').textContent(), fitScale, 'ordinary wheel chains to page without zoom');
    await nav.locator('[data-vrg-action=reset]').click();
    await wrap.scrollIntoViewIfNeeded();
    const again = await wrap.boundingBox();
    await g.mouse.move(again.x + 10, again.y + 40);
    await g.keyboard.down('Alt'); await g.mouse.wheel(0, -80); await g.keyboard.up('Alt');
    await g.waitForFunction(() => document.querySelector('#vrgSvgWrapNav .vrg-scale').textContent !== '100%');
  });
  await check('UX03 Config Studio same controls, focus, reset and YAML invariant', async () => {
    const yaml = await g.evaluate(doc => jsyaml.dump(doc), graphDoc(12));
    const original = await g.locator('#mihomoOutput').inputValue();
    await g.locator('.tab', { hasText: 'Config Studio' }).click();
    await g.locator('#csImportInput').fill(yaml); await g.locator('#csParseBtn').click();
    await g.locator('#csVrgPanel > summary').click();
    const nav = g.locator('#csVrgSvgWrapNav');
    for (const action of ['fit', 'in', 'out', 'reset']) await nav.locator('[data-vrg-action=' + action + ']').click();
    assert.equal(await nav.locator('.vrg-scale').textContent(), '100%');
    await g.locator('#csVrgSvgWrap g[tabindex]').first().focus(); await g.keyboard.press('Enter');
    assert.ok(await g.evaluate(() => vrgStudioFocus.get(csCurrentDoc)));
    await nav.locator('[data-vrg-action=in]').click();
    assert.ok(await g.evaluate(() => vrgStudioFocus.get(csCurrentDoc)));
    await nav.locator('[data-vrg-action=all]').click();
    assert.equal(await g.evaluate(() => !!vrgStudioFocus.get(csCurrentDoc)), false);
    await nav.locator('[data-vrg-action=reset]').click();
    const wrap = g.locator('#csVrgSvgWrap'); await wrap.scrollIntoViewIfNeeded();
    const box = await wrap.boundingBox();
    await g.mouse.move(box.x + 10, box.y + 150); await g.mouse.down();
    await g.mouse.move(box.x + 10, box.y + 20, { steps: 6 }); await g.mouse.up();
    assert.ok(await wrap.evaluate(el => el.scrollTop > 50));
    assert.equal(await g.locator('#csImportInput').inputValue(), yaml);
    assert.equal(await g.locator('#mihomoOutput').inputValue(), original);
    assert.ok(!(await g.locator('#csVrgSvgWrap').textContent()).includes('secret-graph-token'));
    await nav.locator('[data-vrg-action=fit]').click();
    await screenshot(g, '#csVrgPanel', 'studio-19-fit');
  });
  await check('UX03 mobile 320/360/390 controls fit viewport', async () => {
    for (const width of [320, 360, 390]) {
      await g.setViewportSize({ width, height: 740 });
      await g.locator('#csVrgSvgWrapNav [data-vrg-action=fit]').click();
      assert.equal(await g.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const buttons = await g.locator('#csVrgSvgWrapNav button').evaluateAll(xs => xs.map(x => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
      assert.ok(buttons.every(Boolean));
      if (width === 320) await screenshot(g, '#csVrgPanel', 'studio-mobile-320');
    }
    await g.locator('.tab', { hasText: 'Mihomo Config Builder' }).click();
    await g.locator('#vrgSvgWrapNav [data-vrg-action=fit]').click();
    assert.equal(await g.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  });
  await check('UX03 repeated Parse/Focus and empty/error clear safely', async () => {
    await g.locator('.tab', { hasText: 'Config Studio' }).click();
    for (const count of [1, 50, 100]) {
      const doc = graphDoc(count);
      if (count === 1) { doc['proxy-groups'].pop(); doc.rules = ['MATCH,Primary']; }
      await g.locator('#csImportInput').fill(await g.evaluate(doc => jsyaml.dump(doc), doc));
      await g.locator('#csParseBtn').click();
      await g.locator('#csVrgSvgWrapNav [data-vrg-action=fit]').click();
      assert.equal(await g.locator('#csVrgSvgWrap').evaluate(el => { const svg = el.querySelector('svg').getBoundingClientRect(); return svg.width <= el.clientWidth + 1 && svg.height <= el.clientHeight + 1; }), true);
    }
    for (let i = 0; i < 5; i++) { await g.locator('#csParseBtn').click(); await g.locator('#csVrgSvgWrapNav [data-vrg-action=in]').click(); }
    const scale = await g.locator('#csVrgSvgWrapNav .vrg-scale').textContent();
    const before = Number.parseInt(scale, 10);
    await g.locator('#csVrgSvgWrapNav [data-vrg-action=reset]').click();
    await g.locator('#csVrgSvgWrapNav [data-vrg-action=in]').click();
    assert.equal(await g.locator('#csVrgSvgWrapNav .vrg-scale').textContent(), '125%');
    assert.ok(before > 0);
    const previous = await g.locator('#csVrgSvgWrap').textContent();
    await g.locator('#csImportInput').fill('broken: ['); await g.locator('#csParseBtn').click();
    assert.equal(await g.locator('#csVrgSvgWrap').textContent(), previous);
    assert.match(await g.locator('#csStatus').textContent(), /Предыдущий рабочий документ сохранён/);
    await g.locator('#csClearBtn').click();
    assert.equal(await g.locator('#csVrgSvgWrap svg').count(), 0);
    assert.equal(await g.locator('#csVrgSvgWrapNav button:enabled').count(), 0);
    assert.equal(await g.evaluate(() => vrgNavigation.has(document.getElementById('csVrgSvgWrap'))), false);
  });
  await check('UX10 quick start ends at YAML before engineering sections', async () => {
    const n = await fresh();
    assert.equal(await n.locator('#builderWorkspaceNav a').count(), 5);
    assert.equal(await n.locator('.builder-workspace').count(), 5);
    assert.equal(await n.locator('#ux-start').evaluate(el => el.parentElement.contains(document.getElementById('mihomoOutput'))), true);
    assert.equal(await n.locator('#ux-start').evaluate(el => el.parentElement.contains(document.getElementById('physicalTopologyPanel'))), false);
    assert.equal(await n.evaluate(() => !!(document.getElementById('mihomoOutput').compareDocumentPosition(document.getElementById('ux-routing')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    await n.locator('#cfgPolicyRouting').uncheck();
    await n.locator('#builderWorkspaceNav a[href="#ux-diagnostics"]').click();
    await n.locator('#routingDiagnostics > summary').click();
    assert.equal(await n.locator('#rdTestBtn').isVisible(), true, 'diagnostics independent of DPR enable');
    await n.locator('#rdTestBtn').click(); assert.equal(await n.locator('#rdBuildCheckBtn').isVisible(), true);
  });
  await check('UX10 keyboard workspace navigation preserves project YAML and generation', async () => {
    const n = await fresh(); await n.locator('#mihomoInput').fill(link); await n.locator('#btnPolicyAdd').click();
    await n.locator('#wgFile').setInputFiles(path.join(root, 'tests/fixtures/wg-simple-a.conf'));
    await n.waitForFunction(() => wgProfiles.length === 1); await build(n);
    const snapshot = () => n.evaluate(() => { const project = rbCollectProject(); delete project.meta.created; return {project, yaml:document.getElementById('mihomoOutput').value, fingerprint:buildStateFingerprint(), seq:mihomoValidationSeq}; });
    const before = await snapshot(); let requests = 0; n.on('request', r => { if (/^https?:/.test(r.url())) requests++; });
    for (const [width, height] of [[1280,720],[1366,768],[1920,1080],[320,740],[390,740],[640,360]]) {
      await n.setViewportSize({width,height});
      for (const target of ['routing','diagnostics','lab','options','start']) {
        const a = n.locator('#builderWorkspaceNav a[href="#ux-'+target+'"]'); await a.focus(); await n.keyboard.press('Enter');
        assert.equal(await n.locator('#ux-'+target).evaluate(el => el === document.activeElement), true);
        const box = await n.locator('#ux-'+target).boundingBox(); assert.ok(box.y >= 0 && box.y < height, 'target visible');
      }
      assert.equal(await n.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    }
    assert.deepEqual(await snapshot(), before); assert.equal(requests,0); assert.equal(await n.evaluate(() => diagnosticsCurrent()),true);
    await screenshot(n, '#builderWorkspaceNav', 'workspace-mobile');
  });
  await check('UX10 expert directory reveals tools without enabling options', async () => {
    const n = await fresh(); await n.locator('#cfgPolicyRouting').uncheck();
    await n.locator('#workspaceDirectory > summary').click();
    await n.locator('#workspaceDirectory a[href="#policyRoutingPanel"]').click();
    assert.equal(await n.locator('#cfgPolicyRouting').isChecked(), false);
    assert.equal(await n.locator('#cfgPolicyRouting').evaluate(el => el === document.activeElement), true);
    let requests=0; n.on('request',()=>requests++);
    const before=await n.evaluate(()=>{const p=rbCollectProject();delete p.meta.created;return JSON.stringify(p);});
    await n.locator('#workspaceDirectory a[href="#runtimeImportDetails"]').click();
    assert.equal(await n.locator('#rtUploadBtn').isVisible(),true);
    assert.equal(await n.locator('#cfgServerList').isChecked(),false);
    assert.equal(await n.locator('#runtimeImportDetails > summary').evaluate(el=>el===document.activeElement),true);
    assert.equal(await n.evaluate(()=>{const p=rbCollectProject();delete p.meta.created;return JSON.stringify(p);}),before); assert.equal(requests,0);
    await n.locator('#workspaceDirectory a[href="#physicalTopologyPanel"]').click();
    assert.equal(await n.locator('#ptDemoBtn').isVisible(), true);
    await n.locator('#workspaceDirectory a[href="#perProxyAdvancedDetails"]').click();
    assert.equal(await n.locator('#cfgPerProxyMaster').isVisible(), true);
    assert.equal(await n.locator('#cfgPerProxyMaster').isChecked(), false);
  });
  await check('UX10 quick start downloads exactly the validated YAML', async () => {
    const n = await fresh(); assert.equal(await n.locator('#downloadYamlBtn').count(),1);
    assert.equal(await n.locator('#downloadYamlBtn').isDisabled(),true);
    await n.locator('#mihomoInput').fill(link); await build(n);
    const [download] = await Promise.all([n.waitForEvent('download'),n.locator('#downloadYamlBtn').click()]);
    assert.equal(download.suggestedFilename(),'config.yaml');
    assert.equal(fs.readFileSync(await download.path(),'utf8'),await n.locator('#mihomoOutput').inputValue());
  });
  for (const consumer of ['Builder','Studio']) await check('UX11 expanded graph height Escape and focus '+consumer, async () => {
    const n = await fresh(); await n.setViewportSize({width:1280,height:720});
    let id;
    if (consumer === 'Builder') {
      await n.locator('#mihomoInput').fill(Array.from({length:19},(_,i)=>link.replace('192.0.2.1','192.0.2.'+(i+1)).replace('#Owner-A','#N'+i)).join('\n'));
      await build(n); await n.locator('#routingDiagnostics').evaluate(el=>el.open=true); await n.locator('#vrgPanel').evaluate(el=>el.open=true); id='vrgSvgWrap';
    } else {
      await n.locator('.tab',{hasText:'Config Studio'}).click();
      await n.locator('#csImportInput').fill(await n.evaluate(doc=>jsyaml.dump(doc),graphDoc(100)));
      await n.locator('#csParseBtn').click(); await n.locator('#csVrgPanel').evaluate(el=>el.open=true); id='csVrgSvgWrap';
    }
    const nav=n.locator('#'+id+'Nav'),wrap=n.locator('#'+id),height=nav.locator('input[type=range]'),expand=nav.locator('[data-vrg-action=expand]');
    assert.equal(await expand.count(),1); assert.equal(await height.count(),1);
    const original=await n.locator('#mihomoOutput').inputValue(),source=await n.locator('#csImportInput').inputValue();
    await height.focus(); await n.keyboard.press('Home'); const small=await wrap.evaluate(el=>el.clientHeight);
    await n.keyboard.press('End'); await n.waitForFunction(({id,small})=>document.getElementById(id).clientHeight>small+100,{id,small});
    await nav.locator('[data-vrg-action=fit]').click();
    assert.equal(await wrap.evaluate(el=>{const r=el.querySelector('svg').getBoundingClientRect();return r.width<=el.clientWidth+1&&r.height<=el.clientHeight+1;}),true);
    await nav.locator('[data-vrg-action=reset]').click();
    await wrap.scrollIntoViewIfNeeded(); const normalBox=await wrap.boundingBox();
    const visibleTop=Math.max(normalBox.y+20,160);await n.mouse.move(normalBox.x+10,visibleTop+150);await n.mouse.down();await n.mouse.move(normalBox.x+10,visibleTop,{steps:6});await n.mouse.up();
    const panBefore=await wrap.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));assert.ok(panBefore.top>50);
    const beforeHeight=await wrap.evaluate(el=>el.clientHeight),scale=await nav.locator('.vrg-scale').textContent();
    await expand.click(); const frame=n.locator('.vrg-expanded');
    assert.equal(await frame.count(),1); assert.equal(await frame.getAttribute('role'),'dialog');
    assert.equal(await height.isDisabled(),true); assert.equal(await nav.locator('.vrg-scale').textContent(),scale);
    const box=await frame.boundingBox(); assert.ok(box.width>=1278&&box.height>=718);
    assert.equal(await n.evaluate(()=>document.body.style.overflow),'hidden');
    const expandedBox=await wrap.boundingBox(); await n.mouse.move(expandedBox.x+10,expandedBox.y+180); await n.mouse.down(); await n.mouse.move(expandedBox.x+10,expandedBox.y+20,{steps:6}); await n.mouse.up();
    const expandedPan=await wrap.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop})); assert.ok(expandedPan.top>panBefore.top);
    await n.keyboard.press('Escape');const restored=await wrap.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop,maxLeft:el.scrollWidth-el.clientWidth,maxTop:el.scrollHeight-el.clientHeight}));assert.deepEqual({left:restored.left,top:restored.top},{left:Math.min(expandedPan.left,restored.maxLeft),top:Math.min(expandedPan.top,restored.maxTop)});
    await expand.click();
    await nav.locator('[data-vrg-action=fit]').click();
    await wrap.locator('g[tabindex]').first().focus(); await n.keyboard.press('Enter'); assert.equal(await frame.count(),1,'expanded after node Enter');
    await nav.locator('[data-vrg-action=in]').click(); assert.equal(await frame.count(),1,'expanded after zoom');
    assert.equal(await n.evaluate(consumer=>consumer==='Builder'?!!vrgFocusId:!!vrgStudioFocus.get(csCurrentDoc),consumer),true);
    await nav.locator('[data-vrg-action=all]').click(); assert.equal(await frame.count(),1,'expanded after all'); await nav.locator('[data-vrg-action=fit]').click(); assert.equal(await frame.count(),1,'expanded after fit');
    assert.equal(await wrap.evaluate(el=>{const r=el.querySelector('svg').getBoundingClientRect();return r.width<=el.clientWidth+1&&r.height<=el.clientHeight+1;}),true);
    const last=frame.locator('g[tabindex]').last(); await last.focus(); await n.keyboard.press('Tab');
    assert.equal(await nav.locator('button').first().evaluate(el=>el===document.activeElement),true,'Tab wraps to toolbar');
    await n.keyboard.press('Shift+Tab'); assert.equal(await last.evaluate(el=>el===document.activeElement),true,'Shift Tab wraps to node');
    await screenshot(n,'.vrg-expanded','expanded-'+consumer.toLowerCase());
    await n.keyboard.press('Escape'); assert.equal(await n.locator('.vrg-expanded').count(),0);
    assert.equal(await expand.evaluate(el=>el===document.activeElement),true,'Escape restores expand focus'); assert.equal(await height.isDisabled(),false);
    assert.equal(await wrap.evaluate(el=>el.clientHeight),beforeHeight);
    for (let i=0;i<4;i++){await expand.click();await n.keyboard.press('Escape');}
    for(const width of [320,390]){await n.setViewportSize({width,height:740});await expand.click();await nav.locator('[data-vrg-action=fit]').click();assert.equal(await n.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await wrap.evaluate(el=>{const r=el.querySelector('svg').getBoundingClientRect();return r.width<=el.clientWidth+1&&r.height<=el.clientHeight+1;}),true);await n.keyboard.press('Escape');}
    assert.equal(await n.evaluate(()=>document.body.style.overflow),'');
    assert.equal(await n.locator('#mihomoOutput').inputValue(),original); assert.equal(await n.locator('#csImportInput').inputValue(),source);
    await nav.locator('[data-vrg-action=size-reset]').click();
    if(consumer==='Studio'){await expand.click();await n.evaluate(()=>csClearStudio());assert.equal(await n.locator('.vrg-expanded').count(),0);assert.equal(await n.evaluate(()=>document.body.style.overflow),'');}
  });
  await check('UX12 runtime list long names badges selection and narrow scroll', async () => {
    const n=await fresh(); await n.locator('#workspaceDirectory > summary').click();
    await n.locator('#workspaceDirectory a[href="#runtimeImportDetails"]').click();
    const long='Очень-длинное-имя-🇷🇺-'+ 'LongNode'.repeat(24);
    const runtimeNames=[long,...Array.from({length:45},(_,i)=>'Runtime-'+i)];
    const chooserPromise=n.waitForEvent('filechooser'); await n.locator('#rtUploadBtn').click();
    await (await chooserPromise).setFiles({name:'runtime.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({providers:{LocalFixture:{proxies:runtimeNames.map(name=>({name,type:'Vless',alive:true}))}}}))});
    const list=n.locator('#subscriptionPreviewNames'); assert.equal(await n.locator('#cfgServerList').isChecked(),false); await n.waitForFunction(()=>document.querySelectorAll('#subscriptionPreviewNames .sub-list-item').length===46);
    const before=await n.evaluate(()=>({names:subscriptionListNames,origins:[...serverListNameOrigins],selected:[...subscriptionSelection]}));
    assert.equal(await list.locator('.sub-list-item .hint').count(),46);
    for(const width of [1280,1366,1920,320,390,640]) {
      await n.setViewportSize({width,height:740}); await list.scrollIntoViewIfNeeded();
      const geometry=await list.evaluate(el=>{const r=el.getBoundingClientRect(); const row=el.querySelector('.sub-list-item'),name=row.querySelector('span'),badge=row.querySelector('.hint');return {width:el.clientWidth,scroll:el.scrollWidth,padding:parseFloat(getComputedStyle(el).paddingRight),name:name.getBoundingClientRect().right-r.left,badge:badge.getBoundingClientRect().right-r.left,overflow:el.scrollHeight>el.clientHeight};});
      assert.ok(geometry.padding>=10,'badge needs inner padding'); assert.ok(geometry.scroll<=geometry.width+1,'long name causes horizontal scrolling'); assert.ok(geometry.badge<=geometry.width-8); assert.ok(geometry.name<=geometry.width-8); assert.equal(geometry.overflow,true);
      await list.evaluate(el=>el.scrollTop=el.scrollHeight); await n.waitForFunction(()=>document.getElementById('subscriptionPreviewNames').scrollTop>0);
    }
    assert.deepEqual(await n.evaluate(()=>({names:subscriptionListNames,origins:[...serverListNameOrigins],selected:[...subscriptionSelection]})),before);
    await n.locator('#subListSearch').fill('Runtime-44'); assert.equal(await list.locator('.sub-list-item').count(),1);
    const box=list.locator('input'); await box.check(); assert.equal(await n.evaluate(()=>subscriptionSelection.has('Runtime-44')),true);
    await box.uncheck(); await n.locator('#subListSearch').fill(''); assert.equal(await list.locator('.sub-list-item').count(),46);
    assert.deepEqual(await n.evaluate(()=>[...subscriptionSelection]),before.selected);
    const beforeSize=await n.evaluate(()=>({yaml:document.getElementById('mihomoOutput').value,selected:[...subscriptionSelection],names:subscriptionListNames}));
    await list.evaluate(el=>el.style.height='340px'); assert.equal(await list.evaluate(el=>getComputedStyle(el).resize),'vertical');
    assert.deepEqual(await n.evaluate(()=>({yaml:document.getElementById('mihomoOutput').value,selected:[...subscriptionSelection],names:subscriptionListNames})),beforeSize);
    await n.setViewportSize({width:390,height:740}); await list.evaluate(el=>el.scrollTop=0); await screenshot(n,'#serverListPanel','runtime-list-mobile');
  });
  await check('UX13 AWL and subscription tools precede first Build in Quick Start', async () => {
    const n=await fresh();
    const placement=await n.evaluate(()=>{const ids=['cfgProfile','cfgAutoWhitelist','mihomoInput','cfgServerList','wgFile','wgCustomDns','cfgAwgKeepalive'];return ids.map(id=>({id,workspace:document.getElementById(id).closest('section')?.getAttribute('aria-labelledby')}));});
    assert.equal(placement.every(x=>x.workspace==='ux-start'),true);
    assert.equal(await n.evaluate(()=>!!(document.getElementById('cfgProfile').compareDocumentPosition(document.getElementById('cfgAutoWhitelist'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
    assert.equal(await n.evaluate(()=>!!(document.getElementById('cfgAutoWhitelist').compareDocumentPosition(document.getElementById('mihomoInput'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
    await n.locator('#mihomoInput').fill(link); let requests=0;n.on('request',()=>requests++);
    await n.locator('#cfgAutoWhitelist').check();assert.equal(await n.locator('#whitelistInput').isVisible(),true);
    assert.match(await n.locator('label[for=whitelistInput]').textContent(),/Резервные серверы и подписки/);
    await n.locator('#whitelistInput').fill(link.replace('192.0.2.1','192.0.2.2').replace('#Owner-A','#Reserve'));
    await build(n);const doc=await n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value));
    assert.equal(doc.rules.at(-1),'MATCH,GLOBAL');assert.equal(doc['proxy-groups'].find(g=>g.name==='GLOBAL').type,'fallback');
    assert.equal(requests,0); await screenshot(n,'#ux-start','quick-start-priorities');
  });
  await check('UX14 sticky canonical actions current stale building and error', async () => {
    const n=await fresh();const status=n.locator('#builderActionStatus');assert.equal(await status.count(),1);
    assert.equal(await status.getAttribute('data-state'),'NOT_BUILT'); await n.locator('#mihomoInput').fill(link);await n.locator('#buildConfigBtn').focus();
    assert.equal(await n.evaluate(()=>{window.ownerPendingBuild=buildMihomo();return document.getElementById('builderActionStatus').dataset.state;}),'BUILDING');
    await n.evaluate(()=>window.ownerPendingBuild);await n.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state==='VALID');
    assert.equal(await status.getAttribute('data-state'),'CURRENT');
    await n.locator('#mihomoInput').fill(link+'\n');await n.evaluate(()=>buildMihomo());await n.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state==='VALID');
    await n.locator('#cfgPolicyRouting').uncheck();assert.equal(await n.locator('#cfgPolicyRouting').isChecked(),false);await n.locator('#cfgPolicyRouting').check();await build(n);
    const snapshot=()=>n.evaluate(()=>({yaml:document.getElementById('mihomoOutput').value,seq:mihomoValidationSeq,fingerprint:buildStateFingerprint()}));const before=await snapshot();
    for(const [width,height] of [[1280,720],[1366,768],[1920,1080],[390,740],[320,740]]) {
      await n.setViewportSize({width,height});
      for(const area of ['routing','diagnostics','lab','options','start']) {
        await n.locator('#builderWorkspaceNav a[href="#ux-'+area+'"]').click();
        const bar=await n.locator('#builderActionbar').boundingBox();assert.ok(bar.y>=-1&&bar.y<3);assert.ok(bar.height<height*.3);
        const button=await n.locator('#buildConfigBtn').boundingBox();assert.ok(button.y>=0&&button.y+button.height<height);
        assert.equal(await n.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      }
    }
    assert.deepEqual(await snapshot(),before);
    await n.locator('#mihomoInput').fill(link.replace('#Owner-A','#Renamed'));assert.equal(await status.getAttribute('data-state'),'STALE');
    assert.equal(await n.locator('#copyYamlBtn').isDisabled(),true);assert.equal(await n.locator('#downloadYamlBtn').isDisabled(),true);
    await n.locator('#builderWorkspaceNav a[href="#ux-lab"]').click();await build(n);assert.equal(await status.getAttribute('data-state'),'CURRENT');
    await n.locator('#mihomoInput').fill('invalid://not-a-proxy');await n.locator('#buildConfigBtn').click();assert.equal(await status.getAttribute('data-state'),'ERROR');
    assert.equal(await n.locator('#downloadYamlBtn').isDisabled(),true);
    const duplicateIds=await n.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);return ids.filter((id,i)=>ids.indexOf(id)!==i);});assert.deepEqual(duplicateIds,[]);
    await screenshot(n,'#builderActionbar','sticky-actions-mobile');
  });
  await check('UX15 policy SELECT names explain independent groups and preserve references', async () => {
    const n=await fresh();await n.locator('#mihomoInput').fill(link);
    await n.locator('#btnPolicyAdd').click();await n.locator('#btnPolicyAdd').click();
    const cards=n.locator('#policyCards .policy-card');assert.match(await cards.first().locator('.policy-name-help').textContent(),/имя SELECT-группы Mihomo/);
    await cards.nth(0).locator('.policy-name').fill('AI');await cards.nth(0).locator('.policy-domains').fill('a.example');
    await cards.nth(1).locator('.policy-name').fill('YouTube');await cards.nth(1).locator('.policy-domains').fill('video.example');await build(n);
    const doc=()=>n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value));let d=await doc();
    assert.ok(d['proxy-groups'].some(g=>g.name==='AI'&&g.type==='select'));assert.ok(d['proxy-groups'].some(g=>g.name==='YouTube'&&g.type==='select'));
    await cards.nth(0).locator('.policy-name').fill('Research');await build(n);d=await doc();assert.ok(d.rules.some(r=>r.startsWith('RULE-SET,')&&r.endsWith(',Research')));assert.equal(d['proxy-groups'].some(g=>g.name==='AI'),false);
    const project=await n.evaluate(()=>rbCollectProject());await n.evaluate(p=>rbApplyProject(p),project);await build(n);assert.deepEqual(await doc(),d);
    await cards.nth(1).locator('.policy-name').fill('Research');await n.locator('#buildConfigBtn').click();assert.notEqual(await n.evaluate(()=>MIHOMO_VALIDATION_STATE.state),'VALID');
  });
  await check('UX16 WG and Web UI settings remain near their inputs with retained values', async () => {
    const n=await fresh();assert.equal(await n.locator('#webUiRow').evaluate(el=>el.closest('section').getAttribute('aria-labelledby')),'ux-start');
    await n.locator('#webUiSelect').selectOption('custom');await n.locator('#webUiCustomUrl').fill('https://example.invalid/dashboard.zip');
    await n.locator('#cfgWebUI').uncheck();assert.equal(await n.locator('#webUiSelect').isVisible(),true);assert.equal(await n.locator('#webUiSelect').isDisabled(),true);assert.equal(await n.locator('#webUiCustomUrl').inputValue(),'https://example.invalid/dashboard.zip');
    await n.locator('#cfgWebUI').check();assert.equal(await n.locator('#webUiSelect').isDisabled(),false);
    assert.equal(await n.locator('#wgCustomDns').evaluate(el=>el.closest('.card')===document.getElementById('wgFile').closest('.card')),true);
    assert.equal(await n.locator('#cfgAwgRtDiag').evaluate(el=>!!el.closest('#awgDiagnosticDetails')),true);
    await n.locator('#wgFile').setInputFiles(path.join(root,'tests/fixtures/wg-simple-a.conf'));await n.waitForFunction(()=>wgProfiles.length===1);
    await n.locator('#wgCustomDns').fill('1.1.1.1');const snapshot=await n.evaluate(()=>rbCollectProject());await n.evaluate(p=>rbApplyProject(p),snapshot);
    assert.equal(await n.locator('#wgCustomDns').inputValue(),'1.1.1.1');assert.equal(await n.locator('#webUiCustomUrl').inputValue(),'https://example.invalid/dashboard.zip');
  });
  await check('UX17 priority group display avoids ladder glyph without changing YAML names', async () => {
    const n=await fresh();assert.match(await n.locator('#cfgTieredFailover').locator('..').textContent(),/Приоритетные группы серверов/);
    await n.locator('#mihomoInput').fill(link);await n.locator('#cfgTieredFailover').check();
    await n.evaluate(()=>{window.__tierCardsState=[{name:'Main',strategy:'fallback',members:['Owner-A']}];renderTierCards();});await build(n);
    const yaml=await n.locator('#mihomoOutput').inputValue();assert.match(yaml,/🪜 TIERED-AUTO/);
    await n.locator('#routingDiagnostics').evaluate(el=>el.open=true);assert.doesNotMatch(await n.locator('#rdPreview').textContent(),/🪜/);
    await n.locator('#vrgPanel').evaluate(el=>el.open=true);assert.doesNotMatch(await n.locator('#vrgSvgWrap svg').textContent(),/🪜/);
    await n.locator('#rdTestBtn').click();assert.doesNotMatch(await n.locator('#rdResult').textContent(),/🪜/);assert.equal(await n.locator('#mihomoOutput').inputValue(),yaml);
  });
  const ownerProject = n=>n.evaluate(()=>{const p=rbCollectProject();delete p.meta.created;return p;});
  await check('UX18 AWL activation confirms conflicts and preserves priority cards', async () => {
    const n=await fresh();await n.locator('#mihomoInput').fill(link);
    await n.evaluate(()=>{window.__tierCardsState=[{name:'Personal VPS',strategy:'fallback',members:['Owner-A']}];document.getElementById('cfgTieredFailover').checked=true;renderTierCards();});
    await build(n);const project=await ownerProject(n);const validation=await n.evaluate(()=>({seq:mihomoValidationSeq,status:document.getElementById('builderActionStatus').dataset.state,yaml:document.getElementById('mihomoOutput').value}));
    n.once('dialog',d=>d.dismiss());await n.locator('#cfgAutoWhitelist').click();
    assert.deepEqual(await ownerProject(n),project,'cancel leaves complete configuration unchanged');assert.deepEqual(await n.evaluate(()=>({seq:mihomoValidationSeq,status:document.getElementById('builderActionStatus').dataset.state,yaml:document.getElementById('mihomoOutput').value})),validation,'cancel retains current validation and YAML');
    n.once('dialog',d=>d.accept());await n.locator('#cfgAutoWhitelist').click();
    assert.equal(await n.locator('#cfgTieredFailover').isChecked(),false);assert.equal(await n.locator('#cfgTieredFailover').isDisabled(),true);
    assert.equal(await n.locator('#cfgPerProxyMaster').isDisabled(),true);assert.equal(await n.locator('#cfgPolicyRouting').isDisabled(),false);
    assert.match(await n.locator('#tieredAwlHint').textContent(),/Недоступно/);
    const tiers=await n.evaluate(()=>rbCollectProject().tiered.cards);assert.deepEqual(tiers,project.tiered.cards);
    await n.locator('#cfgPolicyRouting').focus();await n.locator('#cfgTieredFailover').evaluate(el=>el.focus());assert.notEqual(await n.evaluate(()=>document.activeElement.id),'cfgTieredFailover');const box=await n.locator('#cfgTieredFailover').boundingBox();await n.mouse.click(box.x+box.width/2,box.y+box.height/2);assert.equal(await n.locator('#cfgTieredFailover').isChecked(),false);
    await n.locator('#whitelistInput').fill(link.replace('192.0.2.1','192.0.2.2').replace('#Owner-A','#Reserve'));await build(n);
    let doc=await n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value));assert.equal(doc.rules.at(-1),'MATCH,GLOBAL');assert.equal(doc['proxy-groups'].some(g=>g.name==='🪜 TIERED-AUTO'),false);
    await n.locator('#cfgAutoWhitelist').uncheck();assert.equal(await n.locator('#cfgTieredFailover').isDisabled(),false);assert.equal(await n.locator('#cfgTieredFailover').isChecked(),false);assert.deepEqual(await n.evaluate(()=>rbCollectProject().tiered.cards),tiers);
    await n.locator('#cfgTieredFailover').check();assert.equal(await n.locator('.tier-up').first().isDisabled(),true);assert.equal(await n.locator('.tier-down').last().isDisabled(),true);await build(n);doc=await n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value));assert.equal(doc.rules.at(-1),'MATCH,🪜 TIERED-AUTO');
    await n.locator('#cfgTieredFailover').uncheck();await n.evaluate(()=>document.getElementById('perProxyAdvancedDetails').open=true);await n.locator('#cfgPerProxyMaster').check();await n.locator('#cfgPerProxyTun').check();const per=await ownerProject(n);n.once('dialog',d=>d.dismiss());await n.locator('#cfgAutoWhitelist').click();assert.deepEqual(await ownerProject(n),per);n.once('dialog',d=>d.accept());await n.locator('#cfgAutoWhitelist').click();for(const id of ['cfgPerProxyMaster','cfgPerProxyTun','cfgPerProxySocks'])assert.equal(await n.locator('#'+id).isChecked(),false);assert.deepEqual((await ownerProject(n)).tiered.cards,tiers);
  });
  await check('UX18 old project conflict admission is atomic for Load Undo and Restore', async () => {
    const n=await fresh();await n.locator('#mihomoInput').fill(link);const before=await ownerProject(n);
    const old=JSON.parse(JSON.stringify(before));old.sources.autoWhitelist=true;old.sources.fallbackInput=link.replace('#Owner-A','#Reserve');old.tiered={enabled:true,cards:[{name:'Keep me',strategy:'fallback',members:['Owner-A']}]};old.options.perProxyMaster=true;old.options.perProxyTun=true;
    n.once('dialog',d=>d.dismiss());const rejected=await n.evaluate(p=>{try{rbApplyProject(p);return false;}catch(e){return /не изменён/.test(e.message);}},old);assert.equal(rejected,true);assert.deepEqual(await ownerProject(n),before);
    n.once('dialog',d=>d.accept());await n.evaluate(p=>rbApplyProject(p),old);
    const loaded=await ownerProject(n);assert.equal(loaded.sources.autoWhitelist,true);assert.equal(loaded.tiered.enabled,false);assert.equal(loaded.options.perProxyMaster,false);assert.equal(loaded.options.perProxyTun,false);assert.deepEqual(loaded.tiered.cards,old.tiered.cards);
    await build(n);assert.equal(await n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value).rules.at(-1)),'MATCH,GLOBAL');
    await n.evaluate(p=>rbApplyProject(p),loaded);assert.deepEqual(await ownerProject(n),loaded);
    const vps=JSON.parse(JSON.stringify(loaded));vps.options.profile='vps-local';assert.equal(await n.evaluate(p=>{try{rbApplyProject(p);return false;}catch(e){return /только в профиле/.test(e.message);}},vps),true);assert.deepEqual(await ownerProject(n),loaded);
    // Exercise the actual callers, including keeping Undo/pending Restore on cancel.
    await n.evaluate(p=>{rbUndoProjectState=p;},old);
    n.once('dialog',d=>d.dismiss());await n.evaluate(()=>rbUndoRestore());assert.deepEqual(await ownerProject(n),loaded);assert.equal(await n.evaluate(()=>!!rbUndoProjectState),true);
    n.once('dialog',d=>d.accept());await n.evaluate(()=>rbUndoRestore());assert.equal(await n.evaluate(()=>rbUndoProjectState),null);assert.deepEqual((await ownerProject(n)).tiered.cards,old.tiered.cards);
    const loadDialog=d=>d.message().startsWith('Предпросмотр')?d.accept():d.dismiss();n.on('dialog',loadDialog);
    await n.evaluate(p=>rbLoadProject(new File([JSON.stringify(p)],'old.lgproject.json',{type:'application/json'})),old);n.off('dialog',loadDialog);assert.deepEqual(await ownerProject(n),loaded);
    const accept=d=>d.accept();n.on('dialog',accept);await n.evaluate(p=>rbLoadProject(new File([JSON.stringify(p)],'old.lgproject.json')),old);n.off('dialog',accept);assert.deepEqual(await ownerProject(n),loaded);
    await n.evaluate(p=>{rbPendingRestore={project:p,findings:[],source:document.getElementById('csImportInput').value,builder:rbProjectFingerprint(rbCollectProject())};},old);
    n.once('dialog',d=>d.dismiss());await n.evaluate(()=>rbConfirmRestore());assert.equal(await n.evaluate(()=>!!rbPendingRestore),true);assert.deepEqual(await ownerProject(n),loaded);
    n.once('dialog',d=>d.accept());await n.evaluate(()=>rbConfirmRestore());assert.equal(await n.evaluate(()=>rbPendingRestore),null);assert.deepEqual(await ownerProject(n),loaded);

  });
  await check('UX18 Build and postprocessor reject DOM bypass without publishing YAML', async () => {
    const n=await fresh();await n.locator('#mihomoInput').fill(link);await build(n);const yaml=await n.locator('#mihomoOutput').inputValue();
    for(const id of ['cfgTieredFailover','cfgPerProxyMaster','cfgPerProxyTun','cfgPerProxySocks']) {
      await n.evaluate(id=>{for(const x of ['cfgTieredFailover','cfgPerProxyMaster','cfgPerProxyTun','cfgPerProxySocks'])document.getElementById(x).checked=x===id;document.getElementById('cfgAutoWhitelist').checked=true;},id);
      assert.equal(await n.evaluate(()=>{const orig=URL.createObjectURL;let called=false;URL.createObjectURL=()=>{called=true;throw Error('unexpected export');};try{rbSaveProject();return !called;}finally{URL.createObjectURL=orig;}}),true);
      await n.evaluate(()=>buildMihomo());assert.equal(await n.locator('#builderActionStatus').getAttribute('data-state'),'ERROR');assert.equal(await n.locator('#mihomoOutput').inputValue(),yaml);assert.equal(await n.locator('#copyYamlBtn').isDisabled(),true);
    }
    assert.equal(await n.evaluate(yaml=>{try{applyTieredFailover(yaml,[{name:'X',strategy:'fallback',members:['Owner-A']}]);return false;}catch(e){return /несовместимы/.test(e.message);}},yaml),true);
    assert.equal(await n.evaluate(()=>{document.getElementById('cfgAutoWhitelist').checked=false;const y=jsyaml.dump({'proxy-groups':[{name:'GLOBAL',type:'fallback',filter:'^(PRIMARY-|primary-)`^(FALLBACK-|fallback-)',proxies:['Owner-A']}],rules:['MATCH,GLOBAL']});try{applyTieredFailover(y,[]);return false;}catch(e){return /AWL YAML/.test(e.message);}}),true);
  });
  await check('UX18 AWL DPR SELECT and URL subscriptions remain compatible in both modes', async () => {
    for(const subMode of [false,true]) {
      const n=await fresh();await n.locator('#cfgSubMode').setChecked(subMode);await n.locator('#cfgAutoWhitelist').check();
      await n.route('https://primary.example.invalid/sub',r=>r.fulfill({body:link}));await n.route('https://reserve.example.invalid/sub',r=>r.fulfill({body:link.replace('192.0.2.1','192.0.2.2').replace('#Owner-A','#Reserve')}));
      await n.locator('#mihomoInput').fill('https://primary.example.invalid/sub');await n.locator('#whitelistInput').fill('https://reserve.example.invalid/sub');
      await n.locator('#btnPolicyAdd').click();const c=n.locator('#policyCards .policy-card').last();await c.locator('.policy-name').fill('AI');await c.locator('.policy-domains').fill('ai.example');await build(n);
      const d=await n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value));const group=d['proxy-groups'].find(g=>g.name==='AI');assert.equal(group.type,'select');assert.deepEqual(group.proxies,['GLOBAL','DIRECT']);assert.ok(d.rules.some(r=>r.startsWith('RULE-SET,')&&r.endsWith(',AI')));assert.equal(d.rules.at(-1),'MATCH,GLOBAL');
    }
    const n=await fresh();await n.locator('#cfgAutoWhitelist').check();await n.locator('#mihomoInput').fill(link);await n.locator('#whitelistInput').fill(link.replace('#Owner-A','#Reserve'));
    await n.locator('#mtImportBtn').click();await n.locator('#mtImportFile').setInputFiles(path.join(root,'tests/fixtures/magitrickle-basic.mtrickle'));await n.waitForFunction(()=>mtPending!==null);await n.locator('#mtImportApply').click();
    const cards=n.locator('#policyCards .policy-card');assert.equal(await cards.count(),2);for(let i=0;i<2;i++){await cards.nth(i).locator('.policy-target').selectOption('SELECT');await cards.nth(i).locator('.policy-name').fill(i?'Imported Video':'Imported AI');}
    await build(n);let imported=await n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value));for(const name of ['Imported AI','Imported Video'])assert.deepEqual(imported['proxy-groups'].find(g=>g.name===name).proxies,['GLOBAL','DIRECT']);
    await cards.first().locator('.policy-name').fill('Renamed AI');await build(n);imported=await n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value));assert.equal(imported['proxy-groups'].some(g=>g.name==='Imported AI'),false);assert.ok(imported.rules.some(r=>r.startsWith('RULE-SET,')&&r.endsWith(',Renamed AI')));
    const p=await ownerProject(n);await n.evaluate(p=>rbApplyProject(p),p);await build(n);assert.deepEqual(await n.evaluate(()=>jsyaml.load(document.getElementById('mihomoOutput').value)),imported);
  });
  await check('UX18 neutral defaults apply only to new priority cards', async () => {
    const n=await fresh();await n.locator('#cfgTieredFailover').check();assert.deepEqual(await n.evaluate(()=>readTierCards().map(t=>t.name)),['Приоритет 1']);
    const p=await ownerProject(n);p.tiered.cards[0].name='WARP';await n.evaluate(p=>rbApplyProject(p),p);assert.equal(await n.locator('.tier-name').first().inputValue(),'WARP');
  });
  await check('UX18 profile return resolves AWL priority conflict before mutation', async () => {
    const n=await fresh();await n.locator('#cfgAutoWhitelist').check();await n.locator('#cfgProfile').selectOption('vps-local');await n.locator('#cfgTieredFailover').check();const before=await ownerProject(n);
    await n.evaluate(()=>{const original=refreshWgTargetSelectors;window.ownerProfileRefreshCount=0;refreshWgTargetSelectors=(...args)=>{ownerProfileRefreshCount++;return original(...args);};});
    n.once('dialog',d=>d.dismiss());await n.locator('#cfgProfile').selectOption('router');assert.deepEqual(await ownerProject(n),before);assert.equal(await n.evaluate(()=>ownerProfileRefreshCount),0,'no registry mutation before profile admission');
    n.once('dialog',d=>d.accept());await n.locator('#cfgProfile').selectOption('router');assert.equal(await n.locator('#cfgAutoWhitelist').isChecked(),true);assert.equal(await n.locator('#cfgTieredFailover').isChecked(),false);
  });

  await check('P2 Studio redacts original ladder-prefixed secret before display formatting', async () => {
    const n = await fresh();
    await n.locator('.tab', { hasText: 'Config Studio' }).click();
    const secret = '🪜 synthetic-owner-secret-236';
    const yaml = ['secret: "' + secret + '"', 'proxies: []', 'proxy-groups:',
      '  - name: "' + secret + '"', '    type: select', '    proxies: [DIRECT]',
      'rules:', '  - "MATCH,' + secret + '"'].join('\n');
    await n.locator('#csImportInput').fill(yaml);
    await n.locator('#csParseBtn').click();
    assert.match(await n.locator('#csStatus').textContent(), /✓ Разобрано/);
    await n.locator('#csRoutingPanel > summary').click();
    await n.locator('#csRuleProbe').fill('unmatched.example.invalid');
    await n.locator('#csRuleProbeBtn').click();
    const output = await n.locator('#csRuleProbeOut').textContent();
    assert.match(output, /Fallback:[\s\S]*MATCH →/);
    assert.ok(!output.includes(secret), 'original secret leaked');
    assert.ok(!output.includes(secret.replace('🪜 ', '[Приоритет] ')), 'formatted secret leaked');
    assert.ok(!output.includes('synthetic-owner-secret-236'), 'secret suffix leaked');
    // A non-secret tier name still receives cosmetic formatting, without editing YAML.
    await n.locator('#csImportInput').fill(yaml.replaceAll(secret, '🪜 Public tier').replace('secret: "🪜 Public tier"', 'secret: "other-synthetic-secret"'));
    await n.locator('#csParseBtn').click();
    await n.locator('#csRuleProbe').fill('unmatched.example.invalid');
    await n.locator('#csRuleProbeBtn').click();
    assert.match(await n.locator('#csRuleProbeOut').textContent(), /MATCH → \[Приоритет\] Public tier/);
    assert.ok((await n.locator('#csImportInput').inputValue()).includes('MATCH,🪜 Public tier'));
  });
  await check('P2 Quick Start new sections stay inside wrap at desktop and mobile widths', async () => {
    const n = await browser.newPage(); pages.push(n); n.errors = [];
    n.on('pageerror', e => n.errors.push(e.message));
    await n.route('https://**', r => r.abort());
    await n.goto(pathToFileURL(path.join(root, 'quick-start.html')).href);
    for (const width of [1920, 1280, 390, 320]) {
      await n.setViewportSize({ width, height: 850 });
      for (const title of ['Owner UX 2.1', 'Совместимость приоритетов']) {
        const heading = n.getByRole('heading', { name: title, exact: true });
        assert.equal(await heading.evaluate(el => !!el.closest('.wrap')), true, title + ': outside wrap');
        await heading.scrollIntoViewIfNeeded();
        assert.equal(await heading.isVisible(), true);
        const layout = await heading.evaluate(el => {
          const section = el.parentElement.getBoundingClientRect(), wrap = el.closest('.wrap').getBoundingClientRect();
          return { contained: section.left >= wrap.left && section.right <= wrap.right,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(layout.contained, true, title + ': outside panel bounds at ' + width);
        assert.equal(layout.overflow, false, 'horizontal overflow at ' + width);
      }
      await screenshot(n, '.wrap', 'quick-start-p2-' + width);
    }
  });

  await check('UX19 field AWG keepalive diagnostics agree with actual YAML ON and OFF', async () => {
    const n = await fresh();
    for (const fixture of ['awg31.conf', 'awg-keepalive-30.conf', 'awg-no-keepalive.conf']) {
      for (const keep of [true, false]) {
        await n.evaluate(()=>{clearWgProfiles();document.getElementById('wgFile').value='';});
        await n.locator('#cfgAwgKeepalive').setChecked(keep);
        await n.locator('#wgFile').setInputFiles(path.join(root, 'tests/fixtures', fixture));
        await n.waitForFunction(() => !wgUploadPending && wgProfiles.length === 1);
        const bean = await n.evaluate(() => wgProfiles[0].bean.wireguard);
        const notes = await n.locator('#wgList .wg-mtu-note').allTextContents();
        if (fixture === 'awg31.conf' && keep) {
          assert.equal(notes.filter(t => /25-35|AWG keepalive:/.test(t)).length, 1, 'duplicate range conversion warning');
          assert.match(notes.join('\n'), /AWG keepalive: 25-35 → 25 секунд/);
        }
        await build(n);
        const proxy = await n.evaluate(() => jsyaml.load(document.getElementById('mihomoOutput').value).proxies.find(p=>p.type==='wireguard'));
        assert.equal(proxy['persistent-keepalive'], Number.isFinite(bean.persistentKeepalive) ? bean.persistentKeepalive : keep ? 25 : undefined);
        const actual=await n.locator('.wg-keepalive-actual').textContent();assert.match(actual,proxy['persistent-keepalive']===undefined ? /отсутствует/ : new RegExp('persistent-keepalive: '+proxy['persistent-keepalive']+' секунд'));
        if (!keep && !Number.isFinite(bean.persistentKeepalive)) assert.ok(!notes.some(t => /получит.*25|→ 25 секунд/.test(t)));
      }
    }
  });
  await check('UX20 field RandomTrailers explains config experiment with warning outside disclosure', async () => {
    const n=await fresh();
    assert.match(await n.locator('#awgDiagnosticDetails > summary').textContent(), /Диагностика обрывов AmneziaWG 3.x/);
    assert.match(await n.locator('#awgDiagnosticIntro').textContent(), /автоматический сетевой тест не выполняется/);
    await n.locator('#awgDiagnosticDetails > summary').click();
    assert.match(await n.locator('#awgDiagnosticDetails').textContent(), /обфускаци[\s\S]*сравните стабильность/);
    await n.locator('#cfgAwgRtDiag').check();await n.locator('#awgDiagnosticDetails > summary').click();
    assert.equal(await n.locator('#awgRtDiagWarn').isVisible(),true);
  });
  await check('UX21 field one fresh priority card and incremental names preserve saved names', async () => {
    const n=await fresh(); await n.locator('#cfgTieredFailover').check();
    assert.deepEqual(await n.evaluate(()=>readTierCards().map(c=>c.name)),['Приоритет 1']);
    await n.locator('#btnTierAdd').click();await n.locator('#btnTierAdd').click();
    assert.deepEqual(await n.evaluate(()=>readTierCards().map(c=>c.name)),['Приоритет 1','Приоритет 2','Приоритет 3']);
    await n.locator('.tier-name').first().fill('Cloudflare WARP/MASQUE');
    const saved=await ownerProject(n);await n.evaluate(p=>rbApplyProject(p),saved);
    assert.equal(await n.locator('.tier-name').first().inputValue(),'Cloudflare WARP/MASQUE');
    assert.match(await n.locator('#tieredPanel').textContent(),/Между группами[\s\S]*Внутри группы[\s\S]*не физическая/);
  });
  await check('UX22 field empty coverage uses examples and entered coverage stays local and stale', async () => {
    const n=await fresh();await n.locator('#mihomoInput').fill(link);await build(n);
    await n.locator('#routingDiagnostics').evaluate(d=>d.open=true);await n.locator('#domainCoveragePanel').evaluate(d=>d.open=true);
    const yaml=await n.locator('#mihomoOutput').inputValue();const seq=await n.evaluate(()=>mihomoValidationSeq);
    await n.locator('#dcRunBtn').click();let output=await n.locator('#dcResults').textContent();
    assert.match(output,/Проверены демонстрационные домены/);for(const name of ['gemini.google.com','youtube.com','unknown-service.example'])assert.ok(output.includes(name));
    assert.equal(await n.locator('#dcInput').inputValue(),'');await n.locator('#dcExamplesBtn').click();assert.match(await n.locator('#dcInput').inputValue(),/gemini.google.com/);
    await n.locator('#dcInput').fill('only.example.invalid');await n.locator('#dcRunBtn').click();output=await n.locator('#dcResults').textContent();assert.match(output,/Проверены введённые домены/);assert.ok(!output.includes('youtube.com'));
    assert.equal(await n.evaluate(()=>mihomoValidationSeq),seq);assert.equal(await n.locator('#mihomoOutput').inputValue(),yaml);
    await n.locator('#mihomoInput').fill(link+'\n# changed');await n.locator('#dcRunBtn').click();assert.match(await n.locator('#dcResults').textContent(),/предыдущая сборка не актуальна/);
  });
  for(const consumer of ['Builder','Studio']) await check('UX23 field graph height reaches 900 and survives resize '+consumer, async()=>{
    const n=await fresh();await n.setViewportSize({width:1280,height:720});await n.locator('#mihomoInput').fill(link);await build(n);
    let wrap=n.locator('#vrgSvgWrap');
    if(consumer==='Builder'){await n.locator('#routingDiagnostics').evaluate(d=>d.open=true);await n.locator('#vrgPanel').evaluate(d=>d.open=true);}
    else{const yaml=await n.locator('#mihomoOutput').inputValue();await n.locator('.tab',{hasText:'Config Studio'}).click();await n.locator('#csImportInput').fill(yaml);await n.locator('#csParseBtn').click();await n.locator('#csVrgPanel').evaluate(d=>d.open=true);wrap=n.locator('#csVrgSvgWrap');}
    const nav=n.locator('#'+await wrap.getAttribute('id')+'Nav');const slider=nav.locator('input[type=range]');
    for(const height of [900,120,650,900]){await slider.evaluate((el,h)=>{el.value=h;el.dispatchEvent(new Event('input',{bubbles:true}));},height);await n.waitForTimeout(40);assert.ok(Math.abs(await wrap.evaluate(el=>el.getBoundingClientRect().height)-height)<=2);assert.match(await nav.locator('.vrg-height-pixels').textContent(),new RegExp(height+' px'));}
    await n.setViewportSize({width:390,height:740});assert.ok(await wrap.evaluate(el=>el.getBoundingClientRect().height)>=899);
    await nav.locator('[data-vrg-action=fit]').click();await nav.locator('[data-vrg-action=reset]').click();assert.equal(await nav.locator('.vrg-scale').textContent(),'100%');
    await nav.locator('[data-vrg-action=expand]').click();await n.keyboard.press('Escape');assert.ok(await wrap.evaluate(el=>el.getBoundingClientRect().height)>=899);
    await nav.locator('[data-vrg-action=size-reset]').click();assert.ok(await wrap.evaluate(el=>el.getBoundingClientRect().height)<900);
  });
  await check('UX24 field physical laboratory has guided demo and honest capability boundaries',async()=>{
    const n=await fresh();await n.locator('#physicalTopologyPanel').evaluate(d=>d.open=true);
    assert.match(await n.locator('#physicalTopologyPanel > summary').textContent(),/Межсерверная цепочка/);
    const text=await n.locator('#physicalTopologyPanel').textContent();assert.match(text,/Не подключается к серверам/);assert.match(text,/SS, SOCKS и HTTP/);assert.match(text,/SSH deployment отсутствуют/);
    await n.locator('#ptDemoBtn').click();await n.locator('#ptAnalyzeBtn').click();assert.equal(await n.locator('#ptGraphBox').isVisible(),true);
  });
  await check('UX25 field REALITY jump opens ancestors and focuses single selective field',async()=>{
    const n=await fresh();await n.locator('#realityModernJump').click();
    assert.equal(await n.locator('#realityModernInput').count(),1);assert.equal(await n.locator('#realityModernInput').evaluate(el=>el===document.activeElement),true);
    assert.match(await n.locator('#realityModernRow').textContent(),/Совместимость с новым REALITY/);
    assert.equal(await n.locator('#realityModernInput').getAttribute('rows'),'3');
  });
  await check('UX26 field STALE explains disabled export and rebuild uses canonical Build',async()=>{
    const n=await fresh();await n.locator('#mihomoInput').fill(link);await build(n);await n.locator('#mihomoInput').fill(link+'\n# changed');
    assert.match(await n.locator('#builderActionStatus').textContent(),/Конфигурация требует пересборки/);assert.equal(await n.locator('#copyYamlBtn').isDisabled(),true);assert.equal(await n.locator('#builderRebuildBtn').isVisible(),true);
    await n.locator('#builderRebuildBtn').click();await n.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state==='VALID');assert.equal(await n.locator('#builderRebuildBtn').isVisible(),false);
  });
  await check('UX27 field AWL priorities derive from YAML in both consumers without invented nodes',async()=>{
    const n=await fresh();await n.locator('#mihomoInput').fill(link);await n.locator('#cfgAutoWhitelist').check();await n.locator('#whitelistInput').fill(link.replace('Owner-A','Owner-B'));await build(n);
    await n.locator('#routingDiagnostics').evaluate(d=>d.open=true);await n.locator('#vrgPanel').evaluate(d=>d.open=true);
    const yaml=await n.locator('#mihomoOutput').inputValue();const view=n.locator('#vrgSvgWrapAwlView');assert.equal(await view.isVisible(),true);assert.match(await view.textContent(),/ПРИОРИТЕТ 1: PRIMARY[\s\S]*ПРИОРИТЕТ 2: FALLBACK/);
    await view.getByRole('button',{name:'Все зависимости',exact:true}).click();assert.equal(await n.locator('#vrgSvgWrap svg').isVisible(),true);await n.locator('#vrgSvgWrapNav [data-vrg-action=all]').click();assert.equal(await n.locator('#vrgSvgWrap svg').isVisible(),true);await view.getByRole('button',{name:'Приоритеты',exact:true}).click();
    await n.locator('.tab',{hasText:'Config Studio'}).click();await n.locator('#csImportInput').fill(yaml);await n.locator('#csParseBtn').click();await n.locator('#csVrgPanel').evaluate(d=>d.open=true);assert.equal(await n.locator('#csVrgSvgWrapAwlView').isVisible(),true);
    const plain=yaml.replace('^(PRIMARY-|primary-)`^(FALLBACK-|fallback-)','^other');await n.locator('#csImportInput').fill(plain);await n.locator('#csParseBtn').click();assert.equal(await n.locator('#csVrgSvgWrapAwlView').count(),0);
    assert.equal(await n.locator('#mihomoOutput').inputValue(),yaml);
  });
  await check('UX28 field AWL disabled tiers collapse but allow inspection and help without editing',async()=>{
    const n=await fresh();await n.locator('#cfgTieredFailover').check();await n.locator('.tier-name').first().fill('Personal saved');n.once('dialog',d=>d.accept());await n.locator('#cfgAutoWhitelist').check();
    assert.equal(await n.locator('#tieredPanel').evaluate(d=>d.tagName==='DETAILS'&&!d.open),true);assert.match(await n.locator('#tieredSavedSummary').textContent(),/Сохранено 1/);
    await n.locator('#tieredSavedSummary').click();assert.equal(await n.locator('.tier-name').isDisabled(),true);assert.equal(await n.locator('#btnTierAdd').isDisabled(),true);await n.locator('#tieredSavedSummary').click();
    await n.locator('#perProxyAdvancedDetails > summary').click();assert.equal(await n.locator('#cfgPerProxyMaster').isDisabled(),true);
    await n.locator('#cfgAutoWhitelist').uncheck();assert.equal(await n.locator('#cfgTieredFailover').isChecked(),false);await n.locator('#cfgTieredFailover').check();assert.equal(await n.locator('.tier-name').inputValue(),'Personal saved');assert.equal(await n.locator('.tier-name').isDisabled(),false);
  });
  await check('UX29 field reset cancellation is atomic and confirmation clears all project owners only',async()=>{
    const n=await fresh();await n.locator('#mihomoInput').fill(link);await build(n);
    await n.locator('.tab',{hasText:'Config Studio'}).click();
    await n.locator('#csImportInput').fill('secret: synthetic-studio-only\nrules: ["MATCH,DIRECT"]');
    await n.locator('#csParseBtn').click();
    await n.locator('.tab',{hasText:'Mihomo Config Builder'}).click();
    const before=await ownerProject(n);const yaml=await n.locator('#mihomoOutput').inputValue();
    n.once('dialog',d=>d.dismiss());await n.locator('#builderResetBtn').click();assert.deepEqual(await ownerProject(n),before);assert.equal(await n.locator('#mihomoOutput').inputValue(),yaml);
    const storage=await n.evaluate(()=>JSON.stringify(localStorage));let requests=0;n.on('request',r=>{if(/^https?:/.test(r.url()))requests++;});
    const variants=['empty','sources','wg','awl','tiers','dpr','options','built','stale','load','repeat'];
    for(const variant of variants){
      await n.evaluate(({variant,link})=>{
        const p=JSON.parse(RB_NEW_PROJECT);
        if(variant!=='empty'){p.sources.mainInput=link;p.sources.subMode=false;}
        if(variant==='sources'){p.sources.subMode=true;p.sources.mainInput='https://subscriptions.example.invalid/private?token=synthetic-only';}
        if(variant==='wg'){const raw='[Interface]\nPrivateKey = AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=\nEndpoint = 192.0.2.2:51820\nAllowedIPs = 0.0.0.0/0';p.wgProfiles=[{id:1,filename:'synthetic.conf',bean:web4core.parseWireGuardConf(raw,'synthetic.conf'),mode:'direct',target:''}];}
        if(variant==='awl'){p.sources.autoWhitelist=true;p.sources.fallbackInput=link.replace('Owner-A','Owner-B');}
        if(variant==='tiers'){p.tiered={enabled:true,cards:[{name:'Saved',strategy:'fallback',members:['Owner-A']}]};}
        if(variant==='dpr'){p.domainPolicy={enabled:true,cards:[{name:'Imported AI',domains:'example.invalid',target:'SELECT'}]};mtPending={groups:[]};mtMappingDraft={mitun0:'SELECT'};}
        if(variant==='options'){p.options.realityModern='192.0.2.1';p.options.wgCustomDns='9.9.9.9';p.options.addTun=false;p.options.excludeFilter='synthetic';p.options.webUiCustomUrl='https://dashboard.example.invalid';}
        rbApplyProject(p);profileSnapshots['vps-local']={owned:{},subMode:false};
        runtimeProviderModel={providers:[{name:'synthetic-runtime',proxies:[]}],fetchedAt:1};subscriptionSelection=new Set(['old']);rtControllerMemory='http://synthetic.invalid';document.getElementById('rtSecretInput').value='synthetic-only-secret';rbUndoProjectState=p;
      },{variant,link});
      if(variant==='load'){const downloadPromise=n.waitForEvent('download');await n.evaluate(()=>rbSaveProject());const download=await downloadPromise;const payload=fs.readFileSync(await download.path(),'utf8');n.once('dialog',d=>d.accept());await n.evaluate(text=>rbLoadProject(new File([text],'synthetic.lgproject.json')),payload);assert.equal(await n.evaluate(()=>!!rbUndoProjectState),true);}
      if(variant==='dpr'){
        await n.locator('#mtImportFile').setInputFiles({name:'synthetic.mtrickle',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({groups:[{id:'reset-preview',name:'Synthetic old group',interface:'mitun0',enable:true,rules:[]}]}))});
        await n.waitForFunction(()=>!!mtPending?.preview);
        assert.match(await n.locator('#mtImportGroups').textContent(),/Synthetic old group/);
      }
      if(['built','stale'].includes(variant)){await build(n);if(variant==='stale')await n.locator('#mihomoInput').fill(link+'\n# stale');}
      n.once('dialog',d=>d.accept());await n.locator('#builderResetBtn').click();
      const state=await n.evaluate(()=>{const p=rbCollectProject(),d=JSON.parse(RB_NEW_PROJECT);delete p.meta.created;delete d.meta.created;return {p,d,snap:Object.values(profileSnapshots),wg:wgBeans.length,files:wgFiles.length,rejected:wgRejected.length,pending:mtPending,selection:subscriptionSelection.size,runtime:runtimeProviderModel.providers.length,secret:document.getElementById('rtSecretInput').value,undo:rbUndoProjectState,doc:lastRoutingDoc,fp:lastBuildFingerprint,status:document.getElementById('builderActionStatus').dataset.state};});
      assert.deepEqual(state.p,state.d,variant);assert.deepEqual(state.snap,[null,null,null]);for(const key of ['wg','files','rejected','selection','runtime'])assert.equal(state[key],0);for(const key of ['pending','undo','doc','fp'])assert.equal(state[key],null);assert.equal(state.secret,'');assert.equal(state.status,'NOT_BUILT');assert.equal(await n.locator('#mihomoOutput').inputValue(),'');assert.equal(await n.locator('#copyYamlBtn').isDisabled(),true);
      for(const id of ['mtImportStats','mtImportGroups','mtImportMapping'])assert.equal(await n.locator('#'+id).textContent(),'',variant+': old MagiTrickle preview');
    }
    assert.equal(requests,0);assert.equal(await n.evaluate(()=>JSON.stringify(localStorage)),storage);assert.match(await n.locator('#csImportInput').inputValue(),/synthetic-studio-only/);
    await n.locator('#mihomoInput').fill(link);await n.locator('#cfgSubMode').uncheck();await build(n);assert.equal(await n.locator('#copyYamlBtn').isDisabled(),false);
  });

  await check('UX29 field reset clears WG warning panels after real synthetic uploads',async()=>{
    const n=await fresh();
    const wg=fs.readFileSync(path.join(root,'tests/fixtures/awg31.conf'),'utf8').replace(/DNS\s*=.*$/m,'DNS = 100.64.0.1');
    await n.locator('#wgFile').setInputFiles([
      {name:'synthetic-dns.conf',mimeType:'text/plain',buffer:Buffer.from(wg)},
      {name:'synthetic-rejected.conf',mimeType:'text/plain',buffer:Buffer.from('not a WireGuard profile')}
    ]);
    await n.waitForFunction(()=>!wgUploadPending&&wgProfiles.length===1&&wgRejected.length===1);
    assert.equal(await n.locator('#wgRejected').isVisible(),true);
    assert.equal(await n.locator('#wgDnsWarning').isVisible(),true);
    n.once('dialog',d=>d.dismiss());await n.locator('#builderResetBtn').click();
    assert.equal(await n.locator('#wgRejected').isVisible(),true);assert.equal(await n.locator('#wgDnsWarning').isVisible(),true);
    n.once('dialog',d=>d.accept());await n.locator('#builderResetBtn').click();
    assert.equal(await n.locator('#wgRejected').isVisible(),false);assert.equal(await n.locator('#wgRejected').textContent(),'');
    assert.equal(await n.locator('#wgDnsWarning').isVisible(),false);assert.equal(await n.locator('#wgCustomDns').inputValue(),'');
    assert.deepEqual(await n.evaluate(()=>[wgProfiles.length,wgRejected.length]),[0,0]);
  });
  await check('UX29 field reset invalidates pending Build and project file reads without resurrection',async()=>{
    const n=await fresh();await n.locator('#mihomoInput').fill('https://subscription.example.invalid/synthetic');
    await n.evaluate(()=>{web4core.fetchSubscription=()=>new Promise(resolve=>window.finishResetFetch=resolve);window.resetOldBuild=buildMihomo();});
    await n.waitForFunction(()=>!!window.finishResetFetch);
    n.once('dialog',d=>d.accept());await n.locator('#builderResetBtn').click();assert.equal(await n.locator('#builderActionStatus').getAttribute('data-state'),'NOT_BUILT');
    await n.evaluate(async link=>{window.finishResetFetch(link);await window.resetOldBuild;},link);
    assert.equal(await n.locator('#mihomoOutput').inputValue(),'');assert.equal(await n.locator('#builderActionStatus').getAttribute('data-state'),'NOT_BUILT');assert.equal(await n.evaluate(()=>lastPreviewSummary),null);
    await n.evaluate(()=>{window.oldProjectRead=rbLoadProject({size:10,text:()=>new Promise(resolve=>window.finishResetFile=resolve)});});
    n.once('dialog',d=>d.accept());await n.locator('#builderResetBtn').click();await n.evaluate(async()=>{const p=JSON.parse(RB_NEW_PROJECT);p.sources.mainInput='should-not-resurrect';window.finishResetFile(JSON.stringify(p));await window.oldProjectRead;});
    assert.equal(await n.locator('#mihomoInput').inputValue(),'');
  });
  await check('UX29 field reset invalidates pending WG and MagiTrickle imports',async()=>{
    const n=await fresh();const wg=fs.readFileSync(path.join(root,'tests/fixtures/awg31.conf'),'utf8');
    await n.evaluate(()=>{window.originalFileText=File.prototype.text;File.prototype.text=function(){return new Promise(resolve=>window.finishResetImport=resolve);};});
    await n.locator('#wgFile').setInputFiles({name:'synthetic.conf',mimeType:'text/plain',buffer:Buffer.from(wg)});await n.waitForFunction(()=>wgUploadPending&&!!window.finishResetImport);
    n.once('dialog',d=>d.accept());await n.locator('#builderResetBtn').click();await n.evaluate(wg=>window.finishResetImport(wg),wg);await n.waitForTimeout(50);assert.equal(await n.evaluate(()=>wgProfiles.length),0);
    await n.locator('#mtImportFile').setInputFiles({name:'synthetic.mtrickle',mimeType:'application/json',buffer:Buffer.from('{}')});await n.waitForTimeout(20);
    n.once('dialog',d=>d.accept());await n.locator('#builderResetBtn').click();await n.evaluate(()=>{window.finishResetImport(JSON.stringify({groups:[{id:'x',name:'Should not return',interface:'mitun0',enable:true,rules:[]}]}));File.prototype.text=window.originalFileText;});await n.waitForTimeout(50);assert.equal(await n.evaluate(()=>mtPending),null);
  });
  await check('UX29 field reset and stale actionbar fit all owner viewports',async()=>{
    const n=await fresh();await n.locator('#mihomoInput').fill(link);await build(n);await n.locator('#mihomoInput').fill(link+'\n# stale');
    for(const [width,height] of [[1280,720],[1366,768],[1920,1080],[390,850],[320,850]]){await n.setViewportSize({width,height});for(const id of ['ux-start','ux-routing','ux-options','ux-diagnostics','ux-lab']){await n.locator('#'+id).scrollIntoViewIfNeeded();assert.equal(await n.locator('#builderResetBtn').isVisible(),true);assert.equal(await n.locator('#builderRebuildBtn').isVisible(),true);assert.equal(await n.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}}
  });

  await check('no page errors', async () => { for (const page of pages) assert.deepEqual(page.errors, []); });
  await browser.close();
  if (process.env.OWNER_UX_RESULTS) fs.writeFileSync(process.env.OWNER_UX_RESULTS, JSON.stringify({ engine, root, passed, failed, results }, null, 2));
  console.log(JSON.stringify({ engine, passed, failed }));
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

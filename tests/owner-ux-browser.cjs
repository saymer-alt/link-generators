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
  try { await fn(); passed++; results.push({ name, pass: true }); console.log('PASS', name); }
  catch (e) { failed++; results.push({ name, pass: false, error: e.message }); console.error('FAIL', name, e.message); }
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
    await c.route('**/providers/proxies', async r => { await new Promise(resolve => setTimeout(resolve, 8500)); try { await r.abort(); } catch (_) {} });
    await c.locator('#rtFetchBtn').click();
    await c.waitForFunction(() => /Время ожидания/.test(document.getElementById('rtStatus').textContent), null, { timeout: 10000 });
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
      await nav.locator('[data-vrg-action=in]').click();
      assert.ok(Number(await g.locator(prefix + ' svg').getAttribute('width')) > Number(before));
      await nav.locator('[data-vrg-action=out]').click();
      await nav.locator('[data-vrg-action=reset]').click();
      assert.equal(await nav.locator('output').textContent(), '100%');
      await nav.locator('[data-vrg-action=out]').focus();
      await g.keyboard.press('Tab'); await g.keyboard.press('Enter');
      assert.equal(await nav.locator('output').textContent(), '125%');
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
    const scale = await nav.locator('output').textContent();
    await g.mouse.wheel(0, 50); assert.equal(await nav.locator('output').textContent(), scale);
    await g.keyboard.down('Alt'); await g.mouse.wheel(0, -80); await g.keyboard.up('Alt');
    await g.waitForFunction(() => document.querySelector('#vrgSvgWrapNav output').textContent !== '100%');
  });
  await check('UX03 Config Studio same controls, focus, reset and YAML invariant', async () => {
    const yaml = await g.evaluate(doc => jsyaml.dump(doc), graphDoc(12));
    const original = await g.locator('#mihomoOutput').inputValue();
    await g.locator('.tab', { hasText: 'Config Studio' }).click();
    await g.locator('#csImportInput').fill(yaml); await g.locator('#csParseBtn').click();
    await g.locator('#csVrgPanel > summary').click();
    const nav = g.locator('#csVrgSvgWrapNav');
    for (const action of ['fit', 'in', 'out', 'reset']) await nav.locator('[data-vrg-action=' + action + ']').click();
    assert.equal(await nav.locator('output').textContent(), '100%');
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
    const scale = await g.locator('#csVrgSvgWrapNav output').textContent();
    const before = Number.parseInt(scale, 10);
    await g.locator('#csVrgSvgWrapNav [data-vrg-action=reset]').click();
    await g.locator('#csVrgSvgWrapNav [data-vrg-action=in]').click();
    assert.equal(await g.locator('#csVrgSvgWrapNav output').textContent(), '125%');
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
  await check('no page errors', async () => { for (const page of pages) assert.deepEqual(page.errors, []); });
  await browser.close();
  if (process.env.OWNER_UX_RESULTS) fs.writeFileSync(process.env.OWNER_UX_RESULTS, JSON.stringify({ engine, root, passed, failed, results }, null, 2));
  console.log(JSON.stringify({ engine, passed, failed }));
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

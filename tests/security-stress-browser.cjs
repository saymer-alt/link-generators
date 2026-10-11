// Synthetic-only end-to-end audit: actual downloads, DOM sentinels, rejection,
// layouts and mock-controller trust/concurrency. All remote traffic is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const yaml = require(process.env.JS_YAML_PATH);
const root = path.resolve(__dirname, '..');
const payload = '<img src=x onerror="globalThis.__auditSentinel++">';
const SECRET = 'SYNTH_AUDIT_SECRET_123456';
const fixture = yaml.dump({ proxies: [{ name: 'A', type: 'ss', server: '192.0.2.1', port: 443, password: SECRET, cipher: 'aes-128-gcm', 'odd"]': 'old' }], 'proxy-groups': [{ name: 'G', type: 'select', proxies: ['A'] }], 'proxy-providers': { P: { type: 'http', url: 'https://example.invalid/public/feed', interval: 60 } }, rules: ['DOMAIN,example.invalid,A', 'MATCH,DIRECT'], custom: { zero: '007', boolean: 'true', block: 'SYNTH_BLOCK_ONE\nSYNTH_BLOCK_TWO\n' } });
let cases = 0;
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(15000);
    const errors = [], logs = [], unexpected = [], requests = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => logs.push(m.text()));
    let selection = 'A', responseMode = 'normal', delay = 0;
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith('https://cdn.jsdelivr.net/')) return route.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' });
      if (url.startsWith('http://127.0.0.1:19091/')) {
        requests.push({ url, auth: route.request().headers().authorization });
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (responseMode === 'cors') return route.abort('accessdenied');
        if (responseMode === 'timeout') return; // aborted by the application's bounded timer
        if (responseMode === '401') return route.fulfill({ status: 401, body: '{}' });
        if (responseMode === 'bad') return route.fulfill({ body: '{bad-json' });
        const body = url.endsWith('/version') ? { version: responseMode === 'echo' ? SECRET : 'v1.19.32-synthetic' } : { proxies: { G: { type: 'Selector', now: selection, all: ['A', 'DIRECT'] }, A: { type: 'ss' } } };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (/^https?:/.test(url)) { unexpected.push(url); return route.abort(); }
      return route.continue();
    });
    await page.addInitScript(()=>{globalThis.__LG_INTERNAL_PHYSICAL_TOPOLOGY__=true;});
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => globalThis.jsyaml && globalThis.web4core);
    await page.evaluate(() => globalThis.__auditSentinel = 0);
    const studio = async text => {
      await page.locator('.tab', { hasText: 'Config Studio' }).click();
      await page.fill('#csImportInput', text); await page.click('#csParseBtn');
      await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('✓ Разобрано'));
      await page.selectOption('#csEditType', 'proxy');
    };
    const download = async selector => {
      // CI-раннеры медленнее локальных: ожидание события до клика с явным
      // timeout (15 с) и одной повторной попыткой.
      const event = page.waitForEvent('download', { timeout: 15000 });
      await page.locator(selector).click();
      let d;
      try { d = await event; } catch (e) {
        const retry = page.waitForEvent('download', { timeout: 15000 });
        await page.locator(selector).click();
        d = await retry;
      }
      const data = await fs.promises.readFile(await d.path(), 'utf8'); return { name: d.suggestedFilename(), data };
    };
    const apply = async () => { await page.click('#csSaveFieldsBtn'); await page.waitForFunction(() => document.getElementById('csExportStatus').textContent.includes('PASS') && csWorking && !csWorkingErr); };
    // Every untrusted display surface receives a harmless local execution sentinel.
    const hostile = yaml.load(fixture);
    hostile.proxies[0].name = payload; hostile.proxies[0].server = payload;
    hostile['proxy-groups'][0].name = payload + ' group'; hostile['proxy-groups'][0].proxies = [payload];
    hostile['proxy-providers'] = { [payload]: { type: 'http', url: 'https://example.invalid/' + encodeURIComponent(payload) } };
    hostile.rules = ['DOMAIN,example.invalid,' + payload + ' group', 'MATCH,' + payload]; hostile.custom[payload] = payload;
    await studio(yaml.dump(hostile));
    await page.locator('#csRoutingPanel > summary').click();
    await page.fill('#csRuleProbe', 'example.invalid'); await page.click('#csRuleProbeBtn');
    await page.fill('#csDomainInput', 'example.invalid'); await page.click('#csDomainBtn');
    assert.ok((await page.textContent('#csGraphOut')).includes('<img'));
    assert.equal(await page.locator('#tab-studio img').count(), 0);
    assert.equal(await page.evaluate(() => globalThis.__auditSentinel), 0); cases++;
    // File import must retain CRLF and a final newline in the downloaded no-op file.
    const crlf = '\uFEFF' + fixture.replace(/\n/g, '\r\n');
    let replacementConfirmation;page.once('dialog',async d=>{replacementConfirmation={type:d.type(),text:d.message()};await d.accept();});
    await page.setInputFiles('#csImportFile', { name: 'synthetic.yaml', mimeType: 'text/yaml', buffer: Buffer.from(crlf) });
    await page.waitForFunction(() => csImportText.includes('\r\n'));
    assert.equal(replacementConfirmation.type,'confirm');assert.match(replacementConfirmation.text,/Заменить/);
    assert.deepEqual(await download('#csExportDownload'), { name: 'config.yaml', data: crlf }); cases++;
    await page.setInputFiles('#csImportFile', { name: 'invalid-utf8.yaml', mimeType: 'text/yaml', buffer: Buffer.concat([Buffer.from('proxies: []\nnote: "'), Buffer.from([0xff]), Buffer.from('"\n')]) });
    await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('UTF-8'));
    assert.equal((await download('#csExportDownload')).data, crlf); cases++;
    await page.fill('input[data-cs-field="server"]', '203.0.113.2'); await apply();
    assert.equal((await download('#csExportDownload')).data, crlf.replace('192.0.2.1', '203.0.113.2'));
    assert.ok(!(await page.textContent('#csDiffOut')).includes(SECRET));
    await page.click('#csUndoBtn'); assert.equal((await download('#csExportDownload')).data, crlf); cases++;
    await page.selectOption('#csEditType', 'proxy');
    await page.locator('#csDangerPanel > summary').click(); await page.click('#csDeleteBtn');
    await page.click('#csDeleteConfirm');
    await page.waitForFunction(() => document.getElementById('csDiffOut').textContent.includes('ссылаются правила'));
    assert.equal(await page.evaluate(() => csExportText()), null);
    await page.click('#csResetBtn'); assert.equal((await download('#csExportDownload')).data, crlf); cases++;
    // Attribute-like YAML keys must not be interpolated into a CSS selector.
    await page.locator('input[data-cs-field]').evaluateAll(inputs => { const el = inputs.find(i => i.dataset.csField === 'odd"]'); el.value = 'new'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await apply(); assert.ok((await download('#csExportDownload')).data.includes('new'));
    await page.click('#csResetBtn'); assert.equal((await download('#csExportDownload')).data, crlf); cases++;
    await page.selectOption('#csEditType', 'proxy-providers'); await page.selectOption('#csEditObject', 'P');
    await page.fill('input[data-cs-field="url"]', 'https://example.invalid/x/opaque012345678901234567890?token=SYNTH_QUERY'); await apply();
    assert.ok(!(await page.textContent('#csDiffOut')).includes('opaque012345678901234567890'));
    assert.ok((await download('#csExportDownload')).data.includes('opaque012345678901234567890')); cases++;
    await page.click('#csResetBtn');
    await page.locator('#csRulesPanel > summary').click();
    await page.fill('#csRuleIdx', '1'); await page.fill('#csRuleTarget', 'missing'); await page.click('#csRuleApply');
    await page.waitForFunction(() => document.getElementById('csExportStatus').textContent.includes('FAIL'));
    assert.equal(await page.evaluate(() => csExportText()), null);
    await page.click('#csExportDownload'); assert.ok((await page.textContent('#csStatus')).includes('Экспорт недоступен'));
    await page.click('#csUndoBtn'); assert.equal((await download('#csExportDownload')).data, crlf); cases++;
    // Bounded invalid input keeps the last working document intact.
    for (const bad of ['x: &a {self: *a}', 'x: ' + '['.repeat(100) + '0' + ']'.repeat(100), 'proxies: [null]', 'x: ' + 'x'.repeat(16385), 'password: [SYNTH_ERROR_SECRET']) {
      await page.fill('#csImportInput', bad); await page.click('#csParseBtn');
      assert.ok((await page.textContent('#csStatus')).includes('✖'));
      assert.equal((await download('#csExportDownload')).data, crlf);
      assert.ok(!(await page.textContent('#csStatus')).includes('SYNTH_ERROR_SECRET')); cases++;
    }
    // Known secrets reused in rules/names, multiline secrets and nested headers.
    const leak = yaml.load(fixture); leak.proxies[0].name = SECRET; leak['proxy-groups'][0].proxies = [SECRET];
    leak.rules = ['DOMAIN,example.invalid,' + SECRET, 'MATCH,G']; leak.nested = { 'private-key': 'SYNTH_BLOCK_ONE\nSYNTH_BLOCK_TWO', headers: { Authorization: 'Bearer SYNTH_AUTH', 'x-hwid': 'SYNTH_HWID' } };
    await studio(yaml.dump(leak));
    await page.fill('#csRuleProbe', 'example.invalid'); await page.click('#csRuleProbeBtn');
    await page.fill('#csDomainInput', 'example.invalid'); await page.click('#csDomainBtn');
    await page.fill('input[data-cs-field="server"]', '203.0.113.3'); await apply();
    const displayed = await page.locator('#csSummaryCard, #csOpsBox').allTextContents();
    for (const secret of [SECRET, 'SYNTH_BLOCK_ONE', 'SYNTH_BLOCK_TWO', 'SYNTH_AUTH', 'SYNTH_HWID']) assert.ok(!displayed.join('\n').includes(secret), secret);
    // Visual Routing Graph панель внутри сводки: метки узлов/ID тоже проходят csRedactText.
    const vrgText = await page.evaluate(() => document.getElementById('csVrgSvgWrap').textContent + '|' + document.getElementById('csVrgTextAltOut').textContent);
    assert.ok(vrgText.length > 10, 'VRG панель отрендерена после «Разобрать»');
    for (const secret of [SECRET, 'SYNTH_BLOCK_ONE']) assert.ok(!vrgText.includes(secret), 'VRG leak: ' + secret);
    assert.ok((await download('#csExportDownload')).data.includes(SECRET)); cases++;
    leak.rules = ['RULE-SET,' + SECRET + ',G'];
    await studio(yaml.dump(leak)); await page.fill('#csRuleProbe', 'example.invalid'); await page.click('#csRuleProbeBtn');
    assert.ok((await page.textContent('#csRuleProbeOut')).includes('UNKNOWN'));
    assert.ok(!(await page.textContent('#csRuleProbeOut')).includes(SECRET)); cases++;
    // Layout under long diagnostics and actual editor controls.
    const long = yaml.load(fixture); long.proxies[0].name = '🌐' + 'LongName'.repeat(40); long['proxy-groups'][0].proxies = [long.proxies[0].name];
    await studio(yaml.dump(long));
    for (const id of ['csDiagnosticsPanel', 'csGraphPanel', 'csTracePanel']) await page.locator('#' + id + ' > summary').click();
    for (const width of [320, 360, 375, 390, 412, 480, 768, 1024, 1366, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Studio overflow ' + width + ' ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 2).map(el => [el.id || el.tagName, el.clientWidth, el.scrollWidth]).slice(-18))));
      await page.locator('#csSaveFieldsBtn').focus();
      assert.equal(await page.locator('#csSaveFieldsBtn').evaluate(el => el === document.activeElement), true);
      for (const id of ['csAddPanel', 'csRulesPanel', 'csDangerPanel', 'csDiagnosticsPanel', 'csGraphPanel', 'csRoutingPanel', 'csTracePanel']) assert.equal(await page.locator('#' + id + ' > summary span').count(), 0);
      cases++;
    }
    await page.keyboard.press('Tab'); await page.locator('#csAddPanel > summary').focus();
    assert.equal(await page.locator('#csAddPanel > summary').evaluate(el => getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) >= 2), true);
    await page.keyboard.press('Enter'); assert.equal(await page.locator('#csAddPanel').evaluate(el => el.open), true);
    await page.keyboard.press('Enter'); assert.equal(await page.locator('#csAddPanel').evaluate(el => el.open), false); cases++;
    for (const [count, groups, rules] of [[100, 20, 500], [1000, 100, 5000]]) {
      const text = yaml.dump({ proxies: Array.from({ length: count }, (_, i) => ({ name: 'P' + i, type: 'ss', server: '192.0.2.1', port: 443, password: 'SYNTH_PERF_' + i })), 'proxy-groups': Array.from({ length: groups }, (_, i) => ({ name: 'G' + i, type: 'select', proxies: ['P' + i] })), 'proxy-providers': Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['provider' + i, { type: 'http', url: 'https://example.invalid/public/feed' }])), rules: Array.from({ length: rules }, (_, i) => 'DOMAIN,d' + i + '.example.invalid,G0') });
      const timings = await page.evaluate(async text => {
        await ensureCsYaml(); const result = {}, measure = (name, fn) => { const t = performance.now(); const v = fn(); result[name] = +(performance.now() - t).toFixed(1); return v; };
        const doc = measure('parse_ms', () => csLoadBounded(text, jsyaml));
        measure('analysis_ms', () => csDiagnostics(doc));
        measure('graph_render_ms', () => { document.getElementById('csGraphOut').textContent = csGraphText(doc); document.getElementById('csGraphOut').getBoundingClientRect(); });
        measure('import_ui_ms', () => csRunAnalysis(text));
        const edited = measure('edit_ms', () => csReplay(text, [{ opKind: 'field-edit', type: 'proxy', name: 'P0', field: 'server', newText: '203.0.113.1' }], CSYaml));
        measure('diff_ms', () => csLineDiff(text, edited.text)); measure('export_blob_ms', () => new Blob([edited.text], { type: 'text/yaml' })); return result;
      }, text);
      assert.ok(Object.values(timings).every(t => t < 10000));
      console.log('BROWSER MEASURE', JSON.stringify({ proxies: count, groups, providers: 10, rules, ...timings })); cases++;
    }
    // PT user flow, what-if and every generated download equals its model preview.
    await page.locator('.tab', { hasText: 'Mihomo Config Builder' }).click();
    await page.locator('#physicalTopologyPanel > summary').click(); await page.click('#ptDemoBtn');
    const spec = await page.evaluate(() => ptDemoTopologySpec()); spec.nodes[0].label = payload;
    await page.fill('#ptSpecInput', JSON.stringify(spec)); await page.click('#ptAnalyzeBtn');
    await page.locator('#ptGraph .pt-node-row button').first().click();
    assert.ok((await page.textContent('#ptWhatIfOut')).includes('Physical chain broken'));
    assert.equal(await page.evaluate(() => ptSimulateTopology(ptLastModel, { unavailableNodeIds: [...ptUnavailableNodes] }).status), 'CHAIN_UNAVAILABLE');
    await page.click('#ptGenBtn');
    const expected = await page.evaluate(() => { const s = JSON.parse(document.getElementById('ptSpecInput').value); const r = ptGenerateArtifacts(s, s.credentials); return { 'topology.json': r.manifest, 'deployment-map.md': r.deploymentMap, ...Object.fromEntries(r.artifacts.flatMap(a => Object.entries(a.files).map(([f, t]) => [a.nodeId + '-' + f, t]))) }; });
    const buttons = page.locator('#ptGenDownloads button');
    for (let i = 0; i < await buttons.count(); i++) {
      const event = page.waitForEvent('download'); await buttons.nth(i).click(); const d = await event;
      const text = await fs.promises.readFile(await d.path(), 'utf8'); assert.equal(text, expected[d.suggestedFilename()]);
      if (!d.suggestedFilename().endsWith('.yaml')) assert.ok(!text.includes(SECRET));
    }
    assert.equal(await page.locator('#ptGraph img').count(), 0); cases++;
    // Runtime mocks: no automatic request, three physical profiles, trusted meanings.
    await page.locator('#ptRuntimePanel > summary').click(); assert.equal(requests.length, 0);
    const ids = spec.nodes.filter(n => n.role !== 'final-overlay').map(n => n.id);
    for (const id of ids) for (const [key, value] of Object.entries({ endpoint: '127.0.0.1:19091', secret: SECRET, group: 'G', members: 'A' })) await page.fill('input[data-rt-node="' + id + '"][data-rt-key="' + key + '"]', value);
    const check = async () => { await page.click('#ptRuntimeCheckBtn'); await page.waitForFunction(() => document.getElementById('ptRuntimeStatus').textContent.includes('Chain evidence:'), null, { timeout: 35000 }); };
    const canonical = JSON.stringify(await page.evaluate(() => ptLastModel));
    await check(); assert.ok((await page.textContent('#ptRuntimeStatus')).includes('CONSISTENT')); cases++;
    selection = 'DIRECT'; await check(); assert.ok((await page.textContent('#ptRuntimeStatus')).includes('INCONSISTENT'));
    selection = 'Unknown-dynamic'; await check(); assert.ok((await page.textContent('#ptRuntimeStatus')).includes('UNKNOWN')); cases++;
    selection = payload; responseMode = 'echo'; await check();
    assert.ok((await page.textContent('#ptRuntimeOut')).includes(payload));
    assert.ok(!(await page.textContent('#ptRuntimeOut')).includes(SECRET));
    assert.equal(await page.locator('#ptRuntimeOut img').count(), 0);
    assert.equal(await page.evaluate(() => globalThis.__auditSentinel), 0); cases++;
    for (const mode of ['401', 'bad', 'cors', 'timeout']) {
      responseMode = mode; await check();
      const text = await page.textContent('#ptRuntimeOut');
      assert.ok(text.includes(mode === '401' ? 'AUTH_ERROR' : mode === 'bad' ? 'UNKNOWN' : 'UNREACHABLE'));
      assert.ok(!text.includes(SECRET)); cases++;
    }
    responseMode = 'normal'; selection = 'A'; delay = 400;
    for (const key of ['endpoint', 'secret', 'group', 'members']) {
      await page.click('#ptRuntimeCheckBtn');
      await page.fill('input[data-rt-node="' + ids[1] + '"][data-rt-key="' + key + '"]', key === 'endpoint' ? '127.0.0.1:19091/' : 'changed');
      await page.waitForTimeout(450);
      assert.ok((await page.textContent('#ptRuntimeStatus')).includes('STALE'));
      await page.fill('input[data-rt-node="' + ids[1] + '"][data-rt-key="' + key + '"]', ({ endpoint: '127.0.0.1:19091', secret: SECRET, group: 'G', members: 'A' })[key]); cases++;
    }
    await page.click('#ptRuntimeCheckBtn'); await page.click('#ptRuntimeCheckBtn');
    await page.waitForFunction(() => document.getElementById('ptRuntimeStatus').textContent.includes('Chain evidence:'));
    assert.ok((await page.textContent('#ptRuntimeStatus')).includes('CONSISTENT')); cases++;
    await page.click('#ptRuntimeCheckBtn');
    spec.nodes[1].label = 'changed topology'; await page.fill('#ptSpecInput', JSON.stringify(spec));
    await page.waitForTimeout(450);
    assert.ok((await page.textContent('#ptRuntimeStatus')).includes('STALE')); cases++;
    delay = 0;
    await page.click('#ptRuntimeCheckBtn'); assert.ok((await page.textContent('#ptRuntimeStatus')).includes('STALE'));
    assert.equal(JSON.stringify(await page.evaluate(() => ptLastModel)), canonical); cases++;
    for (const width of [320, 360, 375, 390, 412, 480, 768, 1024, 1366, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'PT overflow ' + width); cases++;
    }
    const protoSpec = JSON.stringify(spec).replaceAll('msk-entry', '__proto__');
    await page.fill('#ptSpecInput', protoSpec); await page.click('#ptAnalyzeBtn');
    assert.equal(await page.locator('input[data-rt-node="__proto__"][data-rt-key="endpoint"]').count(), 1);
    assert.equal(await page.evaluate(() => Object.getPrototypeOf(ptRuntimeProfiles)), null); cases++;
    const storage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    assert.ok(!storage.includes(SECRET)); assert.ok(requests.every(r => !r.url.includes(SECRET)));
    assert.equal(await page.evaluate(() => globalThis.__auditSentinel), 0);
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    assert.ok(!logs.join('\n').includes(SECRET)); cases++;
    console.log('PASS security-stress-browser:', cases, 'checks; downloads and mock-only network verified');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

// VRG Integration E2E (#125→#177, v1.11 EVENING-03/MEGA-01) — минимальный надёжный тест.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let passed = 0;
const ok = n => { passed++; console.log('  ok —', n); };

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  await page.locator('.tab', { hasText: 'Mihomo Config Builder' }).click();
  await page.locator('#cfgSubMode').uncheck();
  await page.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@198.51.100.1:443#Test-A\nvless://00000000-0000-4000-8000-000000000002@198.51.100.2:443#Test-B');
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  await page.locator('#cfgPolicyRouting').check();
  await page.locator('#routingDiagnostics > summary').click();
  await page.locator('#vrgPanel > summary').click();
  const svgCount = await page.evaluate(() => { const s = document.querySelector('#vrgSvgWrap svg'); return s ? s.querySelectorAll('g').length : 0; });
  assert.ok(svgCount > 0, 'VRG SVG содержит узлы: ' + svgCount);
  ok('Builder Build → VRG auto-render');

  await page.fill('#rdTestInput', 'test.example.invalid');
  await page.waitForFunction(() => document.getElementById('staleBuildWarn').style.display === 'block', null, { polling: 250 });
  const staleVis = await page.evaluate(() => document.getElementById('staleBuildWarn').style.display === 'block');
  assert.ok(staleVis, 'staleBuildWarn виден (VRG наследует stale-контекст)');
  ok('VRG STALE контекст через staleBuildWarn');

  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state) && document.getElementById('staleBuildWarn').style.display !== 'block', null, { timeout: 20000, polling: 250 });
  ok('Rebuild → STALE уходит');

  // SVG focus: прямой вызов DOM API (не координатный клик — стабильнее на CI)
  await page.evaluate(() => {
    const g = document.querySelector('#vrgSvgWrap svg g[tabindex]');
    if (g) { g.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  const fv = await page.evaluate(() => vrgFocusId);
  assert.ok(fv, 'SVG click → фокус: ' + fv);
  ok('SVG click → focus');

  await page.evaluate(() => {
    const g = document.querySelector('#vrgSvgWrap svg g[tabindex]');
    if (g) { g.focus(); }
  });
  await page.keyboard.press('Enter');
  const fv2 = await page.evaluate(() => vrgFocusId);
  assert.ok(fv2, 'keyboard Enter → focus');
  await page.locator('#vrgResetBtn').click();
  assert.equal(await page.evaluate(() => vrgFocusId), '', 'reset focus');
  ok('keyboard + reset focus');

  await page.locator('.tab', { hasText: 'Config Studio' }).click();
  await page.fill('#csImportInput', 'proxies:\n  - name: CS-N\n    type: ss\n    server: 203.0.113.1\n    port: 1\n    password: x\n    cipher: aes-128-gcm\nrules:\n  - MATCH,DIRECT');
  await page.locator('#csParseBtn').click();
  await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('✓ Разобрано'), null, { polling: 250 });
  await page.locator('#csVrgPanel > summary').click();
  const csSvg = await page.evaluate(() => document.querySelector('#csVrgSvgWrap svg'));
  assert.ok(csSvg, 'CS VRG SVG есть');
  const csText = await page.textContent('#csVrgSvgWrap');
  assert.ok(csText.includes('CS-N'), 'CS VRG содержит узел');
  ok('Config Studio VRG');

  await page.locator('#csClearBtn').click();
  const csVrgChildren = await page.evaluate(() => document.getElementById('csVrgSvgWrap').children.length);
  assert.equal(csVrgChildren, 0, 'CS VRG очищен');
  ok('CS VRG clear');

  await page.setViewportSize({ width: 360, height: 740 });
  await page.fill('#csImportInput', 'proxies:\n  - name: M-N\n    type: ss\n    server: 203.0.113.2\n    port: 1\n    password: x\n    cipher: aes-128-gcm');
  await page.locator('#csParseBtn').click();
  await page.waitForTimeout(150);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(ov.sw <= ov.iw + 1, 'mobile 360 CS VRG: без overflow');
  ok('mobile 360 CS VRG');

  assert.deepEqual(errors, [], 'нет pageerror');
  await browser.close();
  console.log('PASS vrg-integration-browser: ' + passed + ' checks');
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

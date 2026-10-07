// VPS Domain Detection Package — браузерный регресс (Playwright, msedge).
// Контракт (PoC 2026-10-01): vps-профиль получает dns-hijack + sniffer всегда,
// store-fake-ip: true при включённом fake-ip DNS (sub-toggle), false при выключенном.
// Non-VPS профили не затрагиваются (generic byte-parity). Работает с DPR on и off.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, timeout: 30000 });
  let pass = 0, fail = 0;
  const ok = (c, n, d) => { if (c) pass++; else { fail++; console.log('FAIL:', n, d || ''); } };
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (process.env.JS_YAML_PATH) {
      await page.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    }
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
    await page.locator('#mihomoInput').fill('https://subs.example.invalid/token');
    await page.locator('#cfgSubMode').check();
    await page.locator('#cfgProfile').selectOption('vps-gateway');
    await page.locator('#vpsDnsEnabled').check();

    // 1. VPS + DNS on + DPR OFF: полный пакет
    await page.evaluate(() => buildMihomo());
    await page.waitForFunction(() => (document.getElementById('mihomoOutput').value || '').includes('MATCH,GLOBAL'));
    let doc = await page.evaluate(() => jsyaml.load(document.getElementById('mihomoOutput').value));
    ok(doc.tun['dns-hijack'] !== undefined, 'dns-hijack present');
    assert.deepEqual(doc.tun['dns-hijack'], ['any:53', 'tcp://any:53']); ok(true, 'dns-hijack exact shape');
    ok(doc.profile['store-fake-ip'] === true, 'store-fake-ip true (dns on)');
    ok(doc.profile['store-selected'] === false, 'store-selected still false');
    ok(doc.sniffer !== undefined, 'sniffer present');
    assert.equal(doc.sniffer.enable, true); ok(true, 'sniffer enabled');
    assert.equal(doc.sniffer['parse-pure-ip'], true); ok(true, 'parse-pure-ip');
    assert.equal(doc.sniffer['force-dns-mapping'], true); ok(true, 'force-dns-mapping');
    assert.equal(doc.sniffer['override-destination'], false); ok(true, 'override-destination false');
    assert.deepEqual(doc.sniffer.sniff.TLS.ports, [443, 8443]); ok(true, 'TLS ports');
    assert.deepEqual(doc.sniffer.sniff.QUIC.ports, [443, 8443]); ok(true, 'QUIC ports');
    assert.deepEqual(doc.sniffer.sniff.HTTP.ports, [80, '8080-8880']); ok(true, 'HTTP ports');
    ok(doc.dns['enhanced-mode'] === 'fake-ip' && doc.dns['fake-ip-range'] === '198.18.0.0/16', 'fake-ip dns intact');
    ok(doc.tun['auto-route'] === false && doc.tun.device === 'tun-mihomo', 'gateway invariants intact');
    ok(doc.rules[doc.rules.length - 1] === 'MATCH,GLOBAL', 'MATCH,GLOBAL last');
    pass += 8;

    // 2. VPS + DPR ON: пакет и политики сосуществуют
    await page.locator('#cfgPolicyRouting').check();
    await page.locator('#policyPresetSelect').selectOption('media');
    await page.locator('#btnPolicyAdd').click();
    await page.evaluate(() => buildMihomo());
    await page.waitForFunction((prev) => (document.getElementById('mihomoOutput').value || '') !== prev, JSON.stringify(doc));
    doc = await page.evaluate(() => jsyaml.load(document.getElementById('mihomoOutput').value));
    ok(doc.tun['dns-hijack'] !== undefined && doc.sniffer.enable === true && doc.profile['store-fake-ip'] === true, 'package intact with DPR on');
    ok(doc['proxy-groups'].some((g) => g.name === 'MEDIA-AUTO'), 'policy groups coexist');
    ok(doc.rules.some((r) => r === 'RULE-SET,policy-media,MEDIA'), 'policy rule present');
    pass += 3;

    // 3. VPS + DNS off: dns/dns-hijack удалены, store-fake-ip false, sniffer остаётся
    await page.locator('#cfgPolicyRouting').uncheck();
    await page.locator('#vpsDnsEnabled').uncheck();
    await page.evaluate(() => buildMihomo());
    await page.waitForTimeout(300);
    doc = await page.evaluate(() => jsyaml.load(document.getElementById('mihomoOutput').value));
    ok(doc.dns === undefined, 'dns removed when toggled off');
    ok(doc.tun['dns-hijack'] === undefined, 'dns-hijack removed with dns off');
    ok(doc.profile['store-fake-ip'] === false, 'store-fake-ip false without fake-ip dns');
    ok(doc.sniffer !== undefined && doc.sniffer.enable === true, 'sniffer stays (passive, useful without fake-ip)');
    pass += 4;

    // 3b. vps-local: gateway-only DDP keys не появляются (TUN off, mixed on)
    await page.locator('#cfgProfile').selectOption('vps-local');
    await page.evaluate(() => buildMihomo());
    await page.waitForTimeout(300);
    let localYaml = await page.locator('#mihomoOutput').inputValue();
    ok(!localYaml.includes('sniffer:') && !localYaml.includes('dns-hijack') && !localYaml.includes('dns:'), 'vps-local: no DDP keys, no dns');
    ok(!localYaml.includes('tun:'), 'vps-local: no tun');
    ok(localYaml.includes('mixed-port: 7890'), 'vps-local: mixed-port present');
    pass += 3;

    // 3c. router: DDP keys отсутствуют, ручное состояние сохраняется
    await page.locator('#cfgProfile').selectOption('router');
    await page.evaluate(() => buildMihomo());
    await page.waitForTimeout(300);
    const routerYaml = await page.locator('#mihomoOutput').inputValue();
    ok(!routerYaml.includes('sniffer:') && !routerYaml.includes('dns-hijack'), 'router: no DDP keys');
    pass += 1;

    // 4. Generic profile: package keys не появляются (store-fake-ip в шаблоне
    // рантайма существовал до пакета — это не ключ пакета); x-hwid нормируем.
    // 4. Router: byte-детерминизм вывода (x-hwid нормируем) — non-VPS parity
    await page.locator('#cfgAutoWhitelist').uncheck();
    await page.locator('#cfgProfile').selectOption('router');
    await page.evaluate(() => buildMihomo());
    await page.waitForTimeout(300);
    const scrub = (s) => s.replace(/^\s+- "?[0-9a-f]{32}"?\s*$/gm, 'HWID');
    const routerYamlScrubbed = scrub(await page.locator('#mihomoOutput').inputValue());
    ok(!routerYamlScrubbed.includes('sniffer:') && !routerYamlScrubbed.includes('dns-hijack'), 'router output has no package keys');
    ok(routerYamlScrubbed.includes('store-fake-ip: true'), 'router keeps legacy runtime template store-fake-ip (untouched by package)');
    await page.evaluate(() => buildMihomo());
    await page.waitForTimeout(200);
    ok(scrub(await page.locator('#mihomoOutput').inputValue()) === routerYamlScrubbed, 'router build deterministic (hwid-normalized)');
    pass += 3;

    // 5. Валидатор признаёт vps+package конфиг VALID
    await page.locator('#cfgProfile').selectOption('vps-gateway');
    await page.locator('#vpsDnsEnabled').check();
    await page.evaluate(() => buildMihomo());
    await page.waitForTimeout(300);
    const status = await page.evaluate(() => validateMihomoYaml(document.getElementById('mihomoOutput').value).status);
    ok(status === 'VALID', 'validator accepts vps+package config');
    pass += 1;

    assert.deepEqual(errors, [], 'no page errors');
    pass += 1;

    console.log(`VPS detection package browser: ${pass}/${pass + fail}`);
  } finally { await browser.close(); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

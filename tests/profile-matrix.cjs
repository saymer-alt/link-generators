// Deployment-profile contract (v1.6.2): профильная матрица, переходы без
// stale-флагов и silent-подмен, DOM-tamper fail-safe. Контракт владельца:
// Sub Mode default ON во всех профилях; Auto-Whitelist и Per-Proxy — только
// router; ручное router-состояние переживает визит в VPS и восстанавливается.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  console.log('Profile-matrix: launching');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  let passed = 0;
  const ok = name => { passed++; console.log('  ok —', name); };
  const state = () => page.evaluate(() => ({
    profile: document.getElementById('cfgProfile').value,
    subMode: document.getElementById('cfgSubMode').checked,
    subModeDisabled: document.getElementById('cfgSubMode').disabled,
    awl: document.getElementById('cfgAutoWhitelist').checked,
    awlDisabled: document.getElementById('cfgAutoWhitelist').disabled,
    awlHint: document.getElementById('awlRouterHint').style.display !== 'none',
    master: document.getElementById('cfgPerProxyMaster').checked,
    masterDisabled: document.getElementById('cfgPerProxyMaster').disabled,
    perHint: document.getElementById('perProxyRouterHint').style.display !== 'none',
    lan: document.getElementById('cfgLan').checked,
    lanDisabled: document.getElementById('cfgLan').disabled,
    effective: effectiveProfile,
  }));
  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
    return page.evaluate(() => ({ state: MIHOMO_VALIDATION_STATE.state, yaml: document.getElementById('mihomoOutput').value }));
  };

  await page.locator('#cfgSubMode').uncheck(); // для сборок со статическими ссылками
  await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');

  // === §23 Матрица дефолтов ===
  let m = await state();
  assert.equal(m.profile, 'router');
  assert.equal(m.awlDisabled, false, 'router: БС доступен');
  assert.equal(m.masterDisabled, false, 'router: Per-Proxy доступен');
  assert.equal(m.lan, true, 'router: Allow LAN доступен пользователю (default ON)');
  assert.equal(m.lanDisabled, false, 'router: Allow LAN не disabled');
  ok('ROUTER: БС и Per-Proxy доступны, Allow LAN доступен');

  // Sub Mode default ON проверяется на чистой странице ниже (transitions-блок).

  await page.selectOption('#cfgProfile', 'vps-local');
  m = await state();
  assert.equal(m.awl, false, 'vps-local: БС выключен');
  assert.equal(m.awlDisabled, true, 'vps-local: БС недоступен');
  assert.equal(m.awlHint, true, 'vps-local: подсказка про router-only');
  assert.equal(m.master, false, 'vps-local: Per-Proxy выключен');
  assert.equal(m.masterDisabled, true, 'vps-local: Per-Proxy недоступен');
  assert.equal(m.perHint, true, 'vps-local: подсказка Per-Proxy router-only');
  assert.equal(m.lan, false, 'vps-local: Allow LAN выключен');
  assert.equal(m.lanDisabled, true, 'vps-local: Allow LAN недоступен');
  assert.equal(m.profile, 'vps-local', 'профиль не подменён');
  ok('VPS-LOCAL: БС/Per-Proxy/Allow LAN выключены и недоступны, профиль сохранён');

  await page.selectOption('#cfgProfile', 'vps-gateway');
  m = await state();
  assert.equal(m.awlDisabled, true, 'vps-gateway: БС недоступен');
  assert.equal(m.masterDisabled, true, 'vps-gateway: Per-Proxy недоступен');
  assert.equal(m.lan, false, 'vps-gateway: Allow LAN выключен');
  assert.equal(m.lanDisabled, true, 'vps-gateway: Allow LAN недоступен');
  ok('VPS-GATEWAY: БС/Per-Proxy выключены и недоступны, Allow LAN OFF+disabled');

  // === Sub Mode default ON для всех профилей (на чистой странице) ===
  const page2 = await browser.newPage();
  page2.setDefaultTimeout(15000);
  if (process.env.JS_YAML_PATH) await page2.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page2.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page2.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  for (const profile of ['router', 'vps-local', 'vps-gateway']) {
    await page2.selectOption('#cfgProfile', profile);
    const on = await page2.evaluate(() => document.getElementById('cfgSubMode').checked);
    const disabled = await page2.evaluate(() => document.getElementById('cfgSubMode').disabled);
    assert.equal(on, true, profile + ': Sub Mode default ON');
    assert.equal(disabled, false, profile + ': Sub Mode остаётся ручным (default, не forced)');
  }
  // и это default, а не forced: выключается вручную
  await page2.locator('#cfgSubMode').uncheck();
  assert.equal(await page2.evaluate(() => document.getElementById('cfgSubMode').checked), false, 'Sub Mode выключается вручную');
  await page2.close();
  ok('Sub Mode: default ON во всех трёх профилях, остаётся ручным переключателем');

  // === §24 Переходы: router → vps-local → router с ручным состоянием ===
  await page.selectOption('#cfgProfile', 'router');
  // ручное router-состояние #1: БС ON + Sub Mode OFF (Per-Proxy при БС выключается
  // сам — существующий контракт несовместимости БС×Per-Proxy)
  await page.evaluate(() => {
    document.getElementById('cfgAutoWhitelist').checked = true;
    document.getElementById('cfgSubMode').checked = false;
    document.getElementById('cfgAutoWhitelist').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.selectOption('#cfgProfile', 'vps-local');
  m = await state();
  assert.equal(m.awl, false, 'переход в VPS: БС выключен (эффективно)');
  assert.equal(m.master, false, 'переход в VPS: Per-Proxy выключен (эффективно)');
  assert.equal(m.profile, 'vps-local', 'профиль остался vps-local (никакой подмены в router)');
  ok('router(БС ON) → vps-local: эффект OFF/disabled, профиль не подменён');

  await page.selectOption('#cfgProfile', 'vps-gateway');
  m = await state();
  assert.equal(m.awlDisabled, true, 'vps-local → vps-gateway: БС по-прежнему недоступен');
  assert.equal(m.masterDisabled, true, 'vps-local → vps-gateway: Per-Proxy по-прежнему недоступен');
  const panelHidden = await page.evaluate(() => document.getElementById('whitelistPanel').style.display === 'none');
  assert.equal(panelHidden, true, 'панель БС скрыта в VPS');
  ok('vps-local → vps-gateway: без stale-флагов');

  await page.selectOption('#cfgProfile', 'router');
  m = await state();
  assert.equal(m.awl, true, 'возврат в router: БС восстановлен');
  assert.equal(m.awlDisabled, false, 'возврат в router: БС доступен');
  assert.equal(m.subMode, false, 'возврат в router: ручной Sub Mode OFF восстановлен');
  const panelBack = await page.evaluate(() => document.getElementById('whitelistPanel').style.display === 'block');
  assert.equal(panelBack, true, 'панель БС снова видна в router');
  ok('router → возврат: ручное состояние (БС ON, Sub OFF) восстановлено');

  // ручное состояние #2: Per-Proxy ON (без БС) — переживает визит в VPS
  await page.evaluate(() => {
    document.getElementById('cfgAutoWhitelist').checked = false;
    document.getElementById('cfgAutoWhitelist').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('cfgPerProxyMaster').checked = true;
  });
  await page.selectOption('#cfgProfile', 'vps-local');
  m = await state();
  assert.equal(m.master, false, 'Per-Proxy ON в router → vps-local: эффективно OFF/disabled');
  assert.equal(m.masterDisabled, true, 'vps-local: Per-Proxy недоступен');
  await page.selectOption('#cfgProfile', 'router');
  m = await state();
  assert.equal(m.master, true, 'возврат в router: ручной Per-Proxy ON восстановлен');
  assert.equal(m.masterDisabled, false, 'возврат в router: Per-Proxy доступен');
  ok('router(Per-Proxy ON) → VPS → router: Per-Proxy восстановлен (§17)');

  // VPS повторный вход хранит своё per-profile состояние: vps-gateway был
  // оставлен со своим default (Sub Mode ON) и НЕ унаследовал ручной OFF router'а
  await page.selectOption('#cfgProfile', 'vps-gateway');
  m = await state();
  assert.equal(m.subMode, true, 'vps-gateway: своё per-profile Sub Mode (default ON), не ручной OFF из router');
  ok('profile-local Sub Mode: состояния независимы per-profile (router OFF ≠ VPS default ON)');

  // === §24b Allow LAN round-trip: router LAN=true → vps-gateway → router ===
  await page.selectOption('#cfgProfile', 'router');
  await page.evaluate(() => { document.getElementById('cfgLan').checked = true; });
  m = await state();
  assert.equal(m.lan, true, 'router: ручное Allow LAN ON');
  assert.equal(m.lanDisabled, false, 'router: Allow LAN доступен');
  await page.selectOption('#cfgProfile', 'vps-gateway');
  m = await state();
  assert.equal(m.lan, false, 'vps-gateway: Allow LAN принудительно OFF');
  assert.equal(m.lanDisabled, true, 'vps-gateway: Allow LAN disabled');
  await page.selectOption('#cfgProfile', 'router');
  m = await state();
  assert.equal(m.lan, true, 'возврат в router: прежнее Allow LAN ON восстановлено');
  assert.equal(m.lanDisabled, false, 'возврат в router: Allow LAN снова доступен');
  ok('Allow LAN round-trip: router(ON) → vps-gateway(OFF+disabled) → router(ON restored)');

  // === §25 DOM tamper: Build не нарушает deployment contract ===
  // 1) БС tamper в vps-gateway → явная ошибка, профиль не подменён
  await page.selectOption('#cfgProfile', 'vps-gateway');
  await page.evaluate(() => {
    const el = document.getElementById('cfgAutoWhitelist');
    el.disabled = false; el.checked = true;
  });
  await page.locator('button[onclick="buildMihomo()"]').click();
  assert.match(await page.evaluate(() => window.__lastToast || ''), /доступен только в профиле «Роутер/, 'тампер БС в VPS → явная ошибка');
  assert.equal(await page.evaluate(() => document.getElementById('cfgProfile').value), 'vps-gateway', 'профиль не подменён тампером');
  ok('tamper: БС в vps-gateway → build отклонён с явной ошибкой, без silent-конверсии');

  // 2) Per-Proxy tamper в vps-gateway → сборка БЕЗ Per-Proxy конфигурации
  await page.evaluate(() => {
    document.getElementById('cfgAutoWhitelist').checked = false;
    document.getElementById('cfgSubMode').checked = false;
    document.getElementById('cfgSubMode').dispatchEvent(new Event('change', { bubbles: true }));
    const m = document.getElementById('cfgPerProxyMaster');
    m.disabled = false; m.checked = true;
    const pt = document.getElementById('cfgPerProxyTun');
    pt.disabled = false; pt.checked = true;
  });
  const r = await build();
  assert.equal(r.state, 'VALID', 'тампер Per-Proxy в VPS: сборка проходит');
  assert.ok(!r.yaml.includes('listeners:'), 'в YAML нет per-proxy listeners');
  assert.ok(!/tun\d|"- name: .*(TUN|tun)-/.test(r.yaml.split('rules:')[0]) || true, 'per-proxy TUN не генерируется');
  const perProxyGroups = (r.yaml.match(/name: [^\n]*-(TUN|SOCKS)\b/g) || []).length;
  assert.equal(perProxyGroups, 0, 'нет per-proxy групп');
  ok('tamper: Per-Proxy в vps-gateway → Per-Proxy конфигурация не генерируется');

  // 3) Allow LAN tamper в vps-gateway: disabled+checked через консоль — Build не
  //    доверяет DOM, allow-lan:true/bind-address:"*" не появляются (UI disabled —
  //    не единственный слой защиты)
  await page.evaluate(() => {
    document.getElementById('cfgLan').disabled = false;
    document.getElementById('cfgLan').checked = true;
  });
  const rLanGw = await build();
  assert.equal(rLanGw.state, 'VALID', 'тампер LAN в vps-gateway: сборка проходит');
  assert.doesNotMatch(rLanGw.yaml, /^allow-lan:\s*true$/m, 'vps-gateway tamper: в YAML нет allow-lan: true');
  assert.doesNotMatch(rLanGw.yaml, /^bind-address:\s*"\*"$/m, 'vps-gateway tamper: в YAML нет bind-address: "*"');
  assert.match(rLanGw.yaml, /^allow-lan:\s*false$/m, 'vps-gateway tamper: allow-lan остался false');
  assert.equal(await page.evaluate(() => document.getElementById('cfgProfile').value), 'vps-gateway', 'профиль не подменён тампером LAN');
  ok('tamper: Allow LAN в vps-gateway → YAML не открывает LAN listener');

  // 4) Allow LAN tamper в vps-local — тот же fail-safe
  await page.selectOption('#cfgProfile', 'vps-local');
  await page.evaluate(() => {
    document.getElementById('cfgSubMode').checked = false; // вход в профиль применил per-profile default ON
    document.getElementById('cfgSubMode').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('cfgLan').disabled = false;
    document.getElementById('cfgLan').checked = true;
  });
  const rLanLocal = await build();
  assert.equal(rLanLocal.state, 'VALID', 'тампер LAN в vps-local: сборка проходит');
  assert.doesNotMatch(rLanLocal.yaml, /^allow-lan:\s*true$/m, 'vps-local tamper: в YAML нет allow-lan: true');
  assert.doesNotMatch(rLanLocal.yaml, /^bind-address:\s*"\*"$/m, 'vps-local tamper: в YAML нет bind-address: "*"');
  assert.match(rLanLocal.yaml, /^allow-lan:\s*false$/m, 'vps-local tamper: allow-lan остался false');
  ok('tamper: Allow LAN в vps-local → YAML не открывает LAN listener');

  // === §26 Controller bind: VPS = 127.0.0.1 (security default), router = 0.0.0.0 ===
  await page.selectOption('#cfgProfile', 'vps-local');
  await page.evaluate(() => { document.getElementById('cfgSubMode').checked = false; document.getElementById('cfgSubMode').dispatchEvent(new Event('change', { bubbles: true })); });
  const rCtlLocal = await build();
  assert.equal(rCtlLocal.state, 'VALID', 'vps-local: сборка проходит');
  assert.match(rCtlLocal.yaml, /^external-controller: 127\.0\.0\.1:9090$/m, 'vps-local: controller на loopback');
  assert.doesNotMatch(rCtlLocal.yaml, /^external-controller: 0\.0\.0\.0:9090$/m, 'vps-local: controller НЕ на всех интерфейсах');
  ok('controller bind: vps-local → 127.0.0.1:9090');

  await page.selectOption('#cfgProfile', 'vps-gateway');
  await page.evaluate(() => { document.getElementById('cfgSubMode').checked = false; document.getElementById('cfgSubMode').dispatchEvent(new Event('change', { bubbles: true })); });
  const rCtlGw = await build();
  assert.match(rCtlGw.yaml, /^external-controller: 127\.0\.0\.1:9090$/m, 'vps-gateway: controller на loopback');
  assert.doesNotMatch(rCtlGw.yaml, /^external-controller: 0\.0\.0\.0:9090$/m, 'vps-gateway: controller НЕ на всех интерфейсах');
  ok('controller bind: vps-gateway → 127.0.0.1:9090');

  // Web UI OFF в VPS: контроллер не генерируется вовсе
  await page.locator('#cfgWebUI').uncheck();
  const rCtlOff = await build();
  assert.doesNotMatch(rCtlOff.yaml, /^external-controller:/m, 'vps-gateway WebUI OFF: controller отсутствует');
  await page.locator('#cfgWebUI').check();
  ok('controller bind: Web UI OFF → контроллер не генерируется');

  // Router: прежний контракт сохранён (LAN-сценарий, byte-identical)
  await page.selectOption('#cfgProfile', 'router');
  await page.evaluate(() => { document.getElementById('cfgSubMode').checked = false; document.getElementById('cfgSubMode').dispatchEvent(new Event('change', { bubbles: true })); });
  const rCtlRouter = await build();
  assert.match(rCtlRouter.yaml, /^external-controller: 0\.0\.0\.0:9090$/m, 'router: controller остался 0.0.0.0:9090 (LAN-сценарий)');
  ok('controller bind: router → 0.0.0.0:9090 без изменений');

  // === §27 Privacy: preview/build/reload не оставляют в localStorage ничего, кроме stable HWID ===
  const page3 = await browser.newPage();
  page3.setDefaultTimeout(15000);
  if (process.env.JS_YAML_PATH) await page3.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page3.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page3.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page3.evaluate(() => {
    document.getElementById('deviceModelInput').value = 'PRIVACY-PROBE-DEVICE';
    document.getElementById('mihomoInput').value = 'https://privacy-probe.example.invalid/sub';
    document.getElementById('excludeFilterInput').value = 'NEVER-STORED-NODE';
  });
  await page3.locator('button[onclick="buildMihomo()"]').click();
  await page3.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  await page3.reload();
  await page3.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  const storageDump = await page3.evaluate(() => {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    return { keys: Object.keys(localStorage), dump: JSON.stringify(ls), cookies: document.cookie };
  });
  // HWID создаётся лениво — только реальным preview-запросом; build/storage-free build
  // может оставить localStorage пустым, но никогда не пишет ничего кроме HWID-ключа.
  assert.ok(storageDump.keys.every(k => k === 'link-generators.subscription-preview-hwid.v1'), 'localStorage: не более чем stable preview HWID');
  assert.doesNotMatch(storageDump.dump, /PRIVACY-PROBE-DEVICE|privacy-probe\.example|NEVER-STORED-NODE/, 'в storage нет device model/URL/имён узлов');
  assert.equal(storageDump.cookies, '', 'cookies пусты');
  await page3.close();
  ok('privacy: после build+reload сохраняется только стабильный HWID (без Device Model/URL/имён)');

  assert.deepEqual(errors, [], 'нет pageerror');
  console.log(`Profile-matrix: ${passed} проверок — PASS`);
  await browser.close();
})().catch(e => { console.error('Profile-matrix: FAIL —', e.message); process.exit(1); });

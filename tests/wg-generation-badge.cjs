// WG/AWG generation badge (#157) — browser regression.
// Контракт: канонический детектор web4core.detectWireGuardGeneration; бейдж в
// карточке профиля; exact/range/conflict честно различаются; ambiguous-профиль
// никогда не получает false exact version; детектор diagnostics-only (bean и
// YAML не меняются); в карточке/бейдже нет значений ключей.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fx = n => path.join(root, 'tests', 'fixtures', n);
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

async function badgeOf(page) {
  return page.evaluate(() => {
    const b = document.querySelector('#wgList .wg-card .wg-gen-badge');
    const details = Array.from(document.querySelectorAll('#wgList .wg-card .wg-mtu-note')).map(d => d.textContent).join('\n');
    return { badge: b ? b.textContent : null, details };
  });
}

async function loadProfiles(page, files) {
  await page.waitForTimeout(150);
  await page.locator('#wgFile').setInputFiles(files);
  try {
    await page.waitForFunction(f => wgUploadPending === false && wgBeans.length === f, files.length, { timeout: 20000 });
  } catch (e) {
    const st = await page.evaluate(() => ({ pending: wgUploadPending, beans: wgBeans.length, rejected: wgRejected.map(r => r.human), status: (document.getElementById('wgStatus')||{}).textContent }));
    throw new Error('loadProfiles timeout, state=' + JSON.stringify(st));
  }
}
async function clearProfiles(page) {
  await page.locator('#wgClear').click();
  await page.waitForFunction(() => wgBeans.length === 0 && wgProfiles.length === 0, null, { timeout: 20000 });
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR:', String(e.message).slice(0, 200)); });
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('button.tab', { hasText: 'Mihomo Config Builder' }).click();

  // === 1. Plain WG → бейдж WG, exact ===
  await loadProfiles(page, [fx('wg-simple-a.conf')]);
  let r = await badgeOf(page);
  assert.equal(r.badge, 'WG', 'plain WG badge: ' + JSON.stringify(r));
  assert.match(r.details, /Протокол: WireGuard/);
  assert.match(r.details, /уверенность: exact/);
  ok('plain WG: бейдж WG, exact');

  // === 2. AWG 3.1 → exact 3.1 + target compatibility note ===
  await clearProfiles(page);
  await loadProfiles(page, [fx('awg31.conf')]);
  r = await badgeOf(page);
  assert.equal(r.badge, 'AWG 3.1', 'awg31 badge: ' + JSON.stringify(r));
  assert.match(r.details, /Протокол: AmneziaWG 3\.1/);
  assert.match(r.details, /уверенность: exact/);
  assert.match(r.details, /1\.19\.30/, 'target note: v3 требует mihomo >= 1.19.30');
  ok('AWG 3.1: exact + target compatibility note');

  // === 3. Premium-like (I1-I5 CPS) → AWG 1.5–2.x range, без false exact ===
  await clearProfiles(page);
  await loadProfiles(page, [fx('wg-awg-i-like.conf')]);
  r = await badgeOf(page);
  assert.equal(r.badge, 'AWG 1.5–2.x', 'premium badge: ' + JSON.stringify(r));
  assert.match(r.details, /1\.5–2\.x/);
  assert.ok(!r.details.includes('уверенность: exact'));
  ok('AWG 1.5–2.x: compatible range, false exact отсутствует');

  // === 4. version: 3 без v3-маркеров → AWG ? (conflict), детерминировано ===
  const conflictConf = [
    '# Synthetic conflict fixture (#157): synthetic keys only.',
    '[Interface]',
    'PrivateKey = AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    'Address = 10.55.0.2/32',
    'Version = 3',
    'Jc = 3',
    '[Peer]',
    'PublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
    'AllowedIPs = 0.0.0.0/0',
    'Endpoint = 198.51.100.55:51820'
  ].join('\n');
  await clearProfiles(page);
  await loadProfiles(page, [fx('awg-version3-conflict.conf')]);
  r = await badgeOf(page);
  assert.equal(r.badge, 'AWG ?', 'conflict badge: ' + JSON.stringify(r));
  assert.match(r.details, /уверенность: conflict/);
  assert.ok(r.details.includes('version: 3'), 'conflict reason назван');
  // детерминизм: повторный renderWgList → тот же бейдж
  const again = await page.evaluate(() => { renderWgList(); return document.querySelector('#wgList .wg-card .wg-gen-badge').textContent; });
  assert.equal(again, 'AWG ?', 'детерминированный бейдж');
  ok('conflict: AWG ?, причина названа, детерминировано');

  // === 5. Диагностика без секретов; bean не мутируется детектором ===
  const secretProbe = await page.evaluate(() => {
    const beanSnapshot = JSON.stringify(wgProfiles[0].bean);
    web4core.detectWireGuardGeneration(wgProfiles[0].bean);
    return {
      unchanged: JSON.stringify(wgProfiles[0].bean) === beanSnapshot,
      cardText: document.getElementById('wgList').textContent,
      keyPrefix: wgProfiles[0].bean.wireguard.privateKey.slice(0, 10)
    };
  });
  assert.equal(secretProbe.unchanged, true, 'детектор не мутирует bean');
  assert.ok(!secretProbe.cardText.includes(secretProbe.keyPrefix), 'ключ в карточке не светится');
  ok('privacy: bean не мутируется, ключи не в DOM');

  // === 6. YAML не меняется от наличия детектора: сборка с 3.1-профилем валидна ===
  await clearProfiles(page);
  await page.locator('#cfgSubMode').uncheck(); // WG-only build: Sub Mode OFF
  await loadProfiles(page, [fx('awg31.conf')]);
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state !== 'VALIDATING', null, { timeout: 20000 });
  const buildState = await page.evaluate(() => ({ state: MIHOMO_VALIDATION_STATE.state, yaml: document.getElementById('mihomoOutput').value }));
  assert.equal(buildState.state, 'VALID', '3.1 build VALID');
  assert.match(buildState.yaml, /version: 3/, '3.1 → version: 3 (существующая семантика сохранена)');
  assert.match(buildState.yaml, /random-trailers/, 'random-trailers перенесён');
  ok('сборка с детектором: YAML-семантика прежняя (version: 3, random-trailers)');

  // === 7. Mobile 360/412/480: бейджи без overflow ===
  await clearProfiles(page);
  await loadProfiles(page, [fx('wg-simple-a.conf'), fx('awg31.conf')]); // оба с бейджами на одной 360-сетке
  for (const w of [360, 412, 480]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(m.sw <= m.iw + 1, w + 'px: без overflow (' + m.sw + ' vs ' + m.iw + ')');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  ok('360/412/480: карточки с бейджами без overflow');

  assert.deepEqual(errors, [], 'no page errors');
  passed += 1;

  console.log('WG generation badge (#157): ' + passed + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

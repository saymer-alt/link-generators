'use strict';
// Header identity context correction (#326/#280): the top bar must reflect the
// ACTIVE identity model — browser-local in v1 projects, portable per-provider
// HWIDs (with explicit no-HWID count) in portable v2 projects — and must never
// suggest that switching the browser device changes already-bound v2 HWIDs.
// All fixtures are synthetic (.invalid URLs, synthetic HWIDs); the header
// renders symbolic counters only, never raw HWID/URL values.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const U = ['https://a.example.invalid/feed', 'https://b.example.invalid/feed', 'https://c.example.invalid/feed'];
const H2 = '22222222222222222222222222222222';
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  page.on('dialog', d => d.accept());

  const header = () => page.evaluate(() => ({
    mode: document.getElementById('deviceIdentityBar').dataset.mode || 'v1',
    mask: document.getElementById('headerDeviceHwidMask').textContent || '',
    actionsVisible: getComputedStyle(document.querySelector('.device-identity-actions')).display !== 'none',
    title: document.getElementById('headerDeviceIdentitySelect').title || ''
  }));
  const buildYamlHwids = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state !== 'VALIDATING', null, { timeout: 20000 });
    return page.evaluate(() => {
      const doc = globalThis.jsyaml.load(document.getElementById('mihomoOutput').value);
      const providers = Object.values(doc['proxy-providers'] || {});
      return providers.map(p => (p.header && Array.isArray(p.header['x-hwid'])) ? p.header['x-hwid'][0] : undefined);
    });
  };

  // === 1. v1: локальное устройство и его маска; действия видны ===
  const localA = await page.evaluate(() => getActiveDeviceIdentity().hwid);
  let h = await header();
  assert.equal(h.mode, 'v1');
  assert.equal(h.mask, 'HWID: ••••••••' + localA.slice(-6));
  assert.equal(h.actionsVisible, true);
  assert.match(h.title, /используют HWID выбранной идентичности/);
  ok('v1: шапка показывает локальное устройство, действия доступны');

  // === 2. Конверсия в v2: символический контекст, локальный HWID скрыт ===
  await page.locator('#mihomoInput').fill(U.join('\n'));
  await page.locator('#cfgSubMode').check();
  await page.evaluate(() => { document.getElementById('deviceIdentityDetails').open = true; }); // идемпотентно раскрыть
  await page.locator('#rbPortableActivateBtn').click();
  await page.waitForFunction(() => document.getElementById('deviceIdentityBar').dataset.mode === 'v2', null, { timeout: 5000 });
  h = await header();
  assert.equal(h.mode, 'v2');
  assert.match(h.mask, /Проект v2 · подписок: 3 · переносимых HWID: 1 · без HWID: 0/);
  assert.ok(!h.mask.includes(localA), 'локальный HWID не показывается как HWID проекта');
  assert.equal(h.actionsVisible, false, 'reveal/copy локального HWID скрыты в v2-контексте');
  assert.match(h.title, /НЕ меняет назначения проекта/);
  ok('v2 после конверсии: контекст показан, локальный HWID не выдаётся за проектный');

  // === 3. A=H1(дефолт), B=C=H2: счётчики и фактический YAML согласованы ===
  const committed = await page.evaluate(H2 => {
    const first = rbPortableAddAndAssign(rbCollectProject(), 'src-2', { id: 'id-b', label: 'Provider B', hwid: H2 });
    if (!first.ok) return { error: first.error };
    if (!rbPortableCommitMutation(first)) return { error: 'commit-1 failed' };
    const second = rbPortableAssign(rbCollectProject(), 'src-3', 'id-b');
    if (!second.ok) return { error: second.error };
    if (!rbPortableCommitMutation(second)) return { error: 'commit-2 failed' };
    return { done: true };
  }, H2);
  assert.ok(!committed.error, 'v2 assignment: ' + JSON.stringify(committed));
  h = await header();
  assert.match(h.mask, /переносимых HWID: 2 · без HWID: 0/, 'маска: ' + h.mask);
  const yamlHwids = await buildYamlHwids();
  assert.deepEqual(yamlHwids, [localA, H2, H2], 'YAML: A=H1, B=C=H2');
  ok('A=H1/B=C=H2: счётчик «переносимых HWID: 2» соответствует YAML');

  // === 4. Явный «без HWID» для src-1: счётчик и отсутствие заголовков ===
  const none = await page.evaluate(() => rbPortableCommitMutation(rbPortableAssign(rbCollectProject(), 'src-1', null)));
  assert.equal(none, true, 'no-HWID binding committed');
  h = await header();
  assert.match(h.mask, /без HWID: 1/, 'маска: ' + h.mask);
  const noneYaml = await buildYamlHwids();
  assert.deepEqual(noneYaml, [undefined, H2, H2], 'src-1 без заголовков идентичности');
  ok('«без HWID»: шапка и YAML согласованы (заголовки отсутствуют)');

  // === 5. Смена браузерного устройства в v2: YAML не меняется, тост объясняет ===
  const v2YamlBefore = noneYaml;
  await page.evaluate(() => createNewDeviceIdentity()); // новая локальная запись + активация
  const localB = await page.evaluate(() => getActiveDeviceIdentity().hwid);
  assert.notEqual(localB, localA);
  const toastAfterCreate = await page.evaluate(() => String(window.__lastToast || ''));
  assert.ok(!toastAfterCreate.includes('назначения не изменены'), 'создание записи — не смена через шапку');
  const reg = await page.evaluate(() => loadDeviceIdentityRegistry());
  const firstDevice = reg.devices.find(d => d.hwid === localA);
  await page.locator('#headerDeviceIdentitySelect').selectOption(firstDevice.id);
  const toastSwitch = await page.evaluate(() => String(window.__lastToast || ''));
  assert.match(toastSwitch, /назначения не изменены/, 'тост: ' + toastSwitch.slice(0, 120));
  assert.equal(await header().then(x => x.mode), 'v2', 'режим остаётся v2');
  const v2YamlAfter = await buildYamlHwids();
  assert.deepEqual(v2YamlAfter, v2YamlBefore, 'переключение браузерного устройства не меняет v2 YAML');
  ok('смена локального устройства в v2: YAML неизменен, тост объясняет');

  // === 6. Возврат к v1: шапка возвращается к локальной модели, YAML следует ===
  await page.locator('#rbPortableReturnBtn').click();
  await page.waitForFunction(() => document.getElementById('deviceIdentityBar').dataset.mode === 'v1', null, { timeout: 5000 });
  h = await header();
  assert.equal(h.mode, 'v1');
  assert.equal(h.mask, 'HWID: ••••••••' + localA.slice(-6), 'активна локальная запись A (device 1 выбран в шаге 5)');
  assert.equal(h.actionsVisible, true);
  const v1Yaml = await buildYamlHwids();
  assert.deepEqual(v1Yaml, [localA, localA, localA], 'v1: все провайдеры используют активный локальный HWID');
  ok('v1→v2→v1: шапка и YAML согласованы на каждом переходе');

  // === 7. Приватность: символические счётчики, никаких raw значений ===
  await page.evaluate(() => { document.getElementById('deviceIdentityDetails').open = true; });
  await page.locator('#rbPortableActivateBtn').click(); // снова v2
  const maskText = await page.evaluate(() => document.getElementById('headerDeviceHwidMask').textContent || '');
  for (const secret of [localA, H2, ...U]) assert.ok(!maskText.includes(secret), 'маска без raw значений');
  ok('приватность: в шапке v2 только счётчики, без HWID/URL');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('Header identity context (#326/#280): ' + passed + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

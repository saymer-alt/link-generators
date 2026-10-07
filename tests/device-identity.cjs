// Subscription device identity (#156, v1.10) — browser regression.
// Контракт: ОДИН логический генерируемый объект = ОДНА стабильная
// идентичность (HWID):
//   - preview-запросы и ВСЕ proxy-providers конфига несут один и тот же
//     x-hwid (runtime-опция deviceHwid, web4core#16);
//   - повторный Build не меняет HWID (раньше: свежий generateSecretHex32()
//     на каждого провайдера и на каждую сборку);
//   - reload страницы и смена Device Model не меняют HWID;
//   - «➕ Новое устройство» — единственный способ получить другую
//     идентичность (второй роутер из того же браузера);
//   - HWID не отображается в UI/диагностике и не хранится нигде кроме
//     реестра link-generators.device-identities.v1;
//   - миграция: legacy-ключ link-generators.subscription-preview-hwid.v1
//     становится идентичностью первого устройства (панель не получает
//     лишний device-слот после обновления).
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const REGISTRY_KEY = 'link-generators.device-identities.v1';
const LEGACY_KEY = 'link-generators.subscription-preview-hwid.v1';
const SUB = 'https://identity-probe.example.invalid/sub';
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));

  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state !== 'VALIDATING', null, { timeout: 20000 });
    return page.evaluate(() => ({
      state: MIHOMO_VALIDATION_STATE.state,
      yaml: document.getElementById('mihomoOutput').value,
      toast: String(window.__lastToast || '')
    }));
  };
  // jsyaml цитирует число-подобные 32-hex значения (0b…/0x…/все цифры) —
  // кавычки опциональны, иначе разбор флейпит в зависимости от random.
  const providerHwids = yaml => [...yaml.matchAll(/^\s+x-hwid:\s*\n\s+- "?([A-Za-z0-9=-]+)"?\s*$/gm)].map(m => m[1]);
  const registry = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), REGISTRY_KEY);
  const activeHwid = () => page.evaluate(() => getActiveDeviceIdentity().hwid);

  // === 1. Миграция: legacy preview-HWID становится идентичностью устройства 1 ===
  const LEGACY_HWID = 'a'.repeat(32) + 'b'.repeat(0); // 32-hex
  await page.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch (_) {}
  }, [LEGACY_KEY, LEGACY_HWID]);
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.evaluate(() => {
    document.getElementById('mihomoInput').value = 'https://identity-probe.example.invalid/sub\n';
    document.getElementById('mihomoInput').dispatchEvent(new Event('input', { bubbles: true }));
  });
  let reg = await registry();
  assert.ok(reg && reg.version === 1 && reg.devices.length === 1, 'реестр создан при первом доступе к идентичности');
  assert.equal(reg.devices[0].hwid, LEGACY_HWID, 'legacy preview-HWID мигрировал в устройство 1');
  assert.equal(await page.evaluate(k => localStorage.getItem(k), LEGACY_KEY), LEGACY_HWID, 'legacy-ключ не удаляется молча');
  ok('миграция: legacy preview-HWID → идентичность устройства 1, ключ сохранён');

  // === 2. Preview HWID == активная идентичность; provider HWID == preview HWID ===
  // Заглушка fetchSubscription захватывает preview-заголовки (Sub OFF expand).
  await page.evaluate(() => {
    globalThis.__identityFetchHeaders = [];
    globalThis.__identityFetchOriginal = web4core.fetchSubscription;
    web4core.fetchSubscription = async (url, options) => {
      globalThis.__identityFetchHeaders.push(Object.assign({}, options && options.headers));
      return 'vless://00000000-0000-4000-8000-0000000000c1@192.0.2.201:443#ID-ONE\nvless://00000000-0000-4000-8000-0000000000c2@192.0.2.202:443#ID-TWO';
    };
  });
  await page.locator('#cfgSubMode').uncheck();
  await build(); // Sub OFF: разворачивание вызывает fetchSubscription с preview-заголовками
  let headers = await page.evaluate(() => globalThis.__identityFetchHeaders);
  assert.ok(headers.length >= 1);
  const previewHwid = headers[0]['x-hwid'];
  assert.equal(previewHwid, await activeHwid(), 'preview использует HWID активного устройства');
  // Переключаемся в Sub Mode ON: provider-заголовки в YAML.
  await page.locator('#cfgSubMode').check();
  const r1 = await build();
  assert.equal(r1.state, 'VALID', 'Sub Mode ON build: ' + r1.toast);
  const hwids1 = providerHwids(r1.yaml);
  assert.equal(hwids1.length, 1, 'один провайдер — один x-hwid');
  assert.equal(hwids1[0], previewHwid, 'provider HWID == preview HWID (один логический объект)');
  ok('preview HWID == provider HWID == активная идентичность устройства');

  // === 3. Provider#1 == Provider#2; Build#1 == Build#2 ===
  await page.evaluate(() => {
    const el = document.getElementById('mihomoInput');
    el.value = 'https://identity-probe.example.invalid/sub\nhttps://identity-probe-2.example.invalid/sub2\n';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const r2a = await build();
  const hwids2a = providerHwids(r2a.yaml);
  assert.equal(hwids2a.length, 2, 'два провайдера');
  assert.equal(hwids2a[0], hwids2a[1], 'оба провайдера несут ОДИН HWID');
  const r2b = await build();
  assert.deepEqual(providerHwids(r2b.yaml), hwids2a, 'повторный Build — тот же HWID (без ротации)');
  ok('provider#1 == provider#2; Build#1 == Build#2 (идентичность не ротируется)');

  // === 4. reload → тот же HWID; смена Device Model → тот же HWID ===
  await page.reload();
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  assert.equal(await activeHwid(), previewHwid, 'после reload идентичность та же');
  await page.evaluate(() => {
    const el = document.getElementById('mihomoInput');
    el.value = 'https://identity-probe.example.invalid/sub\nhttps://identity-probe-2.example.invalid/sub2\n';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#deviceModelInput').fill('Renamed-Model-XYZ');
  const r3 = await build();
  assert.deepEqual(providerHwids(r3.yaml), hwids2a, 'Device Model — только подпись, HWID не меняется');
  ok('reload и смена Device Model не меняют идентичность');

  // === 5. «ID для другого устройства» → новая идентичность; переключение туда-обратно ===
  await page.locator('#deviceIdentityDetails').evaluate(el => { el.open = true; });
  assert.match(await page.locator('#deviceIdentityDetails').innerText(), /Для обычной пересборки текущего устройства новый ID создавать не нужно/i);
  assert.match(await page.locator('#btnDeviceIdentityNew').innerText(), /ID для другого устройства/i);
  await page.locator('#btnDeviceIdentityNew').click();
  const newHwid = await activeHwid();
  assert.notEqual(newHwid, previewHwid, 'явная операция создала другой HWID');
  reg = await registry();
  assert.equal(reg.devices.length, 2, 'в реестре два устройства');
  assert.equal(new Set(reg.devices.map(d => d.hwid)).size, 2, 'HWID двух устройств не коллидируют');
  assert.equal(new Set(reg.devices.map(d => d.id)).size, 2, 'id двух устройств не коллидируют');
  const secondDeviceHwid = reg.devices[1].hwid;
  const r4 = await build();
  assert.deepEqual(providerHwids(r4.yaml), [newHwid, newHwid], 'новая сборка использует новую идентичность');
  // переключение обратно через селектор
  await page.evaluate(devices => {
    const sel = document.getElementById('deviceIdentitySelect');
    sel.value = devices[0].id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, reg.devices);
  assert.equal(await activeHwid(), previewHwid, 'переключение селектором возвращает старую идентичность');
  ok('другой роутер получает отдельный ID; обычная пересборка явно не требует нового ID');

  // === 6. Локальное переименование сохраняется и НЕ меняет HWID ===
  await page.evaluate(() => { window.prompt = () => 'Дом NC-1812'; });
  const beforeRenameHwid = await activeHwid();
  await page.locator('#btnDeviceIdentityRename').click();
  assert.equal(await activeHwid(), beforeRenameHwid, 'переименование не меняет HWID');
  reg = await registry();
  assert.equal(reg.devices.find(d => d.id === reg.activeId).label, 'Дом NC-1812', 'локальная метка переименована');
  assert.equal(reg.devices[1].hwid, secondDeviceHwid, 'переименование первого устройства не меняет второе');
  await page.reload();
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  assert.match(await page.locator('#deviceIdentityCurrentLabel').innerText(), /Дом NC-1812/);
  assert.equal(await activeHwid(), beforeRenameHwid, 'переименование переживает reload без смены HWID');
  ok('переименование: локальная метка сохраняется, HWID не меняется');

  // === 7. «Сменить ID» — только явная random-ротация с подтверждением ===
  await page.locator('#deviceIdentityDetails').evaluate(el => { el.open = true; });
  await page.evaluate(() => { window.confirm = () => true; });
  const beforeRegenerate = await activeHwid();
  reg = await registry();
  const deviceCountBeforeRegenerate = reg.devices.length;
  await page.locator('#btnDeviceIdentityRegenerate').click();
  const afterRegenerate = await activeHwid();
  assert.notEqual(afterRegenerate, beforeRegenerate, 'явная смена ID генерирует новый HWID');
  reg = await registry();
  assert.equal(reg.devices.length, deviceCountBeforeRegenerate, 'смена ID не создаёт новый локальный device record');
  assert.equal(reg.devices.find(d => d.id === reg.activeId).label, 'Дом NC-1812', 'локальная метка сохранена при смене ID');
  assert.equal(reg.devices[1].hwid, secondDeviceHwid, 'смена ID первого устройства не меняет второе');
  ok('«Сменить ID»: явная ротация HWID без создания лишней записи');

  // === 8. Удаление активной identity → детерминированный fallback; last identity удалить нельзя ===
  await page.locator('#deviceModelInput').fill('Keep-Device-Model');
  reg = await registry();
  const secondId = reg.devices[1].id;
  await page.evaluate(id => {
    const sel = document.getElementById('deviceIdentitySelect');
    sel.value = id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, secondId);
  assert.equal(await activeHwid(), secondDeviceHwid, 'перед удалением выбрана вторая identity');
  await page.locator('#btnDeviceIdentityDelete').click();
  reg = await registry();
  assert.equal(reg.devices.length, 1, 'выбранная identity удалена из локального реестра');
  assert.equal(reg.activeId, reg.devices[0].id, 'после удаления активна оставшаяся identity');
  assert.equal(await page.locator('#deviceModelInput').inputValue(), 'Keep-Device-Model', 'удаление identity не меняет Device Model');
  assert.equal(await page.locator('#btnDeviceIdentityDelete').isDisabled(), true, 'последнюю identity удалить через UI нельзя');
  const onlyHwid = reg.devices[0].hwid;
  await page.evaluate(() => deleteActiveDeviceIdentity());
  const regAfterLastDeleteAttempt = await registry();
  assert.equal(regAfterLastDeleteAttempt.devices.length, 1, 'защита функции не удаляет последнюю identity');
  assert.equal(regAfterLastDeleteAttempt.devices[0].hwid, onlyHwid, 'последний HWID не изменён');
  ok('удаление: local-only, deterministic fallback, последний ID защищён');

  // === 9. Приватность: HWID не светится в UI/диагностике; storage не хранит данные ===
  const uiText = await page.evaluate(() => {
    const ids = ['subListStats', 'subscriptionPreviewStats', 'subscriptionPreviewWarning', 'subListStatus', 'subModeHint', 'mihomoOutput'];
    return ids.map(id => (document.getElementById(id) || {}).textContent || '').join(' | ') + ' | ' + String(window.__lastToast || '');
  });
  const hwidProbe = await activeHwid();
  assert.ok(!uiText.includes(hwidProbe), 'HWID не отображается в сводках/статусах/выводе');
  const storeDump = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!storeDump.includes(SUB) && !storeDump.includes('identity-probe'), 'URL подписок не сохраняются');
  assert.ok(!storeDump.includes('Renamed-Model-XYZ'), 'Device Model не сохраняется');
  assert.ok(!/\bID-ONE\b|\bID-TWO\b/.test(storeDump), 'имена узлов не сохраняются');
  ok('приватность: HWID только в реестре; URL/имена/Device Model не хранятся');

  // === 10. Sub Mode OFF: build без провайдеров не пишет лишнего в реестр ===
  const regBefore = await registry();
  await page.locator('#cfgSubMode').uncheck();
  await build();
  assert.deepEqual(await registry(), regBefore, 'реестр не мутирует при обычных сборках');
  ok('реестр стабилен вне идентичностных операций');

  assert.deepEqual(errors, [], 'no page errors');
  passed += 1;

  console.log('Device identity (#156/#163): ' + passed + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

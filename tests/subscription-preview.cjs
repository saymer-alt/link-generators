// Subscription preview hardening (#152) — browser regression.
// Контракты (owner FIELD-OBSERVED + SOURCE-PROVEN, issue #152):
//   1. loading-state всегда завершается: stale/cancel/error/повторный клик
//      никогда не оставляют кнопку в «Загрузка…» без активного запроса;
//   2. UNKNOWN ≠ 0: непрочитанные подписки — «количество узлов: неизвестно»,
//      доказанный ноль только при 100% успешно прочитанных пустых подписках;
//   3. PARTIAL честно помечает частичный успех;
//   4. direct fail → fallback success / fallback fail: итог показывает
//      реальную причину (fallback-этап, runtime: 'Direct: …; Fallback: …'),
//      а не stale-причину direct-попытки;
//   5. bounded preview budget: вся операция ограничена дедлайном;
//   6. обе визуальные сводки (subListStats + subscriptionPreviewStats)
//      считают одну модель (union regex + checkbox, без double-count) и
//      обновляются live;
//   7. Device Model: webUiRow < deviceModelRow < excludeFilterRow;
//   8. privacy: ни URL/токен подписки, ни содержимое не попадают в
//      UI/localStorage; предупреждения показывают '[URL hidden]'.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const NODE = 'vless://uuid-@host.example:443?encryption=none&security=tls&sni=example.com#';
const links = (n, prefix = 'Node') => Array.from({ length: n }, (_, i) => NODE + prefix + '-' + String(i + 1).padStart(2, '0')).join('\n');
const SUB1 = 'https://subscription-one.invalid/token-a';
const SUB2 = 'https://subscription-two.invalid/token-b';
const WORKER = 'sub.saymer-87.workers.dev';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

let cases = 0;
const ok = name => { cases++; console.log('  ok —', name); };

async function statsText(page) {
  return page.evaluate(() => document.getElementById('subscriptionPreviewStats').textContent);
}
async function upperStats(page) {
  return page.evaluate(() => document.getElementById('subListStats').textContent);
}
async function statusText(page) {
  return page.evaluate(() => document.getElementById('subListStatus').textContent);
}
async function btnLabel(page) {
  return page.evaluate(() => document.getElementById('subListFetchBtn').textContent);
}
async function warningText(page) {
  return page.evaluate(() => document.getElementById('subscriptionPreviewWarning').textContent);
}
async function listedCount(page) {
  return page.evaluate(() => document.querySelectorAll('#subscriptionPreviewNames .sub-list-item').length);
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('button.tab', { hasText: 'Mihomo Config Builder' }).click();

  const setup = async () => {
    await page.evaluate(({ SUB1, SUB2 }) => {
      document.getElementById('cfgServerList').checked = true;
      document.getElementById('cfgServerList').dispatchEvent(new Event('change'));
      document.getElementById('mihomoInput').value = SUB1 + '\n' + SUB2 + '\n';
      document.getElementById('mihomoInput').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('excludeFilterInput').value = '';
      document.getElementById('subListSearch').value = '';
    }, { SUB1, SUB2 });
    // сброс состояния выбор/список между сценариями
    await page.evaluate(() => {
      subscriptionListNames = [];
      subscriptionListNodes = 0;
      subscriptionSelection.clear();
      updateServerListStats();
      updateSubSelectionNote();
      renderServerList();
      document.getElementById('subListControls').style.display = 'none';
      document.getElementById('subListStatus').style.display = 'none';
      document.getElementById('subListStatus').textContent = '';
      document.getElementById('subListFetchBtn').textContent = '📋 Обновить список';
      clearSubscriptionPreview();
    });
  };

  // === 1. 2/2 success ===
  await setup();
  await page.route(SUB1, r => r.fulfill({ status: 200, headers: CORS, body: links(5, 'Main') }));
  await page.route(SUB2, r => r.fulfill({ status: 200, headers: CORS, body: links(7, 'Alt') }));
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#subscriptionPreviewNames .sub-list-item').length > 0, null, { timeout: 15000 });
  let s = await statsText(page);
  assert.match(s, /preview: 2\/2/, 'stats: ' + s);
  assert.match(s, /найдено узлов: 12/, 'stats: ' + s);
  assert.match(s, /после фильтра: 12/, 'stats: ' + s);
  assert.equal(await listedCount(page), 12, 'уникальные имена в списке');
  assert.equal(await btnLabel(page), '📋 Обновить список', 'кнопка вернулась в idle');
  assert.equal(await statusText(page), '', 'SUCCESS: статусная строка пуста');
  ok('2/2 success: preview 2/2, найдено 12, кнопка в idle');

  // === 2. true empty success (обе подписки прочитаны, узлов нет) ===
  await setup();
  await page.route(SUB1, r => r.fulfill({ status: 200, headers: CORS, body: '' }));
  await page.route(SUB2, r => r.fulfill({ status: 200, headers: CORS, body: '\n\n' }));
  // Пустое тело не распознаётся как успех сразу: runtime проходит fallback
  // chain — воркер тоже отвечает пустым телом, финальная классификация
  // 'Subscription returned no valid links' = успешно прочитанная пустая подписка.
  await page.route('https://' + WORKER + '/**', r => r.fulfill({ status: 200, headers: CORS, body: '' }));
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subscriptionPreviewBox').style.display !== 'none', null, { timeout: 25000 });
  await page.waitForFunction(() => !document.getElementById('subscriptionPreviewStats').textContent.includes('preview:') || document.getElementById('subscriptionPreviewStats').textContent.includes('preview: 2/2'), null, { timeout: 25000 });
  s = await statsText(page);
  assert.match(s, /preview: 2\/2/, 'stats: ' + s);
  assert.match(s, /найдено узлов: 0/, 'честный доказанный ноль: ' + s);
  assert.ok(!s.includes('неизвестно'), 'пустой успех — не UNKNOWN: ' + s);
  assert.equal(await btnLabel(page), '📋 Обновить список');
  ok('true empty success: 2/2 прочитано, доказанный 0 узлов');

  // === 3. 0/2 failed → UNKNOWN (не 0) ===
  await setup();
  await page.route(SUB1, r => r.abort());
  await page.route(SUB2, r => r.abort());
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subListFetchBtn').textContent === '📋 Обновить список', null, { timeout: 20000 });
  s = await statsText(page);
  assert.match(s, /preview: 0\/2/, 'stats: ' + s);
  assert.match(s, /количество узлов: неизвестно/, 'UNKNOWN семантика: ' + s);
  assert.ok(!/найдено узлов: 0/.test(s), 'UNKNOWN не должен выглядеть как доказанный 0: ' + s);
  assert.match(await statusText(page), /Получить список не удалось/);
  const w3 = await warningText(page);
  assert.match(w3, /Не удалось получить preview подписки #1/, 'warning #1');
  assert.match(w3, /Не удалось получить preview подписки #2/, 'warning #2');
  assert.ok(!w3.includes('token-a') && !w3.includes('token-b') && !w3.includes('subscription-'), 'URL/токен не утекают в предупреждения');
  // abort-сообщение ('Failed to fetch') вообще не содержит URL — маска не нужна
  ok('0/2 failed: UNKNOWN ≠ 0, статус FAILED, URL скрыт');

  // === 4. 1/2 success → PARTIAL ===
  await setup();
  await page.route(SUB1, r => r.fulfill({ status: 200, headers: CORS, body: links(4, 'Main') }));
  await page.route(SUB2, r => r.abort());
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subListFetchBtn').textContent === '📋 Обновить список', null, { timeout: 20000 });
  s = await statsText(page);
  assert.match(s, /preview: 1\/2/, 'stats: ' + s);
  assert.match(s, /найдено в доступных подписках: 4/, 'stats: ' + s);
  assert.match(s, /общий итог неизвестен/, 'PARTIAL: ' + s);
  assert.match(await statusText(page), /Часть подписок недоступна/);
  ok('1/2 success: PARTIAL, общий итог честно неизвестен');

  // === 5. direct fail → fallback success ===
  await setup();
  await page.route(SUB1, r => r.abort());
  await page.route(SUB2, r => r.abort());
  await page.route('https://' + WORKER + '/**', r => {
    // POST-контракт воркера: {url, headers} — ответ выбирается по target
    const target = (() => { try { return JSON.parse(r.request().postData() || '{}').url; } catch (_) { return ''; } })();
    const body = target === SUB1 ? links(6, 'Main') : links(6, 'Alt');
    r.fulfill({ status: 200, headers: CORS, body });
  });
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subListFetchBtn').textContent === '📋 Обновить список', null, { timeout: 25000 });
  s = await statsText(page);
  assert.match(s, /preview: 2\/2/, 'fallback вытащил обе подписки: ' + s);
  assert.match(s, /найдено узлов: 12/, 'stats: ' + s);
  assert.equal(await listedCount(page), 12);
  ok('direct fail → fallback success: 2/2 через воркер');

  // === 6. direct fail → fallback fail (другая причина) → честный итог ===
  await setup();
  await page.route(SUB1, r => r.abort());
  await page.route(SUB2, r => r.abort());
  await page.route('https://' + WORKER + '/**', r => r.fulfill({ status: 503, headers: CORS, body: 'upstream unavailable' }));
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subListFetchBtn').textContent === '📋 Обновить список', null, { timeout: 30000 });
  s = await statsText(page);
  assert.match(s, /preview: 0\/2/, 'stats: ' + s);
  assert.match(s, /количество узлов: неизвестно/);
  const w6 = await warningText(page);
  // Runtime (web4core#16): итог называет ОБА этапа, а не только stale direct.
  assert.match(w6, /Fallback: 503/, 'реальная причина fallback-этапа: ' + w6);
  assert.match(w6, /Direct: /, 'причина direct-этапа: ' + w6);
  ok('direct fail → fallback fail 503: сообщение содержит Direct + Fallback причины');

  // === 7. stale race: медленный fetch + правка ввода ===
  await setup();
  await page.route(SUB1, async r => { await new Promise(res => setTimeout(res, 1500)); r.fulfill({ status: 200, headers: CORS, body: links(9, 'Main') }); });
  await page.route(SUB2, async r => { await new Promise(res => setTimeout(res, 1500)); r.fulfill({ status: 200, headers: CORS, body: links(9, 'Alt') }); });
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subListFetchBtn').textContent === 'Загрузка…', null, { timeout: 5000 });
  // правка ввода во время полёта
  await page.evaluate(() => {
    const el = document.getElementById('mihomoInput');
    el.value = 'https://subscription-three.invalid/token-c\n';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await btnLabel(page), '📋 Обновить список', 'кнопка немедленно в idle после инвалидации');
  assert.match(await statusText(page), /Список устарел — нажмите/);
  await page.waitForTimeout(2200); // старые ответы пришли
  assert.equal(await listedCount(page), 0, 'stale-данные не записаны');
  assert.equal(await btnLabel(page), '📋 Обновить список', 'кнопка не «Загрузка…»');
  s = await statsText(page);
  assert.ok(!s.includes('Node-'), 'старые имена не применились');
  // повторный явный refresh работает
  await page.route('https://subscription-three.invalid/**', r => r.fulfill({ status: 200, headers: CORS, body: links(3) }));
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#subscriptionPreviewNames .sub-list-item').length > 0, null, { timeout: 15000 });
  assert.equal(await listedCount(page), 3);
  ok('stale race: кнопка в idle, STALE-статус, старые данные отвергнуты, явный refresh работает');

  // === 8. повторный клик во время загрузки ===
  await setup();
  let hits = 0;
  await page.route(SUB1, async r => { hits++; await new Promise(res => setTimeout(res, 700)); r.fulfill({ status: 200, headers: CORS, body: links(2, 'Main') }); });
  await page.route(SUB2, r => r.fulfill({ status: 200, headers: CORS, body: links(2, 'Alt') }));
  await page.locator('#subListFetchBtn').click();
  await page.waitForTimeout(120);
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subListFetchBtn').textContent === '📋 Обновить список', null, { timeout: 15000 });
  await page.waitForTimeout(1200); // дождаться завершения обоих запросов
  assert.equal(await btnLabel(page), '📋 Обновить список', 'после обоих запросов кнопка в idle');
  assert.equal(await listedCount(page), 4, 'список от последней операции (Main-1..2 + Alt-1..2)');
  ok('повторный refresh: без залипания, финальное состояние консистентно');

  // === 9. bounded preview budget ===
  await setup();
  await page.evaluate(() => { SUBSCRIPTION_PREVIEW_BUDGET_MS = 1500; });
  await page.route(SUB1, async r => { await new Promise(res => setTimeout(res, 8000)); r.fulfill({ status: 200, headers: CORS, body: links(2, 'Main') }); });
  await page.route(SUB2, async r => { await new Promise(res => setTimeout(res, 8000)); r.fulfill({ status: 200, headers: CORS, body: links(2, 'Alt') }); });
  const t0 = Date.now();
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subListFetchBtn').textContent === '📋 Обновить список', null, { timeout: 10000 });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 6000, 'операция ограничена бюджетом, elapsed=' + elapsed + 'ms');
  s = await statsText(page);
  assert.match(s, /preview: 0\/2/, 'stats: ' + s);
  const w9 = await warningText(page);
  assert.match(w9, /бюджет preview/, 'budget-причина названа: ' + w9);
  await page.evaluate(() => { SUBSCRIPTION_PREVIEW_BUDGET_MS = 60000; });
  ok('bounded budget: операция завершена ~за бюджет, причина честно названа');

  // === 10. live-сводки: checkbox 0/1/3/all + overlap + «Снять все» ===
  await setup();
  await page.route(SUB1, r => r.fulfill({ status: 200, headers: CORS, body: links(5, 'Main') }));
  await page.route(SUB2, r => r.fulfill({ status: 200, headers: CORS, body: links(5, 'Alt') }));
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#subscriptionPreviewNames .sub-list-item').length > 0, null, { timeout: 15000 });
  // 0 selected — baseline
  assert.match(await upperStats(page), /исключается: 0/);
  assert.match(await statsText(page), /исключено: 0/);
  const check = async (label) => {
    await page.locator('#subscriptionPreviewNames .sub-list-item', { hasText: label }).locator('input').check();
  };
  await check('Main-01');
  assert.match(await upperStats(page), /исключается: 1 .*останется: 9/, 'upper live: ' + await upperStats(page));
  assert.match(await statsText(page), /после фильтра: 9 .*исключено: 1/, 'lower live: ' + await statsText(page));
  await check('Main-02');
  await check('Main-03');
  assert.match(await upperStats(page), /исключается: 3 .*останется: 7/, 'upper: ' + await upperStats(page));
  assert.match(await statsText(page), /после фильтра: 7 .*исключено: 3/, 'lower: ' + await statsText(page));
  // overlap: regex покрывает Node-02 (уже выбран) и Node-04 → union = 4, не 5
  await page.evaluate(() => {
    const el = document.getElementById('excludeFilterInput');
    el.value = 'Main-0[24]';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(50);
  assert.match(await upperStats(page), /исключается: 4 .*останется: 6/, 'union без double-count (upper): ' + await upperStats(page));
  assert.match(await statsText(page), /после фильтра: 6 .*исключено: 4/, 'union без double-count (lower): ' + await statsText(page));
  // «Снять все» → baseline от regex
  await page.locator('#subListNone').click();
  assert.match(await upperStats(page), /исключается: 2 .*останется: 8/, 'после Снять все остаётся только regex: ' + await upperStats(page));
  assert.match(await statsText(page), /после фильтра: 8 .*исключено: 2/, 'lower после Снять все: ' + await statsText(page));
  // правка regex не стирает список (#152: имена не зависят от фильтра)
  await page.evaluate(() => {
    const el = document.getElementById('excludeFilterInput');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(50);
  assert.equal(await listedCount(page), 10, 'список пережил правку фильтра');
  assert.match(await upperStats(page), /исключается: 0/);
  ok('live-сводки: 0/1/3/union/Снять все/правка фильтра — обе сводки согласованы');

  // === 11. UX Architecture 2.0: device/filter grouped with subscriptions ===
  const pos = await page.evaluate(() => {
    const t = id => document.getElementById(id).getBoundingClientRect().top;
    return { dm: t('deviceModelRow'), ex: t('excludeFilterRow'),
      subscriptions: document.getElementById('deviceModelRow').closest('section').getAttribute('aria-labelledby'),
      dashboard: document.getElementById('webUiRow').closest('section').getAttribute('aria-labelledby') };
  });
  assert.ok(pos.dm < pos.ex, 'Device Model перед Exclude Filter: ' + JSON.stringify(pos));
  assert.equal(pos.subscriptions, 'ux-start'); assert.equal(pos.dashboard, 'ux-start');
  assert.equal(await page.evaluate(() => document.getElementById('deviceModelRow').style.display), '', 'Device Model виден и в Sub Mode OFF');
  ok('Device Model/Exclude Filter рядом с подписками; Web UI в основных настройках');

  // === 12. mobile: панель списка без горизонтального overflow ===
  for (const w of [360, 412, 480]) {
    await page.setViewportSize({ width: w, height: 850 });
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, panel: document.getElementById('serverListPanel').getBoundingClientRect() }));
    assert.ok(m.sw <= m.iw + 1.5, w + 'px: scrollWidth=' + m.sw + ' > innerWidth=' + m.iw);
    assert.ok(m.panel.left >= -1 && m.panel.right <= m.iw + 1.5, w + 'px: панель в пределах вьюпорта');
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  ok('360/412/480: панель серверов без overflow');

  // === 12b. Resizable node list (#166): resize visual-only ===
  const rz = await page.evaluate(() => {
    for (const id of ['subscriptionPreviewNames', 'subscriptionPreviewNamesLegacy']) {
      const el = document.getElementById(id);
      const st = getComputedStyle(el);
      if (st.resize !== 'vertical' || st.overflow !== 'auto') return { id, fail: 'resize/overflow', resize: st.resize, overflow: st.overflow };
      if (parseInt(st.minHeight, 10) < 130 || parseInt(st.minHeight, 10) > 150) return { id, fail: 'min-height', mh: st.minHeight };
      // getComputedStyle резолвит 70vh в px на текущем вьюпорте — проверяем величину
      const maxPx = parseInt(st.maxHeight, 10);
      if (!(String(st.maxHeight).includes('vh') || (maxPx >= 400 && maxPx <= 1200))) return { id, fail: 'max-height', mh: st.maxHeight };
    }
    // изменение высоты — чисто визуальное: fingerprint/YAML не меняются
    const before = buildStateFingerprint();
    document.getElementById('subscriptionPreviewNames').style.height = '400px';
    const after = buildStateFingerprint();
    document.getElementById('subscriptionPreviewNames').style.height = '';
    return { fail: before !== after ? 'fingerprint changed' : null };
  });
  assert.equal(rz.fail, null, 'resizable list contract: ' + JSON.stringify(rz));
  ok('resizable node list (#166): resize:vertical 140px..70vh, visual-only (fingerprint не меняется)');

  // === 12c. #158 R1: preview-partial marker — честное «Preview неполный» ===
  await setup();
  await page.route(SUB1, r => r.fulfill({ status: 200, headers: CORS, body: links(3, 'Main') + '\nsnell://203.0.113.60:6160?psk=TESTPSK#SnellNode\nssr://dGVzdA' }));
  await page.route(SUB2, r => r.fulfill({ status: 200, headers: CORS, body: links(1, 'Alt') }));
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subscriptionPreviewWarning').textContent.includes('Preview неполный'), null, { timeout: 20000 });
  const w158 = await warningText(page);
  assert.match(w158, /Preview неполный: 2 элемент/, 'R1 warning: ' + w158);
  assert.match(w158, /snell,ssr/);
  assert.ok(!w158.includes('TESTPSK') && !w158.includes('dGVzdA'), 'содержимое отброшенных строк не светится');
  assert.equal(await listedCount(page), 4, 'поддержанные узлы в списке');
  ok('#158 R1: preview-partial маркер → честное «Preview неполный», контент не утекает');

  // === 12d. #158 R2: Clash YAML — явное сообщение, не generic error ===
  await setup();
  await page.route(SUB1, r => r.fulfill({ status: 200, headers: CORS, body: 'proxies:\n  - name: clash-node\n    type: ss\n    server: 203.0.113.70\n    port: 8388\n    cipher: aes-128-gcm\n    password: CLASHPASS\n' }));
  await page.route(SUB2, r => r.fulfill({ status: 200, headers: CORS, body: links(2, 'Alt') }));
  await page.locator('#subListFetchBtn').click();
  await page.waitForFunction(() => document.getElementById('subscriptionPreviewWarning').textContent.includes('Clash/Mihomo YAML'), null, { timeout: 20000 });
  const w158b = await warningText(page);
  assert.match(w158b, /Подписка #1 возвращена в Clash\/Mihomo YAML/, 'R2 explicit: ' + w158b);
  assert.match(w158b, /Импорт узлов из Mihomo/, 'R2 направляет в Runtime Import');
  assert.ok(!w158b.includes('CLASHPASS') && !w158b.includes('203.0.113.70'), 'YAML-содержимое не светится');
  ok('#158 R2: Clash YAML назван прямо, направление в Runtime Import, без содержимого');

  // === 13. privacy: localStorage ===
  const store = await page.evaluate(() => ({ keys: Object.keys(localStorage), dump: JSON.stringify(localStorage) }));
  const IDENTITY_KEYS = ['link-generators.device-identities.v1', 'link-generators.subscription-preview-hwid.v1'];
  assert.ok(store.keys.every(k => IDENTITY_KEYS.includes(k)), 'localStorage: только identity-ключи (#152/#156); фактические ключи: ' + store.keys.join(','));
  assert.ok(!store.dump.includes('token-a') && !store.dump.includes('token-b') && !store.dump.includes('token-c'), 'токены подписок не сохраняются');
  assert.ok(!store.dump.includes('Node-0') && !store.dump.includes('Main-0') && !store.dump.includes('Alt-0'), 'имена узлов не сохраняются в localStorage');
  ok('privacy: localStorage чист (только identity-хранилище, не данные)');

  assert.deepEqual(errors, [], 'no page errors');
  cases += 1;

  console.log('Subscription preview hardening (#152): ' + cases + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

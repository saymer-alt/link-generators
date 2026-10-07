// Mihomo Runtime Node Import (#159) — browser regression.
// Контракт: второй источник имён для ТОЙ ЖЕ exclude-модели. Импортер только
// ЧИТАЕТ (GET /providers/proxies / paste / upload .json): без API-мутаций,
// без перезаписи YAML, без fallback-воркеров. Retain-модель — минимум
// безопасных полей (имена/alive/delay/type); server/UUID/пароли/ключи/URL
// отбрасываются парсером. Secret/URL/JSON — только память вкладки. Прямой
// fetch только по явному клику; generic-ошибка сети не выдаётся за
// CORS_DENIED/PERMISSION_DENIED. Reconciliation preview∩runtime/only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const CONTROLLER = '10.0.6.78:9090';
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

const RUNTIME_JSON = JSON.stringify({
  providers: {
    Sub1: {
      vehicleType: 'HTTP',
      updatedAt: '2026-10-07T09:00:00Z',
      proxies: [
        { name: 'AEZA', type: 'Vmess', alive: true, history: [{ delay: 42 }], server: '10.8.0.1', port: 443, uuid: '11111111-2222-4333-8444-555555555555' },
        { name: 'Обычный-Узел-🇷🇺', type: 'Shadowsocks', alive: false, history: [{ delay: 0 }], server: 'secret-host.example', port: 8443, password: 'p@ss' },
        { name: 'Sub1-Common', type: 'Trojan', alive: true, history: [{ delay: 100 }] }
      ]
    },
    Sub2: {
      vehicleType: 'HTTP',
      proxies: [
        { name: 'Sub2-Only', type: 'Ss', alive: true, history: [{ delay: 55 }] },
        { name: 'Sub1-Common', type: 'Trojan', alive: true, history: [{ delay: 99 }] },
        { name: 'AEZA', type: 'Vmess', alive: true, history: [{ delay: 40 }] }
      ]
    },
    Empty: { vehicleType: 'HTTP', proxies: [] }
  }
});
const SUB_URL = 'https://rt-probe.example.invalid/sub';

async function rtStatus(page) {
  return page.evaluate(() => document.getElementById('rtStatus').textContent);
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

  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state !== 'VALIDATING', null, { timeout: 20000 });
    return page.evaluate(() => ({ state: MIHOMO_VALIDATION_STATE.state, yaml: document.getElementById('mihomoOutput').value, toast: String(window.__lastToast || '') }));
  };

  // === 1. Парсер: 2+ провайдера, дубликаты, Unicode, case, alive/delay, empty provider ===
  const parsed = await page.evaluate(json => parseMihomoRuntimeProviders(json), RUNTIME_JSON);
  assert.equal(parsed.providers.length, 3);
  const sub1 = parsed.providers.find(p => p.name === 'Sub1');
  assert.equal(sub1.vehicleType, 'HTTP');
  assert.equal(sub1.proxies.length, 3);
  assert.deepEqual(Object.keys(sub1.proxies[0]).sort(), ['alive', 'delay', 'name', 'type'], 'retain только safe-поля: ' + JSON.stringify(sub1.proxies[0]));
  assert.equal(sub1.proxies[0].name, 'AEZA');
  assert.equal(sub1.proxies[1].name, 'Обычный-Узел-🇷🇺', 'Unicode/case сохранены');
  assert.deepEqual(parsed.providers.find(p => p.name === 'Empty').proxies, [], 'пустой провайдер сохранён');
  ok('парсер: 3 провайдера, дубликаты/Unicode/case, safe-модель, empty provider');

  // === 2. Sensitive extras отбрасываются ===
  const jsonText = RUNTIME_JSON;
  const probe = await page.evaluate(json => {
    const m = parseMihomoRuntimeProviders(json);
    return JSON.stringify(m);
  }, jsonText);
  assert.ok(!probe.includes('10.8.0.1') && !probe.includes('secret-host') && !probe.includes('11111111') && !probe.includes('p@ss'), 'server/port/uuid/password не retained');
  ok('парсер: sensitive extras (server/port/uuid/password) не попадают в модель');

  // === 3. Malformed JSON / нет providers key ===
  for (const [label, bad] of [['malformed', '{"providers": {'], ['no-providers', '{"proxies": {}}'], ['array', '[1,2]'], ['empty', '']]) {
    const err = await page.evaluate(json => {
      try { parseMihomoRuntimeProviders(json); return null; } catch (e) { return e.message; }
    }, bad);
    assert.ok(err && err.startsWith('runtime JSON:'), label + ' → явная ошибка: ' + err);
  }
  ok('парсер: malformed/no-providers/array/empty — fail closed');

  // === 4. Controller URL normalization ===
  const norm = await page.evaluate(() => {
    const out = [];
    for (const input of ['10.0.6.78:9090', 'http://10.0.6.78:9090/', 'https://ctrl.example.net:9090/base/']) {
      try { out.push(normalizeRuntimeController(input)); } catch (e) { out.push('ERR:' + e.message); }
    }
    try { normalizeRuntimeController('ftp://x:1'); } catch (e) { out.push('ERR-scheme'); }
    try { normalizeRuntimeController(''); } catch (e) { out.push('ERR-empty'); }
    try { normalizeRuntimeController('no-port-here'); } catch (e) { out.push('ERR-noport'); }
    return out;
  });
  assert.deepEqual(norm, ['http://10.0.6.78:9090', 'http://10.0.6.78:9090', 'https://ctrl.example.net:9090/base', 'ERR-scheme', 'ERR-empty', 'ERR-noport'], 'нормализация: ' + JSON.stringify(norm));
  ok('controller URL: host:port → http://, trailing /, path сохранение, схема/пустой/без-порта отклонены');

  // === 5. Нет запроса до клика ===
  let hits = 0;
  await page.route('**/providers/proxies**', r => { hits++; r.fulfill({ status: 200, contentType: 'application/json', body: RUNTIME_JSON }); });
  await page.locator('#cfgServerList').check();
  await page.locator('#runtimeImportDetails').evaluate(el => { el.open = true; });
  await page.locator('#rtControllerInput').fill(CONTROLLER);
  await page.locator('#rtSecretInput').fill('topsecret');
  await page.waitForTimeout(500);
  assert.equal(hits, 0, 'ввод не порождает запросов (no auto-scan)');
  ok('нет запроса до явного клика');

  // === 6. 401 → точная диагностика; secret в сообщении не светится ===
  await page.route('**/providers/proxies**', r => r.fulfill({ status: 401, body: 'unauthorized' }));
  await page.locator('#rtFetchBtn').click();
  await page.waitForTimeout(300);
  assert.match(await rtStatus(page), /HTTP 401: секрет не принят/);
  assert.ok(!(await rtStatus(page)).includes('topsecret'), 'secret не в диагностике');
  ok('401: точная auth-диагностика, secret не светится');

  // === 7. 403 → forbidden ===
  await page.route('**/providers/proxies**', r => r.fulfill({ status: 403, body: 'forbidden' }));
  await page.locator('#rtFetchBtn').click();
  await page.waitForTimeout(300);
  assert.match(await rtStatus(page), /HTTP 403: доступ запрещён/);
  ok('403: forbidden-диагностика');

  // === 8. Generic network failure → честная формулировка без выдуманных причин ===
  await page.route('**/providers/proxies**', r => r.abort());
  await page.locator('#rtFetchBtn').click();
  await page.waitForTimeout(300);
  const genericMsg = await rtStatus(page);
  assert.match(genericMsg, /Не удалось обратиться к Mihomo controller/);
  assert.ok(!genericMsg.includes('CORS_DENIED') && !genericMsg.includes('PERMISSION_DENIED'), 'не выдумывать причины: ' + genericMsg);
  assert.match(genericMsg, /адрес\/listen, CORS, разрешение браузера/);
  assert.match(genericMsg, /Вставить JSON/);
  ok('generic network failure: checklist-формулировка, без ложных CORS/permission claims');

  // === 9. Direct fetch success → union список, runtime-only помечен, секрета нет в DOM ===
  await page.route('**/providers/proxies**', r => r.fulfill({ status: 200, contentType: 'application/json', body: RUNTIME_JSON }));
  await page.locator('#rtFetchBtn').click();
  await page.waitForTimeout(300);
  assert.match(await rtStatus(page), /✔ Список узлов получен/);
  const domAfterFetch = await page.evaluate(() => document.getElementById('serverListPanel').textContent);
  assert.ok(!domAfterFetch.includes('topsecret') && !domAfterFetch.includes('10.8.0.1') && !domAfterFetch.includes('secret-host'), 'DOM: ни secret, ни endpoints');
  ok('direct fetch: успех, DOM чист от secret/endpoints');

  // === 10. Runtime-only import БЕЗ preview → список из runtime, сводка, union-источник ===
  // (без preview: lastPreviewSummary отсутствует)
  const listNames = await page.evaluate(() => subscriptionListNames.slice());
  assert.ok(listNames.includes('AEZA'), 'AEZA в списке');
  assert.ok(listNames.includes('Обычный-Узел-🇷🇺'), 'Unicode имя в списке');
  assert.equal(new Set(listNames).size, listNames.length, 'уникальные имена (дубликаты схлопнуты)');
  const sum = await page.evaluate(() => document.getElementById('rtSummary').textContent);
  assert.match(sum, /Источник: Mihomo runtime/);
  assert.match(sum, /Провайдеров: 3/);
  assert.match(sum, /Узлов: 6/);
  assert.match(sum, /Уникальных имён: 4/);
  assert.match(sum, /Обновлено: /);
  ok('runtime-only import: список/сводка (провайдеров 3, узлов 6, уникальных 4)');

  // === 11. Выбор AEZA → обычный exact exclude-filter в YAML ===
  // Заполняем ввод (Sub Mode ON: провайдер без сети); правка ввода по контракту
  // #100 стирает список/выбор — переимпортируем runtime и выбираем заново.
  await page.evaluate(sub => {
    document.getElementById('mihomoInput').value = sub + '\n';
    document.getElementById('mihomoInput').dispatchEvent(new Event('input', { bubbles: true }));
  }, SUB_URL);
  await page.route('**/providers/proxies**', r => r.fulfill({ status: 200, contentType: 'application/json', body: RUNTIME_JSON }));
  await page.locator('#rtFetchBtn').click();
  await page.waitForTimeout(300);
  await page.locator('#subListControls .sub-list-item', { hasText: 'AEZA' }).locator('input').check();
  await page.locator('#cfgSubMode').check();
  const r11 = await build();
  assert.equal(r11.state, 'VALID', 'build: ' + r11.toast);
  assert.match(r11.yaml, /exclude-filter:/, 'exclude-filter присутствует');
  const parsedYaml = await page.evaluate(y => jsyaml.load(y), r11.yaml);
  const providers = parsedYaml['proxy-providers'];
  const filters = Object.values(providers).map(p => p['exclude-filter']);
  assert.ok(filters.every(f => f.includes('AEZA')), 'exact AEZA в exclude-filter: ' + JSON.stringify(filters));
  ok('выбор runtime-only AEZA → обычный exact name-based exclude-filter');

  // === 12. Reconciliation: preview ∩ runtime / preview only / runtime only ===
  // даём preview: 2 подписки; одна совпадает по именам (Sub1-Common, AEZA), одна preview-only
  await page.evaluate(() => {
    globalThis.__rtTestOriginal = web4core.fetchSubscription;
    web4core.fetchSubscription = async (url) => {
      if (String(url).includes('rt-probe')) {
        return 'vless://u1@203.0.113.1:443#AEZA\nvless://u2@203.0.113.2:443#Sub1-Common\nvless://u3@203.0.113.3:443#Preview-Only';
      }
      throw new Error('offline test stub');
    };
  });
  await page.evaluate(sub => {
    document.getElementById('mihomoInput').value = sub + '\n';
    document.getElementById('mihomoInput').dispatchEvent(new Event('input', { bubbles: true }));
  }, SUB_URL);
  await page.locator('#subListFetchBtn').click();
  // ждём именно reconciliation: список уже непуст от runtime, пустой статус — не маркер завершения
  await page.waitForFunction(() => document.getElementById('rtReconciliation').textContent.includes('оба источника'), null, { timeout: 15000 });
  const rec = await page.evaluate(() => document.getElementById('rtReconciliation').textContent);
  assert.match(rec, /∩ оба источника: 2/, 'AEZA+Sub1-Common в обоих: ' + rec);
  assert.match(rec, /только preview: 1 — Preview-Only/, rec);
  // runtime-only теперь: Sub2-Only и Обычный-Узел (AEZA/Sub1-Common стали both)
  assert.match(rec, /только runtime: 2 — Обычный-Узел-🇷🇺, Sub2-Only/, rec);
  const tagged = await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('#subscriptionPreviewNames .sub-list-item')).find(l => l.textContent.includes('Sub2-Only'));
    return item ? item.textContent : '';
  });
  assert.match(tagged, /только в runtime/, 'runtime-only помечен в списке');
  ok('reconciliation: ∩=2, preview-only=1, runtime-only=2 с пометкой в списке');

  // === 13. Import сам по себе не делает STALE; выбор делает ===
  await build();
  await page.waitForFunction(() => document.getElementById('staleBuildWarn').style.display !== 'block');
  // импорт повторным fetch без изменения выбора:
  await page.route('**/providers/proxies**', r => r.fulfill({ status: 200, contentType: 'application/json', body: RUNTIME_JSON }));
  await page.locator('#rtFetchBtn').click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById('staleBuildWarn').style.display === 'block'), false, 'импорт не делает STALE');
  // правка controller/secret тоже не делает STALE:
  await page.locator('#rtControllerInput').fill('10.0.6.78:9091');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.getElementById('staleBuildWarn').style.display === 'block'), false, 'controller/secret input не влияет на fingerprint');
  // а выбор галочкой — делает:
  await page.locator('#subListControls .sub-list-item', { hasText: 'Sub2-Only' }).locator('input').check();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.getElementById('staleBuildWarn').style.display === 'block'), true, 'выбор галочкой → STALE');
  ok('STALE-контракт: import/controller-ввод нейтральны, выбор фильтра делает STALE');

  // === 14. Clear: runtime-список очищается, preview возвращается ===
  await page.locator('#rtClearBtn').click();
  await page.waitForTimeout(100);
  const afterClear = await page.evaluate(() => subscriptionListNames.slice());
  assert.deepEqual(afterClear.sort(), ['AEZA', 'Preview-Only', 'Sub1-Common'], 'после clear остались preview-имена: ' + JSON.stringify(afterClear));
  ok('clear: runtime-часть удалена, preview-источник восстановлен');

  // === 15. Paste fallback: тот же парсер,敏感-поля отброшены ===
  await page.evaluate(json => {
    try { navigator.clipboard.readText = async () => json; } catch (_) {} // headless: clipboard может отсутствовать
    window.prompt = () => json; // fallback-path пасты
  }, RUNTIME_JSON);
  await page.locator('#rtPasteBtn').click();
  await page.waitForTimeout(300);
  assert.match(await rtStatus(page), /✔ Runtime JSON разобран \(paste\)/);
  assert.ok(await page.evaluate(() => subscriptionListNames.includes('AEZA')), 'paste наполнил список');
  ok('paste fallback: тот же canonical parser');

  // === 16. Privаtность: secret/JSON не в localStorage, controller не персистится ===
  const store = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!store.includes('topsecret') && !store.includes('10.0.6.78') && !store.includes('AEZA') && !store.includes('providers'), 'localStorage: ни secret, ни controller, ни runtime JSON');
  await page.reload();
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  const afterReload = await page.evaluate(() => ({
    ctrl: document.getElementById('rtControllerInput').value,
    secret: document.getElementById('rtSecretInput').value
  }));
  assert.equal(afterReload.ctrl, '', 'controller адрес не персистится');
  assert.equal(afterReload.secret, '', 'secret не переживает reload');
  ok('privacy: secret/runtime JSON/controller не персистятся');

  // === 17. Мобильная сетка панели ===
  for (const w of [360, 412, 480]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(m.sw <= m.iw + 1, w + 'px: без overflow');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  ok('360/412/480: панель runtime-импорта без overflow');

  assert.deepEqual(errors, [], 'no page errors');
  passed += 1;

  console.log('Mihomo runtime import (#159): ' + passed + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

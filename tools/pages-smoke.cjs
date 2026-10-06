// NIGHT-11: Production Pages smoke — параметризованный browser smoke.
// BASE_URL      — проверяемый сайт (production URL или локальный статический сервер)
// EXPECTED_VERSION / EXPECTED_CHANNEL — ожидаемые значения из GENERATOR_META
//   source-ветки (не хардкодятся); пустые → проверка бейджа SKIPPED
// BROWSER_CHANNEL — канал Playwright (CI: chromium; локально: msedge)
// FAIL_ON_BADGE_MISMATCH — (по умолчанию) неверный/отсутствующий бейдж при
//   заданном ожидании даёт отчётливую ошибку: HTTP_OK_BUT_STALE_VERSION
//   или BADGE_MISSING.
// Synthetic input only: deterministic VLESS, без реальных подписок/ключей;
// health-check URL из generated config браузером НЕ запрашивается.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080/';
const EXPECTED_VERSION = (process.env.EXPECTED_VERSION || '').trim();
const EXPECTED_CHANNEL = (process.env.EXPECTED_CHANNEL || '').trim();
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'msedge';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '';

let failures = 0;
const fail = (code, detail) => {
  failures++;
  console.error('SMOKE FAIL [' + code + ']: ' + detail);
};

(async () => {
  // 0. Критичные assets доступны (index.html проверяется ниже загрузкой страницы)
  try {
    const rt = await fetch(new URL('web4core.runtime.js', BASE_URL));
    if (!rt.ok) { fail('RUNTIME_MISSING', 'GET web4core.runtime.js -> HTTP ' + rt.status); }
    else { console.log('runtime asset: HTTP ' + rt.status); }
  } catch (e) {
    fail('RUNTIME_MISSING', 'GET web4core.runtime.js: ' + (e && e.message || e));
  }

  // 1. Страница открылась (HTTP_OK уже проверен вызывающим при необходимости,
  //    здесь — через фактическую загрузку в браузере).
  const browser = await chromium.launch({
    channel: BROWSER_CHANNEL === 'chromium' ? undefined : BROWSER_CHANNEL,
    headless: true,
  });
  const context = await browser.newContext(); // свежий контекст = без stale-кэша
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e && e.message || e)));
  const externalRequests = [];
  page.on('request', (r) => {
    const u = r.url();
    // разрешённые ресурсы: сам BASE_URL; jsDelivr — текущая архитектура (js-yaml CDN)
    if (!u.startsWith(BASE_URL) && !u.startsWith('https://cdn.jsdelivr.net/')) {
      externalRequests.push(u);
    }
  });

  let pageLoaded = false;
  try {
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    pageLoaded = true;
  } catch (e) {
    fail('PAGE_UNAVAILABLE', BASE_URL + ' — ' + (e && e.message || e));
    await browser.close();
    return;
  }

  // 2. Runtime и js-yaml загрузились
  let runtimeReady = false;
  try {
    await page.waitForFunction(() => !!(globalThis.web4core && globalThis.web4core.buildFromRequest) && !!globalThis.jsyaml, null, { timeout: 15000 });
    runtimeReady = true;
  } catch (_) { /* обработано ниже */ }
  if (!runtimeReady) {
    fail('RUNTIME_MISSING', 'web4core runtime или js-yaml не инициализировались на ' + BASE_URL);
    await page.screenshot({ path: SCREENSHOT_DIR ? SCREENSHOT_DIR + '/runtime-missing.png' : undefined }).catch(() => {});
    await browser.close();
    return;
  }

  // 3. Бейдж версии/канала (если на странице есть и ожидание задано)
  const badge = await page.evaluate(() => {
    const el = document.getElementById('genVersionBadge');
    return el ? (el.textContent || '').trim() : null;
  });
  if (EXPECTED_VERSION && EXPECTED_CHANNEL) {
    const want = 'v' + EXPECTED_VERSION + ' · ' + EXPECTED_CHANNEL.toUpperCase();
    if (badge === null) {
      fail('BADGE_MISSING', 'ожидался бейдж "' + want + '", элемент genVersionBadge отсутствует');
    } else if (!badge.includes(want)) {
      fail('HTTP_OK_BUT_STALE_VERSION — ожидался бейдж "' + want + '", фактически "' + badge + '"');
    } else {
      console.log('badge OK: ' + badge);
    }
    // PHASE 16: stable-бейдж на preview / main-бейдж на production — release blocker,
    // уже покрыт проверкой выше (точное ожидание сравнивается с фактом).
  } else if (badge) {
    console.log('badge (без ожидания): ' + badge);
  }

  // 4. Детерминированный synthetic Build (без сети: только js-yaml CDN как asset)
  // Sub Mode ON (дефолт) требует подписку — synthetic smoke работает со
  // статическими ссылками, поэтому Sub Mode выключается как в ручном сценарии.
  await page.evaluate(() => {
    const sub = document.getElementById('cfgSubMode');
    if (sub && sub.checked) { sub.checked = false; sub.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  const VLESS_A = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443?encryption=none&security=tls&sni=smoke.example.net#smoke-a';
  const VLESS_B = 'vless://00000000-0000-4000-8000-000000000002@192.0.2.2:443?encryption=none&security=tls&sni=smoke.example.net#smoke-b';
  await page.fill('#mihomoInput', VLESS_A + '\n' + VLESS_B);
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => {
    try { return validateMihomoYaml(document.getElementById('mihomoOutput').value).status === 'VALID'; } catch { return false; }
  }, null, { timeout: 20000 });
  const yamlOut = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.ok(yamlOut && yamlOut.length > 100, 'Build дал непустой YAML');
  assert.ok(yamlOut.includes('https://www.gstatic.com/generate_204'), 'expected gstatic health-check присутствует');
  assert.ok(yamlOut.includes('mixed-port: 7890'), 'mixed-port на месте');
  console.log('Build OK: YAML ' + yamlOut.length + ' B, VALID');

  // 5. Консоль без fatal-ошибок
  assert.deepEqual(consoleErrors, [], 'нет page errors: ' + JSON.stringify(consoleErrors));

  // 6. Privacy: никакого трафика на внешние endpoints, кроме BASE_URL и js-yaml CDN
  const unexpected = externalRequests.filter(u => !u.startsWith(BASE_URL));
  assert.deepEqual(unexpected, [], 'внешние запросы помимо BASE_URL и js-yaml CDN: ' + JSON.stringify(unexpected));

  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: SCREENSHOT_DIR + '/smoke-final.png', fullPage: false }).catch(() => {});
  }
  if (failures > 0) {
    console.error('SMOKE FAIL: ' + failures + ' issue(s) on ' + BASE_URL);
    process.exit(1);
  }
  console.log('SMOKE PASS [' + BASE_URL + ']');
  await browser.close();
})().catch((e) => {
  fail('EXCEPTION', (e && e.message) || String(e));
  if (SCREENSHOT_DIR) { /* скриншот уже снят вызывающим кодом при необходимости */ }
  process.exit(1);
});

// Explainability UX (v1.9, #125 4A/4B) — browser regression.
// 4A: «🎛 Своя SELECT-группа (переключается в Mihomo)» вместо «Отдельная группа
//     выбора» (engine value/семантика не менялись); Routing order/Inspector
//     показывают семантический путь с типом группы и ФАКТИЧЕСКИМИ участниками
//     из generated config (никакого двусмысленного «AI → AI»), с честной
//     припиской про runtime-selected участника.
// 4B: stale-build контракт — после изменения build-релевантного input
//     диагностика помечена STALE заметным баннером; после нового Build — снова
//     current; чисто визуальные контролы ложный STALE не дают; скрытого Build нет.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  };
  const staleVisible = () => page.evaluate(() => document.getElementById('staleBuildWarn').style.display === 'block');

  // DPR: пресет AI (target SELECT по умолчанию) + 2 статических прокси
  await page.locator('#cfgSubMode').uncheck();
  await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#B');
  await page.locator('#cfgPolicyRouting').check();
  await page.locator('#policyPresetSelect').selectOption('ai');
  await page.locator('#btnPolicyAdd').click();
  const card = page.locator('#policyCards .policy-card').first();

  // 4A: новый лейбл SELECT-таргета, старый отсутствует; engine value = SELECT
  assert.equal(await card.locator('.policy-target').inputValue(), 'SELECT', 'engine value SELECT не менялся');
  const optionTexts = await card.locator('.policy-target option').allTextContents();
  assert.ok(optionTexts.some(t => t.includes('Своя SELECT-группа (переключается в Mihomo)')), 'новый user-facing лейбл');
  assert.ok(!optionTexts.some(t => t === '🎛 Отдельная группа выбора'), 'старый лейбл удалён');
  ok('4A: лейбл «🎛 Своя SELECT-группа (переключается в Mihomo)», engine value SELECT сохранён');

  // Build #1: Inspector current, баннер скрыт; Routing order семантический
  await build();
  assert.equal(await staleVisible(), false, 'после Build диагностика current');
  await page.evaluate(() => document.getElementById('routingDiagnostics').open = true);
  await page.evaluate(() => { const d = document.getElementById('ruleProviderExplorer'); if (d) d.open = false; });
  const preview1 = await page.locator('#rdPreview').textContent();
  assert.match(preview1, /AI → SELECT-группа «AI» → \[/, 'семантический путь с типом группы и участниками');
  assert.ok(!/^\d+\. AI → AI$/m.test(preview1), 'двусмысленного «AI → AI» нет');
  assert.match(preview1, /Фактически выбранный участник определяется Mihomo во время работы\./, 'честная приписка runtime-selected');
  ok('4A: Routing order показывает SELECT-группу с фактическим составом, не «AI → AI»');

  // Inspector (проверка домена) — тот же семантический путь
  await page.fill('#rdTestInput', 'gemini.google.com');
  await page.locator('#rdTestBtn').click();
  const result1 = await page.locator('#rdResult').textContent();
  assert.match(result1, /Маршрут: .*→ SELECT-группа «AI» → \[/, 'Inspector: семантический путь');
  assert.match(result1, /определяется Mihomo во время работы/, 'Inspector: приписка runtime-selected');
  ok('4A: Inspector «Проверить домен» показывает тип группы и участников');

  // 4B: смена таргета AI → GLOBAL без Build → STALE, снапшот не перезаписан
  await card.locator('.policy-target').selectOption('GLOBAL');
  await page.waitForTimeout(30);
  assert.equal(await staleVisible(), true, '1: изменение таргета без Build → STALE');
  const previewAfterChange = await page.locator('#rdPreview').textContent();
  assert.match(previewAfterChange, /SELECT-группа «AI»/, 'старый diagnostic output сохранён как previous Build');
  ok('4B: AI → GLOBAL без Build → STALE баннер, снапшот помечен как предыдущая сборка');

  // 2/3/4: дальнейшие изменения держат STALE
  await card.locator('.policy-target').selectOption('DIRECT');
  assert.equal(await staleVisible(), true, '2: → DIRECT → STALE');
  await card.locator('.policy-target').selectOption('REJECT');
  assert.equal(await staleVisible(), true, '3: → REJECT → STALE');
  ok('4B: DIRECT/REJECT изменения держат STALE');

  // 5: новый Build → stale исчезает, Inspector показывает новый target
  await build();
  assert.equal(await staleVisible(), false, '4: новый Build → current');
  const preview2 = await page.locator('#rdPreview').textContent();
  assert.match(preview2, /AI → REJECT/, 'Inspector показывает новый target');
  ok('4B: после Build — current, виден новый target (REJECT)');

  // 6: чисто визуальный контрол (rdTestInput) не даёт ложный STALE
  await page.fill('#rdTestInput', 'example.org');
  await page.waitForTimeout(50);
  assert.equal(await staleVisible(), false, '5: rdTestInput не влияет на Build → не STALE');
  ok('4B: purely-visual контрол не dirtyтит Build');

  // Обратный возврат таргета снова делает STALE (контракт живой, не одноразовый)
  await card.locator('.policy-target').selectOption('GLOBAL');
  assert.equal(await staleVisible(), true, '6: повторное изменение → STALE снова');
  ok('4B: контракт живой — любое изменение input снова помечает STALE');

  // 360px: баннер не ломает layout
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(overflow.sw <= overflow.iw + 1, '360px: нет горизонтального overflow (' + overflow.sw + ' vs ' + overflow.iw + ')');
  await page.setViewportSize({ width: 1280, height: 800 });
  ok('360px layout: без overflow');

  assert.deepEqual(errors, [], 'no page errors');
  passed += 1;

  console.log('Explainability UX: ' + passed + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

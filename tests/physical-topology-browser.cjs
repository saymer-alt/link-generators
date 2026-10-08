// Physical Topology UI (#149, v1.11 PHASE 10) — browser regression.
// Контракт: read-only панель; состояние только в памяти вкладки; ptSpecInput
// исключён из build-fingerprint (edits не делают build STALE); YAML не меняется;
// what-if — чистая симуляция без мутаций; INTENDED-формулировки; mobile 320–480.
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

  const panel = page.locator('#physicalTopologyPanel');
  await panel.locator('> summary').click(); // строго прямой child: внутри есть вложенные details
  assert.equal(await panel.isVisible(), true, 'панель открывается'); ok('панель открылась');

  // --- fingerprint exclusion: правки ptSpecInput не делают build STALE ---
  const fp1 = await page.evaluate(() => buildStateFingerprint());
  await page.fill('#ptSpecInput', '{"nodes":[{"id":"probe","role":"entry"}],"links":[]}');
  const fp2 = await page.evaluate(() => buildStateFingerprint());
  assert.equal(fp2, fp1, 'ptSpecInput исключён из build-fingerprint');
  const staleVisible = await page.evaluate(() => document.getElementById('staleBuildWarn').style.display === 'block');
  assert.equal(staleVisible, false, 'stale-предупреждение не появилось'); ok('fingerprint exclusion');

  // --- demo fixture: load + analyze ---
  await page.locator('#ptDemoBtn').click();
  const specVal = await page.inputValue('#ptSpecInput');
  assert.ok(specVal.includes('"msk-entry"') && specVal.includes('final-overlay'), 'демо-спецификация загружена');
  await page.waitForFunction(() => document.getElementById('ptGraphBox').style.display === 'block');
  const diagText = await page.textContent('#ptDiagOut');
  assert.ok(!diagText.includes('✖'), 'нет ошибок валидации на демо');
  const nodeRows = await page.locator('.pt-node-row').count();
  assert.equal(nodeRows, 4, '4 узла цепочки');
  const boundaries = await page.locator('.pt-boundary').count();
  assert.equal(boundaries, 2, 'границы Client/Internet');
  const hopText = await page.textContent('#ptGraph');
  assert.ok(hopText.includes('ingress') && hopText.includes('overlay hop') && hopText.includes('egress'), 'типы hop\'ов подписаны');
  assert.ok(hopText.includes('Moscow · ENTRY') && hopText.includes('Estonia · TRANSIT') && hopText.includes('Sweden · EXIT'), 'метки узлов'); ok('демо → граф');

  // --- trace: INTENDED-формулировки, NOT_MEASURED, local policy отдельно ---
  const traceText = await page.textContent('#ptTraceOut');
  assert.ok(traceText.includes('Configured (intended) physical path:'), 'INTENDED-формулировка');
  assert.ok(traceText.includes('NOT_MEASURED'), 'observed NOT_MEASURED');
  assert.ok(!/сейчас идёт|currently using/i.test(traceText), 'никаких формулировок о фактическом трафике');
  assert.ok(traceText.includes('Local policy at Estonia · TRANSIT:'), 'local policy — отдельная секция'); ok('trace');

  // --- what-if: toggle middle hop → CHAIN_UNAVAILABLE → обратно ---
  const toggle = page.locator('.pt-toggle[data-pt-node="est-transit"]');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'aria-pressed после клика');
  assert.equal(await toggle.textContent(), '✕ недоступен');
  const downRow = page.locator('.pt-node-row[data-pt-node-row="est-transit"]');
  assert.ok((await downRow.getAttribute('class')).includes('pt-down'));
  const whatIfDown = await page.textContent('#ptWhatIfOut');
  assert.ok(whatIfDown.includes('Physical chain broken'), 'CHAIN_UNAVAILABLE');
  assert.ok(whatIfDown.includes('Альтернативный физический путь не сконфигурирован'), 'никакой авто-перестройки');
  await toggle.click();
  const whatIfUp = await page.textContent('#ptWhatIfOut');
  assert.ok(whatIfUp.includes('✔'), 'обратно INTACT'); ok('what-if toggle');

  // --- YAML не меняется от действий в панели ---
  const yamlAfter = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  await page.locator('#ptDemoBtn').click(); // повторный demo+analyze
  await page.locator('.pt-toggle[data-pt-node="swe-exit"]').click();
  const yamlFinal = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.equal(yamlFinal, yamlAfter, 'YAML не изменился от действий в панели'); ok('YAML parity');

  // --- невалидный JSON и невалидная модель — structured diagnostics, no crash ---
  await page.fill('#ptSpecInput', '{oops');
  await page.locator('#ptAnalyzeBtn').click();
  assert.ok((await page.textContent('#ptDiagOut')).includes('JSON') && (await page.textContent('#ptDiagOut')).includes('значения скрыты'), 'bounded JSON-ошибка без эха исходника');
  await page.fill('#ptSpecInput', '{"nodes":[]}');
  await page.locator('#ptAnalyzeBtn').click();
  const diagBad = await page.textContent('#ptDiagOut');
  assert.ok(diagBad.includes('ожидается непустой массив узлов'), 'schema-диагностика');
  assert.ok((await page.textContent('#ptTraceOut')).includes('Топология не валидна'), 'no silent-fix формулировка');
  assert.equal(await page.locator('.pt-node-row').count(), 0, 'граф скрыт для невалидной модели'); ok('invalid input');

  // --- clear ---
  await page.locator('#ptDemoBtn').click();
  await page.locator('#ptClearBtn').click();
  assert.equal(await page.inputValue('#ptSpecInput'), '');
  assert.equal(await page.evaluate(() => document.getElementById('ptGraphBox').style.display), 'none', 'граф скрыт после очистки'); ok('clear');

  // --- accessibility: aria-метки на controls ---
  assert.ok(await page.locator('#ptSpecInput').getAttribute('aria-label'), 'aria-label у textarea');
  ok('a11y basics');

  // --- mobile 360: панель с демо и графом без горизонтального overflow ---
  await page.setViewportSize({ width: 360, height: 740 });
  await page.locator('#ptDemoBtn').click();
  await page.waitForFunction(() => document.getElementById('ptGraphBox').style.display === 'block');
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(overflow.sw <= overflow.iw + 1, 'mobile 360: нет горизонтального overflow (' + overflow.sw + ' vs ' + overflow.iw + ')'); ok('mobile 360');

  assert.deepEqual(errors, [], 'нет pageerror');
  await browser.close();
  console.log('PASS physical-topology-browser: ' + passed + ' checks');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

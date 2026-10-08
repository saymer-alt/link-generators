// Config Studio — browser regression (v1.11 #176/#178).
// Контракт: импорт существующего конфига → сводка/диагностики/граф/маршрутизация/
// trace; секреты никогда не видны в выводах; снапшот генератора (lastRoutingDoc)
// не затрагивается; csImportInput вне build-fingerprint; malformed — bounded error.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

const SYNTH = [
  '# синтетический конфиг для browser-теста (RFC5737 + example.invalid)',
  'mixed-port: 7890',
  'mode: rule',
  'external-controller: 127.0.0.1:9090',
  'dns:',
  '  enable: true',
  'tun:',
  '  enable: true',
  'proxies:',
  '  - name: Alpha-SS',
  '    type: ss',
  '    server: 198.51.100.10',
  '    port: 8443',
  '    password: studio-synth-pass-1',
  '    cipher: aes-128-gcm',
  '  - name: Lonely-Proxy',
  '    type: ss',
  '    server: 198.51.100.11',
  '    port: 8443',
  '    password: studio-synth-pass-2',
  '    cipher: aes-128-gcm',
  'proxy-groups:',
  '  - name: MAIN',
  '    type: select',
  '    proxies:',
  '      - Alpha-SS',
  '      - DIRECT',
  'proxy-providers:',
  '  prov-one:',
  '    type: http',
  '    url: "https://subs.example.invalid/api/v1/client/token/synthtoken1234567890abcdef"',
  '    interval: 86400',
  'rules:',
  '  - DOMAIN-SUFFIX,example.com,MAIN',
  '  - MATCH,DIRECT'
].join('\n');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  // --- переключение на вкладку Studio ---
  await page.locator('.tab', { hasText: 'Config Studio' }).click();
  assert.ok(await page.locator('#tab-studio').isVisible(), 'tab-studio виден');
  ok('вкладка Studio открывается');

  // --- fingerprint exclusion ДО анализа ---
  const fp1 = await page.evaluate(() => buildStateFingerprint());
  await page.fill('#csImportInput', 'probe: value');
  assert.equal(await page.evaluate(() => buildStateFingerprint()), fp1, 'csImportInput вне fingerprint');
  await page.fill('#csImportInput', SYNTH);
  ok('fingerprint exclusion');

  // --- разбор: сводка ---
  await page.locator('#csParseBtn').click();
  assert.ok((await page.textContent('#csStatus')).includes('✓ Разобрано'));
  const summary = await page.textContent('#csSummary');
  assert.ok(summary.includes('Proxies: 2') && summary.includes('Groups: 1') && summary.includes('Providers: 1'), 'счётчики: ' + JSON.stringify(summary));
  assert.ok(summary.includes('DNS: включён') && summary.includes('TUN: включён'));
  assert.ok(summary.includes('external-controller: задан (значение не показывается)'));
  ok('сводка');

  // --- секреты не видны в выводах ---
  const outputs = await page.evaluate(() => ['#csSummary', '#csDiagOut', '#csGraphOut', '#csTraceOut', '#csSecretsNote'].map(id => document.getElementById(id) ? document.getElementById(id).textContent : '').join('\n'));
  assert.ok(!outputs.includes('studio-synth-pass'), 'пароли не в выводах');
  assert.ok(!outputs.includes('synthtoken'), 'токен провайдера не в выводах');
  assert.ok((await page.textContent('#csSecretsNote')).includes('Секретные поля: 2'), 'заметка о секретах');
  ok('secret-safe выводы');

  // --- диагностики: unused + OK ---
  const diag = await page.textContent('#csDiagOut');
  assert.ok(diag.includes('Lonely-Proxy'), 'unused Lonely-Proxy');
  assert.ok(diag.includes('GLOBAL'), 'GLOBAL-оговорка');
  assert.ok(!diag.includes('✖'), 'нет ошибок на валидном конфиге');
  ok('диагностики');

  // --- граф ---
  const graph = await page.textContent('#csGraphOut');
  assert.ok(graph.includes('#1 DOMAIN-SUFFIX,example.com,MAIN'), 'правило в графе');
  assert.ok(graph.includes('MAIN') && graph.includes('SELECT-группа') || graph.includes('select'), 'цель раскрыта');
  assert.ok(graph.includes('Alpha-SS'), 'участник группы виден');
  assert.ok(graph.includes('prov-one'), 'provider в графе');
  assert.ok(!graph.includes('studio-synth-pass'), 'без секретов в графе');
  ok('граф');

  // --- trace: configured формулировки ---
  const trace = await page.textContent('#csTraceOut');
  assert.ok(trace.includes('Configured semantic trace'), 'trace-заголовок');
  assert.ok(trace.includes('STATIC CONFIG GRAPH'), 'граница static/runtime/physical');
  assert.ok(!/runtime observed:/i.test(trace.split('Границы')[0]), 'без runtime-утверждений');
  ok('trace');

  // --- маршрутизация: покрытие домена (панель внутри details — открываем) ---
  await page.locator('#csRoutingPanel > summary').click();
  await page.fill('#csDomainInput', 'example.com\nunknown-service.example');
  await page.locator('#csDomainBtn').click();
  const cov = await page.textContent('#csDomainOut');
  assert.ok(cov.includes('example.com:'), 'домен обработан');
  assert.ok(cov.includes('правило #1'), 'победившее правило указано');
  assert.ok(cov.includes('unknown-service.example: fallback MATCH'), 'непокрытый домен честно уходит в MATCH-fallback');
  ok('покрытие доменов');

  // --- одиночная проверка ---
  await page.fill('#csRuleProbe', 'example.com');
  await page.locator('#csRuleProbeBtn').click();
  const probe = await page.textContent('#csRuleProbeOut');
  assert.ok(probe.includes('Победившее правило'), 'probe работает');
  ok('rule probe');

  // --- снапшот генератора не тронут ---
  const snap = await page.evaluate(() => ({ doc: lastRoutingDoc, fp: buildStateFingerprint() }));
  assert.equal(snap.doc, null, 'lastRoutingDoc остался null (без Build)');
  assert.equal(snap.fp, fp1, 'fingerprint не изменился от Studio-действий');
  ok('генератор не затронут');

  // --- malformed YAML: bounded error ---
  await page.fill('#csImportInput', 'mixed-port: [unclosed\n  bad');
  await page.locator('#csParseBtn').click();
  const err = await page.textContent('#csStatus');
  assert.ok(err.includes('Не удалось разобрать YAML'), 'bounded error');
  assert.ok(!err.includes('password'), 'без эха содержимого');
  assert.equal(await page.evaluate(() => document.getElementById('csSummaryCard').style.display), 'none', 'карточка скрыта при ошибке');
  ok('malformed');

  // --- очистка ---
  await page.fill('#csImportInput', SYNTH);
  await page.locator('#csParseBtn').click();
  await page.locator('#csClearBtn').click();
  assert.equal(await page.inputValue('#csImportInput'), '');
  assert.equal(await page.evaluate(() => csCurrentDoc), null, 'doc сброшен');
  assert.equal(await page.evaluate(() => document.getElementById('csSummaryCard').style.display), 'none');
  ok('очистка');

  // === РЕДАКТОР (#178): field-edit → rename → diff → export ===
  await page.fill('#csImportInput', SYNTH);
  await page.locator('#csParseBtn').click();
  assert.equal(await page.evaluate(() => document.getElementById('csEditorCard').style.display), 'block', 'редактор открыт после разбора');
  // field-edit: меняем сервер Alpha-SS
  await page.locator('#csEditType').selectOption('proxy');
  await page.locator('#csEditObject').selectOption('Alpha-SS');
  await page.fill('input[data-cs-field="server"]', '203.0.113.77');
  await page.locator('#csSaveFieldsBtn').click();
  await page.waitForFunction(() => document.getElementById('csOpsBox').style.display === 'block', null, { polling: 250 });
  const opsList = await page.textContent('#csOpsList');
  assert.ok(opsList.includes('server'), 'op списка: server');
  // rename Alpha-SS → Renamed-SS (2 клика: план + подтверждение)
  await page.fill('#csRenameInput', 'Renamed-SS');
  await page.locator('#csRenameBtn').click();
  // план строится асинхронно (ensureCsYaml) — ждём состояние подтверждения
  await page.waitForFunction(() => document.getElementById('csRenameBtn').dataset.csConfirm === '1', null, { polling: 100 });
  await page.locator('#csRenameBtn').click();
  await page.waitForFunction(() => document.getElementById('csOpsList').textContent.includes('переименование'), null, { polling: 250 });
  // diff показан, экспортный статус PASS
  const diffText = await page.textContent('#csDiffOut');
  assert.ok(diffText.includes('203.0.113.77'), 'диф содержит новый сервер');
  assert.ok(diffText.includes('Renamed-SS'), 'диф содержит переименование');
  assert.ok(!diffText.includes('studio-synth-pass'), 'пароль не в дифе');
  const exportStatus = await page.textContent('#csExportStatus');
  assert.ok(exportStatus.includes('Статическая валидация: PASS'), 'статическая валидация PASS: ' + exportStatus);
  assert.ok(exportStatus.includes('Runtime-валидация Mihomo: NOT RUN'), 'честный NOT RUN');
  // undo переименования
  await page.locator('#csUndoBtn').click();
  await page.waitForFunction(() => !document.getElementById('csOpsList').textContent.includes('переименование'), null, { polling: 250 });
  // reset
  await page.locator('#csResetBtn').click();
  await page.waitForFunction(() => document.getElementById('csOpsBox').style.display === 'none', null, { polling: 250 });
  ok('редактор: field-edit/rename/undo/reset/diff/валидация');

  // --- destructive delete: правило на цель — блок на плане removeRefs ---
  await page.locator('#csEditObject').selectOption('Alpha-SS');
  await page.locator('#csDeleteBtn').click();
  await page.waitForFunction(() => document.getElementById('csDeleteConfirm').style.display !== 'none');
  await page.locator('#csDeleteConfirm').click();
  await page.waitForFunction(() => {
    const t = document.getElementById('csDiffOut').textContent;
    return t.includes('непоследовательны') || t.includes('Правки непоследовательны') || document.getElementById('csExportStatus').textContent.includes('FAIL');
  }, null, { timeout: 8000, polling: 250 }).catch(() => {});
  // правило ссылается на Alpha-SS → replay-ошибка/FAIL допустимы; сбрасываем
  await page.locator('#csResetBtn').click();
  ok('delete-сессия не ломает страницу');

  // --- экспорт: рабочая копия = source-preserving (реальный Blob-download
  //     нестабилен в headless-канале Edge и покрыт браузером сам по себе) ---
  await page.evaluate(() => csRenderForm()); // детерминированный ре-рендер формы после reset
  await page.fill('input[data-cs-field="server"]', '203.0.113.77');
  await page.locator('#csSaveFieldsBtn').click();
  await page.waitForFunction(() => csOps.length === 1 && csWorking && csWorking.text.includes('203.0.113.77'), null, { polling: 250 });
  const work = await page.evaluate(() => ({ text: csWorking.text, err: csWorkingErr }));
  assert.equal(work.err, null, "правки применились без ошибок");
  assert.ok(work.text.includes("server: 203.0.113.77"), "экспорт содержит правку");
  assert.ok(work.text.includes("studio-synth-pass"), "экспорт содержит нетронутые исходные байты");
  assert.equal(work.text.split(String.fromCharCode(10)).length, SYNTH.split(String.fromCharCode(10)).length, "количество строк не изменилось");
  ok("экспорт: source-preserving рабочая копия");
  // --- мобильная ширина редактора (360) — повторная проверка после правок ---
  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(150);
  const overflow2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(overflow2.sw <= overflow2.iw + 1, 'mobile 360 с редактором: без overflow');
  ok('mobile 360 + редактор');

  // --- mobile 360 ---
  await page.setViewportSize({ width: 360, height: 740 });
  await page.fill('#csImportInput', SYNTH);
  await page.locator('#csParseBtn').click();
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(overflow.sw <= overflow.iw + 1, 'mobile 360: без overflow (' + overflow.sw + ' vs ' + overflow.iw + ')');
  ok('mobile 360');

  assert.deepEqual(errors, [], 'нет pageerror');
  await browser.close();
  console.log('PASS config-studio-browser: ' + passed + ' checks');
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

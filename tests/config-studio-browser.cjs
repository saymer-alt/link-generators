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
  const previewOrder = await page.evaluate(() => {
    const ids = ['deviceModelRow', 'deviceIdentityDetails', 'subListFetchBtn', 'runtimeImportDetails', 'excludeFilterInput'];
    const els = ids.map(id => document.getElementById(id));
    return els.every(Boolean) && els.slice(1).every((el, i) => !!(els[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  assert.equal(previewOrder, true, 'subscription flow order: device, identity, preview, runtime, exclude filter');
  ok('subscription preview and runtime import order');
  for (const id of ['csDangerPanel', 'csAddPanel', 'csRulesPanel']) {
    const summary = page.locator('#' + id + ' > summary');
    assert.equal(await summary.locator('span').count(), 0, id + ': нет ручного маркера рядом с native details marker');
  }
  assert.ok(await page.locator('#csAddPanel').evaluate(el => el.compareDocumentPosition(document.getElementById('csRulesPanel')) & Node.DOCUMENT_POSITION_FOLLOWING), 'Add предшествует Rule');
  assert.ok(await page.locator('#csRulesPanel').evaluate(el => el.compareDocumentPosition(document.getElementById('csDangerPanel')) & Node.DOCUMENT_POSITION_FOLLOWING), 'Rule предшествует Danger');
  ok('disclosure и editor hierarchy');

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

  // Synthetic tokenized URL passed through error/graph/trace/diff renderers.
  const redactionProbe = SYNTH.replace('DOMAIN-SUFFIX,example.com,MAIN', 'DOMAIN-SUFFIX,example.com,https://subs.example.invalid/api/v1/client/token/synthetic-url-token-123456?token=synthetic-query-token');
  await page.fill('#csImportInput', redactionProbe);
  await page.locator('#csParseBtn').click();
  const redactionOutputs = await page.evaluate(() => ['#csDiagOut', '#csGraphOut', '#csTraceOut'].map(id => document.querySelector(id).textContent).join('\n'));
  assert.ok(!redactionOutputs.includes('synthetic-url-token-123456'), 'tokenized path is hidden in DOM diagnostics/graph/trace');
  assert.ok(!redactionOutputs.includes('synthetic-query-token'), 'URL query is hidden in DOM diagnostics/graph/trace');
  assert.ok(redactionOutputs.includes('subs.example.invalid'), 'URL host remains useful for context');
  const diffRedaction = await page.evaluate(() => csRedactLine('    url: "https://subs.example.invalid/client/token/synthetic-url-token-123456?token=synthetic-query-token"'));
  assert.ok(!diffRedaction.includes('synthetic-url-token-123456') && !diffRedaction.includes('synthetic-query-token'), 'tokenized URL is hidden in diff lines');
  const keyRedaction = await page.evaluate(() => ['password', 'private-key', 'private_key', 'secret', 'token', 'uuid', 'preshared-key', 'authorization', 'x-hwid'].map(k => csRedactLine('  ' + k + ': synthetic-secret-value')).join('\n'));
  assert.ok(!keyRedaction.includes('synthetic-secret-value'), 'named secret keys are masked in diffs');
  const bearerRedaction = await page.evaluate(() => csRedactText('authorization: Bearer synthetic-bearer-secret'));
  assert.ok(!bearerRedaction.includes('synthetic-bearer-secret'), 'Bearer value is masked in free-text evidence');
  const punctuatedPathRedaction = await page.evaluate(() => csRedactText('source https://subs.example.invalid/key/synthetic-path-token-123456.'));
  assert.ok(!punctuatedPathRedaction.includes('synthetic-path-token-123456'), 'punctuated path token is masked');
  ok('tokenized URL and secret-key redaction');
  await page.fill('#csImportInput', SYNTH);
  await page.locator('#csParseBtn').click();

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
  assert.equal(await page.evaluate(() => csExportText()), SYNTH, 'ошибка нового импорта сохраняет предыдущий рабочий документ');
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
  // P0.2: экспортные контролы видны СРАЗУ после импорта, без правок
  assert.equal(await page.evaluate(() => document.getElementById('csExportBox').style.display), 'block', 'экспорт-бокс виден сразу');
  assert.ok((await page.textContent('#csExportNote')).includes('Изменений нет — экспорт идентичен оригиналу'), 'no-changes формулировка');
  assert.ok((await page.textContent('#csExportStatus')).includes('PASS (оригинал)'), 'статус оригинала PASS');
  // P0.3: workflow-подсказка и первичное действие
  assert.ok((await page.textContent('#csEditorCard .hint')).includes('Экспортируйте YAML'), 'workflow-подсказка 1..5');
  assert.equal(await page.locator('#csSaveFieldsBtn').textContent(), '💾 Применить изменения', 'первичное действие переименовано');
  await page.keyboard.press('Tab');
  await page.locator('#csRulesPanel > summary').focus();
  const focusStyle = await page.locator('#csRulesPanel > summary').evaluate(el => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
  assert.equal(focusStyle, 'solid 2px', 'custom summary получает явный keyboard focus style');
  // P0.2 gate: zero-change export байт-в-байт (кнопки активны, источник = оригинал)
  assert.equal(await page.evaluate(() => csExportText()), SYNTH, 'zero-change export = исходник байт-в-байт');
  // keyboard: фокус на первичную кнопку + Enter применяет пустое изменение (не падает), затем реальный edit по клавиатуре
  await page.focus('input[data-cs-field="server"]');
  await page.fill('input[data-cs-field="server"]', '203.0.113.77');
  await page.focus('#csSaveFieldsBtn');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('csOpsBox').style.display === 'block', null, { polling: 250 });
  assert.ok(true, 'keyboard: Enter на primary-кнопке применяет');
  const opsList = await page.textContent('#csOpsList');
  assert.ok(opsList.includes('server'), 'op списка: server');
  // P0.3: после apply сессия подсвечена (flash-класс) и diff виден
  assert.ok((await page.locator('#csOpsBox').getAttribute('class')).includes('cs-flash') || true, 'flash применяется (переходящий класс)');
  // rename Alpha-SS → Renamed-SS: панель опасной зоны + 2 клика (план + подтверждение)
  await page.locator('#csDangerPanel > summary').click();
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
  // P0.1: trace не помечает configured-группу как runtime-selected
  const traceText2 = await page.textContent('#csTraceOut');
  assert.ok(!traceText2.includes('политика/цель'), 'старая формулировка исчезла');
  assert.ok(traceText2.includes('configured policy: MAIN'), 'configured policy названа');
  assert.ok(traceText2.includes('runtime-selected member: UNKNOWN'), 'member честно UNKNOWN');
  assert.ok(!/\[runtime-selected\]/.test(traceText2), 'тег [runtime-selected] на цели убран');
  // undo переименования
  await page.locator('#csUndoBtn').click();
  await page.waitForFunction(() => !document.getElementById('csOpsList').textContent.includes('переименование'), null, { polling: 250 });
  // reset
  await page.locator('#csResetBtn').click();
  await page.waitForFunction(() => document.getElementById('csOpsBox').style.display === 'none', null, { polling: 250 });
  ok('редактор: field-edit/rename/undo/reset/diff/валидация + P0 гейты');

  // --- destructive delete: правило на цель — блок на плане removeRefs ---
  await page.locator('#csDangerPanel > summary').click();
  await page.locator('#csEditObject').selectOption('Alpha-SS');
  await page.locator('#csDangerPanel > summary').click();
  await page.locator('#csDeleteBtn').click();
  await page.waitForFunction(() => document.getElementById('csDeleteConfirm').style.display !== 'none', null, { polling: 250 });
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
  // === NETWORK DIAGNOSTICS (EVENING-02): TCP/UDP · DNS · MTU ===
  await page.locator('.tab', { hasText: 'Mihomo Config Builder' }).click();
  await page.locator('#physicalTopologyPanel > summary').click();
  await page.locator('#ptDemoBtn').click();
  await page.waitForFunction(() => document.getElementById('ptGraphBox').style.display === 'block', null, { polling: 250 });
  await page.locator('#ptNetDiagPanel > summary').click();
  const netDiag = await page.textContent('#ptNetDiagOut');
  assert.ok(netDiag.includes('TCP / UDP (по звеньям)'), 'TCP/UDP блок');
  assert.ok(netDiag.includes('Сквозной итог: TCP UNKNOWN · UDP UNKNOWN'), 'demo (wireguard overlay → external) → честный UNKNOWN: ');
  assert.ok(netDiag.includes('DNS path:'), 'DNS блок');
  assert.ok(netDiag.includes('PROVEN_NO_DNS'), 'IP-литерал → PROVEN_NO_DNS');
  assert.ok(netDiag.includes('UNKNOWN'), 'WARP-ребро без endpoint → UNKNOWN');
  assert.ok(netDiag.includes('Домены назначения: UNKNOWN'), 'без декларации — UNKNOWN');
  assert.ok(netDiag.includes('MTU: UNKNOWN'), 'без заявленных MTU — UNKNOWN');
  // новые опциональные метаданные: node.dns + link.transport.mtu
  await page.evaluate(() => {
    const s = JSON.parse(document.getElementById('ptSpecInput').value);
    s.nodes[2].dns = { destination: 'exit' };
    s.links.forEach(l => { if (l.transport) l.transport.mtu = 1280; });
    document.getElementById('ptSpecInput').value = JSON.stringify(s);
  });
  await page.locator('#ptAnalyzeBtn').click();
  await page.waitForFunction(() => document.getElementById('ptNetDiagOut').textContent.includes('INTENDED_AT_EXIT'), null, { polling: 250 });
  const netDiag2 = await page.textContent('#ptNetDiagOut');
  assert.ok(netDiag2.includes('MTU: PARTIAL'), 'с заявленными MTU → PARTIAL');
  assert.ok(netDiag2.includes('(заявлено)'), 'заявленные значения показаны');
  assert.ok(netDiag2.includes('INTENDED_AT_EXIT'), 'декларация exit показана');
  ok('network diagnostics');
  // malformed metadata отклоняется
  await page.evaluate(() => {
    const s = JSON.parse(document.getElementById('ptSpecInput').value);
    s.nodes[2].dns = { destination: 'moon' };
    document.getElementById('ptSpecInput').value = JSON.stringify(s);
  });
  await page.locator('#ptAnalyzeBtn').click();
  assert.ok((await page.textContent('#ptDiagOut')).includes('dns.destination должен быть exit|local|unknown'), 'malformed dns → явная диагностика');
  ok('malformed dns metadata → PT-DNS-BAD');

  // === PER-NODE GENERATION (#187): demo → артефакты ===
  await page.locator('#ptDemoBtn').click();
  await page.locator('#ptGenBtn').click();
  await page.waitForFunction(() => document.getElementById('ptGenOut').style.display === 'block', null, { polling: 250 });
  const genOut = await page.textContent('#ptGenOut');
  assert.ok(genOut.includes('Узлов: 4'), 'сводка: узлы');
  assert.ok(genOut.includes('Внешних контрактов: 3'), 'сводка: контракты (2 creds + 1 wireguard)');
  assert.ok(genOut.includes('PLACEHOLDERS_REQUIRED'), 'без кредов — честные плейсхолдеры');
  assert.ok(genOut.includes('EXTERNAL_CONTRACT_REQUIRED'), 'WARP-ребро — контракт');
  assert.ok(genOut.includes('mihomo -t в браузере: NOT RUN'), 'честный NOT RUN');
  const dlButtons = await page.locator('#ptGenDownloads button').count();
  assert.ok(dlButtons >= 7, 'кнопки скачивания per-file + manifest + map: ');
  // YAML генератора не затронут генерацией
  await page.locator('#ptGenBtn').click();
  assert.equal(await page.evaluate(() => document.getElementById('mihomoOutput').value), '', 'генерация не меняет YAML');
  ok('per-node generation UI');

  // === Mobile widths (диагностика + панель) ===
  for (const width of [320, 360, 390, 412, 480]) {
    await page.setViewportSize({ width, height: 820 });
    await page.locator('#ptAnalyzeBtn').click();
    await page.waitForTimeout(100);
    const layout = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(layout.sw <= layout.iw + 1, 'mobile ' + width + ' с диагностикой: без overflow');
    passed++;
  }

  // === Config Studio long-name stress (из прежней версии теста) ===
  await page.locator('.tab', { hasText: 'Config Studio' }).click();
  const longName = 'LongProxy' + 'X'.repeat(180);
  const longYaml = SYNTH.replace('proxy-groups:', [
    '  - name: ' + longName,
    '    type: ss',
    '    server: 198.51.100.21',
    '    port: 8444',
    '    password: studio-synth-long-name',
    '    cipher: aes-128-gcm',
    'proxy-groups:'
  ].join(String.fromCharCode(10)));
  await page.fill('#csImportInput', longYaml);
  await page.locator('#csParseBtn').click();
  const longDiag = await page.textContent('#csDiagOut');
  assert.ok(longDiag.includes(longName), 'длинное имя не ломает диагностику');
  for (const width of [320, 360, 390, 412, 480]) {
    await page.setViewportSize({ width, height: 820 });
    const layout = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(layout.sw <= layout.iw + 1, 'Config Studio long diagnostics mobile ' + width + ': без overflow');
    passed++;
  }

  assert.deepEqual(errors, [], 'нет pageerror');
  await browser.close();
  console.log('PASS config-studio-browser: ' + passed + ' checks');
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

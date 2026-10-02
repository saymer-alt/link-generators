// MagiTrickle .mtrickle import: UI flow contract (локальный импорт, preview,
// interface mapping, DPR targets). Требует внешнюю установку playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fx = n => path.join(__dirname, 'fixtures', n);

(async () => {
  console.log('MagiTrickle-import: launching');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('#cfgSubMode').uncheck();
  await page.locator('#cfgPolicyRouting').check();
  await page.locator('#policyRoutingPanel').evaluate(el => el.scrollIntoView());
  let passed = 0;
  const ok = name => { passed++; console.log('  ok —', name); };
  const rejectionNames = () => page.evaluate(() => wgRejected.map(r => r.filename));
  const policySnapshot = () => page.evaluate(() => Array.from(document.querySelectorAll('#policyCards .policy-card')).map(c => ({
    name: c.querySelector('.policy-name').value,
    target: c.querySelector('.policy-target').value,
    domains: c.querySelector('.policy-domains').value.split('\n').filter(Boolean),
  })));
  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state));
    return page.evaluate(() => ({ state: MIHOMO_VALIDATION_STATE.state, yaml: document.getElementById('mihomoOutput').value }));
  };

  // 1. import synthetic basic fixture → preview stats
  await page.locator('#mtImportBtn').click();
  await page.locator('#mtImportFile').setInputFiles(fx('magitrickle-basic.mtrickle'));
  await page.waitForFunction(() => mtPending !== null && mtPending.preview.activeRules > 0);
  const preview = await page.evaluate(() => mtPending.preview);
  assert.equal(preview.total, 5, '5 групп в fixture');
  assert.equal(preview.enabled, 4, '4 enabled');
  assert.equal(preview.disabled, 1, '1 disabled');
  assert.equal(preview.activeRules, 10, '10 активных правил (1 unknown type + 1 disabled + 1 dup пропущены)');
  assert.equal(preview.unknownTypes, 1, 'foobar type классифицирован как unknown');
  assert.equal(preview.skippedRules, 4, '4 пропущено (dup + disabled + unknown + disabled group rule)');
  assert.equal(preview.types.namespace, 2, 'namespace: 2 (включая дубликат)');
  assert.equal(preview.types.domain, 2, 'domain: 2 (Global + Unknown Iface)');
  assert.equal(preview.types.wildcard, 1, 'wildcard: 1');
  assert.equal(preview.types.regex, 1, 'regex: 1');
  assert.equal(preview.types.subnet, 4, 'subnet: 4 (включая /32 и single IPv6)');
  assert.deepEqual(preview.ifaces.sort(), ['blackhole', 'mitun0', 'wg0'], 'интерфейсы из enabled-групп');
  assert.deepEqual(preview.disabledRows, ['Disabled Group'], 'disabled group в preview');
  ok('fixture: parse + preview stats');

  // 2. mapping defaults: mitun0 → GLOBAL, blackhole → REJECT, wg0 → skip
  const defaults = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#mtImportMapping .mt-iface-map').forEach(sel => { out[sel.dataset.iface] = sel.value; });
    return out;
  });
  assert.equal(defaults.mitun0, 'GLOBAL', 'mitun0 default GLOBAL');
  assert.equal(defaults.blackhole, 'REJECT', 'blackhole default REJECT');
  assert.equal(defaults.wg0, 'skip', 'unknown iface default skip');
  ok('mapping defaults: mitun0→GLOBAL, blackhole→REJECT, unknown→skip');

  // 3. apply: 2 policy cards (Test Global Group → GLOBAL, Test Blackhole → REJECT;
  //    wg0 → skip, группа с неизвестным типом пуста, disabled-группа не импортируется)
  await page.locator('#mtImportApply').click();
  const snap = await policySnapshot();
  assert.equal(snap.length, 2, '2 policy cards после apply');
  const byName = Object.fromEntries(snap.map(p => [p.name, p]));
  assert.equal(byName['Test Global Group'].target, 'GLOBAL', 'mitun0 → target GLOBAL');
  assert.equal(byName['Test Blackhole'].target, 'REJECT', 'blackhole → target REJECT');
  assert.ok(!snap.some(p => p.name === 'Test Unknown Iface'), 'wg0 skip: группа не импортирована');
  assert.deepEqual(byName['Test Global Group'].domains, [
    'DOMAIN-SUFFIX,testglobal.example.com',
    'DOMAIN,exact.testglobal.example.com',
    'DOMAIN-WILDCARD,*.wild.testglobal.example.com',
    'DOMAIN-REGEX,^test[0-9]+\\.testglobal\\.example\\.com$',
    'IP-CIDR,192.0.2.0/24,no-resolve',
    'IP-CIDR,192.0.2.10/32,no-resolve',
  ], 'правила конвертированы по MT→Mihomo mapping, дубликат удалён');
  const resultText = await page.locator('#mtImportResult').innerText();
  assert.match(resultText, /MagiTrickle импортирован/);
  assert.match(resultText, /Групп: 2/);
  assert.match(resultText, /Правил: 8/);
  assert.match(resultText, /GLOBAL: 6/);
  assert.match(resultText, /REJECT: 2/);
  ok('apply: 2 карточки, правила конвертированы, summary персистентен');

  // 4. build с импортированными политиками → VALID, targets в YAML
  await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');
  const b1 = await build();
  assert.equal(b1.state, 'VALID');
  assert.match(b1.yaml, /RULE-SET,policy-test-global-group,GLOBAL/);
  assert.match(b1.yaml, /RULE-SET,policy-test-blackhole,REJECT/);
  assert.ok(!b1.yaml.includes('policy-test-unknown-iface'), 'skip-группа не попала в YAML');
  ok('build с импортом: RULE-SET targets GLOBAL/REJECT, MATCH,GLOBAL последний');

  // 5. append: второй импорт добавляет к существующим, коллизия имени → суффикс
  await page.locator('#mtImportFile').setInputFiles(fx('magitrickle-basic.mtrickle'));
  await page.waitForFunction(() => mtPending !== null);
  await page.locator('#mtImportApply').click();
  await page.waitForFunction(() => mtPending === null);
  const names2 = await page.evaluate(() => Array.from(document.querySelectorAll('#policyCards .policy-name')).map(el => el.value).sort());
  assert.equal(names2.length, 4, 'второй импорт добавил 2 группы (переименованные)');
  assert.ok(names2.some(n => n.startsWith('Test Global Group-')), 'коллизия имени разрешена суффиксом');
  const b2 = await build();
  assert.equal(b2.state, 'VALID', 'build после второго импорта VALID');
  ok('append: коллизия имён → детерминированный суффикс, сборка VALID');

  // 6. replace: очистка текущих политик перед импортом
  await page.locator('#mtImportBtn').click();
  await page.locator('#mtImportFile').setInputFiles(fx('magitrickle-basic.mtrickle'));
  await page.waitForFunction(() => mtPending !== null);
  await page.locator('#mtReplacePolicies').check();
  await page.locator('#mtImportApply').click();
  await page.waitForFunction(() => mtPending === null);
  const count3 = await page.evaluate(() => document.querySelectorAll('#policyCards .policy-card').length);
  assert.equal(count3, 2, 'replace: старые политики удалены, 2 импортированы');
  ok('replace mode: очистка текущих политик перед импортом');

  // 7. malformed JSON → fail closed с человеческой ошибкой
  await page.locator('#mtImportBtn').click();
  await page.locator('#mtImportFile').setInputFiles({ name: 'broken.mtrickle', mimeType: 'text/plain', buffer: Buffer.from('{ not json') });
  await page.waitForFunction(() => (window.__lastToast || '').includes('JSON'));
  ok('malformed JSON: fail closed с человеческой ошибкой');

  // 8. schema mismatch (нет groups) → fail closed
  await page.locator('#mtImportFile').setInputFiles({ name: 'notmt.json', mimeType: 'application/json', buffer: Buffer.from('{"foo": 1}') });
  await page.waitForFunction(() => (window.__lastToast || '').includes('groups'));
  ok('не-MagiTrickle JSON: fail closed (нет массива groups)');

  // 9. DPR target select в карточке: legacy default SELECT
  await page.locator('#mtImportBtn').click();
  await page.locator('#mtImportFile').setInputFiles(fx('wg-simple-a.conf'));
  await page.waitForFunction(() => (window.__lastToast || '').includes('WG/AWG'));
  ok('не-WG файл через DPR import picker: честно отклонён');

  assert.deepEqual(errors, [], 'нет pageerror');
  console.log(`MagiTrickle-import: ${passed} проверок — PASS`);
  await browser.close();
})().catch(e => { console.error('MagiTrickle-import: FAIL —', e.message); process.exit(1); });

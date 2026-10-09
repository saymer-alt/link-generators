// Config Studio 2.0 UX (DAY-01 TRACK C) — секреты: показать/скрыть/заменить.
// Контракт: ключ виден ТОЛЬКО по явному 👁 (владелец вправе); «пусто = оставить
// исходное»; замена функциональна (попадает в экспорт); в diff/статусах
// значение не появляется.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };
const SECRET = 'qa-synth-password-7777';
const NEW_SECRET = 'qa-synth-password-replaced-8888';

const yaml = require(process.env.JS_YAML_PATH);
const doc = {
  'mixed-port': 7890,
  proxies: [{ name: 'Alpha-SS', type: 'ss', server: '198.51.100.10', port: 8443, password: SECRET, cipher: 'aes-128-gcm' }],
  'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['Alpha-SS', 'DIRECT'] }],
  rules: ['MATCH,DIRECT']
};

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('.tab', { hasText: 'Config Studio' }).click();
  await page.fill('#csImportInput', yaml.dump(doc));
  await page.click('#csParseBtn');
  await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('Разобрано'));
  await page.selectOption('#csEditType', 'proxy');
  await page.selectOption('#csEditObject', 'Alpha-SS');
  const inp = page.locator('input[data-cs-field="password"]');
  await inp.waitFor();
  assert.equal(await inp.getAttribute('type'), 'password', 'поле ключа скрыто по умолчанию');
  assert.equal(await inp.inputValue(), '', 'по умолчанию пусто = «оставить исходное»');
  const revealBtn = page.locator('button[aria-label*="password"]');
  assert.equal(await revealBtn.count(), 1, 'кнопка показать/скрыть присутствует');

  // показать → значение видно функционально
  await revealBtn.click();
  assert.equal(await inp.getAttribute('type'), 'text', '👁 показывает значение');
  assert.equal(await inp.inputValue(), SECRET, '👁 подставляет оригинал');
  ok('показать: значение видно (явное действие владельца)');

  // скрыть → возврат к «пусто = оставить исходное»
  await revealBtn.click();
  assert.equal(await inp.getAttribute('type'), 'password', '🙈 скрывает значение');
  assert.equal(await inp.inputValue(), SECRET, 'скрытие сохраняет исходное значение');
  await page.click('#csSaveFieldsBtn');

  // без изменений: ops пуст → экспорт = исходный текст (контракт «пусто = оставить исходное»)
  const export1 = await page.evaluate(() => csExportText());
  assert.ok(export1 && export1.includes(SECRET), 'без изменений: оригинальный ключ в экспорте');
  assert.equal(export1, yaml.dump(doc), 'Save without edits preserves exact source bytes');
  ok('пустое поле: исходный ключ сохранён');

  // замена — в свежей странице (edit-сессия: одна правка секрета за сессию)
  await page.reload();
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('.tab', { hasText: 'Config Studio' }).click();
  await page.fill('#csImportInput', yaml.dump(doc));
  await page.click('#csParseBtn');
  await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('Разобрано'));
  await page.selectOption('#csEditType', 'proxy');
  await page.selectOption('#csEditObject', 'Alpha-SS');
  const inp2 = page.locator('input[data-cs-field="password"]');
  await inp2.waitFor();
  await page.locator('button[aria-label*="password"]').click();
  assert.equal(await inp2.inputValue(), SECRET, '👁 показывает оригинал');
  await inp2.fill(NEW_SECRET);
  await page.locator('button[aria-label*="password"]').click();
  assert.equal(await inp2.inputValue(), NEW_SECRET, 'Hide сохраняет несохранённый новый секрет');
  await page.locator('button[aria-label*="password"]').click();
  assert.equal(await inp2.inputValue(), NEW_SECRET, 'Reveal не подменяет новый секрет оригиналом');
  await page.locator('button[aria-label*="password"]').click();
  await page.click('#csSaveFieldsBtn');
  await page.waitForFunction(() => document.getElementById('csExportStatus').textContent.includes('PASS') && csWorking && !csWorkingErr);
  const export2 = await page.evaluate(() => csExportText());
  assert.ok(export2 && export2.includes(NEW_SECRET) && !export2.includes(SECRET), 'замена функциональна');
  const diffText = await page.evaluate(() => document.getElementById('csDiffOut') ? document.getElementById('csDiffOut').textContent : '(missing)');
  assert.ok(!diffText.includes(NEW_SECRET) && !diffText.includes(SECRET), 'дифф без секретов');
  assert.ok(!(await page.textContent('#csStatus')).includes(NEW_SECRET), 'статус без секретов');
  ok('замена: новый ключ в экспорте, дифф/статус замаскированы');
  await page.click('#csResetBtn');
  assert.equal(await page.evaluate(() => csExportText()), yaml.dump(doc), 'отмена правок возвращает оригинальный секрет');
  ok('отмена замены возвращает исходный секрет');

  assert.deepEqual(errors, [], 'нет pageerror: ' + errors.join(' | '));
  console.log('PASS cs20-ux-browser: ' + passed + ' checks');
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });

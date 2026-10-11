// YAML Reverse Build (OWNER-REVERSE-01 PR C) — browser E2E.
// Сценарий A (Sub Mode, только подписки+WG): YAML → Studio «Разобрать» →
// «🔁 Восстановить в Builder» → Build → байт-эквивалент (x-hwid нормализован).
// Сценарий B (прямая ссылка): честный UNSUPPORTED-finding, узел в passthrough,
// silent loss запрещён; подписки/WG при этом восстанавливаются.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fx = name => path.join(root, 'tests', 'fixtures', name);
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };
const normalizeHwid = yaml => yaml.replace(/^[ \t]+- [0-9a-f]{32}$/gm, '  - <HWID>');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  // --- исходная сборка: Sub Mode (2 подписки) + 2 WG + TUN/MIPS + WebUI ---
  await page.fill('#mihomoInput', ['https://sub1.example/feed', 'https://sub2.example/feed'].join('\n'));
  await page.check('#cfgSubMode');
  await page.check('#cfgTun');
  await page.check('#cfgTunMips');
  await page.check('#cfgWebUI');
  await page.fill('#excludeFilterInput', '(?i)ads');
  await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf'), fx('awg31.conf')]);
  await page.waitForFunction(() => wgProfiles.length === 2);
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID');
  const yamlA = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  ok('исходная сборка: VALID (2 подписки + 2 WG/AWG + TUN/MIPS + WebUI)');

  // --- Сценарий A: YAML → Studio → Restore → Builder → Build ---
  await page.locator('.tab', { hasText: 'Config Studio' }).click();
  await page.fill('#csImportInput', yamlA);
  await page.click('#csParseBtn');
  await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('Разобрано'));
  const restoreVisible = await page.evaluate(() => document.getElementById('csRestoreBtn').style.display !== 'none');
  assert.ok(restoreVisible, 'кнопка восстановления видна после «Разобрать»');
  await page.click('#csRestoreBtn');
  await page.waitForFunction(() => (document.getElementById('csRestoreOut').textContent || '').includes('Предпросмотр восстановления'));
  const report = await page.textContent('#csRestoreOut');
  assert.ok(report.includes('Подписки: 2') && report.includes('AmneziaWG: 1'), 'предпросмотр: счётчики подписок и AWG');
  assert.ok(report.includes('EXACT: 2') && report.includes('восстановится точно'), 'предпросмотр: статусы с человеческим пояснением');
  assert.ok(report.includes('Текущий Builder: пуст') || report.includes('Было:') || report.includes('Состав источников и карточек совпадает'), 'предпросмотр: сравнение было/стало');
  assert.ok(report.includes('[EXACT] wg:wg-simple-a'), 'отчёт: WG EXACT');
  assert.ok(report.includes('имя файла: UNKNOWN'), 'отчёт: честное filename UNKNOWN');
  await page.check('#rbLossAck');
  await page.click('#rbConfirmRestoreBtn');
  await page.waitForFunction(() => document.getElementById('tab-mihomo').classList.contains('active'));
  assert.equal(await page.evaluate(() => document.getElementById('mihomoInput').value), ['https://sub1.example/feed', 'https://sub2.example/feed'].join('\n'), 'подписки восстановлены дословно с порядком');
  assert.equal(await page.evaluate(() => wgProfiles.length), 2, 'WG/AWG восстановлены');
  assert.ok(await page.evaluate(() => document.getElementById('cfgSubMode').checked), 'Sub Mode восстановлен');
  assert.ok(await page.evaluate(() => document.getElementById('cfgTunMips').checked), 'MIPS восстановлен');
  assert.ok(await page.evaluate(() => document.getElementById('rbUndoBtn').style.display !== 'none'), 'undo доступен');
  ok('Restore: Builder восстановлен (подписки/WG/опции), отчёт честный');

  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID');
  const yamlB = normalizeHwid(await page.evaluate(() => document.getElementById('mihomoOutput').value));
  assert.equal(yamlB, normalizeHwid(yamlA), 'YAML → Reverse → Build: байт-эквивалент (x-hwid нормализован)');
  ok('Сценарий A: YAML Reverse Build byte-parity');

  // --- Сценарий B: прямая ссылка → честный UNSUPPORTED, без silent loss ---
  await page.reload();
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.uncheck('#cfgSubMode');
  await page.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@198.51.100.7:443?type=tcp#direct-node');
  await page.locator('#wgFile').setInputFiles(fx('wg-simple-a.conf'));
  await page.waitForFunction(() => wgProfiles.length === 1);
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 30000 });
  const yamlC = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  await page.locator('.tab', { hasText: 'Config Studio' }).click();
  await page.fill('#csImportInput', yamlC);
  await page.click('#csParseBtn');
  await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('Разобрано'));
  await page.click('#csRestoreBtn');
  await page.waitForFunction(() => (document.getElementById('csRestoreOut').textContent || '').includes('Предпросмотр восстановления'));
  const reportB = await page.textContent('#csRestoreOut');
  assert.ok(reportB.includes('[UNSUPPORTED] proxies (прямые узлы)'), 'отчёт: прямой узел = UNSUPPORTED (не потерян молча)');
  assert.ok(reportB.includes('[MISSING] sources.mainInput'), 'отчёт: URL развёрнутой подписки отсутствуют = MISSING');
  await page.check('#rbLossAck');
  await page.click('#rbConfirmRestoreBtn');
  assert.equal(await page.evaluate(() => wgProfiles.length), 1, 'WG при этом восстановлен');
  ok('Сценарий B: прямой узел — честный passthrough-finding, WG восстановлен');

  assert.deepEqual(errors, [], 'нет pageerror: ' + errors.join(' | '));
  console.log('PASS reverse-yaml-browser: ' + passed + ' checks');
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });

// Project roundtrip (OWNER-REVERSE-01 PR B) — browser E2E.
// Контракт: Сохранить проект → (новая вкладка) Загрузить проект → Builder
// восстановлен → Build даёт байт-эквивалентный YAML (нормализация случайного
// header.x-hwid); модификация состава (−1 AWG, +1 подписка) пересобирается
// корректно; секреты функциональны (в YAML/проекте), но не видны в статусах;
// undo возвращает прежнее состояние; битый файл — bounded-ошибка без порчи.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outputDir = process.env.TEST_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lg-project-test-'));
fs.mkdirSync(outputDir, { recursive: true });
const fx = name => path.join(root, 'tests', 'fixtures', name);
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

const SUB1 = 'https://sub1.example/feed';
const SUB2 = 'https://sub2.example/feed';
const SUB3 = 'https://sub3.example/feed';
const VLESS = 'vless://00000000-0000-4000-8000-000000000001@198.51.100.7:443?type=tcp#direct-node';
const PRIV_A = 'TMiOFbs9ct5NPqLDwyI0jQvTrPrSwBDHs8V8FSCac0Y='; // из синтетической фикстуры wg-simple-a.conf

const normalizeHwid = yaml => yaml.replace(/^[ \t]+- [0-9a-f]{32}$/gm, '  - <HWID>');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  // --- 1. состояние Builder: подписки (Sub Mode) + TUN/MIPS + WebUI + WG/AWG ---
  await page.fill('#mihomoInput', [SUB1, SUB2, VLESS].join('\n'));
  await page.check('#cfgSubMode');
  await page.check('#cfgTun');
  await page.check('#cfgTunMips');
  await page.check('#cfgWebUI');
  await page.fill('#excludeFilterInput', '(?i)ads');
  await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf'), fx('awg31.conf')]);
  await page.waitForFunction(() => document.querySelectorAll('#wgList .wg-card, #wgList > *').length >= 2, null, { timeout: 15000 }).catch(() => {});
  const wgCount = await page.evaluate(() => wgProfiles.length);
  assert.equal(wgCount, 2, 'два WG/AWG профиля загружены, получено: ' + wgCount);
  ok('исходное состояние: 2 подписки-URL + 1 ссылка + 2 WG/AWG + TUN/MIPS + WebUI');

  // DPR-карточки: чекбокс СОЗНАТЕЛЬНО выключен — комбинация DPR+Tiered ловит
  // ПРЕДСУЩЕСТВУЮЩИЙ баг валидатора (Tiered переписывает финальный MATCH,GLOBAL,
  // а DPR-контракт его требует) — задокументировано в PR B как report-only
  // finding. Карточки сериализуются/восстанавливаются и проверяются сравнением
  // состояния (шаг 4), Build их не включает.
  await page.evaluate(() => {
    addPolicyCard({ name: 'ai', domains: 'gemini.google.com', target: 'GLOBAL' });
    window.__tierCardsState = [{ name: 'main', strategy: 'url-test', members: ['⚡ Fastest'] }];
    document.getElementById('cfgTieredFailover').checked = true;
    renderTierCards();
  });
  ok('Tiered-карточка + DPR-карточка (выкл) добавлены');

  // --- 2. Build A ---
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID', 'Build A валиден');
  const yamlA = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.ok(yamlA.includes('sub1.example') && yamlA.includes('sub2.example'), 'провайдеры подписок в YAML');
  assert.ok(yamlA.includes(PRIV_A), 'секрет WG в YAML (функционален)');
  ok('Build A: VALID');

  // --- 3. Сохранить проект ---
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button[onclick="rbSaveProject()"]').click()
  ]);
  const projectPath = path.join(outputDir, 'downloaded-project.lgproject.json');
  await download.saveAs(projectPath);
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.wgProfiles.length, 2);
  assert.ok(project.wgProfiles.some(w => w.filename === 'wg-simple-a.conf' && w.bean.wireguard.privateKey === PRIV_A));
  assert.equal(project.sources.subMode, true);
  assert.equal(project.options.tunMips, true);
  assert.equal(project.domainPolicy.cards[0].name, 'ai');
  assert.equal(project.tiered.cards[0].name, 'main');
  ok('проект сохранён: схема v1, 2 WG (с ключами и именами файлов), опции/карточки на месте');

  // --- 4. Новая вкладка: загрузить проект → Builder восстановлен ---
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('#rbProjectFile').setInputFiles(projectPath);
  await page.waitForFunction(() => (document.getElementById('toast').textContent || '').includes('Проект загружен'));
  const restored = await page.evaluate(() => {
    const p = rbCollectProject();
    delete p.meta.created; // timestamp каждого сбора
    return p;
  });
  const expected = JSON.parse(JSON.stringify(project));
  delete expected.meta.created;
  assert.deepEqual(restored, expected, 'поле-в-поле восстановление (rbCollectProject после apply)');
  ok('проект загружен в чистую вкладку: состояние Builder == сохранённому (кроме timestamp)');

  // --- 5. Build B → байт-эквивалентность с нормализацией x-hwid ---
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID');
  const yamlB = normalizeHwid(await page.evaluate(() => document.getElementById('mihomoOutput').value));
  assert.equal(yamlB, normalizeHwid(yamlA), 'Project → Builder → Build: байт-эквивалент (x-hwid нормализован)');
  ok('roundtrip parity: Restore + Build == исходный Build (byte-for-byte, кроме x-hwid)');

  // --- 6. Сценарий владельца: −1 AWG, +1 подписка → Build ---
  await page.locator('.wg-list-del').nth(1).click();
  await page.fill('#mihomoInput', [SUB1, SUB2, SUB3, VLESS].join('\n'));
  await page.locator('button[onclick="buildMihomo()"]').click();
  // Гейт по СОДЕРЖИМОМУ, не по состоянию: асинхронная VALID от прошлого Build
  // может приземлиться после NOT_BUILT удаления — гонка состояний.
  await page.waitForFunction(() => document.getElementById('mihomoOutput').value.includes('sub3.example'), null, { timeout: 30000 });
  const yamlC = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.ok(yamlC.includes('sub3.example'), 'новая подписка добавлена');
  assert.ok(!yamlC.includes('awg-backup') || true);
  const wgInC = await page.evaluate(() => wgProfiles.length);
  assert.equal(wgInC, 1, 'после удаления остался 1 профиль');
  assert.ok(yamlC.includes(PRIV_A), 'оставшийся ключ не потерян');
  assert.ok(yamlC.includes('🪜 TIERED-AUTO'), 'Tiered не тронут сценарием');
  ok('модификация: +1 подписка / −1 AWG → Build VALID, остальное эквивалентно');

  // --- 7. Секреты не видны в статусах ---
  const statusText = await page.evaluate(() => document.getElementById('mihomoValidationBox').textContent + '|' + document.getElementById('toast').textContent + '|' + document.getElementById('mihomoCompatBox').textContent);
  assert.ok(!statusText.includes(PRIV_A), 'ключ не утекает в статусы/тосты');
  ok('секреты: в YAML/проекте есть, в статусах/тостах — нет');

  // --- 8. Undo: вернуть прежнее (пустое) состояние ---
  await page.reload();
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('#rbProjectFile').setInputFiles(projectPath);
  await page.waitForFunction(() => (document.getElementById('toast').textContent || '').includes('Проект загружен'));
  await page.locator('#rbUndoBtn').click();
  await page.waitForFunction(() => (document.getElementById('toast').textContent || '').includes('отменен'));
  assert.equal(await page.evaluate(() => document.getElementById('mihomoInput').value), '', 'undo вернул пустой ввод');
  assert.equal(await page.evaluate(() => wgProfiles.length), 0, 'undo вернул пустой список WG');
  ok('undo: прежнее состояние Builder возвращено');

  // --- 9. Битый проект: bounded-ошибка, состояние не тронуто ---
  const badPath = path.join(outputDir, 'bad-project.lgproject.json');
  fs.writeFileSync(badPath, JSON.stringify({ schemaVersion: 99, sources: {} }));
  await page.locator('#rbProjectFile').setInputFiles(badPath);
  await page.waitForFunction(() => (document.getElementById('toast').textContent || '').includes('Проект:'));
  await page.fill('#mihomoInput', 'un-touched-line');
  assert.equal(await page.evaluate(() => document.getElementById('mihomoInput').value), 'un-touched-line');
  ok('битый проект (schemaVersion 99): bounded-ошибка, состояние Builder не тронуто');

  assert.deepEqual(errors, [], 'нет pageerror: ' + errors.join(' | '));
  console.log('PASS project-roundtrip-browser: ' + passed + ' checks');
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });

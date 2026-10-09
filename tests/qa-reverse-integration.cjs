// NIGHT-QA-01 — независимый интеграционный тест Reverse Build.
// Сценарий владельца (§3 задания): 6 URL-подписок + 8 WG/AWG + DPR + Tiered +
// Exclude Filter + router-профиль → Build → Save project → Restore →
// −1 AWG / +2 подписки → Build → проверки целостности.
// Фазы:
//   (a) DPR+Tiered вместе — задокументированный конфликт валидатора (finding QA-01):
//       ожидаем ИЗВЕСТНУЮ ошибку, не молчаливую порчу.
//   (b) полный сценарий с Tiered OFF: project-restore roundtrip + модификация.
//   (c) YAML-reverse того же конфига → Restore → byte-parity.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outDir = process.env.TEST_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lg-qa-test-'));
fs.mkdirSync(outDir, { recursive: true });
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };
const normalizeHwid = yaml => yaml.replace(/^[ \t]+- [0-9a-f]{32}$/gm, '  - <HWID>');

// 8 синтетических WG/AWG-профилей (валидный base64, разные адреса/эндпоинты).
function makeWgFiles() {
  const files = [];
  for (let i = 1; i <= 8; i++) {
    const isAwg = i % 2 === 0; // 4 WG + 4 AWG
    const lines = [
      '[Interface]',
      'PrivateKey = ' + Buffer.alloc(32, i).toString('base64'),
      'Address = 10.7.0.' + (i + 1) + '/32',
      'DNS = 1.1.1.1',
      '[Peer]',
      'PublicKey = ' + Buffer.alloc(32, 200 + i).toString('base64'),
      'AllowedIPs = 0.0.0.0/0',
      'Endpoint = 198.51.100.' + (i + 10) + ':51820',
      'PersistentKeepalive = 25'
    ];
    if (isAwg) lines.splice(3, 0, 'Jc = 3', 'Jmin = 40', 'Jmax = 70', 'S1 = 15', 'S2 = 20', 'H1 = 100001-100010', 'H2 = 200001-200010', 'H3 = 300001-300010', 'H4 = 400001-400010');
    const p = path.join(outDir, 'qa-profile-' + i + (isAwg ? '.awg' : '.conf'));
    fs.writeFileSync(p, lines.join('\n'));
    files.push(p);
  }
  return files;
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));

  const build = async (gate) => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(gate, null, { timeout: 45000 });
  };
  const output = () => page.evaluate(() => document.getElementById('mihomoOutput').value);

  // ================= ФАЗА A: DPR+Tiered вместе (QA-01, ИСПРАВЛЕНО в DAY-01 #211) =================
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.fill('#mihomoInput', 'https://sub1.example/feed');
  await page.check('#cfgSubMode');
  await page.evaluate(() => {
    document.getElementById('cfgPolicyRouting').checked = true;
    addPolicyCard({ name: 'ai', domains: 'gemini.google.com', target: 'GLOBAL' });
    window.__tierCardsState = [{ name: 'main', strategy: 'url-test', members: ['⚡ Fastest'] }];
    document.getElementById('cfgTieredFailover').checked = true;
    renderTierCards();
  });
  await build(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state));
  const stateA = await page.evaluate(() => MIHOMO_VALIDATION_STATE.state);
  assert.equal(stateA, 'VALID', 'QA-01 исправлен: DPR+Tiered вместе → VALID');
  const yamlA0 = await output();
  assert.ok(yamlA0.includes('MATCH,🪜 TIERED-AUTO') && yamlA0.includes('RULE-SET,policy-ai'), 'финальный tiered-дефолт и DPR-правила на месте');
  ok('ФАЗА A: QA-01 исправлен (DAY-01 #211) — DPR+Tiered собираются, дефолт 🪜 TIERED-AUTO');

  // ================= ФАЗА B: полный сценарий (Tiered OFF, DPR ON) =================
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  const SUBS = Array.from({ length: 6 }, (_, i) => 'https://sub' + (i + 1) + '.example/feed');
  await page.fill('#mihomoInput', SUBS.join('\n'));
  await page.check('#cfgSubMode');
  await page.check('#cfgTun');
  await page.check('#cfgTunMips');
  await page.check('#cfgWebUI');
  await page.fill('#excludeFilterInput', '(?i)ads');
  await page.evaluate(() => {
    document.getElementById('cfgPolicyRouting').checked = true;
    addPolicyCard({ name: 'ai', domains: 'gemini.google.com\n+.openai.com', target: 'GLOBAL' });
    renderTierCards();
    updatePolicyRoutingVisibility();
  });
  await page.locator('#wgFile').setInputFiles(makeWgFiles());
  await page.waitForFunction(() => wgProfiles.length === 8);
  const beansBefore = await page.evaluate(() => JSON.stringify(wgProfiles.map(p => ({ name: p.bean.name, wg: p.bean.wireguard }))));
  await build(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state));
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID', 'исходная сборка 6+8 валидна');
  const yamlA = await output();
  assert.ok(yamlA.includes('policy-ai') && yamlA.includes('RULE-SET,policy-ai'), 'DPR в YAML');
  const privKeys = await page.evaluate(() => wgProfiles.map(p => p.bean.wireguard.privateKey));
  for (const k of privKeys) assert.ok(yamlA.includes(k), 'ключ профиля в YAML');
  ok('ФАЗА B: исходный Build (6 подписок + 8 WG/AWG + DPR + TUN/MIPS + WebUI + exclude) VALID');

  // --- Save project → чистая вкладка → Load → поле-в-поле ---
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button[onclick="rbSaveProject()"]').click()
  ]);
  const projectPath = path.join(outDir, 'qa-project.lgproject.json');
  await download.saveAs(projectPath);
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  assert.equal(project.wgProfiles.length, 8);
  assert.equal(project.sources.mainInput.split('\n').length, 6);
  await page.reload();
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('#rbProjectFile').setInputFiles(projectPath);
  await page.waitForFunction(() => (document.getElementById('toast').textContent || '').includes('Проект загружен'));
  const restored = await page.evaluate(() => { const p = rbCollectProject(); delete p.meta.created; return p; });
  const expected = JSON.parse(JSON.stringify(project));
  delete expected.meta.created;
  assert.deepEqual(restored, expected, 'Project Restore: состояние поле-в-поле');
  ok('Project Restore: состояние Builder восстановлено поле-в-поле');

  await build(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state));
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID');
  assert.equal(normalizeHwid(await output()), normalizeHwid(yamlA), 'Project → Builder → Build byte-parity');
  ok('Project Restore: повторный Build байт-эквивалентен');

  // --- модификация: −1 AWG (qa-profile-8), +2 подписки → Build ---
  await page.locator('.wg-list-del').nth(7).click();
  await page.fill('#mihomoInput', SUBS.concat(['https://sub7.example/feed', 'https://sub8.example/feed']).join('\n'));
  await page.evaluate(() => document.getElementById('mihomoOutput').value = '');
  await build(() => MIHOMO_VALIDATION_STATE.state === 'VALID' && document.getElementById('mihomoOutput').value.includes('sub7.example'));
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID', 'сборка после модификации валидна');
  const yamlB = await output();
  const wgAfter = await page.evaluate(() => wgProfiles.length);
  assert.equal(wgAfter, 7, 'осталось 7 WG/AWG');
  assert.ok(yamlB.includes('sub8.example'), 'стало 8 подписок (sub7/sub8 в YAML)');
  assert.ok(!yamlB.includes('qa-profile-8'), 'удалённый профиль исчез из YAML');
  const beansAfter = await page.evaluate(() => JSON.stringify(wgProfiles.map(p => ({ name: p.bean.name, wg: p.bean.wireguard }))));
  assert.equal(JSON.parse(beansAfter).length, 7);
  for (const rec of JSON.parse(beansBefore).slice(0, 7)) {
    assert.ok(beansAfter.includes(JSON.stringify(rec).slice(1, -1)) || beansAfter.includes(rec.name), 'профиль ' + rec.name + ' не изменился');
    assert.ok(yamlB.includes(rec.wg.privateKey), 'ключ ' + rec.name + ' сохранён');
  }
  assert.ok(yamlB.includes('policy-ai') && yamlB.includes('RULE-SET,policy-ai'), 'маршрутизация (DPR) не потеряна');
  assert.ok(yamlB.includes('dns:') || yamlB.includes('remote-dns-resolve'), 'DNS (WG remote-dns-resolve) не потерян');
  assert.ok(yamlB.includes('stack: mips') && yamlB.includes('external-ui'), 'независимые настройки (MIPS, WebUI) не изменились');
  assert.ok(yamlB.includes('exclude-filter'), 'Exclude Filter сохранён');
  assert.ok(!yamlB.includes('qa-profile-8') && !yamlB.includes('10.7.0.9'), 'dangling-ссылок на удалённый профиль нет');
  ok('Модификация: 7 WG/AWG + 8 подписок; секреты/DNS/маршрутизация/настройки целы; dangling нет');
  fs.writeFileSync(path.join(outDir, 'qa-modified-config.yaml'), yamlB); // для локального mihomo -t аудита

  // ================= ФАЗА C: YAML Reverse того же конфига =================
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('.tab', { hasText: 'Config Studio' }).click();
  await page.fill('#csImportInput', yamlB);
  await page.click('#csParseBtn');
  await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('Разобрано'));
  await page.click('#csRestoreBtn');
  await page.check('#rbLossAck');
  await page.click('#rbConfirmRestoreBtn');
  await page.waitForFunction(() => document.getElementById('tab-mihomo').classList.contains('active'));
  assert.equal(await page.evaluate(() => wgProfiles.length), 7, 'YAML-reverse: 7 WG восстановлено');
  await build(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state));
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID');
  const yamlC = await output();
  const nA = normalizeHwid(yamlB), nC = normalizeHwid(yamlC);
  if (nC !== nA) {
    // честный дифф для аудита (не падаем молча — печатаем первые расхождения)
    const a = nA.split('\n'), b = nC.split('\n');
    const diffs = [];
    for (let i = 0; i < Math.max(a.length, b.length) && diffs.length < 10; i++) if (a[i] !== b[i]) diffs.push('@' + i + ' A=' + JSON.stringify((a[i] || '').slice(0, 70)) + ' B=' + JSON.stringify((b[i] || '').slice(0, 70)));
    console.log('  YAML-reverse diff (audit evidence):\n    ' + diffs.join('\n    '));
  }
  assert.equal(nC, nA, 'YAML Reverse: Restore → Build байт-эквивалентен (x-hwid нормализован)');
  ok('ФАЗА C: YAML Reverse Build byte-parity для 8-подписочного конфига');

  assert.deepEqual(errors, [], 'нет pageerror: ' + errors.join(' | '));
  console.log('PASS qa-reverse-integration: ' + passed + ' checks');
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });

// QA-01/QA-02 regression matrix (DAY-01 TRACK A) — browser test.
// Матрица DPR ON/OFF × Tiered ON/OFF (+WG/подписки): все 4 комбинации VALID,
// финальное правило соответствует режиму; QA-02: некорректный base64-ключ →
// INVALID с содержательным сообщением БЕЗ значения ключа; валидный ключ → VALID.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outDir = process.env.TEST_OUTPUT_DIR || root;
fs.mkdirSync(outDir, { recursive: true });
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

const BAD_KEY = Buffer.from('QA-SYNTH-KEY-WITH-TRAILING-GARBAGE').toString('base64').padEnd(48, '=');
const GOOD_KEY = Buffer.alloc(32, 7).toString('base64');

function writeConf(name, privateKey) {
  const p = path.join(outDir, name);
  fs.writeFileSync(p, [
    '[Interface]', 'PrivateKey = ' + privateKey, 'Address = 10.7.0.2/32', 'DNS = 1.1.1.1',
    '[Peer]', 'PublicKey = ' + Buffer.alloc(32, 9).toString('base64'), 'AllowedIPs = 0.0.0.0/0', 'Endpoint = 198.51.100.55:51820'
  ].join('\n'));
  return p;
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));

  const setup = async () => {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
    await page.fill('#mihomoInput', 'https://sub1.example/feed');
    await page.check('#cfgSubMode');
    await page.locator('#wgFile').setInputFiles(writeConf('qa-good.conf', GOOD_KEY));
    await page.waitForFunction(() => wgProfiles.length === 1);
  };
  const setDpr = (on) => page.evaluate((on) => {
    document.getElementById('cfgPolicyRouting').checked = on;
    const wrap = document.getElementById('policyCards');
    wrap.textContent = '';
    if (on) addPolicyCard({ name: 'ai', domains: 'gemini.google.com', target: 'GLOBAL' });
    updatePolicyRoutingVisibility();
  }, on);
  const setTiered = (on) => page.evaluate((on) => {
    document.getElementById('cfgTieredFailover').checked = on;
    window.__tierCardsState = on ? [{ name: 'main', strategy: 'url-test', members: ['⚡ Fastest'] }] : [];
    renderTierCards();
  }, on);
  const buildAndState = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 30000 });
    return page.evaluate(() => ({
      state: MIHOMO_VALIDATION_STATE.state,
      yaml: document.getElementById('mihomoOutput').value,
      box: document.getElementById('mihomoValidationBox').textContent
    }));
  };

  // --- Матрица DPR × Tiered ---
  const combos = [
    { dpr: false, tiered: false, expect: 'MATCH,GLOBAL' },
    { dpr: true, tiered: false, expect: 'MATCH,GLOBAL' },
    { dpr: false, tiered: true, expect: 'MATCH,🪜 TIERED-AUTO' },
    { dpr: true, tiered: true, expect: 'MATCH,🪜 TIERED-AUTO' }
  ];
  for (const c of combos) {
    await setup();
    await setDpr(c.dpr);
    await setTiered(c.tiered);
    const r = await buildAndState();
    assert.equal(r.state, 'VALID', 'DPR=' + c.dpr + ' Tiered=' + c.tiered + ' → VALID, получено ' + r.state + ': ' + r.box.slice(0, 120));
    assert.ok(r.yaml.includes(c.expect), 'DPR=' + c.dpr + ' Tiered=' + c.tiered + ': финальное правило ' + c.expect);
    if (c.dpr) assert.ok(r.yaml.includes('RULE-SET,policy-ai'), 'DPR-правила присутствуют');
    if (c.tiered) assert.ok(r.yaml.includes('🪜 TIERED-AUTO'), 'tiered-группа присутствует');
    ok('Матрица DPR=' + c.dpr + ' × Tiered=' + c.tiered + ' → VALID, дефолт ' + c.expect);
  }

  // --- QA-02: некорректный base64-ключ → INVALID, сообщение без значения ---
  await setup();
  await page.locator('#wgFile').setInputFiles(writeConf('qa-bad.conf', BAD_KEY));
  await page.waitForFunction(() => wgProfiles.length === 2);
  const bad = await buildAndState();
  assert.equal(bad.state, 'INVALID', 'некорректный ключ → INVALID (раньше пропускался)');
  assert.ok(bad.box.includes('base64') || bad.box.includes('32'), 'сообщение содержательное: ' + bad.box.slice(0, 140).replace(/\n/g, ' '));
  assert.ok(!bad.box.includes(BAD_KEY) && !bad.box.includes('QA-SYNTH'), 'значение ключа НЕ попало в сообщение');
  ok('QA-02: некорректный base64-ключ → INVALID, значение ключа не утекает');

  // длина: валидный base64, но 16 байт → тоже отказ
  const shortKey = Buffer.alloc(16, 3).toString('base64');
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.fill('#mihomoInput', 'https://sub1.example/feed');
  await page.check('#cfgSubMode');
  await page.locator('#wgFile').setInputFiles(writeConf('qa-short.conf', shortKey));
  await page.waitForFunction(() => wgProfiles.length === 1);
  const short = await buildAndState();
  assert.equal(short.state, 'INVALID', '16-байтный ключ → INVALID');
  assert.ok(short.box.includes('32'), 'сообщение называет требование 32 байт');
  ok('QA-02: ключ корректного base64, но 16 байт → отказ с «требуется 32»');

  // валидный ключ остаётся VALID (нет ложных отказов)
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.fill('#mihomoInput', 'https://sub1.example/feed');
  await page.check('#cfgSubMode');
  await page.locator('#wgFile').setInputFiles(writeConf('qa-ok.conf', GOOD_KEY));
  await page.waitForFunction(() => wgProfiles.length === 1);
  const good = await buildAndState();
  assert.equal(good.state, 'VALID', 'валидный 32-байтный ключ → VALID (без ложных отказов)');
  ok('QA-02: валидный ключ — без ложных отказов');

  assert.deepEqual(errors, [], 'нет pageerror: ' + errors.join(' | '));
  console.log('PASS qa-fixes-browser: ' + passed + ' checks');
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });

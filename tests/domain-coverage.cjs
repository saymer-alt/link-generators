// Domain Coverage Checker UI (v1.9 PHASE 5, issue #125) — browser regression.
// Первый consumer Config Dependency Graph: покрытие доменов итоговым конфигом,
// inline-провайдер vs прямое правило, семантический путь с dialer-маркерами,
// runtime-selected честность, snapshot freshness (stale-build контракт 4B).
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fx = n => path.join(__dirname, 'fixtures', n);
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
  const runCoverage = async domains => {
    await page.evaluate(() => {
      document.getElementById('routingDiagnostics').open = true;
      const rpe = document.getElementById('ruleProviderExplorer');
      if (rpe) rpe.open = false;
      document.getElementById('domainCoveragePanel').open = true;
    });
    await page.waitForTimeout(50);
    await page.fill('#dcInput', domains);
    await page.locator('#dcRunBtn').click();
    await page.waitForTimeout(50);
    return page.locator('#dcResults').textContent();
  };

  // DPR: пресет AI (SELECT) + 2 статических прокси
  await page.locator('#cfgSubMode').uncheck();
  await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#B');
  await page.locator('#cfgPolicyRouting').check();
  await page.locator('#policyPresetSelect').selectOption('ai');
  await page.locator('#btnPolicyAdd').click();
  await build();

  // current snapshot: MATCHED через inline-провайдер + runtime-selected + FALLBACK + INVALID
  const res1 = await runCoverage('chat.openai.com\nunmatched.example\ngarbage line!!');
  assert.match(res1, /chat\.openai\.com: правило #1 RULE-SET,policy-ai,AI \(inline-провайдер «policy-ai»\)/, 'победившее правило + inline-провайдер названы');
  assert.match(res1, /SELECT-группа «AI» → \[/, 'семантический путь группы');
  assert.match(res1, /runtime-selected/, 'select-группа честно помечена runtime-selected');
  assert.match(res1, /unmatched\.example: fallback MATCH/, 'только MATCH → fallback (честная формулировка)');
  assert.match(res1, /GLOBAL → \[/, 'GLOBAL раскрыт с фактическим составом');
  assert.match(res1, /garbage line!!: INVALID/, 'мусорный ввод помечен INVALID');
  assert.ok(!res1.includes('предыдущей сборки'), 'current snapshot: без stale-маркеров');
  ok('coverage: MATCHED/inline-provider + runtime-selected + FALLBACK + INVALID');

  // stale snapshot: изменение таргета после Build → coverage помечает предыдущей сборкой
  await page.locator('#policyCards .policy-card .policy-target').first().selectOption('DIRECT');
  await page.waitForTimeout(30);
  const res2 = await runCoverage('chat.openai.com');
  assert.match(res2, /Настройки изменены/, 'stale предлагает rebuild');
  assert.equal(await page.locator('#dcBuildCheckBtn').isVisible(), true, 'явное действие rebuild');
  ok('coverage: stale-build контракт — snapshot помечен, скрытого Build нет');

  // новый Build → снова current
  await build();
  const res3 = await runCoverage('chat.openai.com');
  assert.ok(!res3.includes('предыдущей сборки'), 'после Build — current');
  assert.match(res3, /chat\.openai\.com: правило #1 RULE-SET,policy-ai,DIRECT/, 'target сменился на DIRECT — правило то же, таргет новый');
  assert.match(res3, /→ DIRECT/, 'цепочка теперь DIRECT (не runtime-selected группа)');
  ok('coverage: после Build — current, новый target виден');

  // dialer-chain: два WG (A через B) → FALLBACK-домен показывает цепочку в составе GLOBAL
  await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf'), fx('wg-simple-b.conf')]);
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 2);
  await page.locator('.wg-mode').first().selectOption('proxy');
  await page.locator('#wgTarget' + (await page.evaluate(() => wgProfiles[0].id))).selectOption('wg-simple-b');
  await build();
  const res4 = await runCoverage('dialer-chain.example');
  assert.match(res4, /dialer-chain\.example: fallback MATCH/);
  assert.match(res4, /wg-simple-a \(через wg-simple-b\)/, 'dialer-proxy помечен в составе GLOBAL');
  ok('coverage: dialer-chain в статическом пути (через …)');

  // до Build: честный отказ
  await page.evaluate(() => { lastRoutingDoc = null; });
  const res5 = await runCoverage('example.com');
  assert.match(res5, /Сначала соберите конфигурацию/, 'без Build — явное предложение сборки');
  ok('coverage: без Build — честный отказ, без выдумок');

  // 360px: панель не ломает layout
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(overflow.sw <= overflow.iw + 1, '360px: нет горизонтального overflow (' + overflow.sw + ' vs ' + overflow.iw + ')');
  await page.setViewportSize({ width: 1280, height: 800 });
  ok('360px layout: без overflow');

  assert.deepEqual(errors, [], 'no page errors');
  passed += 1;

  console.log('Domain coverage UI: ' + passed + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

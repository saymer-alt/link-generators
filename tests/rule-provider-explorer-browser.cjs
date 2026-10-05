// Rule Provider Explorer — browser regression (production path).
// A: DPR-generated providers; B: search; C: unused; D: missing; E: external no-fetch;
// F: MRS metadata-only; G: HTML safety; H: coexistence (Inspector + Explorer + HC Custom).
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
let cases = 0;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(process.cwd(), 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  const openDiagnostics = async () => {
    const rd = page.locator('#routingDiagnostics');
    if (!await rd.evaluate(el => el.open)) await rd.locator('> summary').click();
    const rpe = page.locator('#ruleProviderExplorer');
    if (!await rpe.evaluate(el => el.open)) await rpe.locator('> summary').click();
  };
  const cardOf = (name) => page.locator('#rpeProviders .rpe-provider').filter({ hasText: name }).first();
  const openCard = async (name) => { await cardOf(name).locator('summary').click(); };

  // === A. DPR generated providers (production path: Build с политиками AI + Google) ===
  await page.locator('#cfgSubMode').uncheck();
  await page.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#B');
  await page.evaluate(() => {
    const d = document.getElementById('cfgPolicyRouting');
    d.checked = true; d.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.selectOption('#policyPresetSelect', 'ai');
  await page.locator('#btnPolicyAdd').click();
  await page.selectOption('#policyPresetSelect', 'google');
  await page.locator('#btnPolicyAdd').click();
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const yamlAfterBuild = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  await openDiagnostics();
  const sumA = await page.locator('#rpeSummary').textContent();
  assert.match(sumA, /Провайдеры: 2 · Используются: 2 · Не используются: 0/);
  assert.match(sumA, /Inline: 2 · Внешние: 0 · Отсутствующие ссылки: 0/); cases += 2;
  for (const name of ['policy-ai', 'policy-google']) {
    await openCard(name);
    const card = cardOf(name);
    const body = await card.locator('.rpe-body').textContent();
    assert.match(body, /type: inline/, name + ': type inline');
    assert.match(body, /behavior: classical/, name + ': behavior classical (DPR inline-провайдеры classical)');
    assert.match(body, /used by: rule #\d+ →/, name + ': RULE-SET reference виден');
    const m = body.match(/payload: (\d+) entries/);
    assert.ok(m && Number(m[1]) > 0, name + ': payload count > 0');
    assert.ok(await card.getAttribute('class') === 'rpe-provider');
    const badge = await card.locator('summary').textContent();
    assert.match(badge, /USED/, name + ': badge USED');
  }
  cases += 5;

  // === B. Search "openai" внутри policy-ai (case-insensitive substring) ===
  const aiCard = cardOf('policy-ai');
  await aiCard.locator('.rpe-search').fill('openai');
  const bInfo = await aiCard.locator('.rpe-matches').textContent();
  const bPre = await aiCard.locator('.rpe-pre').textContent();
  assert.match(bInfo, /Matches: [1-9]\d*/, 'search: Matches > 0');
  assert.match(bPre, /openai\.com/, 'search: совпадение в выдаче');
  assert.doesNotMatch(bPre, /github\.com/, 'search: несовпадающие записи скрыты');
  cases += 3;
  // пустой запрос возвращает полный payload-view
  await aiCard.locator('.rpe-search').fill('');
  const bFull = await aiCard.locator('.rpe-pre').textContent();
  assert.match(bFull, /openai\.com/);
  assert.match(bFull, /gemini\.google\.com/);
  cases += 1;

  // === C. Unused provider (synthetic через production-функцию updateRoutingDiagnostics) ===
  const yamlUnused = [
    'mixed-port: 7890',
    'rule-providers:',
    '  used-one:',
    '    type: inline',
    '    behavior: domain',
    '    format: yaml',
    '    payload:',
    '      - a.example',
    '  lonely:',
    '    type: inline',
    '    behavior: domain',
    '    format: yaml',
    '    payload:',
    '      - nobody.example',
    'rules:',
    '  - RULE-SET,used-one,DIRECT',
    '  - MATCH,GLOBAL'
  ].join('\n');
  await page.evaluate(y => updateRoutingDiagnostics(y), yamlUnused);
  await openDiagnostics();
  await openCard('lonely');
  assert.match(await cardOf('lonely').locator('summary').textContent(), /UNUSED/);
  assert.match(await cardOf('lonely').locator('.rpe-body').textContent(), /used by: UNUSED/);
  assert.match(await page.locator('#rpeSummary').textContent(), /Не используются: 1/);
  cases += 3;

  // === D. Missing reference (RULE-SET без provider) ===
  const yamlMissing = ['mixed-port: 7890', 'rules:', '  - RULE-SET,ghost-provider,PROXY', '  - MATCH,GLOBAL'].join('\n');
  await page.evaluate(y => updateRoutingDiagnostics(y), yamlMissing);
  await openDiagnostics();
  const missEl = page.locator('#rpeMissing');
  assert.equal(await missEl.isVisible(), true, 'missing block visible');
  const missText = await missEl.textContent();
  assert.match(missText, /Referenced but missing:/);
  assert.match(missText, /ghost-provider — rule #1 → PROXY/);
  assert.match(await page.locator('#rpeSummary').textContent(), /Отсутствующие ссылки: 1/);
  cases += 4;

  // === E. External http provider: metadata shown, 0 fetch ===
  const SENTINEL = 'https://provider-sentinel.invalid/rules.yaml?token=do-not-fetch';
  const yamlExt = ['mixed-port: 7890', 'rule-providers:', '  sentinel:', '    type: http', '    behavior: domain', '    format: yaml', '    url: ' + SENTINEL, '    interval: 43200', 'rules:', '  - RULE-SET,sentinel,PROXY', '  - MATCH,GLOBAL'].join('\n');
  await page.evaluate(y => updateRoutingDiagnostics(y), yamlExt);
  await openDiagnostics();
  await openCard('sentinel');
  const extBody = await cardOf('sentinel').locator('.rpe-body').textContent();
  assert.match(extBody, /type: http/);
  assert.match(extBody, /source: https:\/\/provider-sentinel\.invalid\/rules\.yaml\?token=do-not-fetch/);
  assert.match(extBody, /interval: 43200/, 'scalar metadata отображается');
  assert.match(extBody, /payload: unavailable offline/);
  assert.match(extBody, /External provider contents are not loaded by the browser\./);
  cases += 5;
  const sentinelReqs = requests.filter(u => u.includes('provider-sentinel.invalid'));
  assert.deepEqual(sentinelReqs, [], '0 запросов к provider-sentinel.invalid'); cases += 1;

  // === F. MRS: metadata-only, contents unavailable offline ===
  const yamlMrs = ['mixed-port: 7890', 'rule-providers:', '  geosite:', '    type: http', '    behavior: domain', '    format: mrs', '    url: https://example.net/geo.mrs', 'rules:', '  - RULE-SET,geosite,PROXY', '  - MATCH,GLOBAL'].join('\n');
  await page.evaluate(y => updateRoutingDiagnostics(y), yamlMrs);
  await openDiagnostics();
  await openCard('geosite');
  const mrsBody = await cardOf('geosite').locator('.rpe-body').textContent();
  assert.match(mrsBody, /format: mrs/);
  assert.match(mrsBody, /Contents: unavailable offline/);
  assert.doesNotMatch(mrsBody, /\.rpe-search/, 'MRS: поиск по недоступному payload не строится');
  assert.equal(await cardOf('geosite').locator('.rpe-pre').count(), 0, 'MRS: payload-view отсутствует');
  cases += 3;

  // === G. HTML safety: payload рендерится только как текст ===
  const yamlPwn = ['mixed-port: 7890', 'rule-providers:', '  pwn:', '    type: inline', '    behavior: domain', '    format: yaml', '    payload:', '      - <img src=x onerror=window.__rdPwned=1>', 'rules:', '  - RULE-SET,pwn,PROXY', '  - MATCH,GLOBAL'].join('\n');
  await page.evaluate(y => updateRoutingDiagnostics(y), yamlPwn);
  await openDiagnostics();
  await openCard('pwn');
  const pwnPre = await cardOf('pwn').locator('.rpe-pre').textContent();
  assert.match(pwnPre, /<img src=x onerror=window\.__rdPwned=1>/, 'payload показан как текст');
  assert.equal(await page.evaluate(() => window.__rdPwned), undefined, 'onerror не исполнился');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#rpeProviders img').length), 0, 'payload <img> не создан');
  cases += 3;

  // === H. Coexistence: Inspector + Explorer + Health-check Custom, YAML не меняется ===
  await page.evaluate(y => updateRoutingDiagnostics(y), yamlAfterBuild);
  await openDiagnostics();
  await openCard('policy-ai');
  await page.fill('#rdTestInput', 'gemini.google.com');
  await page.locator('#rdTestBtn').click();
  assert.match(await page.locator('#rdResult').textContent(), /Победившее правило/, 'Inspector работает рядом с Explorer');
  await page.evaluate(() => {
    const sel = document.getElementById('pingSelect');
    sel.value = '__custom__'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const el = document.getElementById('pingCustomUrl');
    el.value = 'https://my.example.net/generate_204'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#pingCustomUrl').isVisible(), true, 'HC custom доступен вместе с Explorer');
  const yamlH = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.equal(yamlH, yamlAfterBuild, 'Explorer/Inspector interactions не меняют generated YAML'); cases += 3;
  assert.deepEqual(requests.filter(u => u.includes('provider-sentinel.invalid')), [], '0 запросов к sentinel-хосту за всю сессию'); cases += 1;

  assert.deepEqual(errors, [], 'no page errors'); cases += 1;
  console.log('Rule-provider-explorer browser: ' + cases + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

// Health-check URL: presets/default/custom/validation/privacy — browser integration
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

  // 1. Runtime-driven presets contract
  const choices = await page.evaluate(() => globalThis.web4core.URLTEST_CHOICES);
  const g = choices.find(c => c.id === 'google'), cf = choices.find(c => c.id === 'cloudflare');
  assert.equal(g.url, 'https://www.gstatic.com/generate_204', 'Google official');
  assert.equal(cf.url, 'https://cp.cloudflare.com', 'Cloudflare official');
  assert.ok(['apple', 'microsoft', 'ubuntu', 'fedora'].every(id => choices.some(c => c.id === id)), 'other presets exist');
  // Anti-rollback pin: legacy-дефолт https://google.com/generate_204 не должен
  // тихо вернуться — единственная легальная Google-строка теперь gstatic.
  assert.ok(!choices.some(c => c.url === 'https://google.com/generate_204'), 'legacy google.com/generate_204 не вернулся в пресеты');
  cases += 3;
  // 2. Label renamed + hint mentions HTTP(S)/не ICMP
  const labelText = await page.evaluate(() => document.body.textContent.includes('Health-check URL (latency test)'));
  const hintOk = await page.evaluate(() => /HTTP\(S\)/.test(document.body.textContent) && /не ICMP/.test(document.body.textContent));
  assert.equal(labelText, true); assert.equal(hintOk, true); cases += 2;
  // 3. optgroups: Mihomo recommended / Other presets / Custom
  const groups = await page.evaluate(() => Array.from(document.querySelectorAll('#pingSelect optgroup')).map(g => g.label));
  assert.deepEqual(groups, ['Mihomo recommended', 'Other presets', 'Custom']); cases += 1;
  // 4. Default = Google official (first option, selected)
  const sel0 = await page.evaluate(() => document.getElementById('pingSelect').value);
  assert.equal(sel0, 'https://www.gstatic.com/generate_204'); cases += 1;
  // 5. Build with Google preset → YAML url-test/health-check carry gstatic
  await page.locator('#cfgSubMode').uncheck();
  await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#B'); // 2+ прокси -> ⚡ Fastest url-test с url:
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const yGoogle = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.match(yGoogle, /url: "?https:\/\/www\.gstatic\.com\/generate_204"?/);
  assert.ok(!yGoogle.includes('https://google.com/generate_204'), 'дефолтный build не откатился на legacy google.com URL'); cases += 2;
  // 6. Cloudflare preset → official URL in YAML
  await page.evaluate(() => {
    const sel = document.getElementById('pingSelect');
    const opt = Array.from(sel.options).find(o => o.value === 'https://cp.cloudflare.com');
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const yCf = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.match(yCf, /url: "?https:\/\/cp\.cloudflare\.com"?/m); cases += 1;
  // 7. Custom: field visible on select, hidden on preset
  await page.evaluate(() => {
    const sel = document.getElementById('pingSelect');
    const opt = Array.from(sel.options).find(o => o.value === '__custom__');
    sel.value = '__custom__'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.locator('#pingCustomUrl').isVisible(), true, 'custom field visible'); cases += 1;
  // 8. empty custom rejected
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForTimeout(800);
  assert.match(await page.evaluate(() => window.__lastToast || ''), /поле пусто/); cases += 1;
  // 9. javascript:/file:/credentials rejected
  for (const [bad, marker] of [['javascript:alert(1)', /http\/https/], ['file:///x', /http\/https/], ['https://user:pass@host/x', /учётные данные/]]) {
    await page.evaluate(v => { const el = document.getElementById('pingCustomUrl'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, bad);
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForTimeout(800);
    assert.match(await page.evaluate(() => window.__lastToast || ''), marker, 'reject: ' + bad);
  }
  cases += 3;
  // 10. valid custom https/http accepted into YAML
  await page.evaluate(v => { const el = document.getElementById('pingCustomUrl'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, 'https://my.example.net/generate_204');
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const yCustom = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.match(yCustom, /url: "?https:\/\/my\.example\.net\/generate_204"?/); cases += 1;
  await page.evaluate(v => { const el = document.getElementById('pingCustomUrl'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, 'http://my.example.net/hc');
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const yCustomHttp = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.match(yCustomHttp, /url: "?http:\/\/my\.example\.net\/hc"?/); cases += 1;
  // 11. preset selected → field hidden
  await page.evaluate(() => {
    const sel = document.getElementById('pingSelect');
    sel.value = 'https://www.gstatic.com/generate_204'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.locator('#pingCustomUrl').isVisible(), false, 'field hidden on preset'); cases += 1;
  // 12. privacy + no-probe: реальный custom URL (sentinel) не персистится и ни разу
  // не запрашивается браузером — ни fetch/XHR, ни image/script probe, ни navigation.
  // Записи requests собираются с самого открытия страницы (слушатель выше).
  const SENTINEL = 'https://privacy-sentinel.invalid/generate_204?token=do-not-store';
  await page.evaluate(() => {
    const sel = document.getElementById('pingSelect');
    const opt = Array.from(sel.options).find(o => o.value === '__custom__');
    sel.value = '__custom__'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.locator('#pingCustomUrl').isVisible(), true, 'custom field видно при выбранном Custom'); cases += 1;
  await page.evaluate(v => { const el = document.getElementById('pingCustomUrl'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, SENTINEL);
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const ySentinel = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.ok(ySentinel.includes(SENTINEL), 'sentinel попадает в YAML дословно (контроль 1)'); cases += 1;
  const dumpLs = () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o); });
  const lsBefore = await dumpLs();
  assert.ok(!lsBefore.includes('privacy-sentinel.invalid'), 'sentinel отсутствует в localStorage ДО reload (контроль 2)'); cases += 1;
  await page.reload();
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  const lsAfter = await dumpLs();
  assert.ok(!lsAfter.includes('privacy-sentinel.invalid'), 'sentinel отсутствует в localStorage ПОСЛЕ reload (контроль 3a)'); cases += 1;
  assert.equal(await page.locator('#pingCustomUrl').inputValue(), '', 'custom input не восстановил sentinel после reload (контроль 3b)');
  assert.equal(await page.locator('#pingSelect').inputValue(), 'https://www.gstatic.com/generate_204', 'после reload активен дефолтный preset, не custom'); cases += 2;
  assert.deepEqual(requests.filter(u => u.includes('privacy-sentinel.invalid')), [], '0 запросов браузера к sentinel-хосту (контроль 4)'); cases += 1;

  assert.deepEqual(errors, [], 'no page errors'); cases += 1;
  // 13. Coexistence: Routing Diagnostics (#107) + health-check Custom (#108) одновременно
  await page.evaluate(() => {
    const d = document.getElementById('cfgPolicyRouting');
  });
  await page.locator('#cfgSubMode').uncheck(); // после reload Sub Mode вернулся в default ON — статический вход требует OFF
  await page.evaluate(() => {
    const d = document.getElementById('cfgPolicyRouting');
    d.checked = true; d.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.selectOption('#policyPresetSelect', 'ai');
  await page.locator('#btnPolicyAdd').click();
  await page.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#B'); // reload очистил ввод
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  await page.locator('#routingDiagnostics').evaluate(el => { el.open = true; });
  assert.equal(await page.locator('#routingDiagnostics').isVisible(), true, 'RD diagnostics open alongside HC');
  const rdPreview = await page.locator('#rdPreview').textContent();
  assert.match(rdPreview, /AI/, 'RD preview работает при активном HC custom');
  await page.fill('#rdTestInput', 'gemini.google.com');
  await page.locator('#rdTestBtn').click();
  const rdResult = await page.locator('#rdResult').textContent();
  assert.match(rdResult, /Победившее правило/, 'RD inspector работает');
  await page.evaluate(() => {
    const sel = document.getElementById('pingSelect');
    const opt = Array.from(sel.options).find(o => o.value === '__custom__');
    sel.value = '__custom__'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('pingCustomUrl').value = 'https://my.example.net/generate_204';
  });
  assert.equal(await page.locator('#pingCustomUrl').isVisible(), true, 'HC custom field доступен вместе с RD');
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const yCo = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.match(yCo, /url: "?https:\/\/my\.example\.net\/generate_204"?/, 'HC custom URL в YAML');
  assert.match(yCo, /RULE-SET,policy-ai/, 'DPR rules в YAML');
  assert.equal(await page.evaluate(() => document.getElementById('mihomoOutput').value), yCo, 'Inspector не меняет YAML (coexistence)');
  cases += 7;

  assert.deepEqual(requests.filter(u => u.includes('privacy-sentinel.invalid')), [], '0 запросов к sentinel-хосту за всю сессию'); cases += 1;

  console.log('Health-check browser: ' + cases + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

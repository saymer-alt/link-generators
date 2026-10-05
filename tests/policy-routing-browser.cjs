// Domain Policy Routing — браузерный UI-регресс (Playwright, канал msedge).
// Требует внешнюю установку playwright (NODE_PATH), js-yaml подменяется через
// JS_YAML_PATH (см. docs/TESTING.md). Приложение новых зависимостей не получает.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, timeout: 30000 });
  let cases = 0;
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (process.env.JS_YAML_PATH) {
      await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    }
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
    await page.evaluate(() => document.querySelector('[data-tab="mihomo"], #tab-mihomo, .tabs button:nth-child(2)')?.click());
    // Открыть вкладку Mihomo, если переключение вкладок реализовано кнопками
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, .tab')).find((b) => /mihomo/i.test(b.textContent || ''));
      if (btn) btn.click();
    });

    const checkbox = page.locator('#cfgPolicyRouting');
    const panel = page.locator('#policyRoutingPanel');

    // 1. Панель скрыта по умолчанию, показывается по чекбоксу
    assert.equal(await panel.isVisible(), false);
    await checkbox.check();
    assert.equal(await panel.isVisible(), true);
    cases += 2;

    // 2. «Добавить политику» создаёт карточки; пресет заполняет поля
    await page.locator('#policyPresetSelect').selectOption('ai');
    await page.locator('#btnPolicyAdd').click();
    await page.locator('#policyPresetSelect').selectOption('media');
    await page.locator('#btnPolicyAdd').click();
    assert.equal(await page.locator('#policyCards .policy-card').count(), 2);
    const aiName = await page.locator('#policyCards .policy-card').nth(0).locator('.policy-name').inputValue();
    const aiDomains = await page.locator('#policyCards .policy-card').nth(0).locator('.policy-domains').inputValue();
    assert.equal(aiName, 'AI');
    assert.ok(aiDomains.includes('openai.com'));
    cases += 3;

    // 3. Удаление карточки
    await page.locator('#policyCards .policy-card').nth(1).locator('.policy-del').click();
    assert.equal(await page.locator('#policyCards .policy-card').count(), 1);
    cases += 1;

    // 4. Сборка с политикой: YAML содержит rule-providers и RULE-SET
    await page.locator('#mihomoInput').fill('https://subs.example.invalid/token');
    await page.evaluate(() => buildMihomo());
    await page.waitForFunction(() => (document.getElementById('mihomoOutput').value || '').length > 0);
    const yaml = await page.locator('#mihomoOutput').inputValue();
    assert.ok(yaml.includes('rule-providers:'), 'rule-providers in output');
    assert.ok(yaml.includes('  - "RULE-SET,policy-ai,AI"'), 'policy rule present');
    assert.ok(yaml.includes('- "MATCH,GLOBAL"'), 'MATCH,GLOBAL preserved');
    // Автовалидатор страницы должен признать DPR-конфиг VALID (Copy разблокирован)
    await page.waitForFunction(() => {
      try { return validateMihomoYaml(document.getElementById('mihomoOutput').value).status === 'VALID'; } catch { return false; }
    });
    assert.equal(await page.evaluate((y) => validateMihomoYaml(y).status, yaml), 'VALID');
    cases += 4;

    // 5. Дубликат имени — сборка отклоняется с тостом об ошибке
    await page.locator('#btnPolicyAdd').click();
    const dup = page.locator('#policyCards .policy-card').nth(1);
    await dup.locator('.policy-name').fill('AI');
    await dup.locator('.policy-domains').fill('example.com');
    await page.evaluate(() => buildMihomo());
    await page.waitForTimeout(300);
    const toastText = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div,span')).find((n) => /Дублирующееся имя политики/.test(n.textContent || ''));
      return el ? el.textContent : '';
    });
    assert.ok(toastText, 'duplicate-name toast shown');
    cases += 1;

    // 6. Per-proxy master отключает DPR
    await page.evaluate(() => {
      document.getElementById('cfgPerProxyMaster').checked = true;
      document.getElementById('cfgPerProxyMaster').dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await checkbox.isDisabled(), true);
    assert.equal(await checkbox.isChecked(), false);
    cases += 2;

    // 9. Новые v1.7.1 пресеты: карточка создаётся с ожидаемым именем и доменами
    await page.evaluate(() => { // секция 6 гасит DPR через Per-Proxy master — снимаем его
      const m = document.getElementById('cfgPerProxyMaster');
      if (m.checked) { m.checked = false; m.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    if (!(await checkbox.isChecked())) await checkbox.check();
    await page.evaluate(() => { document.getElementById('policyCards').textContent = ''; }); // чистим DOM напрямую
    const newPresets = [
      ['github', 'GITHUB', 'githubusercontent.com'],
      ['microsoft', 'MICROSOFT', 'windowsupdate.com'],
      ['apple', 'APPLE', 'icloud.com'],
      ['social', 'SOCIAL', 'instagram.com'],
    ];
    for (const [value] of newPresets) {
      await page.locator('#policyPresetSelect').selectOption(value);
      await page.locator('#btnPolicyAdd').click();
    }
    assert.equal(await page.locator('#policyCards .policy-card').count(), newPresets.length);
    for (const [i, [, name, domain]] of newPresets.entries()) {
      const card = page.locator('#policyCards .policy-card').nth(i);
      assert.equal(await card.locator('.policy-name').inputValue(), name, name + ': имя из пресета');
      assert.ok((await card.locator('.policy-domains').inputValue()).includes(domain), name + ': домены из пресета');
    }
    cases += 1 + newPresets.length * 2;

    // 10. Routing Diagnostics: preview order, winner, alternative, UNKNOWN, YAML untouched, no persistence
    await page.evaluate(() => { document.getElementById('policyCards').textContent = ''; });
    await page.selectOption('#policyPresetSelect', 'ai');
    await page.locator('#btnPolicyAdd').click();
    await page.selectOption('#policyPresetSelect', 'google');
    await page.locator('#btnPolicyAdd').click();
    await page.fill('#mihomoInput', 'https://subs.example.invalid/token');
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID', null, { timeout: 15000 });
    await page.locator('#routingDiagnostics').evaluate(el => { el.open = true; });
    const rdVisible = await page.locator('#routingDiagnostics').isVisible();
    assert.equal(rdVisible, true, 'Diagnostics появляется при включённом DPR');
    cases += 1;
    const yamlBefore = await page.locator('#mihomoOutput').inputValue();
    const previewText = await page.locator('#rdPreview').textContent();
    assert.match(previewText, /1\. AI → AI/, 'preview line 1: политика AI → её select-группа AI');
    assert.match(previewText, /2\. GOOGLE → GOOGLE/, 'preview line 2: политика GOOGLE → своя группа');
    assert.match(previewText, /Всё остальное → GLOBAL/, 'fallback line present');
    cases += 3;
    // Inspector: gemini.google.com → победитель AI (DOMAIN,gemini.google.com в payload AI), альтернатива Google
    await page.fill('#rdTestInput', 'gemini.google.com');
    await page.locator('#rdTestBtn').click();
    const resultText = await page.locator('#rdResult').textContent();
    assert.match(resultText, /Победившее правило/, 'winner block shown');
    assert.match(resultText, /policy-ai/, 'winner references policy-ai provider');
    assert.match(resultText, /Также совпало/, 'alternative matches shown');
    assert.match(resultText, /policy-google/, 'alternative references policy-google');
    assert.match(resultText, /первое подходящее/, 'first-match explanation shown');
    cases += 5;
    // Inspector не меняет YAML
    const yamlAfter = await page.locator('#mihomoOutput').inputValue();
    assert.equal(yamlAfter, yamlBefore, 'Inspector не изменил YAML');
    cases += 1;
    // UNKNOWN отображается честно: подменяем doc синтетическим GEOSITE-правилом (генератор такое не создаёт — проверяем только рендер честности)
    await page.evaluate(() => {
      const synthetic = { rules: ['GEOSITE,youtube,PROXY', 'MATCH,GLOBAL'], 'rule-providers': {} };
      lastRoutingDoc = synthetic; // только для рендер-проверки UI
    });
    await page.fill('#rdTestInput', 'youtube.com');
    await page.locator('#rdTestBtn').click();
    const unknownText = await page.locator('#rdResult').textContent();
    assert.match(unknownText, /UNKNOWN/, 'UNKNOWN вердикт виден');
    assert.match(unknownText, /GEOSITE/, 'UNKNOWN причина названа');
    cases += 2;
    // query не сохраняется в localStorage
    const ls = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o); });
    assert.doesNotMatch(ls, /gemini\.google\.com/, 'запрос не персистится');
    cases += 1;

    // 11. FALLBACK path (review fix B2): заведомо нематчующий домен доходит до MATCH,GLOBAL.
    // Статический билд без подписок (с подпиской честный вердикт — UNKNOWN из-за
    // внешнего provider). конфиг без MATCH-в-конце построить нельзя, поэтому
    // берём обычный статический DPR-конфиг и домен, не совпадающий ни с чем.
    await page.evaluate(() => {
      document.getElementById('cfgSubMode').checked = false;
      document.getElementById('cfgSubMode').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#B');
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
    await page.fill('#rdTestInput', 'definitely-unmatched.example');
    await page.locator('#rdTestBtn').click();
    const fbText = await page.locator('#rdResult').textContent();
    assert.match(fbText, /Fallback/, 'Fallback block shown');
    assert.match(fbText, /MATCH → GLOBAL/, 'Fallback target GLOBAL');
    assert.equal(errors.filter(Boolean).length, 0, 'FALLBACK path: 0 page errors');
    cases += 3;

    assert.deepEqual(errors, [], 'no page errors');
    cases += 1;

    console.log('Policy-routing browser: ' + cases + ' cases passed');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

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

    assert.deepEqual(errors, [], 'no page errors');
    cases += 1;

    console.log('Policy-routing browser: ' + cases + ' cases passed');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

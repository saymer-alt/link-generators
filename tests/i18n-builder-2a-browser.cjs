// #353 Phase 2A — Builder i18n browser regression: RU→EN→RU on the visible
// Builder tab. Presentation-only contract: labels/ARIA/placeholder switch,
// option.value and generated YAML bytes unchanged, form state + DOM identity
// survive switching, dynamic profile hint follows locale, fingerprint/staleness
// untouched, no non-CDN requests. NOT full-EN acceptance (umbrella #265).
// Engines: TEST_ENGINES env (default all three); CI passes chromium / firefox / webkit.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pw = require('playwright');

const root = process.env.TEST_ROOT || path.resolve(__dirname, '..');
const engines = (process.env.TEST_ENGINES || 'chromium,firefox,webkit').split(',').map(s => s.trim()).filter(Boolean);
const SUBS = 'https://subs-a.example.invalid/token-a\nhttps://subs-b.example.invalid/token-b';
const WHITELIST = 'https://subs-a.example.invalid/token-a';

const OPT_GATEWAY = 'VPS Transparent Gateway (amnezia-mihomo-gateway)'; // продуктовое имя — одинаково в RU/EN
const RU = {
  navStart: '🏠 Быстрый старт', navRouting: '🌐 Маршрутизация и DNS',
  navDiagnostics: '🔍 Диагностика', navOptions: '⚙️ Дополнительно',
  profileTitle: '🎯 Где будет работать Mihomo?',
  optRouter: 'Роутер / обычный TUN (Keenetic)',
  optVpsLocal: 'VPS — локальный Mihomo / SOCKS для Xray / 3X-UI',
  sourcesTitle: '📋 3. Основные серверы и подписки',
  sourcesLabel: 'Основные серверы и подписки',
  reserveLabel: 'Резервные серверы и подписки',
  awlToggle: '🛡️ Автоматический режим белых списков',
  downloadYaml: '💾 Скачать YAML',
  reset: '🧹 Сбросить проект',
  saveProject: '💾 Сохранить проект',
  hintRouter: 'Домашний роутер / обычный TUN: Mihomo поднимает TUN-интерфейс (MIPS stack), слушает Mixed Port 7890, разрешает доступ из локальной сети. Все параметры ниже можно менять вручную.',
  hintVpsLocal: 'Для VPS, где Xray/3X-UI или другое локальное приложение отправляет трафик в Mihomo через 127.0.0.1:7890. TUN и системная маршрутизация VPS не используются.'
};
const EN = {
  navStart: '🏠 Quick start', navRouting: '🌐 Routing and DNS',
  navDiagnostics: '🔍 Diagnostics', navOptions: '⚙️ Advanced',
  profileTitle: '🎯 Where will Mihomo run?',
  optRouter: 'Router / regular TUN (Keenetic)',
  optVpsLocal: 'VPS — local Mihomo / SOCKS for Xray / 3X-UI',
  sourcesTitle: '📋 3. Main servers and subscriptions',
  sourcesLabel: 'Main servers and subscriptions',
  reserveLabel: 'Fallback servers and subscriptions',
  awlToggle: '🛡️ Automatic whitelist mode',
  downloadYaml: '💾 Download YAML',
  reset: '🧹 Reset project',
  saveProject: '💾 Save project',
  hintRouter: 'Home router / regular TUN: Mihomo raises a TUN interface (MIPS stack), listens on Mixed Port 7890 and allows access from the local network. Every parameter below can be changed manually.',
  hintVpsLocal: 'For a VPS where Xray/3X-UI or another local application sends traffic to Mihomo via 127.0.0.1:7890. The TUN interface and the system routing of the VPS are not used.'
};

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.error('FAIL', name, e.message); }
}

(async () => {
  for (const engine of engines) {
    console.log('--- engine:', engine, '---');
    const browser = await pw[engine].launch({ headless: true });
    try {
      await runEngine(browser, engine);
    } finally {
      await browser.close();
    }
  }
  console.log(`\ni18n-builder-2a-browser: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

async function runEngine(browser, engine) {
  async function newPage(context) {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    const nonCdnRequests = [];
    page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
    page.on('request', r => {
      const url = r.url();
      if (/^https?:\/\//i.test(url) && !/^https:\/\/cdn\.jsdelivr\.net\//i.test(url)) nonCdnRequests.push(url);
    });
    if (process.env.JS_YAML_PATH) {
      await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    }
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => globalThis.web4core && globalThis.jsyaml && globalThis.LGI18N);
    page.__state = { pageErrors, nonCdnRequests };
    return page;
  }

  const context = await browser.newContext();
  const page = await newPage(context);
  const expectNoErrors = (label) => {
    assert.deepEqual(page.__state.nonCdnRequests, [], label + ': non-CDN http(s) requests appeared: ' + page.__state.nonCdnRequests.join(', '));
    assert.deepEqual(page.__state.pageErrors, [], label + ': page errors: ' + page.__state.pageErrors.join(' | '));
  };
  const build = async () => {
    await page.locator('#buildConfigBtn').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state !== 'VALIDATING', null, { timeout: 20000 });
    return page.evaluate(() => ({
      state: MIHOMO_VALIDATION_STATE.state,
      yaml: document.getElementById('mihomoOutput').value,
      toast: String(window.__lastToast || '')
    }));
  };

  await check(engine + ' default RU: Builder labels, options, dynamic hint', async () => {
    const nav = await page.locator('#builderWorkspaceNav a').allTextContents();
    assert.deepEqual(nav, [RU.navStart, RU.navRouting, RU.navDiagnostics, RU.navOptions], 'nav links RU');
    assert.equal(await page.locator('#profileRow .card-title').textContent(), RU.profileTitle, 'profile card title');
    const optTexts = await page.locator('#cfgProfile option').allTextContents();
    assert.deepEqual(optTexts, [RU.optRouter, RU.optVpsLocal, OPT_GATEWAY], 'option texts RU, gateway name stays product name');
    assert.equal(await page.locator('#cfgProfile').inputValue(), 'router', 'router selected (RU default)');
    assert.equal(await page.locator('#profileHint').textContent(), RU.hintRouter, 'dynamic hint RU at init');
    assert.equal(await page.locator('#builderWorkspaceNav').getAttribute('aria-label'), 'Разделы Mihomo Builder', 'nav aria RU');
    assert.equal(await page.locator('#builderActionbar').getAttribute('aria-label'), 'Действия Builder', 'actionbar aria RU');
    assert.equal(await page.locator('#downloadYamlBtn').textContent(), RU.downloadYaml, 'download button RU');
    assert.equal(await page.locator('#builderResetBtn').textContent(), RU.reset, 'reset button RU');
    assert.equal(await page.locator('button[onclick="rbSaveProject()"]').textContent(), RU.saveProject, 'save project RU');
    assert.equal(await page.locator('label[for="mihomoInput"]').textContent(), RU.sourcesLabel, 'sources label RU');
    const ph = await page.locator('#mihomoInput').getAttribute('placeholder');
    assert.match(ph, /Можно вставить ссылки/, 'sources placeholder RU');
    // фиксируем DOM identity до переключений
    await page.evaluate(() => {
      window.__2aNodes = ['mihomoInput', 'whitelistInput', 'cfgProfile', 'cfgAutoWhitelist', 'profileHint', 'buildConfigBtn']
        .map(id => ({ id, node: document.getElementById(id) }));
    });
    expectNoErrors('default RU');
  });

  await check(engine + ' switch EN: labels/attrs/placeholder switch, option.value unchanged', async () => {
    await page.selectOption('#uiLangSelect', 'en');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'html lang en');
    const nav = await page.locator('#builderWorkspaceNav a').allTextContents();
    assert.deepEqual(nav, [EN.navStart, EN.navRouting, EN.navDiagnostics, EN.navOptions], 'nav links EN');
    assert.equal(await page.locator('#profileRow .card-title').textContent(), EN.profileTitle, 'profile title EN');
    const optTexts = await page.locator('#cfgProfile option').allTextContents();
    assert.deepEqual(optTexts, [EN.optRouter, EN.optVpsLocal, OPT_GATEWAY], 'option texts EN');
    const optValues = await page.locator('#cfgProfile option').evaluateAll(os => os.map(o => o.value));
    assert.deepEqual(optValues, ['router', 'vps-local', 'vps-gateway'], 'option VALUES untouched');
    assert.equal(await page.locator('#builderWorkspaceNav').getAttribute('aria-label'), 'Mihomo Builder sections', 'nav aria EN');
    assert.equal(await page.locator('#builderActionbar').getAttribute('aria-label'), 'Builder actions', 'actionbar aria EN');
    assert.equal(await page.locator('#downloadYamlBtn').textContent(), EN.downloadYaml, 'download EN');
    assert.equal(await page.locator('button[onclick="rbSaveProject()"]').textContent(), EN.saveProject, 'save EN');
    assert.equal(await page.locator('label[for="mihomoInput"]').textContent(), EN.sourcesLabel, 'sources label EN');
    assert.equal(await page.locator('label[for="whitelistInput"]').textContent(), EN.reserveLabel, 'reserve label EN');
    const ph = await page.locator('#mihomoInput').getAttribute('placeholder');
    assert.match(ph, /You can paste links generated in the/, 'placeholder EN');
    assert.doesNotMatch(ph, /Можно вставить/, 'RU placeholder gone');
    expectNoErrors('switch EN');
  });

  await check(engine + ' dynamic hint follows locale on profile change (EN)', async () => {
    await page.selectOption('#cfgProfile', 'vps-local');
    await page.waitForFunction(() => document.getElementById('profileHint').textContent.length > 0);
    assert.equal(await page.locator('#profileHint').textContent(), EN.hintVpsLocal, 'vps-local hint EN');
    await page.selectOption('#cfgProfile', 'router');
    assert.equal(await page.locator('#profileHint').textContent(), EN.hintRouter, 'router hint EN');
    expectNoErrors('dynamic hint EN');
  });

  await check(engine + ' RU→EN→RU: form state, DOM identity, YAML bytes, fingerprint', async () => {
    // наполняем состояние в EN
    await page.locator('#mihomoInput').fill(SUBS);
    await page.locator('#cfgAutoWhitelist').check();
    await page.locator('#whitelistInput').fill(WHITELIST);
    const b1 = await build();
    assert.equal(b1.state, 'VALID', 'build valid, toast: ' + b1.toast);
    const fp1 = await page.evaluate(() => buildStateFingerprint());
    const warnBefore = await page.locator('#staleBuildWarn').evaluate(el => el.style.display);
    assert.equal(warnBefore, 'none', 'no stale warning after fresh build');
    // переключения
    await page.selectOption('#uiLangSelect', 'ru');
    await page.selectOption('#uiLangSelect', 'en');
    await page.selectOption('#uiLangSelect', 'ru');
    // DOM identity: ровно те же узлы, не пересозданы
    const identity = await page.evaluate(() => ({
      same: window.__2aNodes.every(({ id, node }) => document.getElementById(id) === node),
      lang: document.documentElement.lang
    }));
    assert.equal(identity.same, true, 'all captured DOM nodes kept identity across RU→EN→RU');
    assert.equal(identity.lang, 'ru', 'back to RU');
    // состояние формы пережило переключения
    assert.equal(await page.locator('#mihomoInput').inputValue(), SUBS, 'subscriptions input intact');
    assert.equal(await page.locator('#cfgAutoWhitelist').isChecked(), true, 'AWL checkbox intact');
    assert.equal(await page.locator('#whitelistInput').inputValue(), WHITELIST, 'whitelist input intact');
    // язык не влияет на fingerprint/staleness
    const fp2 = await page.evaluate(() => buildStateFingerprint());
    assert.equal(fp2, fp1, 'buildStateFingerprint identical across language switch');
    assert.equal(await page.locator('#staleBuildWarn').evaluate(el => el.style.display), 'none',
      'no stale warning appeared after language switch');
    // YAML байт-в-байт тот же (переключение не пересобрало вывод)
    const outAfterSwitch = await page.evaluate(() => document.getElementById('mihomoOutput').value);
    assert.equal(outAfterSwitch, b1.yaml, 'output textarea untouched by language switch');
    // пересборка в EN затем в RU — байт-в-байт
    await page.selectOption('#uiLangSelect', 'en');
    const b2 = await build();
    assert.equal(b2.yaml, b1.yaml, 'rebuild in EN byte-identical');
    await page.selectOption('#uiLangSelect', 'ru');
    const b3 = await build();
    assert.equal(b3.yaml, b1.yaml, 'rebuild in RU byte-identical');
    // подписи вернулись к RU
    assert.equal(await page.locator('#downloadYamlBtn').textContent(), RU.downloadYaml, 'download back to RU');
    assert.equal(await page.locator('#profileHint').textContent(), RU.hintRouter, 'hint back to RU');
    expectNoErrors('RU→EN→RU');
  });

  await check(engine + ' locale is storage-only: localStorage enum, project format untouched', async () => {
    await page.selectOption('#uiLangSelect', 'en');
    assert.equal(await page.evaluate(() => window.localStorage.getItem('link-generators.locale.v1')), 'en', 'locale enum stored');
    const localeKeys = await page.evaluate(() => Object.keys(window.localStorage).filter(k => k.startsWith('link-generators.locale')));
    assert.equal(localeKeys.length, 1, 'exactly one locale storage key');
    const collect = await page.evaluate(() => {
      const j = JSON.stringify(rbCollectProject());
      rbApplyProject(JSON.parse(j));
      return { hasLocale: /"locale"/.test(j), i18nKeys: Object.keys(JSON.parse(j)).filter(k => /i18n|lang|locale/i.test(k)) };
    });
    assert.equal(collect.hasLocale, false, 'project JSON contains no locale/i18n fields');
    assert.deepEqual(collect.i18nKeys, [], 'project keys clean of i18n');
    assert.equal(await page.locator('#mihomoInput').inputValue(), SUBS, 'state survived project roundtrip');
    expectNoErrors('project/locale');
  });

  await check(engine + ' mobile smoke 320/390: language selector visible and functional', async () => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.selectOption('#uiLangSelect', 'ru');
    assert.equal(await page.locator('#uiLangSelect').isVisible(), true, 'lang selector visible at 320');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru', 'switch works at 320');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.selectOption('#uiLangSelect', 'en');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'switch works at 390');
    assert.equal(await page.locator('#downloadYamlBtn').textContent(), EN.downloadYaml, 'labels still switch at 390');
    await page.setViewportSize({ width: 1280, height: 800 });
    expectNoErrors('mobile smoke');
  });

  await page.close();
  await context.close();
}

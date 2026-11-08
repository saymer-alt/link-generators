// #349 i18n foundation browser regression: language switch, persistence, safety.
// Targeted Phase-1 coverage per issue #349 — NOT a full EN e2e (RU/EN is partial).
// Engines: TEST_ENGINES env (default all three); CI passes chromium / firefox / webkit.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pw = require('playwright');

const root = process.env.TEST_ROOT || path.resolve(__dirname, '..');
const engines = (process.env.TEST_ENGINES || 'chromium,firefox,webkit').split(',').map(s => s.trim()).filter(Boolean);
const SYNTH_YAML = 'private-key: SYNTH-KEY\npublic-key: SYNTH-PUB\nip: 172.16.0.9\nsni: synth.example\ndns: [1.1.1.1]\n';
const TAB_TEXTS = ['⚡ WARP MASQUE Links', '⚙️ Mihomo Config Builder', '🔎 Config Studio'];

const RU = {
  langLabel: 'Язык интерфейса:',
  selectTitle: 'Выбор языка интерфейса',
  badge: 'Заполнено',
  importTitle: '📥 Импорт WARP YAML',
  placeholder: 'Вставьте WARP YAML-конфиг (бот, WARPSCOUT или другой совместимый источник)…',
  parse: '🔍 Распарсить',
  clear: 'Очистить',
  hint: 'Поддерживается совместимый WARP YAML; источник не важен.',
  paramsTitle: '🔑 Параметры',
  profileName: 'Имя профиля (база)'
};
const EN = {
  langLabel: 'Interface language:',
  selectTitle: 'Interface language selection',
  badge: 'Parsed',
  importTitle: '📥 Import WARP YAML',
  placeholder: 'Paste a WARP YAML config (bot, WARPSCOUT or another compatible source)…',
  parse: '🔍 Parse',
  clear: 'Clear',
  hint: 'A compatible WARP YAML is supported; the source does not matter.',
  paramsTitle: '🔑 Parameters',
  profileName: 'Profile name (base)'
};

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.error('FAIL', name, e.message); }
}

function normalizeProject(json) {
  const obj = JSON.parse(json);
  if (obj && obj.meta && 'created' in obj.meta) delete obj.meta.created;
  return JSON.stringify(obj);
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
  console.log(`\ni18n-foundation-browser: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

async function runEngine(browser, engine) {
  const storageDisabledScript = () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('localStorage denied', 'SecurityError'); }
    });
  };

  async function newPage(context) {
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
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

  await check(engine + ' default RU: html lang, switcher, static set texts', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru');
    assert.equal(await page.evaluate(() => globalThis.LGI18N.getLang()), 'ru');
    const sel = page.locator('#uiLangSelect');
    assert.equal(await sel.evaluate(el => el.tagName), 'SELECT', 'selector is a native (keyboard-accessible) select');
    assert.equal(await sel.inputValue(), 'ru');
    assert.equal(await sel.evaluate(el => el.getAttribute('title')), RU.selectTitle);
    assert.equal(await page.locator('label[for="uiLangSelect"]').textContent(), RU.langLabel);
    const tabs = await page.locator('button.tab').allTextContents();
    assert.deepEqual(tabs, TAB_TEXTS);
    assert.equal(await page.locator('button[onclick="parseYaml()"]').textContent(), RU.parse);
    assert.equal(await page.locator('#yamlInput').getAttribute('placeholder'), RU.placeholder);
    assert.equal(await page.locator('button.tab[data-i18n="ui.tabs.warp"]').textContent(), TAB_TEXTS[0]);
  });

  await check(engine + ' switch to EN via selector: texts, attributes, html lang', async () => {
    await page.focus('#uiLangSelect'); // keyboard-reachable control
    await page.selectOption('#uiLangSelect', 'en');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.evaluate(() => globalThis.LGI18N.getLang()), 'en');
    assert.equal(await page.locator('button[onclick="parseYaml()"]').textContent(), EN.parse);
    assert.equal(await page.locator('button[onclick*="yamlInput"].btn-gray').textContent(), EN.clear);
    assert.equal(await page.locator('#yamlInput').getAttribute('placeholder'), EN.placeholder);
    assert.equal(await page.locator('label[for="uiLangSelect"]').textContent(), EN.langLabel);
    assert.equal(await page.locator('#uiLangSelect').getAttribute('title'), EN.selectTitle);
    assert.equal(await page.locator('.card-title span[data-i18n="ui.warp.import.title"]').textContent(), EN.importTitle);
    assert.equal(await page.locator('.hint[data-i18n="ui.warp.import.hint"]').textContent(), EN.hint);
    assert.equal(await page.locator('.card-title[data-i18n="ui.warp.params.title"]').textContent(), EN.paramsTitle);
    assert.equal(await page.locator('label[data-i18n="ui.warp.params.profileName"]').textContent(), EN.profileName);
    const tabs = await page.locator('button.tab').allTextContents();
    assert.deepEqual(tabs, TAB_TEXTS, 'product-name tabs stay stable in both languages');
  });

  await check(engine + ' persistence: enum-only key, survives reload in both langs', async () => {
    assert.equal(await page.evaluate(() => window.localStorage.getItem('link-generators.locale.v1')), 'en');
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    assert.equal(keys.filter(k => k.startsWith('link-generators.locale')).length, 1);
    await page.reload();
    await page.waitForFunction(() => globalThis.web4core && globalThis.jsyaml && globalThis.LGI18N);
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.locator('button[onclick="parseYaml()"]').textContent(), EN.parse);
    await page.selectOption('#uiLangSelect', 'ru');
    assert.equal(await page.evaluate(() => window.localStorage.getItem('link-generators.locale.v1')), 'ru');
    await page.reload();
    await page.waitForFunction(() => globalThis.web4core && globalThis.jsyaml && globalThis.LGI18N);
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru');
    assert.equal(await page.locator('button[onclick="parseYaml()"]').textContent(), RU.parse);
  });

  await check(engine + ' RU→EN→RU: full representative set returns to RU originals', async () => {
    await page.selectOption('#uiLangSelect', 'en');
    await page.selectOption('#uiLangSelect', 'ru');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru');
    assert.equal(await page.locator('label[for="uiLangSelect"]').textContent(), RU.langLabel);
    assert.equal(await page.locator('#uiLangSelect').getAttribute('title'), RU.selectTitle);
    assert.equal(await page.locator('button[onclick="parseYaml()"]').textContent(), RU.parse);
    assert.equal(await page.locator('button[onclick*="yamlInput"].btn-gray').textContent(), RU.clear);
    assert.equal(await page.locator('#yamlInput').getAttribute('placeholder'), RU.placeholder);
    assert.equal(await page.locator('.card-title span[data-i18n="ui.warp.import.title"]').textContent(), RU.importTitle);
    assert.equal(await page.locator('.hint[data-i18n="ui.warp.import.hint"]').textContent(), RU.hint);
    assert.equal(await page.locator('.card-title[data-i18n="ui.warp.params.title"]').textContent(), RU.paramsTitle);
    assert.equal(await page.locator('label[data-i18n="ui.warp.params.profileName"]').textContent(), RU.profileName);
    expectNoErrors('roundtrip');
  });

  await check(engine + ' form state + parsed fixture survive switching (same nodes)', async () => {
    await page.fill('#yamlInput', SYNTH_YAML);
    await page.fill('#profileName', 'AGENT-TEST');
    await page.click('button[onclick="parseYaml()"]');
    assert.equal(await page.locator('#privateKey').inputValue(), 'SYNTH-KEY', 'fixture parsed into form');
    assert.equal(await page.locator('#parsedBadge').evaluate(el => el.style.display), 'inline-block');
    await page.evaluate(() => { document.getElementById('yamlInput').__lgNodeMarker = 'i349'; });
    await page.selectOption('#uiLangSelect', 'en');
    await page.selectOption('#uiLangSelect', 'ru');
    assert.equal(await page.locator('#yamlInput').inputValue(), SYNTH_YAML, 'yamlInput text preserved');
    assert.equal(await page.locator('#profileName').inputValue(), 'AGENT-TEST', 'profile name preserved');
    assert.equal(await page.locator('#privateKey').inputValue(), 'SYNTH-KEY', 'parsed value preserved');
    assert.equal(await page.evaluate(() => document.getElementById('yamlInput').__lgNodeMarker), 'i349', 'same DOM node object (not re-created)');
    assert.equal(await page.locator('#parsedBadge').evaluate(el => el.style.display), 'inline-block');
    assert.equal(await page.locator('#parsedBadge').textContent(), RU.badge, 'badge text follows current language');
    expectNoErrors('form preservation');
  });

  await check(engine + ' build fingerprint + project save/load unchanged across switch', async () => {
    const before = await page.evaluate(() => ({
      fp: buildStateFingerprint(),
      project: normalizeProject(JSON.stringify(rbCollectProject()))
    }));
    // Representative synthetic project fixture: roundtrip the pristine collected project.
    await page.evaluate(fixture => { rbApplyProject(JSON.parse(fixture)); }, before.project);
    const loaded = await page.evaluate(() => ({
      fp: buildStateFingerprint(),
      project: normalizeProject(JSON.stringify(rbCollectProject()))
    }));
    assert.equal(loaded.project, before.project, 'project save→load roundtrip is stable');
    await page.selectOption('#uiLangSelect', 'en');
    await page.selectOption('#uiLangSelect', 'ru');
    const after = await page.evaluate(() => ({
      fp: buildStateFingerprint(),
      project: normalizeProject(JSON.stringify(rbCollectProject()))
    }));
    assert.equal(after.fp, loaded.fp, 'buildStateFingerprint changed across language switch');
    assert.equal(after.project, loaded.project, 'rbCollectProject changed across language switch');
    expectNoErrors('fingerprint/project');
  });

  await check(engine + ' XSS probe: params stay literal text via textContent path', async () => {
    const result = await page.evaluate(() => {
      const api = globalThis.LGI18N;
      api.DICT.en['__probe.interp'] = 'V {name}';
      const payload = '<img src=x onerror=window.__xss=1>';
      const div = document.createElement('div');
      document.body.appendChild(div);
      div.textContent = api.t('__probe.interp', { name: payload });
      const out = { text: div.textContent, xss: window.__xss === 1, htmlTagInDom: !!div.querySelector('img') };
      div.remove();
      delete api.DICT.en['__probe.interp'];
      return out;
    });
    assert.equal(result.text, 'V <img src=x onerror=window.__xss=1>');
    assert.equal(result.xss, false, 'onerror must never execute');
    assert.equal(result.htmlTagInDom, false, 'payload must not become a DOM element');
    expectNoErrors('xss probe');
  });

  await page.close();
  await context.close();

  await check(engine + ' localStorage disabled: memory fallback, no crash, no new requests', async () => {
    const ctx2 = await browser.newContext();
    await ctx2.addInitScript(storageDisabledScript);
    const p2 = await newPage(ctx2);
    assert.equal(await p2.evaluate(() => globalThis.LGI18N.getLang()), 'ru');
    await p2.selectOption('#uiLangSelect', 'en');
    assert.equal(await p2.evaluate(() => globalThis.LGI18N.getLang()), 'en', 'switch works without storage');
    assert.equal(await p2.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await p2.locator('button[onclick="parseYaml()"]').textContent(), EN.parse);
    await p2.selectOption('#uiLangSelect', 'ru');
    assert.equal(await p2.evaluate(() => globalThis.LGI18N.getLang()), 'ru');
    assert.deepEqual(p2.__state.nonCdnRequests, [], 'non-CDN http(s) requests appeared');
    assert.deepEqual(p2.__state.pageErrors, [], 'page errors with storage disabled: ' + p2.__state.pageErrors.join(' | '));
    await p2.close();
    await ctx2.close();
  });
}

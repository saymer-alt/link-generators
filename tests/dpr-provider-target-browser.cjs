// #351 DPR provider-target — браузерный UI-регресс (Playwright).
// Путь пользователя: Sub Mode ON + 2 URL-подписки → DPR-карточка → цель
// «🛰 Только …» → Build → правило строго в provider-only url-test-группу.
// Fail-closed: Sub Mode OFF / AWL → NOT_BUILT с внятной ошибкой; проектный
// roundtrip сохраняет PROVIDER-цель; исчезнувшая подписка отображается честно.
// Требует NODE_PATH (playwright) и JS_YAML_PATH (см. docs/TESTING.md).
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SUBS = 'https://subs-a.example.invalid/token-a\nhttps://subs-b.example.invalid/token-b';

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, timeout: 30000 });
  let passed = 0, failed = 0;
  const check = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('PASS', name); })
    .catch(e => { failed++; console.error('FAIL', name, e.message); });

  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const nonCdn = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    const url = r.url();
    if (/^https?:\/\//i.test(url) && !/^https:\/\/cdn\.jsdelivr\.net\//i.test(url)) nonCdn.push(url);
  });
  if (process.env.JS_YAML_PATH) {
    await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  }
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, .tab')).find((b) => /mihomo/i.test(b.textContent || ''));
    if (btn) btn.click();
  });

  const expectNoErrors = label => {
    assert.deepEqual(nonCdn, [], label + ': non-CDN http(s) requests: ' + nonCdn.join(', '));
    assert.deepEqual(errors, [], label + ': page errors: ' + errors.join(' | '));
  };
  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state !== 'VALIDATING', null, { timeout: 20000 });
    return page.evaluate(() => ({
      state: MIHOMO_VALIDATION_STATE.state,
      yaml: document.getElementById('mihomoOutput').value,
      toast: String(window.__lastToast || '')
    }));
  };
  const addGeminiCard = async () => {
    await page.locator('#btnPolicyAdd').click();
    const card = page.locator('#policyCards .policy-card').last();
    await card.locator('.policy-name').fill('GEMINI');
    await card.locator('.policy-domains').fill('gemini.example.invalid');
    return card;
  };

  // 1. Опции «🛰 Только …» появляются из реестра подписок (Sub Mode ON)
  await check('provider options appear in policy card select (Sub Mode ON, 2 subscriptions)', async () => {
    await page.locator('#mihomoInput').fill(SUBS);
    await page.locator('#cfgPolicyRouting').check();
    await page.waitForFunction(() => document.querySelectorAll('#policyCards .policy-card').length >= 0);
    const card = await addGeminiCard();
    // реестр целей обновляется по change-диспетчеру; options уже актуальны,
    // но для детерминизма дожидаемся явного появления provider-опций
    await page.waitForFunction(() => {
      const sel = document.querySelector('#policyCards .policy-card:last-child .policy-target');
      return sel && Array.from(sel.options).some(o => o.value === 'PROVIDER:subs-a.example.invalid');
    });
    const values = await card.locator('.policy-target option').evaluateAll(os => os.map(o => o.value));
    assert.ok(values.includes('PROVIDER:subs-a.example.invalid'), 'option for provider A');
    assert.ok(values.includes('PROVIDER:subs-b.example.invalid'), 'option for provider B');
    assert.ok(values.includes('SELECT') && values.includes('GLOBAL') && values.includes('REJECT'), 'base options intact');
    assert.equal(values.includes('DIRECT'), false, 'no DIRECT option (#284)');
    await card.locator('.policy-target').selectOption('PROVIDER:subs-a.example.invalid');
    expectNoErrors('options');
  });

  // 2. Build: правило строго в provider-only группу; B не участвует
  await check('build: RULE-SET strictly to GEMINI-AUTO use:[A]; NAME select removed; B absent; MATCH,GLOBAL last', async () => {
    const r = await build();
    assert.equal(r.state, 'VALID', 'build valid, toast: ' + r.toast);
    const doc = await page.evaluate(y => jsyaml.load(y), r.yaml);
    const auto = doc['proxy-groups'].find(g => g.name === 'GEMINI-AUTO');
    assert.ok(auto && auto.type === 'url-test');
    assert.deepEqual(auto.use, ['subs-a.example.invalid'], 'strictly chosen provider');
    assert.equal(auto['empty-fallback'], 'REJECT', 'fail-closed empty-fallback');
    assert.equal(doc['proxy-groups'].some(g => g.name === 'GEMINI'), false, 'unreachable NAME select removed');
    assert.ok(doc.rules.includes('RULE-SET,policy-gemini,GEMINI-AUTO'), 'rule rewritten');
    assert.equal(doc.rules[doc.rules.length - 1], 'MATCH,GLOBAL', 'MATCH,GLOBAL last');
    const providers = Object.keys(doc['proxy-providers']);
    assert.equal(providers.length, 2, 'both providers still exist in config (subscription plane untouched)');
    expectNoErrors('build');
  });

  // 3. Проектный roundtrip сохраняет PROVIDER-цель
  await check('project roundtrip: PROVIDER target survives rbCollectProject → rbApplyProject', async () => {
    const roundtrip = await page.evaluate(() => {
      const collected = JSON.parse(JSON.stringify(rbCollectProject()));
      const before = collected.domainPolicy.cards.find(c => c.name === 'GEMINI');
      rbApplyProject(JSON.parse(JSON.stringify(collected)));
      const sel = document.querySelector('#policyCards .policy-card:last-child .policy-target');
      return { stored: before.target, dom: sel ? sel.value : null };
    });
    assert.equal(roundtrip.stored, 'PROVIDER:subs-a.example.invalid', 'project card target');
    assert.equal(roundtrip.dom, 'PROVIDER:subs-a.example.invalid', 'DOM select value after reload');
    expectNoErrors('roundtrip');
  });

  // 4. Sub Mode OFF: provider-опции исчезают; сохранённая цель отображается честно
  await check('Sub Mode OFF: provider options removed, stale selection shown honestly as missing', async () => {
    await page.locator('#cfgSubMode').uncheck();
    // валидные опции реестра уходят; остаётся ровно одна помеченная опция —
    // честный «missing»-слот выбранной подписки
    await page.waitForFunction(() => {
      const sel = document.querySelector('#policyCards .policy-card:last-child .policy-target');
      const marked = sel ? Array.from(sel.options).filter(o => o.hasAttribute('data-dpr-provider')) : [];
      return marked.length === 1 &&
        marked[0].value === 'PROVIDER:subs-a.example.invalid' &&
        marked[0].textContent.includes('подписка отсутствует');
    });
    const sel = page.locator('#policyCards .policy-card').last().locator('.policy-target');
    const opts = await sel.evaluate(el => Array.from(el.options).map(o => ({ v: o.value, t: o.textContent, m: o.hasAttribute('data-dpr-provider') })));
    assert.equal(opts.some(o => o.v === 'SELECT'), true, 'base options present');
    const stale = opts.find(o => o.v === 'PROVIDER:subs-a.example.invalid');
    assert.ok(stale, 'stale selection still visible (no silent reset)');
    assert.equal(stale.m, true, 'stale option is the honest missing-subscription slot');
    assert.match(stale.t, /подписка отсутствует/, 'stale option labeled as missing');
    assert.equal(await sel.inputValue(), 'PROVIDER:subs-a.example.invalid', 'selection preserved');
  });

  // 5. Fail-closed Build: Sub Mode OFF + PROVIDER-цель → NOT_BUILT с внятной ошибкой
  await check('fail-closed build: Sub Mode OFF + PROVIDER target → NOT_BUILT (#351 message)', async () => {
    const r = await build();
    assert.equal(r.state, 'NOT_BUILT', 'build blocked');
    assert.match(r.toast, /#351/, 'error mentions #351');
    assert.match(r.toast, /Sub Mode/, 'error mentions Sub Mode');
    assert.match(r.toast, /«GEMINI»/, 'error names the policy');
    expectNoErrors('fail-closed sub-off');
  });

  // 6. Fail-closed Build: AWL ON + Sub Mode ON + PROVIDER-цель → NOT_BUILT
  await check('fail-closed build: AWL + PROVIDER target → NOT_BUILT with AWL reason', async () => {
    await page.locator('#cfgSubMode').check();
    await page.locator('#cfgAutoWhitelist').check();
    // включение DPR-режима при AWL: категории не имеют AUTO-групп — Build должен отказать
    await page.waitForFunction(() => {
      const sel = document.querySelector('#policyCards .policy-card:last-child .policy-target');
      return sel && sel.value === 'PROVIDER:subs-a.example.invalid';
    });
    await page.locator('#whitelistInput').fill('https://subs-a.example.invalid/token-a');
    const r = await build();
    assert.equal(r.state, 'NOT_BUILT', 'build blocked in AWL');
    assert.match(r.toast, /#351/, 'error mentions #351');
    assert.match(r.toast, /белых списков|AWL/, 'error mentions AWL');
    await page.locator('#cfgAutoWhitelist').uncheck();
    expectNoErrors('fail-closed awl');
  });

  // 7. Реестр живой: правка подписок обновляет опции без сброса валидного выбора
  await check('registry refresh: editing subscriptions updates options, valid selection survives', async () => {
    await page.locator('#mihomoInput').fill('https://subs-a.example.invalid/token-a\nhttps://subs-c.example.invalid/token-c');
    await page.waitForFunction(() => {
      const sel = document.querySelector('#policyCards .policy-card:last-child .policy-target');
      return sel && Array.from(sel.options).some(o => o.value === 'PROVIDER:subs-c.example.invalid');
    });
    const opts = await page.locator('#policyCards .policy-card').last().locator('.policy-target option').evaluateAll(os => os.map(o => o.value));
    assert.ok(opts.includes('PROVIDER:subs-c.example.invalid'), 'new provider option appeared');
    assert.equal(opts.includes('PROVIDER:subs-b.example.invalid'), false, 'removed provider option gone');
    assert.equal(await page.locator('#policyCards .policy-card').last().locator('.policy-target').inputValue(),
      'PROVIDER:subs-a.example.invalid', 'still-valid selection preserved');
    const r = await build();
    assert.equal(r.state, 'VALID', 'build valid after registry refresh');
    const doc = await page.evaluate(y => jsyaml.load(y), r.yaml);
    const auto = doc['proxy-groups'].find(g => g.name === 'GEMINI-AUTO');
    assert.deepEqual(auto.use, ['subs-a.example.invalid'], 'strictly A after refresh');
    expectNoErrors('registry refresh');
  });

  // 8. Повреждённый target из проекта/UI: никогда не расширять strict
  // provider-only policy до SELECT, который объединяет все подписки.
  await check('malformed PROVIDER: target: saved raw, Build fails closed instead of pooled SELECT', async () => {
    await page.evaluate(() => {
      const sel = document.querySelector('#policyCards .policy-card:last-child .policy-target');
      const invalid = document.createElement('option');
      invalid.value = 'PROVIDER:';
      invalid.textContent = 'Synthetic malformed provider target';
      sel.appendChild(invalid);
      sel.value = 'PROVIDER:';
    });
    const stored = await page.evaluate(() => rbCollectProject().domainPolicy.cards.find(p => p.name === 'GEMINI').target);
    assert.equal(stored, 'PROVIDER:', 'corrupt target persists verbatim (not rewritten as SELECT)');
    const r = await build();
    assert.equal(r.state, 'NOT_BUILT', 'malformed strict target rejects build and resets stale VALID status');
    assert.match(r.toast, /provider-цель без имени подписки/, 'explicit blocker');
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true, 'old YAML cannot be copied as verified');
    assert.equal(await page.locator('#builderActionStatus').getAttribute('data-state'), 'ERROR', 'action status shows error');
    assert.equal(await page.locator('#policyCards .policy-card:last-child .policy-target').inputValue(), 'PROVIDER:');
    expectNoErrors('malformed target');
  });

  await page.close();
  await browser.close();
  console.log('\ndpr-provider-target-browser: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

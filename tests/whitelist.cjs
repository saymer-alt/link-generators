// External Playwright, js-yaml 4.1.0; same setup as browser.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const a = 'socks://test:pass@192.0.2.1:1080#GLOBAL';
const b = 'socks://test:pass@192.0.2.2:1080#GLOBAL';
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  let count = 0;
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => globalThis.jsyaml && globalThis.web4core);
    await page.locator('button.tab').filter({ hasText: 'Mihomo' }).click();
    assert.equal(await page.locator('#cfgAutoWhitelist').isChecked(), false);
    await page.locator('#cfgPerProxyTun').check();
    await page.locator('#cfgPerProxySocks').check();
    await page.locator('#cfgProfile').selectOption('vps');
    await page.locator('#cfgAutoWhitelist').check();
    for (const id of ['cfgPerProxyTun', 'cfgPerProxySocks', 'cfgProfile', 'vpsPanel']) assert.equal(await page.locator('#' + id).isVisible(), false);
    for (const id of ['cfgTun', 'cfgTunMips', 'cfgLan', 'cfgSocks', 'cfgWebUI', 'cfgSubMode']) assert.equal(await page.locator('#' + id).isVisible(), true);
    assert.equal(await page.locator('#cfgProfile').inputValue(), 'generic');
    assert.equal(await page.locator('#cfgPerProxyTun').isChecked(), false);
    assert.equal(await page.locator('#cfgPerProxySocks').isChecked(), false);
    for (const [name, primary, fallback, sub] of [
      ['one', a, b, false], ['many', a + '\n' + b, a + '\n' + b, false],
      ['subscriptions', 'https://example.invalid/a', 'https://example.invalid/b', true],
      ['mixed', a + '\nhttps://example.invalid/a', b + '\nhttps://example.invalid/b', true],
      ['links-sub-mode', a, b, true],
    ]) for (const mips of [false, true]) {
      await page.locator('#mihomoInput').fill(primary);
      await page.locator('#whitelistInput').fill(fallback);
      await page.locator('#cfgSubMode').setChecked(sub);
      await page.locator('#cfgTunMips').setChecked(mips);
      await page.locator('button[onclick="buildMihomo()"]').click();
      await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state !== 'VALIDATING');
      const result = await page.evaluate(() => ({ state: MIHOMO_VALIDATION_STATE.state, yaml: document.getElementById('mihomoOutput').value }));
      assert.equal(result.state, 'VALID', name);
      const doc = await page.evaluate(y => jsyaml.load(y), result.yaml);
      const global = doc['proxy-groups'].find(g => g.name === 'GLOBAL');
      assert.equal(doc['proxy-groups'].length, 1);
      assert.deepEqual(global.proxies || [], (doc.proxies || []).map(p => p.name));
      assert.deepEqual(global.use || [], Object.keys(doc['proxy-providers'] || {}));
      assert.equal(global.filter, '^(PRIMARY-|primary-)`^(FALLBACK-|fallback-)');
      assert.equal(global.type, 'fallback');
      assert.equal(global.lazy, false);
      assert.equal(doc.tun.stack, mips ? 'mips' : 'gvisor');
      assert.equal(doc.listeners, undefined);
      assert.equal(doc.dns, undefined);
      assert.equal(doc['mixed-port'], 7890);
      assert.equal(doc['allow-lan'], true);
      assert.ok(doc['external-controller']);
      assert.equal(doc.profile['store-selected'], true);
      if (process.env.TEST_OUTPUT_DIR) {
        fs.mkdirSync(process.env.TEST_OUTPUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR, `whitelist-${name}-${mips ? 'mips' : 'gvisor'}.yaml`), result.yaml);
      }
      count++;
    }
    // Bypass hidden/disabled DOM controls: build still clamps all prohibited modes.
    const guarded = await page.evaluate(() => {
      document.getElementById('cfgPerProxyTun').checked = true;
      document.getElementById('cfgPerProxySocks').checked = true;
      document.getElementById('cfgProfile').value = 'vps';
      buildMihomo();
      return jsyaml.load(document.getElementById('mihomoOutput').value);
    });
    assert.equal(guarded.listeners, undefined);
    assert.equal(guarded.dns, undefined);
    assert.equal(guarded['find-process-mode'], undefined);
    assert.equal(guarded.profile['store-selected'], true);
    assert.equal(guarded.tun['auto-route'], false); // existing ordinary TUN contract
    assert.notEqual(guarded.tun.device, 'tun-mihomo');
    // Fail closed with an old runtime that would silently ignore fallbackInput.
    await page.evaluate(() => { const fn = web4core.buildMihomoPriorityConfig; delete web4core.buildMihomoPriorityConfig; buildMihomo(); web4core.buildMihomoPriorityConfig = fn; });
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    await page.locator('#whitelistInput').fill('');
    await page.locator('button[onclick="buildMihomo()"]').click();
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    await page.locator('#cfgAutoWhitelist').uncheck();
    assert.equal(await page.locator('#cfgProfile').inputValue(), 'vps');
    assert.equal(await page.locator('#cfgPerProxyTun').isChecked(), true);
    assert.equal(await page.locator('#cfgPerProxySocks').isChecked(), true);
    assert.equal(await page.locator('#cfgTun').isDisabled(), true);
    // Baseline includes subscriptions, all preserved switches, and VPS. Fix RNG in tests only.
    if (process.env.BASELINE_REF) {
      const oldHtml = execFileSync('git', ['show', `${process.env.BASELINE_REF}:index.html`], { cwd: root, encoding: 'utf8' });
      const oldRuntime = execFileSync('git', ['show', `${process.env.BASELINE_REF}:web4core.runtime.js`], { cwd: root, encoding: 'utf8' });
      const old = await browser.newPage();
      await old.setContent(oldHtml.replace(/<script[\s\S]*?<\/script>/g, ''));
      await old.addScriptTag({ content: fs.readFileSync(process.env.JS_YAML_PATH, 'utf8') });
      await old.addScriptTag({ content: oldRuntime });
      await old.addScriptTag({ content: [...oldHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1] });
      for (let mask = 0; mask < 256; mask++) {
        const setup = async ({ mask, a, b }) => {
          Math.random = () => 0.5;
          crypto.getRandomValues = array => { array.fill(8); return array; };
          ['cfgSubMode','cfgTun','cfgPerProxyTun','cfgPerProxySocks','cfgTunMips','cfgLan','cfgWebUI'].forEach((id, i) => document.getElementById(id).checked = !!(mask & (1 << i)));
          document.getElementById('cfgProfile').value = mask & 128 ? 'vps' : 'generic';
          document.getElementById('mihomoInput').value = (mask & 1 ? 'https://example.invalid/sub\n' : '') + a + '\n' + b;
          buildMihomo();
          while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
          return { yaml: document.getElementById('mihomoOutput').value, state: MIHOMO_VALIDATION_STATE.state };
        };
        const args = { mask, a: a.replace('#GLOBAL', '#TEST-A'), b: b.replace('#GLOBAL', '#TEST-B') };
        const result = await page.evaluate(setup, args);
        assert.equal(result.state, 'VALID');
        assert.deepEqual(result, await old.evaluate(setup, args), 'baseline mask ' + mask);
        count++;
      }
      await old.close();
    }
    assert.deepEqual(errors, []);
    console.log(`Whitelist browser: ${count} matrix/baseline cases + UI restoration and bypass guards passed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

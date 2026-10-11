// Regression: all Builder -> Config Studio shortcuts pass the validated YAML, never an empty Studio.
// Synthetic VLESS only. No subscription fetch or live endpoint.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const link = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.10:443#Studio-Synth';
const selectors = ['#openYamlStudioBtn', '#builderOpenStudioFromDirectory', '#builderOpenStudioFromDiagnostics'];
let checks = 0;
const ok = message => { checks++; console.log('  ok — ' + message); };

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    page.setDefaultTimeout(20000);
    const errors = [], outsideRequests = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.route(/^https?:/, route => {
      if (route.request().url().startsWith('https://cdn.jsdelivr.net/') && process.env.JS_YAML_PATH) {
        return route.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' });
      }
      outsideRequests.push(route.request().url());
      return route.abort();
    });

    const load = async () => {
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
      await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
      await page.locator('.tab', { hasText: 'Mihomo Config Builder' }).click();
      await page.locator('#cfgSubMode').uncheck();
    };
    const reveal = async selector => {
      await page.locator(selector).evaluate(el => {
        for (let n = el.parentElement; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true;
      });
    };
    const build = async () => {
      await page.locator('#mihomoInput').fill(link);
      await page.locator('#buildConfigBtn').click();
      await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID' && isBuilderYamlReady());
      return page.locator('#mihomoOutput').inputValue();
    };
    const sourceState = () => page.evaluate(() => ({
      yaml: document.getElementById('mihomoOutput').value,
      seq: mihomoValidationSeq,
      fingerprint: buildStateFingerprint()
    }));
    const assertDisabled = async disabled => {
      for (const selector of selectors) {
        assert.equal(await page.locator(selector).isDisabled(), disabled, selector + ' disabled state');
      }
    };

    // Normal tab selection must stay independent: open an empty Studio for custom import.
    await load();
    await assertDisabled(true);
    await page.locator('.tab', { hasText: 'Config Studio' }).click();
    assert.equal(await page.locator('#csImportInput').inputValue(), '');
    assert.equal(await page.evaluate(() => csCurrentDoc), null);
    ok('normal Studio tab stays independent and empty');

    // Each of the three real buttons must pass the same built YAML byte-for-byte.
    for (const selector of selectors) {
      await load();
      await assertDisabled(true);
      const built = await build(), before = await sourceState();
      assert.ok(built.includes('Studio-Synth'));
      await assertDisabled(false);
      await reveal(selector);
      await page.locator(selector).click();
      assert.ok(await page.locator('#tab-studio').evaluate(el => el.classList.contains('active')));
      assert.equal(await page.locator('#csImportInput').inputValue(), built, selector + ' input');
      assert.equal(await page.evaluate(() => csExportText()), built, selector + ' lossless export');
      assert.match(await page.locator('#csStatus').textContent(), /Разобрано/);
      assert.equal(await page.locator('#csDiagnosticsPanel').evaluate(el => el.open), true);
      assert.equal(await page.locator('#csVrgPanel').evaluate(el => el.open), true);
      assert.deepEqual(await sourceState(), before, selector + ' must not mutate Builder');
      ok(selector + ' passes validated YAML and opens analysis');
    }

    // A modified Builder must no longer offer an obsolete generated YAML.
    await page.locator('.tab', { hasText: 'Mihomo Config Builder' }).click();
    await page.locator('#mihomoInput').fill(link.replace('Studio-Synth', 'Studio-Stale'));
    await page.waitForFunction(() => !isBuilderYamlReady() && document.getElementById('builderActionStatus').dataset.state === 'STALE');
    await assertDisabled(true);
    ok('stale Builder disables every transfer');

    // Replacement confirmation must protect a different Studio document.
    await load();
    const built = await build();
    await page.locator('.tab', { hasText: 'Config Studio' }).click();
    const custom = 'mixed-port: 7999\nrules:\n  - MATCH,DIRECT\n';
    await page.locator('#csImportInput').fill(custom);
    await page.locator('#csParseBtn').click();
    assert.equal(await page.evaluate(() => csExportText()), custom);
    await page.locator('.tab', { hasText: 'Mihomo Config Builder' }).click();
    await reveal('#builderOpenStudioFromDiagnostics');
    let dialogs = 0;
    page.once('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
    await page.locator('#builderOpenStudioFromDiagnostics').click();
    assert.equal(dialogs, 1, 'confirmation requested');
    assert.ok(await page.locator('#tab-mihomo').evaluate(el => el.classList.contains('active')));
    assert.equal(await page.evaluate(() => csExportText()), custom, 'Cancel preserves Studio document');
    ok('Cancel retains the existing document and current tab');

    page.once('dialog', async dialog => { dialogs++; await dialog.accept(); });
    await page.locator('#builderOpenStudioFromDiagnostics').click();
    assert.equal(dialogs, 2);
    assert.ok(await page.locator('#tab-studio').evaluate(el => el.classList.contains('active')));
    assert.equal(await page.locator('#csImportInput').inputValue(), built);
    assert.equal(await page.evaluate(() => csExportText()), built);
    ok('Confirm replaces document with current Builder YAML');

    assert.deepEqual(errors, [], 'browser errors');
    assert.deepEqual(outsideRequests, [], 'no external requests');
    console.log('PASS builder-studio-handoff-browser: ' + checks + ' checks');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

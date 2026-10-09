// Synthetic, offline independent regressions. No owner data or external fetches.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = process.env.AUDIT_ROOT || path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.route('https://**', r => r.request().url().startsWith('https://cdn.jsdelivr.net/') ? r.fulfill({path: process.env.JS_YAML_PATH, contentType: 'text/javascript'}) : r.abort());
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
    const snapshot = () => page.evaluate(() => { const p = rbCollectProject(); delete p.meta.created; return p; });
    await page.fill('#mihomoInput', 'https://one.example.invalid/feed');
    const before = await snapshot();
    await page.locator('.tab', {hasText: 'Config Studio'}).click();
    await page.fill('#csImportInput', 'mixed-port: 7890\nrules: ["MATCH,DIRECT"]\n');
    await page.evaluate(() => rbRestoreFromStudio());
    assert.deepEqual(await snapshot(), before, 'Preview must not mutate Builder');
    assert.equal(await page.locator('#rbConfirmRestoreBtn').isDisabled(), true, 'loss requires acknowledgment');
    await page.click('#rbCancelRestoreBtn');
    assert.deepEqual(await snapshot(), before, 'Cancel must not mutate Builder');
    console.log('ok Preview/Cancel preserve Builder');
    await page.evaluate(() => rbRestoreFromStudio());
    await page.check('#rbLossAck');
    await page.fill('#csImportInput', 'mixed-port: 7891\nrules: ["MATCH,DIRECT"]\n');
    await page.click('#rbConfirmRestoreBtn');
    assert.deepEqual(await snapshot(), before, 'stale YAML preview rejected');
    await page.evaluate(() => rbRestoreFromStudio());
    await page.check('#rbLossAck');
    await page.evaluate(() => { document.getElementById('cfgWebUI').checked = !document.getElementById('cfgWebUI').checked; });
    const changed = await snapshot();
    await page.click('#rbConfirmRestoreBtn');
    assert.deepEqual(await snapshot(), changed, 'stale Builder preview rejected');
    console.log('ok stale YAML/Builder reject Apply');
    await page.evaluate(() => rbRestoreFromStudio());
    await page.check('#rbLossAck');
    await page.click('#rbConfirmRestoreBtn');
    assert.equal((await snapshot()).sources.mainInput, '', 'explicit Apply changes Builder');
    await page.click('#rbUndoBtn');
    assert.deepEqual(await snapshot(), changed, 'Undo restores complete collected state');
    console.log('ok Confirm/Apply/Undo');
    const checks = await page.evaluate(() => {
      const counts = rbClassifySources('https://a.example.invalid/feed\nvless://00000000-0000-4000-8000-000000000001@198.51.100.1:443#A\nhttps://user:pass@198.51.100.2:443\nunknown://x', web4core);
      const p = rbCollectProject(); p.sources.subMode = !p.sources.subMode; p.options.profile = 'vps-local';
      const compare = rbCompareWithCurrent(p);
      const sameCounts = rbCollectProject(); sameCounts.sources.mainInput = 'https://two.example.invalid/feed';
      return {counts, compare, composition: rbCompareWithCurrent(sameCounts), invalidJson: rbParseProjectText('{"password":"SYNTH_TOKEN_DO_NOT_ECHO",').error};
    });
    assert.deepEqual(checks.counts, {subs:1,direct:2,unknown:1});
    assert.match(checks.compare, /router → vps-local/);
    assert.match(checks.compare, /URL-подписки: (вкл → выкл|выкл → вкл)/);
    assert.match(checks.composition, /Состав, порядок или параметры.*изменятся/);
    assert.ok(!checks.invalidJson.includes('SYNTH_TOKEN'));
    console.log('ok source classification/typed compare/redacted errors');
    const rollback = await page.evaluate(() => {
      const before = rbProjectFingerprint(rbCollectProject());
      const p = rbCollectProject(); p.sources.mainInput = 'https://replacement.example.invalid/';
      const render = renderTierCards; renderTierCards = () => { throw new Error('synthetic render failure'); };
      let failed = false;
      try { rbApplyProject(p); } catch (_) { failed = true; }
      finally { renderTierCards = render; }
      return failed && before === rbProjectFingerprint(rbCollectProject());
    });
    assert.equal(rollback, true, 'render failure must roll back');
    console.log('ok transactional rollback after mutation');
    assert.deepEqual(errors, []);
    console.log('PASS independent-product-browser: 6 groups');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

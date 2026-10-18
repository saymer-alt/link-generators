// No-DIRECT egress invariant (#284) — browser layer regression (Playwright,
// канал msedge). Покрывает page-слой: лексический guard валидатора, отсутствие
// опции DIRECT в таргетах политик, блокировку Build для legacy DIRECT-карт и
// dialer-таргетов, блокировку provider-режима (Sub Mode ON), PT-GEN-DIRECT-BAN.
// Требует NODE_PATH (playwright) и JS_YAML_PATH — см. docs/TESTING.md.
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
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, .tab')).find((b) => /mihomo/i.test(b.textContent || ''));
      if (btn) btn.click();
    });

    // 1. Лексический guard: YAML с DIRECT → INVALID (no-direct-invariant),
    //    чистый YAML → VALID.
    {
      const dirty = await page.evaluate(() => validateMihomoYaml('mixed-port: 7890\nmode: rule\nrules:\n  - "MATCH,DIRECT"'));
      assert.equal(dirty.status, 'INVALID');
      assert.ok(dirty.errors.some(e => e.field === 'no-direct-invariant'), 'guard rule present: ' + JSON.stringify(dirty.errors));
      const clean = await page.evaluate(() => validateMihomoYaml('mixed-port: 7890\nmode: rule\nrules:\n  - "MATCH,REJECT"'));
      assert.equal(clean.status, 'VALID');
      cases += 2;
    }

    // 2. Карточка политики: опции таргета не содержат DIRECT.
    {
      await page.evaluate(() => {
        document.getElementById('cfgPolicyRouting').checked = true;
        document.getElementById('cfgPolicyRouting').dispatchEvent(new Event('change', { bubbles: true }));
        addPolicyCard({ name: 'AI', domains: 'openai.com' });
      });
      const options = await page.evaluate(() => Array.from(document.querySelector('#policyCards .policy-card .policy-target').options).map(o => o.value));
      assert.ok(!options.includes('DIRECT'), 'no DIRECT option for new cards: ' + JSON.stringify(options));
      assert.ok(options.includes('GLOBAL') && options.includes('REJECT') && options.includes('SELECT'));
      cases += 2;
    }

    // 3. Legacy-карта с target DIRECT: отображается запрещённой опцией, Build
    //    блокируется с сообщением No-DIRECT; после явного обновления таргета
    //    сборка проходит без DIRECT.
    {
      await page.evaluate(() => addPolicyCard({ name: 'LEG', domains: 'legacy.example.com', target: 'DIRECT' }));
      const legacyOptions = await page.evaluate(() => Array.from(document.querySelectorAll('#policyCards .policy-card .policy-target')[1].options).map(o => o.value));
      assert.ok(legacyOptions.includes('DIRECT'), 'legacy DIRECT card keeps its state visible');
      await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');
      await page.evaluate(() => buildMihomo());
      await page.waitForFunction(() => window.__lastToast && window.__lastToast.includes('No-DIRECT'));
      const blocked = await page.evaluate(() => builderBuildError === true);
      assert.equal(blocked, true, 'build blocked for legacy DIRECT card');
      cases += 2;
      // Явное обновление таргета → сборка проходит, DIRECT нет.
      await page.evaluate(() => {
        const sel = document.querySelectorAll('#policyCards .policy-card .policy-target')[1];
        sel.value = 'REJECT';
        document.getElementById('cfgSubMode').checked = false; // статический ввод, не provider-режим
        builderBuildError = false;
        buildMihomo();
      });
      await page.waitForFunction(() => (document.getElementById('mihomoOutput').value || '').includes('RULE-SET'));
      const yaml = await page.evaluate(() => document.getElementById('mihomoOutput').value);
      assert.ok(!/\bDIRECT\b/.test(yaml), 'no DIRECT in rebuilt YAML');
      assert.ok(yaml.includes('RULE-SET,policy-leg,REJECT') || yaml.includes('"RULE-SET,policy-leg,REJECT"'), 'legacy card now REJECT-targeted');
      cases += 2;
    }

    // 4. Sub Mode ON с URL-подпиской: Build блокируется с сообщением No-DIRECT.
    {
      await page.evaluate(() => {
        document.getElementById('cfgSubMode').checked = true;
        document.getElementById('mihomoInput').value = 'https://subs.example.invalid/token';
        builderBuildError = false;
        window.__lastToast = '';
        buildMihomo();
      });
      await page.waitForFunction(() => window.__lastToast && window.__lastToast.includes('No-DIRECT'));
      const state = await page.evaluate(() => ({ err: builderBuildError, validation: MIHOMO_VALIDATION_STATE.state }));
      assert.equal(state.err, true);
      assert.equal(state.validation, 'NOT_BUILT', 'provider mode refuses to build (Copy gated by NOT_BUILT, stale preview retained per existing early-exit contract)');
      cases += 2;
    }

    // 5. WG-профиль с dialer-таргетом DIRECT (legacy): Build блокируется.
    {
      await page.evaluate(() => {
        document.getElementById('cfgSubMode').checked = false;
        window.__lastToast = '';
        wgProfiles.push({ id: 'wg-test', filename: 'direct-test.conf', bean: { name: 'WG-A', proto: 'wireguard', host: '192.0.2.73', port: 51820, wireguard: { privateKey: 'A'.repeat(43), publicKey: 'B'.repeat(43), ip: '10.66.1.2', allowedIPs: ['0.0.0.0/0'] } }, mode: 'proxy', target: 'DIRECT' });
        syncWgCollections();
        buildMihomo();
      });
      await page.waitForFunction(() => window.__lastToast && window.__lastToast.includes('No-DIRECT'));
      const blocked = await page.evaluate(() => builderBuildError === true && window.__lastToast.includes('WG/AWG'));
      assert.equal(blocked, true, 'legacy dialer DIRECT target blocked with explicit message');
      cases += 1;
    }

    // 6. PT: exit-узел без исходящего ребра → PT-GEN-DIRECT-BAN, config.yaml нет.
    {
      const pt = await page.evaluate(() => {
        const spec = {
          nodes: [{ id: 'e', role: 'entry' }, { id: 'x', role: 'exit' }],
          links: [{ from: 'e', to: 'x', transport: { kind: 'ss', endpoint: 'ep-0', credentialRef: 'cr-0' } }],
          clientLink: { transport: { kind: 'ss', endpoint: 'ep-c', credentialRef: 'cr-c' } },
          endpoints: { 'ep-c': '192.0.2.1:40000', 'ep-0': '198.51.100.1:4001' },
        };
        const creds = { 'cr-c': 'synth-c', 'cr-0': 'synth-0' };
        return ptGenerateArtifacts(spec, creds);
      });
      assert.equal(pt.ok, true);
      const exit = pt.artifacts.find(a => a.nodeId === 'x');
      assert.ok(exit.blockers.some(b => b.code === 'PT-GEN-DIRECT-BAN'), 'PT exit blocked by no-DIRECT');
      assert.equal(exit.files['config.yaml'], undefined, 'no MATCH,DIRECT artifact');
      cases += 2;
    }

    assert.deepEqual(errors, [], 'no page errors during the no-DIRECT browser regression: ' + JSON.stringify(errors));
    console.log('No-DIRECT browser regression: ' + cases + ' cases passed');
  } finally {
    await browser.close();
  }
  if (cases < 10) { console.error('browser registry smaller than expected'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

// No-DIRECT egress policy (#284, revised 2026-10-18) — browser layer
// regression (Playwright, канал msedge). Семантика, не лексика:
//   - валидатор: DIRECT как участник группы или таргет правила → INVALID
//     (user data plane); служебные ключи (provider proxy, dialer-proxy) → VALID;
//   - DPR UI: опция DIRECT недоступна, legacy-карта с DIRECT видна как
//     запрещённая и блокирует Build до явного обновления;
//   - PT: exit-узел без исходящего ребра → PT-GEN-DIRECT-BAN (пользовательский
//     трафик не уходит напрямую с VPS); цепочка с final-overlay генерируется.
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

    // 1. Семантический валидатор: DIRECT-участник группы и DIRECT-таргет
    //    правила → INVALID (no-direct-egress); служебные ключи не затронуты.
    {
      const groupMember = await page.evaluate(() => validateMihomoYaml('proxies:\n  - name: a\n    type: ss\n    server: 192.0.2.1\n    port: 443\nproxy-groups:\n  - name: g\n    type: select\n    proxies: [a, DIRECT]\nrules:\n  - "MATCH,g"'));
      assert.equal(groupMember.status, 'INVALID');
      assert.ok(groupMember.errors.some(e => e.field === 'direct-egress'), 'group member DIRECT flagged');
      const ruleTarget = await page.evaluate(() => validateMihomoYaml('proxies:\n  - name: a\n    type: ss\n    server: 192.0.2.1\n    port: 443\nrules:\n  - "DOMAIN-SUFFIX,x.example,DIRECT"\n  - "MATCH,a"'));
      assert.equal(ruleTarget.status, 'INVALID');
      assert.ok(ruleTarget.errors.some(e => e.field === 'direct-egress'), 'rule target DIRECT flagged');
      const servicePlane = await page.evaluate(() => validateMihomoYaml('mixed-port: 7890\nproxy-providers:\n  feed:\n    type: http\n    url: "https://feed.example.invalid/s"\n    proxy: DIRECT\nproxies:\n  - name: wg\n    type: wireguard\n    server: 192.0.2.73\n    port: 51820\n    private-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n    public-key: BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=\n    ip: 10.66.1.2\n    allowed-ips: [0.0.0.0/0]\n    dialer-proxy: DIRECT\nproxy-groups:\n  - name: GLOBAL\n    type: select\n    proxies: [wg, REJECT]\nrules:\n  - "MATCH,GLOBAL"'));
      assert.equal(servicePlane.status, 'VALID', 'service-plane keys (provider proxy, dialer-proxy) stay VALID: ' + JSON.stringify(servicePlane.errors));
      cases += 3;
    }

    // 2. DPR UI: новая карточка — опций DIRECT нет.
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
    //    блокируется; после явного обновления таргета сборка проходит.
    {
      await page.evaluate(() => addPolicyCard({ name: 'LEG', domains: 'legacy.example.com', target: 'DIRECT' }));
      const legacyOptions = await page.evaluate(() => Array.from(document.querySelectorAll('#policyCards .policy-card .policy-target')[1].options).map(o => o.value));
      assert.ok(legacyOptions.includes('DIRECT'), 'legacy DIRECT card keeps its state visible');
      await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');
      await page.evaluate(() => { document.getElementById('cfgSubMode').checked = false; }); // статический ввод — Sub OFF
      await page.evaluate(() => buildMihomo());
      await page.waitForFunction(() => window.__lastToast && window.__lastToast.includes('No-DIRECT'));
      assert.equal(await page.evaluate(() => builderBuildError === true), true, 'build blocked for legacy DIRECT card');
      cases += 2;
      await page.evaluate(() => {
        const sel = document.querySelectorAll('#policyCards .policy-card .policy-target')[1];
        sel.value = 'REJECT';
        builderBuildError = false;
        buildMihomo();
      });
      await page.waitForFunction(() => (document.getElementById('mihomoOutput').value || '').includes('RULE-SET'));
      const yaml = await page.evaluate(() => document.getElementById('mihomoOutput').value);
      assert.ok(yaml.includes('"RULE-SET,policy-leg,REJECT"') || yaml.includes('RULE-SET,policy-leg,REJECT'), 'legacy card now REJECT-targeted');
      assert.ok(!/\bDIRECT\b/.test(yaml.split('proxies:')[0]) || !yaml.split('\n').some(l => /,\s*DIRECT\s*$/.test(l.trim())), 'no DIRECT routing in rebuilt YAML');
      cases += 2;
    }

    // 4. Sub Mode ON (динамические подписки) — положительная регрессия:
    //    provider-сборка работает, провайдер несёт служебный bootstrap-транспорт.
    {
      await page.evaluate(() => {
        document.getElementById('policyCards').textContent = '';
        document.getElementById('cfgSubMode').checked = true;
        document.getElementById('mihomoInput').value = 'https://subs.example.invalid/token';
        builderBuildError = false;
        window.__lastToast = '';
        buildMihomo();
      });
      await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID', null, { timeout: 20000 });
      const yaml = await page.evaluate(() => document.getElementById('mihomoOutput').value);
      assert.ok(yaml.includes('proxy-providers:'), 'provider YAML built');
      assert.ok(/proxy:\s*'?(DIRECT)"?\s*$|\bproxy: DIRECT\b/.test(yaml), 'service-plane bootstrap field present');
      cases += 2;
    }

    // 5. PT: exit-узел без исходящего ребра → PT-GEN-DIRECT-BAN, config.yaml
    //    не генерируется; цепочка с финальным overlay — генерируется.
    {
      const pt = await page.evaluate(() => {
        const spec = {
          nodes: [{ id: 'e', role: 'entry' }, { id: 'x', role: 'exit' }],
          links: [{ from: 'e', to: 'x', transport: { kind: 'ss', endpoint: 'ep-0', credentialRef: 'cr-0' } }],
          clientLink: { transport: { kind: 'ss', endpoint: 'ep-c', credentialRef: 'cr-c' } },
          endpoints: { 'ep-c': '192.0.2.1:40000', 'ep-0': '198.51.100.1:4001' },
        };
        return ptGenerateArtifacts(spec, { 'cr-c': 'synth-c', 'cr-0': 'synth-0' });
      });
      assert.equal(pt.ok, true);
      const exit = pt.artifacts.find(a => a.nodeId === 'x');
      assert.ok(exit.blockers.some(b => b.code === 'PT-GEN-DIRECT-BAN'), 'PT exit blocked by no-DIRECT (user traffic to VPS IP)');
      assert.equal(exit.files['config.yaml'], undefined, 'no MATCH,DIRECT artifact');
      const entry = pt.artifacts[0];
      assert.equal(entry.status, 'READY', 'entry unaffected');
      cases += 2;
    }

    assert.deepEqual(errors, [], 'no page errors during the no-DIRECT browser regression: ' + JSON.stringify(errors));
    console.log('No-DIRECT browser regression: ' + cases + ' cases passed');
  } finally {
    await browser.close();
  }
  if (cases < 9) { console.error('browser registry smaller than expected'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

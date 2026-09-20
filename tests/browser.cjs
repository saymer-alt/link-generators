// Требует внешнюю установку playwright; приложение не получает новых зависимостей.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/awg31.conf'), 'utf8').replace(/\r\n/g, '\n');
const input = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#TEST-A\ntrojan://test-only@192.0.2.2:443#TEST-B';
const expectedAwg = {
  'header-protection-key': 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
  'content-padding-addition': '3-7', 'rekey-after-time': '100-120', 'rekey-timeout': '5-15',
  'reject-after-time': '150-180', 'keepalive-timeout': '15-20', 'max-handshake-attempts': '10-100',
  'random-trailers': true, 'disable-cookies': false, version: 3
};
(async () => {
  console.log('Browser: launching');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, timeout: 30000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    console.log('Browser: page loaded');
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
    await page.locator('button.tab').filter({ hasText: 'Mihomo' }).click();
    assert.equal(await page.locator('#cfgTunMips').isChecked(), true); // продуктовый дефолт (NIGHT-09)
    assert.match(await page.locator('label:has(#cfgSubMode)').innerText(), /Использовать URL-подписки/);
    assert.match(await page.locator('#subModeHint').innerText(), /HTTP\(S\) URL.*proxy-providers/);
    assert.equal(await page.locator('#mihomoOutput').isEditable(), false);
    assert.match(await page.locator('#mihomoOutputHint').innerText(), /только для чтения.*Build Config/i);
    await page.locator('#mihomoInput').fill(input);
    await page.locator('button[onclick="buildMihomo()"]').click();
    assert.match(await page.locator('#toast').innerText(), /URL-подписки.*URL подписки не найден.*выключите/i);
    await page.locator('#cfgSubMode').uncheck();
    assert.match(await page.locator('#subModeHint').innerText(), /обычные proxy-ссылки.*напрямую/i);
    await page.locator('#cfgWebUI').uncheck();
    await page.locator('#mihomoInput').fill(input);
    async function build(name) {
      await page.locator('button[onclick="buildMihomo()"]').click();
      await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID');
      const result = await page.evaluate(() => ({ yaml: document.getElementById('mihomoOutput').value,
        doc: jsyaml.load(document.getElementById('mihomoOutput').value) }));
      if (process.env.TEST_OUTPUT_DIR && name) {
        fs.mkdirSync(process.env.TEST_OUTPUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR, name + '.yaml'), result.yaml);
      }
      return result;
    }
    const defaultOutput = await build('default');
    assert.equal(defaultOutput.doc.tun.stack, 'mips'); // продуктовый дефолт (NIGHT-09)
    assert.match(await page.locator('#mihomoValidationBox').innerText(), /mihomo -t -f \/path\/to\/config\.yaml/);
    assert.match(await page.locator('#mihomoValidationBox').innerText(), /полный YAML.*полный вывод/i);
    await page.locator('#cfgTunMips').uncheck(); // gVisor — compatibility fallback
    const gvisor = await build('gvisor');
    assert.equal(gvisor.doc.tun.stack, 'gvisor');
    assert.equal(gvisor.yaml.replace('stack: gvisor', 'stack: mips'), defaultOutput.yaml);
    await page.locator('#cfgTunMips').check();
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    const mips = await build('mips');
    assert.equal(mips.doc.tun.stack, 'mips');
    await page.locator('#cfgPerProxyMaster').check(); // защитная крышка advanced-режима
    await page.locator('#cfgPerProxyTun').check();
    const per = await build('per-proxy-mips');
    assert.equal(per.doc.listeners.length, 2);
    assert.ok(per.doc.listeners.every(l => l.type === 'tun' && l.stack === 'mips' && l['auto-route'] === false));
    assert.ok(per.doc['proxy-groups'].some(g => g.name === '🌐 static-health' && g.hidden === true));
    for (const perTun of [true, false]) {
      await page.locator('#cfgPerProxyTun').setChecked(perTun);
      await page.locator('#cfgProfile').selectOption('vps');
      const vps = await build(perTun ? 'vps-per-proxy-mips' : 'vps-mips');
      assert.equal(vps.doc.tun.stack, 'mips');
      assert.equal(vps.doc.tun['auto-route'], false);
      assert.equal(vps.doc.tun.device, 'tun-mihomo');
      assert.equal(vps.doc['find-process-mode'], 'off');
      assert.equal(vps.doc.profile['store-selected'], false);
      if (perTun) assert.ok(vps.doc.listeners.every(l => l.stack === 'mips'));
      await page.locator('#vpsDnsEnabled').uncheck();
      assert.equal((await build()).doc.dns, undefined);
      await page.locator('#vpsDnsEnabled').check();
      await page.locator('#cfgProfile').selectOption('generic');
    }
    await page.locator('#cfgTunMips').uncheck();
    assert.equal((await build()).yaml, gvisor.yaml); // uncheck -> тот же gvisor-вывод

    // Selective modern REALITY: поле не ломает advanced-контролы (guard фикса 927c446).
    await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@pan1.example:443?encryption=none&security=reality&pbk=TESTPBK&sid=ab&fp=chrome#R1');
    await page.locator('#realityModernInput').fill('pan1.example\nbad::ipv6');
    const sel = await build('reality-selective');
    assert.equal(sel.doc.proxies[0]['reality-opts']['support-x25519mlkem768'], true);
    assert.equal(await page.locator('#perProxyAdvancedPanel').isVisible(), true);
    assert.equal(await page.locator('#cfgPerProxyMaster').isChecked(), true);
    assert.equal(await page.locator('#cfgPerProxyTun').isEnabled(), true);
    assert.equal(await page.locator('#cfgTunStackAdvanced').isVisible(), true);
    assert.equal(await page.locator('#cfgTunMips').isEnabled(), true);
    await page.locator('#realityModernInput').fill('');

    // Реальный file input -> normalizeWgText -> parser -> bean -> builder -> final YAML.
    await page.locator('#mihomoInput').fill('');
    await page.locator('#wgFile').setInputFiles(path.join(__dirname, 'fixtures/awg31.conf'));
    await page.waitForFunction(() => wgBeans.length === 1);
    assert.equal(await page.locator('#wgCustomDns').inputValue(), '1.1.1.1, 8.8.8.8');
    const awg = await build('awg31');
    const proxy = awg.doc.proxies[0];
    for (const [key, value] of Object.entries(expectedAwg)) assert.equal(proxy['amnezia-wg-option'][key], value, key);
    assert.equal(proxy['persistent-keepalive'], 25);
    assert.deepEqual(proxy.dns, ['1.1.1.1', '8.8.8.8']);
    assert.equal(proxy['amnezia-wg-option'].h1, '100001-100010');
    const stages = await page.evaluate(text => {
      const bean = web4core.parseWireGuardConf(normalizeWgText(text), 'test.awg');
      const parsed = structuredClone(bean.wireguard['amnezia-wg-option']);
      normalizeWgBeans([bean]);
      return { parsed, normalized: bean.wireguard['amnezia-wg-option'], built: web4core.buildMihomoProxy(bean)['amnezia-wg-option'] };
    }, fixture);
    for (const [key, value] of Object.entries(expectedAwg)) {
      if (key !== 'version') assert.equal(stages.parsed[key], value);
      assert.equal(stages.normalized[key], value);
      assert.equal(stages.built[key], value);
    }
    for (const [on, off] of [['OFF', 'ON'], ['yes', '0'], ['true', 'false']]) {
      const values = await page.evaluate(({ text, on, off }) => {
        const b = web4core.parseWireGuardConf(normalizeWgText(text.replace('RandomTrailers = on', 'RandomTrailers = ' + on).replace('DisableCookies = off', 'DisableCookies = ' + off)), 'bool.conf');
        return normalizeWgBeans([b])[0].wireguard['amnezia-wg-option'];
      }, { text: fixture, on, off });
      assert.equal(values['random-trailers'], on !== 'OFF');
      assert.equal(values['disable-cookies'], off === 'ON');
    }
    await page.locator('#cfgTunMips').check();
    await page.locator('#cfgProfile').selectOption('vps');
    const awgVps = await build('awg31-vps-mips');
    assert.deepEqual(awgVps.doc.proxies[0]['amnezia-wg-option'], proxy['amnezia-wg-option']);
    assert.equal(awgVps.doc.tun.stack, 'mips');

    // Старый UI + runtime, тот же ввод: byte-for-byte baseline generic/VPS/AWG.
    if (process.env.BASELINE_REF) {
      const oldRuntime = execFileSync('git', ['show', `${process.env.BASELINE_REF}:web4core.runtime.js`], { cwd: root, encoding: 'utf8' });
      const oldHtml = execFileSync('git', ['show', `${process.env.BASELINE_REF}:index.html`], { cwd: root, encoding: 'utf8' });
      const oldPage = await browser.newPage();
      await oldPage.goto('about:blank');
      await oldPage.setContent(oldHtml.replace(/<script[\s\S]*?<\/script>/g, ''));
      await oldPage.addScriptTag({ content: fs.readFileSync(process.env.JS_YAML_PATH, 'utf8') });
      await oldPage.addScriptTag({ content: oldRuntime });
      await oldPage.addScriptTag({ content: [...oldHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1] });
      for (const profile of ['generic', 'vps']) for (const useAwg of [false, true]) {
        const setup = ({ input, fixture, profile, useAwg }) => {
          document.getElementById('cfgSubMode').checked = false;
          document.getElementById('cfgWebUI').checked = false;
          document.getElementById('cfgProfile').value = profile;
          document.getElementById('cfgTunMips') && (document.getElementById('cfgTunMips').checked = false);
          document.getElementById('mihomoInput').value = useAwg ? '' : input;
          wgBeans = useAwg ? [web4core.parseWireGuardConf(normalizeWgText(fixture), 'awg31.conf')] : [];
          document.getElementById('wgCustomDns').value = '1.1.1.1, 8.8.8.8';
          buildMihomo();
          return document.getElementById('mihomoOutput').value;
        };
        const args = { input, fixture, profile, useAwg };
        assert.equal(await page.evaluate(setup, args), await oldPage.evaluate(setup, args));
      }
      await oldPage.close();
    }
    await page.locator('#wgFile').setInputFiles([]);
    await page.locator('#cfgProfile').selectOption('generic');
    await page.locator('#mihomoInput').fill('mieru://test:test@192.0.2.4:20000?transport=TPC#TEST');
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'INVALID');
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    await page.locator('#mihomoInput').fill('mieru://test:test@192.0.2.4:20000?transport=TCP#TEST');
    await build();

    const extra = await page.evaluate(text => {
      const awgLines = /^(?:HeaderProtectionKey|ContentPaddingAddition|RekeyAfterTime|RekeyTimeout|RejectAfterTime|KeepaliveTimeout|MaxHandshakeAttempts|RandomTrailers|DisableCookies)\s*=.*\n/gm;
      const plain = text.replace(awgLines, '').replace(/^(?:Jc|Jmin|Jmax|S[1-4]|H[1-4])\s*=.*\n/gm, '');
      const parse = t => normalizeWgBeans([web4core.parseWireGuardConf(normalizeWgText(t), 'test.conf')])[0];
      const scalar = parse(text.replace('ContentPaddingAddition = 3-7', 'ContentPaddingAddition = 3'));
      const falseOnly = parse(plain.replace('[Peer]', 'RandomTrailers = off\n\n[Peer]'));
      const intRange = parse(text.replace('S1 = 15', 'S1 = 15-20'));
      return {
        plain: parse(plain).wireguard['amnezia-wg-option'],
        scalar: jsyaml.load(web4core.buildFromRequest({ core: 'mihomo', wgBeans: [scalar], options: {} }).data).proxies[0]['amnezia-wg-option']['content-padding-addition'],
        falseOnly: falseOnly.wireguard['amnezia-wg-option'], intRange: intRange.wireguard['amnezia-wg-option'].s1
      };
    }, fixture);
    assert.equal(String(extra.scalar), '3'); // YAML emitter may emit a numeric scalar; Mihomo WeaklyTypedInput accepts it
    assert.equal(extra.plain, undefined);
    assert.deepEqual(extra.falseOnly, { 'random-trailers': false, version: 3 });
    assert.equal(extra.intRange, 15);

    // Обе вкладки, прежний сценарий YAML бота -> MASQUE -> Builder -> Copy.
    await page.locator('button.tab').filter({ hasText: 'WARP' }).click();
    await page.locator('#yamlInput').fill('proxies:\n  - private-key: AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\n    public-key: AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=\n    ip: 172.16.0.2\n');
    await page.locator('button[onclick="parseYaml()"]').click();
    await page.locator('button[onclick="generateWarp()"]').click();
    await page.locator('button[onclick="sendToMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID' && document.getElementById('mihomoInput').value.startsWith('masque://'));
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), false);
    // Clipboard adapter is stubbed only for test; real copyMihomo guard and call run.
    await page.evaluate(() => { window.testClipboard = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testClipboard = text; } } }); });
    await page.locator('#copyYamlBtn').click();
    assert.equal(await page.evaluate(() => window.testClipboard), await page.locator('#mihomoOutput').inputValue());
    const validator = await page.evaluate(() => {
      const results = [];
      const check = (name, doc, status, warnings) => {
        const result = validateMihomoYaml(typeof doc === 'string' ? doc : jsyaml.dump(doc));
        results.push({ name, ok: result.status === status && (warnings === undefined || result.warnings.length === warnings) });
      };
      const p = { name: 'test', type: 'ss', server: '192.0.2.1', port: 443 };
      for (const type of ['ss','ssr','vmess','vless','trojan','hysteria2','tuic','ssh','anytls','masque','trusttunnel','mieru','http','socks5','hysteria','snell','direct']) {
        check(type, { proxies: [{ ...p, type, transport: 'TCP' }] }, 'VALID');
      }
      for (const port of [0,70000,'abc',443.5]) check('port ' + port, { proxies: [{ ...p, port }] }, 'INVALID');
      check('unknown type', { proxies: [{ ...p, type: 'vles' }] }, 'INVALID');
      check('server missing', { proxies: [{ ...p, server: '' }] }, 'INVALID');
      check('port missing', { proxies: [{ name: 'x', type: 'ss', server: p.server }] }, 'INVALID');
      check('broken yaml', 'a: [', 'INVALID');
      check('root list', [], 'INVALID');
      check('dns scalar', { dns: 'x' }, 'INVALID');
      check('unknown field', { proxies: [{ ...p, unknown: true }] }, 'VALID');
      check('duplicate proxy', { proxies: [p,p] }, 'INVALID');
      check('listener port', { listeners: [{ name: 'a', port: 0 }] }, 'INVALID');
      check('duplicate listener', { listeners: [{ name: 'a' }, { name: 'a' }] }, 'INVALID');
      for (const type of ['select','url-test','fallback','load-balance','relay']) check(type, { 'proxy-groups': [{ name: 'a', type, proxies: ['DIRECT'] }] }, 'VALID');
      check('bad group type', { 'proxy-groups': [{ name: 'a', type: 'fallback2' }] }, 'INVALID');
      check('bad reference', { 'proxy-groups': [{ name: 'a', type: 'select', proxies: ['missing'] }] }, 'INVALID');
      check('forward reference', { 'proxy-groups': [{ name: 'a', type: 'select', proxies: ['b'] }, { name: 'b', type: 'select', proxies: ['DIRECT'] }] }, 'VALID');
      check('empty group', { 'proxy-groups': [{ name: 'a', type: 'select', proxies: [] }] }, 'VALID', 1);
      check('name collision', { proxies: [p], 'proxy-groups': [{ name: 'test', type: 'select', proxies: ['DIRECT'] }] }, 'VALID', 1);
      for (const range of ['20000-22000','20000','70000-80000','22000-20000','20000,21000']) {
        check('range ' + range, { proxies: [{ name: 'm', type: 'mieru', server: p.server, transport: 'TCP', 'port-range': range }] }, range === '20000-22000' ? 'VALID' : 'INVALID');
      }
      check('port and range', { proxies: [{ ...p, type: 'mieru', transport: 'TCP', 'port-range': '20000-22000' }] }, 'INVALID');
      return results;
    });
    assert.deepEqual(validator.filter(r => !r.ok), []);
    console.log(`Validator: ${validator.length} cases passed`);
    assert.deepEqual(errors, []);
    console.log('Browser: MIPS, VPS, AWG 3.1 pipeline, baseline and validator passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

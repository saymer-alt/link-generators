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
    const yamlScalarRoundTrip = await page.evaluate(() => {
      const values = ['true', 'false', 'null', '123', '00123', '0x10', '1e3', '1.2', '.nan', '.inf', '#', '#abc', ':', 'a\\nb', 'a\\r\\nb', 'Москва 😀', 'a: b', 'a #b', '{}', '[]', '~'];
      return values.map(value => {
        try {
          const input = 'trojan://' + encodeURIComponent(value) + '@192.0.2.1:443#SCALAR';
          const yaml = web4core.buildFromRequest({
            core: 'mihomo',
            input,
            options: { addTun: false, addSocks: true, webUI: false, mihomoSubscriptionMode: false }
          }).data;
          const doc = jsyaml.load(yaml);
          return {
            value,
            password: doc.proxies[0].password,
            passwordType: typeof doc.proxies[0].password,
          };
        } catch (e) {
          return { value, error: String(e && e.message ? e.message : e) };
        }
      });
    });
    for (const row of yamlScalarRoundTrip) {
      assert.equal(row.error, undefined, 'round-trip error for ' + JSON.stringify(row.value) + ': ' + row.error);
      assert.equal(row.passwordType, 'string', 'password type for ' + JSON.stringify(row.value));
      assert.equal(row.password, row.value, 'password value for ' + JSON.stringify(row.value));
    }

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
    // Hidden invalid custom Web UI settings must not block a build while Web UI is disabled.
    // Set the hidden state directly: this regression targets inactive stored values,
    // not pointer/visibility behavior of the controls themselves.
    await page.evaluate(() => {
      document.getElementById('webUiSelect').value = 'custom';
      document.getElementById('webUiCustomUrl').value = 'not-a-url';
      const webUi = document.getElementById('cfgWebUI');
      webUi.checked = false;
      webUi.dispatchEvent(new Event('change'));
    });
    await page.locator('#mihomoInput').fill(input);
    const webUiOff = await build('webui-off-invalid-hidden');
    assert.equal(webUiOff.doc['external-ui-url'], undefined);

    // The same invalid value must still be rejected when Web UI is enabled.
    await page.locator('#cfgWebUI').check();
    await page.locator('button[onclick="buildMihomo()"]').click();
    assert.match(await page.locator('#toast').innerText(), /Web UI.*абсолютный http\/https URL/i);
    assert.notEqual(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALID');
    await page.evaluate(() => {
      document.getElementById('webUiSelect').value = 'metacubexd';
      document.getElementById('webUiCustomUrl').value = '';
      const webUi = document.getElementById('cfgWebUI');
      webUi.checked = false;
      webUi.dispatchEvent(new Event('change'));
    });
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
    const openAdvancedDetails = async () => {
      await page.evaluate(() => { document.getElementById('perProxyAdvancedDetails').open = true; });
    };
    const defaultOutput = await build('default');
    assert.equal(defaultOutput.doc.tun.stack, 'mips'); // продуктовый дефолт (NIGHT-09)
    assert.equal(await page.locator('#mihomoCompatBox').isVisible(), true);
    assert.match(await page.locator('#mihomoCompatBox').innerText(), /MIPS TUN stack.*1\.19\.31/s);
    assert.doesNotMatch(await page.locator('#mihomoValidationBox').innerText(), /Requires Mihomo/);
    assert.match(await page.locator('#mihomoValidationBox').innerText(), /mihomo -t -f \/path\/to\/config\.yaml/);
    assert.match(await page.locator('#mihomoValidationBox').innerText(), /полный YAML.*полный вывод/i);
    await page.locator('#cfgTunMips').uncheck(); // gVisor — compatibility fallback
    const gvisor = await build('gvisor');
    assert.equal(gvisor.doc.tun.stack, 'gvisor');
    assert.equal(await page.locator('#mihomoCompatBox').isVisible(), false);
    assert.equal(gvisor.yaml.replace('stack: gvisor', 'stack: mips'), defaultOutput.yaml);
    await page.locator('#cfgTunMips').check();
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    const mips = await build('mips');
    assert.equal(mips.doc.tun.stack, 'mips');
    await openAdvancedDetails();
    await page.locator('#cfgPerProxyMaster').check(); // защитная крышка advanced-режима
    await page.locator('#cfgPerProxyTun').check();
    const per = await build('per-proxy-mips');
    assert.equal(per.doc.listeners.length, 2);
    assert.ok(per.doc.listeners.every(l => l.type === 'tun' && l.stack === 'mips' && l['auto-route'] === false));
    assert.ok(per.doc['proxy-groups'].some(g => g.name === '🌐 static-health' && g.hidden === true));
    for (const perTun of [true, false]) {
      await page.locator('#cfgPerProxyTun').setChecked(perTun);
      await page.locator('#cfgProfile').selectOption('vps-gateway');
      const vps = await build(perTun ? 'vps-per-proxy-mips' : 'vps-mips');
      assert.equal(vps.doc.tun.stack, 'mips');
      assert.equal(vps.doc.tun['auto-route'], false);
      assert.equal(vps.doc.tun.device, 'tun-mihomo');
      assert.equal(vps.doc.tun['inet4-address'], undefined);
      assert.equal(vps.doc['find-process-mode'], 'off');
      assert.equal(vps.doc.profile['store-selected'], false);
      if (perTun) assert.ok(vps.doc.listeners.every(l => l.stack === 'mips'));
      await page.locator('#vpsDnsEnabled').uncheck();
      assert.equal((await build()).doc.dns, undefined);
      await page.locator('#vpsDnsEnabled').check();
      await page.locator('#cfgProfile').selectOption('router');
    }
    await page.locator('#cfgTunMips').uncheck();
    assert.equal((await build()).yaml, gvisor.yaml); // uncheck -> тот же gvisor-вывод

    // VPS must preserve an explicitly selected experimental stack instead of
    // silently rewriting system/mixed to gVisor.
    await openAdvancedDetails();
    await page.locator('#cfgPerProxyMaster').uncheck();
    await page.locator('#cfgTunStackAdvanced').check();
    for (const stack of ['system', 'mixed']) {
      await page.locator('#cfgTunStackEx').selectOption(stack);
      await page.locator('#cfgProfile').selectOption('vps-gateway');
      const vpsExperimental = await build('vps-' + stack);
      assert.equal(vpsExperimental.doc.tun.stack, stack);
      assert.equal(vpsExperimental.doc.tun['inet4-address'], undefined);
      assert.equal(vpsExperimental.doc.tun['auto-route'], false);
      await page.locator('#cfgProfile').selectOption('router');
    }
    await page.locator('#cfgTunStackAdvanced').uncheck();
    await page.locator('#cfgTunMips').uncheck();
    await openAdvancedDetails();
    await page.locator('#cfgPerProxyMaster').check();

    // Selective modern REALITY: поле не ломает advanced-контролы (guard фикса 927c446).
    await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@pan1.example:443?encryption=none&security=reality&pbk=TESTPBK&sid=ab&fp=chrome#R1');
    await page.locator('#realityModernInput').fill('pan1.example\nbad::ipv6');
    const sel = await build('reality-selective');
    assert.equal(sel.doc.proxies[0]['reality-opts']['support-x25519mlkem768'], true);
    assert.match(await page.locator('#mihomoCompatBox').innerText(), /Modern REALITY.*v25\.5\.16/s);
    assert.equal(await page.locator('#perProxyAdvancedPanel').isVisible(), true);
    assert.equal(await page.locator('#cfgPerProxyMaster').isChecked(), true);
    assert.equal(await page.locator('#cfgPerProxyTun').isEnabled(), true);
    assert.equal(await page.locator('#cfgTunStackAdvanced').isVisible(), true);
    assert.equal(await page.locator('#cfgTunMips').isEnabled(), true);
    await page.locator('#realityModernInput').fill('');

    // Async WG upload must never leave a newly-built stale VALID result.
    await page.locator('#mihomoInput').fill('trojan://test-only@192.0.2.99:443#RACE');
    await page.evaluate(() => {
      const original = File.prototype.text;
      globalThis.__wgOriginalFileText = original;
      globalThis.__wgReleaseRead = null;
      File.prototype.text = function () {
        const file = this;
        return new Promise(resolve => {
          globalThis.__wgReleaseRead = async () => resolve(await original.call(file));
        });
      };
    });
    await page.locator('#wgFile').setInputFiles(path.join(__dirname, 'fixtures/awg31.conf'));
    await page.waitForFunction(() => wgUploadPending === true && typeof globalThis.__wgReleaseRead === 'function');
    await page.locator('button[onclick="buildMihomo()"]').click();
    assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'NOT_BUILT');
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    assert.match(await page.locator('#toast').innerText(), /WG\/AWG файл ещё читается/);

    await page.evaluate(async () => { await globalThis.__wgReleaseRead(); });
    await page.waitForFunction(() => wgUploadPending === false && wgBeans.length === 1);
    assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'NOT_BUILT');
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    await page.evaluate(() => {
      File.prototype.text = globalThis.__wgOriginalFileText;
      delete globalThis.__wgOriginalFileText;
      delete globalThis.__wgReleaseRead;
    });

    // Реальный file input -> normalizeWgText -> parser -> bean -> builder -> final YAML.
    await page.locator('#mihomoInput').fill('');
    await page.locator('#wgFile').setInputFiles(path.join(__dirname, 'fixtures/awg31.conf'));
    await page.waitForFunction(() => wgBeans.length === 1);
    assert.equal(await page.locator('#wgCustomDns').inputValue(), '1.1.1.1, 8.8.8.8');
    const awg = await build('awg31');
    const proxy = awg.doc.proxies[0];
    for (const [key, value] of Object.entries(expectedAwg)) assert.equal(proxy['amnezia-wg-option'][key], value, key);
    assert.match(await page.locator('#mihomoCompatBox').innerText(), /AmneziaWG 3\.1.*1\.19\.30/s);
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
    const inlineComments = await page.evaluate(({ text }) => {
      const commented = text
        .replace('RandomTrailers = on', 'RandomTrailers = on # keep enabled')
        .replace('DisableCookies = off', 'DisableCookies = off ; keep disabled')
        .replace('PersistentKeepalive = 25-35', 'PersistentKeepalive = 25-35 # use lower bound');
      const normalizedText = normalizeWgText(commented);
      const b = web4core.parseWireGuardConf(normalizedText, 'comments.awg');
      const normalized = normalizeWgBeans([b])[0];
      return {
        awg: normalized.wireguard['amnezia-wg-option'],
        keepalive: normalized.wireguard.persistentKeepalive,
        text: normalizedText,
      };
    }, { text: fixture });
    assert.equal(inlineComments.awg['random-trailers'], true);
    assert.equal(inlineComments.awg['disable-cookies'], false);
    assert.equal(inlineComments.keepalive, 25);
    assert.match(inlineComments.text, /RandomTrailers = 1 # keep enabled/);
    assert.match(inlineComments.text, /DisableCookies = 0 ; keep disabled/);
    assert.match(inlineComments.text, /PersistentKeepalive = 25 # use lower bound/);
    await page.locator('#cfgTunMips').check();
    await page.locator('#cfgProfile').selectOption('vps-gateway');
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
      for (const profile of ['router', 'vps-gateway']) for (const useAwg of [false, true]) {
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
    await page.locator('#cfgProfile').selectOption('router');
    await page.locator('#mihomoInput').fill('mieru://test:test@192.0.2.4:20000?transport=TPC#TEST');
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'INVALID');
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    await page.locator('#mihomoInput').fill('mieru://test:test@192.0.2.4:20000?transport=TCP#TEST');
    await build();
    assert.match(await page.locator('#mihomoCompatBox').innerText(), /Mieru \/ mierus.*эксперименталь/i);

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

    // WARP output: импортированные значения остаются текстом и не исполняют HTML/JS.
    await page.locator('button.tab').filter({ hasText: 'WARP' }).click();
    await page.evaluate(() => { globalThis.auditXss = 0; });
    const htmlLikeSni = '<span data-audit=warp-output>INERT</span>';
    await page.locator('#yamlInput').fill('private-key: SYNTHETIC\npublic-key: SYNTHETIC\nsni: "' + htmlLikeSni + '"\n');
    await page.locator('button[onclick="parseYaml()"]').click();
    assert.equal(await page.locator('#sni').inputValue(), htmlLikeSni);
    await page.evaluate(() => generateWarp());
    await page.waitForFunction(() => document.querySelectorAll('#warpOutput .link-text').length >= 2);
    assert.equal(await page.locator('#warpOutput [data-audit="warp-output"]').count(), 0);
    assert.match(await page.locator('#warpOutput .link-text').first().innerText(), /<span data-audit=warp-output>INERT<\/span>/);

    // Обе вкладки, прежний сценарий YAML бота -> MASQUE -> Builder -> Copy.
    await page.locator('button.tab').filter({ hasText: 'WARP' }).click();

    // Повторный импорт — atomic replace, а не merge со старыми identity-полями.
    await page.locator('#yamlInput').fill('private-key: FIRST\npublic-key: FIRST-PUB\nip: 172.16.0.9\nipv6: 2606:4700::9\nsni: old.example\ndns: [1.1.1.1, 8.8.8.8]\n');
    await page.locator('button[onclick="parseYaml()"]').click();
    await page.locator('#yamlInput').fill('private-key: SECOND\n');
    await page.locator('button[onclick="parseYaml()"]').click();
    assert.equal(await page.locator('#privateKey').inputValue(), 'SECOND');
    assert.equal(await page.locator('#publicKey').inputValue(), '');
    assert.equal(await page.locator('#ip').inputValue(), '');
    assert.equal(await page.locator('#ipv6').inputValue(), '');
    assert.equal(await page.locator('#sni').inputValue(), '');
    assert.equal(await page.locator('#dns').inputValue(), '');

    await page.locator('#yamlInput').fill('proxies:\n  - private-key: AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\n    public-key: AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=\n    ip: 172.16.0.2\n');
    await page.locator('button[onclick="parseYaml()"]').click();
    await page.locator('button[onclick="generateWarp()"]').click();

    // Свежая страница стартует с Sub Mode=true; WARP-links должны сами
    // переключить Builder в static-link mode.
    await page.evaluate(() => {
      const el = document.getElementById('cfgSubMode');
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    });
    await page.locator('button[onclick="sendToMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID' && document.getElementById('mihomoInput').value.startsWith('masque://'));
    assert.equal(await page.locator('#cfgSubMode').isChecked(), false);
    assert.match(await page.locator('#subModeHint').innerText(), /URL-подписки выключены/);
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), false);
    // Clipboard adapter is stubbed only for test; real copyMihomo guard and call run.
    await page.evaluate(() => { window.testClipboard = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testClipboard = text; } } }); });
    await page.locator('#copyYamlBtn').click();
    assert.equal(await page.evaluate(() => window.testClipboard), await page.locator('#mihomoOutput').inputValue());
    const compat = await page.evaluate(() => {
      const summary = doc => deriveCompatSummary(doc).map(x => x.key);
      return {
        none: summary({ proxies: [{ name: 'x', type: 'ss', server: '192.0.2.1', port: 443 }] }),
        mipsListener: summary({ listeners: [{ type: 'tun', stack: 'mips' }] }),
        awg31: summary({ proxies: [{ type: 'wireguard', 'amnezia-wg-option': { version: 3 } }] }),
        providerModern: summary({ 'proxy-providers': { p: { override: { 'override-expr': [{ expr: 'x', value: { 'support-x25519mlkem768': true } }] } } } }),
        tt: summary({ proxies: [{ type: 'trusttunnel' }] })
      };
    });
    assert.deepEqual(compat.none, []);
    assert.deepEqual(compat.mipsListener, ['mips']);
    assert.deepEqual(compat.awg31, ['awg31']);
    assert.deepEqual(compat.providerModern, ['override-expr', 'modern-reality']);
    assert.deepEqual(compat.tt, ['trusttunnel']);
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

    // === DEPLOYMENT PROFILES: router / vps-local / vps-gateway ===
    // чистая страница: reload без накопленного состояния прошлых секций
    await page.reload();
    await page.waitForFunction(() => globalThis.jsyaml && globalThis.web4core);
    await page.locator('button.tab').filter({ hasText: 'Mihomo' }).click();
    const checked2 = async id => page.locator(id).isChecked();
    const vis2 = async id => page.locator(id).isVisible();
    const disabled2 = async id => page.locator(id).isDisabled();
    const build2 = async () => {
      await page.locator('button[onclick="buildMihomo()"]').click();
      await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID', null, { timeout: 15000 }).catch(() => {});
      return page.evaluate(() => document.getElementById('mihomoOutput').value);
    };

    // Defaults: router, TUN/MIPS/Mixed/LAN ON, gateway panel скрыт
    assert.equal(await page.locator('#cfgProfile').inputValue(), 'router');
    assert.equal(await checked2('#cfgTun'), true);
    assert.equal(await checked2('#cfgTunMips'), true);
    assert.equal(await checked2('#cfgSocks'), true);
    assert.equal(await checked2('#cfgLan'), true);
    assert.equal(await vis2('#vpsPanel'), false, 'gateway panel скрыт в router');
    assert.match(await page.locator('#profileHint').innerText(), /роутер|TUN/i);

    // Независимые пользовательские данные (не принадлежат профилю);
    // dialer-поля заполняются отдельно ниже: dialer-proxy применяется
    // только к WireGuard-профилям, для чистых сборок они не нужны.
    const INDEP = {
      input: 'trojan://independent-pass@203.0.113.77:443#KEEP-ME\ntrojan://p1@203.0.113.78:443#KEEP-M1\ntrojan://p2@203.0.113.79:443#KEEP-M2\nhttps://keep.example.example/sub',
      exclude: '(?i)keep|keep2',
      device: 'SE-Fieldtest-2026',
      reality: 'pan3.example\npan4.example:8443',
      dns: '9.9.9.9',
      dialer: 'KEEP-DIALER',
      members: 'KEEP-M1\nKEEP-M2',
      providers: 'https://keep.example.example/sub',
    };
    await page.locator('#mihomoInput').fill(INDEP.input);
    await page.locator('#excludeFilterInput').fill(INDEP.exclude);
    await page.locator('#deviceModelInput').fill(INDEP.device);
    await page.locator('#realityModernInput').fill(INDEP.reality);
    await page.locator('#wgCustomDns').fill(INDEP.dns);

    // Спойлер ADVANCED: закрыт по умолчанию; раскрытие не включает master;
    // закрытие не сбрасывает.
    assert.equal(await page.evaluate(() => document.getElementById('perProxyAdvancedDetails').open), false, 'спойлер закрыт по умолчанию');
    await page.locator('#perProxyAdvancedSummary').click();
    assert.equal(await page.evaluate(() => document.getElementById('perProxyAdvancedDetails').open), true, 'раскрытие работает');
    assert.equal(await checked2('#cfgPerProxyMaster'), false, 'раскрытие НЕ включает master');
    await page.locator('#perProxyAdvancedSummary').click();
    assert.equal(await page.evaluate(() => document.getElementById('perProxyAdvancedDetails').open), false, 'закрытие работает');
    assert.equal(await checked2('#cfgPerProxyMaster'), false);
    await page.locator('#perProxyAdvancedSummary').click(); // открыт для round trip

    // router: ручное изменение router-owned параметра перед уходом
    await page.locator('#cfgTunMips').uncheck();

    // vps-local: контракт + DOM tamper
    await page.locator('#cfgProfile').selectOption('vps-local');
    assert.equal(await checked2('#cfgTun'), false, 'vps-local: TUN off');
    assert.equal(await disabled2('#cfgTun'), true, 'vps-local: TUN disabled');
    assert.equal(await checked2('#cfgTunMips'), false);
    assert.equal(await disabled2('#cfgTunMips'), true);
    assert.equal(await disabled2('#cfgTunStackAdvanced'), true, 'advanced stack недоступен');
    assert.equal(await checked2('#cfgSocks'), true, 'vps-local: Mixed ON');
    assert.equal(await disabled2('#cfgSocks'), true, 'vps-local: Mixed locked');
    assert.equal(await checked2('#cfgLan'), false, 'vps-local: LAN off');
    assert.equal(await disabled2('#cfgLan'), true, 'vps-local: LAN disabled');
    assert.equal(await vis2('#vpsPanel'), false, 'gateway panel скрыт');
    // DOM tamper: подмена checked/disabled напрямую — Build обязан выдать контракт
    await page.evaluate(() => {
      document.getElementById('cfgTun').checked = true;
      document.getElementById('cfgTun').disabled = false;
      document.getElementById('cfgLan').checked = true;
    });
    const tamperedYaml = await build2();
    assert.doesNotMatch(tamperedYaml, /^tun:/m, 'tamper: TUN-блока нет');
    assert.match(tamperedYaml, /^mixed-port: 7890$/m, 'tamper: mixed-port на месте');
    assert.match(tamperedYaml, /^allow-lan: false$/m, 'tamper: allow-lan false');
    assert.doesNotMatch(tamperedYaml, /bind-address: "\*"/, 'tamper: без bind-address *');

    // vps-gateway: TUN ON locked, panel, auto-route false
    await page.locator('#cfgProfile').selectOption('vps-gateway');
    assert.equal(await checked2('#cfgTun'), true, 'gateway: TUN on');
    assert.equal(await disabled2('#cfgTun'), true, 'gateway: TUN locked');
    assert.equal(await vis2('#vpsPanel'), true, 'gateway panel виден');
    assert.equal(await page.locator('#vpsDevice').inputValue(), 'tun-mihomo');
    const gwYaml = await build2();
    assert.match(gwYaml, /device: tun-mihomo/);
    assert.match(gwYaml, /auto-route: false/);
    assert.doesNotMatch(gwYaml, /auto-route: true/);

    // Round trip в router: независимые данные живы
    await page.locator('#cfgProfile').selectOption('router');
    for (const [id, want] of [
      ['#mihomoInput', INDEP.input], ['#excludeFilterInput', INDEP.exclude],
      ['#deviceModelInput', INDEP.device], ['#realityModernInput', INDEP.reality],
      ['#wgCustomDns', INDEP.dns],
    ]) assert.equal(await page.locator(id).inputValue(), want, 'независимое поле пережило round trip: ' + id);
    assert.equal(await checked2('#cfgTunMips'), false, 'router: ручное состояние MIPS восстановлено');

    // dialer-proxy поля: заполняются и переживают mini round trip
    await page.locator('#wgDialerInput').fill(INDEP.dialer);
    await page.locator('#wgDialerMembers').fill(INDEP.members);
    await page.locator('#wgDialerProviders').fill(INDEP.providers);
    await page.locator('#cfgProfile').selectOption('vps-local');
    await page.locator('#cfgProfile').selectOption('router');
    for (const [id, want] of [['#wgDialerInput', INDEP.dialer], ['#wgDialerMembers', INDEP.members], ['#wgDialerProviders', INDEP.providers]])
      assert.equal(await page.locator(id).inputValue(), want, 'dialer поле пережило переключение: ' + id);

    // БС × профили: ON/OFF без залипания
    for (const profileValue of ['router', 'vps-local', 'vps-gateway']) {
      await page.locator('#cfgProfile').selectOption(profileValue);
      const bs = page.locator('#cfgAutoWhitelist');
      await bs.check();
      assert.equal(await page.locator('#cfgProfile').inputValue(), 'router', 'БС: профиль router');
      assert.equal(await disabled2('#cfgProfile'), true, 'БС: выбор заблокирован');
      assert.equal(await vis2('#vpsPanel'), false, 'БС: gateway panel скрыт');
      assert.equal(await checked2('#cfgPerProxyTun'), false, 'БС: Per-Proxy TUN off');
      await bs.uncheck();
      assert.equal(await page.locator('#cfgProfile').inputValue(), profileValue, 'БС off: профиль восстановлен');
      assert.equal(await disabled2('#cfgProfile'), false, 'БС off: разблокирован');
    }
    console.log('Profiles: router/vps-local/vps-gateway contract, round trip, spoiler, БС — passed');

  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

// External Playwright, js-yaml 4.1.0; same setup as browser.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const yaml = require(process.env.JS_YAML_PATH);
const root = path.resolve(__dirname, '..');
const STATIC_HEALTH_GROUP = '🌐 static-health';
// Baseline normalization: the hidden per-proxy static checker exists only in
// the new runtime; strip it from both sides so byte-parity of everything else
// stays provable.
const stripChecker = y => {
  const d = yaml.load(y);
  if (d['proxy-groups']) d['proxy-groups'] = d['proxy-groups'].filter(g => g && g.name !== STATIC_HEALTH_GROUP);
  return yaml.dump(d, { lineWidth: -1 });
};
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
    await page.locator('#cfgPerProxyMaster').check();
    await page.locator('#cfgPerProxyTun').check();
    await page.locator('#cfgPerProxySocks').check();
    await page.locator('#cfgProfile').selectOption('vps');
    await page.locator('#cfgAutoWhitelist').check();
    for (const id of ['cfgPerProxyTun', 'cfgPerProxySocks', 'cfgProfile', 'vpsPanel', 'cfgPerProxyMaster']) assert.equal(await page.locator('#' + id).isVisible(), false);
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
    // Master switch stays OFF here — its clamp must keep children out on its own.
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
    assert.equal(guarded.tun.stack, 'mips'); // VPS наследует продуктовый дефолт MIPS
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
    // Зависимости UI (реальные клики): выключение родителя отключает и сбрасывает
    // зависимые чекбоксы; включение родителя возвращает доступность.
    await page.locator('#cfgProfile').selectOption('generic');
    await page.locator('#cfgTun').uncheck();
    for (const id of ['cfgTunMips', 'cfgPerProxyTun']) {
      assert.equal(await page.locator('#' + id).isDisabled(), true, id);
      assert.equal(await page.locator('#' + id).isChecked(), false, id);
    }
    assert.equal(await page.locator('#cfgPerProxySocks').isDisabled(), false);
    await page.locator('#cfgSocks').uncheck();
    assert.equal(await page.locator('#cfgPerProxySocks').isDisabled(), true);
    assert.equal(await page.locator('#cfgPerProxySocks').isChecked(), false);
    await page.locator('#cfgTun').check();
    assert.equal(await page.locator('#cfgTunMips').isDisabled(), false);
    assert.equal(await page.locator('#cfgPerProxyTun').isDisabled(), false);
    await page.locator('#cfgSocks').check();
    assert.equal(await page.locator('#cfgPerProxySocks').isDisabled(), false);
    // Master switch: защитная крышка — OFF отключает и сбрасывает оба child.
    await page.locator('#cfgPerProxyMaster').uncheck();
    for (const id of ['cfgPerProxyTun', 'cfgPerProxySocks']) {
      assert.equal(await page.locator('#' + id).isDisabled(), true, id);
      assert.equal(await page.locator('#' + id).isChecked(), false, id);
    }
    await page.locator('#cfgPerProxyMaster').check();
    assert.equal(await page.locator('#cfgPerProxyTun').isDisabled(), false);
    assert.equal(await page.locator('#cfgPerProxySocks').isDisabled(), false);
    // Позитив-контроль крышки: master ON + оба child + generic — в выводе
    // per-proxy listeners и скрытый static health checker.
    const masterOn = await page.evaluate(async () => {
      document.getElementById('cfgSubMode').checked = false;
      document.getElementById('cfgTunMips').checked = true; // дефолт мог быть сброшен предыдущими секциями
      document.getElementById('cfgPerProxyTun').checked = true;
      document.getElementById('cfgPerProxySocks').checked = true;
      document.getElementById('mihomoInput').value = 'socks://test:pass@192.0.2.1:1080#TEST-A';
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      return { state: MIHOMO_VALIDATION_STATE.state, doc: jsyaml.load(document.getElementById('mihomoOutput').value) };
    });
    assert.equal(masterOn.state, 'VALID');
    assert.ok(Array.isArray(masterOn.doc.listeners) && masterOn.doc.listeners.length > 0);
    assert.ok(masterOn.doc.listeners.filter(l => l.type === 'tun').every(l => l.stack === 'mips')); // per-proxy наследует дефолт MIPS
    assert.ok(masterOn.doc['proxy-groups'].some(g => g.name === '🌐 static-health' && g.hidden === true));
    // Advanced TUN stack: system/mixed за крышкой; override снимает MIPS
    // (единое состояние — нет «MIPS checked» при system/mixed в YAML).
    const advStack = await page.evaluate(async () => {
      document.getElementById('cfgPerProxyTun').checked = false; // обычный TUN: глобальный блок tun
      document.getElementById('cfgPerProxySocks').checked = false;
      document.getElementById('cfgTunStackAdvanced').checked = true;
      document.getElementById('cfgTunStackEx').value = 'system';
      document.getElementById('cfgTunMips').checked = true;
      updateMihomoOptionStates(); // как при реальном событии change
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      const doc = jsyaml.load(document.getElementById('mihomoOutput').value || 'null');
      return { state: MIHOMO_VALIDATION_STATE.state, stack: doc && doc.tun && doc.tun.stack,
        mipsChecked: document.getElementById('cfgTunMips').checked, mipsDisabled: document.getElementById('cfgTunMips').disabled };
    });
    assert.equal(advStack.state, 'VALID', 'advStack state; toast=' + advStack.toast + ' head=' + advStack.head);
    assert.equal(advStack.stack, 'system', 'advStack stack; head=' + advStack.head);
    assert.equal(advStack.mipsChecked, false);
    assert.equal(advStack.mipsDisabled, true);
    // Per-proxy TUN наследует advanced stack.
    const advPerProxy = await page.evaluate(async () => {
      document.getElementById('cfgPerProxyMaster').checked = true;
      document.getElementById('cfgPerProxyTun').checked = true;
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      const doc = jsyaml.load(document.getElementById('mihomoOutput').value);
      return (doc.listeners || []).filter(l => l.type === 'tun').map(l => l.stack);
    });
    assert.ok(advPerProxy.length > 0 && advPerProxy.every(s => s === 'system'));
    // Fail-safe: невалидное значение из подменённого DOM → безопасный фолбэк.
    const invalidStack = await page.evaluate(async () => {
      document.getElementById('cfgPerProxyTun').checked = false;
      document.getElementById('cfgPerProxySocks').checked = false;
      document.getElementById('cfgTunStackEx').value = 'banana';
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      const doc = jsyaml.load(document.getElementById('mihomoOutput').value);
      return doc.tun && doc.tun.stack;
    });
    assert.equal(invalidStack, 'gvisor'); // mips снят override'ом ранее → gvisor
    const mixedStack = await page.evaluate(async () => {
      document.getElementById('cfgTunStackEx').value = 'mixed';
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      const doc = jsyaml.load(document.getElementById('mihomoOutput').value);
      return doc.tun && doc.tun.stack;
    });
    assert.equal(mixedStack, 'mixed');
    // Возврат: крышка OFF → сброс select, MIPS снова доступен.
    const advOff = await page.evaluate(() => {
      document.getElementById('cfgTunStackAdvanced').checked = false;
      updateMihomoOptionStates();
      return { ex: document.getElementById('cfgTunStackEx').value, mipsDisabled: document.getElementById('cfgTunMips').disabled };
    });
    assert.equal(advOff.ex, '');
    assert.equal(advOff.mipsDisabled, false);
    // Exclude Filter (upstream parity): поле видно только при Sub Mode,
    // значение применяется ко ВСЕМ provider'ам, пустое — ничего не добавляет.
    const exFilter = await page.evaluate(async () => {
      document.getElementById('cfgSubMode').checked = true;
      document.getElementById('excludeFilterInput').value = '(?i)ru|russia';
      document.getElementById('mihomoInput').value = 'https://example.com/one\nhttps://example.org/two';
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      const doc = jsyaml.load(document.getElementById('mihomoOutput').value);
      const providers = Object.values(doc['proxy-providers'] || {});
      return { state: MIHOMO_VALIDATION_STATE.state, count: providers.length,
        values: providers.map(p => p['exclude-filter']) };
    });
    assert.equal(exFilter.state, 'VALID');
    assert.equal(exFilter.count, 2);
    assert.deepEqual(exFilter.values, ['(?i)ru|russia', '(?i)ru|russia']);
    const exEmpty = await page.evaluate(async () => {
      document.getElementById('excludeFilterInput').value = '';
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      const doc = jsyaml.load(document.getElementById('mihomoOutput').value);
      return Object.values(doc['proxy-providers'] || {}).some(p => 'exclude-filter' in p);
    });
    assert.equal(exEmpty, false);
    await page.locator('#cfgSubMode').uncheck();
    assert.equal(await page.locator('#excludeFilterRow').isVisible(), false);
    await page.locator('#cfgSubMode').check();
    assert.equal(await page.locator('#excludeFilterRow').isVisible(), true);
    // Fail-safe: подмена DOM в обход зависимостей — сборка клампит запрещённые
    // комбинации. cfgSocks в 256-матрицу не входит, поэтому socks=0+perSocks=1
    // проверяется здесь.
    const socksClamp = await page.evaluate(async () => {
      document.getElementById('cfgSubMode').checked = false; // ссылки без Sub Mode
      document.getElementById('cfgSocks').checked = false;
      document.getElementById('cfgPerProxyMaster').checked = false; // крышка выключена
      document.getElementById('cfgPerProxySocks').checked = true; // форс при Mixed off
      document.getElementById('mihomoInput').value = 'socks://test:pass@192.0.2.1:1080#TEST-A';
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      const doc = jsyaml.load(document.getElementById('mihomoOutput').value);
      return { state: MIHOMO_VALIDATION_STATE.state, tun: !!doc.tun, listeners: doc.listeners, mixed: doc['mixed-port'] };
    });
    assert.equal(socksClamp.state, 'VALID');
    assert.equal(socksClamp.tun, true); // inbound — TUN (включён)
    assert.equal(socksClamp.listeners, undefined); // Per-Proxy SOCKS клампнут
    assert.equal(socksClamp.mixed, undefined);
    const tunClamp = await page.evaluate(async () => {
      document.getElementById('cfgSocks').checked = true;
      document.getElementById('cfgPerProxySocks').checked = false;
      document.getElementById('cfgTun').checked = false;
      document.getElementById('cfgTunMips').checked = true;     // форс при TUN off
      document.getElementById('cfgPerProxyTun').checked = true; // форс при TUN off
      buildMihomo();
      while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
      const doc = jsyaml.load(document.getElementById('mihomoOutput').value);
      return { state: MIHOMO_VALIDATION_STATE.state, yaml: document.getElementById('mihomoOutput').value,
        tun: !!doc.tun, listeners: doc.listeners, mixed: doc['mixed-port'] };
    });
    assert.equal(tunClamp.state, 'VALID');
    assert.equal(tunClamp.tun, false);
    assert.equal(tunClamp.listeners, undefined); // Per-Proxy TUN клампнут
    assert.equal(tunClamp.mixed, 7890);
    assert.doesNotMatch(tunClamp.yaml, /stack:/); // MIPS клампнут вместе с TUN
    // Полное отсутствие inbound (TUN off + Mixed off) — fail-closed ошибкой рантайма.
    const noInbound = await page.evaluate(() => {
      document.getElementById('cfgSocks').checked = false;
      document.getElementById('mihomoOutput').value = '';
      buildMihomo();
      return { state: MIHOMO_VALIDATION_STATE.state, out: document.getElementById('mihomoOutput').value };
    });
    assert.equal(noInbound.state, 'NOT_BUILT');
    assert.equal(noInbound.out, ''); // ошибочная сборка не оставляет stale-вывод
    assert.equal(await page.locator('#copyYamlBtn').isDisabled(), true);
    // Возврат DOM к дефолтам перед baseline (матрица не перебирает cfgSocks).
    await page.evaluate(() => {
      ['cfgSocks', 'cfgTun', 'cfgLan', 'cfgWebUI'].forEach(id => document.getElementById(id).checked = true);
      ['cfgPerProxyTun', 'cfgPerProxySocks', 'cfgTunMips'].forEach(id => document.getElementById(id).checked = false);
      const master = document.getElementById('cfgPerProxyMaster');
      if (master) master.checked = false;
      document.getElementById('excludeFilterInput').value = '';
      document.getElementById('cfgTunStackEx').value = '';
    });
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
          // Нормализация невозможных DOM-состояний по реальным UI-зависимостям:
          // VPS форсирует TUN; TUN=false сбрасывает MIPS и Per-Proxy TUN;
          // пер-прокси биты требуют master (в старом baseline master отсутствует).
          // Невалидные комбинации проверяются отдельными bypass-тестами.
          if (mask & 128) document.getElementById('cfgTun').checked = true;
          if (!(mask & 2)) {
            document.getElementById('cfgTunMips').checked = false;
            document.getElementById('cfgPerProxyTun').checked = false;
          }
          const masterEl = document.getElementById('cfgPerProxyMaster');
          if (masterEl) masterEl.checked = !!(mask & 4 || mask & 8);
          document.getElementById('cfgProfile').value = mask & 128 ? 'vps' : 'generic';
          document.getElementById('mihomoInput').value = (mask & 1 ? 'https://example.invalid/sub\n' : '') + a + '\n' + b;
          buildMihomo();
          while (MIHOMO_VALIDATION_STATE.state === 'VALIDATING') await new Promise(r => setTimeout(r, 10));
          return { yaml: document.getElementById('mihomoOutput').value, state: MIHOMO_VALIDATION_STATE.state };
        };
        const args = { mask, a: a.replace('#GLOBAL', '#TEST-A'), b: b.replace('#GLOBAL', '#TEST-B') };
        const result = await page.evaluate(setup, args);
        const oldResult = await old.evaluate(setup, args);
        assert.equal(result.state, 'VALID');
        assert.deepEqual(stripChecker(result.yaml), stripChecker(oldResult.yaml), 'baseline mask ' + mask);
        count++;
      }
      await old.close();
    }
    assert.deepEqual(errors, []);
    console.log(`Whitelist browser: ${count} matrix/baseline cases + UI restoration and bypass guards passed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

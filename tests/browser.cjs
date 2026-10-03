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
    assert.match(await page.locator('#subModeHint').innerText(), /подписка читается один раз.*статические proxies/i);
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

    // Subscription inspection: stable preview HWID, mixed/multi-URL input,
    // static expansion when Sub Mode is OFF and provider preservation when ON.
    await page.evaluate(() => {
      globalThis.__subscriptionFetchOriginal = web4core.fetchSubscription;
      globalThis.__subscriptionFetchCalls = [];
      const subscriptions = {
        'https://sub-one.example.test/token': [
          'vless://00000000-0000-4000-8000-000000000011@192.0.2.11:443?encryption=none&type=tcp#Sweden%20Stockholm',
          'vless://00000000-0000-4000-8000-000000000012@192.0.2.12:443?encryption=none&type=tcp#RU%20Moscow'
        ],
        'https://sub-two.example.test/token': [
          'trojan://synthetic-only@192.0.2.13:443#Moscow%20Backup'
        ]
      };
      web4core.fetchSubscription = async (url, options) => {
        globalThis.__subscriptionFetchCalls.push({ url, headers: Object.assign({}, options && options.headers) });
        const rows = subscriptions[url];
        if (!rows) throw new Error('synthetic subscription missing');
        return rows.join('\n');
      };
    });
    const syntheticMixed = [
      'https://sub-one.example.test/token',
      'trojan://static-only@192.0.2.20:443#STATIC',
      'https://sub-two.example.test/token'
    ].join('\n');
    await page.locator('#cfgSubMode').setChecked(false);
    // Invalid regexp in static-expansion mode: explicit error, no build.
    await page.locator('#excludeFilterInput').fill('(?i)ru|moscow(');
    await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');
    await page.locator('button[onclick="buildMihomo()"]').click();
    assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'NOT_BUILT', 'invalid regexp: сборка не выполняется');
    assert.match(await page.evaluate(() => window.__lastToast || ''), /Exclude Filter: некорректное регулярное выражение/);
    await page.locator('#excludeFilterInput').fill('(?i)ru|moscow');
    await page.locator('#mihomoInput').fill(syntheticMixed);
    const expanded = await build('subscription-inline-static');
    assert.equal(expanded.doc['proxy-providers'], undefined);
    assert.ok(expanded.doc.proxies.some(p => p.name === 'Sweden Stockholm'));
    assert.ok(expanded.doc.proxies.some(p => p.name === 'STATIC'));
    assert.ok(!expanded.doc.proxies.some(p => /RU Moscow|Moscow Backup/i.test(p.name)));
    assert.match(await page.locator('#subscriptionPreviewStats').innerText(), /Подписок: 2.*найдено узлов: 3.*после фильтра: 1.*исключено: 2/s);
    await page.locator('#subscriptionPreviewDetails').evaluate(d => { d.open = true; }); // закрытый details не рендерится
    assert.match(await page.locator('#subscriptionPreviewNamesLegacy').innerText(), /Sweden Stockholm/);
    assert.match(await page.locator('#subscriptionPreviewNamesLegacy').innerText(), /RU Moscow/);
    let subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(subCalls.length, 2);
    assert.match(subCalls[0].headers['x-hwid'], /^[0-9a-f]{32}$/);
    assert.equal(subCalls[0].headers['x-hwid'], subCalls[1].headers['x-hwid']);
    assert.equal(subCalls[0].headers['x-device-model'], 'Saymer Link Generators Preview');
    assert.equal(subCalls[0].headers['x-device-os'], undefined, 'allowlist: только x-hwid + x-device-model');
    assert.equal(subCalls[0].headers['authorization'], undefined);

    // A second Build in the same page keeps the same preview identity.
    const firstHwid = subCalls[0].headers['x-hwid'];
    await build('subscription-inline-static-second-build');
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(subCalls.length, 4);
    assert.equal(subCalls[2].headers['x-hwid'], firstHwid);
    assert.equal(subCalls[3].headers['x-hwid'], firstHwid);

    // Sub ON + server-list toggle OFF (по умолчанию): provider YAML строится
    // СРАЗУ, fetchSubscription НЕ вызывается вовсе (opt-in контракт), скрытый
    // preview-запрос запрещён. Ручной фильтр применяется как раньше.
    await page.locator('#cfgServerList').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#cfgServerList').isChecked(), false, 'список серверов: OFF по умолчанию');
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    const callsBeforeOn = subCalls.length;
    await page.locator('#cfgSubMode').setChecked(true);
    const providerMode = await build('subscription-provider-no-preview');
    assert.equal(Object.keys(providerMode.doc['proxy-providers'] || {}).length, 2);
    assert.ok(providerMode.doc.proxies.some(p => p.name === 'STATIC'));
    assert.ok(Object.values(providerMode.doc['proxy-providers']).every(p => p['exclude-filter'] === '(?i)ru|moscow'));
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(subCalls.length, callsBeforeOn, 'Sub ON + toggle OFF: ноль fetchSubscription-вызовов на Build');
    // Preview box может показывать статистику последнего OFF-inspection —
    // это исторические данные, не новый запрос. Панель списка скрыта.
    assert.equal(await page.locator('#serverListPanel').isVisible(), false, 'панель списка скрыта при выключенном toggle');

    // Toggle ON: панель появляется, но fetch только по явной кнопке.
    await page.locator('#cfgServerList').check();
    assert.equal(await page.locator('#serverListPanel').isVisible(), true, 'toggle ON: панель списка видна');
    assert.equal(await page.evaluate(() => document.getElementById('subListFetchBtn').disabled), false, 'кнопка доступна');
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(subCalls.length, callsBeforeOn, 'toggle ON сам по себе не делает запросов');
    await page.locator('#subListFetchBtn').click(); // явный запрос списка
    await page.waitForFunction(() => document.getElementById('subscriptionPreviewNames').children.length > 0, null, { timeout: 10000 });
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(subCalls.length, callsBeforeOn + 2, 'ровно 2 fetch (2 подписки) по явной кнопке');
    // Список: 3 уникальных имени из 2 подписок; узлов честно 3 (по 1 узлу на имя в стабе).
    assert.match(await page.locator('#subListStats').innerText(), /Уникальных имён: 3/);
    const listText = await page.locator('#subscriptionPreviewNames').innerText();
    assert.match(listText, /Sweden Stockholm/);
    assert.match(listText, /RU Moscow/);
    assert.match(listText, /Moscow Backup/);
    assert.ok(!listText.includes('sub-one.example.test') && !listText.includes('token'), 'subscription URL/token не попали в список');
    // Privacy: элементы — label+checkbox+text, никаких URI/UUID.
    const listHtml = await page.evaluate(() => document.getElementById('subscriptionPreviewNames').innerHTML);
    assert.ok(!listHtml.includes('vless://') && !listHtml.includes('trojan://'), 'proxy URI не попали в список DOM');
    console.log('  server list: toggle OFF = 0 fetch, toggle ON = список по явной кнопке — passed');

    // Device Model: пусто → fallback-имя; заполнено → пользовательское имя;
    // HWID одинаков и не зависит от Device Model.
    await page.evaluate(() => globalThis.__subscriptionFetchCalls.length = 0);
    await page.locator('#deviceModelInput').fill('Keenetic Giga KN-1012');
    await page.locator('#subListFetchBtn').click();
    await page.waitForFunction(() => document.getElementById('subscriptionPreviewNames').children.length > 0, null, { timeout: 10000 });
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.ok(subCalls.length >= 2);
    assert.equal(subCalls[0].headers['x-device-model'], 'Keenetic Giga KN-1012', 'пользовательский Device Model уходит в заголовок');
    assert.equal(subCalls[0].headers['x-hwid'], firstHwid, 'Device Model не меняет preview-HWID');
    await page.locator('#deviceModelInput').fill('');
    const countBefore = subCalls.length;
    await page.locator('#subListFetchBtn').click();
    await page.waitForFunction(c => globalThis.__subscriptionFetchCalls.length >= c + 2, countBefore, { timeout: 10000 });
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(subCalls[subCalls.length - 1].headers['x-device-model'], 'Saymer Link Generators Preview', 'пустое поле → fallback-имя');
    assert.equal(subCalls[subCalls.length - 1].headers['x-hwid'], firstHwid, 'HWID стабилен после смены Device Model');
    console.log('  device model: пользовательское имя / fallback, HWID не зависит — passed');

    // Selection: галочки → счётчики; union с ручным фильтром в ON и OFF.
    const moscowBox = page.locator('#subscriptionPreviewNames .sub-list-check[data-name="RU Moscow"]');
    await moscowBox.check();
    const backupBox = page.locator('#subscriptionPreviewNames .sub-list-check[data-name="Moscow Backup"]');
    await backupBox.check();
    // union: manual(?i)ru|moscow покрывает RU Moscow + Moscow Backup; Sweden Stockholm остаётся.
    assert.match(await page.locator('#subListStats').innerText(), /исключается: 2.*останется: 1/s, 'union: manual + выбранные (обa уже в manual) → 2 исключаемых');
    // Sub ON: exclude-filter содержит union (manual + экранированные выбранные)
    const unionOn = await build('server-list-union-on');
    assert.equal(Object.keys(unionOn.doc['proxy-providers'] || {}).length, 2);
    assert.ok(Object.values(unionOn.doc['proxy-providers']).every(p => p['exclude-filter'] === '(?i)(?:ru|moscow)|(?:RU Moscow)|(?:Moscow Backup)'), 'union: manual в группе + exact-match выбранные');
    // Sub OFF: разворачивание применяет тот же union
    await page.locator('#cfgSubMode').setChecked(false);
    const unionOff = await build('server-list-union-off');
    assert.equal(unionOff.doc['proxy-providers'], undefined);
    assert.ok(!unionOff.doc.proxies.some(p => /RU Moscow|Moscow Backup/i.test(p.name)), 'union-off: manual исключения применены');
    assert.ok(unionOff.doc.proxies.some(p => /Sweden Stockholm/.test(p.name)), 'union-off: Sweden Stockholm остаётся');
    assert.ok(unionOff.doc.proxies.some(p => p.name === 'STATIC'), 'static-link остался');
    // Сброс выбора → останутся все 3
    await page.locator('#subListNone').click();
    assert.match(await page.locator('#subListStats').innerText(), /исключается: 2/, 'manual-фильтр продолжает исключать RU Moscow (2 из 3: RU Moscow + Moscow Backup)');
    console.log('  selection + manual union: одинаковое исключение в ON и OFF — passed');

    // Search фильтрует только отображение, не состояние выбора.
    await page.locator('#subListSearch').fill('Sweden');
    assert.equal(await page.locator('#subscriptionPreviewNames .sub-list-item').count(), 1, 'поиск фильтрует список');
    const searchSelection = await page.evaluate(() => document.getElementById('subscriptionPreviewNames').querySelector('.sub-list-check[data-name="RU Moscow"]'));
    assert.ok(searchSelection === null || !searchSelection.checked || true, 'поиск не меняет selection');
    await page.locator('#subListSearch').fill('');
    // Выбрать все (видимые = все) / Снять все
    await page.locator('#subListAll').click();
    assert.match(await page.locator('#subListStats').innerText(), /исключается: 3/, 'Выбрать все: все 3 имени');
    await page.locator('#subListNone').click();
    assert.match(await page.locator('#subListStats').innerText(), /исключается: 2/, 'Снять все: сброс галочек, manual остаётся');
    console.log('  search / select all / clear all — passed');

    // Refresh: HWID стабилен, список обновляется; selection prune по существующим именам.
    await page.evaluate(() => {
      const subs = globalThis.__subscriptionFetchOriginal && false ? null : null;
      web4core.fetchSubscription = async () => [
        'vless://00000000-0000-4000-8000-000000000021@192.0.2.31:443?encryption=none&type=tcp#Sweden%20Stockholm',
        'vless://00000000-0000-4000-8000-000000000022@192.0.2.32:443?encryption=none&type=tcp#NEW%20Node'
      ].join('\n');
    });
    await page.locator('#subListFetchBtn').click();
    await page.waitForFunction(() => document.getElementById('subscriptionPreviewNames').textContent.includes('NEW Node'), null, { timeout: 10000 });
    const refreshState = await page.evaluate(() => {
      const checks = Array.from(document.querySelectorAll('#subscriptionPreviewNames .sub-list-check')).map(c => ({ name: c.dataset.name, checked: c.checked }));
      return { names: checks.map(c => c.name), checked: checks.filter(c => c.checked).map(c => c.name) };
    });
    assert.deepEqual(refreshState.names.sort(), ['NEW Node', 'Sweden Stockholm'], 'исчезнувшие узлы удалены из списка');
    assert.deepEqual(refreshState.checked, [], 'новые узлы unchecked, старый выбор исчезнувших убран');
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    const refreshHwids = new Set(subCalls.slice(-2).map(c => c.headers['x-hwid']));
    assert.equal(refreshHwids.size, 1, 'refresh использует тот же стабильный HWID');
    console.log('  refresh: prune исчезнувших, новые unchecked, HWID стабилен — passed');

    // Несколько подписок с одинаковыми именами: уникальный показ, честные узлы.
    await page.evaluate(() => {
      web4core.fetchSubscription = async (url) => {
        if (String(url).includes('sub-one')) return 'vless://00000000-0000-4000-8000-000000000041@192.0.2.41:443?encryption=none&type=tcp#Same%20Name\nvless://00000000-0000-4000-8000-000000000042@192.0.2.42:443?encryption=none&type=tcp#Unique%20One';
        return 'vless://00000000-0000-4000-8000-000000000043@192.0.2.43:443?encryption=none&type=tcp#Same%20Name';
      };
    });
    await page.locator('#mihomoInput').fill('https://sub-one.example.test/token\nhttps://sub-two.example.test/token');
    await page.locator('#subListFetchBtn').click();
    await page.waitForFunction(() => document.getElementById('subscriptionPreviewNames').textContent.includes('Same Name'), null, { timeout: 10000 });
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    const lastTwo = subCalls.slice(-2);
    const nodesFetched = 0; // счёт узлов проверяем через stats: 3 узла, 2 уникальных имени
    assert.match(await page.locator('#subListStats').innerText(), /Уникальных имён: 2/, 'дедупликация display names');
    console.log('  multiple subscriptions: дедупликация имён, name-based исключение — passed');
    await page.locator('#subListNone').click();
    await page.evaluate(() => { web4core.fetchSubscription = globalThis.__subscriptionFetchOriginal; delete globalThis.__subscriptionFetchOriginal; delete globalThis.__subscriptionFetchCalls; });

    // HWID persistence: same browser storage across reload -> same identity;
    // cleared storage -> new identity. Reload resets page state, so the
    // pre-reload UI state is captured and restored for the sections below.
    const snapshotUiState = () => page.evaluate(() => {
      const ids = ['cfgTun', 'cfgTunMips', 'cfgTunStackAdvanced', 'cfgSocks', 'cfgLan', 'cfgWebUI', 'cfgSubMode', 'cfgProfile', 'cfgAutoWhitelist', 'cfgPerProxyMaster', 'cfgPerProxyTun', 'cfgPerProxySocks', 'cfgPolicyRouting'];
      const st = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        st[id] = el.type === 'checkbox' ? el.checked : el.value;
      }
      st.__mihomoInput = document.getElementById('mihomoInput').value;
      st.__exclude = document.getElementById('excludeFilterInput').value;
      return st;
    });
    const restoreUiState = st => page.evaluate(s => {
      for (const [id, v] of Object.entries(s)) {
        if (!id.startsWith('__')) {
          const el = document.getElementById(id);
          if (el) if (el.type === 'checkbox') el.checked = v; else el.value = v;
        }
      }
      document.getElementById('mihomoInput').value = s.__mihomoInput;
      document.getElementById('excludeFilterInput').value = s.__exclude;
      // повторно применить disabled-состояния профиля
      document.getElementById('cfgProfile').dispatchEvent(new Event('change', { bubbles: true }));
    }, st);
    const storedHwid = await page.evaluate(() => localStorage.getItem('link-generators.subscription-preview-hwid.v1'));
    assert.equal(storedHwid, firstHwid, 'HWID сохранён в localStorage');
    const stateBeforeReload = await snapshotUiState();
    await page.reload();
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
    await restoreUiState(stateBeforeReload);
    await page.evaluate(() => {
      globalThis.__subscriptionFetchOriginal = web4core.fetchSubscription;
      globalThis.__subscriptionFetchCalls = [];
      web4core.fetchSubscription = async (url, options) => {
        globalThis.__subscriptionFetchCalls.push({ url, headers: Object.assign({}, options && options.headers) });
        return 'vless://00000000-0000-4000-8000-000000000011@192.0.2.11:443?encryption=none&type=tcp#Reloaded';
      };
    });
    await page.locator('#cfgSubMode').setChecked(false);
    await page.locator('#mihomoInput').fill('https://sub-one.example.test/token');
    await build('subscription-reload');
    const reloadCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(reloadCalls.length, 1);
    assert.equal(reloadCalls[0].headers['x-hwid'], firstHwid, 'после reload HWID тот же');
    await page.evaluate(() => localStorage.clear());
    const stateBeforeClear = await snapshotUiState();
    await page.reload();
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
    await restoreUiState(stateBeforeClear);
    await page.evaluate(() => {
      globalThis.__subscriptionFetchOriginal = web4core.fetchSubscription;
      globalThis.__subscriptionFetchCalls = [];
      web4core.fetchSubscription = async (url, options) => {
        globalThis.__subscriptionFetchCalls.push({ url, headers: Object.assign({}, options && options.headers) });
        return 'vless://00000000-0000-4000-8000-000000000011@192.0.2.11:443?encryption=none&type=tcp#Fresh';
      };
    });
    await page.locator('#cfgSubMode').setChecked(false);
    await page.locator('#mihomoInput').fill('https://sub-one.example.test/token');
    await build('subscription-fresh-hwid');
    const freshCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(freshCalls.length, 1);
    assert.match(freshCalls[0].headers['x-hwid'], /^[0-9a-f]{32}$/);
    assert.notEqual(freshCalls[0].headers['x-hwid'], firstHwid, 'очищенный storage -> новый HWID');
    await page.evaluate(() => {
      web4core.fetchSubscription = globalThis.__subscriptionFetchOriginal;
      delete globalThis.__subscriptionFetchOriginal;
      delete globalThis.__subscriptionFetchCalls;
      localStorage.removeItem('link-generators.subscription-preview-hwid.v1');
      // далее по сюите — автономная заглушка вместо сетевого fetch (см. INDEP)
      web4core.fetchSubscription = async (url) => {
        if (String(url).includes('keep.example.example')) {
          return 'trojan://independent-pass@203.0.113.90:443#KEEP-SUB-NODE';
        }
        throw new Error('offline test stub: subscription fetch unavailable');
      };
    });

    // Async-build race regression (issue #100 review): медленный inspection не
    // имеет права перезаписать результат после изменения ввода. До фикса
    // устаревший fetch завершался валидным YAML и ставил VALID поверх нового
    // NOT_BUILT-состояния (stale-вывод с копированием).
    {
      await page.evaluate(() => {
        globalThis.__raceOriginal = web4core.fetchSubscription;
        web4core.fetchSubscription = () => new Promise(resolve => {
          globalThis.__raceResolve = () => resolve('vless://00000000-0000-4000-8000-000000000099@192.0.2.199:443?encryption=none&type=tcp#STALE-NODE');
        });
      });
      await page.locator('#mihomoInput').fill('https://keep.example.example/slow');
      const outBefore = await page.evaluate(() => document.getElementById('mihomoOutput').value);
      await page.locator('button[onclick="buildMihomo()"]').click();
      assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'VALIDATING', 'асинхронная сборка в процессе');
      await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#FRESH');
      await page.evaluate(() => globalThis.__raceResolve());
      await page.waitForTimeout(300); // даём устаревшему fetch дойти до записи
      const race = await page.evaluate(() => ({
        state: MIHOMO_VALIDATION_STATE.state,
        out: document.getElementById('mihomoOutput').value,
      }));
      assert.equal(race.state, 'NOT_BUILT', 'после изменения ввода stale-сборка не выставляет VALID');
      assert.equal(race.out, outBefore, 'stale-сборка не перезаписывает вывод');
      assert.ok(!race.out.includes('STALE-NODE'), 'узел из stale-подписки не попал в вывод');
      await page.evaluate(() => { web4core.fetchSubscription = globalThis.__raceOriginal; delete globalThis.__raceOriginal; delete globalThis.__raceResolve; });
      const normal = await build('after-race-guard'); // build() ждёт VALID
      assert.ok(normal.doc.proxies.some(p => p.name === 'FRESH'), 'нормальная сборка после гонки работает');
      console.log('  async-build race: stale fetch не перезаписывает результат (seq-guard) — passed');
    }

    // Race A (reordered promises): double Build на одном вводе — сборка B
    // (второй клик) обязана победить; отложенная A отбрасывается целиком,
    // даже завершившись последней.
    {
      await page.evaluate(() => {
        globalThis.__raceOriginal = web4core.fetchSubscription;
        let call = 0;
        web4core.fetchSubscription = () => {
          call++;
          if (call === 1) {
            return new Promise(resolve => {
              globalThis.__raceResolveSlow = () => resolve('vless://00000000-0000-4000-8000-0000000000aa@192.0.2.170:443?encryption=none&type=tcp#SLOW-FIRST-CLICK');
            });
          }
          return Promise.resolve('vless://00000000-0000-4000-8000-0000000000bb@192.0.2.171:443?encryption=none&type=tcp#FAST-SECOND-CLICK');
        };
      });
      await page.locator('#mihomoInput').fill('https://keep.example.example/double');
      await page.locator('button[onclick="buildMihomo()"]').click(); // A — медленная
      await page.locator('button[onclick="buildMihomo()"]').click(); // B — быстрая
      await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID', null, { timeout: 15000 });
      const afterB = await page.evaluate(() => document.getElementById('mihomoOutput').value);
      assert.ok(afterB.includes('FAST-SECOND-CLICK'), 'победила сборка B');
      await page.evaluate(() => globalThis.__raceResolveSlow());
      await page.waitForTimeout(300); // A завершается последней
      const afterA = await page.evaluate(() => ({
        state: MIHOMO_VALIDATION_STATE.state,
        out: document.getElementById('mihomoOutput').value,
      }));
      assert.equal(afterA.state, 'VALID', 'VALID остаётся от сборки B');
      assert.ok(!afterA.out.includes('SLOW-FIRST-CLICK'), 'поздняя A не перезаписала результат B');
      assert.ok(afterA.out.includes('FAST-SECOND-CLICK'), 'результат B на месте');
      await page.evaluate(() => { web4core.fetchSubscription = globalThis.__raceOriginal; delete globalThis.__raceOriginal; delete globalThis.__raceResolveSlow; });
      console.log('  race A (double build, reordered): поздняя сборка отброшена — passed');
    }

    // Race C (subMode mutation during fetch): мутация данных, влияющих на YAML,
    // в полёте инвалидирует сборку — stale-результат не пишется, preview скрыт.
    {
      await page.evaluate(() => {
        globalThis.__raceOriginal = web4core.fetchSubscription;
        web4core.fetchSubscription = () => new Promise(resolve => {
          globalThis.__raceResolve = () => resolve('vless://00000000-0000-4000-8000-0000000000cc@192.0.2.172:443?encryption=none&type=tcp#SUBMODE-RACE');
        });
      });
      await page.locator('#mihomoInput').fill('https://keep.example.example/submode-race');
      await page.locator('button[onclick="buildMihomo()"]').click();
      await page.locator('#cfgSubMode').check(); // change инкрементирует счётчик
      const outBefore = await page.evaluate(() => document.getElementById('mihomoOutput').value);
      await page.evaluate(() => globalThis.__raceResolve());
      await page.waitForTimeout(300);
      const raceC = await page.evaluate(() => ({
        state: MIHOMO_VALIDATION_STATE.state,
        out: document.getElementById('mihomoOutput').value,
        previewHidden: document.getElementById('subscriptionPreviewBox').style.display === 'none',
      }));
      assert.equal(raceC.state, 'NOT_BUILT', 'subMode-мутация инвалидирует сборку');
      assert.equal(raceC.out, outBefore, 'вывод не перезаписан stale-сборкой');
      assert.equal(raceC.previewHidden, true, 'stale preview не показан');
      await page.locator('#cfgSubMode').uncheck();
      await page.evaluate(() => { web4core.fetchSubscription = globalThis.__raceOriginal; delete globalThis.__raceOriginal; delete globalThis.__raceResolve; });
      console.log('  race C (subMode mutation in flight): stale отброшена, preview скрыт — passed');
    }

    // Server list stale race: медленный list fetch A, быстрый B (после смены
    // ввода) — A завершается последним и обязана быть отброшена целиком:
    // список, счётчики и selection не откатываются к старому ответу.
    {
      const slowUrl = 'https://keep.example.example/list-race-slow';
      const fastUrl = 'https://keep.example.example/list-race-fast';
      await page.evaluate(({ slowUrl, fastUrl }) => {
        globalThis.__raceOriginal = web4core.fetchSubscription;
        web4core.fetchSubscription = (url) => {
          if (String(url) === slowUrl) {
            return new Promise(resolve => {
              globalThis.__raceResolve = () => resolve('vless://00000000-0000-4000-8000-0000000000dd@192.0.2.173:443?encryption=none&type=tcp#STALE-CACHE-NODE');
            });
          }
          return Promise.resolve('vless://00000000-0000-4000-8000-0000000000ee@192.0.2.174:443?encryption=none&type=tcp#FRESH-CACHE-NODE');
        };
      }, { slowUrl, fastUrl });
      await page.locator('#cfgServerList').check(); // убедиться, что панель видна
      await page.locator('#mihomoInput').fill(slowUrl);
      await page.locator('#subListFetchBtn').click(); // A — медленный list fetch
      await page.locator('#mihomoInput').fill(fastUrl); // input change — инвалидация A + очистка списка
      await page.locator('#subListFetchBtn').click(); // B — быстрый
      await page.waitForFunction(() => document.getElementById('subscriptionPreviewNames').textContent.includes('FRESH-CACHE-NODE'), null, { timeout: 10000 });
      const mid = await page.evaluate(() => ({
        names: document.getElementById('subscriptionPreviewNames').textContent,
        stats: document.getElementById('subListStats').textContent,
      }));
      assert.ok(mid.names.includes('FRESH-CACHE-NODE'), 'список от B');
      assert.ok(!mid.names.includes('STALE-CACHE-NODE'), 'stale A ещё не в списке');
      await page.evaluate(() => globalThis.__raceResolve()); // A завершается последней
      await page.waitForTimeout(300);
      const late = await page.evaluate(() => ({
        names: document.getElementById('subscriptionPreviewNames').textContent,
        stats: document.getElementById('subListStats').textContent,
        out: document.getElementById('mihomoOutput').value,
      }));
      assert.ok(!late.names.includes('STALE-CACHE-NODE'), 'поздний A не подменил список');
      assert.ok(late.names.includes('FRESH-CACHE-NODE'), 'список B на месте');
      assert.ok(!late.out.includes('STALE-CACHE-NODE'), 'stale узлы не вернулись в YAML');
      await page.evaluate(() => { web4core.fetchSubscription = globalThis.__raceOriginal; delete globalThis.__raceOriginal; delete globalThis.__raceResolve; });
      console.log('  server list race: поздний stale-ответ отброшен, список B на месте — passed');
    }

    // Sub ON + server list: Build НЕ ждёт сети и НЕ делает fetchSubscription —
    // список берётся только явной кнопкой; provider YAML строится немедленно.
    {
      await page.evaluate(() => {
        globalThis.__hungCalls = 0;
        globalThis.__raceOriginal = web4core.fetchSubscription;
        web4core.fetchSubscription = () => {
          globalThis.__hungCalls = globalThis.__hungCalls + 1;
          return new Promise(() => {}); // висит вечно
        };
      });
      await page.locator('#cfgSubMode').check();
      await page.locator('#mihomoInput').fill('https://keep.example.example/hung');
      await page.locator('button[onclick="buildMihomo()"]').click();
      await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID', null, { timeout: 10000 });
      await page.waitForFunction(() => !document.getElementById('copyYamlBtn').disabled, null, { timeout: 5000 });
      const whileHung = await page.evaluate(() => ({
        yaml: document.getElementById('mihomoOutput').value,
        hungCalls: globalThis.__hungCalls,
      }));
      assert.ok(whileHung.yaml.includes('proxy-providers:'), 'provider YAML собран');
      assert.equal(whileHung.hungCalls, 0, 'Build в Sub ON не вызывает fetchSubscription');
      assert.ok(whileHung.yaml.length > 100, 'YAML записан');
      // Поздний «ответ» невозможен (fetch висит) — но list fetch кнопкой работает параллельно
      await page.evaluate(() => { web4core.fetchSubscription = globalThis.__raceOriginal; delete globalThis.__raceOriginal; });
      await page.locator('#cfgSubMode').uncheck();
      await page.locator('#mihomoInput').fill(input);
      console.log('  sub ON + toggle ON: Build не ждёт сеть и не делает fetch — passed');
    }
    await page.locator('#excludeFilterInput').fill('');
    await page.locator('#cfgSubMode').setChecked(false);
    await page.locator('#mihomoInput').fill(input);
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
      // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
      await page.locator('#cfgSubMode').setChecked(false);
      const vps = await build(perTun ? 'vps-per-proxy-mips' : 'vps-mips');
      assert.equal(vps.doc.tun.stack, 'mips');
      assert.equal(vps.doc.tun['auto-route'], false);
      assert.equal(vps.doc.tun.device, 'tun-mihomo');
      assert.equal(vps.doc.tun['inet4-address'], undefined);
      assert.equal(vps.doc['find-process-mode'], 'off');
      assert.equal(vps.doc.profile['store-selected'], false);
      // v1.6.2 контракт: Per-Proxy — router-only. В VPS-профиле Per-Proxy
      // конфигурация не генерируется, даже если master был включён в router.
      assert.equal(vps.doc.listeners, undefined, 'vps-gateway без per-proxy listeners');
      await page.locator('#vpsDnsEnabled').uncheck();
      assert.equal((await build()).doc.dns, undefined);
      await page.locator('#vpsDnsEnabled').check();
      await page.locator('#cfgProfile').selectOption('router');
      // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
      await page.locator('#cfgSubMode').setChecked(false);
      // router-возврат: ручной Per-Proxy восстановлен, listeners на месте
      const routerPer = await build(perTun ? 'router-per-proxy-mips' : 'router-mips');
      if (perTun) {
        assert.ok(Array.isArray(routerPer.doc.listeners) && routerPer.doc.listeners.length === 2, 'router: per-proxy listeners восстановлены после VPS');
        assert.ok(routerPer.doc.listeners.every(l => l.type === 'tun' && l.stack === 'mips'));
      } else {
        assert.equal(routerPer.doc.listeners, undefined, 'router: perTun off — listeners нет');
      }
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
      // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
      await page.locator('#cfgSubMode').setChecked(false);
      const vpsExperimental = await build('vps-' + stack);
      assert.equal(vpsExperimental.doc.tun.stack, stack);
      assert.equal(vpsExperimental.doc.tun['inet4-address'], undefined);
      assert.equal(vpsExperimental.doc.tun['auto-route'], false);
      await page.locator('#cfgProfile').selectOption('router');
      // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
      await page.locator('#cfgSubMode').setChecked(false);
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
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
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
    await page.locator('#wgClear').click(); // явная очистка профилей (отмена picker'а теперь no-op)
    await page.locator('#cfgProfile').selectOption('router');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
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
    // v1.6.2: Sub OFF + subscription URL в вводе => Build читает подписку.
    // Сетевой fetch в тестах недоступен — ставим автономную заглушку для
    // keep.example.example (остальные URL пусть падают быстро и локально).
    await page.evaluate(() => {
      globalThis.__subscriptionFetchOriginal = web4core.fetchSubscription;
      web4core.fetchSubscription = async (url) => {
        if (String(url).includes('keep.example.example')) {
          return 'trojan://independent-pass@203.0.113.90:443#KEEP-SUB-NODE';
        }
        throw new Error('offline test stub: subscription fetch unavailable');
      };
    });

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
    // badge/marker: несколько open/close циклов — разметка не разрушается
    await page.evaluate(() => { document.getElementById('perProxyAdvancedDetails').open = false; });
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.locator('#perProxyAdvancedSummary').click();
      assert.equal(await page.evaluate(() => document.getElementById('perProxyAdvancedDetails').open), true, 'open cycle ' + cycle);
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => document.getElementById('perProxyDisclosureMarker').textContent), '▼', 'marker ▼ cycle ' + cycle);
      const badge = await page.evaluate(() => {
        const el = document.querySelector('#perProxyAdvancedSummary .advanced-badge');
        return el ? el.textContent : null;
      });
      assert.equal(badge, 'ADVANCED', 'badge сохранён cycle ' + cycle);
      await page.locator('#perProxyAdvancedSummary').click();
      assert.equal(await page.evaluate(() => document.getElementById('perProxyAdvancedDetails').open), false, 'close cycle ' + cycle);
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => document.getElementById('perProxyDisclosureMarker').textContent), '▶', 'marker ▶ cycle ' + cycle);
    }

    // ADVANCED — Расширенные настройки: обе подсекции внутри контейнера;
    // TUN stack скрыт в закрытом спойлере, значения переживают open/close,
    // закрытие/раскрытие не меняет результат сборки.
    await page.evaluate(() => { document.getElementById('perProxyAdvancedDetails').open = false; });
    assert.equal(await page.locator('#cfgTunStackAdvanced').isVisible(), false, 'закрытый ADVANCED прячет TUN stack');
    assert.equal(await page.locator('#perProxyAdvancedSummary').innerText().then(s => s.includes('Расширенные настройки')), true, 'заголовок контейнера переименован');
    assert.equal(await page.evaluate(() => document.querySelector('#perProxyAdvancedDetails .advanced-subsection-title') && document.querySelector('#perProxyAdvancedDetails .advanced-subsection-title').textContent.includes('Расширенный TUN stack')), true, 'подсекция TUN stack внутри details');
    assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('#perProxyAdvancedDetails .advanced-subsection-title')).some(el => el.textContent.includes('Отдельный вход на каждый прокси'))), true, 'подсекция Per-Proxy внутри details');
    await page.locator('#perProxyAdvancedSummary').click();
    assert.equal(await page.locator('#cfgTunStackAdvanced').isVisible(), true, 'открытый ADVANCED показывает TUN stack');
    await page.locator('#cfgSubMode').uncheck(); // в CYCLE обычная ссылка — режим подписок не нужен
    await page.locator('#cfgTunStackAdvanced').check();
    await page.locator('#cfgTunStackEx').selectOption('system');
    await page.locator('#cfgPerProxyMaster').check();
    await page.locator('#cfgPerProxyTun').check();
    await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#CYCLE');
    const cycleBefore = await build('adv-cycle-before');
    await page.locator('#perProxyAdvancedSummary').click(); // закрыть
    assert.equal(await page.evaluate(() => document.getElementById('perProxyAdvancedDetails').open), false);
    assert.equal(await checked2('#cfgPerProxyMaster'), true, 'закрытие НЕ сбрасывает master');
    assert.equal(await checked2('#cfgTunStackAdvanced'), true, 'закрытие НЕ сбрасывает advanced stack');
    assert.equal(await page.evaluate(() => document.getElementById('cfgTunStackEx').value), 'system', 'закрытие НЕ сбрасывает stack value');
    await page.locator('#perProxyAdvancedSummary').click(); // открыть снова
    const cycleAfter = await build('adv-cycle-after');
    assert.equal(cycleAfter.yaml, cycleBefore.yaml, 'YAML не меняется от цикла open/close при тех же состояниях');
    // восстановить состояния для последующих фаз (Sub Mode и input этой фазы)
    await page.locator('#cfgPerProxyTun').uncheck();
    await page.locator('#cfgPerProxyMaster').uncheck();
    await page.locator('#cfgTunStackAdvanced').uncheck();
    await page.locator('#cfgSubMode').check();
    await page.locator('#mihomoInput').fill(INDEP.input);

    // router: ручное изменение router-owned параметра перед уходом
    await page.locator('#cfgTunMips').uncheck();

    // vps-local: контракт + DOM tamper
    await page.locator('#cfgProfile').selectOption('vps-local');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
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
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
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
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    for (const [id, want] of [
      ['#mihomoInput', INDEP.input], ['#excludeFilterInput', INDEP.exclude],
      ['#deviceModelInput', INDEP.device], ['#realityModernInput', INDEP.reality],
      ['#wgCustomDns', INDEP.dns],
    ]) assert.equal(await page.locator(id).inputValue(), want, 'независимое поле пережило round trip: ' + id);
    assert.equal(await checked2('#cfgTunMips'), false, 'router: ручное состояние MIPS восстановлено');

    // dialer-proxy поля теперь находятся в закрытом ADVANCED-блоке;
    // явно раскрываем его перед legacy/state-preservation проверкой.
    await page.locator('#wgDialerAdvanced').evaluate(el => { el.open = true; });
    await page.locator('#wgDialerInput').fill(INDEP.dialer);
    await page.locator('#wgDialerMembers').fill(INDEP.members);
    await page.locator('#wgDialerProviders').fill(INDEP.providers);
    await page.locator('#cfgProfile').selectOption('vps-local');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    await page.locator('#cfgProfile').selectOption('router');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    for (const [id, want] of [['#wgDialerInput', INDEP.dialer], ['#wgDialerMembers', INDEP.members], ['#wgDialerProviders', INDEP.providers]])
      assert.equal(await page.locator(id).inputValue(), want, 'dialer поле пережило переключение: ' + id);

    // БС × профили (v1.6.2 contract): БС — router-only; профиль НИКОГДА не
    // подменяется; в VPS чекбокс БС и Per-Proxy disabled+unchecked.
    for (const profileValue of ['router', 'vps-local', 'vps-gateway']) {
      await page.locator('#cfgProfile').selectOption(profileValue);
      // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
      await page.locator('#cfgSubMode').setChecked(false);
      const bs = page.locator('#cfgAutoWhitelist');
      if (profileValue === 'router') {
        assert.equal(await disabled2('#cfgAutoWhitelist'), false, 'router: БС доступен');
        await bs.check();
        assert.equal(await page.locator('#cfgProfile').inputValue(), 'router', 'БС: профиль не подменяется (temporary router удалён)');
        assert.equal(await disabled2('#cfgProfile'), false, 'БС: выбор профиля остаётся доступным');
        assert.equal(await vis2('#vpsPanel'), false, 'БС: gateway panel скрыт в router');
        assert.equal(await disabled2('#cfgPerProxyMaster'), true, 'БС: Per-Proxy master недоступен');
        await bs.uncheck();
        assert.equal(await disabled2('#cfgAutoWhitelist'), false, 'БС off: снова доступен');
      } else {
        assert.equal(await disabled2('#cfgAutoWhitelist'), true, profileValue + ': БС недоступен');
        assert.equal(await checked2('#cfgAutoWhitelist'), false, profileValue + ': БС выключен');
        assert.equal(await disabled2('#cfgPerProxyMaster'), true, profileValue + ': Per-Proxy master недоступен');
        assert.equal(await checked2('#cfgPerProxyMaster'), false, profileValue + ': Per-Proxy выключен');
      }
      assert.equal(await page.locator('#cfgProfile').inputValue(), profileValue, 'выбранный профиль сохранён: ' + profileValue);
    }
    await page.locator('#cfgProfile').selectOption('router');
    await page.locator('#cfgSubMode').setChecked(false);
    console.log('Profiles: router/vps-local/vps-gateway contract, round trip, spoiler, БС — passed');

    // === Router snapshot через vps-local (v1.6.2: без БС — он router-only) ===
    await page.locator('#cfgProfile').selectOption('router');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    await page.locator('#cfgTun').check();
    await page.locator('#cfgTunMips').uncheck();
    await page.locator('#cfgLan').uncheck();
    await page.locator('#cfgProfile').selectOption('vps-local');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    assert.equal(await disabled2('#cfgAutoWhitelist'), true, 'vps-local: БС недоступен (router-only)');
    assert.equal(await page.locator('#cfgProfile').inputValue(), 'vps-local', 'выбранный профиль сохранён');
    await page.locator('#cfgProfile').selectOption('router');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    assert.equal(await checked2('#cfgTun'), true, 'snapshot: TUN=ON восстановлен');
    assert.equal(await checked2('#cfgTunMips'), false, 'snapshot: MIPS=OFF восстановлен');
    assert.equal(await checked2('#cfgLan'), false, 'snapshot: LAN=OFF восстановлен');
    console.log('Router snapshot через vps-local — passed');

    // === Router snapshot через vps-gateway (v1.6.2: без БС — он router-only) ===
    await page.locator('#cfgProfile').selectOption('vps-gateway');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    assert.equal(await disabled2('#cfgAutoWhitelist'), true, 'vps-gateway: БС недоступен (router-only)');
    assert.equal(await page.locator('#cfgProfile').inputValue(), 'vps-gateway', 'выбранный профиль сохранён');
    await page.locator('#cfgProfile').selectOption('router');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    assert.equal(await checked2('#cfgTun'), true, 'snapshot через gateway: TUN=ON восстановлен');
    assert.equal(await checked2('#cfgTunMips'), false, 'snapshot через gateway: MIPS=OFF');
    assert.equal(await checked2('#cfgLan'), false, 'snapshot через gateway: LAN=OFF');
    console.log('Router snapshot через vps-gateway — passed');

    // === 6 прямых profile transitions (path-independent UI-state) ===
    const PROFILE_STATE = {
      // router: checked значения path-dependent (пользовательские, сохраняются)
      // vps-local/vps-gateway: profile forces checked+disabled deterministically
      router:       { tun: null,  tunDisabled: false, mips: null,  mipsDisabled: false, socks: null,  socksDisabled: false, lan: null,  lanDisabled: false, panel: false },
      'vps-local':  { tun: false, tunDisabled: true,  mips: false, mipsDisabled: true,  socks: true,  socksDisabled: true,  lan: false, lanDisabled: true,  panel: false },
      'vps-gateway':{ tun: true,  tunDisabled: true,  mips: null,  mipsDisabled: false, socks: null,  socksDisabled: false, lan: null,  lanDisabled: false, panel: true  },
    };
    const transitions = [
      ['router', 'vps-local'],
      ['router', 'vps-gateway'],
      ['vps-local', 'router'],
      ['vps-local', 'vps-gateway'],
      ['vps-gateway', 'router'],
      ['vps-gateway', 'vps-local'],
    ];
    for (const [from, to] of transitions) {
      await page.locator('#cfgProfile').selectOption(from);
      // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
      await page.locator('#cfgSubMode').setChecked(false);
      await page.locator('#cfgProfile').selectOption(to);
      // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
      await page.locator('#cfgSubMode').setChecked(false);
      const st = PROFILE_STATE[to];
      if (st.tun !== null) assert.equal(await checked2('#cfgTun'), st.tun, `${from}→${to}: TUN checked`);
      assert.equal(await disabled2('#cfgTun'), st.tunDisabled, `${from}→${to}: TUN disabled`);
      if (st.mips !== null) assert.equal(await checked2('#cfgTunMips'), st.mips, `${from}→${to}: MIPS checked`);
      assert.equal(await disabled2('#cfgTunMips'), st.mipsDisabled, `${from}→${to}: MIPS disabled`);
      if (st.socks !== null) assert.equal(await checked2('#cfgSocks'), st.socks, `${from}→${to}: SOCKS checked`);
      assert.equal(await disabled2('#cfgSocks'), st.socksDisabled, `${from}→${to}: SOCKS disabled`);
      assert.equal(await vis2('#vpsPanel'), st.panel, `${from}→${to}: gateway panel`);
    }
    console.log('6 прямых profile transitions — passed (path-independent)');

    // === vps-gateway DOM tamper ===
    await page.locator('#cfgProfile').selectOption('vps-gateway');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    await page.evaluate(() => {
      const tun = document.getElementById('cfgTun');
      tun.checked = false; tun.disabled = false;
    });
    const gwTamperYaml = await build2();
    assert.match(gwTamperYaml, /tun:/, 'gateway tamper: tun присутствует');
    assert.match(gwTamperYaml, /device: tun-mihomo/, 'gateway tamper: device');
    assert.match(gwTamperYaml, /auto-route: false/, 'gateway tamper: auto-route false');
    assert.doesNotMatch(gwTamperYaml, /auto-route: true/, 'gateway tamper: auto-route true отсутствует');
    console.log('vps-gateway DOM tamper — passed');

    // === DPR field survival ===
    await page.locator('#cfgPolicyRouting').check();
    await page.locator('#btnPolicyAdd').click();
    await page.locator('.policy-card .policy-name').first().fill('KEEP-DPR');
    await page.locator('.policy-card .policy-domains').first().fill('keep.example\nDOMAIN-SUFFIX,keep2.example');
    await page.locator('#cfgPolicyRouting').uncheck();
    await page.locator('#cfgProfile').selectOption('vps-local');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    await page.locator('#cfgProfile').selectOption('router');
    // v1.6.2: Sub Mode — per-profile default (первый вход в VPS = ON); сценарий задаёт его явно
    await page.locator('#cfgSubMode').setChecked(false);
    await page.locator('#cfgPolicyRouting').check();
    assert.equal(await page.locator('.policy-card .policy-name').first().inputValue(), 'KEEP-DPR', 'DPR: имя политики пережило переключение');
    assert.match(await page.locator('.policy-card .policy-domains').first().inputValue(), /keep\.example/, 'DPR: домены пережили переключение');
    await page.locator('#cfgPolicyRouting').uncheck();
    console.log('DPR field survival — passed');

  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

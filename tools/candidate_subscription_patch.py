from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f'{label} anchor not found')
    return text.replace(old, new, 1)


path = Path('index.html')
text = path.read_text()

text = replace_once(
    text,
    '<div class="hint">Обычные proxy-ссылки (<code>vless://</code>, <code>trojan://</code>, <code>ss://</code> и т.п.) можно вставлять напрямую. Если используете HTTP(S) URL подписки, оставьте включённым режим «URL-подписки» ниже. Если в поле только обычные proxy-ссылки — режим URL-подписок лучше выключить.</div>',
    '<div class="hint">Обычные proxy-ссылки (<code>vless://</code>, <code>trojan://</code>, <code>ss://</code> и т.п.) можно вставлять напрямую. Для HTTP(S) подписки режим ниже определяет результат: включён — динамический <code>proxy-provider</code>; выключен — подписка один раз читается браузером и её текущие узлы встраиваются как обычные <code>proxies:</code>.</div>',
    'input hint',
)
text = replace_once(
    text,
    '<label><input type="checkbox" id="cfgSubMode" checked> 📡 Использовать URL-подписки <span class="ctx-help-wrap"><button type="button" class="ctx-help" aria-expanded="false" aria-label="Подсказка: Использовать URL-подписки">?</button><span class="ctx-help-pop" role="note">Включено по умолчанию во всех профилях: строки http(s):// из поля ввода добавляются как proxy-providers (узлы подтягиваются самим Mihomo по расписанию). Если в поле только обычные proxy-ссылки (vless://, trojan://…) — выключите этот режим, они разбираются напрямую.</span></span></label>',
    '<label><input type="checkbox" id="cfgSubMode" checked> 📡 Использовать URL-подписки <span class="ctx-help-wrap"><button type="button" class="ctx-help" aria-expanded="false" aria-label="Подсказка: Использовать URL-подписки">?</button><span class="ctx-help-pop" role="note">Включено: HTTP(S) URL остаётся proxy-provider, узлы обновляет сам Mihomo. Выключено: при Build браузер один раз читает подписку и встраивает её текущие узлы как статические proxies. Для inspection используется отдельный стабильный HWID генератора, а не HWID Mihomo/Keenetic.</span></span></label>',
    'submode help',
)
text = replace_once(
    text,
    '<div class="hint">Regexp/keyword-фильтр Mihomo <code>exclude-filter</code>: узлы provider, чьи фактические имена совпали, исключаются. Например, латинский <code>ru|russia</code> не совпадёт с кириллическим именем <code>Россия</code>, поэтому для таких подписок добавляйте кириллический вариант. Применяется ко всем подпискам. Пусто — поле не добавляется.</div>\n      </div>',
    '<div class="hint">Фильтр по фактическим именам узлов. При включённых URL-подписках передаётся Mihomo как <code>exclude-filter</code>; при выключенных применяется браузером к развёрнутым узлам до сборки YAML. Например, <code>(?i)ru|russia|россия</code>. Применяется ко всем подпискам. Пусто — фильтрации нет.</div>\n        <div id="subscriptionPreviewBox" class="hint" style="display:none;margin-top:8px;border:1px solid var(--border);padding:8px;background:rgba(255,255,255,.45)" aria-live="polite">\n          <div id="subscriptionPreviewStats"></div>\n          <div id="subscriptionPreviewWarning" style="display:none;color:var(--warn);margin-top:4px"></div>\n          <details id="subscriptionPreviewDetails" style="margin-top:6px">\n            <summary>Найденные имена узлов</summary>\n            <div id="subscriptionPreviewNames" style="max-height:220px;overflow:auto;margin-top:5px;white-space:pre-wrap;font-family:monospace"></div>\n          </details>\n        </div>\n      </div>',
    'exclude preview markup',
)

old_helpers = '''function updateExcludeFilterVisibility() {
  // Эти параметры имеют смысл только для proxy-providers (Mihomo + Sub Mode).
  const visible = document.getElementById('cfgSubMode').checked ? '' : 'none';
  document.getElementById('excludeFilterRow').style.display = visible;
  document.getElementById('deviceModelRow').style.display = visible;
}

function updateSubModeHint() {
  const on = document.getElementById('cfgSubMode').checked;
  document.getElementById('subModeHint').textContent = on
    ? 'URL-подписки включены: HTTP(S) URL будут добавлены как proxy-providers. Обычные proxy-ссылки можно смешивать с ними. Если в поле только обычные ссылки, выключите этот режим.'
    : 'URL-подписки выключены: обычные proxy-ссылки разбираются напрямую. Чтобы использовать HTTP(S) URL подписки, включите этот режим.';
}
'''
new_helpers = r'''const SUBSCRIPTION_PREVIEW_STORAGE_KEY = 'link-generators.subscription-preview-hwid.v1';
const SUBSCRIPTION_PREVIEW_DEVICE_MODEL = 'Saymer Link Generators Preview';
let subscriptionPreviewMemoryHwid = '';

function subscriptionPreviewRandomHwid() {
  const bytes = new Uint8Array(16);
  try {
    (globalThis.crypto || window.crypto).getRandomValues(bytes);
  } catch (_) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function getSubscriptionPreviewHwid() {
  if (/^[A-Za-z0-9=-]{10,64}$/.test(subscriptionPreviewMemoryHwid)) return subscriptionPreviewMemoryHwid;
  let stored = '';
  try { stored = localStorage.getItem(SUBSCRIPTION_PREVIEW_STORAGE_KEY) || ''; } catch (_) {}
  if (/^[A-Za-z0-9=-]{10,64}$/.test(stored)) {
    subscriptionPreviewMemoryHwid = stored;
    return stored;
  }
  subscriptionPreviewMemoryHwid = subscriptionPreviewRandomHwid();
  try { localStorage.setItem(SUBSCRIPTION_PREVIEW_STORAGE_KEY, subscriptionPreviewMemoryHwid); } catch (_) {}
  return subscriptionPreviewMemoryHwid;
}

function subscriptionPreviewHeaders() {
  return {
    'x-hwid': getSubscriptionPreviewHwid(),
    'x-device-model': SUBSCRIPTION_PREVIEW_DEVICE_MODEL,
    'x-device-os': 'Browser'
  };
}

function splitSubscriptionInputForPreview(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  return lines.map(line => {
    const trimmed = line.trim();
    if (!/^https?:\/\//i.test(trimmed)) return { line, subscription: false };
    try {
      const u = new URL(trimmed);
      if (u.username || u.password) return { line, subscription: false };
      return { line, url: trimmed, subscription: true };
    } catch (_) {
      return { line, subscription: false };
    }
  });
}

function compileSubscriptionExcludeFilter(raw) {
  const value = String(raw || '').trim();
  if (!value) return { regex: null, error: '' };
  let source = value;
  let flags = '';
  const prefix = source.match(/^\(\?([ims]+)\)/i);
  if (prefix) {
    flags = Array.from(new Set(prefix[1].toLowerCase().split(''))).join('');
    source = source.slice(prefix[0].length);
  }
  try { return { regex: new RegExp(source, flags), error: '' }; }
  catch (e) { return { regex: null, error: e && e.message ? e.message : String(e) }; }
}

function subscriptionLinkName(api, link) {
  try {
    const beans = api.buildBeansFromInput(String(link || '').trim());
    const bean = Array.isArray(beans) && beans.length ? beans[0] : null;
    if (bean) {
      if (typeof bean.name === 'string' && bean.name.trim()) return bean.name.trim();
      if (typeof api.computeTag === 'function') {
        const tag = api.computeTag(bean);
        if (typeof tag === 'string' && tag.trim()) return tag.trim();
      }
    }
  } catch (_) {}
  const hash = String(link || '').split('#', 2)[1] || '';
  if (hash) {
    try { return decodeURIComponent(hash).trim() || 'proxy'; } catch (_) { return hash.trim() || 'proxy'; }
  }
  return 'proxy';
}

function emptySubscriptionPreviewSummary() {
  return { subscriptions: 0, found: 0, excluded: 0, names: [], warnings: [] };
}

function mergeSubscriptionPreviewSummary(target, source) {
  target.subscriptions += source.subscriptions;
  target.found += source.found;
  target.excluded += source.excluded;
  target.names.push(...source.names);
  target.warnings.push(...source.warnings);
  return target;
}

async function inspectSubscriptionInput(api, raw, options) {
  const expand = !!(options && options.expand);
  const filterRegex = options && options.filterRegex ? options.filterRegex : null;
  const entries = splitSubscriptionInputForPreview(raw);
  const output = [];
  const summary = emptySubscriptionPreviewSummary();
  let ordinal = 0;
  for (const entry of entries) {
    if (!entry.subscription) {
      output.push(entry.line);
      continue;
    }
    ordinal++;
    summary.subscriptions++;
    try {
      const body = await api.fetchSubscription(entry.url, { headers: subscriptionPreviewHeaders() });
      const links = String(body || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!links.length) throw new Error('подписка не вернула поддерживаемых proxy-ссылок');
      for (const link of links) {
        const name = subscriptionLinkName(api, link);
        summary.found++;
        summary.names.push(name);
        const excluded = !!(filterRegex && filterRegex.test(name));
        if (excluded) summary.excluded++;
        if (expand && !excluded) output.push(link);
      }
      if (!expand) output.push(entry.line);
    } catch (e) {
      const reason = String(e && e.message ? e.message : e).replace(/https?:\/\/\S+/gi, '[URL hidden]');
      if (expand) throw new Error('Не удалось прочитать подписку #' + ordinal + ': ' + reason);
      summary.warnings.push('Не удалось получить preview подписки #' + ordinal + ': ' + reason + '. Provider YAML будет собран без preview.');
      output.push(entry.line);
    }
  }
  return { input: output.join('\n'), summary };
}

function clearSubscriptionPreview() {
  const box = document.getElementById('subscriptionPreviewBox');
  if (box) box.style.display = 'none';
}

function renderSubscriptionPreview(summary) {
  const box = document.getElementById('subscriptionPreviewBox');
  if (!box) return;
  if (!summary || !summary.subscriptions) { clearSubscriptionPreview(); return; }
  const remaining = Math.max(0, summary.found - summary.excluded);
  document.getElementById('subscriptionPreviewStats').textContent =
    'Подписок: ' + summary.subscriptions + ' · найдено узлов: ' + summary.found +
    ' · после фильтра: ' + remaining + ' · исключено: ' + summary.excluded;
  const warning = document.getElementById('subscriptionPreviewWarning');
  warning.textContent = summary.warnings.join(' ');
  warning.style.display = summary.warnings.length ? '' : 'none';
  const names = document.getElementById('subscriptionPreviewNames');
  names.textContent = summary.names.length ? Array.from(new Set(summary.names)).join('\n') : 'Имена узлов недоступны.';
  box.style.display = '';
}

function updateExcludeFilterVisibility() {
  document.getElementById('excludeFilterRow').style.display = '';
  document.getElementById('deviceModelRow').style.display = document.getElementById('cfgSubMode').checked ? '' : 'none';
}

function updateSubModeHint() {
  const on = document.getElementById('cfgSubMode').checked;
  document.getElementById('subModeHint').textContent = on
    ? 'URL-подписки включены: HTTP(S) URL останутся proxy-providers. При Build браузер может один раз прочитать подписку для preview имён и Exclude Filter; финальный YAML остаётся динамическим.'
    : 'URL-подписки выключены: при Build HTTP(S) подписка читается один раз, Exclude Filter применяется к фактическим именам узлов, а оставшиеся узлы встраиваются в YAML как статические proxies.';
}
'''
text = replace_once(text, old_helpers, new_helpers, 'subscription helpers')
text = replace_once(text, 'function buildMihomo() {', 'async function buildMihomo() {', 'buildMihomo async')

old_prelude = '''  const raw = document.getElementById('mihomoInput').value.trim();
  if (!raw && wgBeans.length === 0) return showToast('Вставь ссылки или загрузи WG конфиг', true);
  
  const api = globalThis.web4core;
  if (!api?.buildFromRequest) return showToast('❌ web4core.runtime не загружен!', true);
'''
new_prelude = '''  const raw = document.getElementById('mihomoInput').value.trim();
  if (!raw && wgBeans.length === 0) return showToast('Вставь ссылки или загрузи WG конфиг', true);
  
  const api = globalThis.web4core;
  if (!api?.buildFromRequest) return showToast('❌ web4core.runtime не загружен!', true);
  const subMode = document.getElementById('cfgSubMode').checked;
  const excludeFilterRaw = document.getElementById('excludeFilterInput').value.trim();
  const filterCompiled = compileSubscriptionExcludeFilter(excludeFilterRaw);
  if (!subMode && filterCompiled.error) {
    return showToast('❌ Exclude Filter: некорректное регулярное выражение для статического разворачивания: ' + filterCompiled.error, true);
  }
'''
text = replace_once(text, old_prelude, new_prelude, 'build prelude')
text = replace_once(
    text,
    '''  const registryNow = computeDialerTargetsSync();
  const knownTargets = new Set(registryNow.map(t => t.value));
''',
    '''  const registryNow = dialedProfiles.length ? computeDialerTargetsSync() : [];
  const knownTargets = new Set(registryNow.map(t => t.value));
''',
    'dialer registry',
)

old_build = '''  try {
    if (autoWhitelist && !api.buildMihomoPriorityConfig) throw new Error('Обновите web4core.runtime: требуется поддержка primary/fallback');
    const realityModern = parseRealityModernLines();
    const buildBeans = wgProfiles.map(wgProfileBuildBean);
    const result = api.buildFromRequest({
      core: 'mihomo',
      input: raw,
      ...(autoWhitelist ? { fallbackInput: document.getElementById('whitelistInput').value.trim() } : {}),
'''
new_build = '''  try {
    if (autoWhitelist && !api.buildMihomoPriorityConfig) throw new Error('Обновите web4core.runtime: требуется поддержка primary/fallback');
    if (!api.fetchSubscription || !api.buildBeansFromInput) throw new Error('Обновите web4core.runtime: требуется subscription inspection API');
    const previewSummary = emptySubscriptionPreviewSummary();
    let filterRegex = filterCompiled.regex;
    if (subMode && filterCompiled.error) {
      filterRegex = null;
      previewSummary.warnings.push('Preview не смог проверить Exclude Filter в браузере; Mihomo применит исходное выражение сам.');
    }
    const mainInspected = await inspectSubscriptionInput(api, raw, { expand: !subMode, filterRegex });
    mergeSubscriptionPreviewSummary(previewSummary, mainInspected.summary);
    let fallbackPrepared;
    if (autoWhitelist) {
      const fallbackRaw = document.getElementById('whitelistInput').value.trim();
      const fallbackInspected = await inspectSubscriptionInput(api, fallbackRaw, { expand: !subMode, filterRegex });
      fallbackPrepared = fallbackInspected.input;
      mergeSubscriptionPreviewSummary(previewSummary, fallbackInspected.summary);
    }
    renderSubscriptionPreview(previewSummary);
    const realityModern = parseRealityModernLines();
    const buildBeans = wgProfiles.map(wgProfileBuildBean);
    const result = api.buildFromRequest({
      core: 'mihomo',
      input: mainInspected.input,
      ...(autoWhitelist ? { fallbackInput: fallbackPrepared } : {}),
'''
text = replace_once(text, old_build, new_build, 'final build preprocessing')
text = replace_once(
    text,
    '''        mihomoSubscriptionMode: document.getElementById('cfgSubMode').checked,
        excludeFilter: document.getElementById('excludeFilterInput').value,
        deviceModel: document.getElementById('deviceModelInput').value,
''',
    '''        mihomoSubscriptionMode: subMode,
        excludeFilter: subMode ? excludeFilterRaw : undefined,
        deviceModel: subMode ? document.getElementById('deviceModelInput').value : undefined,
''',
    'build subscription options',
)
text = replace_once(
    text,
    '''document.getElementById('cfgSubMode').addEventListener('change', () => {
  updateExcludeFilterVisibility();
  updateSubModeHint();
});
''',
    '''document.getElementById('cfgSubMode').addEventListener('change', () => {
  updateExcludeFilterVisibility();
  updateSubModeHint();
  clearSubscriptionPreview();
});
for (const id of ['mihomoInput', 'whitelistInput', 'excludeFilterInput']) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', clearSubscriptionPreview);
}
''',
    'preview invalidation listeners',
)
path.write_text(text)

q = Path('quick-start.html')
qt = q.read_text()
qt = replace_once(
    qt,
    '<p class="lead">Простыми словами: что нажимать, чтобы получить рабочий конфиг Mihomo. Всё считается в вашем браузере — ключи и ссылки никуда не отправляются.</p>',
    '<p class="lead">Простыми словами: что нажимать, чтобы получить рабочий конфиг Mihomo. Ключи и WG/AWG-файлы обрабатываются локально. Если вы используете HTTP(S) подписку, при Build браузер может запросить её для preview имён/статического разворачивания; при проблемах CORS runtime может использовать публичный fallback-прокси для чтения подписки.</p>',
    'quick privacy lead',
)
qt = replace_once(
    qt,
    '<tr class="tbody-row"><td data-label="Что у вас есть">Ссылка-подписка <code>https://…</code></td><td data-label="Что делать">Вставьте в то же поле; режим «📡 Использовать URL-подписки» оставьте включённым (он включён по умолчанию).</td></tr>',
    '<tr class="tbody-row"><td data-label="Что у вас есть">Ссылка-подписка <code>https://…</code></td><td data-label="Что делать">Вставьте в то же поле. Режим «📡 Использовать URL-подписки» включён — получите динамический provider; выключен — генератор один раз скачает текущие узлы и встроит их как статические <code>proxies:</code>.</td></tr>',
    'quick subscription row',
)
qt = replace_once(
    qt,
    '<tr class="tbody-row"><td data-label="Что у вас есть">Смесь (подписка + ссылки)</td><td data-label="Что делать">Можно вместе; режим подписок включён, если есть хотя бы один URL.</td></tr>',
    '<tr class="tbody-row"><td data-label="Что у вас есть">Смесь (подписка + ссылки)</td><td data-label="Что делать">Можно вместе в обоих режимах: при включённом URL останется provider, при выключенном URL развернётся в статические узлы, а обычные ссылки сохранятся.</td></tr>',
    'quick mixed row',
)
q.write_text(qt)

a = Path('AGENTS.md')
at = a.read_text()
old_privacy = '''- Users paste secrets here: WARP private/public keys, addresses, SNI. Currently
  the page sends nothing and stores nothing: `index.html` contains no `fetch`,
  `XMLHttpRequest`, `sendBeacon`, `localStorage`, or `sessionStorage` — only clipboard
  writes. It must stay this way: DO NOT add telemetry, analytics, data transmission,
  or persistence of keys.
- Runtime nuance: `web4core.fetchSubscription()` can fetch subscription text from
  the browser and, when direct fetch fails, falls back to the public CORS proxy
  `sub.web2core.workers.dev` (upstream infrastructure). The current UI does NOT call it —
  Mihomo itself fetches subscriptions through `proxy-providers`. Connecting fetchSubscription
  is a decision to disclose the subscription URL to a third party — explicit owner approval
  is required.
'''
new_privacy = '''- Users paste secrets here: WARP private/public keys, addresses, SNI and subscription URLs.
  WARP/WG keys and configs stay local; DO NOT add telemetry or analytics and never persist keys,
  subscription URLs, subscription bodies or proxy credentials.
- Owner-approved subscription inspection (2026-10-02): when Build sees an HTTP(S) subscription,
  the UI may call `web4core.fetchSubscription()` to preview actual node names and, with Sub Mode
  OFF, expand the current subscription snapshot into static proxies. The request is user-triggered
  by Build, never background polling. Direct browser fetch is preferred; when CORS/direct fetch
  fails the runtime may fall back to the public proxy `sub.web2core.workers.dev`, which necessarily
  discloses the subscription URL to that proxy.
- The only persistent browser value introduced for inspection is a random preview identity HWID
  (`link-generators.subscription-preview-hwid.v1`). It is not a key and is deliberately stable so
  device-limited subscription panels do not register a new device on every Build. The preview uses
  a recognizable generator `x-device-model`; it never reuses the generated Mihomo/Keenetic identity.
  If storage is unavailable (including some `file://` contexts), keep the HWID in memory only.
'''
at = replace_once(at, old_privacy, new_privacy, 'AGENTS privacy')
a.write_text(at)

# Deterministic browser regression: no real subscription URLs or credentials.
t = Path('tests/browser.cjs')
tt = t.read_text()
anchor = '''    const openAdvancedDetails = async () => {
      await page.evaluate(() => { document.getElementById('perProxyAdvancedDetails').open = true; });
    };
    const defaultOutput = await build('default');
'''
test_block = r'''    const openAdvancedDetails = async () => {
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
    await page.locator('#excludeFilterInput').fill('(?i)ru|moscow');
    await page.locator('#mihomoInput').fill(syntheticMixed);
    const expanded = await build('subscription-inline-static');
    assert.equal(expanded.doc['proxy-providers'], undefined);
    assert.ok(expanded.doc.proxies.some(p => p.name === 'Sweden Stockholm'));
    assert.ok(expanded.doc.proxies.some(p => p.name === 'STATIC'));
    assert.ok(!expanded.doc.proxies.some(p => /RU Moscow|Moscow Backup/i.test(p.name)));
    assert.match(await page.locator('#subscriptionPreviewStats').innerText(), /Подписок: 2.*найдено узлов: 3.*после фильтра: 1.*исключено: 2/s);
    assert.match(await page.locator('#subscriptionPreviewNames').innerText(), /Sweden Stockholm/);
    assert.match(await page.locator('#subscriptionPreviewNames').innerText(), /RU Moscow/);
    let subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(subCalls.length, 2);
    assert.match(subCalls[0].headers['x-hwid'], /^[0-9a-f]{32}$/);
    assert.equal(subCalls[0].headers['x-hwid'], subCalls[1].headers['x-hwid']);
    assert.equal(subCalls[0].headers['x-device-model'], 'Saymer Link Generators Preview');
    assert.equal(subCalls[0].headers['x-device-os'], 'Browser');

    // A second Build in the same page keeps the same preview identity.
    const firstHwid = subCalls[0].headers['x-hwid'];
    await build('subscription-inline-static-second-build');
    subCalls = await page.evaluate(() => globalThis.__subscriptionFetchCalls);
    assert.equal(subCalls.length, 4);
    assert.equal(subCalls[2].headers['x-hwid'], firstHwid);
    assert.equal(subCalls[3].headers['x-hwid'], firstHwid);

    await page.locator('#cfgSubMode').setChecked(true);
    const providerMode = await build('subscription-provider-preview');
    assert.equal(Object.keys(providerMode.doc['proxy-providers'] || {}).length, 2);
    assert.ok(providerMode.doc.proxies.some(p => p.name === 'STATIC'));
    assert.ok(Object.values(providerMode.doc['proxy-providers']).every(p => p['exclude-filter'] === '(?i)ru|moscow'));
    assert.match(await page.locator('#subscriptionPreviewStats').innerText(), /найдено узлов: 3.*исключено: 2/s);

    await page.evaluate(() => {
      web4core.fetchSubscription = globalThis.__subscriptionFetchOriginal;
      delete globalThis.__subscriptionFetchOriginal;
      delete globalThis.__subscriptionFetchCalls;
    });
    await page.locator('#excludeFilterInput').fill('');
    await page.locator('#cfgSubMode').setChecked(false);
    await page.locator('#mihomoInput').fill(input);
    const defaultOutput = await build('default');
'''
if test_block not in tt:
    if anchor not in tt:
        raise SystemExit('browser subscription test anchor not found')
    tt = tt.replace(anchor, test_block, 1)
t.write_text(tt)

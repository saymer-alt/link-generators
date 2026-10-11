// AWG stability controls (#137) — browser regression.
// 🛡 «Поддерживать AWG-соединение через NAT (keepalive 25 с)» — DEFAULT ON:
//    отсутствующий/несовместимый PK → persistent-keepalive: 25 (явная policy),
//    валидный integer (включая 0) не заменяется; OFF → строгий контракт.
// 🧪 «Тест обрывов: отключить RandomTrailers» — DEFAULT OFF: диагностический
//    override только по явному действию пользователя, с WARN и trace.
// Scope — только AWG-профили (amnezia-wg-option); plain WireGuard не затрагивается.
// Политика применяется к КОПИЯМ бинов (wgEngineBeans) — оригиналы не мутируются.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const FIXTURES = ['awg31.conf', 'awg-keepalive-30.conf', 'awg-no-keepalive.conf', 'awg-keepalive-0.conf', 'wg-no-keepalive.conf'];
const TEXTS = Object.fromEntries(FIXTURES.map(f => [f, fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8')]));
const SYNTHETIC_PK = 'P0RJTlNYXWJnbHF2e4CFio+UmZ6jqK2yt7zBxsvQ1do=';
const LINKS = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#VPS-SE\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#VPS-EE';

let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

(async () => {
  console.log('AWG-stability: launching');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  // Дефолты тогглов: keepalive ON, RT diagnostic OFF
  assert.equal(await page.isChecked('#cfgAwgKeepalive'), true, 'keepalive DEFAULT ON');
  assert.equal(await page.isChecked('#cfgAwgRtDiag'), false, 'RT diagnostic DEFAULT OFF');
  assert.equal(await page.evaluate(() => document.getElementById('awgRtDiagWarn').style.display), 'none', 'RT warn скрыт по умолчанию');
  ok('дефолты: 🛡 ON, 🧪 OFF, WARN скрыт');

  await page.locator('#cfgSubMode').uncheck();
  await page.locator('#mihomoInput').fill(LINKS);

  const loadProfile = async fixture => {
    await page.evaluate(({ name, text }) => {
      // реальный upload path: normalizeWgText (on/off → 1/0, BOM) перед парсером
      const bean = web4core.parseWireGuardConf(normalizeWgText(text), name);
      wgProfiles = [{ id: ++wgProfileSeq, filename: name, mode: 'direct', target: '', targetSource: 'select', bean }];
      syncWgCollections();
      renderWgList();
      refreshWgTargetSelectors();
    }, { name: fixture, text: TEXTS[fixture] });
    await page.waitForFunction(() => dialerTargetsCache.length > 0, null, { timeout: 10000 });
  };
  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
    return page.evaluate(() => ({
      state: MIHOMO_VALIDATION_STATE.state,
      yaml: document.getElementById('mihomoOutput').value,
      cards: Array.from(document.querySelectorAll('#wgList .wg-mtu-note')).map(x => x.textContent)
    }));
  };
  const policyTrace = () => page.evaluate(() => {
    const beans = wgEngineBeans({ noDialer: true });
    return JSON.stringify(beans.map(b => ({ report: b.awgFieldReport || [], wg: { pk: b.wireguard.persistentKeepalive, raw: b.wireguard.persistentKeepaliveRaw, rt: b.wireguard['amnezia-wg-option'] && b.wireguard['amnezia-wg-option']['random-trailers'] } })));
  });

  // B-сценарий базово: валидный integer 30 + ON → 30 сохраняется
  await loadProfile('awg-keepalive-30.conf');
  let r = await build();
  assert.equal(r.state, 'VALID');
  assert.match(r.yaml, /persistent-keepalive: 30/, 'integer 30 сохранён');
  assert.ok(!r.yaml.includes('persistent-keepalive: 25'), 'валидный integer не заменён на 25');
  ok('PK integer 30 + ON → 30 (никогда не заменяется на 25)');

  // Missing + ON → 25 + trace + card note
  await loadProfile('awg-no-keepalive.conf');
  r = await build();
  assert.equal(r.state, 'VALID');
  assert.match(r.yaml, /persistent-keepalive: 25/, 'missing + ON → 25');
  assert.ok(r.cards.some(t => t.includes('AWG keepalive:') && t.includes('persistent-keepalive: 25')), 'card note о политике');
  const traceMissing = JSON.parse(await policyTrace())[0];
  const pkEntry = traceMissing.report.find(e => e.key === 'persistent-keepalive');
  assert.ok(pkEntry && pkEntry.status === 'SUPPORTED_NORMALIZED', 'trace: SUPPORTED_NORMALIZED');
  assert.match(pkEntry.rawValue, /отсутствовал → 25|→ 25/, 'trace rawValue');
  assert.match(pkEntry.note, /explicit user-enabled NAT keepalive policy/, 'trace note');
  ok('PK missing + ON → 25 + явный trace (SUPPORTED_NORMALIZED)');

  // Range + ON → 25 + trace «explicit fallback … не эквивалентен»; RT пока не тронут
  await loadProfile('awg31.conf');
  r = await build();
  assert.equal(r.state, 'VALID');
  assert.match(r.yaml, /persistent-keepalive: 25/, 'range 25-35 + ON → 25');
  assert.match(r.yaml, /random-trailers: true/, 'RT diagnostic OFF: RandomTrailers сохранён');
  assert.ok(r.cards.some(t => t.includes('25-35 → 25') && t.includes('случайный диапазон исходного профиля не сохраняется')), 'card warn: range fallback с объяснением');
  const traceRange = JSON.parse(await policyTrace())[0];
  const rangeEntry = traceRange.report.find(e => e.key === 'persistent-keepalive');
  assert.ok(rangeEntry && rangeEntry.status === 'SUPPORTED_NORMALIZED', 'range: статус trace');
  assert.equal(rangeEntry.rawValue, '25-35 → 25', 'range: rawValue 25-35 → 25');
  assert.match(rangeEntry.note, /explicit user-enabled Mihomo compatibility fallback/, 'trace: explicit fallback');
  assert.match(rangeEntry.note, /не эквивалентен/i, 'trace: honest non-equivalence');
  ok('PK range 25-35 + ON → 25 + trace (explicit fallback, fixed ≠ random-range)');

  // A-сценарий: keepalive OFF + RT OFF → строгий контракт
  await page.locator('#cfgAwgKeepalive').uncheck();
  r = await build();
  assert.equal(r.state, 'VALID');
  assert.ok(!r.yaml.includes('persistent-keepalive'), 'range + OFF → поле omitted');
  assert.match(r.yaml, /random-trailers: true/, 'A: RT исходный');
  assert.ok(r.cards.some(t => t.includes('persistent-keepalive = 25-35') && t.includes('не перенесено')), 'OFF: строгий WARN остался');
  ok('A (OFF/OFF): range не эмитится, WARN/UNSUPPORTED сохранён — strict контракт');

  // C-сценарий: keepalive ON + RT diagnostic ON
  await page.locator('#cfgAwgKeepalive').check();
  await page.locator('#awgDiagnosticDetails > summary').click();
  await page.locator('#cfgAwgRtDiag').check();
  await page.locator('#awgDiagnosticDetails > summary').click();
  assert.equal(await page.locator('#awgRtDiagWarn').isVisible(), true, 'active diagnostic warning survives collapsed details');
  assert.equal(await page.evaluate(() => document.getElementById('awgRtDiagWarn').style.display), 'block', '🧪 ON: заметный красный WARN показан');
  assert.ok((await page.locator('#awgRtDiagWarn').textContent()).includes('controlled experiment'), 'WARN: не универсальный fix');
  r = await build();
  assert.equal(r.state, 'VALID');
  assert.match(r.yaml, /persistent-keepalive: 25/, 'C: pk 25');
  assert.match(r.yaml, /random-trailers: false/, 'C: RandomTrailers явно off (diagnostic override)');
  assert.ok(!r.yaml.includes('random-trailers: true'), 'C: random-trailers: true отсутствует');
  const traceC = JSON.parse(await policyTrace())[0];
  const rtEntries = traceC.report.filter(e => e.key === 'random-trailers');
  const rtEntry = rtEntries[rtEntries.length - 1];
  assert.ok(rtEntry && rtEntry.status === 'IGNORED_BY_POLICY', 'C: RT trace статус (последняя запись — override)');
  assert.equal(rtEntry.rawValue, 'on → off', 'C: RT trace rawValue');
  assert.match(rtEntry.note, /diagnostic override requested by user/, 'C: RT trace note');
  assert.ok(r.cards.some(t => t.includes('🧪 RandomTrailers: on → off') && t.includes('diagnostic override')), 'C: card warn RT');
  ok('C (ON/ON): pk 25 + RandomTrailers off + WARN + trace');

  // RT diagnostic OFF обратно → исходный RT возвращается (оригиналы не мутированы)
  await page.locator('#awgDiagnosticDetails > summary').click();
  await page.locator('#cfgAwgRtDiag').uncheck();
  assert.equal(await page.evaluate(() => document.getElementById('awgRtDiagWarn').style.display), 'none', '🧪 OFF: WARN скрыт');
  r = await build();
  assert.match(r.yaml, /random-trailers: true/, '🧪 OFF → RT вернулся (beans не мутированы)');
  ok('OFF восстанавливает исходный RandomTrailers — policy только на копиях сборки');

  // Scope: plain WireGuard не затрагивается политикой
  await loadProfile('wg-no-keepalive.conf');
  r = await build();
  assert.equal(r.state, 'VALID');
  assert.ok(!r.yaml.includes('persistent-keepalive'), 'plain WG без PK: политика НЕ добавляет 25 (scope)');
  ok('scope: plain WireGuard вне политики (семантика не расширена)');

  // PK=0 у AWG: валидный integer 0 (disabled) не заменяется на 25
  await loadProfile('awg-keepalive-0.conf');
  r = await build();
  assert.equal(r.state, 'VALID');
  assert.ok(!r.yaml.includes('persistent-keepalive'), 'PK=0 (disabled) не заменён на 25; движок опускает поле по семантике Mihomo');
  ok('PK=0 у AWG + ON → 0 сохранён (0 = disabled, поле omitted)');

  // Приватность: ключи не попадают в card notes / report / toast
  const leakProbe = await page.evaluate(key => {
    const cards = Array.from(document.querySelectorAll('#wgList')).map(x => x.textContent).join('|');
    const report = wgEngineBeans({ noDialer: true }).map(b => JSON.stringify(b.awgFieldReport || [])).join('|');
    const toast = String(window.__lastToast || '');
    return { cards, report, toast };
  }, SYNTHETIC_PK);
  for (const part of ['cards', 'report', 'toast']) {
    assert.ok(!leakProbe[part].includes(SYNTHETIC_PK), part + ': приватный ключ не логируется');
    assert.ok(!leakProbe[part].includes('P0RJTlNY'), part + ': фрагмент ключа не логируется');
  }
  ok('приватность: ключи отсутствуют в notes/report/toast');

  // 360px: секция тогглов без горизонтального overflow
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(overflow.sw <= overflow.iw + 1, '360px: нет горизонтального overflow (' + overflow.sw + ' vs ' + overflow.iw + ')');
  await page.setViewportSize({ width: 1280, height: 800 });
  ok('360px layout: без overflow');

  assert.deepEqual(errors, [], 'no page errors');
  passed += 1;

  console.log('AWG-stability: ' + passed + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

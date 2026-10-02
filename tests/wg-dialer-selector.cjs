// Dialer target selector (v1.6.2): authoritative registry через префлайт-сборку
// web4core, точные имена (включая суффиксы дедупликации), self-exclusion,
// manual/ADVANCED путь с build-валидацией, dynamic refresh, циклы — build-level.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fx = n => path.join(__dirname, 'fixtures', n);

(async () => {
  console.log('WG-dialer-selector: launching');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  let passed = 0;
  const ok = name => { passed++; console.log('  ok —', name); };
  const LINKS = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#VPS-SE\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#VPS-EE';
  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
    return page.evaluate(() => ({ state: MIHOMO_VALIDATION_STATE.state, yaml: document.getElementById('mihomoOutput').value }));
  };
  const optionsOf = idx => page.evaluate(i => {
    const sel = document.getElementById('wgTarget' + wgProfiles[i].id);
    return Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent }));
  }, idx);
  const proxyBlockOf = (y, name) => {
    const lines = y.split('\n');
    const start = lines.findIndex(l => { const t = l.trim().replace(/^- /, ''); return t === `name: ${name}` || t === `name: "${name}"` || t === `name: '${name}'`; });
    assert.ok(start !== -1, `proxy ${name} найден в yaml`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (/^\s{2}- name:/.test(lines[i])) { end = i; break; }
    return lines.slice(start, end).join('\n');
  };

  await page.locator('#cfgSubMode').uncheck();
  await page.locator('#mihomoInput').fill(LINKS);

  // 1. WG → статический proxy: dropdown содержит точные имена из YAML
  await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf'), fx('wg-simple-b.conf')]);
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 2);
  await page.waitForFunction(() => dialerTargetsCache.length > 0, null, { timeout: 10000 });
  let opts = await optionsOf(0);
  assert.ok(opts.some(o => o.value === 'VPS-SE'), 'VPS-SE в списке');
  assert.ok(opts.some(o => o.value === 'VPS-EE'), 'VPS-EE в списке');
  assert.ok(opts.some(o => o.value === 'wg-simple-b'), 'другой WG-профиль в списке');
  assert.ok(opts.some(o => o.value === '__manual__'), 'ручной путь присутствует');
  assert.ok(!opts.some(o => o.value === 'GLOBAL'), 'GLOBAL не предлагается (цикл)');
  assert.ok(!opts.some(o => o.value === '⚡ Fastest'), '⚡ Fastest не предлагается (цикл)');
  assert.ok(!opts.some(o => o.value === 'wg-simple-a'), 'сам профиль исключён из собственного списка');
  ok('registry: статические proxy + WG-профили, GLOBAL/⚡ Fastest/self исключены');

  // 2. WG → другой WG (WG-over-WG) — выбор и сборка
  await page.locator('.wg-mode').first().selectOption('proxy');
  await page.locator('#wgTarget' + (await page.evaluate(() => wgProfiles[0].id))).selectOption('wg-simple-b');
  let r = await build();
  assert.equal(r.state, 'VALID');
  assert.match(proxyBlockOf(r.yaml, 'wg-simple-a'), /dialer-proxy: wg-simple-b/, 'A → B');
  ok('WG → другой WG: точное имя, сборка VALID');

  // 3. duplicate names: resulting names с суффиксами — коллизия имён → dropdown
  // показывает итоговые имена рантайма (collide / collide-2)
  await page.evaluate(() => {
    const mk = (name, addr) => ({
      id: ++wgProfileSeq, filename: name + '.conf', mode: 'direct', target: '', targetSource: 'select',
      bean: web4core.parseWireGuardConf(
        `[Interface]\nPrivateKey = CkGOZHbIxJvSSWWGFlHpNkGt0HhRIcKbmTIrmA9TcHk=\nAddress = ${addr}/32\n[Peer]\nPublicKey = CkGOZHbIxJvSSWWGFlHpNkGt0HhRIcKbmTIrmA9TcHk=\nAllowedIPs = 0.0.0.0/0\nEndpoint = 198.51.100.10:51820\n`, name),
    });
    wgProfiles = [mk('collide', '10.7.1.2'), mk('collide', '10.7.2.2')];
    syncWgCollections(); renderWgList();
    refreshWgTargetSelectors();
  });
  await page.waitForFunction(() => dialerTargetsCache.some(t => /^collide(-\d+)?$/.test(t.value)), null, { timeout: 10000 });
  const yamlNames = await page.evaluate(() => dialerTargetsCache.map(t => t.value));
  const dupNames = yamlNames.filter(n => n === 'collide' || /^collide-\d+$/.test(n));
  assert.deepEqual(dupNames.sort(), ['collide', 'collide-2'], 'оба результирующих имени в dropdown: ' + JSON.stringify(yamlNames));
  ok('duplicate-name contract: dropdown показывает resulting names (суффиксы рантайма)');

  // 4. self target: ИТОГОВОЕ имя собственного outbound не в своём dropdown
  // (при коллизии это collide и collide-2 соответственно)
  const selfCheck = await page.evaluate(() => {
    const emitted = dialerWgNamesCache;
    return wgProfiles.map((p, i) => {
      const sel = document.getElementById('wgTarget' + p.id);
      return Array.from(sel.options).some(o => o.value === emitted[i]);
    });
  });
  assert.deepEqual(selfCheck, [false, false], 'итоговое self-имя исключено у обоих collide-профилей');
  ok('self target исключён из собственного dropdown (по итоговому имени)');

  // 5. target removed after selection: коллизия схлопывается — прежний выбор
  // «collide» стал именем самого профиля → сброс + пометка, без dangling/self
  await page.locator('.wg-mode').nth(1).selectOption('proxy');
  await page.waitForTimeout(400); // debounce refresh
  await page.locator('#wgTarget' + (await page.evaluate(() => wgProfiles[1].id))).selectOption('collide');
  await page.waitForFunction(() => wgProfiles[1].target === 'collide');
  await page.locator('.wg-list-del').first().click(); // удаляем collide №1: collide-2 → collide (цель стала self)
  await page.waitForFunction(() => wgProfiles.length === 1);
  const after = await page.evaluate(() => ({ target: wgProfiles[0].target, warn: (document.querySelector('.wg-target-warn') || {}).textContent || '' }));
  assert.equal(after.target, '', 'выбор, ставший self после схлопывания коллизии, сброшен');
  assert.match(after.warn, /недоступна/, 'пометка показана: ' + JSON.stringify(after));
  ok('target removed after selection: сброс + честная пометка (без dangling/self)');

  // 6. manual target: ADVANCED-путь + build-валидация dangling
  await page.waitForFunction(() => dialerTargetsCache.length > 0, null, { timeout: 10000 });
  const sel0 = '#wgTarget' + (await page.evaluate(() => wgProfiles[0].id));
  await page.locator(sel0).selectOption('__manual__');
  await page.locator('.wg-target-manual').first().fill('НЕСУЩЕСТВУЮЩАЯ-ГРУППА');
  // fill() не эмитит change (реальный пользователь уходит фокусом кликом по Build)
  await page.locator('.wg-target-manual').first().evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
  await page.locator('button[onclick="buildMihomo()"]').click();
  try {
    await page.waitForFunction(() => (window.__lastToast || '').includes('не существует в генерируемом конфиге'), null, { timeout: 8000 });
  } catch (e) {
    const dump = await page.evaluate(() => ({ toast: window.__lastToast, n: wgProfiles.length, files: wgProfiles.map(p => p.filename + ':' + p.mode + ':' + p.target), target: wgProfiles[0] && wgProfiles[0].target, src: wgProfiles[0] && wgProfiles[0].targetSource, state: MIHOMO_VALIDATION_STATE.state }));
    throw new Error('dangling manual toast not shown: ' + JSON.stringify(dump));
  }
  ok('manual target: dangling имя отклоняется при сборке с формулировкой контракта');

  // 7. manual target: существующее имя проходит
  await page.locator('.wg-target-manual').first().fill('VPS-SE');
  await page.locator('.wg-target-manual').first().evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
  r = await build();
  assert.equal(r.state, 'VALID');
  assert.match(proxyBlockOf(r.yaml, 'collide'), /dialer-proxy: VPS-SE/, 'manual существующий таргет применён');
  ok('manual target: существующее имя проходит сборку');

  // 8. vanished target: удаление цели-прокси из ввода → сброс + пометка
  await page.locator('#wgFile').setInputFiles(fx('wg-simple-a.conf'));
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 2);
  await page.waitForFunction(() => dialerTargetsCache.length > 0, null, { timeout: 10000 });
  await page.locator('.wg-mode').nth(1).selectOption('proxy');
  await page.waitForTimeout(400);
  await page.locator('#wgTarget' + (await page.evaluate(() => wgProfiles[1].id))).selectOption('VPS-EE');
  await page.waitForFunction(() => wgProfiles[1].target === 'VPS-EE');
  await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#VPS-SE');
  await page.waitForFunction(() => wgProfiles[1].target === '' , null, { timeout: 10000 });
  const vanish2 = await page.evaluate(() => {
    const card = document.querySelectorAll('.wg-card')[1];
    const warn = card && card.querySelector('.wg-target-warn');
    return warn ? warn.textContent : '';
  });
  assert.match(vanish2, /недоступна/, 'пометка о исчезнувшей цели показана');
  // вернуть второй профиль в «Напрямую» — дальше сборки без пустых таргетов
  await page.locator('.wg-mode').nth(1).selectOption('direct');
  await page.waitForFunction(() => wgProfiles[1].target === '' && wgProfiles[1].mode === 'direct');
  ok('vanished target: сброс выбора + видимая пометка (без hidden dangling)');

  // 8. dynamic refresh: подмена имени через dialer-группу → группа в dropdown
  await page.locator('#mihomoInput').fill(LINKS); // обе транзитные цели существуют
  await page.evaluate(() => {
    document.getElementById('wgDialerMembers').value = 'VPS-SE\nVPS-EE';
    document.getElementById('wgDialerMembers').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => dialerTargetsCache.some(t => t.value === 'WARP-DIALER'), null, { timeout: 10000 });
  opts = await optionsOf(0);
  assert.ok(opts.some(o => o.value === 'WARP-DIALER'), 'provider/статик dialer-группа появилась в списке');
  ok('dynamic refresh: dialer-группа появляется в dropdown');

  // 9. URL-подписка из ОСНОВНОГО input автоматически становится target.
  await page.evaluate(() => {
    document.getElementById('wgDialerMembers').value = '';
    document.getElementById('wgDialerProviders').value = '';
    document.getElementById('wgDialerInput').value = '';
  });
  await page.locator('#mihomoInput').fill(LINKS + '\nhttps://subs.example.invalid/token');
  await page.locator('#cfgSubMode').check();
  await page.waitForFunction(() => dialerTargetsCache.some(t => t.kind === 'provider'), null, { timeout: 10000 });
  const providerTarget = await page.evaluate(() => dialerTargetsCache.find(t => t.kind === 'provider'));
  assert.ok(providerTarget && /ПОДПИСКА/.test(providerTarget.label), 'подписка видна как понятный target');
  await page.locator('.wg-mode').first().selectOption('proxy');
  await page.waitForTimeout(300);
  const firstTarget = '#wgTarget' + (await page.evaluate(() => wgProfiles[0].id));
  await page.locator(firstTarget).selectOption(providerTarget.value);
  r = await build();
  assert.equal(r.state, 'VALID', 'WG → subscription target: сборка VALID');
  const providerCheck = await page.evaluate(y => {
    const d = jsyaml.load(y);
    const wg = (d.proxies || []).find(p => p && p.type === 'wireguard');
    const g = (d['proxy-groups'] || []).find(x => x && x.name === (wg && wg['dialer-proxy']));
    const providers = Object.keys(d['proxy-providers'] || {});
    return { dialer: wg && wg['dialer-proxy'], group: g, providers };
  }, r.yaml);
  assert.ok(providerCheck.dialer && providerCheck.dialer.startsWith('DIALER-'), 'WG получил generated dialer group');
  assert.ok(providerCheck.group && Array.isArray(providerCheck.group.use) && providerCheck.group.use.length === 1, 'generated group содержит use:[provider]');
  assert.ok(providerCheck.providers.includes(providerCheck.group.use[0]), 'use ссылается на существующий proxy-provider');
  assert.equal(await page.locator('#wgDialerProviders').inputValue(), '', 'URL не дублировался в advanced поле');
  ok('subscription target: main input → dropdown → generated use: group без повторного URL');

  // 9b. Legacy/ADVANCED provider-backed group остаётся совместимым.
  await page.locator('.wg-mode').first().selectOption('direct');
  await page.evaluate(() => {
    document.getElementById('wgDialerProviders').value = 'https://subs.example.invalid/token';
    document.getElementById('wgDialerProviders').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => dialerTargetsCache.some(t => t.value === 'WARP-DIALER'), null, { timeout: 10000 });
  ok('ADVANCED legacy provider-backed WARP-DIALER остаётся доступен');

  // 10. цикл A → B → A: централизованный детектор отклоняет сборку
  await page.evaluate(() => {
    document.getElementById('wgDialerProviders').value = '';
    document.getElementById('wgDialerProviders').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('cfgSubMode').checked = false;
    document.getElementById('cfgSubMode').dispatchEvent(new Event('change', { bubbles: true }));
    wgProfiles = []; wgRejected = []; syncWgCollections(); renderWgList();
  });
  await page.locator('#mihomoInput').fill(LINKS);
  await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf'), fx('wg-simple-b.conf')]);
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 2);
  await page.waitForFunction(() => dialerTargetsCache.length > 0, null, { timeout: 10000 });
  await page.locator('.wg-mode').nth(0).selectOption('proxy');
  await page.locator('.wg-mode').nth(1).selectOption('proxy');
  await page.waitForTimeout(400); // debounce refresh
  const idA = await page.evaluate(() => wgProfiles[0].id);
  const idB = await page.evaluate(() => wgProfiles[1].id);
  await page.locator('#wgTarget' + idA).selectOption('wg-simple-b');
  await page.locator('#wgTarget' + idB).selectOption('wg-simple-a');
  // Централизованный детектор циклов (web4core analyzeDialerGraph в движке):
  // сборка отклоняется с полным маршрутом цикла.
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => (window.__lastToast || '').includes('circular dialer-proxy'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'NOT_BUILT', 'цикл — сборка не выполняется');
  ok('cycle: движок отклоняет WG-A → WG-B → WG-A (circular dialer-proxy)');

  // 11. target renamed by AWL: registry показывает переименованные имена
  await page.evaluate(() => {
    wgProfiles = []; wgRejected = []; syncWgCollections(); renderWgList();
  });
  await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf')]);
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 1);
  await page.locator('#mihomoInput').fill(LINKS);
  await page.locator('#cfgAutoWhitelist').check();
  await page.locator('#whitelistInput').fill(LINKS.replace('#VPS-SE', '#FALLBACK-SE'));
  await page.waitForFunction(() => dialerTargetsCache.some(t => t.value.includes('PRIMARY')), null, { timeout: 10000 });
  const awlNames = await page.evaluate(() => dialerTargetsCache.map(t => t.value));
  assert.ok(awlNames.some(n => n.startsWith('PRIMARY')), 'AWL-переименования в dropdown: ' + JSON.stringify(awlNames));
  ok('AWL rename: dropdown использует resulting names (PRIMARY-…: …)');

  assert.deepEqual(errors, [], 'нет pageerror');
  console.log(`WG-dialer-selector: ${passed} проверок — PASS`);
  await browser.close();
})().catch(e => { console.error('WG-dialer-selector: FAIL —', e.message); process.exit(1); });

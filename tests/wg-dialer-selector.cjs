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
  // Группа существует только когда хотя бы один WG реально использует dialer.
  await page.locator('.wg-mode').first().selectOption('proxy');
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

  // 12. owner field-test regression (v1.8.0 final-polish): последовательные
  // загрузки (каждый файл отдельным setInputFiles) + ПУСТОЙ основной ввод —
  // WG-only сборка валидна, поэтому WG-цели доступны обесторонне.
  await page.evaluate(() => {
    const awl = document.getElementById('cfgAutoWhitelist');
    if (awl.checked) { awl.checked = false; awl.dispatchEvent(new Event('change', { bubbles: true })); }
    wgProfiles = []; wgRejected = []; syncWgCollections(); renderWgList();
    const inp = document.getElementById('mihomoInput');
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    const wl = document.getElementById('whitelistInput');
    wl.value = ''; wl.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#cfgSubMode').uncheck();
  await page.locator('#wgFile').setInputFiles(fx('wg-simple-a.conf'));
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 1);
  await page.locator('#wgFile').setInputFiles(fx('wg-simple-b.conf')); // вторая ОТДЕЛЬНАЯ загрузка
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 2);
  await page.waitForFunction(() => dialerTargetsCache.length >= 2, null, { timeout: 10000 });
  optsA = await optionsOf(0);
  optsB = await optionsOf(1);
  assert.ok(optsA.some(o => o.value === 'wg-simple-b'), 'A: другой WG присутствует в списке (пустой ввод)');
  assert.ok(!optsA.some(o => o.value === 'wg-simple-a'), 'A: self исключён');
  assert.ok(optsB.some(o => o.value === 'wg-simple-a'), 'B: первый WG присутствует в списке');
  assert.ok(!optsB.some(o => o.value === 'wg-simple-b'), 'B: self исключён');
  ok('owner-сценарий: последовательные загрузки + пустой ввод — WG-цели обесторонне, self исключён');

  // 12b. WG-only Build: A → B, без обычных proxy во вводе — VALID + dialer-proxy: B
  await page.locator('.wg-mode').first().selectOption('proxy');
  await page.waitForTimeout(300);
  await page.locator('#wgTarget' + (await page.evaluate(() => wgProfiles[0].id))).selectOption('wg-simple-b');
  r = await build();
  assert.equal(r.state, 'VALID', 'WG-only сборка VALID');
  assert.match(proxyBlockOf(r.yaml, 'wg-simple-a'), /dialer-proxy: wg-simple-b/, 'dialer-proxy: B в итоговом YAML');
  ok('WG-only (без обычных proxy): A → B собирается VALID с dialer-proxy: B');

  // 13. Sub Mode ON + пустой ввод: движок авторитетно отвергает такой Build
  // (Sub Mode требует URL подписок), но dropdown НЕ деградирует в «только Manual» —
  // реестр строится по WG-only проекции тех же бинов + честная плашка.
  await page.locator('.wg-mode').first().selectOption('direct');
  await page.locator('#cfgSubMode').check();
  await page.waitForFunction(() => dialerRegistryDegraded === true, null, { timeout: 10000 });
  optsA = await optionsOf(0);
  assert.ok(optsA.some(o => o.value === 'wg-simple-b'), 'Sub-ON empty: WG-цель осталась в dropdown');
  assert.ok(optsA.some(o => o.value === '__manual__'), 'Sub-ON empty: manual путь на месте');
  const degText = await page.evaluate(() => (document.querySelector('.wg-target-degraded') || {}).textContent || '');
  assert.match(degText, /предварительный/, 'плашка предварительного реестра показана: ' + JSON.stringify(degText));
  await page.locator('.wg-mode').first().selectOption('proxy');
  await page.waitForTimeout(300);
  await page.locator('#wgTarget' + (await page.evaluate(() => wgProfiles[0].id))).selectOption('wg-simple-b');
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => (window.__lastToast || '').includes('URL-подписки'), null, { timeout: 8000 });
  assert.match(await page.evaluate(() => window.__lastToast), /выключите «Использовать URL-подписки»/, 'Build в Sub-ON-empty отвергнут авторитетной валидацией движка');
  ok('Sub-ON + пустой ввод: dropdown с WG-целями (degraded) + Build честно отвергнут движком');

  // 14. privacy: приватный ключ загруженного профиля не попадает в storage/URL
  const privKey = (fs.readFileSync(fx('wg-simple-a.conf'), 'utf8').match(/PrivateKey\s*=\s*(\S+)/) || [])[1];
  assert.ok(privKey, 'fixture содержит PrivateKey');
  const storages = await page.evaluate(() => {
    const dump = o => { const r = {}; for (let i = 0; i < o.length; i++) { const k = o.key(i); r[k] = o.getItem(k); } return JSON.stringify(r); };
    return JSON.stringify({ ls: dump(localStorage), ss: dump(sessionStorage), url: location.search + location.hash });
  });
  assert.ok(!storages.includes(privKey), 'private key отсутствует в localStorage/sessionStorage/URL');
  assert.ok(!/PrivateKey/i.test(storages), 'никаких следов PrivateKey в storage');
  ok('privacy: приватный ключ загруженного WG не сохраняется в storage/URL');

  // 15. owner field-test regression v2 (5 реальных AWG/WARP-профилей): ТОЧНЫЙ
  // sequential path — каждый следующий файл ОТДЕЛЬНЫМ setInputFiles, после каждой
  // загрузки проверяем dialerWgNamesCache/dialerTargetsCache/options ВСЕХ карточек.
  // Матрица B (без обычных proxy): пустой ввод + Sub OFF → основной путь префлайта.
  await page.evaluate(() => {
    const sub = document.getElementById('cfgSubMode');
    if (sub.checked) { sub.checked = false; sub.dispatchEvent(new Event('change', { bubbles: true })); }
    wgProfiles = []; wgRejected = []; syncWgCollections(); renderWgList();
    const inp = document.getElementById('mihomoInput');
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const seq5 = ['wg-ee-like.conf', 'wg-de-like.conf', 'wg-fi-like.conf', 'wg-warp-like.conf', 'wg-awg-i-like.conf'];
  const uploadOne = async (f, n) => {
    await page.locator('#wgFile').setInputFiles(fx(f)); // один файл за выбор — точный owner path
    await page.waitForFunction(k => wgUploadPending === false && wgProfiles.length === k, n, { timeout: 15000 });
    await page.waitForFunction(k => dialerWgNamesCache.length === k, n, { timeout: 10000 });
  };
  const checkAllDropdowns = async (label) => {
    const res = await page.evaluate(() => {
      const names = dialerWgNamesCache;
      const targets = dialerTargetsCache.map(t => t.value);
      const cards = wgProfiles.map((p, i) => {
        const sel = document.getElementById('wgTarget' + p.id);
        const vals = Array.from(sel.options).map(o => o.value);
        return {
          self: names[i],
          othersPresent: names.filter((_, j) => j !== i).every(o => vals.includes(o)),
          selfAbsent: !vals.includes(names[i])
        };
      });
      return { names, targets, cards, degraded: dialerRegistryDegraded };
    });
    assert.ok(res.cards.every(c => c.othersPresent && c.selfAbsent),
      label + ': каждый dropdown содержит N-1 других WG без self — ' + JSON.stringify(res.cards));
    return res;
  };
  await uploadOne(seq5[0], 1);
  await checkAllDropdowns('после 1-й загрузки');
  await uploadOne(seq5[1], 2);
  await checkAllDropdowns('после 2-й загрузки');
  await uploadOne(seq5[2], 3);
  const three = await checkAllDropdowns('после 3-й загрузки');
  assert.equal(three.names.length, 3);
  assert.equal(three.degraded, false, 'matrix B: основной путь префлайта, без деградации');
  ok('sequential 3 (EXACT owner path): после КАЖДОЙ загрузки N-1 целей в каждом dropdown, self исключён');

  // 16. 5 профилей последовательно + цикл + 4-хоп цепочка (matrix B, WG-only Build)
  await uploadOne(seq5[3], 4);
  await checkAllDropdowns('после 4-й загрузки');
  await uploadOne(seq5[4], 5);
  const five = await checkAllDropdowns('после 5-й загрузки');
  assert.equal(five.names.length, 5);
  assert.deepEqual(five.names, ['wg-ee-like', 'wg-de-like', 'wg-fi-like', 'wg-warp-like', 'wg-awg-i-like']);
  ok('sequential 5: все 5 real-like профилей (AWG 3.1 / WARP dual-stack / AWG I-entries), каждый dropdown = 4 других без self');

  const ids5 = await page.evaluate(() => wgProfiles.map(p => p.id));
  await page.locator('.wg-mode').nth(0).selectOption('proxy');
  await page.locator('.wg-mode').nth(1).selectOption('proxy');
  await page.waitForTimeout(300);
  await page.locator('#wgTarget' + ids5[0]).selectOption('wg-de-like');
  await page.locator('#wgTarget' + ids5[1]).selectOption('wg-ee-like');
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => (window.__lastToast || '').includes('circular dialer-proxy'), null, { timeout: 8000 });
  ok('цикл wg-ee-like → wg-de-like → wg-ee-like отклонён существующей cycle-защитой');

  await page.locator('#wgTarget' + ids5[1]).selectOption('wg-fi-like');
  await page.locator('.wg-mode').nth(2).selectOption('proxy');
  await page.waitForTimeout(200);
  await page.locator('#wgTarget' + ids5[2]).selectOption('wg-warp-like');
  await page.locator('.wg-mode').nth(3).selectOption('proxy');
  await page.waitForTimeout(200);
  await page.locator('#wgTarget' + ids5[3]).selectOption('wg-awg-i-like');
  r = await build();
  assert.equal(r.state, 'VALID', '4-хоп цепочка WG-only (пустой ввод): Build VALID');
  const chain = await page.evaluate(y => {
    const d = jsyaml.load(y);
    return (d.proxies || []).filter(p => p.type === 'wireguard').map(p => ({ name: p.name, dialer: p['dialer-proxy'] || '' }));
  }, r.yaml);
  assert.deepEqual(chain, [
    { name: 'wg-ee-like', dialer: 'wg-de-like' },
    { name: 'wg-de-like', dialer: 'wg-fi-like' },
    { name: 'wg-fi-like', dialer: 'wg-warp-like' },
    { name: 'wg-warp-like', dialer: 'wg-awg-i-like' },
    { name: 'wg-awg-i-like', dialer: '' }
  ], 'dialer-proxy цепочка в YAML: ' + JSON.stringify(chain));
  assert.ok(chain.every(c => c.dialer !== c.name), 'self-reference запрещён');
  ok('цепочка EE→DE→FI→WARP→AWG-I: Build VALID, dialer-proxy по хопам, self-reference нет');

  // 17. matrix A: обычный VLESS-ввод + sequential uploads + Sub Mode ON (дефолт) —
  // комбинированный префлайт авторитетно падает (нужен URL подписки), но dropdown
  // обязан показывать WG-цели через WG-only проекцию после КАЖДОЙ загрузки.
  await page.evaluate(() => {
    wgProfiles = []; wgRejected = []; syncWgCollections(); renderWgList();
    const inp = document.getElementById('mihomoInput');
    inp.value = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#VPS-SE';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const sub = document.getElementById('cfgSubMode');
    if (!sub.checked) { sub.checked = true; sub.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForFunction(() => dialerTargetsCache !== null, null, { timeout: 2000 }).catch(() => {}); // refresh после input/sub change без профилей — early return
  await uploadOne(seq5[0], 1);
  await page.waitForFunction(() => dialerRegistryDegraded === true, null, { timeout: 10000 });
  await page.waitForFunction(() => dialerTargetsCache.length >= 1, null, { timeout: 10000 });
  await uploadOne(seq5[1], 2);
  await uploadOne(seq5[2], 3);
  const mA = await checkAllDropdowns('matrix A (VLESS+Sub-ON) после 3-й загрузки');
  assert.equal(mA.names.length, 3);
  assert.equal(await page.evaluate(() => dialerRegistryDegraded), true, 'matrix A: деградация честно помечена');
  ok('matrix A (VLESS + Sub-ON, sequential 3): WG-цели в dropdown после каждой загрузки');

  // 18. IPv4-only contract + MTU/AWG-диагностика (web4core engine, v1.8.0):
  // dual-stack WARP-профиль → YAML без IPv6, imported MTU без изменений,
  // карточка показывает MTU/notes из web4core.analyzeWireGuardProfile.
  await page.evaluate(() => {
    const sub = document.getElementById('cfgSubMode');
    if (sub.checked) { sub.checked = false; sub.dispatchEvent(new Event('change', { bubbles: true })); }
    wgProfiles = []; wgRejected = []; syncWgCollections(); renderWgList();
    const inp = document.getElementById('mihomoInput');
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#wgFile').setInputFiles(fx('wg-warp-like.conf'));
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 1);
  await page.waitForFunction(() => dialerTargetsCache.length >= 1, null, { timeout: 10000 });
  const warpCard = await page.evaluate(() => document.querySelector('.wg-card-info').textContent);
  assert.match(warpCard, /MTU: 1200/, 'карточка показывает imported MTU: ' + JSON.stringify(warpCard));
  assert.match(warpCard, /IPv4-only contract/, 'карточка показывает IPv6-нормализацию');
  r = await build();
  assert.equal(r.state, 'VALID', 'dual-stack вход собирается VALID');
  const wgProxy = await page.evaluate(y => {
    const d = jsyaml.load(y);
    return (d.proxies || []).find(p => p.type === 'wireguard');
  }, r.yaml);
  assert.equal(wgProxy.ipv6, undefined, 'ipv6 не эмитится');
  assert.equal(wgProxy.ip, '172.16.0.2', 'IPv4 address сохранён');
  assert.deepEqual(wgProxy['allowed-ips'], ['0.0.0.0/0'], '::/0 отфильтрован');
  assert.equal(wgProxy.mtu, 1200, 'imported MTU 1200 не изменён (auto-correction выключен)');
  assert.ok(!JSON.stringify(wgProxy).includes('2606:4700'), 'никаких IPv6-строк в WG proxy');
  ok('IPv4-only contract: dual-stack вход → IPv4-only YAML, MTU passthrough, notes на карточке');

  // missing MTU + AWG I-диагностика на втором профиле
  await page.locator('#wgFile').setInputFiles(fx('wg-awg-i-like.conf'));
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 2);
  await page.waitForTimeout(300);
  const awgCard = await page.evaluate(() => document.querySelectorAll('.wg-card-info')[1].textContent);
  assert.match(awgCard, /MTU: — \(default 1408\)/, 'missing MTU: честный default 1408: ' + JSON.stringify(awgCard));
  assert.match(awgCard, /I1: signature-пакет 123 B/, 'размер I1 вычислен точно (48+13+8+54): ' + JSON.stringify(awgCard));
  ok('AWG-диагностика: missing-MTU default + I1 signature-размер на карточке');

  assert.deepEqual(errors, [], 'нет pageerror');
  console.log(`WG-dialer-selector: ${passed} проверок — PASS`);
  await browser.close();
})().catch(e => { console.error('WG-dialer-selector: FAIL —', e.message); process.exit(1); });

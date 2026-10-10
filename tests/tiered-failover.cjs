// Tiered Failover (#148, v1.10) — browser regression.
// Контракт: DEFAULT OFF = ALL PARITY; ON = tier-группы (🪜 N name), root
// «🪜 TIERED-AUTO» (fallback) первым участником GLOBAL + MATCH,<root>;
// детерминированные имена; валидация (пустое имя/эшелон, неизвестный выход,
// дубликаты); trace без секретов; stale-контракт; graph/coverage видят эшелоны.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  const build = async () => {
    await page.locator('button[onclick="buildMihomo()"]').click();
    // fail-fast пути (валидация tiered) ставят NOT_BUILT — ждём выхода из VALIDATING
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state !== 'VALIDATING', null, { timeout: 20000 });
    return page.evaluate(() => ({
      state: MIHOMO_VALIDATION_STATE.state,
      yaml: document.getElementById('mihomoOutput').value,
      toast: String(window.__lastToast || '')
    }));
  };
  const doc = yaml => page.evaluate(y => jsyaml.load(y), yaml);

  await page.locator('#cfgSubMode').uncheck();
  await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#VPS-SE\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#VPS-EE\nvless://00000000-0000-4000-8000-000000000003@192.0.2.3:443#GEODEMA-1');

  // 1. OFF = ALL PARITY: билд без включения не содержит tier-групп
  assert.equal(await page.isChecked('#cfgTieredFailover'), false, 'DEFAULT OFF');
  let r = await build();
  assert.equal(r.state, 'VALID');
  const baseline = r.yaml;
  assert.ok(!baseline.includes('TIERED-AUTO'), 'OFF: tier-групп нет');
  assert.match(baseline, /MATCH,GLOBAL/, 'OFF: MATCH,GLOBAL сохранён');
  ok('OFF: ALL PARITY — ни tier-групп, ни изменения MATCH');

  // 2. ON: два эшелона через настоящий UI-путь (select + клик), как пользователь
  await page.locator('#cfgTieredFailover').check();
  assert.equal(await page.evaluate(() => document.getElementById('tieredPanel').style.display), 'block', 'панель показана');
  assert.equal(await page.evaluate(() => (window.__tierCardsState || []).length), 3, 'дефолт: три нейтральные группы');
  await page.locator('#tierCards .tier-card').nth(2).locator('.tier-del').click(); // two-group scenario: explicitly remove unused empty card
  // Реестр целей (dialerTargetsCache) наполняется при загруженных WG/AWG —
  // загружаем два WG-профиля, они же станут участниками эшелонов.
  const fx = n => path.join(root, 'tests', 'fixtures', n);
  await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf'), fx('wg-simple-b.conf')]);
  await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 2);
  await page.waitForFunction(() => dialerTargetsCache.length > 0, null, { timeout: 15000 });
  // Флешируем отложенный scheduleDialerRefresh (250ms) от предыдущих input-событий:
  // его renderTierCards сбросил бы НЕзафиксированное значение .tier-member-select
  // между set и click (гонка воспроизведена на медленном CI-раннере 2026-10-07).
  await page.waitForTimeout(400);
  const addMember = async (cardIdx, value) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(({ i, v }) => {
        const card = document.querySelectorAll('#tierCards .tier-card')[i];
        const sel = card.querySelector('.tier-member-select');
        let opt = sel.querySelector('option[value="' + v + '"]');
        if (!opt) { opt = document.createElement('option'); opt.value = v; opt.textContent = v; sel.appendChild(opt); }
        sel.value = v;
      }, { i: cardIdx, v: value });
      await page.locator('#tierCards .tier-card').nth(cardIdx).locator('.tier-add-member').click();
      await page.waitForTimeout(60);
      const added = await page.evaluate(({ i, v }) => {
        const card = document.querySelectorAll('#tierCards .tier-card')[i];
        return Array.from(card.querySelectorAll('.tier-member li')).some(li => li.dataset.value === v);
      }, { i: cardIdx, v: value });
      if (added) return;
      await page.waitForTimeout(350); // дать дебаунсу отыграть перед повтором
    }
    throw new Error('addMember: «' + value + '» не добавился в эшелон #' + cardIdx + ' за 3 попытки');
  };
  const removeFirstMember = async cardIdx => {
    await page.locator('#tierCards .tier-card').nth(cardIdx).locator('.tier-member li .tier-member-rm').first().click();
    await page.waitForTimeout(30);
  };
  await page.locator('#tierCards .tier-card').nth(0).locator('.tier-name').fill('WARP');
  await addMember(0, 'VPS-SE');
  await addMember(0, 'VPS-EE');
  await page.locator('#tierCards .tier-card').nth(1).locator('.tier-name').fill('Commercial');
  await page.locator('#tierCards .tier-card').nth(1).locator('.tier-strategy').selectOption('url-test');
  await addMember(1, 'GEODEMA-1');
  r = await build();
  assert.equal(r.state, 'VALID');
  const d1 = await doc(r.yaml);
  const names = (d1['proxy-groups'] || []).map(g => g.name);
  assert.ok(names.includes('🪜 1 WARP'), 'tier group 1');
  assert.ok(names.includes('🪜 2 Commercial'), 'tier group 2');
  assert.ok(names.includes('🪜 TIERED-AUTO'), 'root tier group');
  const t1 = d1['proxy-groups'].find(g => g.name === '🪜 1 WARP');
  assert.equal(t1.type, 'url-test');
  assert.deepEqual(t1.proxies, ['VPS-SE', 'VPS-EE'], 'участники эшелона 1');
  const rootG = d1['proxy-groups'].find(g => g.name === '🪜 TIERED-AUTO');
  assert.equal(rootG.type, 'fallback');
  assert.deepEqual(rootG.proxies, ['🪜 1 WARP', '🪜 2 Commercial'], 'root обходит эшелоны по порядку');
  const global = d1['proxy-groups'].find(g => g.name === 'GLOBAL');
  assert.equal(global.proxies[0], '🪜 TIERED-AUTO', 'GLOBAL получает root первым участником');
  assert.ok(d1.rules.includes('MATCH,🪜 TIERED-AUTO'), 'MATCH уходит в root');
  assert.ok(!d1.rules.includes('MATCH,GLOBAL'), 'старого MATCH,GLOBAL больше нет');
  const trace = await page.evaluate(() => document.getElementById('tieredTrace').textContent);
  assert.match(trace, /Tiered Failover: 2 эшелон\(ов\), строгий приоритет → 1 WARP \[url-test × 2\] → 2 Commercial \[url-test × 1\]/, 'trace объясняет конфигурацию');
  ok('ON: tier-группы + root + GLOBAL/MATCH переписаны + trace');

  // 3. Детерминизм: rebuild → тот же YAML
  const yamlOnce = r.yaml;
  r = await build();
  assert.equal(r.yaml, yamlOnce, 'rebuild детерминирован');
  ok('детерминированная сериализация между Builds');

  // 4. Reorder ↑ меняет порядок эшелонов в YAML
  await page.locator('#tierCards .tier-card').nth(1).locator('.tier-up').click();
  await page.waitForTimeout(50);
  r = await build();
  const d2 = await doc(r.yaml);
  const root2 = d2['proxy-groups'].find(g => g.name === '🪜 TIERED-AUTO');
  assert.deepEqual(root2.proxies, ['🪜 1 Commercial', '🪜 2 WARP'], 'после ↑ Commercial первый (строгий приоритет)');
  await page.locator('#tierCards .tier-card').first().locator('.tier-down').click();
  await page.waitForTimeout(50);
  ok('reorder: ↑/↓ отражаются в YAML (строгий приоритет = порядок эшелонов)');

  // 5. Стратегия fallback внутри эшелона
  await page.locator('#tierCards .tier-card').nth(0).locator('.tier-strategy').selectOption('fallback');
  r = await build();
  const d3 = await doc(r.yaml);
  assert.equal(d3['proxy-groups'].find(g => g.name === '🪜 1 WARP').type, 'fallback', 'ordered fallback тип (карточка 0 = WARP после отката reorder)');
  ok('стратегия Ordered fallback применяется');

  // 6. Валидация: пустой эшелон → явный ❌, старый вывод не затёрт
  const prevYaml = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  await removeFirstMember(0);
  await removeFirstMember(0);
  r = await build();
  assert.equal(r.state, 'NOT_BUILT');
  assert.match(r.toast, /❌.*пуст/, 'пустой эшелон: явная ошибка');
  assert.equal(await page.evaluate(() => document.getElementById('mihomoOutput').value), prevYaml, 'старый вывод сохранён');
  ok('валидация: пустой эшелон → явный отказ, вывод не затёрт');

  // 7. Валидация: неизвестный участник (симуляция устаревшего реестра) → явный отказ
  await page.evaluate(() => {
    const card = document.querySelectorAll('#tierCards .tier-card')[0];
    const sel = card.querySelector('.tier-member-select');
    const opt = document.createElement('option'); opt.value = 'ghost-proxy'; opt.textContent = 'ghost-proxy';
    sel.appendChild(opt); sel.value = 'ghost-proxy';
  });
  await page.locator('#tierCards .tier-card').nth(0).locator('.tier-add-member').click();
  r = await build();
  assert.match(r.toast, /не найден в текущей сборке/, 'неизвестный выход назван');
  ok('валидация: неизвестный участник → явный отказ');

  // 8. Stale: правка имени эшелона после Build → STALE
  await removeFirstMember(0);       // убираем ghost-proxy
  await addMember(0, 'VPS-SE');     // эшелон снова валиден
  await build();
  await page.fill('#tierCards .tier-card .tier-name', 'Commercial-X');
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.getElementById('staleBuildWarn').style.display === 'block'), true, 'правка эшелона → STALE');
  await build();
  assert.equal(await page.evaluate(() => document.getElementById('staleBuildWarn').style.display === 'block'), false, 'Build → fresh');
  ok('stale-контракт охватывает эшелоны');

  // 9. Dependency graph видит tier-группы (typed nodes, integrity)
  const graphCheck = await page.evaluate(() => {
    const d = jsyaml.load(document.getElementById('mihomoOutput').value);
    const g = cdgBuildGraph(d);
    const ids = new Set(g.nodes.map(n => n.id));
    const problems = [];
    if (ids.size !== g.nodes.length) problems.push('dup ids');
    for (const e of g.edges) { if (!ids.has(e.from)) problems.push(e.from); if (!ids.has(e.to)) problems.push(e.to); }
    return { hasTier: g.nodes.some(n => n.kind === 'proxy-group' && n.name && n.name.includes('🪜')), problems };
  });
  assert.equal(graphCheck.hasTier, true, 'graph: tier-группы как proxy-group nodes');
  assert.deepEqual(graphCheck.problems, [], 'graph: referential integrity сохранена');
  ok('Config Dependency Graph: эшелоны попадают в граф с integrity');

  // 10. Inspector semantic path через root
  await page.locator('#cfgPolicyRouting').check();
  await page.locator('#policyPresetSelect').selectOption('ai');
  await page.locator('#btnPolicyAdd').click();
  await build();
  await page.evaluate(() => { document.getElementById('routingDiagnostics').open = true; });
  const preview = await page.locator('#rdPreview').textContent();
  assert.match(preview, /\[Приоритет\] TIERED-AUTO/, 'Inspector: readable semantic path through the unchanged YAML tier root');
  assert.match(preview, /Фактически выбранный участник определяется Mihomo во время работы/, 'runtime-selected честность');
  ok('Inspector: semantic path показывает tier root без ложного runtime-claim');

  // 11. Privacy: имена эшелонов/участников — без секретов (ключи только в proxies)
  const privacyProbe = await page.evaluate(() => {
    const texts = [document.getElementById('tieredTrace').textContent, document.getElementById('tieredPanel').textContent].join('|');
    return texts;
  });
  assert.ok(!privacyProbe.includes('private-key'), 'trace/панель не содержат ключевых слов секретов');
  ok('privacy: панель/trace содержат только имена');

  // 12. 360px: панель эшелонов без overflow (+ 320/412/480 мобильная сетка #165)
  for (const w of [320, 360, 412, 480]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(120);
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(o.sw <= o.iw + 1, w + 'px: нет горизонтального overflow (' + o.sw + ' vs ' + o.iw + ')');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  ok('320/360/412/480 layout: без overflow');

  // 13. UX-контракт #165: компактные контролы, disabled ↑/↓ на краях, destructive-стиль,
  //     единый «＋ Добавить эшелон», стратегия/имя — визуально главное
  const ux = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#tierCards .tier-card'));
    const up0 = cards[0].querySelector('.tier-up');
    const downLast = cards[cards.length - 1].querySelector('.tier-down');
    const del = cards[0].querySelector('.tier-del');
    const styleOf = el => getComputedStyle(el);
    return {
      cardCount: cards.length,
      up0Disabled: up0.disabled,
      downLastDisabled: downLast.disabled,
      upAria: up0.getAttribute('aria-label'),
      delAria: del.getAttribute('aria-label'),
      delBg: styleOf(del).backgroundImage,
      upBg: styleOf(up0).backgroundImage,
      addLevel: document.getElementById('btnTierAdd').textContent,
      delDistinct: styleOf(del).backgroundImage !== styleOf(up0).backgroundImage,
      compact: styleOf(up0).paddingTop
    };
  });
  assert.equal(ux.cardCount >= 2, true, 'карточки на месте');
  assert.equal(ux.up0Disabled, true, 'первый эшелон: ↑ disabled');
  assert.equal(ux.downLastDisabled, true, 'последний эшелон: ↓ disabled');
  assert.ok(ux.upAria && ux.delAria, 'aria-labels сохранены');
  assert.equal(ux.addLevel.includes('Добавить эшелон'), true, 'единый «＋ Добавить эшелон»: ' + ux.addLevel);
  assert.equal(ux.delDistinct, true, 'destructive delete визуально отличён от neutral');
  assert.notEqual(ux.delBg, ux.upBg, 'destructive delete: другой background');
  assert.match(ux.compact, /^2px$/, 'компактные контролы (padding-top ' + ux.compact + ')');
  ok('UX #165: disabled ↑/↓ на краях, destructive-стиль, единый add-контрол, compact');

  // 14. ПРОДУКТ-ФИКС race #165: select участника → debounced re-render → выбор сохранён → Add работает
  await page.locator('#tierCards .tier-card').nth(1).locator('.tier-name').fill('RaceTier');
  // выбираем значение программно (как пользовательский select)
  await page.evaluate(() => {
    const sel = document.querySelectorAll('#tierCards .tier-card')[1].querySelector('.tier-member-select');
    const v = sel.options[1] ? sel.options[1].value : '';
    sel.value = v;
    sel.dispatchEvent(new Event('input', { bubbles: true })); // как реальный выбор пользователя
    window.__raceProbe = v;
  });
  // внеочередной re-render (то, что делает debounced refreshWgTargetSelectors)
  await page.evaluate(() => renderTierCards());
  const raceSel = await page.evaluate(() => {
    const sel = document.querySelectorAll('#tierCards .tier-card')[1].querySelector('.tier-member-select');
    return { value: sel.value, expected: window.__raceProbe };
  });
  assert.equal(raceSel.value, raceSel.expected, 'pendingSelect пережил re-render: ' + JSON.stringify(raceSel));
  await page.locator('#tierCards .tier-card').nth(1).locator('.tier-add-member').click();
  await page.waitForTimeout(40);
  const raceMember = await page.evaluate(() => {
    const card = document.querySelectorAll('#tierCards .tier-card')[1];
    const v = window.__raceProbe;
    return Array.from(card.querySelectorAll('.tier-member li')).some(li => li.dataset.value === v);
  });
  assert.equal(raceMember, true, 'Add добавил именно сохранённое значение');
  // чистка: убрать добавленного участника, чтобы не влиял на следующие сценарии
  await page.evaluate(() => {
    const card = document.querySelectorAll('#tierCards .tier-card')[1];
    card.querySelector('.tier-member li .tier-member-rm').click();
  });
  await page.waitForTimeout(40);
  ok('race #165 (продукт): select → re-render → выбор сохранён → Add добавляет его');

  // 15. P2 UX v1.11 (#160): явная «＋ Добавить» + hint «выбор ещё не добавляет»
  {
    const p2 = await page.evaluate(() => {
      const btn = document.querySelector('#tierCards .tier-card .tier-add-member');
      const hint = document.querySelector('#tierCards .tier-card .hint');
      return { addText: btn ? btn.textContent : '', hintText: hint ? hint.textContent : '' };
    });
    assert.equal(p2.addText, '＋ Добавить', 'явная текстовая кнопка добавления: ' + JSON.stringify(p2.addText));
    assert.ok(p2.hintText.includes('ещё не добавляет'), 'hint про то, что выбор сам не добавляет: ' + JSON.stringify(p2.hintText));
    ok('P2 UX: текстовая «＋ Добавить» + hint');
  }

  // 16. P2 UX v1.11 (#160): дубликат выхода между эшелонами → warning-lint, не build-ошибка
  {
    await page.evaluate(() => {
      window.__tierCardsState = [
        { name: 'DupA', strategy: 'url-test', members: ['probe-target-x'] },
        { name: 'DupB', strategy: 'url-test', members: ['probe-target-x'] }
      ];
      renderTierCards();
    });
    const dup = await page.evaluate(() => {
      const b = document.getElementById('tierDupWarn');
      return { visible: !!b && b.style.display !== 'none', text: b ? b.textContent : '' };
    });
    assert.equal(dup.visible, true, 'дубликат-линт показан');
    assert.ok(dup.text.includes('DupA') && dup.text.includes('DupB'), 'линт называет оба эшелона: ' + JSON.stringify(dup.text));
    assert.ok(dup.text.includes('допустимо'), 'линт помечает конфигурацию легальной (не ERROR)');
    await page.evaluate(() => { window.__tierCardsState[1].members = []; renderTierCards(); });
    assert.equal(await page.evaluate(() => document.getElementById('tierDupWarn').style.display === 'none'), true, 'без дубликатов линт скрыт');
    ok('P2 UX: дубликат выхода между эшелонами → warning-lint');
  }

  // 17. P2 UX v1.11 (#160): дефолтные имена эшелонов («Резервные выходы» вместо «Personal»)
  {
    await page.evaluate(() => { window.__tierCardsState = []; });
    await page.locator('#cfgTieredFailover').uncheck();
    await page.locator('#cfgTieredFailover').check();
    const names = await page.evaluate(() => (window.__tierCardsState || []).map(t => t.name));
    assert.deepEqual(names, ['Основные выходы', 'Резервные выходы', 'Дополнительные выходы'], 'дефолтные имена: ' + JSON.stringify(names));
    ok('P2 UX: дефолт «Резервные выходы»');
  }

  assert.deepEqual(errors, [], 'no page errors');
  passed += 1;

  console.log('Tiered Failover: ' + passed + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

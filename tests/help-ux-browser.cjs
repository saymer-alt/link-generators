// Help/UX contract: quick-start link + ?-help markers. Без изменений генерации.
// Запуск: NODE_PATH=<playwright> node tests/help-ux-browser.cjs [JS_YAML_PATH=…]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  console.log('Help-UX: launching');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, timeout: 30000 });
  let passed = 0;
  const ok = (name) => { passed++; console.log('  ok —', name); };
  try {
    // --- статические контракты файлов ---
    const qsPath = path.join(root, 'quick-start.html');
    assert.ok(fs.existsSync(qsPath), 'quick-start.html существует');
    const qsSrc = fs.readFileSync(qsPath, 'utf8');
    assert.ok(!/<script/i.test(qsSrc), 'quick-start.html читается без JS (нет <script>)');
    for (const banned of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'sessionStorage']) {
      assert.ok(!qsSrc.includes(banned), 'quick-start.html без ' + banned);
    }
    ok('quick-start.html: статическая, без JS/телеметрии');
    assert.ok(/href="index\.html"/.test(qsSrc), 'обратная ссылка на генератор');
    const qsHrefs = (qsSrc.match(/href="([^"]+)"/g) || []).map(m => m.slice(6, -1));
    const qsRawMd = qsHrefs.filter(h => /\.md$/.test(h) && !h.startsWith('https://github.com/'));
    assert.deepEqual(qsRawMd, [], 'нет relative/raw .md ссылок в quick-start.html');
    ok('quick-start.html: подробные .md только через GitHub rendered');

    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

    // --- ссылка на quick-start в Builder ---
    assert.ok(await page.locator('a[href="quick-start.html"]').count() >= 1, 'ссылка quick-start.html в Builder');
    ok('Builder: ссылка «❓ Помощь / Быстрый старт» присутствует');

    // Pages link contract: короткая инструкция = quick-start.html; пользовательский HTML
    // не содержит relative docs/*.md (на Pages они отдаются как raw Markdown).
    const shortGuide = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(x => /Короткая инструкция/.test(x.textContent || ''));
      return a ? a.getAttribute('href') : null;
    });
    assert.equal(shortGuide, 'quick-start.html', '«Короткая инструкция» ведёт на quick-start.html');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const idxHrefs = (html.match(/href="([^"]+)"/g) || []).map(m => m.slice(6, -1));
    const rawMd = idxHrefs.filter(h => /\.md$/.test(h) && !h.startsWith('https://github.com/'));
    assert.deepEqual(rawMd, [], 'нет relative/raw .md ссылок в index.html');
    ok('link contract: короткая инструкция → quick-start.html, raw .md отсутствуют');

    // --- help-маркеры существуют ---
    const helpCount = await page.locator('.ctx-help').count();
    assert.ok(helpCount >= 11, 'help-маркеров >= 11 (настройки + ping + gateway), получено ' + helpCount);
    ok('help-маркеры .ctx-help установлены: ' + helpCount);

    // --- клик открывает и НЕ меняет чекбокс ---
    const tun = page.locator('#cfgTun');
    const tunBefore = await tun.isChecked();
    const wrap = page.locator('.ctx-help-wrap', { has: page.locator('.ctx-help[aria-label="Подсказка: TUN Interface"]') });
    await wrap.locator('.ctx-help').click();
    assert.equal(await wrap.getAttribute('class'), 'ctx-help-wrap open', 'клик открывает подсказку');
    assert.equal(await wrap.locator('.ctx-help').getAttribute('aria-expanded'), 'true', 'aria-expanded=true');
    assert.equal(await tun.isChecked(), tunBefore, 'клик по «?» не меняет чекбокс');
    ok('клик по «?» открывает, состояние чекбокса неизменно');

    // --- клавиатура: Enter открыть, Escape закрыть ---
    await page.locator('.ctx-help[aria-label="Подсказка: MIPS stack"]').focus();
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('.ctx-help-wrap.open .ctx-help[aria-label="Подсказка: MIPS stack"]').count() === 1, 'Enter открывает');
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('.ctx-help-wrap.open').count() === 0, 'Escape закрывает');
    ok('клавиатура: Enter/Escape работают');

    // --- клик вне закрывает; открытой остаётся только одна ---
    await wrap.locator('.ctx-help').click();
    await page.locator('.ctx-help[aria-label="Подсказка: Allow LAN"]').click();
    assert.ok(await page.locator('.ctx-help-wrap.open').count() === 1, 'открыта одна подсказка');
    await page.locator('h1').click();
    assert.ok(await page.locator('.ctx-help-wrap.open').count() === 0, 'клик снаружи закрывает');
    ok('взаимоисключение подсказок + закрытие снаружи');

    // --- DPR off-подсказка ---
    assert.ok(await page.locator('#policyRoutingOffHint').isVisible(), 'DPR-подсказка видна в выключенном состоянии');
    await page.locator('#cfgPolicyRouting').check();
    assert.ok(!(await page.locator('#policyRoutingOffHint').isVisible()), 'DPR-подсказка скрыта при включённом режиме');
    assert.ok(await page.locator('#policyRoutingPanel').isVisible(), 'DPR-панель видна');
    await page.locator('#cfgPolicyRouting').uncheck();
    assert.ok(await page.locator('#policyRoutingOffHint').isVisible(), 'DPR-подсказка возвращается');
    ok('DPR: короткая подсказка в off-состоянии + переключение');

    // --- gateway-подсказки ---
    await page.selectOption('#cfgProfile', 'vps-gateway');
    assert.ok(await page.locator('#vpsPanel').isVisible(), 'gateway-панель видна');
    const gwHelp = await page.locator('#vpsPanel .ctx-help').count();
    assert.ok(gwHelp >= 4, 'gateway: >= 4 help-маркеров, получено ' + gwHelp);
    ok('gateway-панель: подсказки полей присутствуют (' + gwHelp + ')');
    await page.selectOption('#cfgProfile', 'router');

    // --- YAML до/после help-взаимодействия идентичен ---
    await page.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\ntrojan://t@192.0.2.2:443#B');
    await page.locator('#cfgSubMode').uncheck(); // обычные ссылки — режим подписок выключить (штатный guard)
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID');
    const yaml1 = await page.evaluate(() => document.getElementById('mihomoOutput').value);
    await page.locator('.ctx-help[aria-label="Подсказка: TUN Interface"]').click();
    await page.locator('.ctx-help[aria-label="Подсказка: TUN Interface"]').click();
    await page.locator('button[onclick="buildMihomo()"]').click();
    await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID');
    const yaml2 = await page.evaluate(() => document.getElementById('mihomoOutput').value);
    assert.equal(yaml1, yaml2, 'YAML до/после help-взаимодействия идентичен');
    ok('генерация не изменена help-взаимодействием');

    // --- HOVER-контракт (v1.6.2 regression): tooltip открывается hover'ом
    // (CSS :hover/:focus-within), закрывается mouseleave, click/touch — .open
    const popOf = label => page.locator('.ctx-help-wrap', { has: page.locator(`.ctx-help[aria-label="${label}"]`) }).locator('.ctx-help-pop');
    const visOf = async label => {
      const wrap = page.locator('.ctx-help-wrap', { has: page.locator(`.ctx-help[aria-label="${label}"]`) });
      return wrap.evaluate(w => {
        const pop = w.querySelector('.ctx-help-pop');
        return pop && getComputedStyle(pop).display !== 'none';
      });
    };
    const hoverLabel = 'Подсказка: Mixed Port';
    await page.hover(`.ctx-help[aria-label="${hoverLabel}"]`);
    assert.equal(await visOf(hoverLabel), true, 'hover открывает tooltip (CSS)');
    await page.mouse.move(10, 10); // mouseleave
    assert.equal(await visOf(hoverLabel), false, 'mouseleave закрывает hover-tooltip');
    ok('hover: tooltip открывается наведением и закрывается уходом курсора');

    // focus-within: фокус клавиатуры открывает, уход фокуса закрывает
    const focusLabel = 'Подсказка: Allow LAN';
    await page.locator(`.ctx-help[aria-label="${focusLabel}"]`).focus();
    assert.equal(await visOf(focusLabel), true, 'фокус кнопки «?» открывает tooltip (:focus-within)');
    await page.locator('#mihomoInput').focus();
    assert.equal(await visOf(focusLabel), false, 'уход фокуса закрывает focus-tooltip');
    ok('клавиатура: фокус на «?» показывает tooltip (:focus-within)');

    // hover + click не конфликтуют: клик фиксирует (.open), mouseleave НЕ закрывает
    await wrap.locator('.ctx-help').hover();
    await wrap.locator('.ctx-help').click();
    await page.mouse.move(10, 10);
    assert.equal(await visOf('Подсказка: TUN Interface'), true, '.open держит tooltip после mouseleave');
    await page.keyboard.press('Escape');
    assert.equal(await visOf('Подсказка: TUN Interface'), false, 'Escape закрывает .open (вне hover)');
    ok('hover/click конфликтов нет: .open переживает mouseleave, Escape закрывает');

    // --- новые подсказки v1.6.2 присутствуют ---
    const expectedHelps = [
      'Подсказка: Использовать URL-подписки',
      'Подсказка: Автоматический режим белых списков',
      'Подсказка: Отдельный вход на каждый прокси',
      'Подсказка: Импорт MagiTrickle',
    ];
    for (const label of expectedHelps) {
      assert.ok(await page.locator(`.ctx-help[aria-label="${label}"]`).count() === 1, 'подсказка присутствует: ' + label);
    }
    ok('новые подсказки v1.6.2: Sub Mode, БС, Per-Proxy master, MagiTrickle import');
    // WG-карточечные подсказки создаются динамически при загрузке профиля
    await page.locator('#wgFile').setInputFiles(path.join(root, 'tests', 'fixtures', 'wg-simple-a.conf'));
    await page.waitForFunction(() => wgUploadPending === false && wgProfiles.length === 1);
    const cardHelps = await page.evaluate(() => Array.from(document.querySelectorAll('#wgList .ctx-help[aria-label]')).map(b => b.getAttribute('aria-label')));
    assert.ok(cardHelps.some(l => l.includes('Подключение')), 'карточка WG: подсказка «Подключение»');
    assert.ok(cardHelps.some(l => l.includes('Промежуточный выход')), 'карточка WG: подсказка «Промежуточный выход»');
    // текст §22: пример Endpoint-соединения и только существующие цели
    const targetPop = await page.evaluate(() => {
      const btn = document.querySelector('#wgList .ctx-help[aria-label="Подсказка: Промежуточный выход"]');
      const wrap = btn && btn.closest('.ctx-help-wrap');
      const pop = wrap && wrap.querySelector('.ctx-help-pop');
      return pop ? pop.textContent : '';
    });
    assert.match(targetPop, /Endpoint/, 'подсказка таргета объясняет Endpoint-соединение');
    assert.match(targetPop, /существуют в текущей конфигурации/, 'подсказка таргета: только существующие цели');
    // MT mapping-подсказка появляется в preview
    await page.locator('#cfgPolicyRouting').check();
    await page.locator('#mtImportBtn').click();
    await page.locator('#mtImportFile').setInputFiles(path.join(root, 'tests', 'fixtures', 'magitrickle-basic.mtrickle'));
    await page.waitForFunction(() => mtPending !== null && mtPending.preview.activeRules > 0);
    const mapHelp = await page.evaluate(() => {
      const box = document.getElementById('mtImportMapping');
      return box ? box.querySelector('.ctx-help-pop') : null;
    });
    assert.ok(mapHelp, 'MagiTrickle: подсказка у маппинга интерфейсов');
    await page.locator('#mtImportCancel').click();
    await page.locator('#cfgPolicyRouting').uncheck();
    ok('динамические подсказки: WG-карточки (Подключение/Промежуточный выход) + MT-маппинг');

    assert.deepEqual(errors, [], 'нет pageerror');
    console.log(`Help-UX: ${passed} проверок — PASS`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error('Help-UX: FAIL —', error.message); process.exit(1); });

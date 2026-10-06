// Mobile top-tabs regression (#142) — geometry vs container, not just scrollWidth.
// Root cause: обе вкладки в строку помещаются только с ~447px; stack-брейкпоинт
// был ≤390, зона 391–446px выталкивала «⚙️ Mihomo Config Builder» за контейнер
// (document scrollWidth при этом рос, но generic-проверка overflow тестировалась
// только на 360/768/1280 и dead zone пропускала).
// Контракт: на 320/360/390/412/480 вкладки стеком (обе внутри .container, видимы,
// кликабельны); на 768/desktop — горизонтальный ряд внутри контейнера; переключение
// вкладок работает на всех ширинах; active-стили сохраняются.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const WIDTHS = [320, 360, 390, 412, 480, 768, 1280];
const TOL = 1.5; // subpixel rounding

let cases = 0;
const ok = name => { cases++; console.log('  ok —', name); };

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 850 });
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const cont = document.querySelector('.container').getBoundingClientRect();
      const tabs = Array.from(document.querySelectorAll('.tab')).map(t => {
        const b = t.getBoundingClientRect();
        return { text: t.textContent.trim(), left: b.left, right: b.right, top: b.top, height: b.height, visible: b.height > 0 && b.width > 0 };
      });
      const st = getComputedStyle(document.querySelector('.tabs'));
      return {
        iw: window.innerWidth,
        contLeft: cont.left, contRight: cont.right,
        tabs,
        stacked: st.flexWrap === 'wrap',
        docSW: document.documentElement.scrollWidth
      };
    });
    // геометрия обеих вкладок внутри контейнера
    for (const t of m.tabs) {
      assert.ok(t.left >= m.contLeft - TOL, w + 'px: "' + t.text.slice(0, 16) + '" left=' + Math.round(t.left) + ' < contLeft=' + Math.round(m.contLeft));
      assert.ok(t.right <= m.contRight + TOL, w + 'px: "' + t.text.slice(0, 16) + '" right=' + Math.round(t.right) + ' > contRight=' + Math.round(m.contRight) + ' (за контейнером)');
      assert.ok(t.visible && t.height > 10, w + 'px: вкладка видима и ненулевой высоты');
    }
    // document не порождает неожиданного горизонтального overflow
    assert.ok(m.docSW <= m.iw + TOL, w + 'px: document scrollWidth=' + m.docSW + ' > innerWidth=' + m.iw);
    // контракт стека: ≤480 стек, >480 строка (desktop/tablet поведение сохранено)
    if (w <= 480) assert.equal(m.stacked, true, w + 'px: вкладки должны быть стеком (≤480)');
    else assert.equal(m.stacked, false, w + 'px: >480 — горизонтальный ряд сохранён');
    // переключение вкладок работает в обе стороны на каждой ширине
    await page.locator('button.tab', { hasText: 'WARP MASQUE Links' }).click();
    assert.ok(await page.locator('#tab-warp').evaluate(el => el.classList.contains('active')), w + 'px: switch → WARP');
    await page.locator('button.tab', { hasText: 'Mihomo Config Builder' }).click();
    assert.ok(await page.locator('#tab-mihomo').evaluate(el => el.classList.contains('active')), w + 'px: switch → Mihomo');
    // active-стиль очевиден (background отличается от неактивной)
    const activeDiff = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tab'));
      const act = tabs.find(t => t.classList.contains('active'));
      const inact = tabs.find(t => !t.classList.contains('active'));
      return act && inact && getComputedStyle(act).backgroundColor !== getComputedStyle(inact).backgroundColor;
    });
    assert.ok(activeDiff, w + 'px: active tab визуально отличим');
    ok(w + 'px: геометрия внутри контейнера, стек=' + m.stacked + ', переключение/active ок');
  }

  // 320/360: длинный label второй вкладки полностью виден (не обрезан) —
  // проверяем через scrollWidth самого таба (при обрезании текста flex-элементом
  // с overflow он был бы меньше scrollWidth)
  for (const w of [320, 360]) {
    await page.setViewportSize({ width: w, height: 850 });
    await page.waitForTimeout(120);
    const fits = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.tab')).find(x => x.textContent.includes('Mihomo Config Builder'));
      return { sw: t.scrollWidth, cw: t.clientWidth };
    });
    assert.ok(fits.cw + 1 >= fits.sw, w + 'px: label «Mihomo Config Builder» не обрезан (client ' + fits.cw + ' >= scroll ' + fits.sw + ')');
    ok(w + 'px: длинный label полностью виден');
  }

  assert.deepEqual(errors, [], 'no page errors');
  cases += 1;

  console.log('Mobile tabs regression: ' + cases + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

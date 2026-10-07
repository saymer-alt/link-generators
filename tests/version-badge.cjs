// Version badge + legacy health-check fallback — regression.
// Node-гвард: ровно один production source-of-truth (GENERATOR_META), бейдж без хардкода.
// Browser: бейдж виден сразу, derives from GENERATOR_META, narrow viewport, клик ничего
// не меняет; forced-empty #pingSelect при Build откатывается на gstatic (не google).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let cases = 0;

// --- Node-side guard: single source-of-truth ---
{
  assert.equal((html.match(/const GENERATOR_META = Object\.freeze/g) || []).length, 1, 'GENERATOR_META определяется ровно один раз');
  assert.equal((html.match(/version:\s*'1\.10\.0-dev'/g) || []).length, 1, 'version-литерал живёт только в GENERATOR_META');
  assert.equal((html.match(/channel:\s*'main'/g) || []).length, 1, 'channel-литерал живёт только в GENERATOR_META');
  assert.match(html, /<span id="genVersionBadge"[^>]*><\/span>/, 'бейдж пуст в HTML — текст приходит из GENERATOR_META');
  assert.ok(!/https:\/\/google\.com\/generate_204/.test(html), 'в production index.html нет legacy google fallback');
  cases += 5;
}

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(process.cwd(), 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  // Badge visible immediately + derives from GENERATOR_META
  const badge = page.locator('#genVersionBadge');
  assert.equal(await badge.isVisible(), true, 'badge visible после загрузки'); cases += 1;
  assert.equal(await badge.textContent(), 'v1.10.0-dev · MAIN'); cases += 1;
  const meta = await page.evaluate(() => ({
    // const в classic script не создаёт свойство globalThis — читаем глобальный lexical binding
    present: typeof GENERATOR_META !== 'undefined',
    frozen: typeof GENERATOR_META !== 'undefined' && Object.isFrozen(GENERATOR_META),
    version: typeof GENERATOR_META !== 'undefined' ? GENERATOR_META.version : undefined,
    channel: typeof GENERATOR_META !== 'undefined' ? GENERATOR_META.channel : undefined,
    derived: typeof GENERATOR_META !== 'undefined' ? 'v' + GENERATOR_META.version + ' · ' + GENERATOR_META.channel.toUpperCase() : null,
    title: document.getElementById('genVersionBadge').title
  }));
  assert.equal(meta.present, true, 'GENERATOR_META доступен странице');
  assert.equal(meta.frozen, true, 'GENERATOR_META frozen');
  assert.equal(meta.version, '1.10.0-dev');
  assert.equal(meta.channel, 'main');
  assert.equal(meta.derived, await badge.textContent(), 'badge text derives from GENERATOR_META');
  assert.equal(meta.title, 'Generator version 1.10.0-dev, channel main', 'accessible title из GENERATOR_META');
  cases += 5;

  // Narrow viewport: no horizontal overflow, badge still visible
  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, badgeVisible: !!document.getElementById('genVersionBadge').offsetParent }));
  assert.ok(overflow.sw <= overflow.iw + 1, 'narrow viewport: нет горизонтального overflow (' + overflow.sw + ' vs ' + overflow.iw + ')');
  assert.equal(overflow.badgeVisible, true, 'badge виден на narrow viewport');
  cases += 2;
  await page.setViewportSize({ width: 1280, height: 800 });

  // Production build; badge interaction and reading must not alter YAML
  await page.locator('#cfgSubMode').uncheck();
  await page.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#B');
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const yaml1 = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  await badge.click();
  await badge.hover();
  const yaml2 = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.equal(yaml2, yaml1, 'badge click/hover не меняет generated YAML');
  assert.equal(await badge.textContent(), 'v1.10.0-dev · MAIN', 'badge не меняется от клика');
  cases += 2;

  // Fallback: forced empty #pingSelect → Build → gstatic (не legacy google)
  await page.evaluate(() => { document.getElementById('pingSelect').value = ''; });
  assert.equal(await page.evaluate(() => document.getElementById('pingSelect').value), '', 'pingSelect принудительно пуст');
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state), null, { timeout: 20000 });
  const yaml3 = await page.evaluate(() => document.getElementById('mihomoOutput').value);
  assert.match(yaml3, /url: "?https:\/\/www\.gstatic\.com\/generate_204"?/, 'fallback даёт gstatic');
  assert.ok(!yaml3.includes('https://google.com/generate_204'), 'legacy google fallback не появляется'); cases += 2;

  assert.deepEqual(errors, [], 'no page errors'); cases += 1;
  console.log('Version-badge: ' + cases + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

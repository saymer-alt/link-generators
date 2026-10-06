// NIGHT-12: docs HTML smoke — сгенерированные страницы документации.
// Подаётся docs-html из репо через локальный статический сервер; проверяются
// index hub, GENERATOR-GUIDE, GIST-SUBSCRIPTION, WARPSCOUT-VPS: заголовок,
// навигация, заголовки-якоря, таблицы/код, 360px, отсутствие внешних запросов
// (js-yaml CDN — текущая архитектура) и console errors.
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DOCS_HTML = path.join(ROOT, 'docs');
const PORT = 8123;
let cases = 0;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.md': 'text/markdown', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/docs/' || p === '/docs') p = '/docs/index.html';
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${PORT}/`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(15000);
  const consoleErrors = [];
  const external = [];
  page.on('pageerror', e => consoleErrors.push(String(e && e.message || e)));
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith('https://cdn.jsdelivr.net/')) external.push(u);
  });

  const open = async (rel) => {
    await page.goto(BASE + rel, { waitUntil: 'load' });
    await page.waitForTimeout(120);
    return {
      title: await page.title(),
      h2: await page.locator('h2').count(),
      code: await page.locator('pre').count(),
      table: await page.locator('table').count(),
      navLinks: await page.locator('nav.top a').count(),
    };
  };

  // 1. docs hub
  const hub = await open('/docs/index.html');
  assert.ok(hub.title.includes('Документация'), 'hub title');
  assert.ok(hub.navLinks >= 3, 'hub навигация присутствует');
  assert.ok(hub.h2 >= 4, 'hub категории (h2) на месте');
  cases += 3;

  // 2. GENERATOR-GUIDE: заголовки, код, таблицы, якоря, nav «Генератор»
  const guide = await open('/docs/GENERATOR-GUIDE.html');
  assert.ok(guide.title.includes('инструкц'), 'GUIDE title');
  assert.ok(guide.code >= 1, 'GUIDE: код-блоки есть');
  assert.ok(guide.table >= 1, 'GUIDE: таблицы есть');
  assert.ok(guide.navLinks >= 3, 'GUIDE: навигация');
  const guideGen = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('nav.top a')).find(a => a.textContent.includes('Генератор'));
    return a ? a.getAttribute('href') : null;
  });
  assert.equal(guideGen, '../index.html', '«Генератор» ведёт на корень генератора (docs/ на уровень ниже)');
  cases += 4;

  // 3. GIST-SUBSCRIPTION: код-блоки + security notes
  const gist = await open('/docs/GIST-SUBSCRIPTION.html');
  assert.ok(gist.title.length > 0);
  assert.ok(gist.code >= 1, 'GIST: код присутствует');
  cases += 2;

  // 4. WARPSCOUT-VPS: команды не искажены (< > экранированы, а не исполнены)
  const ws = await open('/docs/WARPSCOUT-VPS.html');
  assert.ok(ws.title.includes('WARPSCOUT'), 'WARPSCOUT-VPS title');
  const wsBody = await page.locator('.wrap').innerHTML();
  assert.ok(!/<script/i.test(wsBody), 'нет script в контенте страницы');
  cases += 2;

  // 5. Внутренняя ссылка .md → .html перезаписана (пример: ссылка на VALIDATION)
  await open('/docs/GENERATOR-GUIDE.html');
  const mdLinksLeft = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.wrap a')).filter(a => {
      const href = a.getAttribute('href') || '';
      // проверяем только docs/*.md ссылки; ссылки на developer-доки в tools/
      // остаются GitHub/raw (контракт NIGHT-12)
      return /\.md($|#)/.test(href) && !a.classList.contains('gh') && href.includes('/docs/');
    }).map(a => a.getAttribute('href')));
  // допускаются только внешние GitHub-source ссылки (класс gh), не голые .md href внутри контента
  assert.equal(mdLinksLeft.length, 0, '.md ссылки в контенте переписаны в .html: ' + JSON.stringify(mdLinksLeft));
  cases += 1;

  // 6. 360px: нет горизонтального overflow на index и guide
  await page.setViewportSize({ width: 360, height: 740 });
  for (const rel of ['/docs/index.html', '/docs/GENERATOR-GUIDE.html']) {
    await page.goto(BASE + rel, { waitUntil: 'load' });
    await page.waitForTimeout(100);
    const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(sw.sw <= sw.iw + 1, '360px: нет overflow на ' + rel + ' (' + sw.sw + ' > ' + sw.iw + ')');
    cases += 1;
  }

  // 7. Консоль без ошибок; внешние запросы только js-yaml CDN
  assert.deepEqual(consoleErrors, [], 'нет page errors: ' + JSON.stringify(consoleErrors));
  const ext = external.filter(u => !u.startsWith('https://cdn.jsdelivr.net/'));
  assert.deepEqual(ext, [], 'нет неожиданных внешних запросов: ' + JSON.stringify(ext));
  cases += 2;

  console.log('Docs HTML smoke: ' + cases + ' cases passed');
  await browser.close();
  server.close();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); server.close(); process.exit(1); });

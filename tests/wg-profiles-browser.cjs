// WG/AWG profiles contract: append-модель загрузки, список, удаление, дедуп, race.
// Запуск: NODE_PATH=<playwright> JS_YAML_PATH=… node tests/wg-profiles-browser.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fx = n => path.join(__dirname, 'fixtures', n);

(async () => {
  console.log('WG-profiles: launching');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, timeout: 30000 });
  let passed = 0;
  const ok = name => { passed++; console.log('  ok —', name); };
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
    await page.evaluate(() => {
      const originalToast = window.showToast;
      window.showToast = function (msg, isErr) { window.__lastToast = msg; return originalToast.call(this, msg, isErr); };
    });
    await page.locator('#cfgSubMode').uncheck();
    const waitLoaded = n => page.waitForFunction(len => wgUploadPending === false && wgBeans.length === len, n);
    const build = async () => {
      await page.locator('button[onclick="buildMihomo()"]').click();
      await page.waitForFunction(() => ['VALID', 'INVALID'].includes(MIHOMO_VALIDATION_STATE.state));
      return page.evaluate(() => ({ state: MIHOMO_VALIDATION_STATE.state, yaml: document.getElementById('mihomoOutput').value }));
    };
    const wgNames = y => (y.match(/^  - name: (.+)$/gm) || []).map(l => l.replace('  - name: ', '').trim()).filter(n => !['⚡ Fastest', 'GLOBAL', 'WARP-DIALER'].includes(n));

    // single WG
    await page.locator('#wgFile').setInputFiles(fx('wg-simple-a.conf'));
    await waitLoaded(1);
    let r = await build();
    assert.equal(r.state, 'VALID');
    assert.deepEqual(wgNames(r.yaml), ['wg-simple-a']);
    ok('single WG: 1 proxy, VALID');

    // picker cancel (0 файлов) — no-op, ничего не стёрто
    await page.locator('#wgFile').setInputFiles([]);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => wgBeans.length), 1, 'cancel не стирает профили');
    ok('отмена picker (0 файлов) — no-op');

    // sequential append: A затем B → 2
    await page.locator('#wgFile').setInputFiles(fx('wg-simple-b.conf'));
    await waitLoaded(2);
    r = await build();
    assert.equal(r.state, 'VALID');
    assert.deepEqual(wgNames(r.yaml).sort(), ['wg-simple-a', 'wg-simple-b']);
    ok('последовательная загрузка — APPEND (A+B)');

    // список загруженных: имена файлов видны, ключей нет
    const listText = await page.locator('#wgList').innerText();
    assert.match(listText, /wg-simple-a\.conf/);
    assert.match(listText, /wg-simple-b\.conf/);
    const pageHtml = await page.evaluate(() => document.getElementById('wgList').innerHTML);
    assert.ok(!/PrivateKey|private-key|KAaHq|PresharedKey/i.test(listText + pageHtml), 'в списке нет ключей');
    ok('список профилей показывает файлы без секретов');

    // remove one
    await page.locator('#wgList .wg-list-del').first().click();
    await page.waitForFunction(() => wgBeans.length === 1);
    r = await build();
    assert.deepEqual(wgNames(r.yaml), ['wg-simple-b']);
    ok('удаление одного профиля работает');

    // duplicate transport (тот же контент) — пропущен с уведомлением:
    // загружаем A + копию A одной операцией → A добавляется, копия пропускается
    await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf'), fx('wg-dup-of-a.conf')]);
    await waitLoaded(2);
    assert.match(await page.evaluate(() => window.__lastToast || document.getElementById('toast').innerText), /Дубликат/);
    r = await build();
    assert.deepEqual(wgNames(r.yaml).sort(), ['wg-simple-a', 'wg-simple-b']);
    ok('дубликат транспорта пропущен (fail-safe, с тостом)');

    // 3 профиля: WG + WG + AWG3.1
    await page.locator('#wgFile').setInputFiles([fx('wg-simple-a.conf'), fx('wg-simple-c.conf'), fx('awg31.conf')]);
    await waitLoaded(4);
    r = await build();
    assert.equal(r.state, 'VALID');
    const names4 = wgNames(r.yaml);
    assert.equal(names4.length, 4);
    assert.ok(/amnezia-wg-option/.test(r.yaml), 'AWG-опции в YAML');
    assert.ok(/version: 3/.test(r.yaml), 'AWG 3.1 version: 3');
    ok('смесь WG + AWG 3.1: 4 профиля, VALID');

    // clear all
    await page.locator('#wgClear').click();
    await page.waitForFunction(() => wgBeans.length === 0);
    assert.equal(await page.evaluate(() => document.getElementById('wgCustomDns').value), '', 'clear очищает DNS-поле');
    await page.locator('button[onclick="buildMihomo()"]').click();
    assert.equal(await page.evaluate(() => MIHOMO_VALIDATION_STATE.state), 'NOT_BUILT', 'после очистки Build честно NOT_BUILT (пустой ввод)');
    assert.match(await page.evaluate(() => window.__lastToast || ''), /Вставь ссылки|загрузи WG/);
    ok('очистка всех профилей + инвалидация состояния');

    // коллизия имён с разным контентом — рантайм переименовывает (fail-safe)
    await page.evaluate(() => {
      const p = (name, addr, ep) => web4core.parseWireGuardConf(
        `[Interface]\nName = collide\nPrivateKey = CkGOZHbIxJvSSWWGFlHpNkGt0HhRIcKbmTIrmA9TcHk=\nAddress = ${addr}/32\n[Peer]\nPublicKey = CkGOZHbIxJvSSWWGFlHpNkGt0HhRIcKbmTIrmA9TcHk=\nAllowedIPs = 0.0.0.0/0\nEndpoint = ${ep}\n`, name);
      wgBeans = [p('a.conf', '10.9.0.1', '198.51.100.71:51820'), p('b.conf', '10.9.0.2', '198.51.100.72:51820')];
      wgFiles = ['a.conf', 'b.conf'];
    });
    r = await build();
    assert.equal(r.state, 'VALID');
    assert.deepEqual(wgNames(r.yaml).sort(), ['collide', 'collide-2']);
    ok('коллизия имён с разным контентом — авто-переименование, VALID');

    // dialer scope: глобальный на все WG (зафиксирован как current behavior)
    await page.evaluate(() => { wgBeans = [web4core.parseWireGuardConf(normalizeWgText(`[Interface]\nPrivateKey = CkGOZHbIxJvSSWWGFlHpNkGt0HhRIcKbmTIrmA9TcHk=\nAddress = 10.7.0.2/32\n[Peer]\nPublicKey = CkGOZHbIxJvSSWWGFlHpNkGt0HhRIcKbmTIrmA9TcHk=\nAllowedIPs = 0.0.0.0/0\nEndpoint = 198.51.100.10:51820\n`), 'wg-home.conf')]; wgFiles = ['wg-home.conf']; });
    await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#VPS-SE');
    await page.locator('#wgDialerInput').fill('VPS-SE');
    r = await build();
    const dialers = (r.yaml.match(/dialer-proxy: VPS-SE/g) || []).length;
    assert.equal(dialers, 1, 'единственный WG-профиль получил dialer-proxy (global scope)');
    ok('dialer-proxy: применён ко всем WG-профилям (current global contract)');

    // race: медленный A, быстрый B — старый async не затирает новое состояние
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = function () {
        if (this.name === 'wg-slow.conf') return new Promise(res => setTimeout(() => original.call(this).then(res), 800));
        return original.call(this);
      };
      const mk = (name) => new File([`[Interface]\nPrivateKey = CkGOZHbIxJvSSWWGFlHpNkGt0HhRIcKbmTIrmA9TcHk=\nAddress = 10.8.0.1/32\n[Peer]\nPublicKey = CkGOZHbIxJvSSWWGFlHpNkGt0HhRIcKbmTIrmA9TcHk=\nAllowedIPs = 0.0.0.0/0\nEndpoint = 198.51.100.90:51820\n`], name, { type: 'text/plain' });
      const input = document.getElementById('wgFile');
      const dt1 = new DataTransfer(); dt1.items.add(mk('wg-slow.conf'));
      input.files = dt1.files; input.dispatchEvent(new Event('change'));
      setTimeout(() => {
        const dt2 = new DataTransfer(); dt2.items.add(mk('wg-fast.conf'));
        input.files = dt2.files; input.dispatchEvent(new Event('change'));
      }, 150);
    });
    await page.waitForFunction(() => wgUploadPending === false && wgBeans.length === 2 && wgBeans[1].name === 'wg-fast');
    ok('async race (slow A → fast B): медленный результат отброшен seq-guard-ом, fast добавлен');

    assert.deepEqual(errors, [], 'нет pageerror');
    console.log(`WG-profiles: ${passed} проверок — PASS`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error('WG-profiles: FAIL —', error.message, '| at', (error.stack || '').split('\n')[1] || ''); process.exit(1); });

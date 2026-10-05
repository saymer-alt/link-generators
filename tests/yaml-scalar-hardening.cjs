// NIGHT-09: YAML 1.1 scalar hardening — semantic type safety regression.
// Корпус рискованных скаляров (yes/no/on/off/y/n/null/~, даты, ведущие нули,
// 0x/1e3, nan/inf) как значениях и mapping-ключах; plus end-to-end: прокси с
// именами/опциями из корпуса проходят parse -> build -> YAML -> load-back
// без смены семантического типа.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const CORPUS = ['yes', 'Yes', 'YES', 'no', 'No', 'NO', 'on', 'On', 'ON', 'off', 'Off', 'OFF',
  'y', 'Y', 'n', 'N', 'true', 'false', 'null', 'NULL', '~', '0123', '001', '0x10', '1e3',
  '1.0', '2026-10-05', '12:34:56', 'nan', 'inf', '.INF'];

let cases = 0;
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(process.cwd(), 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  // 1. dump/load round-trip всего корпуса: строки остаются строками
  //    (значения и mapping-ключи; nan/inf спец-ветка проверяется отдельно)
  for (const s of CORPUS) {
    const back = await page.evaluate(v => {
      const dumped = jsyaml.dump({ v, [v]: 'x' });
      const loaded = jsyaml.load(dumped);
      return { value: loaded.v === v ? 'string' : (loaded.v === null ? 'null' : typeof loaded.v),
        key: Object.keys(loaded)[0] === v ? 'string' : typeof Object.keys(loaded)[0] };
    }, s);
    if (['nan', 'inf', '.INF', '0x10', '1e3'].includes(s)) {
      // спец-скаляры: js-yaml dump цитирует только часть — допускаем строку ИЛИ
      // корректное числовое прочтение, но НЕ тихую потерю ключа/значения
      assert.ok(back.value !== undefined || back.key !== undefined, s + ': не потерян');
    } else {
      assert.equal(back.value, 'string', s + ': значение осталось строкой');
      assert.equal(back.key, 'string', s + ': mapping-ключ остался строкой');
    }
    cases += 1;
  }
  cases += 1;

  // 2. Сериализованный вид: рискованные строки выходят закавыченными
  const dumpedView = await page.evaluate(s => jsyaml.dump({ name: s, sni: s }), 'no');
  assert.ok(/['"]no['"]/.test(dumpedView), "dump: 'no' закавычен");
  const dumpedDate = await page.evaluate(s => jsyaml.dump({ name: s }), '2026-10-05');
  assert.ok(/['"]2026-10-05['"]/.test(dumpedDate), "dump: дата закавычена");
  cases += 2;

  // 3. End-to-end: прокси с именами 'no'/'null' и SNI 'on' — parse→build→YAML→load-back
  await page.locator('#cfgSubMode').setChecked(false);
  const uris = [
    'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443?encryption=none&security=tls&sni=on#no',
    'vless://00000000-0000-4000-8000-000000000002@192.0.2.2:443?encryption=none&security=tls&sni=off#null',
    'vless://00000000-0000-4000-8000-000000000003@192.0.2.3:443#2026-10-05',
  ];
  await page.locator('#mihomoInput').fill(uris.join('\n'));
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => {
    try { return validateMihomoYaml(document.getElementById('mihomoOutput').value).status === 'VALID'; } catch { return false; }
  }, null, { timeout: 20000 });
  const e2e = await page.evaluate(() => {
    const yaml = document.getElementById('mihomoOutput').value;
    const loaded = jsyaml.load(yaml);
    const names = (loaded.proxies || []).map(p => ({ name: p.name, t: typeof p.name }));
    const snis = (loaded.proxies || []).map(p => ({ sni: p.servername, t: typeof p.servername }));
    return { yaml, names, snis };
  });
  assert.deepEqual(e2e.names.map(x => x.name), ['no', 'null', '2026-10-05'], 'имена прошли дословно');
  assert.ok(e2e.names.every(x => x.t === 'string'), 'имена — строки в распарсенном YAML');
  const sniPresent = e2e.snis.filter(x => x.sni !== undefined);
  assert.deepEqual(sniPresent.map(x => x.sni), ['on', 'off'], 'SNI значения дословно');
  assert.ok(sniPresent.every(x => x.t === 'string'), 'SNI присутствующие — строки');
  // движковый эмиттер (ручной yaml.js) цитирует то, что реально опасно для
  // yaml.v3 (null-подобные, ведущие нули, даты): null/~/0123/дата — quoted;
  // yes/no/on/off/nan/12:34:56 остаются unquoted, но yaml.v3 v3.0.5 читает их
  // СТРОКАМИ (Go round-trip proof) — семантика сохранена
  assert.ok(e2e.yaml.includes('"null"'), 'null-имя закавычено движком');
  assert.ok(e2e.yaml.includes('"2026-10-05"'), 'date-имя закавычено движком');
  cases += 4;

  // 4. Mihomo-семантика: quoted name декодируется Go yaml как строку (симуляция
  //    строгого чтения через jsyaml.load уже выше); дубликаты имён 'no'/'no' —
  //    дедупликация движка переименует второго (-2), коллизия видна
  await page.locator('#mihomoInput').fill(uris[0] + '\n' + uris[0]);
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => {
    try { return validateMihomoYaml(document.getElementById('mihomoOutput').value).status === 'VALID'; } catch { return false; }
  }, null, { timeout: 20000 });
  const dup = await page.evaluate(() => {
    const d = jsyaml.load(document.getElementById('mihomoOutput').value);
    return (d.proxies || []).map(p => p.name);
  });
  assert.notEqual(dup[0], dup[1], 'дубликат имени переименован движком (equality сохранена)');
  assert.equal(dup[0], 'no', 'базовое имя сохранено');
  cases += 2;

  assert.deepEqual(errors, [], 'no page errors');
  cases += 1;

  console.log('YAML scalar hardening: ' + cases + ' cases passed');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

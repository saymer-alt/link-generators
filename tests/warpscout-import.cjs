// WARPSCOUT-aware MASQUE import (v1.9, issue #125) — browser regression.
// Контракты: legacy WARP YAML без изменений (identity/tunnel, endpoint выбирает
// генератор); детект по ВСЕМ proxies с type: masque (network: h2 → H2/TCP,
// иначе H3/QUIC); несколько кандидатов одного транспорта → селектор (никакого
// silent first); приоритет exact endpoint → custom ports → builtin; integer
// порты 1..65535 без parseInt-угадайки; per-transport SNI; privacy — ключи
// только в памяти страницы.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

let cases = 0;
const ok = msg => { cases += 1; console.log('  ok ' + msg); };

const PK = 'uC1jdLSc2slWHX0waCAl4uRWmJtMGKLrWBu9FVP8uGk=';
const PUB = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2w1fsw4=';

const legacyYaml = [
  'proxies:',
  '  - name: warp-bot',
  '    type: wireguard',
  '    server: engage.cloudflareclient.com',
  '    port: 2408',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '    ipv6: fd01:5ca1:ab1e:80fa:ab85:6eea:93d3:4b16',
  '    dns: [1.1.1.1, 1.0.0.1]',
  '    sni: 4pda.to',
  ''
].join('\n');

const h3OnlyYaml = [
  'proxies:',
  '  - name: WARPSCOUT-H3',
  '    type: masque',
  '    server: 162.159.192.10',
  '    port: 443',
  '    sni: cryptoexample.org',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '    udp: true',
  ''
].join('\n');

const h2OnlyYaml = [
  'proxies:',
  '  - name: WARPSCOUT-H2',
  '    type: masque',
  '    server: 162.159.192.20',
  '    port: 8443',
  '    network: h2',
  '    sni: cryptoexample.org',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '    udp: true',
  ''
].join('\n');

const fullYaml = [
  'proxies:',
  '  - name: WARPSCOUT-H3',
  '    type: masque',
  '    server: 162.159.192.10',
  '    port: 443',
  '    sni: h3.example.net',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '  - name: WARPSCOUT-H2',
  '    type: masque',
  '    server: 162.159.192.20',
  '    port: 8443',
  '    network: h2',
  '    sni: h2.example.net',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

const nonMasqueFirstYaml = [
  'proxies:',
  '  - name: regular-vless',
  '    type: vless',
  '    server: 203.0.113.9',
  '    port: 443',
  '    uuid: 00000000-0000-4000-8000-000000000009',
  '  - name: WARPSCOUT-H3',
  '    type: masque',
  '    server: 162.159.192.30',
  '    port: 443',
  '    sni: after-vless.example.net',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

const ambiguousYaml = [
  'proxies:',
  '  - name: H3-first',
  '    type: masque',
  '    server: 162.159.192.41',
  '    port: 443',
  '    sni: first.example.net',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '  - name: H3-second',
  '    type: masque',
  '    server: 162.159.192.42',
  '    port: 443',
  '    sni: second.example.net',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

// Owner review #134: identity consistency fixtures.
const PK2 = 'qF9jH3kLpQ2rS5tU8vW1xY4zA6bC0dE2fG4hJ7kM9oQ=';

const mismatchPkYaml = [
  'proxies:',
  '  - name: WARPSCOUT-H3',
  '    type: masque',
  '    server: 162.159.192.10',
  '    port: 443',
  '    sni: h3.example.net',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '  - name: WARPSCOUT-H2',
  '    type: masque',
  '    server: 162.159.192.20',
  '    port: 8443',
  '    network: h2',
  '    sni: h2.example.net',
  '    private-key: ' + PK2,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

const mismatchIpYaml = [
  'proxies:',
  '  - name: WARPSCOUT-H3',
  '    type: masque',
  '    server: 162.159.192.10',
  '    port: 443',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '  - name: WARPSCOUT-H2',
  '    type: masque',
  '    server: 162.159.192.20',
  '    port: 8443',
  '    network: h2',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.5.9',
  ''
].join('\n');

const ambiguousConsistencyYaml = [
  'proxies:',
  '  - name: H3-ok',
  '    type: masque',
  '    server: 162.159.192.51',
  '    port: 443',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '  - name: H3-bad',
  '    type: masque',
  '    server: 162.159.192.52',
  '    port: 443',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.7.7',
  '  - name: WARPSCOUT-H2',
  '    type: masque',
  '    server: 162.159.192.20',
  '    port: 8443',
  '    network: h2',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

// Owner review #134: unknown network tokens → UNSUPPORTED (не H3 по умолчанию).
const mixedUnknownNetworkYaml = [
  'proxies:',
  '  - name: WARPSCOUT-H3',
  '    type: masque',
  '    server: 162.159.192.10',
  '    port: 443',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '  - name: net-foo',
  '    type: masque',
  '    server: 162.159.192.61',
  '    port: 443',
  '    network: foo',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '  - name: net-tcp',
  '    type: masque',
  '    server: 162.159.192.62',
  '    port: 443',
  '    network: tcp',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  '  - name: net-h3-token',
  '    type: masque',
  '    server: 162.159.192.63',
  '    port: 443',
  '    network: h3',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

const upperH2Yaml = [
  'proxies:',
  '  - name: WARPSCOUT-H2',
  '    type: masque',
  '    server: 162.159.192.20',
  '    port: 8443',
  '    network: H2',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

const emptyNetworkYaml = [
  'proxies:',
  '  - name: WARPSCOUT-H3',
  '    type: masque',
  '    server: 162.159.192.10',
  '    port: 443',
  '    network: ""',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

const sniFallbackYaml = [
  'proxies:',
  '  - name: WARPSCOUT-H3',
  '    type: masque',
  '    server: 162.159.192.10',
  '    port: 443',
  '    private-key: ' + PK,
  '    public-key: ' + PUB,
  '    ip: 172.16.0.2',
  ''
].join('\n');

async function parse(page, yaml) {
  await page.fill('#yamlInput', yaml);
  await page.locator('button[onclick="parseYaml()"]').click();
  await page.waitForTimeout(150);
}

async function generate(page) {
  // генерация при ошибке валидации сознательно НЕ трогает предыдущий вывод
  // (fail-closed) — для чистоты assertions очищаем перед кликом
  await page.evaluate(() => { document.getElementById('warpOutput').innerHTML = ''; });
  await page.locator('button[onclick="generateWarp()"]').click();
  await page.waitForTimeout(120);
  return page.evaluate(() => Array.from(document.querySelectorAll('#warpOutput .link-text')).map(x => x.textContent));
}

function parseLink(link) {
  const m = link.match(/^masque:\/\/([^/?#]+)\?([^#]*)#(.*)$/s);
  assert.ok(m, 'masque:// структура ссылки: ' + link.slice(0, 60));
  const colon = m[1].lastIndexOf(':');
  const q = {};
  new URLSearchParams(m[2]).forEach((v, k) => { q[k] = v; });
  return { host: m[1].slice(0, colon), port: m[1].slice(colon + 1), q, name: decodeURIComponent(m[3]) };
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(process.cwd(), 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  // WARP-вкладка активна как элемент DOM независимо от активного класса;
  // клик по кнопке вкладки для надёжности (элементы доступны и так).
  await page.locator('button.tab', { hasText: 'WARP MASQUE Links' }).click();
  await page.waitForTimeout(100);

  const bannerVisible = () => page.evaluate(() => document.getElementById('warpscoutInfo').style.display !== 'none');
  const bannerText = () => page.evaluate(() => document.getElementById('warpscoutInfo').textContent);
  const fieldVal = id => page.evaluate(id => document.getElementById(id).value, id);

  // 1. Legacy WARP YAML: parity со старым поведением
  await parse(page, legacyYaml);
  assert.equal(await bannerVisible(), false, 'legacy: баннер WARPSCOUT скрыт');
  assert.equal(await fieldVal('privateKey'), PK);
  assert.equal(await fieldVal('publicKey'), PUB);
  assert.equal(await fieldVal('ip'), '172.16.0.2');
  assert.match(await fieldVal('ipv6'), /^fd01:/);
  assert.equal(await fieldVal('dns'), '1.1.1.1,1.0.0.1');
  assert.equal(await fieldVal('sni'), '4pda.to', 'legacy: общий SNI из YAML');
  assert.equal(await fieldVal('h3Endpoint'), '', 'legacy: H3 endpoint пуст');
  assert.equal(await fieldVal('h2Endpoint'), '', 'legacy: H2 endpoint пуст');
  ok('legacy YAML: identity/tunnel импорт без изменений, точные endpoint пусты');
  let links = await generate(page);
  assert.equal(links.length, 2);
  const lq = parseLink(links[0]), lh = parseLink(links[1]);
  assert.equal(lq.host, '162.159.198.2', 'legacy: QUIC из пула');
  assert.equal(lq.port, '443', 'legacy: QUIC порт 443');
  assert.ok(!lq.q.network, 'legacy: QUIC без network=h2');
  assert.ok(lh.name.includes('-H2-TCP-'), 'legacy: имя H2 с портом');
  assert.ok(lh.q.network === 'h2', 'legacy: H2 network=h2');
  assert.equal(lq.q['private-key'], PK, 'legacy: ключ URL-энкодится round-trip');
  ok('legacy YAML: генерация — встроенная стратегия (пул/443/веса) сохранена');

  // 2. H3-only WARPSCOUT YAML: точный H3, H2 остаётся builtin
  await parse(page, h3OnlyYaml);
  assert.ok(await bannerVisible(), 'баннер показан');
  const b1 = await bannerText();
  assert.match(b1, /WARPSCOUT \/ Mihomo MASQUE detected/);
  assert.match(b1, /H3 \/ QUIC: endpoint 162\.159\.192\.10:443, SNI cryptoexample\.org → импортирован как точный/);
  assert.match(b1, /H2 \/ TCP: кандидатов нет — останется встроенная стратегия/);
  assert.equal(await fieldVal('h3Endpoint'), '162.159.192.10:443');
  assert.equal(await fieldVal('h3Sni'), 'cryptoexample.org');
  assert.equal(await fieldVal('h2Endpoint'), '');
  assert.equal(await fieldVal('h2Sni'), '');
  ok('H3-only: точный endpoint+SNI импортированы, H2 builtin, баннер объясняет');
  links = await generate(page);
  const h3l = parseLink(links[0]);
  assert.equal(h3l.host, '162.159.192.10', 'exact H3 host сохранён');
  assert.equal(h3l.port, '443');
  assert.equal(h3l.q.sni, 'cryptoexample.org', 'per-transport SNI в ссылке');
  const h2g = parseLink(links[1]);
  assert.match(h2g.host, /^162\.159\.(198|199)\./, 'H2 builtin: IP из 198/199');
  assert.equal(h2g.q.sni, '4pda.to', 'H2 builtin: общий SNI');
  ok('генерация: точный H3 используется дословно, H2 — builtin');

  // 3. H2-only WARPSCOUT YAML: точный H2, H3 остаётся builtin
  await parse(page, h2OnlyYaml);
  assert.equal(await fieldVal('h2Endpoint'), '162.159.192.20:8443');
  assert.equal(await fieldVal('h2Sni'), 'cryptoexample.org');
  assert.equal(await fieldVal('h3Endpoint'), '');
  const b2 = await bannerText();
  assert.match(b2, /H3 \/ QUIC: кандидатов нет/);
  links = await generate(page);
  const h2e = parseLink(links[1]);
  assert.equal(h2e.host, '162.159.192.20', 'exact H2 host сохранён');
  assert.equal(h2e.port, '8443');
  assert.equal(h2e.q.sni, 'cryptoexample.org');
  const h3g = parseLink(links[0]);
  assert.equal(h3g.host, '162.159.198.2', 'H3 builtin: пул');
  ok('H2-only: точный H2, H3 builtin');

  // 4. H3+H2 в одном YAML: разные SNI попадают в свои ссылки
  await parse(page, fullYaml);
  assert.equal(await fieldVal('h3Endpoint'), '162.159.192.10:443');
  assert.equal(await fieldVal('h2Endpoint'), '162.159.192.20:8443');
  assert.equal(await fieldVal('h3Sni'), 'h3.example.net');
  assert.equal(await fieldVal('h2Sni'), 'h2.example.net');
  links = await generate(page);
  assert.equal(parseLink(links[0]).q.sni, 'h3.example.net');
  assert.equal(parseLink(links[1]).q.sni, 'h2.example.net');
  ok('H3+H2: раздельные SNI в своих ссылках (один общий SNI больше не модель)');

  // 5. Не-MASQUE proxy ПЕРЕД MASQUE: детект по всем proxies
  await parse(page, nonMasqueFirstYaml);
  assert.equal(await fieldVal('h3Endpoint'), '162.159.192.30:443');
  assert.equal(await fieldVal('privateKey'), PK);
  ok('не-MASQUE proxy первым не ломает детект (скан всех proxies)');

  // 6. Несколько кандидатов H3: селектор, никакого silent first
  await parse(page, ambiguousYaml);
  const ambVisible = await page.evaluate(() => document.getElementById('warpImportAmbiguity').style.display !== 'none');
  assert.ok(ambVisible, 'селектор неоднозначности показан');
  const opts = await page.evaluate(() => Array.from(document.querySelectorAll('#h3CandidateSelect option')).map(o => o.textContent));
  assert.equal(opts.length, 2, 'в селекте оба кандидата');
  assert.match(opts[0], /H3-first — 162\.159\.192\.41:443/);
  assert.match(opts[1], /H3-second — 162\.159\.192\.42:443/);
  assert.equal(await fieldVal('h3Endpoint'), '', 'молчаливый выбор первого запрещён');
  const b3 = await bannerText();
  assert.match(b3, /кандидатов 2 — выберите в «Advanced MASQUE»/);
  await page.selectOption('#h3CandidateSelect', { index: 1 });
  await page.locator('button[onclick="applyWarpscoutSelection()"]').click();
  await page.waitForTimeout(100);
  assert.equal(await fieldVal('h3Endpoint'), '162.159.192.42:443', 'выбранный кандидат применён');
  assert.equal(await fieldVal('h3Sni'), 'second.example.net');
  ok('неоднозначность: явный селектор кандидатов, silent first отсутствует');

  // 6a. Identity consistency: разные private-key → fail-closed reject пары
  await parse(page, mismatchPkYaml);
  assert.equal(await fieldVal('h3Endpoint'), '', 'mismatch PK: H3 не импортирован');
  assert.equal(await fieldVal('h2Endpoint'), '', 'mismatch PK: H2 не импортирован');
  assert.equal(await fieldVal('privateKey'), '', 'mismatch PK: identity не импортирована (гибрид не создаётся)');
  const bPk = await bannerText();
  assert.match(bPk, /Несовместимая WARP identity/, 'fail-closed diagnostic');
  assert.match(bPk, /WARPSCOUT-H3 — 162\.159\.192\.10:443.*и.*WARPSCOUT-H2 — 162\.159\.192\.20:8443/s, 'конфликтующие профили названы');
  assert.match(bPk, /по private-key/, 'конфликтующее поле названо');
  assert.ok(!bPk.includes(PK) && !bPk.includes(PK2), 'значения ключей не в diagnostics');
  ok('identity mismatch (private-key): пара отвергнута явно, без секретов в тексте');

  // 6b. Same private-key, другой tunnel IP → тоже reject (материальное поле)
  await parse(page, mismatchIpYaml);
  assert.equal(await fieldVal('h3Endpoint'), '', 'mismatch IP: H3 не импортирован');
  assert.equal(await fieldVal('privateKey'), '', 'mismatch IP: identity не импортирована');
  const bIp = await bannerText();
  assert.match(bIp, /Несовместимая WARP identity/);
  assert.match(bIp, /по ip/, 'конфликт по tunnel ip назван');
  assert.ok(!bIp.includes(PK), 'private-key значение не в diagnostics');
  ok('identity mismatch (tunnel ip при том же ключе): отвергнут явно');

  // 6c. Multiple candidates: consistency проверяется ПОСЛЕ выбора пользователя
  await parse(page, ambiguousConsistencyYaml);
  assert.ok(await page.evaluate(() => document.getElementById('warpImportAmbiguity').style.display !== 'none'), 'селектор показан');
  assert.equal(await fieldVal('h3Endpoint'), '', 'до выбора ничего не применено');
  assert.equal(await fieldVal('h2Endpoint'), '', 'синглтон H2 тоже ждёт выбора (атомарная пара)');
  assert.equal(await fieldVal('privateKey'), '', 'identity ждёт проверенной пары');
  // совместимый выбор → импорт
  await page.selectOption('#h3CandidateSelect', { index: 0 });
  await page.locator('button[onclick="applyWarpscoutSelection()"]').click();
  await page.waitForTimeout(100);
  assert.equal(await fieldVal('h3Endpoint'), '162.159.192.51:443', 'совместимая пара применена');
  assert.equal(await fieldVal('h2Endpoint'), '162.159.192.20:8443');
  assert.equal(await fieldVal('privateKey'), PK);
  // повторный импорт + несовместимый выбор → reject ПОСЛЕ выбора, ничего не применено
  await parse(page, ambiguousConsistencyYaml);
  await page.selectOption('#h3CandidateSelect', { index: 1 });
  await page.locator('button[onclick="applyWarpscoutSelection()"]').click();
  await page.waitForTimeout(100);
  assert.equal(await fieldVal('h3Endpoint'), '', 'H3-bad: endpoint не применён');
  assert.equal(await fieldVal('h2Endpoint'), '', 'H3-bad: H2 синглтон не применён');
  assert.equal(await fieldVal('privateKey'), '', 'H3-bad: identity не применена');
  assert.ok(await page.evaluate(() => document.getElementById('warpImportAmbiguity').style.display !== 'none'), 'селектор остался открыт для другого выбора');
  assert.match(await bannerText(), /Несовместимая WARP identity/);
  ok('консистентность проверяется после фактического выбора (совместимый → PASS, конфликтный → reject, атомарно)');

  // 6d. Unknown network → UNSUPPORTED: не H3 по умолчанию, diagnostic, без импорта
  await parse(page, mixedUnknownNetworkYaml);
  assert.equal(await fieldVal('h3Endpoint'), '162.159.192.10:443', 'обычный H3 кандидат импортируется как раньше');
  const bNet = await bannerText();
  assert.match(bNet, /UNSUPPORTED network «foo» \(net-foo/);
  assert.match(bNet, /UNSUPPORTED network «tcp» \(net-tcp/);
  assert.match(bNet, /UNSUPPORTED network «h3» \(net-h3-token/);
  assert.ok(!bNet.includes(PK), 'секреты не в diagnostics');
  // uppercase H2 распознаётся (case-insensitive), пустая строка = H3
  await parse(page, upperH2Yaml);
  assert.equal(await fieldVal('h2Endpoint'), '162.159.192.20:8443', 'network: H2 (uppercase) → H2/TCP');
  await parse(page, emptyNetworkYaml);
  assert.equal(await fieldVal('h3Endpoint'), '162.159.192.10:443', 'network: "" → H3/QUIC');
  assert.equal(await fieldVal('h2Endpoint'), '', 'network: "" не классифицируется как H2');
  ok('unknown network: fail-closed (foo/tcp/h3 — UNSUPPORTED с raw token и именем); H2 case-insensitive; empty/absent → H3');

  // 6e. SNI fallback — сознательный контракт: empty candidate SNI → общий SNI
  await parse(page, sniFallbackYaml);
  assert.equal(await fieldVal('h3Sni'), '', 'candidate SNI пуст → поле не заполняется');
  assert.match(await bannerText(), /SNI не задан в candidate → используется общий SNI/, 'fallback явно назван в banner');
  links = await generate(page);
  assert.equal(parseLink(links[0]).q.sni, '4pda.to', 'генерация использует общий SNI (осознанный fallback)');
  ok('SNI fallback: явный diagnostic + общий SNI в ссылке; никаких выдуманных SNI');

  // 7. Custom ports: H3 и H2 списки, dedup, приоритет exact над ports
  await parse(page, legacyYaml);
  await page.fill('#h3Ports', '8443, 4443, 8443');
  await page.fill('#h2Ports', '2053, 2083');
  await page.evaluate(() => { document.getElementById('pairCount').value = '2'; });
  links = await generate(page);
  assert.equal(parseLink(links[0]).port, '8443', 'custom H3 ports: пара 1');
  assert.equal(parseLink(links[2]).port, '4443', 'custom H3 ports: пара 2 (dedup 8443 не сдвигает)');
  assert.equal(parseLink(links[1]).port, '2053', 'custom H2 ports: пара 1');
  assert.equal(parseLink(links[3]).port, '2083', 'custom H2 ports: пара 2');
  assert.match(parseLink(links[1]).host, /^162\.159\.(198|199)\./, 'custom H2 ports: IP по-прежнему из 198/199');
  ok('custom ports: round-robin по списку, dedup, IP-пул сохранён');
  await page.fill('#h3Endpoint', '162.159.192.77:443');
  links = await generate(page);
  assert.equal(parseLink(links[0]).host, '162.159.192.77', 'exact приоритетнее custom ports');
  assert.equal(parseLink(links[0]).port, '443');
  ok('приоритет: exact endpoint > custom ports > builtin');

  // 8. Валидация портов: «443abc» → ошибка, не 443; 0/65536/ведущий ноль → ошибка
  await page.fill('#h3Endpoint', '');
  await page.fill('#h3Ports', '443abc');
  links = await generate(page);
  assert.equal(links.length, 0, 'невалидный порт: ссылок нет');
  for (const bad of ['0', '65536', '0443', '-1', '443a ']) {
    await page.fill('#h3Ports', bad);
    const l = await generate(page);
    assert.equal(l.length, 0, 'порты «' + bad + '» отвергнуты');
  }
  // trim входит в контракт: пробельные обрамления вокруг валидного порта — ок
  await page.fill('#h3Ports', ' 443 ');
  assert.equal(parseLink((await generate(page))[0]).port, '443', 'trim: « 443 » валиден');
  ok('порты: integer 1..65535, без ведущих нулей, «443abc» не превращается в 443');

  // 9. Валидация endpoint: IPv6 → честный reject; мусор → reject
  await page.fill('#h3Ports', '');
  for (const bad of ['[2001:db8::1]:443', '2001:db8::1:443', '1.2.3', '999.1.1.1:443', 'host ex.com:443']) {
    await page.fill('#h3Endpoint', bad);
    const l = await generate(page);
    assert.equal(l.length, 0, 'endpoint «' + bad + '» отвергнут явно');
  }
  await page.fill('#h3Endpoint', 'gateway.example.com:8853');
  links = await generate(page);
  assert.equal(parseLink(links[0]).host, 'gateway.example.com', 'hostname:port допустим');
  ok('endpoint: IPv6/мусор отвергаются явно, hostname:port принимается');

  // 10. Send to Mihomo Builder: точный endpoint доходит до YAML
  await parse(page, fullYaml);
  links = await generate(page);
  await page.locator('button[onclick="sendToMihomo()"]').click();
  await page.waitForTimeout(200);
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => {
    try { return validateMihomoYaml(document.getElementById('mihomoOutput').value).status === 'VALID'; } catch { return false; }
  }, null, { timeout: 20000 });
  const built = await page.evaluate(() => {
    const d = jsyaml.load(document.getElementById('mihomoOutput').value);
    return (d.proxies || []).filter(p => p.type === 'masque').map(p => ({ server: p.server, port: p.port, sni: p.sni, network: p.network }));
  });
  assert.ok(built.some(p => p.server === '162.159.192.10' && String(p.port) === '443' && p.sni === 'h3.example.net'), 'H3 exact в Mihomo YAML');
  assert.ok(built.some(p => p.server === '162.159.192.20' && String(p.port) === '8443' && p.network === 'h2' && p.sni === 'h2.example.net'), 'H2 exact в Mihomo YAML');
  ok('Send to Mihomo Builder: masque:// парсятся, endpoint/SNI/network доходят до YAML');

  // 11. Privacy: ключи не попадают в localStorage/sessionStorage
  const storageProbe = await page.evaluate(() => {
    const blob = JSON.stringify([localStorage, sessionStorage]);
    return {
      pk: blob.includes('uC1jdLSc2slWHX0waCAl4uRWmJtMGKLrWBu9FVP8uGk='),
      pub: blob.includes('bmXOC+F1FxEMF9dyiK2H5'),
      keys: Object.keys(localStorage).concat(Object.keys(sessionStorage))
    };
  });
  assert.equal(storageProbe.pk, false, 'private-key не в storage');
  assert.equal(storageProbe.pub, false, 'public-key не в storage');
  assert.ok(storageProbe.keys.every(k => !/warpscout|h3Endpoint|h2Endpoint/i.test(k)), 'новых persistent-ключей нет');
  ok('privacy: ключи и точные endpoint только в памяти страницы');

  // 12. 360px: секция Advanced MASQUE без горизонтального overflow
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(overflow.sw <= overflow.iw + 1, '360px: нет горизонтального overflow (' + overflow.sw + ' vs ' + overflow.iw + ')');
  await page.setViewportSize({ width: 1280, height: 800 });
  ok('360px layout: без overflow');

  assert.deepEqual(errors, [], 'no page errors');
  cases += 1;

  console.log('WARPSCOUT import: ' + cases + ' cases passed');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

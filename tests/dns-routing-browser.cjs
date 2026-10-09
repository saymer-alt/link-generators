// DNS↔Routing audit — browser regression (v1.11 CANDIDATE).
// Контракт: панель «DNS ↔ Routing» в Config Studio заполняется после
// «Разобрать», тексты проходят csRedactText (секрет в имени домена/группы не
// виден), «Очистить» опустошает, dns-off — честный «неприменим», чистый
// конфиг — «✓». Страница локальная (file://), сеть не трогается.
const assert = require('node:assert/strict');
const path = require('node:path');
const hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SECRET = 'SYNTH_DNS_BROWSER_SECRET_2468';
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

const yaml = require(process.env.JS_YAML_PATH);
const baseDoc = {
  'mixed-port': 7890,
  mode: 'rule',
  dns: { enable: true, nameserver: ['https://dns.google/dns-query'] },
  proxies: [{ name: 'Alpha-SS', type: 'ss', server: '198.51.100.10', port: 8443, password: 'synth-pass-1', cipher: 'aes-128-gcm' }],
  'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['Alpha-SS', 'DIRECT'] }],
  rules: ['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,DIRECT']
};

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await page.locator('.tab', { hasText: 'Config Studio' }).click();

  const studio = async (text) => {
    await page.fill('#csImportInput', text);
    await page.click('#csParseBtn');
    await page.waitForFunction(() => document.getElementById('csStatus').textContent.includes('Разобрано'));
    await page.locator('#csDnsRoutingPanel > summary').click();
  };
  const panelText = () => page.textContent('#csDnsRoutingOut');

  // --- 1. находки: bypass-warning (respect-rules off + прокси-правила) ---
  await studio(yaml.dump(baseDoc));
  const t1 = await panelText();
  assert.ok(t1.includes('[WARNING]') && t1.includes('respect-rules'), 'bypass warning показан');
  ok('находка DNS-байпаса отображается после «Разобрать»');

  // --- 2. error-находка: respect-rules без PSNS ---
  const errDoc = JSON.parse(JSON.stringify(baseDoc));
  errDoc.dns['respect-rules'] = true;
  errDoc.dns['enhanced-mode'] = 'fake-ip';
  errDoc.rules = ['DOMAIN-SUFFIX,example.com,PROXY', 'GEOIP,CN,DIRECT', 'MATCH,DIRECT'];
  await studio(yaml.dump(errDoc));
  const t2 = await panelText();
  assert.ok(t2.includes('[ERROR]') && t2.includes('proxy-server-nameserver'), 'error находка (валидатор mihomo)');
  assert.ok(t2.includes('[INFO]') && t2.includes('реальный IP'), 'info находка (fake-ip × IP-правила)');
  ok('error + info находки отображаются с иконками и источниками');

  // --- 3. redaction: секрет в password, повторённый в домене политики и группы ---
  const leakDoc = JSON.parse(JSON.stringify(baseDoc));
  leakDoc.dns['nameserver-policy'] = { ['+.' + SECRET]: '192.0.2.53' };
  leakDoc.proxies[0].password = SECRET;
  leakDoc['proxy-groups'][0].name = SECRET;
  leakDoc.rules = ['DOMAIN-SUFFIX,' + SECRET + ',' + SECRET, 'MATCH,DIRECT'];
  await studio(yaml.dump(leakDoc));
  const t3 = await panelText();
  assert.ok(!t3.includes(SECRET), 'секрета нет в панели');
  const cardText = await page.textContent('#csSummaryCard');
  assert.ok(!cardText.includes(SECRET), 'секрета нет во всей сводке (VRG-метки включительно)');
  assert.ok(t3.includes('••••••'), 'маскирующие маркеры присутствуют');
  ok('redaction: секрет-в-имени не виден ни в панели, ни в сводке');

  // --- 4. чистый конфиг → ✓ ---
  const cleanDoc = JSON.parse(JSON.stringify(baseDoc));
  cleanDoc.dns['respect-rules'] = true;
  cleanDoc.dns['proxy-server-nameserver'] = ['system'];
  cleanDoc.rules = ['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,DIRECT'];
  // respect-rules on: bypass не срабатывает; прокси-домены есть, но политика off
  await studio(yaml.dump(cleanDoc));
  const t4 = await panelText();
  assert.ok(t4.includes('✓'), 'чистый конфиг: ✓ без находок');
  ok('чистый конфиг: ✓');

  // --- 5. dns выключен → честный «неприменим» ---
  const offDoc = JSON.parse(JSON.stringify(baseDoc));
  offDoc.dns.enable = false;
  await studio(yaml.dump(offDoc));
  const t5 = await panelText();
  assert.ok(t5.includes('неактивна'), 'dns-off: аудит неприменим');
  ok('dns-off: честный «неприменим»');

  // --- 6. «Очистить» опустошает панель ---
  await page.click('#csClearBtn');
  const t6 = await page.evaluate(() => document.getElementById('csDnsRoutingOut').textContent);
  assert.equal(t6, '', 'после «Очистить» панель пуста');
  ok('«Очистить» опустошает панель');

  // --- 7. правки редактора не обновляют панель (снапшот-семантика как у VRG) ---
  await studio(yaml.dump(baseDoc));
  await page.selectOption('#csEditType', 'proxy');
  await page.fill('input[data-cs-field="server"]', '203.0.113.9');
  await page.click('#csSaveFieldsBtn');
  const t7 = await panelText();
  assert.ok(t7.length > 0, 'после правки текст панели сохраняется (не очищается)');
  ok('снапшот-семантика: правки редактора не перетирают панель');

  const structural = JSON.parse(JSON.stringify(baseDoc));
  delete structural.dns.enable; structural.dns['respect-rules'] = true;
  await studio(yaml.dump(structural));
  assert.match(await panelText(), /неактивна/);
  assert.match(await panelText(), /\[ERROR\]/);
  ok('omitted enable: inactive DNS still reports structural error');
  const proxied = JSON.parse(JSON.stringify(baseDoc));
  proxied.dns.nameserver=['https://192.0.2.53/dns-query#PROXY'];
  proxied.dns['nameserver-policy']={'+.example.com':proxied.dns.nameserver};
  await studio(yaml.dump(proxied));
  assert.ok(!(await panelText()).includes('[WARNING]'), 'explicit proxy is not called direct');
  ok('explicit proxy endpoints and array policy do not claim DIRECT');
  proxied.dns.nameserver=['https://192.0.2.53/dns-query'];
  proxied.dns['nameserver-policy']={'+.example.com':proxied.dns.nameserver};
  proxied.rules=['DOMAIN-SUFFIX,example.com,DIRECT','DOMAIN-SUFFIX,example.com,PROXY','MATCH,DIRECT'];
  await studio(yaml.dump(proxied));
  assert.ok(!(await panelText()).includes('[WARNING]'), 'unreachable duplicate never wins');
  ok('first-match duplicates respected in actual Studio flow');
  const builderBefore=await page.evaluate(()=>buildStateFingerprint());
  const passDoc=JSON.parse(JSON.stringify(baseDoc));
  passDoc.rules=['DOMAIN,example.com,PASS','DOMAIN,example.com,PROXY','MATCH,DIRECT'];
  await studio(yaml.dump(passDoc));assert.match(await panelText(),/\[WARNING\]/);
  for(const mode of ['direct','global']){passDoc.mode=mode;await studio(yaml.dump(passDoc));assert.ok(!(await panelText()).includes('[WARNING]'));assert.match(await panelText(),/UNKNOWN/);}
  assert.equal(await page.evaluate(()=>buildStateFingerprint()),builderBefore);
  ok('PASS and non-rule modes: actual Parse replaces snapshot without Builder mutation');
  const tokenDoc=JSON.parse(JSON.stringify(baseDoc));
  tokenDoc.dns.nameserver=['https://user:SYNTH_DNS_TOKEN_ONLY@192.0.2.53/token/SYNTH_DNS_PATH_ONLY?token=SYNTH_DNS_QUERY_ONLY'];
  tokenDoc.dns['nameserver-policy']={'geosite:cn':tokenDoc.dns.nameserver};
  const tokenText=yaml.dump(tokenDoc);await studio(tokenText);
  assert.match(await panelText(),/UNKNOWN/);
  const shown=await page.locator('#csSummaryCard').textContent();
  for(const secret of ['SYNTH_DNS_TOKEN_ONLY','SYNTH_DNS_PATH_ONLY','SYNTH_DNS_QUERY_ONLY'])assert.ok(!shown.includes(secret),'DNS-only token must remain hidden');
  assert.equal(hash(await page.locator('#csImportInput').inputValue()),hash(tokenText));
  assert.equal(await page.evaluate(()=>buildStateFingerprint()),builderBefore);
  ok('unsupported policy, DNS-only URL tokens and source preservation');
  assert.deepEqual(errors, [], 'нет pageerror: ' + errors.join(' | '));
  console.log('PASS dns-routing-browser: ' + passed + ' checks');
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });

// DNS↔Routing audit core (v1.11 CANDIDATE) — deterministic suite.
// DNS-CORE извлекается из index.html; он живёт внутри CS-CORE-спана
// (после csRedactText): один grab покрывает оба.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(
  grab('CS-CORE-START', 'DNS-CORE-END ===') + '\n' +
  'return { dnsRoutingAudit, csDnsRoutingText };'
)();

let cases = 0;
const ok = (msg) => { cases++; console.log('  ok — ' + msg); };

// --- 1. respect-rules без proxy-server-nameserver → error (CONFIRMED) ---
{
  const doc = { dns: { enable: true, 'respect-rules': true, nameserver: ['https://dns.google/dns-query'] }, rules: ['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,G'] };
  const f = api.dnsRoutingAudit(doc).find(x => x.id === 'dns-respect-rules-no-psns');
  assert.ok(f, 'находка A присутствует');
  assert.equal(f.severity, 'error');
  ok('A: respect-rules без PSNS → error');
}

// --- 2. негатив A: PSNS заполнен ---
{
  const doc = { dns: { enable: true, 'respect-rules': true, 'proxy-server-nameserver': ['system'], nameserver: ['https://dns.google/dns-query'] }, rules: ['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,G'] };
  assert.ok(!api.dnsRoutingAudit(doc).some(x => x.id === 'dns-respect-rules-no-psns'));
  ok('A-negative: PSNS заполнен → чисто');
}

// --- 3. DNS-байпас: прокси-правила без respect-rules → warning ---
{
  const doc = { dns: { enable: true, nameserver: ['https://dns.google/dns-query'] }, rules: ['DOMAIN-SUFFIX,openai.com,PROXY', 'MATCH,DIRECT'] };
  const f = api.dnsRoutingAudit(doc).find(x => x.id === 'dns-bypass-for-proxied-domains');
  assert.ok(f && f.severity === 'warning');
  ok('B: прокси-домены без respect-rules → warning');
}

// --- 4. негативы B: respect-rules on / только DIRECT-правила / dns выключен ---
{
  const on = { dns: { enable: true, 'respect-rules': true, 'proxy-server-nameserver': ['system'] }, rules: ['DOMAIN-SUFFIX,x.com,PROXY', 'MATCH,DIRECT'] };
  assert.ok(!api.dnsRoutingAudit(on).some(x => x.id === 'dns-bypass-for-proxied-domains'));
  const directOnly = { dns: { enable: true }, rules: ['DOMAIN-SUFFIX,x.com,DIRECT', 'MATCH,DIRECT'] };
  assert.ok(!api.dnsRoutingAudit(directOnly).some(x => x.id === 'dns-bypass-for-proxied-domains'));
  const off = { dns: { enable: false, 'respect-rules': true }, rules: ['DOMAIN,x.com,PROXY', 'MATCH,DIRECT'] };
  assert.equal(api.dnsRoutingAudit(off).length, 0);
  ok('B-negative: respect-rules/DIRECT-only/dns-off → чисто');
}

// --- 5. policy-vs-rule mismatch: локальная политика + правило в группу ---
{
  const doc = { dns: { enable: true, nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.geo.example': '192.0.2.53' } }, rules: ['DOMAIN-SUFFIX,geo.example,PROXY', 'MATCH,DIRECT'] };
  const f = api.dnsRoutingAudit(doc).find(x => x.id === 'dns-policy-vs-rule-mismatch');
  assert.ok(f);
  assert.ok(f.message.includes('geo.example') && f.message.includes('PROXY'));
  const proxyPolicy = { dns: { enable: true, nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.geo.example': 'socks5://198.51.100.7:1080' } }, rules: ['DOMAIN-SUFFIX,geo.example,PROXY', 'MATCH,DIRECT'] };
  assert.ok(!api.dnsRoutingAudit(proxyPolicy).some(x => x.id === 'dns-policy-vs-rule-mismatch'));
  const directRule = { dns: { enable: true, nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.ok.example': '192.0.2.53' } }, rules: ['DOMAIN-SUFFIX,ok.example,DIRECT', 'MATCH,DIRECT'] };
  assert.ok(!api.dnsRoutingAudit(directRule).some(x => x.id === 'dns-policy-vs-rule-mismatch'));
  ok('C: policy локально × правило в группу → warning; негативы чисты');
}

// --- 6. fake-ip + IP-правила → info (CONFIRMED) ---
{
  const doc = { dns: { enable: true, 'enhanced-mode': 'fake-ip', nameserver: ['https://dns.google/dns-query'] }, rules: ['GEOIP,CN,DIRECT', 'MATCH,PROXY'] };
  const f = api.dnsRoutingAudit(doc).find(x => x.id === 'fake-ip-with-ip-rules');
  assert.ok(f && f.severity === 'info');
  assert.ok(f.message.includes('198.18'));
  const noIpRules = { dns: { enable: true, 'enhanced-mode': 'fake-ip' }, rules: ['DOMAIN-SUFFIX,x.com,PROXY', 'MATCH,DIRECT'] };
  assert.ok(!api.dnsRoutingAudit(noIpRules).some(x => x.id === 'fake-ip-with-ip-rules'));
  ok('D: fake-ip × IP-правила → info; негатив чист');
}

// --- 7. мусорный вход ---
{
  assert.equal(api.dnsRoutingAudit(null).length, 0);
  assert.equal(api.dnsRoutingAudit([1]).length, 0);
  assert.equal(api.dnsRoutingAudit({ dns: 'x', rules: 'x' }).length, 0);
  ok('мусорный вход не роняет аудит');
}

// --- 8. отображение: severity-иконки, dns-off текст, чистый конфиг ---
{
  const dirty = { dns: { enable: true, 'respect-rules': true, 'enhanced-mode': 'fake-ip', nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.x.example': '192.0.2.53' } }, rules: ['DOMAIN-SUFFIX,x.example,PROXY', 'GEOIP,CN,DIRECT', 'MATCH,DIRECT'] };
  const t = api.csDnsRoutingText(dirty);
  assert.ok(t.includes('[ERROR]') && t.includes('[WARNING]') && t.includes('[INFO]'));
  assert.ok(t.includes('config.go:1420'));
  const off = api.csDnsRoutingText({ dns: { enable: false } });
  assert.ok(off.includes('неактивна'));
  const clean = api.csDnsRoutingText({ dns: { enable: true, nameserver: ['https://dns.google/dns-query'] }, rules: ['MATCH,DIRECT'] });
  assert.ok(clean.includes('✓'));
  ok('csDnsRoutingText: иконки/источники/dns-off/чистый');
}

// --- 9. redaction: секрет (значение password), повторённый в имени домена, не выводится ---
{
  const SECRET = 'SYNTH_DNS_SECRET_98765';
  const doc = {
    dns: { enable: true, nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { ['+.' + SECRET]: '192.0.2.53' } },
    proxies: [{ name: 'P', type: 'ss', server: '192.0.2.1', port: 1, password: SECRET, cipher: 'aes-128-gcm' }],
    'proxy-groups': [{ name: SECRET, type: 'select', proxies: ['P'] }],
    rules: ['DOMAIN-SUFFIX,' + SECRET + ',P', 'MATCH,G']
  };
  const t = api.csDnsRoutingText(doc);
  assert.ok(!t.includes(SECRET), 'секрет не виден в отображении');
  assert.ok(t.includes('••••••'), 'секрет замаскирован');
  ok('redaction: секрет в имени группы/домене маскируется');
}

console.log('PASS dns-routing-core: ' + cases + ' cases');

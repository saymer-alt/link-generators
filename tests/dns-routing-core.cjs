// DNS↔Routing audit core (v1.11 CANDIDATE) — deterministic suite.
// DNS-CORE извлекается из index.html; он живёт внутри CS-CORE-спана
// (после csRedactText): один grab покрывает оба.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(
  grab('RD-CORE-START', 'RD-CORE-END ===') + grab('CS-CORE-START', 'DNS-CORE-END ===') + '\n' +
  'return { dnsRoutingAudit, csDnsRoutingText, dnsResolverRoute, dnsEffectiveTarget };'
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
  assert.ok(api.dnsRoutingAudit(off).some(f=>f.id==='dns-respect-rules-no-psns')); // parseDNS validates even when disabled
  ok('B-negative: respect-rules/DIRECT-only/dns-off → чисто');
}

// --- 5. policy-vs-rule mismatch: локальная политика + правило в группу ---
{
  const doc = { dns: { enable: true, nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.geo.example': '192.0.2.53' } }, rules: ['DOMAIN-SUFFIX,geo.example,PROXY', 'MATCH,DIRECT'] };
  const f = api.dnsRoutingAudit(doc).find(x => x.id === 'dns-policy-vs-rule-mismatch');
  assert.ok(f);
  assert.ok(f.message.includes('geo.example') && f.message.includes('PROXY'));
  const proxyPolicy = { 'proxy-groups': [{name:'PROXY'}], dns: { enable: true, nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.geo.example': 'https://192.0.2.53/dns-query#PROXY' } }, rules: ['DOMAIN-SUFFIX,geo.example,PROXY', 'MATCH,DIRECT'] };
  assert.ok(!api.dnsRoutingAudit(proxyPolicy).some(x => x.id === 'dns-policy-vs-rule-mismatch'));
  const directRule = { dns: { enable: true, nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.ok.example': '192.0.2.53' } }, rules: ['DOMAIN-SUFFIX,ok.example,DIRECT', 'MATCH,DIRECT'] };
  assert.ok(!api.dnsRoutingAudit(directRule).some(x => x.id === 'dns-policy-vs-rule-mismatch'));
  ok('C: policy локально × правило в группу → warning; негативы чисты');
}

// --- 6. fake-ip + IP-правила → info (UNKNOWN) ---
{
  const doc = { dns: { enable: true, 'enhanced-mode': 'fake-ip', nameserver: ['https://dns.google/dns-query'] }, rules: ['GEOIP,CN,DIRECT', 'MATCH,PROXY'] };
  const f = api.dnsRoutingAudit(doc).find(x => x.id === 'fake-ip-with-ip-rules');
  assert.ok(f && f.severity === 'info');
  assert.ok(f.message.includes('реальный IP') && f.evidence === 'UNKNOWN');
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
  const dirty = { dns: { enable: true, 'respect-rules': true, 'enhanced-mode': 'fake-ip', nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.x.example': '192.0.2.53#DIRECT' } }, rules: ['DOMAIN-SUFFIX,x.example,PROXY', 'GEOIP,CN,DIRECT', 'MATCH,DIRECT'] };
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

// Independent review: negative cases for all five comments and adjacent boundaries.
{
 const doc={dns:{enable:true,nameserver:['https://192.0.2.53/dns-query']},'proxy-groups':[{name:'PROXY'}],rules:['DOMAIN-SUFFIX,x.test,PROXY','MATCH,DIRECT']};
 const ids=d=>api.dnsRoutingAudit(d).map(f=>f.id);
 for(const enable of [undefined,false]) {
  const d=JSON.parse(JSON.stringify(doc)); d.dns.enable=enable;
  assert.ok(!ids(d).includes('dns-bypass-for-proxied-domains'));
  d.dns['respect-rules']=true;
  assert.ok(ids(d).includes('dns-respect-rules-no-psns'));
 }
 ok('D1: omitted/disabled enable suppresses live checks, never structural error');
 for(const uri of ['https://dns.example.invalid/query','tls://dns.example.invalid','quic://dns.example.invalid','192.0.2.53']) {
  assert.equal(api.dnsResolverRoute(uri,doc.dns,doc),'direct');
  const d=JSON.parse(JSON.stringify(doc)); d.dns['nameserver-policy']={'+.x.test':[uri]};
  assert.ok(ids(d).includes('dns-policy-vs-rule-mismatch'));
 }
 ok('D2: encrypted/plain DNS and policy arrays classified by routing, not scheme');
 for(const rules of [
  ['DOMAIN-SUFFIX,x.test,DIRECT','DOMAIN-SUFFIX,x.test,PROXY'],
  ['DOMAIN-SUFFIX,test,DIRECT','DOMAIN,x.test,PROXY'],
  ['MATCH,DIRECT','DOMAIN,x.test,PROXY']
 ]) { const d={...doc,rules,dns:{...doc.dns,'nameserver-policy':{'+.x.test':'192.0.2.53'}}}; assert.ok(!ids(d).includes('dns-bypass-for-proxied-domains')); assert.ok(!ids(d).includes('dns-policy-vs-rule-mismatch')); }
 ok('D3: first matching suffix/exact/MATCH wins; unreachable rules never count');
 for(const fragment of ['#PROXY','#PROXY&ecs=192.0.2.0/24']) {
  const d=JSON.parse(JSON.stringify(doc)); d.dns.nameserver=[doc.dns.nameserver[0]+fragment]; d.dns['nameserver-policy']={'+.x.test':d.dns.nameserver};
  assert.ok(!ids(d).includes('dns-bypass-for-proxied-domains')); assert.ok(!ids(d).includes('dns-policy-vs-rule-mismatch'));
  assert.equal(api.dnsResolverRoute(d.dns.nameserver[0],d.dns,d),'explicit-proxy');
 }
 ok('D4: explicitly selected proxy resolver and policy arrays do not claim DIRECT');
 assert.equal(api.dnsResolverRoute('https://192.0.2.53/#eth0',doc.dns,doc),'unknown');
 assert.equal(api.dnsResolverRoute('https://192.0.2.53/#h3=true',doc.dns,doc),'direct');
 assert.equal(api.dnsResolverRoute('https://192.0.2.53/#PROXY&',doc.dns,doc),'direct'); // last bare fragment, same as Go
 const unknown={...doc,rules:['RULE-SET,unobserved,DIRECT','DOMAIN,x.test,PROXY']};
 assert.equal(api.dnsEffectiveTarget('x.test',unknown.rules),null);
 assert.ok(ids(unknown).includes('dns-analysis-unknown'));
 for (const policy of [{'geosite:cn':['192.0.2.53']},{'+.x.test':['https://192.0.2.53/#eth0']}]) {
  const d={dns:{enable:true,nameserver:['192.0.2.53'],'nameserver-policy':policy},rules:['MATCH,DIRECT']};
  assert.ok(ids(d).includes('dns-analysis-unknown'),'opaque policy/endpoint must not display a clean verdict');
 }
 ok('unknown interface/opaque rule precedence stays UNKNOWN; fragment parameters are not selectors');
 const mixed=JSON.parse(JSON.stringify(doc)); mixed.dns.nameserver.push('https://192.0.2.54/#PROXY');
 assert.ok(ids(mixed).includes('dns-bypass-for-proxied-domains'));
 mixed.dns['respect-rules']=true; mixed.dns['proxy-server-nameserver']=['192.0.2.1'];
 assert.ok(!ids(mixed).includes('dns-bypass-for-proxied-domains'));
 ok('mixed endpoints and respect-rules use per-resolver classification');
}
console.log('PASS dns-routing-core: ' + cases + ' cases');

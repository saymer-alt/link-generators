// Тесты DNS↔Routing PoC — офлайн, синтетические конфиги, node --test.
// Запуск: node --test research/poc/dns-routing/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dnsRoutingAudit, AUDIT_FINDINGS } from './dns-routing-audit.mjs';

const has = (out, id) => out.find(f => f.id === id);

test('A: respect-rules без proxy-server-nameserver → error CONFIRMED', () => {
  const doc = {
    dns: { enable: true, 'respect-rules': true, nameserver: ['https://dns.google/dns-query'] },
    rules: ['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,G']
  };
  const f = has(dnsRoutingAudit(doc), 'dns-respect-rules-no-psns');
  assert.ok(f, 'находка присутствует');
  assert.equal(f.severity, 'error');
  assert.equal(f.evidence, 'CONFIRMED');
});

test('A-negative: respect-rules + proxy-server-nameserver → чисто', () => {
  const doc = {
    dns: { enable: true, 'respect-rules': true, 'proxy-server-nameserver': ['https://1.1.1.1/dns-query'], nameserver: ['https://dns.google/dns-query'] },
    rules: ['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,G']
  };
  assert.ok(!has(dnsRoutingAudit(doc), 'dns-respect-rules-no-psns'));
});

test('B: прокси-правила без respect-rules → warning INFERRED', () => {
  const doc = {
    dns: { enable: true, nameserver: ['https://dns.google/dns-query'] },
    rules: ['DOMAIN-SUFFIX,openai.com,PROXY', 'MATCH,DIRECT']
  };
  const f = has(dnsRoutingAudit(doc), 'dns-bypass-for-proxied-domains');
  assert.ok(f);
  assert.equal(f.severity, 'warning');
  assert.equal(f.evidence, 'INFERRED');
  assert.ok(f.message.includes('1'));
});

test('B-negative: respect-rules on → DNS-байпас не репортится', () => {
  const doc = {
    dns: { enable: true, 'respect-rules': true, 'proxy-server-nameserver': ['system'], nameserver: ['https://dns.google/dns-query'] },
    rules: ['DOMAIN-SUFFIX,openai.com,PROXY', 'MATCH,DIRECT']
  };
  assert.ok(!has(dnsRoutingAudit(doc), 'dns-bypass-for-proxied-domains'));
});

test('B-negative: доменные правила только на DIRECT → не репортится', () => {
  const doc = {
    dns: { enable: true, nameserver: ['https://dns.google/dns-query'] },
    rules: ['DOMAIN-SUFFIX,ru.example,DIRECT', 'MATCH,DIRECT']
  };
  assert.ok(!has(dnsRoutingAudit(doc), 'dns-bypass-for-proxied-domains'));
});

test('C: nameserver-policy локально + правило через прокси → mismatch warning', () => {
  const doc = {
    dns: {
      enable: true, nameserver: ['https://dns.google/dns-query'],
      'nameserver-policy': { '+.geoblocked.example': '192.0.2.53' }
    },
    rules: ['DOMAIN-SUFFIX,geoblocked.example,PROXY', 'MATCH,DIRECT']
  };
  const f = has(dnsRoutingAudit(doc), 'dns-policy-vs-rule-mismatch');
  assert.ok(f);
  assert.ok(f.message.includes('geoblocked.example'));
  assert.ok(f.message.includes('PROXY'));
});

test('C-negative: политика через прокси-схему → не репортится', () => {
  const doc = {
    dns: {
      enable: true, nameserver: ['https://dns.google/dns-query'],
      'nameserver-policy': { '+.geoblocked.example': 'socks5://198.51.100.7:1080' }
    },
    rules: ['DOMAIN-SUFFIX,geoblocked.example,PROXY', 'MATCH,DIRECT']
  };
  assert.ok(!has(dnsRoutingAudit(doc), 'dns-policy-vs-rule-mismatch'));
});

test('C-negative: правило на DIRECT при локальной политике → согласовано', () => {
  const doc = {
    dns: { enable: true, nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.ok.example': '192.0.2.53' } },
    rules: ['DOMAIN-SUFFIX,ok.example,DIRECT', 'MATCH,DIRECT']
  };
  assert.ok(!has(dnsRoutingAudit(doc), 'dns-policy-vs-rule-mismatch'));
});

test('D: fake-ip + IP-правила → info CONFIRMED', () => {
  const doc = {
    dns: { enable: true, 'enhanced-mode': 'fake-ip', nameserver: ['https://dns.google/dns-query'] },
    rules: ['GEOIP,CN,DIRECT', 'MATCH,PROXY']
  };
  const f = has(dnsRoutingAudit(doc), 'fake-ip-with-ip-rules');
  assert.ok(f);
  assert.equal(f.severity, 'info');
  assert.equal(f.evidence, 'CONFIRMED');
  assert.ok(f.message.includes('198.18'));
});

test('D-negative: fake-ip без IP-правил → не репортится', () => {
  const doc = {
    dns: { enable: true, 'enhanced-mode': 'fake-ip', nameserver: ['https://dns.google/dns-query'] },
    rules: ['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,DIRECT']
  };
  assert.ok(!has(dnsRoutingAudit(doc), 'fake-ip-with-ip-rules'));
});

test('dns.enable: false → аудитор молчит (секция неактивна)', () => {
  const doc = {
    dns: { enable: false, 'respect-rules': true },
    rules: ['DOMAIN,example.com,PROXY', 'MATCH,DIRECT']
  };
  assert.equal(dnsRoutingAudit(doc).length, 0);
});

test('мусорный вход не роняет аудит', () => {
  assert.equal(dnsRoutingAudit(null).length, 0);
  assert.equal(dnsRoutingAudit([1, 2]).length, 0);
  assert.equal(dnsRoutingAudit({ dns: 'oops', rules: 'oops' }).length, 0);
});

test('реестр находок согласован с эмиттером', () => {
  const doc = {
    dns: { enable: true, 'respect-rules': true, 'enhanced-mode': 'fake-ip', nameserver: ['https://dns.google/dns-query'], 'nameserver-policy': { '+.x.example': '192.0.2.53' } },
    rules: ['DOMAIN-SUFFIX,x.example,PROXY', 'GEOIP,CN,DIRECT', 'MATCH,DIRECT']
  };
  const out = dnsRoutingAudit(doc);
  for (const f of out) assert.ok(AUDIT_FINDINGS[f.id], 'id в реестре: ' + f.id);
  const seen = new Set(out.map(f => f.id));
  for (const f of out) assert.equal(f.severity, AUDIT_FINDINGS[f.id].severity);
  assert.ok(seen.has('dns-respect-rules-no-psns') && seen.has('fake-ip-with-ip-rules') && seen.has('dns-policy-vs-rule-mismatch'));
});

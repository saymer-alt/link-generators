// Config Studio core — deterministic unit suite (v1.11 #176/#177).
// Ядро извлекается из index.html по маркерам CS-CORE-START/END и исполняется
// через new Function — тот же код, что и в браузере (паттерн dependency-graph.cjs).
// Парсинг фикстур — через тот же js-yaml, что и страница (process.env.JS_YAML_PATH).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require(process.env.JS_YAML_PATH); // см. docs/TESTING.md

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const s = html.indexOf('CS-CORE-START');
const e = html.indexOf('CS-CORE-END');
assert.ok(s !== -1 && e !== -1 && s < e, 'CS core markers not found in index.html');
const coreStart = html.lastIndexOf('\n', s) + 1;
const coreEnd = html.indexOf('\n', e) + 1;
const core = html.slice(coreStart, coreEnd);
const api = new Function(core + '\nreturn { csIsSecretKey, csRedactUrl, csRedactValue, csSummarize, csScanSecrets, csCollectRefs, csRuleTarget, csDiagnostics, csFormatScalar, csLineDiff, CS_BUILTIN_TARGETS };')();

let cases = 0;
const ok = () => { cases++; };
const parse = t => yaml.load(t);

const SYNTH = [
  '# синтетический конфиг для тестов (RFC5737 + example.invalid)',
  'mixed-port: 7890',
  'mode: rule',
  'external-controller: 127.0.0.1:9090',
  'dns:',
  '  enable: true',
  '  nameservers:',
  '    - 1.1.1.1',
  'tun:',
  '  enable: true',
  '  device: mitun0',
  'proxies:',
  '  - name: " Alpha Proxy "',
  '    type: ss',
  '    server: 198.51.100.10',
  '    port: 8443',
  '    password: supersynthetic-pass-1',
  '    cipher: aes-128-gcm',
  '  - name: Unused-Proxy',
  '    type: ss',
  '    server: 198.51.100.11',
  '    port: 8443',
  '    password: supersynthetic-pass-2',
  '    cipher: aes-128-gcm',
  'proxy-groups:',
  '  - name: MAIN',
  '    type: select',
  '    proxies:',
  '      - " Alpha Proxy "',
  '      - DIRECT',
  '  - name: AUTO',
  '    type: url-test',
  '    proxies:',
  '      - " Alpha Proxy "',
  '      - Missing-Proxy',
  '    url: https://www.gstatic.com/generate_204',
  'proxy-providers:',
  '  prov-one:',
  '    type: http',
  '    url: "https://subs.example.invalid/api/v1/client/token/synthtoken1234567890abcdef"',
  '    interval: 86400',
  '    health-check:',
  '      enable: true',
  '      url: https://www.gstatic.com/generate_204',
  'rules:',
  '  - DOMAIN-SUFFIX,example.com,MAIN',
  '  - IP-CIDR,198.51.100.0/24,AUTO,no-resolve',
  '  - MATCH,DIRECT'
].join('\n');

// --- 1. summarize: счётчики и булевы ---
{
  const doc = parse(SYNTH);
  const s = api.csSummarize(doc);
  assert.equal(s.proxies, 2);
  assert.equal(s.groups, 2);
  assert.equal(s.providers, 1);
  assert.equal(s.ruleProviders, 0);
  assert.equal(s.rules, 3);
  assert.equal(s.dns, true);
  assert.equal(s.tun, true);
  assert.equal(s.mode, 'rule');
  assert.equal(s.hasExternalController, true, 'external-controller — факт заданности');
  assert.equal(api.csSummarize(null), null);
  ok();
}

// --- 2. secret key classification ---
{
  for (const k of ['password', 'private-key', 'private_key', 'secret', 'token', 'uuid', 'preshared-key', 'psk', 'auth', 'authorization', 'x-hwid', 'obfs-password', 'auth-str']) {
    assert.equal(api.csIsSecretKey(k), true, 'secret: ' + k);
  }
  for (const k of ['public-key', 'server', 'port', 'cipher', 'sni', 'ws-path', 'servername', 'skip-cert-verify', 'mode']) {
    assert.equal(api.csIsSecretKey(k), false, 'not secret: ' + k);
  }
  ok();
}

// --- 3. redaction of values and tokenized URLs ---
{
  assert.equal(api.csRedactValue('password', 'xyz'), '••••••');
  assert.equal(api.csRedactValue('server', '198.51.100.10'), '198.51.100.10');
  const u1 = api.csRedactValue('url', 'https://subs.example.invalid/api/v1/client/token/synthtoken1234567890abcdef');
  assert.ok(!u1.includes('synthtoken'), 'path-token скрыт: ' + u1);
  assert.ok(u1.includes('subs.example.invalid'), 'хост читаем');
  const u2 = api.csRedactUrl('https://host.example.invalid/download?token=abc123&x=1');
  assert.ok(!u2.includes('abc123'), 'query скрыт');
  assert.ok(u2.includes('?<params hidden>'));
  const plain = api.csRedactValue('note', 'plain text');
  assert.equal(plain, 'plain text');
  ok();
}

// --- 4. secret inventory: пути, не значения ---
{
  const doc = parse(SYNTH);
  const inv = api.csScanSecrets(doc);
  assert.equal(inv.length, 2, 'два password-поля');
  for (const item of inv) {
    assert.equal(item.key, 'password');
    assert.ok(item.path.startsWith('$.proxies['), 'путь: ' + item.path);
    assert.ok(!JSON.stringify(item).includes('supersynthetic'), 'значений в инвентаре нет');
  }
  ok();
}

// --- 5. refs: kinds + toKind ---
{
  const doc = parse(SYNTH);
  const { refs, kindOf } = api.csCollectRefs(doc);
  const member = refs.find(r => r.kind === 'group-member' && r.to === ' Alpha Proxy ');
  assert.ok(member, 'group-member найден');
  assert.equal(member.toKind, 'proxy');
  assert.deepEqual(member.fromPath, { groupIndex: 0, memberIndex: 0 });
  const missing = refs.find(r => r.kind === 'group-member' && r.to === 'Missing-Proxy');
  assert.equal(missing.toKind, 'unknown');
  const rt = refs.find(r => r.kind === 'rule-target' && r.to === 'AUTO');
  assert.equal(rt.toKind, 'group');
  assert.equal(rt.fromPath.ruleIndex, 1);
  assert.equal(kindOf('DIRECT'), 'builtin');
  assert.equal(kindOf('prov-one'), 'provider');
  ok();
}

// --- 6. csRuleTarget: MATCH / опции / RULE-SET ---
{
  assert.equal(api.csRuleTarget('MATCH,DIRECT'), 'DIRECT');
  assert.equal(api.csRuleTarget('DOMAIN-SUFFIX,example.com,MAIN'), 'MAIN');
  assert.equal(api.csRuleTarget('IP-CIDR,198.51.100.0/24,AUTO,no-resolve'), 'AUTO');
  assert.equal(api.csRuleTarget('RULE-SET,prov-set,MyGroup'), 'MyGroup');
  assert.equal(api.csRuleTarget('AND,((DOMAIN,b.com),(NETWORK,UDP)),DIRECT'), 'DIRECT');
  assert.equal(api.csRuleTarget('SUB-RULE,((NETWORK,tcp)),sub1'), '');
  ok();
}

// --- 7. diagnostics: dangling / dup / unused / cycle / provider-target ---
{
  const doc = parse(SYNTH);
  const diags = api.csDiagnostics(doc);
  const codes = diags.map(d => d.code);
  assert.ok(codes.includes('CS-DANGLING-REF'), 'Missing-Proxy member → dangling');
  assert.ok(diags.find(d => d.code === 'CS-DANGLING-REF').message.includes('Missing-Proxy'));
  assert.ok(codes.includes('CS-UNUSED'), 'Unused-Proxy → unused');
  assert.ok(diags.find(d => d.message.includes('Unused-Proxy')).message.includes('GLOBAL'), 'GLOBAL-оговорка обязательна');
  assert.ok(!codes.includes('CS-OK'), 'при ошибках CS-OK нет');
  assert.ok(!diags.some(d => JSON.stringify(d).includes('supersynthetic')), 'секретов в диагностиках нет');
  // провайдер как цель правила
  const doc2 = parse(SYNTH + '\n  - DOMAIN,bad.example,prov-one');
  const d2 = api.csDiagnostics(doc2);
  assert.ok(d2.some(d => d.code === 'CS-DANGLING-REF' && d.message.includes('proxy-provider')), 'provider как цель правила — явная ошибка');
  // дубликаты имён
  const dupYaml = ['proxies:', '  - name: dup-p', '    type: ss', '    server: 198.51.100.12', '    port: 8443', '    password: synth', '    cipher: aes-128-gcm', '  - name: dup-p', '    type: ss', '    server: 198.51.100.13', '    port: 8443', '    password: synth', '    cipher: aes-128-gcm'].join('\n');
  const d3 = api.csDiagnostics(parse(dupYaml));
  assert.ok(d3.some(d => d.code === 'CS-DUP-NAME' && d.message.includes('dup-p')));
  // цикл групп
  const cyc = parse(['proxy-groups:', '  - name: A', '    type: select', '    proxies: [B]', '  - name: B', '    type: select', '    proxies: [A]'].join('\n'));
  const d4 = api.csDiagnostics(cyc);
  assert.ok(d4.some(d => d.code === 'CS-GROUP-CYCLE' && d.message.includes('«A» → «B» → «A»')), 'цикл групп найден');
  // чистый конфиг → CS-OK
  const clean = parse(['proxies:', '  - name: p1', '    type: ss', '    server: 198.51.100.1', '    port: 51820', '    password: synth', '    cipher: aes-128-gcm', 'proxy-groups:', '  - name: G', '    type: select', '    proxies: [p1, DIRECT]', 'rules:', '  - MATCH,G'].join('\n'));
  const d5 = api.csDiagnostics(clean);
  assert.deepEqual(d5.map(d => d.code), ['CS-OK'], 'чистый: единственная INFO');
  ok();
}

// --- 8. scalar formatting для патчей ---
{
  assert.equal(api.csFormatScalar('example.invalid'), 'example.invalid');
  assert.equal(api.csFormatScalar('203.0.113.20'), '203.0.113.20');
  assert.equal(api.csFormatScalar('8443'), '8443');
  assert.equal(api.csFormatScalar('007'), '"007"', 'ведущий ноль защищён');
  assert.equal(api.csFormatScalar('0x1F'), '"0x1F"');
  assert.equal(api.csFormatScalar('my secret value'), '"my secret value"');
  assert.equal(api.csFormatScalar('true'), '"true"', 'bool-подобное квотуем');
  assert.equal(api.csFormatScalar('прокси ✦'), '"прокси ✦"');
  ok();
}

// --- 9. line diff ---
{
  const d = api.csLineDiff('a\nb\nc\n', 'a\nX\nc\n');
  assert.deepEqual(d.filter(x => x.t !== ' ').map(x => x.t + x.line), ['-b', '+X']);
  assert.equal(api.csLineDiff('same\n', 'same\n').filter(x => x.t !== ' ').length, 0);
  ok();
}

// --- 10. safety: мусорные входы ---
{
  assert.equal(api.csSummarize([]), null);
  assert.equal(api.csSummarize('x'), null);
  assert.deepEqual(api.csScanSecrets(null), []);
  const d = api.csDiagnostics(null);
  assert.ok(Array.isArray(d) && d.length === 1 && d[0].code === 'CS-OK', 'null-doc: единственная INFO (структурно ничего не доказать)');
  assert.equal(api.csFormatScalar(''), '""');
  ok();
}

// --- 11. Unicode/emoji имена ---
{
  const doc = parse(['proxies:', '  - name: "🇸🇪 Швеция ✦"', '    type: ss', '    server: 198.51.100.9', '    port: 8443', '    password: synth', '    cipher: aes-128-gcm', 'proxy-groups:', '  - name: Г', '    type: select', '    proxies: ["🇸🇪 Швеция ✦"]', 'rules:', '  - MATCH,Г'].join('\n'));
  const { refs } = api.csCollectRefs(doc);
  const m = refs.find(r => r.kind === 'group-member');
  assert.equal(m.to, '🇸🇪 Швеция ✦');
  assert.equal(m.toKind, 'proxy');
  const d = api.csDiagnostics(doc);
  assert.deepEqual(d.map(x => x.code), ['CS-OK']);
  ok();
}

console.log('PASS config-import: ' + cases + ' groups');

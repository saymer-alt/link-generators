// Config Studio editor engine — deterministic unit suite (#178).
// Загружается vendored cs-yaml.runtime.js + CS-CORE + CS-EDITOR из index.html —
// тот же рантайм и то же ядро, что и в браузере.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSYamlsSrc = fs.readFileSync(path.join(__dirname, '..', 'cs-yaml.runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const csCore = (() => {
  const s = html.indexOf('CS-CORE-START'), e = html.indexOf('CS-CORE-END');
  assert.ok(s !== -1 && e !== -1, 'CS-CORE markers missing');
  return html.slice(html.lastIndexOf('\n', s) + 1, html.indexOf('\n', e) + 1);
})();
const csEditor = (() => {
  const s = html.indexOf('CS-EDITOR-START'), e = html.indexOf('CS-EDITOR-END');
  assert.ok(s !== -1 && e !== -1, 'CS-EDITOR markers missing');
  return html.slice(html.lastIndexOf('\n', s) + 1, html.indexOf('\n', e) + 1);
})();
const api = new Function(CSYamlsSrc + '\n' + csCore + '\n' + csEditor + '\nreturn { CSYaml: CSYaml, csPlanOp, csApplyPatches, csReplay, csDiagnostics, csCollectRefs, csSummarize, csFormatScalar, csLineDiff };')();
const CSY = api.CSYaml;
assert.ok(CSY && typeof CSY.parseDocument === 'function', 'CSYaml vendored runtime loaded');

let cases = 0;
const ok = () => { cases++; };
const parse = t => CSY.parse(t);
const plan = (text, op) => {
  const doc = CSY.parseDocument(text, { keepSourceTokens: true });
  const plain = CSY.parse(text);
  return api.csPlanOp(doc, text, plain, op);
};

const FIXTURE = [
  '# редакторский фиксстурный конфиг (RFC5737/example.invalid, всё синтетика)',
  'mixed-port: 7890',
  '# порядок и комментарии должны выживать',
  'proxies:',
  '  - name: " Alpha Proxy "',
  '    type: ss',
  '    server: 198.51.100.10',
  '    port: 8443',
  '    password: synth-pass-a  # inline-комментарий',
  '    cipher: aes-128-gcm',
  '  - name: Old-Exit',
  '    type: ss',
  '    server: 198.51.100.20',
  '    port: 8443',
  '    password: synth-pass-b',
  '    cipher: aes-128-gcm',
  'proxy-groups:',
  '  - name: MAIN',
  '    type: select',
  '    proxies:',
  '      - " Alpha Proxy "',
  '      - Old-Exit',
  '      - DIRECT',
  'proxy-providers:',
  '  prov-one:',
  '    type: http',
  '    url: "https://subs.example.invalid/api/v1/client/token/synthtoken0987654321"',
  '    interval: 86400',
  'rules:',
  '  - DOMAIN-SUFFIX,example.com,MAIN',
  '  - DOMAIN,legacy.example.invalid,Old-Exit',
  '  - MATCH,DIRECT',
  'custom-unknown-key:',
  '  nested: "00123"'
].join('\n');

// --- 1. field-edit: один сервер, остальное байт-в-байт ---
{
  const plan1 = plan(FIXTURE, { opKind: 'field-edit', type: 'proxy', name: 'Old-Exit', field: 'server', newText: '203.0.113.20' });
  assert.ok(!plan1.error, 'field-edit план: ' + (plan1.error || 'ok'));
  const out = api.csApplyPatches(FIXTURE, plan1.patches);
  assert.ok(out.includes('server: 203.0.113.20'));
  assert.equal(plan1.semantic.old, '198.51.100.20');
  const d = api.csLineDiff(FIXTURE, out);
  const changed = d.filter(x => x.t !== ' ');
  assert.deepEqual(changed.map(x => x.t + x.line), ['-    server: 198.51.100.20', '+    server: 203.0.113.20'], 'ровно одна строка изменена');
  assert.ok(out.includes('synth-pass-a  # inline-комментарий'), 'inline-комментарий выжил');
  assert.ok(out.includes('"00123"'), 'неизвестные ключи/кавычки не тронуты');
  parse(out);
  ok();
}

// --- 2. port edit: число без кавычек ---
{
  const plan1 = plan(FIXTURE, { opKind: 'field-edit', type: 'proxy', name: 'Old-Exit', field: 'port', newText: '9443' });
  const out = api.csApplyPatches(FIXTURE, plan1.patches);
  assert.ok(out.includes('port: 9443'));
  assert.equal(parse(out).proxies[1].port, 9443);
  // ведущий ноль защищается
  const plan2 = plan(FIXTURE, { opKind: 'field-edit', type: 'proxy', name: 'Old-Exit', field: 'port', newText: '007' });
  assert.equal(plan1.patches.length, 1);
  const out2 = api.csApplyPatches(FIXTURE, plan2.patches);
  assert.ok(out2.includes('port: "007"'));
  assert.equal(parse(out2).proxies[1].port, '007');
  ok();
}

// --- 3. provider URL edit: только URL ---
{
  const plan1 = plan(FIXTURE, { opKind: 'field-edit', type: 'proxy-providers', name: 'prov-one', field: 'url', newText: 'https://other.example.invalid/sub/new' });
  const out = api.csApplyPatches(FIXTURE, plan1.patches);
  assert.ok(out.includes("url: https://other.example.invalid/sub/new") || out.includes('url: "https://other.example.invalid/sub/new"'));
  const changed = api.csLineDiff(FIXTURE, out).filter(x => x.t !== ' ');
  assert.equal(changed.length, 2, 'только url-строка: ' + JSON.stringify(changed));
  console.log("DBG patches:", JSON.stringify(plan1.patches), "DBG out-sec:", JSON.stringify(out.split(String.fromCharCode(10)).filter(l => l.includes("prov"))));  const docOut = parse(out);
  assert.equal(docOut['proxy-providers']['prov-one'].url, 'https://other.example.invalid/sub/new');
  ok();
}

// --- 4. rename proxy: определение + член группы + цель правила ---
{
  const plan1 = plan(FIXTURE, { opKind: 'rename', type: 'proxy', name: 'Old-Exit', new: 'New-Exit' });
  assert.ok(!plan1.error, 'rename план: ' + (plan1.error || 'ok'));
  assert.equal(plan1.semantic.refsAffected, 2, '2 ссылки: member + rule target');
  const out = api.csApplyPatches(FIXTURE, plan1.patches);
  const doc = parse(out);
  assert.ok(doc.proxies.some(p => p.name === 'New-Exit'));
  assert.ok(!JSON.stringify(doc).includes('Old-Exit'), 'старое имя исчезло');
  assert.equal(doc['proxy-groups'][0].proxies.includes('New-Exit'), true);
  assert.equal(doc.rules[1], 'DOMAIN,legacy.example.invalid,New-Exit');
  assert.ok(out.includes('# порядок и комментарии должны выживать'), 'комментарии выжили');
  assert.ok(out.includes('synth-pass-a  # inline-комментарий'), 'inline-комментарий выжил');
  // диагностика после переименования чистая
  assert.deepEqual(api.csDiagnostics(doc).filter(x => x.severity === 'error').map(x => x.code), []);
  ok();
}

// --- 5. rename: коллизии и мусорные имена ---
{
  assert.ok(plan(FIXTURE, { opKind: 'rename', type: 'proxy', name: 'Old-Exit', new: 'MAIN' }).error, 'коллизия');
  assert.ok(plan(FIXTURE, { opKind: 'rename', type: 'proxy', name: 'Old-Exit', new: 'A,B' }).error, 'запятая');
  assert.ok(plan(FIXTURE, { opKind: 'rename', type: 'proxy', name: 'Old-Exit', new: '' }).error, 'пустое');
  assert.ok(plan(FIXTURE, { opKind: 'rename', type: 'proxy', name: 'Missing', new: 'X' }).error, 'нет объекта');
  // Unicode
  const plan1 = plan(FIXTURE, { opKind: 'rename', type: 'proxy', name: 'Old-Exit', new: '🇸🇪 Выход ✦' });
  const out = api.csApplyPatches(FIXTURE, plan1.patches);
  assert.equal(parse(out).proxies[1].name, '🇸🇪 Выход ✦');
  ok();
}

// --- 5b. duplicate-looking names make a field edit ambiguous and must fail closed ---
{
  const duplicate = FIXTURE.replace('proxy-groups:', [
    '  - name: Old-Exit',
    '    type: ss',
    '    server: 198.51.100.99',
    '    port: 8449',
    '    password: synth-pass-duplicate',
    '    cipher: aes-128-gcm',
    'proxy-groups:'
  ].join('\n'));
  const result = plan(duplicate, { opKind: 'field-edit', type: 'proxy', name: 'Old-Exit', field: 'server', newText: '203.0.113.99' });
  assert.ok(result.error, 'duplicate object identity must not select the first match silently');
  ok();
}

// --- 6. rename provider: ключ + use-ссылки ---
{
  const withUse = FIXTURE.replace('      - DIRECT', '      - DIRECT\n    use:\n      - prov-one');
  const plan1 = plan(withUse, { opKind: 'rename', type: 'proxy-providers', name: 'prov-one', new: 'prov-two' });
  assert.ok(!plan1.error);
  const out = api.csApplyPatches(withUse, plan1.patches);
  const doc = parse(out);
  assert.ok(doc['proxy-providers']['prov-two'], 'ключ переименован');
  assert.equal(doc['proxy-groups'][0].use[0], 'prov-two', 'use-ссылка обновлена');
  ok();
}

// --- 7. group members: состав/порядок, только блок списка ---
{
  const plan1 = plan(FIXTURE, { opKind: 'group-members', name: 'MAIN', members: ['DIRECT', 'Old-Exit', ' Alpha Proxy '] });
  assert.ok(!plan1.error);
  const out = api.csApplyPatches(FIXTURE, plan1.patches);
  const doc = parse(out);
  assert.deepEqual(doc['proxy-groups'][0].proxies, ['DIRECT', 'Old-Exit', ' Alpha Proxy ']);
  const changed = api.csLineDiff(FIXTURE, out).filter(x => x.t !== ' ');
  assert.ok(changed.every(l => l.line.includes('- ')), 'изменения только в строках members: ' + JSON.stringify(changed));
  // неизвестный участник отклоняется
  assert.ok(plan(FIXTURE, { opKind: 'group-members', name: 'MAIN', members: ['Ghost'] }).error);
  ok();
}

// --- 8. rule target ---
{
  const plan1 = plan(FIXTURE, { opKind: 'rule-target', ruleIndex: 1, newTarget: 'MAIN' });
  const out = api.csApplyPatches(FIXTURE, plan1.patches);
  assert.equal(parse(out).rules[1], 'DOMAIN,legacy.example.invalid,MAIN');
  assert.equal(parse(out).rules[0], 'DOMAIN-SUFFIX,example.com,MAIN', 'соседние правила не тронуты');
  assert.ok(plan(FIXTURE, { opKind: 'rule-target', ruleIndex: 99, newTarget: 'X' }).error);
  ok();
}

// --- 9. delete без ссылок / со ссылками ---
{
  const noRefs = FIXTURE.replace('      - Old-Exit\n', '').replace('  - DOMAIN,legacy.example.invalid,Old-Exit\n', '');
  const plan1 = plan(noRefs, { opKind: 'delete', type: 'proxy', name: 'Old-Exit' });
  assert.ok(!plan1.error, 'delete без ссылок разрешён');
  const out = api.csApplyPatches(noRefs, plan1.patches);
  assert.ok(!parse(out).proxies.some(p => p.name === 'Old-Exit'));
  assert.ok(out.includes('# порядок и комментарии должны выживать'));
  // со ссылками — блок
  const blocked = plan(FIXTURE, { opKind: 'delete', type: 'proxy', name: 'Old-Exit' });
  assert.equal(blocked.error, 'REFS');
  assert.equal(blocked.refs.length, 2);
  ok();
}

// --- 10. rule-target блокирует даже removeRefs; member-ссылки чинятся ---
{
  const blocked = plan(FIXTURE, { opKind: 'delete', type: 'proxy', name: 'Old-Exit', removeRefs: true });
  assert.equal(blocked.error, 'REFS-RULES', 'правило с target=Old-Exit требует ручного перенаправления');
  assert.ok(blocked.message.includes('rule #2'), 'список правил в сообщении: ' + blocked.message);
  // правило убрано → removeRefs чинит member-ссылку
  const noRule = FIXTURE.replace('  - DOMAIN,legacy.example.invalid,Old-Exit\n', '');
  const plan2 = plan(noRule, { opKind: 'delete', type: 'proxy', name: 'Old-Exit', removeRefs: true });
  assert.ok(!plan2.error, 'removeRefs: ' + (plan2.error || 'ok'));
  const out2 = api.csApplyPatches(noRule, plan2.patches);
  const doc2 = parse(out2);
  assert.ok(!doc2.proxies.some(p => p.name === 'Old-Exit'));
  assert.ok(!doc2['proxy-groups'][0].proxies.includes('Old-Exit'), 'member удалён из группы');
  assert.ok(doc2['proxy-groups'][0].proxies.includes('DIRECT'), 'остальные members не тронуты');
  ok();
}

// --- 11. add proxy: вставка в конец, остальное байт-в-байт ---
{
  const plan1 = plan(FIXTURE, { opKind: 'add', fields: { name: 'Added-Node', type: 'ss', server: '203.0.113.99', port: '8443', password: 'synth-new', cipher: 'aes-128-gcm' } });
  assert.ok(!plan1.error, 'add: ' + (plan1.error || 'ok'));
  const out = api.csApplyPatches(FIXTURE, plan1.patches);
  const doc = parse(out);
  const added = doc.proxies.find(p => p.name === 'Added-Node');
  assert.ok(added && added.server === '203.0.113.99' && added.port === 8443);
  const head = out.slice(0, FIXTURE.indexOf('# порядок') + 40);
  assert.equal(head, FIXTURE.slice(0, head.length), 'начало файла не тронуто');
  assert.ok(plan(FIXTURE, { opKind: 'add', fields: { name: 'Old-Exit', type: 'ss', server: 'x', port: '1' } }).error, 'дубликат имени');
  assert.ok(plan(FIXTURE, { opKind: 'add', fields: { name: 'NoPort', type: 'ss', server: 'x' } }).error, 'нет port');
  ok();
}

// --- 12. multi-op replay + undo-семантика ---
{
  const ops = [
    { opKind: 'field-edit', type: 'proxy', name: 'Old-Exit', field: 'server', newText: '203.0.113.20' },
    { opKind: 'rename', type: 'proxy', name: 'Old-Exit', new: 'New-Exit' },
    { opKind: 'field-edit', type: 'proxy-providers', name: 'prov-one', field: 'interval', newText: '43200' }
  ];
  const r = api.csReplay(FIXTURE, ops, CSY);
  const doc = parse(r.text);
  assert.equal(doc.proxies[1].server, '203.0.113.20');
  assert.equal(doc.proxies[1].name, 'New-Exit');
  assert.equal(doc['proxy-providers']['prov-one'].interval, 43200);
  assert.equal(r.applied.length, 3);
  assert.ok(r.applied.every(a => !JSON.stringify(a).includes('synth-pass')), 'секреты в semantic-записях маскированы');
  // undo последней: replay первых двух
  const r2 = api.csReplay(FIXTURE, ops.slice(0, 2), CSY);
  assert.equal(parse(r2.text)['proxy-providers']['prov-one'].interval, 86400);
  ok();
}

// --- 13. anchors/aliases: rename блокирован честно ---
{
  const withAlias = FIXTURE + '\nanchored: *none\n';
  // алиас на несуществующий якорь не спарсится; делаем валидный якорь
  const valid = FIXTURE.replace('# порядок и комментарии должны выживать', 'shared: &AlphaProxy " Alpha Proxy "\n# порядок и комментарии должны выживать').replace('      - " Alpha Proxy "\n      - Old-Exit', '      - *AlphaProxy\n      - Old-Exit');
  const blocked = plan(valid, { opKind: 'rename', type: 'proxy', name: ' Alpha Proxy ', new: 'Renamed' });
  assert.ok(blocked.error && blocked.error.includes('алиас'), 'алиас блокирует переименование: ' + (blocked.error || 'нет ошибки'));
  ok();
}

// --- 14. применять патчи поверх друг друга нельзя (пересечение) ---
{
  const doc = CSY.parseDocument(FIXTURE, { keepSourceTokens: true });
  const plain = parse(FIXTURE);
  const p1 = api.csPlanOp(doc, FIXTURE, plain, { opKind: 'field-edit', type: 'proxy', name: 'Old-Exit', field: 'server', newText: '1.2.3.4' });
  assert.throws(() => api.csApplyPatches(FIXTURE, [p1.patches[0], p1.patches[0]]), /пересечение|некорректный/, 'дубликат диапазона отклонён');
  ok();
}

console.log('PASS config-editor: ' + cases + ' groups');

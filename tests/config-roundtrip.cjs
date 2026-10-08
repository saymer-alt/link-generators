// Config Studio round-trip fidelity (#178, PHASE 11/12) — the primary product
// contract: unrelated bytes never change. Загружается vendored runtime + CS-блоки.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSYamlsSrc = fs.readFileSync(path.join(__dirname, '..', 'cs-yaml.runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(CSYamlsSrc + '\n' + grab('CS-CORE-START', 'CS-CORE-END') + '\n' + grab('CS-EDITOR-START', 'CS-EDITOR-END') + '\nreturn { CSYaml: CSYaml, csReplay, csPlanOp, csApplyPatches, csLineDiff, csDiagnostics };')();
const CSY = api.CSYaml;

let cases = 0;
const ok = () => { cases++; };
const replay = (src, ops) => api.csReplay(src, ops, CSY);

// Фикстура с «опасными» для перепечатки конструкциями: комментарии, выравнивание,
// кавычки, ведущие нули, unknown keys, Unicode.
const FIX = [
  '# головной комментарий',
  'mixed-port:   7890   # выравнивание значения',
  'unquoted-zero: 007',
  'quoted-number: "00123"',
  'proxies:',
  '  - name: Node-A',
  '    type: ss',
  '    server: 198.51.100.10',
  '    port: 8443',
  '    password: synth-pass-a',
  '    cipher: aes-128-gcm',
  '  - name: Node-Б ✦',
  '    type: ss',
  '    server: 198.51.100.20',
  '    port: 8444',
  '    password: synth-pass-b',
  '    cipher: aes-128-gcm',
  '# комментарий между секциями',
  'proxy-groups:',
  '  - name: G',
  '    type: select',
  '    proxies: [Node-A, Node-Б ✦, DIRECT]',
  'rules:',
  '  - DOMAIN-SUFFIX,example.invalid,Node-A',
  '  - MATCH,DIRECT',
  'unknown-section:',
  '  keep: me',
  ''
].join('\n');

// --- 1. no-op round trip: байт-в-байт ---
{
  const r = replay(FIX, []);
  assert.equal(r.text, FIX, 'ноль правок → исходник байт-в-байт');
  ok();
}

// --- 2. одна правка сервера: меняется ровно одна строка ---
{
  const r = replay(FIX, [{ opKind: 'field-edit', type: 'proxy', name: 'Node-A', field: 'server', newText: '203.0.113.10' }]);
  const d = api.csLineDiff(FIX, r.text).filter(x => x.t !== ' ');
  assert.deepEqual(d.map(x => x.t + x.line), ['-    server: 198.51.100.10', '+    server: 203.0.113.10']);
  // всё «опасное» выжило дословно
  for (const piece of ['mixed-port:   7890   # выравнивание значения', 'unquoted-zero: 007', 'quoted-number: "00123"', '# комментарий между секциями', 'password: synth-pass-a', '  keep: me', 'Node-Б ✦']) {
    assert.ok(r.text.includes(piece), 'сохранилось дословно: ' + piece);
  }
  ok();
}

// --- 3. правка в unicode-имени: остальные строки не тронуты ---
{
  const r = replay(FIX, [{ opKind: 'field-edit', type: 'proxy', name: 'Node-Б ✦', field: 'port', newText: '9444' }]);
  const lines = r.text.split('\n');
  const changedIdx = [];
  FIX.split('\n').forEach((l, i) => { if (l !== lines[i]) changedIdx.push(i); });
  assert.deepEqual(changedIdx, [14], 'изменена только строка порта (0-based 14)');
  ok();
}

// --- 4. rename через flow-список и правило ---
{
  const r = replay(FIX, [{ opKind: 'rename', type: 'proxy', name: 'Node-A', new: 'Node-A2' }]);
  assert.ok(r.text.includes('    proxies: [Node-A2, Node-Б ✦, DIRECT]'), 'flow-список обновлён точечно');
  assert.ok(r.text.includes('DOMAIN-SUFFIX,example.invalid,Node-A2'), 'правило обновлено');
  assert.ok(!r.text.includes('Node-A,'), 'старое имя без хвоста исчезло');
  assert.ok(r.text.includes('mixed-port:   7890'), 'выравнивание выжило');
  ok();
}

// --- 5. group-members на flow-списке ---
{
  const r = replay(FIX, [{ opKind: 'group-members', name: 'G', members: ['DIRECT', 'Node-A'] }]);
  assert.ok(r.text.includes('    proxies: [DIRECT, Node-A]'), 'flow-замена: ' + r.text.split('\n').find(l => l.includes('proxies: [')));
  const doc = CSY.parse(r.text);
  assert.deepEqual(doc['proxy-groups'][0].proxies, ['DIRECT', 'Node-A']);
  ok();
}

// --- 6. quotes/type preservation при соседних правках ---
{
  const r = replay(FIX, [{ opKind: 'field-edit', type: 'proxy', name: 'Node-A', field: 'password', newText: 'новый-пароль' }]);
  assert.ok(r.text.includes('unquoted-zero: 007'), '007 не тронут');
  assert.ok(r.text.includes('quoted-number: "00123"'), 'quoted не тронут');
  assert.ok(r.text.includes('password: новый-пароль') || r.text.includes('password: "новый-пароль"'), 'пароль заменён (plain или quoted)');
  assert.equal(CSY.parse(r.text).proxies[0].password, 'новый-пароль');
  // сам пароль в диф-записи замаскирован
  const r2 = replay(FIX, [{ opKind: 'field-edit', type: 'proxy', name: 'Node-A', field: 'password', newText: 'другой' }]);
  assert.ok(r2.applied[0].old === '••••••' && r2.applied[0].new === '••••••', 'semantic-запись маскирует пароль');
  ok();
}

// --- 7. многошаговая сессия (3 правки) + полный no-op откат ---
{
  const ops = [
    { opKind: 'field-edit', type: 'proxy', name: 'Node-A', field: 'server', newText: '203.0.113.10' },
    { opKind: 'group-members', name: 'G', members: ['Node-A', 'Node-Б ✦'] },
    { opKind: 'rule-target', ruleIndex: 1, newTarget: 'Node-Б ✦' }
  ];
  const r = replay(FIX, ops);
  const d = api.csLineDiff(FIX, r.text);
  const changed = d.filter(x => x.t !== ' ');
  assert.equal(changed.length, 6, '6 diff-строк = 3 изменённые строки (server + members + правило): ' + JSON.stringify(changed));
  assert.ok(changed.every(x => /server|Node|MATCH|DIRECT/.test(x.line)), 'контекст изменений правдоподобен');
  const undo = replay(FIX, ops.slice(0, 2));
  assert.equal(undo.text.split('\n').find(l => l.startsWith('  - MATCH')), '  - MATCH,DIRECT', 'undo правила возвращает исходник');
  ok();
}

// --- 8. большой синтетический конфиг: производительность ---
{
  const lines = ['mixed-port: 7890', 'proxies:'];
  for (let i = 0; i < 100; i++) {
    lines.push('  - name: bulk-' + i, '    type: ss', '    server: 198.51.100.' + (i % 256), '    port: ' + (9000 + i), '    password: synth-' + i, '    cipher: aes-128-gcm');
  }
  lines.push('proxy-groups:');
  for (let g = 0; g < 20; g++) lines.push('  - name: grp-' + g, '    type: select', '    proxies: [bulk-' + g + ', bulk-' + ((g + 1) % 100) + ', DIRECT]');
  lines.push('rules:');
  for (let i = 0; i < 500; i++) lines.push('  - DOMAIN-SUFFIX,d' + i + '.example.invalid,grp-' + (i % 20));
  lines.push('  - MATCH,DIRECT');
  const big = lines.join('\n');
  const t0 = Date.now();
  const r = replay(big, [{ opKind: 'field-edit', type: 'proxy', name: 'bulk-42', field: 'server', newText: '203.0.113.42' }]);
  const dt = Date.now() - t0;
  const changed = api.csLineDiff(big, r.text).filter(x => x.t !== ' ');
  assert.deepEqual(changed.map(x => x.t + x.line), ['-    server: 198.51.100.42', '+    server: 203.0.113.42']);
  assert.ok(dt < 5000, '100 proxies/20 groups/500 rules: правка за ' + dt + 'мс');
  ok();
}

// --- 9. экспорт валиден статически (CS-диагностики после правок) ---
{
  const r = replay(FIX, [
    { opKind: 'field-edit', type: 'proxy', name: 'Node-A', field: 'server', newText: '203.0.113.10' },
    { opKind: 'rename', type: 'proxy', name: 'Node-A', new: 'Node-A2' }
  ]);
  const doc = CSY.parse(r.text);
  const diags = api.csDiagnostics(doc);
  assert.deepEqual(diags.filter(x => x.severity === 'error').map(x => x.code), [], 'экспорт без структурных ошибок');
  ok();
}

console.log('PASS config-roundtrip: ' + cases + ' groups');

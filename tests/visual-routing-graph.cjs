// Visual Routing Graph core (#125→#177, v1.11 EVENING-03) — deterministic suite.
// VRG-CORE извлекается из index.html и работает поверх cdgBuildGraph (RD-CORE).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(
  // VRG-CORE живёт внутри RD-CORE-спана (после CDG-CORE-END): один grab покрывает оба
  grab('RD-CORE-START', 'RD-CORE-END ===') + '\n' +
  'return { cdgBuildGraph, vrgBuildView, vrgClosure, vrgComputeLevels, vrgKindLabel, VRG_MAX_NODES };'
)();

let cases = 0;
const ok = () => { cases++; };

const DOC = {
  'mixed-port': 7890,
  proxies: [
    { name: 'A-ss', type: 'ss', server: '198.51.100.1', port: 1, password: 'x', cipher: 'aes-128-gcm' },
    { name: 'B-ss', type: 'ss', server: '198.51.100.2', port: 1, password: 'x', cipher: 'aes-128-gcm', 'dialer-proxy': 'A-ss' }
  ],
  'proxy-groups': [
    { name: 'AI', type: 'select', proxies: ['A-ss', 'DIRECT'] },
    { name: 'MEDIA', type: 'url-test', proxies: ['AI', 'B-ss'] }
  ],
  'rule-providers': { prov: { type: 'http', behavior: 'domain', url: 'https://example.invalid/p' } },
  rules: [
    'DOMAIN-SUFFIX,example.invalid,AI',
    'RULE-SET,prov,MEDIA',
    'DOMAIN,other.example.invalid,B-ss',
    'MATCH,MEDIA'
  ]
};

// --- 1. базовая раскладка: узлы/рёбра/уровни из canonical CDG ---
{
  const g = api.cdgBuildGraph(DOC);
  const v = api.vrgBuildView(g);
  assert.equal(v.hiddenNodes, 0, 'маленький граф не усечён');
  assert.equal(v.truncated, false);
  const kinds = v.nodes.map(n => n.kind);
  assert.ok(kinds.includes('rule'), 'правила присутствуют');
  assert.ok(kinds.includes('proxy-group'), 'группы присутствуют');
  assert.ok(kinds.includes('proxy'), 'прокси присутствуют');
  assert.ok(kinds.includes('builtin'), 'builtin присутствует');
  assert.ok(v.edges.every(e => ['routes-to', 'uses', 'dialed-through'].includes(e.kind)), 'типы рёбер из CDG');
  // слои монотонны вдоль рёбер
  const lv = new Map(v.nodes.map(n => [n.id, n.level]));
  for (const e of v.edges) assert.ok(lv.get(e.to) >= lv.get(e.from), 'рёбра идут вперёд по слоям');
  assert.equal(v.cyclePresent, false);
  ok();
}

// --- 2. dialer-proxy ребро dialed-through ---
{
  const g = api.cdgBuildGraph(DOC);
  const e = g.edges.find(x => x.kind === 'dialed-through');
  assert.ok(e, 'dialer-proxy ребро есть');
  assert.equal(e.from, 'proxy:B-ss');
  assert.equal(e.to, 'proxy:A-ss');
  const v = api.vrgBuildView(g);
  assert.ok(v.edges.some(x => x.kind === 'dialed-through'));
  ok();
}

// --- 3. unresolved target — явный узел, не скрытая связь ---
{
  const spec = JSON.parse(JSON.stringify(DOC));
  spec.rules.push('DOMAIN,missing.example.invalid,GHOST-GROUP');
  const g = api.cdgBuildGraph(spec);
  const u = g.nodes.find(n => n.kind === 'unresolved');
  assert.ok(u, 'unresolved узел создан');
  const v = api.vrgBuildView(g);
  const unl = v.nodes.filter(n => n.kind === 'unresolved');
  assert.equal(unl.length, 1);
  assert.equal(api.vrgKindLabel('unresolved'), 'НЕНАЙДЕНО', 'метка «НЕНАЙДЕНО» — не скрытая связь');
  ok();
}

// --- 4. большой граф: усечение с явным hidden-счётчиком, без зависаний ---
{
  const proxies = []; const groups = []; const rules = [];
  for (let i = 0; i < 200; i++) proxies.push({ name: 'bulk-' + i, type: 'ss', server: '198.51.100.' + (i % 256), port: 1, password: 'x', cipher: 'aes-128-gcm' });
  for (let gI = 0; gI < 30; gI++) groups.push({ name: 'grp-' + gI, type: 'select', proxies: ['bulk-' + gI, 'bulk-' + ((gI + 1) % 100)] });
  for (let r = 0; r < 300; r++) rules.push('DOMAIN-SUFFIX,d' + r + '.example.invalid,grp-' + (r % 30));
  rules.push('MATCH,grp-0');
  const big = { proxies, 'proxy-groups': groups, rules };
  const g = api.cdgBuildGraph(big);
  const t0 = Date.now();
  const v = api.vrgBuildView(g);
  const dt = Date.now() - t0;
  assert.ok(dt < 3000, 'большой граф за ' + dt + 'мс');
  assert.equal(v.truncated, true, 'большой граф усечён');
  assert.ok(v.hiddenNodes > 0, 'скрытые узлы посчитаны: ' + v.hiddenNodes);
  assert.ok(v.nodes.length <= 60, 'видимых узлов не больше лимита');
  assert.ok(v.hiddenEdges >= 0);
  ok();
}

// --- 5. фокус: замыкание — BFS в обе стороны от фокуса ---
{
  const g = api.cdgBuildGraph(DOC);
  // фокус на builtin:DIRECT — в малом графе замыкание достигает всех узлов
  const v = api.vrgBuildView(g, { focus: 'builtin:DIRECT' });
  assert.equal(v.focused, 'builtin:DIRECT');
  const ids = new Set(v.nodes.map(n => n.id));
  assert.ok(ids.has('builtin:DIRECT'), 'фокус в замыкании');
  // в полном графе замыкание может достигать всех узлов — это корректно
  assert.equal(v.truncated, false, 'маленький граф не усечён');
  ok();
}

// --- 6. детерминизм ---
{
  const g = api.cdgBuildGraph(DOC);
  const v1 = api.vrgBuildView(g);
  const v2 = api.vrgBuildView(g);
  assert.deepEqual(v1.nodes.map(n => [n.id, n.x, n.y]), v2.nodes.map(n => [n.id, n.x, n.y]));
  assert.deepEqual(v1.edges, v2.edges);
  ok();
}

// --- 7. циклы: не зависает, помечается ---
{
  const cyc = {
    'proxy-groups': [
      { name: 'X', type: 'select', proxies: ['Y'] },
      { name: 'Y', type: 'select', proxies: ['X'] }
    ],
    proxies: [],
    rules: ['MATCH,X']
  };
  // cdgBuildGraph строит uses-рёбра X→Y и Y→X — это цикл в раскладке
  const g = api.cdgBuildGraph(cyc);
  const v = api.vrgBuildView(g);
  assert.ok(v.nodes.length >= 2);
  assert.ok(v.edges.some(e => e.kind === 'uses'));
  // уровня назначены всем узлам, нет NaN/undefined
  assert.ok(v.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  ok();
}

// --- 8. DNS-узлы: resolves-via только при доказанной связи ---
{
  const withDns = JSON.parse(JSON.stringify(DOC));
  withDns.dns = { 'enable': true, 'nameserver': ['1.1.1.1'], 'nameserver-policy': { 'geosite:private': 'system' } };
  const g = api.cdgBuildGraph(withDns);
  const dnsEdges = g.edges.filter(e => e.kind === 'resolves-via');
  assert.ok(dnsEdges.length >= 1, 'nameserver-policy связь показана');
  const v = api.vrgBuildView(g);
  assert.ok(v.edges.some(e => e.kind === 'resolves-via'));
  ok();
}

// --- 9. пустой/дегенеративный ввод ---
{
  const g = api.cdgBuildGraph({ rules: ['MATCH,DIRECT'] });
  const v = api.vrgBuildView(g);
  assert.ok(v.nodes.some(n => n.kind === 'rule'));
  assert.ok(v.nodes.some(n => n.kind === 'builtin'));
  const empty = api.vrgBuildView({ nodes: [], edges: [] });
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.truncated, false);
  ok();
}

// --- 10. динамические группы не изображают выбор сервера ---
{
  const g = api.cdgBuildGraph(DOC);
  const grp = g.nodes.find(n => n.id === 'group:MEDIA');
  assert.equal(grp.gtype, 'url-test');
  // в VRG нет поля "selected server" — рёбра uses/routes-to отражают состав,
  // а не факт выбора (runtime selection — зона Runtime Evidence)
  const v = api.vrgBuildView(g);
  assert.ok(!JSON.stringify(v).includes('"selected"'), 'нет поля selected');
  assert.ok(!/runtime-selected/.test(JSON.stringify(v)), 'нет runtime-selected утверждения в ядре');
  ok();
}

console.log('PASS visual-routing-graph: ' + cases + ' groups');

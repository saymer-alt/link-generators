// Physical Topology core — deterministic unit suite (v1.11 #149/#177).
// Ядро извлекается из index.html по маркерам PT-CORE-START/END и исполняется
// через new Function — тот же код, что и в браузере (паттерн dependency-graph.cjs).
// Ядро pure: без DOM/сети/YAML; INTENDED ≠ RUNTIME-OBSERVED; Physical ≠ Local Policy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const startMarker = 'PT-CORE-START';
const endMarker = 'PT-CORE-END';
const s = html.indexOf(startMarker);
const e = html.indexOf(endMarker);
assert.ok(s !== -1 && e !== -1 && s < e, 'PT core markers not found in index.html');
const coreStart = html.lastIndexOf('\n', s) + 1;
const coreEnd = html.indexOf('\n', e) + 1;
const core = html.slice(coreStart, coreEnd);
const api = new Function(core + '\nreturn { ptAnalyzeTopology, ptSerialize, ptTraceTopology, ptSimulateTopology, ptDemoTopologySpec, PT_SCHEMA_VERSION, PT_ROLES };')();

let cases = 0;
const ok = () => { cases++; };
const codesOf = r => r.diagnostics.map(d => d.code);
const hasCode = (r, code) => r.diagnostics.some(d => d.code === code);
const chain = (...ids) => {
  const roles = { e: 'entry', t: 'transit', x: 'exit', o: 'final-overlay' };
  return {
    nodes: ids.map(([id, r]) => ({ id, role: roles[r] })),
    links: ids.slice(0, -1).map(([, ], i) => ({ from: ids[i][0], to: ids[i + 1][0] }))
  };
};

// --- 1. canonical 2-hop valid: entry -> exit ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'b' }] });
  assert.equal(r.ok, true, '2-hop: ok');
  assert.equal(r.model.schemaVersion, api.PT_SCHEMA_VERSION);
  assert.deepEqual(r.model.nodes.map(n => n.id), ['a', 'b'], '2-hop: порядок цепочки');
  assert.equal(r.model.links.length, 1);
  assert.ok(hasCode(r, 'PT-INFO-CHAIN'), '2-hop: INFO-CHAIN');
  ok();
}

// --- 2. canonical 3-hop valid + sanitized demo fixture ---
{
  const demo = api.ptDemoTopologySpec();
  const r = api.ptAnalyzeTopology(demo);
  assert.equal(r.ok, true, 'demo: ok');
  assert.deepEqual(r.model.nodes.map(n => n.id), ['msk-entry', 'est-transit', 'swe-exit', 'warp-overlay'], 'demo: порядок цепочки entry→transit→exit→overlay');
  assert.equal(r.model.nodes[3].role, 'final-overlay');
  assert.equal(r.model.links.length, 3, 'demo: ровно 3 физических link');
  // санитизация фикстуры: только RFC5737-адреса, никаких ключей/паролей/URL
  const flat = JSON.stringify(demo);
  assert.ok(!/https?:\/\//.test(flat), 'demo: без URL');
  const ips = flat.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || [];
  assert.ok(ips.every(ip => /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip)), 'demo: только RFC5737-адреса, найдено: ' + ips.join(','));
  assert.ok(!/-----BEGIN|private-key|password|uuid|hwid/i.test(flat), 'demo: без ключей/паролей/HWID');
  ok();
}

// --- 3. multiple transits valid ---
{
  const r = api.ptAnalyzeTopology(chain(['e1', 'e'], ['t1', 't'], ['t2', 't'], ['x1', 'x']));
  assert.equal(r.ok, true);
  assert.deepEqual(r.model.nodes.map(n => n.id), ['e1', 't1', 't2', 'x1']);
  ok();
}

// --- 4. duplicate stable ID ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'a', role: 'exit' }], links: [{ from: 'a', to: 'a' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-DUP-ID'));
  assert.equal(r.model, null, 'дубликат: модель не строится');
  ok();
}

// --- 5. self loop ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'a' }, { from: 'a', to: 'b' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-LINK-SELF'));
  ok();
}

// --- 6. 2-node cycle ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-CYCLE'));
  assert.deepEqual(r.diagnostics.find(d => d.code === 'PT-CYCLE').refs.slice().sort(), ['a', 'b']);
  ok();
}

// --- 7. 3-node cycle ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'transit' }, { id: 'c', role: 'exit' }], links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-CYCLE'));
  ok();
}

// --- 8. disconnected transit ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }, { id: 'lonely', role: 'transit' }], links: [{ from: 'a', to: 'b' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-DISCONNECTED'));
  assert.ok(r.diagnostics.find(d => d.code === 'PT-DISCONNECTED').refs.includes('lonely'));
  ok();
}

// --- 9. unreachable exit ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 't', role: 'transit' }, { id: 'x', role: 'exit' }], links: [{ from: 'a', to: 't' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-EXIT-UNREACHABLE'));
  ok();
}

// --- 10. role order violation: exit -> transit в пути ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'x', role: 'exit' }, { id: 't', role: 'transit' }], links: [{ from: 'a', to: 'x' }, { from: 'x', to: 't' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-ROLE-ORDER'), 'role order: transit после exit');
  ok();
}

// --- 11. multiple entry ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'a2', role: 'entry' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'b' }, { from: 'a2', to: 'a' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-ENTRY-MULTIPLE'));
  ok();
}

// --- 12. multiple exit ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }, { id: 'b2', role: 'exit' }], links: [{ from: 'a', to: 'b' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-EXIT-MULTIPLE'));
  ok();
}

// --- 13. final overlay placement (в середине / не после exit) ---
{
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'o', role: 'final-overlay' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'o' }, { from: 'o', to: 'b' }] });
  assert.equal(r.ok, false);
  assert.ok(hasCode(r, 'PT-OVERLAY-POSITION'), 'overlay в середине цепочки');
  const r2 = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'o1', role: 'final-overlay' }, { id: 'o2', role: 'final-overlay' }], links: [{ from: 'a', to: 'o1' }, { from: 'o1', to: 'o2' }] });
  assert.equal(r2.ok, false);
  assert.ok(hasCode(r2, 'PT-OVERLAY-COUNT'), 'несколько overlay');
  ok();
}

// --- 14. deterministic serialization (порядок массива nodes не семантичен) ---
{
  const specA = { nodes: [{ id: 'a', role: 'entry' }, { id: 't', role: 'transit' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 't' }, { from: 't', to: 'b' }] };
  const specB = { nodes: [{ id: 'b', role: 'exit' }, { id: 'a', role: 'entry' }, { id: 't', role: 'transit' }], links: [{ from: 't', to: 'b' }, { from: 'a', to: 't' }] };
  const a = api.ptSerialize(api.ptAnalyzeTopology(specA).model);
  const b = api.ptSerialize(api.ptAnalyzeTopology(specB).model);
  assert.equal(a, b, 'одна цепочка в разном порядке массива → байт-равная каноническая форма');
  assert.equal(a, api.ptSerialize(api.ptAnalyzeTopology(specA).model), 'повторный вызов детерминирован');
  assert.equal(api.ptSerialize(null), null, 'сериализация не-ok → null');
  assert.equal(api.ptSerialize(api.ptAnalyzeTopology({ nodes: [] }).model), null);
  ok();
}

// --- 15. deterministic semantic trace ---
{
  const model = api.ptAnalyzeTopology(api.ptDemoTopologySpec()).model;
  const t1 = api.ptTraceTopology(model);
  const t2 = api.ptTraceTopology(model);
  assert.equal(t1.text, t2.text, 'trace детерминирован');
  assert.equal(t1.observed, 'NOT_MEASURED', 'observed = NOT_MEASURED до runtime evidence');
  assert.ok(t1.text.includes('Configured (intended) physical path:'), 'формулировка INTENDED');
  assert.ok(!/сейчас идёт|currently using/i.test(t1.text), 'никаких формулировок о фактическом трафике');
  assert.deepEqual(t1.intendedPath.map(p => p.label), ['Client', 'Moscow · ENTRY', 'Estonia · TRANSIT', 'Sweden · EXIT', 'WARP · FINAL OVERLAY', 'Internet']);
  assert.deepEqual(t1.hops.map(h => h.kind), ['ingress', 'physical', 'physical', 'overlay', 'egress']);
  ok();
}

// --- 16. physical / local policy separation ---
{
  const model = api.ptAnalyzeTopology(api.ptDemoTopologySpec()).model;
  // физический граф остался одним ребром Estonia→Sweden, несмотря на 2 кандидата политики
  assert.equal(model.links.filter(l => l.from === 'est-transit').length, 1, 'физическое ребро одно');
  assert.equal(model.localPolicies.length, 1);
  assert.equal(model.localPolicies[0].candidates.length, 2, 'кандидаты политики не превращаются в узлы/рёбра');
  assert.equal(model.nodes.length, 4, 'кандидаты не добавляют узлов');
  const trace = api.ptTraceTopology(model);
  assert.ok(trace.text.includes('Local policy at Estonia · TRANSIT:'), 'политика — отдельная секция');
  assert.ok(trace.text.includes('физическая цель: Sweden · EXIT'));
  // target mismatch — warning, не error
  const r = api.ptAnalyzeTopology({
    nodes: [{ id: 'a', role: 'entry' }, { id: 't', role: 'transit' }, { id: 'b', role: 'exit' }],
    links: [{ from: 'a', to: 't' }, { from: 't', to: 'b' }],
    localPolicies: [{ nodeId: 'a', targetNodeId: 'b', candidates: [{ id: 'c1' }] }]
  });
  assert.equal(r.ok, true, 'mismatch — легальная конфигурация');
  assert.ok(hasCode(r, 'PT-POLICY-TARGET-MISMATCH'));
  assert.ok(!hasCode(r, 'PT-POLICY-TARGET-MISMATCH') || r.diagnostics.find(d => d.code === 'PT-POLICY-TARGET-MISMATCH').severity === 'warning');
  ok();
}

// --- 17. no secrets in diagnostics ---
{
  const r = api.ptAnalyzeTopology({
    nodes: [
      { id: 'a', role: 'entry', engine: 'mihomo' },
      { id: 'b', role: 'exit', transport: 'awg' },
      { id: 'x-http', role: 'transit' }
    ],
    links: [{ from: 'a', to: 'zzz-unknown' }, { from: 'a', to: 'x-http' }, { from: 'x-http', to: 'b' }],
    localPolicies: [{ nodeId: 'a', targetNodeId: 'http://evil.example/leak', candidates: [] }]
  });
  const all = JSON.stringify(r.diagnostics);
  assert.ok(!/https?:\/\//.test(all), 'диагностики не содержат URL');
  assert.ok(!/-----BEGIN|BEGIN OPENSSH|PRIVATE KEY/.test(all), 'диагностики не содержат ключей');
  for (const d of r.diagnostics) {
    assert.ok(['error', 'warning', 'info'].includes(d.severity), 'severity нормирован');
    assert.ok(d.code.startsWith('PT-'), 'стабильный префикс кода');
  }
  ok();
}

// --- 18. Unicode display labels ---
{
  const r = api.ptAnalyzeTopology({
    nodes: [
      { id: 'n1', label: 'Москва · вход', role: 'entry' },
      { id: 'n2', label: 'Эстония · транзит — ϟ', role: 'transit' },
      { id: 'n3', label: 'Северная звезда ✦', role: 'exit' }
    ],
    links: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.model.nodes[1].label, 'Эстония · транзит — ϟ');
  const t = api.ptTraceTopology(r.model);
  assert.ok(t.text.includes('Эстония · транзит — ϟ [TRANSIT]'));
  ok();
}

// --- 19. what-if: middle hop unavailable ---
{
  const model = api.ptAnalyzeTopology(api.ptDemoTopologySpec()).model;
  const snapshot = JSON.stringify(model);
  const down = api.ptSimulateTopology(model, { unavailableNodeIds: ['est-transit'] });
  assert.equal(down.status, 'CHAIN_UNAVAILABLE');
  assert.equal(down.broken.kind, 'node');
  assert.equal(down.broken.nodeId, 'est-transit');
  assert.ok(down.message.includes('Альтернативный физический путь не сконфигурирован'), 'никакой авто-перестройки');
  assert.ok(!/Germany/.test(down.message), 'failover-топология не подставляется');
  const linkDown = api.ptSimulateTopology(model, { unavailableLinkIndexes: [1] });
  assert.equal(linkDown.status, 'CHAIN_UNAVAILABLE');
  assert.equal(linkDown.broken.kind, 'link');
  assert.equal(linkDown.broken.from, 'est-transit');
  assert.equal(api.ptSimulateTopology(model, {}).status, 'INTACT', 'без недоступных — INTACT');
  assert.equal(api.ptSimulateTopology(model, { unavailableNodeIds: ['nope'] }).status, 'INTACT', 'неизвестный id игнорируется');
  assert.equal(api.ptSimulateTopology(null, {}).status, 'NO_MODEL');
  assert.equal(JSON.stringify(model), snapshot, 'what-if не мутирует модель');
  ok();
}

// --- 20. feature OFF / build parity guards ---
{
  // ядро pure: никакого DOM/сети/storage в extracted core
  assert.ok(!/\bdocument\./.test(core), 'ядро не трогает DOM');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(core), 'ядро не ходит в сеть');
  assert.ok(!/localStorage/.test(core), 'ядро не пишет localStorage');
  // мусорный вход — structured diagnostics, не throw
  for (const bad of [null, undefined, 42, 'x', [], {}, { nodes: [] }, { nodes: 'x' }]) {
    const r = api.ptAnalyzeTopology(bad);
    assert.equal(r.ok, false);
    assert.ok(r.diagnostics.length >= 1 && r.diagnostics.every(d => d.code.startsWith('PT-')));
    assert.equal(r.model, null);
  }
  // label по умолчанию = id, INFO
  const r = api.ptAnalyzeTopology({ nodes: [{ id: 'plain', role: 'entry' }, { id: 'out', role: 'exit' }], links: [{ from: 'plain', to: 'out' }] });
  assert.equal(r.model.nodes[0].label, 'plain');
  assert.ok(hasCode(r, 'PT-INFO-LABEL-DEFAULT'));
  ok();
}

// --- 21. branch/merge и schema-классы ---
{
  const br = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }, { id: 'c', role: 'exit' }], links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] });
  assert.equal(br.ok, false);
  assert.ok(hasCode(br, 'PT-LINK-BRANCH') || hasCode(br, 'PT-EXIT-MULTIPLE'));
  const mg = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 't', role: 'transit' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'b' }, { from: 't', to: 'b' }] });
  assert.ok(hasCode(mg, 'PT-LINK-MERGE') || hasCode(mg, 'PT-DISCONNECTED'));
  const rl = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry', role2: 'x' }, { id: 'b', role: 'manager' }], links: [] });
  assert.ok(hasCode(rl, 'PT-BAD-ROLE'));
  const dang = api.ptAnalyzeTopology({ nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'ghost' }] });
  assert.ok(hasCode(dang, 'PT-LINK-DANGLING'));
  // link на id кандидата локальной политики — dangling (разные namespace)
  const cand = api.ptAnalyzeTopology({
    nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }],
    links: [{ from: 'a', to: 'candidate-a' }, { from: 'a', to: 'b' }],
    localPolicies: [{ nodeId: 'a', targetNodeId: 'b', candidates: [{ id: 'candidate-a' }] }]
  });
  assert.ok(hasCode(cand, 'PT-LINK-DANGLING'), 'кандидат политики не является физическим узлом');
  ok();
}

// --- 22. policy валидации ---
{
  const base = { nodes: [{ id: 'a', role: 'entry' }, { id: 't', role: 'transit' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 't' }, { from: 't', to: 'b' }] };
  const dang = api.ptAnalyzeTopology(Object.assign({}, base, { localPolicies: [{ nodeId: 'ghost', targetNodeId: 'b', candidates: [] }] }));
  assert.ok(hasCode(dang, 'PT-POLICY-DANGLING'));
  const overlayTarget = api.ptAnalyzeTopology({
    nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }, { id: 'o', role: 'final-overlay' }],
    links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'o' }],
    localPolicies: [{ nodeId: 'a', targetNodeId: 'o', candidates: [{ id: 'c1' }] }]
  });
  assert.ok(hasCode(overlayTarget, 'PT-POLICY-TARGET-ROLE'), 'overlay — не физическая цель политики');
  const empty = api.ptAnalyzeTopology(Object.assign({}, base, { localPolicies: [{ nodeId: 't', targetNodeId: 'b', candidates: [] }] }));
  assert.equal(empty.ok, true, 'пустые кандидаты — warning, не error');
  assert.ok(hasCode(empty, 'PT-POLICY-EMPTY'));
  assert.equal(empty.diagnostics.find(d => d.code === 'PT-POLICY-EMPTY').severity, 'warning');
  const dup = api.ptAnalyzeTopology(Object.assign({}, base, { localPolicies: [{ nodeId: 't', targetNodeId: 'b', candidates: [{ id: 'c1' }, { id: 'c1', label: 'dup' }, { id: 'c2' }] }] }));
  assert.equal(dup.ok, true);
  assert.ok(hasCode(dup, 'PT-POLICY-CANDIDATE-DUP'));
  assert.equal(dup.model.localPolicies[0].candidates.length, 2, 'дубликат кандидата отброшен, первый сохранён');
  assert.equal(dup.model.localPolicies[0].candidates[0].id, 'c1');
  ok();
}

console.log('PASS physical-topology: ' + cases + ' groups');

// PT Runtime Evidence core (#188, v1.11) — deterministic unit suite.
// PT-CORE + PT-GEN + PT-RUNTIME извлекаются из index.html (маркер конца PT-GEN
// ищется с ' ===' хвостом: 'PT-GEN-END' — подстрока 'PT-GEN-ENDPOINT').
// Классификация/агрегат/резолюция чисты: без DOM/сети/секретов.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(
  grab('PT-CORE-START', 'PT-CORE-END ===') + '\n' +
  grab('PT-GEN-START', 'PT-GEN-END ===') + '\n' +
  grab('PT-RUNTIME-START', 'PT-RUNTIME-END ===') + '\n' +
  'return { ptRuntimeParseProxies, ptResolveSelectionChain, ptClassifyEdge, ptAggregateChain, ptRuntimeFingerprint, ptIsStale, PT_RT_STATES, ptDemoTopologySpec };'
)();

let cases = 0;
const ok = () => { cases++; };

// Синтетический /proxies (Fixture-подобные данные; имена — синтетика)
const PROXIES = {
  'TO_EE': { type: 'Selector', now: 'EE-Mieru', all: ['EE-Mieru', 'EE-VLESS', 'DIRECT'], alive: true },
  'EE-Mieru': { type: 'ss', now: null, all: null, alive: true },
  'EE-VLESS': { type: 'vless', now: null, all: null },
  'TO_SE': { type: 'URLTest', now: 'SE-WG', all: ['SE-WG', 'SE-2'] },
  'SE-WG': { type: 'wireguard', now: null, all: null },
  'FALLBACK_EE': { type: 'Fallback', now: 'EE-Mieru', all: ['EE-Mieru', 'EE-VLESS'] },
  'NESTED': { type: 'Selector', now: 'FALLBACK_EE', all: ['FALLBACK_EE'] },
  'CYCLE-A': { type: 'Selector', now: 'CYCLE-B', all: ['CYCLE-B'] },
  'CYCLE-B': { type: 'Selector', now: 'CYCLE-A', all: ['CYCLE-A'] }
};
const JSON_ALL = JSON.stringify({ proxies: PROXIES });

// --- 1. parse: минимальные безопасные поля ---
{
  const p = api.ptRuntimeParseProxies(JSON_ALL);
  assert.equal(p.TO_EE.type, 'Selector');
  assert.equal(p.TO_EE.now, 'EE-Mieru');
  assert.deepEqual(p.TO_EE.all, ['EE-Mieru', 'EE-VLESS', 'DIRECT']);
  assert.equal(typeof p.TO_EE.alive, 'boolean');
  // секретных полей в /proxies нет по определению API, но парсер их и не копирует
  assert.ok(!('password' in p.TO_EE));
  assert.equal(api.ptRuntimeParseProxies('not json'), null);
  assert.equal(api.ptRuntimeParseProxies('{}'), null);
  ok();
}

// --- 2. selection chain: nested + leaf + cycle + unknown ---
{
  const p = api.ptRuntimeParseProxies(JSON_ALL);
  const r1 = api.ptResolveSelectionChain(p, 'TO_EE');
  assert.deepEqual(r1.chain, ['TO_EE', 'EE-Mieru']);
  assert.equal(r1.tail, 'EE-Mieru');
  const r2 = api.ptResolveSelectionChain(p, 'NESTED');
  assert.deepEqual(r2.chain, ['NESTED', 'FALLBACK_EE', 'EE-Mieru'], 'nested: ' + JSON.stringify(r2));
  const r3 = api.ptResolveSelectionChain(p, 'CYCLE-A');
  assert.equal(r3.cycle, true, 'цикл обнаружен');
  const r4 = api.ptResolveSelectionChain(p, 'Ghost');
  assert.equal(r4.unknown, true);
  assert.deepEqual(r4.chain, ['Ghost'], 'неизвестный лист — unverified tail');
  assert.equal(r4.tail, 'Ghost');
  ok();
}

// --- 3. Fixture A: все reachable, выбор согласован → CONSISTENT ---
{
  const v = api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru', 'EE-VLESS'] }, { status: 'OBSERVED', proxies: api.ptRuntimeParseProxies(JSON_ALL) });
  assert.equal(v.verdict, 'CONSISTENT');
  assert.equal(v.selected, 'EE-Mieru');
  ok();
}

// --- 4. Fixture: alternate candidate того же ребра → тоже CONSISTENT ---
{
  const proxies = api.ptRuntimeParseProxies(JSON_ALL);
  proxies.TO_EE = Object.assign({}, proxies.TO_EE, { now: 'EE-VLESS' });
  const v = api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru', 'EE-VLESS'] }, { status: 'OBSERVED', proxies });
  assert.equal(v.verdict, 'CONSISTENT', 'Mieru→VLESS: LOCAL POLICY changed, PHYSICAL TOPOLOGY unchanged');
  ok();
}

// --- 5. Fixture C: выбор DIRECT → INCONSISTENT ---
{
  const proxies = api.ptRuntimeParseProxies(JSON_ALL);
  proxies.TO_EE = Object.assign({}, proxies.TO_EE, { now: 'DIRECT' });
  const v = api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru', 'EE-VLESS'] }, { status: 'OBSERVED', proxies });
  assert.equal(v.verdict, 'INCONSISTENT');
  assert.ok(v.reason.includes('DIRECT'));
  ok();
}

// --- 6. Fixture F: неизвестный динамический кандидат → UNKNOWN, не INCONSISTENT ---
{
  const proxies = api.ptRuntimeParseProxies(JSON_ALL);
  proxies.TO_EE = Object.assign({}, proxies.TO_EE, { now: 'Dynamic-Provider-Node' });
  const v = api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru'] }, { status: 'OBSERVED', proxies });
  assert.equal(v.verdict, 'UNKNOWN', 'необъявленный кандидат не классифицируется inconsistent');
  ok();
}

// --- 7. Fixture D nested + 11. selection chain отображается ---
{
  const v = api.ptClassifyEdge({ group: 'NESTED', expectedMembers: ['EE-Mieru', 'EE-VLESS'] }, { status: 'OBSERVED', proxies: api.ptRuntimeParseProxies(JSON_ALL) });
  assert.equal(v.verdict, 'CONSISTENT');
  assert.deepEqual(v.chain, ['NESTED', 'FALLBACK_EE', 'EE-Mieru']);
  ok();
}

// --- 8. Fixture: cycle → PARTIAL (не verdict-классификация) ---
{
  const v = api.ptClassifyEdge({ group: 'CYCLE-A', expectedMembers: ['EE-Mieru'] }, { status: 'OBSERVED', proxies: api.ptRuntimeParseProxies(JSON_ALL) });
  assert.equal(v.verdict, 'PARTIAL');
  assert.ok(v.reason.includes('цикл'));
  ok();
}

// --- 9. неполные binding/наблюдения → PARTIAL ---
{
  assert.equal(api.ptClassifyEdge({}, { status: 'OBSERVED', proxies: api.ptRuntimeParseProxies(JSON_ALL) }).verdict, 'PARTIAL');
  assert.equal(api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru'] }, { status: 'OBSERVED' }).verdict, 'PARTIAL');
  const p = api.ptRuntimeParseProxies(JSON_ALL);
  delete p.TO_EE;
  const noGroup = JSON.parse(JSON.stringify({ proxies: p }));
  assert.equal(api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru'] }, { status: 'OBSERVED', proxies: noGroup.proxies }).verdict, 'PARTIAL');
  ok();
}

// --- 10. UNREACHABLE/AUTH_ERROR не классифицируются (вер dict-проход) ---
{
  assert.equal(api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru'] }, { status: 'UNREACHABLE' }).verdict, 'UNREACHABLE');
  assert.equal(api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru'] }, { status: 'AUTH_ERROR' }).verdict, 'AUTH_ERROR');
  assert.equal(api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru'] }, { status: 'STALE' }).verdict, 'STALE');
  ok();
}

// --- 11. Fixture B: middle unreachable → PARTIAL (не CHAIN DOWN) ---
{
  const agg = api.ptAggregateChain([
    { verdict: 'CONSISTENT' },
    { verdict: 'UNREACHABLE' },
    { verdict: 'CONSISTENT' }
  ]);
  assert.equal(agg, 'PARTIAL');
  ok();
}

// --- 12. Fixture C aggregate: DIRECT на одном ребре → INCONSISTENT ---
{
  const agg = api.ptAggregateChain([{ verdict: 'CONSISTENT' }, { verdict: 'INCONSISTENT' }, { verdict: 'CONSISTENT' }]);
  assert.equal(agg, 'INCONSISTENT');
  ok();
}

// --- 13. Fixture F aggregate: UNKNOWN-кандидат → UNKNOWN ---
{
  const agg = api.ptAggregateChain([{ verdict: 'CONSISTENT' }, { verdict: 'UNKNOWN' }]);
  assert.equal(agg, 'UNKNOWN');
  ok();
}

// --- 14. полный CONSISTENT и пустой вход ---
{
  assert.equal(api.ptAggregateChain([{ verdict: 'CONSISTENT' }, { verdict: 'CONSISTENT' }, { verdict: 'CONSISTENT' }]), 'CONSISTENT');
  assert.equal(api.ptAggregateChain([]), 'UNKNOWN');
  ok();
}

// --- 15. Fixture G: stale по структуре (fingerprint), НЕ по времени ---
{
  const spec = { nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'b' }] };
  const profiles = { a: { group: 'TO_X' } };
  const fp = api.ptRuntimeFingerprint(spec, profiles);
  const evidence = { checkedAt: '14:32:10', fingerprint: fp, verdict: 'CONSISTENT' };
  assert.equal(api.ptIsStale(evidence, fp), false, 'без структурных изменений — не stale (время не считается)');
  const spec2 = JSON.parse(JSON.stringify(spec));
  spec2.nodes[0].label = 'переименован';
  assert.equal(api.ptIsStale(evidence, api.ptRuntimeFingerprint(spec2, profiles)), true, 'изменение топологии → STALE');
  const profiles2 = { a: { group: 'ДРУГАЯ_ГРУППА' } };
  assert.equal(api.ptIsStale(evidence, api.ptRuntimeFingerprint(spec, profiles2)), true, 'изменение binding → STALE');
  ok();
}

// --- 16. states полный набор зафиксирован ---
{
  assert.deepEqual(api.PT_RT_STATES, ['NOT_CHECKED', 'FETCHING', 'OBSERVED', 'PARTIAL', 'UNREACHABLE', 'AUTH_ERROR', 'STALE', 'UNKNOWN']);
  ok();
}

// --- 17. чистота ядра: без DOM/сети/storage/секретов ---
{
  const core = grab('PT-RUNTIME-START', 'PT-RUNTIME-END ===');
  assert.ok(!/\bdocument\./.test(core), 'без DOM');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(core), 'без сети/storage');
  assert.ok(!/Authorization|Bearer/.test(core), 'секреты не входят в классификационное ядро');
  ok();
}

// --- 18. топология демо не мутируется классификацией (чистая функция по входам) ---
{
  const spec = api.ptDemoTopologySpec();
  const before = JSON.stringify(spec);
  const v = api.ptClassifyEdge({ group: 'TO_EE', expectedMembers: ['EE-Mieru'] }, { status: 'OBSERVED', proxies: api.ptRuntimeParseProxies(JSON_ALL) });
  assert.equal(v.verdict, 'CONSISTENT', 'TO_EE присутствует в синтетике → CONSISTENT');
  assert.equal(JSON.stringify(spec), before, 'топология не мутируется');
  ok();
}

console.log('PASS pt-runtime-evidence: ' + cases + ' groups');

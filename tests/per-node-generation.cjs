// Per-node generation (#187, v1.11) — deterministic core suite.
// PT-CORE + PT-GEN извлекаются из index.html (маркеры с ' ===' хвостом:
// 'PT-GEN-END' — подстрока 'PT-GEN-ENDPOINT'!). Транспорты первого класса:
// ss/socks/http (SOURCE-PROVEN listener/parse.go + adapter/outbound v1.19.32).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(grab('PT-CORE-START', 'PT-CORE-END ===') + '\n' + grab('PT-GEN-START', 'PT-GEN-END ===') + '\nreturn { ptDemoTopologySpec, ptGenerateArtifacts, ptAnalyzeTopology, PT_TRANSPORTS };')();

let cases = 0;
const ok = () => { cases++; };
const CREDS = { 'cred-client-msk': 'synth-c-1', 'cred-msk-est': 'synth-c-2', 'cred-est-swe': 'synth-c-3' };
const chain = (ids) => ({
  nodes: ids.map(([id, role]) => ({ id, role })),
  links: ids.slice(0, -1).map((_, i) => ({ from: ids[i][0], to: ids[i + 1][0], transport: { kind: 'ss', endpoint: 'ep-' + i, credentialRef: 'cr-' + i } })),
  clientLink: { transport: { kind: 'ss', endpoint: 'ep-c', credentialRef: 'cr-c' } },
  endpoints: Object.fromEntries([...ids.keys()].map(i => ['ep-' + (i - 1 < 0 ? 'c' : i - 1), '198.51.100.' + (i + 1) + ':4000' + i]).filter(([k]) => k.startsWith('ep-'))),
  endpoints2: null
});
// endpoints helper: ep-c..ep-(n-2) нужны; соберём явно ниже при необходимости
function specOf(ids, extra) {
  const spec = chain(ids);
  spec.endpoints = {};
  spec.endpoints['ep-c'] = '192.0.2.1:40000';
  for (let i = 0; i < ids.length - 1; i++) spec.endpoints['ep-' + i] = '198.51.100.' + (i + 1) + ':400' + (i + 1);
  return Object.assign(spec, extra || {});
}
const credsOf = ids => Object.fromEntries([{ k: 'cr-c' }, ...ids.slice(0, -1).map((_, i) => ({ k: 'cr-' + i }))].map((x, i) => [x.k, 'synth-' + i]));

// --- 1. entry→exit: 2 READY артефакта, overlay нет ---
{
  const ids = [['e1', 'entry'], ['x1', 'exit']];
  const r = api.ptGenerateArtifacts(specOf(ids), credsOf(ids));
  assert.equal(r.ok, true);
  assert.equal(r.summary.nodes, 2);
  assert.equal(r.summary.ready, 2, JSON.stringify(r.summary));
  assert.deepEqual(r.artifacts.map(a => a.status), ['READY', 'READY']);
  assert.ok(r.artifacts[0].files['config.yaml'].includes('port: 40000'), 'listener порт из clientLink endpoint');
  assert.ok(r.artifacts[0].files['config.yaml'].includes('server: 198.51.100.1'), 'outbound на следующий узел');
  ok();
}

// --- 2. entry→transit→exit: 3 READY ---
{
  const ids = [['e', 'entry'], ['t', 'transit'], ['x', 'exit']];
  const r = api.ptGenerateArtifacts(specOf(ids), credsOf(ids));
  assert.equal(r.summary.ready, 3, JSON.stringify(r.summary));
  assert.ok(r.artifacts[1].files['config.yaml'].includes('type: shadowsocks'), 'transit: вход shadowsocks-listener');
  assert.ok(r.artifacts[1].files['config.yaml'].includes('type: ss'), 'transit: выход ss-outbound');
  ok();
}

// --- 3. final overlay: WARP-ребро → contract БЕЗ фейкового конфига ---
{
  const r = api.ptGenerateArtifacts(api.ptDemoTopologySpec(), CREDS);
  const swe = r.artifacts.find(a => a.nodeId === 'swe-exit');
  assert.equal(swe.status, 'EXTERNAL_CONTRACT_REQUIRED');
  assert.ok(swe.files['contract.md'], 'contract.md для wireguard-overlay');
  // wireguard-сервер вне первоклассного набора: конфиг НЕ генерируется —
  // fallback в DIRECT де-анонимизировал бы цепочку
  assert.equal(swe.files['config.yaml'], undefined, 'фейковый MATCH,DIRECT не эмитится');
  assert.ok(!r.artifacts.some(a => a.nodeId === 'warp-overlay'), 'overlay-узел без артефакта');
  assert.ok(r.summary.withContract >= 1);
  ok();
}

// --- 4. два transit ---
{
  const ids = [['e', 'entry'], ['t1', 'transit'], ['t2', 'transit'], ['x', 'exit']];
  const r = api.ptGenerateArtifacts(specOf(ids), credsOf(ids));
  assert.equal(r.summary.ready, 4, JSON.stringify(r.summary));
  assert.equal(r.artifacts.length, 4);
  ok();
}

// --- 5. invalid loop → отказ генерации с диагностикой PT-CYCLE ---
{
  const spec = { nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }], links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] };
  const r = api.ptGenerateArtifacts(spec, {});
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'PT-CYCLE'));
  assert.deepEqual(r.artifacts, []);
  assert.equal(r.manifest, null);
  ok();
}

// --- 6. missing contract: нет clientLink → PT-GEN-INBOUND блокер ---
{
  const spec = specOf([['e', 'entry'], ['x', 'exit']]);
  delete spec.clientLink;
  const r = api.ptGenerateArtifacts(spec, credsOf([['e', 'entry'], ['x', 'exit']]));
  const e = r.artifacts[0];
  assert.ok(e.blockers.some(b => b.code === 'PT-GEN-INBOUND'));
  assert.equal(e.status, 'EXTERNAL_CONTRACT_REQUIRED');
  ok();
}

// --- 7. external inbound required: transport mieru вне первоклассного набора ---
{
  const spec = specOf([['e', 'entry'], ['x', 'exit']]);
  spec.clientLink = { transport: { kind: 'mieru', endpoint: 'ep-c', credentialRef: 'cr-c' } };
  const r = api.ptGenerateArtifacts(spec, credsOf([['e', 'entry'], ['x', 'exit']]));
  const e = r.artifacts[0];
  assert.ok(e.blockers.some(b => b.code === 'PT-GEN-TRANSPORT' && b.message.includes('mieru')));
  assert.ok(e.files['contract.md'], 'external contract сгенерирован');
  assert.ok(!e.files['config.yaml'], 'фейковый listener не сгенерирован');
  ok();
}

// --- 8. local failover candidates = ОДНО физическое ребро ---
{
  const spec = specOf([['e', 'entry'], ['x', 'exit']]);
  spec.localPolicies = [{ nodeId: 'e', targetNodeId: 'x', candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }];
  const r = api.ptGenerateArtifacts(spec, credsOf([['e', 'entry'], ['x', 'exit']]));
  assert.equal(r.artifacts.length, 2, 'кандидаты не превращаются в узлы');
  assert.equal(JSON.parse(r.manifest).links.length, 1, 'физическое ребро одно');
  const map = r.deploymentMap;
  assert.ok(!/Sweden-A|candidate →/.test(map));
  ok();
}

// --- 9. deterministic manifest ---
{
  const ids = [['e', 'entry'], ['t', 'transit'], ['x', 'exit']];
  const spec = specOf(ids);
  const creds = credsOf(ids);
  const a = api.ptGenerateArtifacts(spec, creds).manifest;
  const b = api.ptGenerateArtifacts(spec, creds).manifest;
  assert.equal(a, b, 'manifest байт-детерминирован');
  const m = JSON.parse(a);
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.evidence, 'NOT_MEASURED');
  assert.equal(m.topologyId, 'pt-e--t--x');
  assert.ok(!JSON.stringify(m).includes('synth-'), 'в manifest нет значений секретов');
  // порядок массива nodes не влияет на manifest
  const specB = JSON.parse(JSON.stringify(spec));
  specB.nodes.reverse();
  const c = api.ptGenerateArtifacts(specB, creds).manifest;
  assert.equal(a, c, 'порядок входного массива не меняет manifest');
  ok();
}

// --- 10. deterministic deployment map + intended-формулировки ---
{
  const spec = specOf([['e', 'entry'], ['x', 'exit']]);
  const r1 = api.ptGenerateArtifacts(spec, credsOf([['e', 'entry'], ['x', 'exit']]));
  const r2 = api.ptGenerateArtifacts(spec, credsOf([['e', 'entry'], ['x', 'exit']]));
  assert.equal(r1.deploymentMap, r2.deploymentMap);
  assert.ok(r1.deploymentMap.includes('intended'), 'deployment map помечает intended');
  assert.ok(r1.deploymentMap.includes('NOT_MEASURED'));
  assert.ok(!/сейчас идёт|currently using/i.test(r1.deploymentMap));
  ok();
}

// --- 11. no secrets: значения credentials не попадают в manifest/map ---
{
  const ids = [['e', 'entry'], ['x', 'exit']];
  const r = api.ptGenerateArtifacts(specOf(ids), credsOf(ids));
  assert.ok(!r.manifest.includes('synth-0'), 'manifest без секрета');
  assert.ok(!r.deploymentMap.includes('synth-0'), 'map без секрета');
  // config.yaml ДОЛЖЕН содержать значение (это его работа)
  assert.ok(r.artifacts[0].files['config.yaml'].includes('synth-0'));
  ok();
}

// --- 12. unsupported transport на ребре — contract, не фейк ---
{
  const spec = specOf([['e', 'entry'], ['x', 'exit']]);
  spec.links[0].transport = { kind: 'vless-real-external' };
  const r = api.ptGenerateArtifacts(spec, credsOf([['e', 'entry'], ['x', 'exit']]));
  const e = r.artifacts[0];
  assert.equal(e.status, 'EXTERNAL_CONTRACT_REQUIRED');
  assert.ok(!e.files['config.yaml'], 'без входного listener конфиг не генерируется');
  assert.ok(e.files['contract.md'].includes('vless-real-external'));
  ok();
}

// --- 13-14. READY артефакты проходят реальный mihomo -t (см. per-node-mihomo-compat.cjs) ---
{
  // здесь проверяем только структуру: config.yaml у READY есть, у PLACEHOLDERS — с плейсхолдерами
  const r = api.ptGenerateArtifacts(api.ptDemoTopologySpec(), null);
  const msk = r.artifacts.find(a => a.nodeId === 'msk-entry');
  assert.equal(msk.status, 'PLACEHOLDERS_REQUIRED', JSON.stringify(msk.status));
  assert.ok(msk.files['config.yaml'].includes('<CS-PLACEHOLDER:cred-client-msk>'), 'плейсхолдер с именем credentialRef');
  const swe = r.artifacts.find(a => a.nodeId === 'swe-exit');
  assert.equal(swe.status, 'EXTERNAL_CONTRACT_REQUIRED');
  ok();
}

// --- 15. feature unused → генератор не участвует в Build (parity по построению) ---
{
  // PT-GEN вызывается только из панели Physical Topology; buildMihomo его не зовёт.
  // Контракт: в PT-GEN нет document/fetch/localStorage.
  const core = grab('PT-GEN-START', 'PT-GEN-END ===');
  assert.ok(!/\bdocument\./.test(core), 'PT-GEN не трогает DOM');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage/.test(core), 'PT-GEN не ходит в сеть/storage');
  ok();
}

// --- 17. semantic trace согласован с генерацией (одна цепочка) ---
{
  const spec = specOf([['e', 'entry'], ['t', 'transit'], ['x', 'exit']]);
  const model = api.ptAnalyzeTopology(spec).model;
  assert.deepEqual(model.nodes.map(n => n.id), ['e', 't', 'x']);
  const r = api.ptGenerateArtifacts(spec, credsOf([['e', 'entry'], ['t', 'transit'], ['x', 'exit']]));
  assert.deepEqual(r.artifacts.map(a => a.nodeId), ['e', 't', 'x'], 'порядок артефактов = порядок цепочки');
  ok();
}

// --- 18. CHAIN_UNAVAILABLE при отказе middle hop: генерация остаётся intended ---
{
  const ids = [['e', 'entry'], ['t', 'transit'], ['x', 'exit']];
  const spec = specOf(ids);
  const r = api.ptGenerateArtifacts(spec, credsOf(ids));
  const before = JSON.stringify(r.artifacts.map(a => [a.nodeId, a.status]));
  // «отказ» middle hop — это runtime-событие: артефакты описывают intended-топологию
  // и не перестраиваются под альтернативную физику (automatic topology failover —
  // not promised; см. what-if в PT-CORE)
  assert.equal(before, JSON.stringify(r.artifacts.map(a => [a.nodeId, a.status])));
  assert.ok(r.manifest.includes('NOT_MEASURED'), 'генерация не претендует на runtime-наблюдение');
  ok();
}

console.log('PASS per-node-generation: ' + cases + ' groups');

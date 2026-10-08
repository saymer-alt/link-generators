// PT Network Diagnostics (#177, v1.11 EVENING-02) — deterministic core suite.
// PT-CORE + PT-GEN + PT-DIAG извлекаются из index.html (маркеры с ' ===' хвостом).
// TCP/UDP caps: ss/socks/http SOURCE-PROVEN (v1.19.32), прочее — UNKNOWN (external contract).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(
  grab('PT-CORE-START', 'PT-CORE-END ===') + '\n' +
  grab('PT-GEN-START', 'PT-GEN-END ===') + '\n' +
  grab('PT-RUNTIME-START', 'PT-RUNTIME-END ===') + '\n' +
  grab('PT-DIAG-START', 'PT-DIAG-END ===') + '\n' +
  'return { ptNetworkDiagnostics, ptTcpUdpDiagnostics, ptDnsDiagnostics, ptMtuDiagnostics, ptAnalyzeTopology, ptSimulateTopology, ptDiagIsIpLiteral, ptDiagCaps, ptGenerateArtifacts, ptDemoTopologySpec, PT_DIAG_CAPS };'
)();
// ptDnsDiagnostics использует ptEndpointParts из PT-GEN (endpoint ref → host:port);
// блок PT-GEN подтягивается тем же grab выше.

let cases = 0;
const ok = () => { cases++; };
const ssLink = (from, to, ep) => ({ from, to, transport: { kind: 'ss', endpoint: ep, credentialRef: 'cr-' + from } });
const eps = (pairs) => ({ endpoints: Object.fromEntries(pairs.map(([k, v]) => [k, v])) });

const base2 = () => ({
  nodes: [{ id: 'e', role: 'entry', label: 'Moscow · ENTRY' }, { id: 'x', role: 'exit', label: 'Sweden · EXIT' }],
  links: [ssLink('e', 'x', 'ep1')],
  clientLink: { transport: { kind: 'ss', endpoint: 'ep0' } },
  ...eps([['ep0', '192.0.2.1:40001'], ['ep1', '198.51.100.1:40002']])
});
const CRED = { 'cr-e': 'v1', 'cr-x': 'v2' };

// --- 1. 2-hop all-known: ss/ss → TCP/UDP SUPPORTED end-to-end ---
{
  const model = api.ptAnalyzeTopology(base2()).model;
  const r = api.ptNetworkDiagnostics(base2(), model);
  assert.equal(r.tcpUdp.links.length, 2);
  assert.ok(r.tcpUdp.links.every(l => l.tcp === 'SUPPORTED' && l.udp === 'SUPPORTED'));
  assert.equal(r.tcpUdp.endToEnd.tcp, 'SUPPORTED');
  assert.equal(r.tcpUdp.endToEnd.udp, 'SUPPORTED');
  ok();
}

// --- 2. 3-hop mixed transports (ss + socks + http) ---
{
  const spec = {
    nodes: [{ id: 'e', role: 'entry' }, { id: 't', role: 'transit' }, { id: 'x', role: 'exit' }],
    links: [ssLink('e', 't', 'ep0'), { from: 't', to: 'x', transport: { kind: 'http', endpoint: 'ep1' } }],
    clientLink: { transport: { kind: 'socks', endpoint: 'epc' } },
    ...eps([['epc', '192.0.2.1:1'], ['ep0', '198.51.100.1:2'], ['ep1', '198.51.100.2:3']])
  };
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptNetworkDiagnostics(spec, model);
  assert.equal(r.tcpUdp.endToEnd.tcp, 'SUPPORTED', 'все звенья TCP-capable');
  assert.equal(r.tcpUdp.endToEnd.udp, 'UNSUPPORTED', 'HTTP-звено убивает сквозной UDP');
  const httpLink = r.tcpUdp.links.find(l => l.kind === 'http');
  assert.equal(httpLink.udp, 'UNSUPPORTED');
  assert.ok(httpLink.notes.includes('TCP'));
  ok();
}

// --- 3. missing transport → UNKNOWN на звене ---
{
  const spec = base2();
  delete spec.links[0].transport;
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptNetworkDiagnostics(spec, model);
  // links[0] = clientLink (Client → ENTRY), links[1] = inter-node e→x
  const inter = r.tcpUdp.links[1];
  assert.equal(inter.kind, null);
  assert.equal(inter.tcp, 'UNKNOWN');
  assert.equal(r.tcpUdp.endToEnd.tcp, 'UNKNOWN');
  ok();
}

// --- 4. unsupported transport → UNKNOWN (external contract), генерация согласована ---
{
  const spec = base2();
  spec.links[0].transport = { kind: 'mystery-transport', endpoint: 'ep1' };
  const model = api.ptAnalyzeTopology(spec).model;
  const diag = api.ptNetworkDiagnostics(spec, model);
  // links[0] = clientLink (ss), links[1] = inter-node с mystery-transport
  const inter = diag.tcpUdp.links[1];
  assert.equal(inter.tcp, 'UNKNOWN');
  assert.ok(inter.notes.includes('внешний контракт'));
  const gen = api.ptGenerateArtifacts(spec, CRED);
  assert.equal(gen.artifacts[0].status, 'EXTERNAL_CONTRACT_REQUIRED');
  // согласованность: generation EXTERNAL_CONTRACT ⇒ не заявляем SUPPORTED end-to-end
  assert.notEqual(diag.tcpUdp.endToEnd.tcp, 'SUPPORTED');
  ok();
}

// --- 5. TCP known / UDP unknown (wireguard-overlay как external) ---
{
  const spec = api.ptDemoTopologySpec();
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptNetworkDiagnostics(spec, model);
  const wg = r.tcpUdp.links.find(l => l.kind === 'wireguard');
  assert.equal(wg.tcp, 'UNKNOWN');
  assert.equal(wg.udp, 'UNKNOWN');
  assert.equal(r.tcpUdp.endToEnd.udp, 'UNKNOWN');
  ok();
}

// --- 6. explicit DNS expectation (node.dns.destination = exit) ---
{
  const spec = base2();
  spec.nodes[0].dns = { destination: 'exit' };
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptDnsDiagnostics(spec, model);
  assert.equal(r.destination.verdict, 'INTENDED_AT_EXIT');
  assert.ok(r.destination.reason.includes('INTENDED'));
  ok();
}

// --- 7. missing DNS configuration → UNKNOWN с точной причиной ---
{
  const model = api.ptAnalyzeTopology(base2()).model;
  const r = api.ptDnsDiagnostics(base2(), model);
  assert.equal(r.destination.verdict, 'UNKNOWN');
  assert.ok(r.destination.reason.includes('per-node DNS configuration not provided'));
  ok();
}

// --- 8. next-hop hostname: resolve-at-source; IP literal: PROVEN_NO_DNS ---
{
  const spec = {
    nodes: [{ id: 'e', role: 'entry', label: 'Moscow · ENTRY' }, { id: 'x', role: 'exit', label: 'Sweden · EXIT' }],
    links: [{ from: 'e', to: 'x', transport: { kind: 'ss', endpoint: 'ep1', credentialRef: 'cr' } }],
    clientLink: { transport: { kind: 'ss', endpoint: 'ep0' } },
    ...eps([['ep0', '192.0.2.1:1'], ['ep1', 'est-transit.example.invalid:443']])
  };
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptDnsDiagnostics(spec, model);
  const nh = r.nextHops[1];
  assert.equal(nh.verdict, 'SOURCE-PROVEN_AT_SOURCE');
  assert.ok(nh.where.includes('ProxyServerHostResolver') && nh.where.includes('Moscow · ENTRY'), 'hostname резолвится на исходном узле (Moscow): ' + nh.where);
  const ipSpec = JSON.parse(JSON.stringify(spec));
  ipSpec.endpoints.ep1 = '203.0.113.9:443';
  const r2 = api.ptDnsDiagnostics(ipSpec, api.ptAnalyzeTopology(ipSpec).model);
  assert.equal(r2.nextHops[1].verdict, 'PROVEN_NO_DNS');
  ok();
}

// --- 9. final WARP overlay без proof → UNKNOWN, DNS-заглушка не выдумывается ---
{
  const r = api.ptNetworkDiagnostics(api.ptDemoTopologySpec(), api.ptAnalyzeTopology(api.ptDemoTopologySpec()).model);
  assert.equal(r.mtu.overall, 'UNKNOWN');
  assert.ok(r.tcpUdp.links.some(l => l.kind === 'wireguard' && l.tcp === 'UNKNOWN'));
  ok();
}

// --- 10. explicit MTU без измерения → PARTIAL ---
{
  const spec = base2();
  spec.links[0].transport.mtu = 1400;
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptMtuDiagnostics(spec, model);
  assert.equal(r.overall, 'PARTIAL');
  assert.equal(r.hops[0].mtuConfigured, 1400);
  assert.equal(r.hops[0].evidence, 'DECLARED');
  assert.ok(r.note.includes('не измерялся'));
  ok();
}

// --- 11. AWG/unknown overhead — честный UNKNOWN/PARTIAL, без арифметики ---
{
  const spec = base2();
  spec.links[0].transport.mtu = 1400;
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptMtuDiagnostics(spec, model);
  const h = r.hops[0];
  assert.equal(h.overhead.level, 'PARTIAL');
  assert.ok(!/=\s*\d+\s*байт.*итого|recommended MTU: \d+/i.test(JSON.stringify(r)));
  // суммирование overhead по звеньям не выполняется
  assert.ok(!r.note.match(/\d+\s*[-–]\s*\d+\s*байт/));
  ok();
}

// --- 12. what-if: недоступный middle hop → CHAIN_UNAVAILABLE в диагностике ---
{
  const spec = {
    nodes: [{ id: 'e', role: 'entry' }, { id: 't', role: 'transit' }, { id: 'x', role: 'exit' }],
    links: [ssLink('e', 't', 'ep0'), ssLink('t', 'x', 'ep1')],
    clientLink: { transport: { kind: 'ss', endpoint: 'epc' } },
    ...eps([['epc', '192.0.2.1:1'], ['ep0', '198.51.100.1:2'], ['ep1', '198.51.100.2:3']])
  };
  const model = api.ptAnalyzeTopology(spec).model;
  const intact = api.ptNetworkDiagnostics(spec, model);
  assert.equal(intact.chainAvailability, 'INTACT');
  const down = api.ptNetworkDiagnostics(spec, model, { unavailableNodeIds: ['t'] });
  assert.equal(down.chainAvailability, 'CHAIN_UNAVAILABLE');
  assert.ok(down.chainNote.includes('Physical chain broken'), 'chainNote описывает разрыв: ' + down.chainNote);
  assert.equal(down.tcpUdp.endToEnd.tcp, 'CHAIN_UNAVAILABLE');
  ok();
}

// --- 13. per-node generation consistency: READY-цепочка → диагностические SUPPORTED ---
{
  const spec = api.ptDemoTopologySpec();
  const model = api.ptAnalyzeTopology(spec).model;
  const gen = api.ptGenerateArtifacts(spec, { 'cred-client-msk': 'v', 'cred-msk-est': 'v', 'cred-est-swe': 'v' });
  const diag = api.ptNetworkDiagnostics(spec, model);
  for (const a of gen.artifacts) {
    if (a.status !== 'READY') continue;
    const l = diag.tcpUdp.links.find(x => x.to === a.nodeId || x.from === a.nodeId);
    assert.ok(l, 'READY-узел покрыт диагностикой: ' + a.nodeId);
  }
  const swe = gen.artifacts.find(a => a.nodeId === 'swe-exit');
  if (swe.status === 'EXTERNAL_CONTRACT_REQUIRED') {
    assert.equal(diag.tcpUdp.endToEnd.udp, 'UNKNOWN', 'при внешнем контракте нет SUPPORTED end-to-end');
  }
  ok();
}

// --- 14. no secrets in diagnostics ---
{
  const spec = base2();
  spec.credentials = { 'cr-e': 'SUPER_SECRET_CRED_X', 'cr-x': 'SUPER_SECRET_CRED_Y', 'cr-c': 'SUPER_SECRET_CRED_Z' };
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptNetworkDiagnostics(spec, model);
  const text = JSON.stringify(r);
  assert.ok(!text.includes('SUPER_SECRET'), 'diagnostics без секретов');
  assert.ok(!JSON.stringify(r.tcpUdp.links).match(/credentialRef/), 'credentialRef не вытекает в tcp/udp-диагностику');
  const m = api.ptMtuDiagnostics(spec, model);
  assert.ok(!JSON.stringify(m).includes('SUPER_SECRET'));
  ok();
}

// --- 15. malformed metadata rejected safely ---
{
  const spec = base2();
  spec.nodes[0].dns = { destination: 'moon' };
  const a = api.ptAnalyzeTopology(spec);
  assert.equal(a.ok, false);
  assert.ok(a.diagnostics.some(d => d.code === 'PT-DNS-BAD'));
  const spec2 = base2();
  spec2.links[0].transport.mtu = 100;
  const a2 = api.ptAnalyzeTopology(spec2);
  assert.ok(a2.diagnostics.some(d => d.code === 'PT-MTU-BAD'));
  const spec3 = base2();
  spec3.nodes[0].dns = 'exit';
  assert.ok(api.ptAnalyzeTopology(spec3).diagnostics.some(d => d.code === 'PT-DNS-BAD'));
  ok();
}

// --- 16. существующая топология без новых метаданных остаётся валидной ---
{
  const legacy = {
    nodes: [{ id: 'e', role: 'entry' }, { id: 'x', role: 'exit' }],
    links: [{ from: 'e', to: 'x', transport: { kind: 'ss', endpoint: 'ep', credentialRef: 'cr' } }],
    clientLink: { transport: { kind: 'ss', endpoint: 'epc' } },
    ...eps([['epc', '192.0.2.1:1'], ['ep1', '198.51.100.1:2']])
  };
  delete legacy.endpoints;
  legacy.endpoints = { epc: '192.0.2.1:1', ep: '198.51.100.1:2' };
  const a = api.ptAnalyzeTopology(legacy);
  assert.equal(a.ok, true, 'legacy-топология без node.dns/mtu валидна');
  assert.equal(a.diagnostics.some(d => d.code === 'PT-DNS-BAD' || d.code === 'PT-MTU-BAD'), false);
  ok();
}

// --- 17. Build parity: диагностика не входит в build-путь ---
{
  const diag = grab('PT-DIAG-START', 'PT-DIAG-END ===');
  assert.ok(!/\bdocument\./.test(diag), 'PT-DIAG без DOM');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage/.test(diag), 'PT-DIAG без сети/storage');
  assert.ok(!/buildMihomo|buildFromRequest/.test(diag), 'PT-DIAG вне build-пути');
  ok();
}

// --- 18. детерминизм ---
{
  const spec = api.ptDemoTopologySpec();
  const m1 = api.ptNetworkDiagnostics(spec, api.ptAnalyzeTopology(spec).model);
  const m2 = api.ptNetworkDiagnostics(spec, api.ptAnalyzeTopology(spec).model);
  assert.deepEqual(m1, m2, 'диагностика детерминирована');
  ok();
}

// --- 19. EVENING-03 A2: exit по роли, не по позиции (WARP-overlay последним) ---
{
  const spec = api.ptDemoTopologySpec();
  spec.nodes[0].dns = { destination: 'exit' };
  const model = api.ptAnalyzeTopology(spec).model;
  const r = api.ptDnsDiagnostics(spec, model);
  assert.equal(r.destination.verdict, 'INTENDED_AT_EXIT');
  // exit — Sweden · EXIT (роль exit), НЕ последний WARP-узел
  assert.ok(r.destination.reason.includes('Sweden · EXIT'), 'exit resolved by role: ' + r.destination.reason);
  // противоречивые декларации (exit + local) → INTENDED_CONFLICT
  const specC = api.ptDemoTopologySpec();
  specC.nodes[1].dns = { destination: 'exit' };
  specC.nodes[2].dns = { destination: 'local' };
  const mc = api.ptAnalyzeTopology(specC).model;
  const rc = api.ptDnsDiagnostics(specC, mc);
  assert.equal(rc.destination.verdict, 'INTENDED_CONFLICT', 'противоречивые декларации видны: ' + JSON.stringify(rc.destination));
  ok();
}

// --- 20. EVENING-03 A4: prototype-safe transport lookup ---
{
  for (const hostile of ['constructor', 'toString', '__proto__', 'hasOwnProperty', '']) {
    const caps = api.ptDiagCaps ? api.ptDiagCaps(hostile) : null;
    const viaTcpUdp = api.ptNetworkDiagnostics(
      { nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }],
        links: [{ from: 'a', to: 'b', transport: { kind: hostile, endpoint: 'ep' } }],
        clientLink: { transport: { kind: 'ss', endpoint: 'ep0' } },
        endpoints: { ep: '198.51.100.1:1', ep0: '192.0.2.1:1' } },
      api.ptAnalyzeTopology({
        nodes: [{ id: 'a', role: 'entry' }, { id: 'b', role: 'exit' }],
        links: [{ from: 'a', to: 'b' }], clientLink: { transport: { kind: 'ss' } } }).model,
      {});
    // на хостильном kind связью должен быть UNKNOWN, никогда SOURCE-PROVEN SUPPORTED
    const link = viaTcpUdp.tcpUdp.links.find(l => l.from === 'a');
    assert.equal(link.tcp, 'UNKNOWN', 'hostile kind ' + JSON.stringify(hostile) + ' → UNKNOWN, got ' + link.tcp);
  }
  ok();
}

console.log('PASS pt-network-diagnostics: ' + cases + ' groups');

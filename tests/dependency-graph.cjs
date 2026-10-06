// Config Dependency Graph + Domain Coverage core — deterministic unit suite.
// Ядро извлекается из index.html по маркерам RD-CORE-START/END (CDG-блок живёт
// внутри RD-CORE) и исполняется через new Function — тот же код, что и в браузере.
// Модель строится ТОЛЬКО из generated config; без спекулятивных узлов/рёбер.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const startMarker = '=== ROUTING DIAGNOSTICS CORE';
const endMarker = 'RD-CORE-END ===';
const s = html.indexOf(startMarker);
const e = html.indexOf(endMarker);
assert.ok(s !== -1 && e !== -1, 'RD core markers not found in index.html');
assert.ok(html.indexOf('CDG-CORE-START') !== -1 && html.indexOf('CDG-CORE-END') !== -1, 'CDG markers not found inside RD core');
const coreStart = html.lastIndexOf('\n', s) + 1;
const coreEnd = html.indexOf('*/', e) + 2;
const core = html.slice(coreStart, coreEnd);
const api = new Function(core + '\nreturn { rdParseRule, rdClassifyInput, routingInspect, cdgBuildGraph, cdgDomainCoverage, rdSemanticTargetText, rdTargetIsRuntimeSelected };')();

let cases = 0;
const ok = () => { cases++; };

const docOf = (rules, providers, extra) => Object.assign({ rules, 'rule-providers': providers || {}, 'proxy-groups': [], proxies: [] }, extra || {});

// --- graph: rule → builtin target ---
{
  const d = docOf(['DOMAIN,example.com,DIRECT', 'MATCH,GLOBAL']);
  const g = api.cdgBuildGraph(d);
  const kinds = Object.fromEntries(g.nodes.map(n => [n.id, n.kind]));
  assert.equal(kinds['rule:0'], 'rule');
  // #140 review: builtin-таргеты — typed nodes (referential integrity)
  assert.equal(kinds['builtin:DIRECT'], 'builtin', 'builtin-таргет — typed node');
  const rt = g.edges.find(x => x.from === 'rule:0' && x.kind === 'routes-to');
  assert.equal(rt.to, 'builtin:DIRECT');
  const rt2 = g.edges.find(x => x.from === 'rule:1' && x.kind === 'routes-to');
  assert.equal(rt2.to, 'builtin:GLOBAL');
  ok();
}

// --- graph: rule-provider → group → members (uses/routes-to) ---
{
  const d = docOf(
    ['RULE-SET,policy-ai,AI', 'MATCH,GLOBAL'],
    { 'policy-ai': { type: 'inline', behavior: 'domain', payload: ['openai.com'] } },
    { 'proxy-groups': [{ name: 'AI', type: 'select', proxies: ['GLOBAL', 'DIRECT'] }] }
  );
  const g = api.cdgBuildGraph(d);
  const kinds = Object.fromEntries(g.nodes.map(n => [n.id, n.kind]));
  assert.equal(kinds['rule-provider:policy-ai'], 'rule-provider');
  assert.equal(kinds['group:AI'], 'proxy-group');
  assert.ok(g.edges.some(x => x.from === 'rule:0' && x.to === 'rule-provider:policy-ai' && x.kind === 'uses'));
  assert.ok(g.edges.some(x => x.from === 'rule-provider:policy-ai' && x.to === 'group:AI' && x.kind === 'routes-to'));
  assert.ok(g.edges.some(x => x.from === 'group:AI' && x.to === 'builtin:GLOBAL' && x.kind === 'uses'));
  assert.ok(g.edges.some(x => x.from === 'group:AI' && x.to === 'builtin:DIRECT' && x.kind === 'uses'));
  ok();
}

// --- graph: WG dialer (dialed-through) ---
{
  const d = docOf(['MATCH,GLOBAL'], {}, {
    proxies: [
      { name: 'VPS-SE', type: 'vless' },
      { name: 'WARP', type: 'wireguard', 'dialer-proxy': 'VPS-SE' }
    ]
  });
  const g = api.cdgBuildGraph(d);
  const edge = g.edges.find(x => x.kind === 'dialed-through');
  assert.ok(edge, 'dialed-through ребро есть');
  assert.equal(edge.from, 'proxy:WARP');
  assert.equal(edge.to, 'proxy:VPS-SE');
  const warp = g.nodes.find(n => n.id === 'proxy:WARP');
  assert.equal(warp.isWireguard, true);
  ok();
}

// --- graph: DNS только доказуемое (nameserver-policy), без спекуляций ---
{
  const g1 = api.cdgBuildGraph(docOf(['MATCH,GLOBAL']));
  assert.ok(!g1.nodes.some(n => n.kind === 'dns-policy'), 'без dns-секции dns-узлов нет');
  const d2 = docOf(['MATCH,GLOBAL'], {}, { dns: { 'enhanced-mode': 'fake-ip', nameservers: ['1.1.1.1'], 'nameserver-policy': { '+.example.cn': '223.5.5.5' } } });
  const g2 = api.cdgBuildGraph(d2);
  assert.ok(g2.nodes.some(n => n.id === 'dns:config' && n.kind === 'dns-policy'));
  const entry = g2.nodes.find(n => n.id === 'dns-policy:+.example.cn');
  assert.ok(entry && entry.kind === 'dns-entry');
  assert.ok(g2.edges.some(x => x.from === 'dns-policy:+.example.cn' && x.to === 'dns:config' && x.kind === 'resolves-via'));
  ok();
}

// --- coverage: direct / reject / GLOBAL ---
{
  const d = docOf(['DOMAIN,example.com,DIRECT', 'DOMAIN-SUFFIX,bad.example,REJECT', 'MATCH,GLOBAL']);
  const r = api.cdgDomainCoverage(d, 'example.com\na.bad.example\nother.test');
  assert.equal(r.results.length, 3);
  assert.equal(r.results[0].verdict, 'MATCHED');
  assert.equal(r.results[0].target, 'DIRECT');
  assert.equal(r.results[0].chainText, 'DIRECT');
  assert.equal(r.results[1].verdict, 'MATCHED');
  assert.equal(r.results[1].target, 'REJECT');
  assert.equal(r.results[2].verdict, 'FALLBACK', 'other.test только под MATCH');
  assert.match(r.results[2].ruleRaw, /^MATCH,GLOBAL$/);
  assert.ok(r.results.every(x => x.runtimeSelected === false));
  ok();
}

// --- coverage: SELECT-group + runtime-selected честность ---
{
  const d = docOf(['DOMAIN-SUFFIX,openai.com,AI', 'MATCH,GLOBAL'], {}, {
    'proxy-groups': [{ name: 'AI', type: 'select', proxies: ['AI-AUTO', '⚡ Fastest', 'GLOBAL', 'DIRECT'] }]
  });
  const r = api.cdgDomainCoverage(d, 'chat.openai.com');
  assert.equal(r.results[0].verdict, 'MATCHED');
  assert.equal(r.results[0].runtimeSelected, true, 'select-группа → runtime-selected');
  assert.match(r.results[0].chainText, /SELECT-группа «AI» → \[AI-AUTO \/ ⚡ Fastest \/ GLOBAL \/ DIRECT\]/);
  ok();
}

// --- coverage: inline rule-provider ---
{
  const d = docOf(
    ['RULE-SET,policy-ai,AI', 'MATCH,GLOBAL'],
    { 'policy-ai': { type: 'inline', behavior: 'domain', payload: ['openai.com', '+.oaistatic.com'] } },
    { 'proxy-groups': [{ name: 'AI', type: 'select', proxies: ['GLOBAL'] }] }
  );
  const r = api.cdgDomainCoverage(d, 'openai.com\nfoo.oaistatic.com');
  assert.equal(r.results[0].viaProvider, 'policy-ai');
  assert.equal(r.results[1].viaProvider, 'policy-ai', '+. suffix в payload покрывает поддомен');
  assert.match(r.results[0].ruleRaw, /^RULE-SET,policy-ai,AI$/);
  ok();
}

// --- coverage: duplicate/shadow — первое правило выигрывает ---
{
  const d = docOf(['DOMAIN,example.com,DIRECT', 'DOMAIN-SUFFIX,example.com,REJECT', 'MATCH,GLOBAL']);
  const r = api.cdgDomainCoverage(d, 'example.com');
  assert.equal(r.results[0].ruleIndex, 0, 'точный DOMAIN выигрывает как первый (shadow диагностикой занят отдельный инструмент)');
  assert.equal(r.results[0].target, 'DIRECT');
  ok();
}

// --- coverage: dialer-chain в тексте пути ---
{
  const d = docOf(['MATCH,GLOBAL'], {}, {
    'proxy-groups': [{ name: 'GLOBAL', type: 'select', proxies: ['WARP', 'REJECT'] }],
    proxies: [
      { name: 'VPS-SE', type: 'vless' },
      { name: 'WARP', type: 'wireguard', 'dialer-proxy': 'VPS-SE' }
    ]
  });
  const r = api.cdgDomainCoverage(d, 'anything.test');
  assert.match(r.results[0].chainText, /WARP \(через VPS-SE\)/, 'dialer-proxy помечен в составе группы');
  ok();
}

// --- coverage: GEOSITE unknown / uncovered / malformed / stale / multiple ---
{
  const d = docOf(['GEOSITE,cn,REJECT']);
  const r = api.cdgDomainCoverage(d, 'baidu.cn\nnot a domain!!', { stale: true });
  assert.equal(r.results[0].verdict, 'UNKNOWN', 'GEOSITE честно UNKNOWN');
  assert.equal(r.results[1].verdict, 'INVALID');
  assert.equal(r.stale, true);
  assert.ok(r.results.every(x => x.stale === true), 'stale помечает каждую строку');
  const d2 = docOf(['DOMAIN,other.com,DIRECT']);
  const r2 = api.cdgDomainCoverage(d2, 'example.com');
  assert.equal(r2.results[0].verdict, 'UNCOVERED', 'нет совпадений и нет ни MATCH, ни потенциально покрывающих правил → uncovered');
  const r3 = api.cdgDomainCoverage(d2, 'a.test\nb.test\nc.test\nd.test');
  assert.equal(r3.results.length, 4, 'мультиввод');
  ok();
}

// --- graph: derived-from не создаётся спекулятивно ---
{
  const g = api.cdgBuildGraph(docOf(['MATCH,GLOBAL']));
  assert.ok(!g.edges.some(x => x.kind === 'derived-from'), 'doc-only снапшот не выдумывает provenance');
  ok();
}

// --- structural invariants (owner review #140) ---
{
  // 1) два RULE-SET rules на один provider → provider node ровно один
  const d = docOf(
    ['RULE-SET,policy-ai,AI', 'RULE-SET,policy-ai,OTHER', 'MATCH,GLOBAL'],
    { 'policy-ai': { type: 'inline', behavior: 'domain', payload: ['openai.com'] } },
    { 'proxy-groups': [{ name: 'AI', type: 'select', proxies: ['GLOBAL'] }, { name: 'OTHER', type: 'select', proxies: ['DIRECT'] }] }
  );
  const g = api.cdgBuildGraph(d);
  assert.equal(g.nodes.filter(n => n.id === 'rule-provider:policy-ai').length, 1, 'provider node единственный при повторном RULE-SET');
  assert.equal(g.nodes.filter(n => n.kind === 'rule').length, 3);
  // 5) все node IDs unique
  const ids = g.nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, 'node IDs unique');
  // 6) referential integrity: from/to существуют
  const idset = new Set(ids);
  for (const e of g.edges) {
    assert.ok(idset.has(e.from), 'edge.from существует: ' + e.from);
    assert.ok(idset.has(e.to), 'edge.to существует: ' + e.to);
  }
  ok();
}
{
  // 2) group.use → proxy-provider node существует (+ только доказуемая metadata)
  const d = docOf(['MATCH,GLOBAL'], {}, {
    'proxy-groups': [{ name: 'G', type: 'select', use: ['sub1'] }],
    'proxy-providers': { sub1: { type: 'http', url: 'https://example.com/sub' } }
  });
  const g = api.cdgBuildGraph(d);
  const pp = g.nodes.find(n => n.id === 'proxy-provider:sub1');
  assert.ok(pp, 'proxy-provider node создан');
  assert.equal(pp.kind, 'proxy-provider');
  assert.equal(pp.ptype, 'http');
  assert.equal(pp.url, 'https://example.com/sub');
  assert.ok(g.edges.some(x => x.from === 'group:G' && x.to === 'proxy-provider:sub1' && x.kind === 'uses'));
  assert.ok(!g.nodes.some(n => n.kind === 'proxy' && n.name && n.name.startsWith('sub1')), 'membership провайдера не выдумывается (runtime/external unknown)');
  // dangling use (нет в proxy-providers) — узел всё равно есть, metadata честно null
  const d2 = docOf(['MATCH,GLOBAL'], {}, { 'proxy-groups': [{ name: 'G2', type: 'select', use: ['ghost'] }] });
  const pp2 = api.cdgBuildGraph(d2).nodes.find(n => n.id === 'proxy-provider:ghost');
  assert.ok(pp2 && pp2.ptype === null && pp2.url === null, 'dangling provider: node есть, metadata честно пустая');
  ok();
}
{
  // 3) builtin DIRECT/GLOBAL/REJECT references → builtin nodes существуют
  const d = docOf(['DOMAIN,a.test,DIRECT', 'DOMAIN,b.test,REJECT', 'MATCH,GLOBAL']);
  const g = api.cdgBuildGraph(d);
  for (const t of ['DIRECT', 'REJECT', 'GLOBAL']) {
    const n = g.nodes.find(x => x.id === 'builtin:' + t);
    assert.ok(n && n.kind === 'builtin', 'builtin node ' + t);
  }
  ok();
}
{
  // 4) unknown target → explicit unresolved node
  const d = docOf(['MATCH,MYSTERY-TARGET']);
  const g = api.cdgBuildGraph(d);
  const n = g.nodes.find(x => x.id === 'unresolved:MYSTERY-TARGET');
  assert.ok(n && n.kind === 'unresolved', 'unresolved node для неизвестного таргета');
  const idset = new Set(g.nodes.map(x => x.id));
  assert.ok(g.edges.every(e => idset.has(e.from) && idset.has(e.to)), 'инвариант целостности держится и здесь');
  ok();
}
// realistic mixed config: дубликаты провайдеров + use + builtin + dialer —
// полный инвариант на одном графе
{
  const d = docOf(
    ['RULE-SET,policy-ai,AI', 'RULE-SET,policy-ai,AI', 'DOMAIN,x.test,DIRECT', 'MATCH,GLOBAL'],
    { 'policy-ai': { type: 'inline', behavior: 'domain', payload: ['openai.com'] } },
    {
      'proxy-groups': [{ name: 'AI', type: 'select', proxies: ['GLOBAL', 'WARP'], use: ['sub1'] }],
      'proxy-providers': { sub1: { type: 'http', url: 'https://example.com/sub' } },
      proxies: [{ name: 'WARP', type: 'wireguard', 'dialer-proxy': 'VPS' }, { name: 'VPS', type: 'vless' }]
    }
  );
  const g = api.cdgBuildGraph(d);
  const ids = g.nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length);
  const idset = new Set(ids);
  assert.ok(g.edges.every(e => idset.has(e.from) && idset.has(e.to)));
  assert.equal(g.nodes.filter(n => n.id === 'rule-provider:policy-ai').length, 1);
  assert.ok(g.nodes.some(n => n.id === 'proxy:WARP' && n.isWireguard === true));
  assert.ok(g.edges.some(x => x.from === 'proxy:WARP' && x.to === 'proxy:VPS' && x.kind === 'dialed-through'));
  ok();
}

console.log('Dependency-graph core: ' + cases + ' cases passed');

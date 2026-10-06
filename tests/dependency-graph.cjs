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
  assert.equal(kinds['builtin:DIRECT'], undefined, 'builtin-таргеты — только в рёбрах, узлы не дублируются');
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

console.log('Dependency-graph core: ' + cases + ' cases passed');

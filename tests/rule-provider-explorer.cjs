// Rule Provider Explorer — deterministic unit suite (pure model, без DOM/сети).
// Ядро извлекается из index.html по маркерам RD-CORE-START/END и исполняется
// через new Function — тот же код, что и в браузере (см. tests/routing-inspector.cjs).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const startMarker = '=== ROUTING DIAGNOSTICS CORE';
const endMarker = 'RD-CORE-END ===';
const s = html.indexOf(startMarker);
const e = html.indexOf(endMarker);
assert.ok(s !== -1 && e !== -1, 'RD core markers not found in index.html');
const coreStart = html.lastIndexOf('\n', s) + 1;
const coreEnd = html.indexOf('*/', e) + 2;
const core = html.slice(coreStart, coreEnd);
const api = new Function(core + '\nreturn { rdParseRule, routingProviderReferences, routingProviderPayloadStats, routingProviderSearch, routingProviderInventory };')();

let cases = 0;
const ok = () => cases++;

// 1. inline domain provider
{
  const d = { rules: ['RULE-SET,ai,AI', 'MATCH,GLOBAL'], 'rule-providers': { ai: { type: 'inline', behavior: 'domain', format: 'yaml', payload: ['openai.com', '+.google.com'] } } };
  const inv = api.routingProviderInventory(d);
  assert.equal(inv.items.length, 1);
  const it = inv.items[0];
  assert.equal(it.name, 'ai');
  assert.equal(it.type, 'inline');
  assert.equal(it.behavior, 'domain');
  assert.equal(it.format, 'yaml');
  assert.equal(it.source, 'inline');
  ok();
}
// 2. inline classical provider
{
  const d = { rules: ['RULE-SET,cls,PROXY'], 'rule-providers': { cls: { type: 'inline', behavior: 'classical', payload: ['DOMAIN-SUFFIX,example.com', 'IP-CIDR,192.0.2.0/24'] } } };
  const it = api.routingProviderInventory(d).items[0];
  assert.equal(it.behavior, 'classical');
  assert.equal(it.format, 'default'); // format опущен → default/omitted
  ok();
}
// 3. inline ipcidr provider
{
  const d = { rules: ['RULE-SET,ips,DIRECT'], 'rule-providers': { ips: { type: 'inline', behavior: 'ipcidr', payload: ['192.0.2.0/24', '2001:db8::/32'] } } };
  const it = api.routingProviderInventory(d).items[0];
  assert.equal(it.behavior, 'ipcidr');
  const st = api.routingProviderPayloadStats(d['rule-providers'].ips);
  assert.equal(st.entries, 2);
  ok();
}
// 4. provider used once → one reference with target
{
  const d = { rules: ['RULE-SET,ai,AI', 'MATCH,GLOBAL'], 'rule-providers': { ai: { type: 'inline', behavior: 'domain', payload: ['openai.com'] } } };
  const { refs } = api.routingProviderReferences(d);
  assert.deepEqual(refs.ai, [{ index: 0, target: 'AI' }]);
  ok();
}
// 5. provider used multiple times with different targets → all refs in rule order
{
  const d = { rules: ['RULE-SET,ai,DIRECT', 'DOMAIN,x.com,DIRECT', 'RULE-SET,ai,PROXY', 'RULE-SET,ai,FRA'], 'rule-providers': { ai: { type: 'inline', behavior: 'domain', payload: ['a.com'] } } };
  const { refs } = api.routingProviderReferences(d);
  assert.deepEqual(refs.ai.map(r => [r.index, r.target]), [[0, 'DIRECT'], [2, 'PROXY'], [3, 'FRA']]);
  ok();
}
// 6. unused provider → no refs, detected as unused in both model views
{
  const d = { rules: ['MATCH,GLOBAL'], 'rule-providers': { ghost: { type: 'inline', behavior: 'domain', payload: ['a.com'] } } };
  const inv = api.routingProviderInventory(d);
  assert.equal(inv.items[0].used.length, 0);
  assert.equal(inv.summary.unused, 1);
  assert.equal(inv.summary.used, 0);
  ok();
}
// 7. external http provider → metadata only, source=url
{
  const d = { rules: ['RULE-SET,ext,PROXY'], 'rule-providers': { ext: { type: 'http', behavior: 'domain', format: 'yaml', url: 'https://example.net/rules.yaml', interval: 43200 } } };
  const it = api.routingProviderInventory(d).items[0];
  assert.equal(it.type, 'http');
  assert.equal(it.source, 'https://example.net/rules.yaml');
  assert.ok(it.metadata.some(([k, v]) => k === 'url' && v === 'https://example.net/rules.yaml'));
  assert.ok(it.metadata.some(([k, v]) => k === 'interval' && v === '43200'));
  const st = api.routingProviderPayloadStats(d['rule-providers'].ext);
  assert.equal(st.kind, 'external');
  ok();
}
// 8. file provider → type file, source=path
{
  const d = { rules: ['RULE-SET,local,DIRECT'], 'rule-providers': { local: { type: 'file', behavior: 'ipcidr', path: './rules/lan.txt' } } };
  const it = api.routingProviderInventory(d).items[0];
  assert.equal(it.type, 'file');
  assert.equal(it.source, './rules/lan.txt');
  assert.ok(it.metadata.some(([k, v]) => k === 'path' && v === './rules/lan.txt'));
  ok();
}
// 9. MRS → metadata-only; contents unknown
{
  const d = { rules: ['RULE-SET,geo,PROXY'], 'rule-providers': { geo: { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://example.net/geo.mrs' } } };
  const it = api.routingProviderInventory(d).items[0];
  assert.equal(it.format, 'mrs');
  const st = api.routingProviderPayloadStats(d['rule-providers'].geo);
  assert.equal(st.kind, 'external');
  assert.equal(st.entries, null, 'MRS contents must not be claimed as known');
  assert.equal(st.bytes, null);
  ok();
}
// 10. missing provider reference → reported, no invented provider
{
  const d = { rules: ['RULE-SET,ghost-provider,PROXY', 'MATCH,GLOBAL'], 'rule-providers': {} };
  const inv = api.routingProviderInventory(d);
  assert.deepEqual(inv.missing, [{ index: 0, name: 'ghost-provider', target: 'PROXY' }]);
  assert.equal(inv.summary.missingReferences, 1);
  assert.equal(inv.summary.providers, 0);
  ok();
}
// 11. payload entries count (non-empty trimmed lines; duplicates counted separately)
{
  const p = { type: 'inline', behavior: 'domain', payload: ['a.com', 'b.com', 'a.com', '   ', ''] };
  assert.equal(api.routingProviderPayloadStats(p).entries, 3);
  ok();
}
// 12. payload text-size calculation — UTF-8 bytes of payload lines
{
  const p = { type: 'inline', behavior: 'domain', payload: ['abc', 'ё'] }; // 3 + 2 = 5 байт UTF-8
  const st = api.routingProviderPayloadStats(p);
  assert.equal(st.bytes, 5);
  ok();
}
// 13. case-insensitive substring search
{
  const p = { type: 'inline', behavior: 'domain', payload: ['openai.com', 'OPENAI.ORG', 'anthropic.com', '+.openai-cdn.net'] };
  const res = api.routingProviderSearch(p, 'openai');
  assert.equal(res.total, 3);
  assert.deepEqual(res.matches, ['openai.com', 'OPENAI.ORG', '+.openai-cdn.net']);
  ok();
}
// 14. empty search → full payload view
{
  const p = { type: 'inline', behavior: 'domain', payload: ['a.com', 'b.com'] };
  const res = api.routingProviderSearch(p, '');
  assert.equal(res.total, 2);
  assert.deepEqual(res.matches, ['a.com', 'b.com']);
  ok();
}
// 15. no-match search → zero
{
  const p = { type: 'inline', behavior: 'domain', payload: ['a.com'] };
  assert.equal(api.routingProviderSearch(p, 'zzz').total, 0);
  ok();
}
// 16. duplicate payload entries remain separate lines in search results
{
  const p = { type: 'inline', behavior: 'domain', payload: ['dup.com', 'dup.com', 'other.com'] };
  const res = api.routingProviderSearch(p, 'dup.com');
  assert.equal(res.total, 2);
  assert.deepEqual(res.matches, ['dup.com', 'dup.com']);
  ok();
}
// 17. provider order preserved (YAML/insertion order, no sorting)
{
  const d = { rules: ['MATCH,GLOBAL'], 'rule-providers': { zeta: { type: 'inline', behavior: 'domain', payload: [] }, alpha: { type: 'inline', behavior: 'domain', payload: [] }, mid: { type: 'inline', behavior: 'domain', payload: [] } } };
  assert.deepEqual(api.routingProviderInventory(d).items.map(i => i.name), ['zeta', 'alpha', 'mid']);
  ok();
}
// 18. malformed/non-array payload does not crash Explorer
{
  const d = { rules: ['MATCH,GLOBAL'], 'rule-providers': { bad: { type: 'inline', behavior: 'domain', payload: 'not-an-array' } } };
  const inv = api.routingProviderInventory(d);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0].stats.entries, 0);
  assert.equal(inv.items[0].stats.payloadMalformed, true);
  assert.equal(inv.items[0].payload, null);
  assert.equal(api.routingProviderSearch(d['rule-providers'].bad, 'x').total, 0);
  ok();
}
// 19. unknown type/behavior/format displayed honestly (absent → unknown; values not invented)
{
  const d = { rules: ['RULE-SET,weird,PROXY'], 'rule-providers': { weird: { url: 'https://example.net/x' } } };
  const it = api.routingProviderInventory(d).items[0];
  assert.equal(it.type, 'unknown');
  assert.equal(it.behavior, 'unknown');
  assert.equal(it.format, 'default');
  assert.equal(it.source, 'https://example.net/x');
  // нестандартное значение type не подменяется «ближайшим известным»
  const d2 = { rules: ['MATCH,GLOBAL'], 'rule-providers': { s: { type: 'SmbShare', behavior: 'domain', payload: [] } } };
  assert.equal(api.routingProviderInventory(d2).items[0].type, 'smbshare');
  ok();
}
// 20. external contents are never claimed as known
{
  const d = { rules: ['RULE-SET,ext,PROXY'], 'rule-providers': { ext: { type: 'http', behavior: 'domain', format: 'yaml', url: 'https://example.net/rules.yaml', payload: 'should-not-be-read' } } };
  const inv = api.routingProviderInventory(d);
  assert.equal(inv.items[0].payload, null, 'external payload must not surface even if present');
  assert.equal(inv.items[0].stats.kind, 'external');
  assert.equal(inv.items[0].stats.entries, null);
  ok();
}
// 21. summary counters over a real mixed config
{
  const d = {
    rules: ['RULE-SET,ai,AI', 'RULE-SET,geo,PROXY', 'RULE-SET,lan,DIRECT', 'RULE-SET,ghost,PROXY', 'MATCH,GLOBAL'],
    'rule-providers': {
      ai: { type: 'inline', behavior: 'domain', format: 'yaml', payload: ['openai.com'] },
      geo: { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://example.net/g.mrs' },
      lan: { type: 'file', behavior: 'ipcidr', path: './lan.txt' },
      unused: { type: 'inline', behavior: 'domain', payload: ['nobody-uses.example'] }
    }
  };
  const inv = api.routingProviderInventory(d);
  assert.deepEqual(inv.summary, { providers: 4, used: 3, unused: 1, inline: 2, external: 2, missingReferences: 1 });
  ok();
}
// 22. RULE-SET без имени и no-resolve-флаг не ломают references
{
  const d = { rules: ['RULE-SET,,PROXY', 'RULE-SET,ai,PROXY,no-resolve', 'MATCH,GLOBAL'], 'rule-providers': { ai: { type: 'inline', behavior: 'ipcidr', payload: ['10.0.0.0/8'] } } };
  const { refs, missing } = api.routingProviderReferences(d);
  assert.deepEqual(refs.ai, [{ index: 1, target: 'PROXY' }]);
  assert.equal(missing.length, 0, 'RULE-SET без имени игнорируется, не считается missing');
  ok();
}
// 23. non-object provider entries и нестроковые rules не роняют модель
{
  const d = { rules: [null, 42, 'RULE-SET,ai,PROXY'], 'rule-providers': { ai: 'corrupted', other: { type: 'inline', behavior: 'domain', payload: ['a.com'] } } };
  const inv = api.routingProviderInventory(d);
  assert.equal(inv.items.length, 2, 'corrupted provider остаётся в инвентаре');
  assert.equal(inv.items[0].type, 'unknown', 'corrupted provider показан честно как unknown');
  assert.deepEqual(inv.missing, [{ index: 2, name: 'ai', target: 'PROXY' }], 'corrupted provider не считается пригодным для ссылки');
  ok();
}

console.log('Rule-provider-explorer model: ' + cases + ' cases passed');

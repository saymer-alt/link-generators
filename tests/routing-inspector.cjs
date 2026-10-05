// Routing Diagnostics Core — deterministic unit suite.
// Ядро извлекается из index.html по маркерам RD-CORE-START/END (pure functions,
// без DOM/сети) и исполняется через new Function — тот же код, что и в браузере.
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
const api = new Function(core + '\nreturn { rdIsIPv4, rdIsIPv6, rdIpInCidr, rdClassifyInput, rdDomainMatch, rdParseRule, rdInlinePayloadEntries, rdRuleVerdict, routingInspect, routingFindDuplicates, routingFindShadowed, routingPreview, routingDprHumanNames };')();

let cases = 0;
const ok = () => cases++;
const doc = (rules, providers) => ({ rules, 'rule-providers': providers || {} });

// --- DOMAIN ---
{
  const d = doc(['DOMAIN,example.com,DIRECT', 'MATCH,GLOBAL']);
  const r = api.routingInspect(d, 'example.com');
  assert.equal(r.verdict, 'MATCHED'); assert.equal(r.winner, 0); ok();
  const r2 = api.routingInspect(d, 'other.com');
  assert.equal(r2.verdict, 'FALLBACK'); assert.equal(r2.winner, 1); ok();
  assert.equal(r2.matched.filter(m => m.rule.type !== 'MATCH').length, 0, 'no non-MATCH matches'); ok();
}
// --- DOMAIN-SUFFIX ---
{
  const d = doc(['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,GLOBAL']);
  assert.equal(api.routingInspect(d, 'example.com').verdict, 'MATCHED', 'suffix exact root'); ok();
  assert.equal(api.routingInspect(d, 'a.example.com').winner, 0, 'suffix subdomain'); ok();
  assert.equal(api.routingInspect(d, 'notexample.com').verdict, 'FALLBACK', 'suffix must not match glued domain'); ok();
}
// --- DOMAIN-KEYWORD ---
{
  const d = doc(['DOMAIN-KEYWORD,video,PROXY', 'MATCH,GLOBAL']);
  assert.equal(api.routingInspect(d, 'video.example.com').winner, 0); ok();
  assert.equal(api.routingInspect(d, 'example.org').verdict, 'FALLBACK'); ok();
}
// --- first-match wins + alternatives ---
{
  const d = doc([
    'DOMAIN-SUFFIX,gemini.google.com,FRA',
    'DOMAIN-SUFFIX,google.com,DIRECT',
    'MATCH,GLOBAL',
  ]);
  const r = api.routingInspect(d, 'gemini.google.com');
  assert.equal(r.verdict, 'MATCHED'); assert.equal(r.winner, 0);
  assert.equal(r.matched.length, 2, 'alternative also reported'); ok();
  assert.equal(r.matched[1].rule.target, 'DIRECT'); ok();
  const r2 = api.routingInspect(d, 'mail.google.com');
  assert.equal(r2.winner, 1, 'broader suffix wins when specific is below'); ok();
}
// --- exact before suffix remains reachable ---
{
  const d = doc(['DOMAIN,gemini.google.com,FRA', 'DOMAIN-SUFFIX,google.com,DIRECT', 'MATCH,GLOBAL']);
  const r = api.routingInspect(d, 'gemini.google.com');
  assert.equal(r.winner, 0, 'exact first stays reachable'); ok();
}
// --- MATCH fallback / unknown-less no match ---
{
  const d = doc(['MATCH,GLOBAL']);
  assert.equal(api.routingInspect(d, 'anything.net').verdict, 'FALLBACK'); ok();
}
// --- GEOSITE / GEOIP → UNKNOWN ---
{
  const d = doc(['GEOSITE,youtube,PROXY', 'MATCH,GLOBAL']);
  const r = api.routingInspect(d, 'youtube.com');
  assert.equal(r.verdict, 'UNKNOWN'); assert.match(r.firstUnknown.reason, /GEOSITE/); ok();
  const d2 = doc(['GEOIP,US,PROXY', 'MATCH,GLOBAL']);
  assert.equal(api.routingInspect(d2, '8.8.8.8').verdict, 'UNKNOWN'); ok();
}
// --- external RULE-SET → UNKNOWN ---
{
  const d = doc(['RULE-SET,ext,PROXY', 'MATCH,GLOBAL'], { ext: { type: 'http', behavior: 'domain', url: 'https://example.com/rules.yaml' } });
  const r = api.routingInspect(d, 'anything.com');
  assert.equal(r.verdict, 'UNKNOWN'); assert.match(r.firstUnknown.reason, /external provider/); ok();
  // MRS format → честный UNKNOWN даже если provider inline-недоступен
  const d2 = doc(['RULE-SET,mrs1,PROXY', 'MATCH,GLOBAL'], { mrs1: { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://example.com/rules.mrs' } });
  assert.equal(api.routingInspect(d2, 'anything.com').verdict, 'UNKNOWN'); ok();
}
// --- missing provider → UNKNOWN ---
{
  const d = doc(['RULE-SET,ghost,PROXY', 'MATCH,GLOBAL']);
  const r = api.routingInspect(d, 'x.com');
  assert.equal(r.verdict, 'UNKNOWN'); assert.match(r.firstUnknown.reason, /not found/); ok();
}
// --- DNS-dependent IP rules + no-resolve ---
{
  const d = doc(['IP-CIDR,192.0.2.0/24,PROXY', 'MATCH,GLOBAL']);
  const rDomain = api.routingInspect(d, 'sub.example.com');
  assert.equal(rDomain.verdict, 'UNKNOWN'); assert.match(rDomain.firstUnknown.reason, /DNS/); ok();
  const d2 = doc(['IP-CIDR,192.0.2.0/24,PROXY,no-resolve', 'MATCH,GLOBAL']);
  assert.equal(api.routingInspect(d2, 'sub.example.com').verdict, 'FALLBACK', 'no-resolve: domain cannot match'); ok();
}
// --- IP-CIDR literal input (IPv4 inside/outside, IPv6) ---
{
  const d = doc(['IP-CIDR,192.0.2.0/24,PROXY', 'MATCH,GLOBAL']);
  assert.equal(api.routingInspect(d, '192.0.2.55').winner, 0, 'IPv4 inside CIDR'); ok();
  assert.equal(api.routingInspect(d, '192.0.3.55').verdict, 'FALLBACK', 'IPv4 outside CIDR'); ok();
  const d6 = doc(['IP-CIDR6,2001:db8::/32,PROXY', 'MATCH,GLOBAL']);
  assert.equal(api.routingInspect(d6, '2001:db8::1').winner, 0, 'IPv6 inside'); ok();
  assert.equal(api.routingInspect(d6, '2001:db9::1').verdict, 'FALLBACK', 'IPv6 outside'); ok();
}
// --- inline provider matching + provenance ---
{
  const d = doc(['RULE-SET,policy-ai,FRA', 'MATCH,GLOBAL'], {
    'policy-ai': { type: 'inline', behavior: 'classical', format: 'yaml', payload: ['DOMAIN-SUFFIX,openai.com', 'DOMAIN,gemini.google.com'] },
  });
  const r = api.routingInspect(d, 'openai.com');
  assert.equal(r.verdict, 'MATCHED'); assert.equal(r.matched[0].rule.provider, 'policy-ai'); ok();
  assert.equal(api.routingInspect(d, 'gemini.google.com').winner, 0, 'inline DOMAIN exact'); ok();
  const names = api.routingDprHumanNames([{ name: 'AI' }, { name: 'Google Services' }]);
  assert.equal(names['policy-ai'], 'AI'); ok();
}
// --- inline payload unsupported types → UNKNOWN ---
{
  const d = doc(['RULE-SET,p-regex,PROXY', 'MATCH,GLOBAL'], {
    'p-regex': { type: 'inline', behavior: 'classical', format: 'yaml', payload: ['DOMAIN-REGEX,^a\\.example$'] },
  });
  const r = api.routingInspect(d, 'a.example');
  assert.equal(r.verdict, 'UNKNOWN'); assert.match(r.firstUnknown.reason, /REGEX/); ok();
}
// --- duplicates ---
{
  const d = doc(['DOMAIN-SUFFIX,youtube.com,DIRECT', 'DOMAIN-SUFFIX,youtube.com,DIRECT', 'MATCH,GLOBAL']);
  const dup = api.routingFindDuplicates(d);
  assert.equal(dup.ruleDups.length, 1); assert.equal(dup.ruleDups[0].index, 1); assert.equal(dup.ruleDups[0].firstIndex, 0); ok();
  const d2 = doc(['RULE-SET,policy-ai,FRA', 'MATCH,GLOBAL'], {
    'policy-ai': { type: 'inline', behavior: 'classical', format: 'yaml', payload: ['DOMAIN-SUFFIX,openai.com', 'DOMAIN-SUFFIX,openai.com'] },
  });
  const dup2 = api.routingFindDuplicates(d2);
  assert.equal(dup2.payloadDups.length, 1); assert.match(dup2.payloadDups[0].entry, /openai\.com/); ok();
  const d3 = doc(['RULE-SET,policy-ai,FRA', 'RULE-SET,policy-custom,DIRECT', 'MATCH,GLOBAL'], {
    'policy-ai': { type: 'inline', behavior: 'classical', format: 'yaml', payload: ['DOMAIN-SUFFIX,openai.com'] },
    'policy-custom': { type: 'inline', behavior: 'classical', format: 'yaml', payload: ['DOMAIN,openai.com'] },
  });
  const cross = api.routingFindDuplicates(d3);
  assert.equal(cross.crossPolicy.length, 1, 'same domain in two policies reported as INFO-class'); ok();
}
// --- shadows ---
{
  // suffix shadows exact
  const d = doc(['DOMAIN-SUFFIX,google.com,DIRECT', 'DOMAIN,gemini.google.com,FRA', 'MATCH,GLOBAL']);
  const sh = api.routingFindShadowed(d);
  assert.ok(sh.some(s => s.index === 1 && s.shadowedBy === 0), 'exact shadowed by suffix'); ok();
  // suffix shadows narrower suffix
  const d2 = doc(['DOMAIN-SUFFIX,google.com,DIRECT', 'DOMAIN-SUFFIX,gemini.google.com,FRA', 'MATCH,GLOBAL']);
  assert.ok(api.routingFindShadowed(d2).some(s => s.index === 1), 'narrower suffix shadowed'); ok();
  // exact BEFORE suffix remains reachable (no false positive)
  const d3 = doc(['DOMAIN,gemini.google.com,FRA', 'DOMAIN-SUFFIX,google.com,DIRECT', 'MATCH,GLOBAL']);
  assert.equal(api.routingFindShadowed(d3).filter(s => s.index === 0).length, 0); ok();
  // MATCH shadows everything below
  const d4 = doc(['MATCH,GLOBAL', 'DOMAIN,example.com,DIRECT']);
  const sh4 = api.routingFindShadowed(d4);
  assert.ok(sh4.some(s => s.kind === 'unreachable-after-match' && s.index === 1 && s.until === 1)); ok();
  // keyword/regex не заявляются shadowed
  const d5 = doc(['DOMAIN-KEYWORD,google,DIRECT', 'DOMAIN,gemini.google.com,FRA', 'MATCH,GLOBAL']);
  assert.equal(api.routingFindShadowed(d5).length, 0, 'keyword overlap not analyzed (no false positive)'); ok();
}
// --- preview ---
{
  const d = doc(['RULE-SET,policy-ai,FRA', 'RULE-SET,policy-google-services,DIRECT', 'MATCH,GLOBAL']);
  const names = api.routingDprHumanNames([{ name: 'AI' }, { name: 'Google Services' }]);
  assert.equal(names['policy-google-services'], 'Google Services', 'slug-алгоритм совпадает с движком'); ok();
  const preview = api.routingPreview(d, names);
  assert.equal(preview.length, 3);
  assert.equal(preview[0].label, 'AI'); assert.equal(preview[0].target, 'FRA'); ok();
  assert.equal(preview[1].label, 'Google Services'); ok();
  assert.equal(preview[2].label, 'Всё остальное'); assert.equal(preview[2].isMatch, true); ok();
  const raw = api.routingPreview(d, null);
  assert.equal(raw[0].label, 'policy-ai', 'без humanNames показывается техническое имя'); ok();
}
// --- IPv6 classifier edge cases ---
{
  assert.equal(api.routingInspect(doc(['MATCH,GLOBAL']), '2001:db8::1').verdict, 'FALLBACK', 'IPv6 input classified'); ok();
  assert.notEqual(api.rdIsIPv6('2001:db8::1'), null); ok();
  assert.equal(api.rdIsIPv6('2001:db8:::1'), null); ok();
}

console.log('Routing-inspector: ' + cases + ' cases passed');

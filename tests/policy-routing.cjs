// Domain Policy Routing (Variant B) — node-only regression over the vendored
// runtime. Runs the same contract suite as tests/runtime.cjs style: vm-loaded
// runtime, deterministic RNG, regex/structural asserts on generated YAML.
// Covers: DPR-off parity, basic generation, shared provider (several AUTO
// groups, one provider), provider proxy: DIRECT contract, AUTO-WHITELIST
// compatibility, static mode, warnings, structural errors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const yaml = require(process.env.JS_YAML_PATH); // см. docs/TESTING.md

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'web4core.runtime.js'), 'utf8');

function api() {
  const ctx = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } });
  vm.runInContext('Math.random = () => 0.5', ctx); // стабильный x-hwid только в тесте
  vm.runInContext(runtime, ctx);
  return ctx.web4core;
}

const engine = api();
const SUB = 'https://subs.example.invalid/token';
const POLICIES = [
  { name: 'AI', domains: 'openai.com\nchatgpt.com\noaistatic.com' },
  { name: 'MEDIA', domains: 'youtube.com\ngooglevideo.com\nytimg.com' },
];
const build = (input, options, extra) => engine.buildFromRequest({
  core: 'mihomo', input, wgBeans: [], ...(extra || {}), options,
});
const scrubHwid = (s) => s.replace(/^\s+- "?[0-9a-f]{32}"?\s*$/gm, 'HWID');

let cases = 0;

// 1. DPR off — byte parity with and without the (empty) option
{
  const base = build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false });
  const withEmpty = build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false, mihomoDomainPolicy: [] });
  assert.equal(scrubHwid(base.data), scrubHwid(withEmpty.data));
  assert.ok(!base.data.includes('rule-providers:'));
  assert.ok(!base.data.includes('RULE-SET'));
  assert.ok(base.data.includes('- "MATCH,GLOBAL"'));
  cases += 3;
}

// 2. DPR basic — rule-providers, groups, rules order, MATCH last
{
  const r = build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false, mihomoDomainPolicy: POLICIES });
  const yaml = r.data;
  assert.equal(r.kind, 'yaml');
  assert.ok(yaml.includes('rule-providers:'), 'rule-providers section present');
  assert.ok(yaml.includes('  policy-ai:'), 'policy-ai provider present');
  assert.ok(yaml.includes('  policy-media:'), 'policy-media provider present');
  assert.ok(yaml.includes('type: inline'), 'inline provider type');
  assert.ok(yaml.includes('behavior: classical'), 'classical behavior');
  assert.ok(yaml.includes('    - "DOMAIN-SUFFIX,openai.com"'));
  assert.ok(yaml.includes('  - "RULE-SET,policy-ai,AI"'));
  assert.ok(yaml.includes('  - "RULE-SET,policy-media,MEDIA"'));
  const rulesBlock = yaml.split(/^rules:\s*$/m)[1];
  // match only the 2-space-indent rule lines (later sections add deeper lists)
  const ruleLines = rulesBlock.split('\n').filter((l) => /^  - "/.test(l));
  assert.equal(ruleLines[ruleLines.length - 1].includes('MATCH,GLOBAL'), true, 'MATCH,GLOBAL is the last rule');
  assert.ok(yaml.includes('name: AI-AUTO') && yaml.includes('name: MEDIA-AUTO'), 'AUTO groups present');
  assert.ok(yaml.includes('empty-fallback: REJECT'), 'empty-fallback contract');
  cases += 10;
}

// 3. Shared provider — several AUTO groups use: the same single provider
{
  const r = build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false, mihomoDomainPolicy: POLICIES });
  const providerKey = Object.keys((yamlDoc(r.data) || {})['proxy-providers'] || {});
  const doc = yamlDoc(r.data);
  assert.equal(providerKey.length, 1, 'exactly one proxy-provider');
  const autos = doc['proxy-groups'].filter((g) => (g.name || '').endsWith('-AUTO'));
  assert.equal(autos.length, 2);
  for (const g of autos) assert.deepEqual(g.use, providerKey, 'AUTO group references the same provider');
  cases += 4;
}

// 4. Provider DIRECT contract — with and without DPR
{
  for (const policies of [undefined, POLICIES]) {
    const doc = yamlDoc(build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false,
      ...(policies ? { mihomoDomainPolicy: policies } : {}) }).data);
    for (const p of Object.values(doc['proxy-providers'])) assert.equal(p.proxy, 'DIRECT');
    cases++;
  }
}

// 5. AUTO-WHITELIST compatibility — flat fallback untouched, no AUTO groups
{
  const r = build('socks://user:pass@203.0.113.10:1080#P1',
    { mihomoSubscriptionMode: true, addTun: true, webUI: false, mihomoDomainPolicy: [{ name: 'AI', domains: 'openai.com' }] },
    { fallbackInput: SUB });
  assert.ok(r.data.includes('type: fallback'), 'AW flat fallback present');
  assert.ok(r.data.includes('  - "RULE-SET,policy-ai,AI"'));
  assert.ok(!r.data.includes('AI-AUTO'), 'no category AUTO groups in AW mode');
  const doc = yamlDoc(r.data);
  const fallback = doc['proxy-groups'].find((g) => g.type === 'fallback');
  assert.ok(!(fallback.proxies || []).includes('AI'), 'policy name not inside the fallback');
  const select = doc['proxy-groups'].find((g) => g.name === 'AI');
  assert.deepEqual(select.proxies, ['GLOBAL', 'DIRECT']);
  cases += 5;
}

// 6. Static mode — selects without AUTO groups
{
  const r = build('socks://user:pass@203.0.113.10:1080#S1\nvless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#S2',
    { addTun: true, webUI: false, mihomoDomainPolicy: POLICIES });
  const doc = yamlDoc(r.data);
  assert.ok(!doc['proxy-groups'].some((g) => (g.name || '').endsWith('-AUTO')));
  assert.ok(!doc['proxy-providers'], 'no providers in static mode');
  const ai = doc['proxy-groups'].find((g) => g.name === 'AI');
  assert.deepEqual(ai.proxies, ['⚡ Fastest', 'GLOBAL', 'DIRECT']);
  cases += 3;
}

// 7. Warnings — invalid lines surface as non-blocking warnings
{
  const r = build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false,
    mihomoDomainPolicy: [{ name: 'AI', domains: 'openai.com\nnot a domain!' }] });
  assert.ok(Array.isArray(r.warnings) && r.warnings.length === 1, 'one warning');
  assert.ok(r.warnings[0].includes('не распознана'));
  cases += 2;
}

// 8. Structural errors — duplicates, commas, per-proxy, reserved names
{
  assert.throws(() => build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false,
    mihomoDomainPolicy: [{ name: 'AI', domains: 'a.com' }, { name: 'AI', domains: 'b.com' }] }),
  /duplicate domain policy name/);
  assert.throws(() => build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false,
    mihomoDomainPolicy: [{ name: 'x,y', domains: 'a.com' }] }),
  /must not contain commas/);
  assert.throws(() => build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false, perProxyPort: true,
    mihomoDomainPolicy: POLICIES }),
  /per-proxy/);
  assert.throws(() => build(SUB, { mihomoSubscriptionMode: true, addTun: true, webUI: false,
    mihomoDomainPolicy: [{ name: 'GLOBAL', domains: 'a.com' }] }),
  /reserved/);
  cases += 4;
}

function yamlDoc(text) {
  return yaml.load(text);
}
console.log('Policy-routing: ' + cases + ' cases passed');

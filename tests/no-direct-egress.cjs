// No-DIRECT egress policy (issue #284, owner decision revised 2026-10-18) —
// machine-checkable registry at the CONSUMER level (the vendored runtime bundle
// web4core.runtime.js, i.e. the exact artifact the Builder ships).
//
// Contract (revised constitution, PR #285 behavioral policy):
//   User data plane — the generator must not create routes through which USER
//   traffic silently egresses the host/VPS public IP; DIRECT must not be a
//   user-facing egress option or default fallback. With no allowed egress
//   left: REJECT / dial failure (fail-closed), never a host-IP bypass.
//   Service/control/transport plane — judged by purpose, allowed:
//   subscription provider download bootstrap (`proxy: DIRECT`), dialer-proxy
//   connection establishment, PT exit artifacts, DNS/bootstrap.
//
// Checks here: semantic (parsed structures), NOT lexical token scanning.
//   - no DIRECT member in any generated proxy-group;
//   - no DIRECT target in generated rules (MATCH ends in GLOBAL);
//   - fail-closed backbone (GLOBAL terminates in REJECT / empty-fallback REJECT);
//   - an explicit DIRECT domain-policy target fails the build (both layers);
//   - positive regressions: Sub Mode ON providers, dialer DIRECT, all modes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

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
let cases = 0;
const ok = () => { cases++; };

function assertNoUserDirectEgress(config, label) {
  for (const g of config['proxy-groups'] || []) {
    assert.ok(!Array.isArray(g.proxies) || !g.proxies.includes('DIRECT'),
      label + ': group ' + g.name + ' has no DIRECT member (user data plane)');
  }
  for (const r of config.rules || []) {
    const target = String(r).split(',').pop().trim();
    assert.notEqual(target, 'DIRECT', label + ': rule ' + r + ' does not route user traffic to DIRECT');
  }
}

function assertFailClosed(groups, label) {
  const globalGroup = groups.find(g => g.name === 'GLOBAL');
  assert.ok(globalGroup, label + ': GLOBAL group exists');
  if (globalGroup.type === 'select' && Array.isArray(globalGroup.proxies)) {
    assert.equal(globalGroup.proxies[globalGroup.proxies.length - 1], 'REJECT',
      label + ': GLOBAL terminates in REJECT');
  }
  if (globalGroup.type === 'fallback') {
    assert.equal(globalGroup['empty-fallback'], 'REJECT', label + ': fallback empty-fallback = REJECT');
  }
}

const UUID = '00000000-0000-4000-8000-000000000001';
const TWO_LINKS = [
  'vless://' + UUID + '@192.0.2.1:443#A',
  'vless://' + UUID + '@192.0.2.2:443#B',
].join('\n');
const SUB = 'https://subs.example.invalid/token';
const build = (input, options, extra) => engine.buildFromRequest({
  core: 'mihomo', input, wgBeans: [], ...(extra || {}), options,
});

// 1. Static builds (1/2 proxies), router и VPS-профили, per-proxy —
//    семантика: ни одной пользовательской DIRECT-маршрутизации + fail-closed
{
  const fixtures = [
    ['static/1 router', 'vless://' + UUID + '@192.0.2.1:443#A', { addTun: true, addSocks: true, webUI: false }],
    ['static/2 router', TWO_LINKS, { addTun: true, addSocks: true, webUI: false }],
    ['static/2 vps-gateway-tun', TWO_LINKS, { addTun: true, addSocks: false, webUI: false, mihomoTunStack: 'mips' }],
    ['static/2 per-proxy-listeners', TWO_LINKS, { addTun: true, addSocks: true, webUI: false, mihomoPerProxyTun: true }],
    ['static/2 per-proxy-port', TWO_LINKS, { addTun: true, addSocks: true, webUI: false, perProxyPort: true }],
  ];
  for (const [label, input, opts] of fixtures) {
    const cfg = engine.buildMihomoConfig(engine.buildBeansFromInput(input), opts);
    assertNoUserDirectEgress(cfg, label);
    assertFailClosed(cfg['proxy-groups'], label);
    cases++;
  }
  ok();
}

// 2. Static + DPR: SELECT-карты (финальный участник REJECT), фиксированные
//    GLOBAL/REJECT таргеты — ни одной DIRECT-маршрутизации
{
  const cfg = engine.buildMihomoConfig(engine.buildBeansFromInput(TWO_LINKS), { addSocks: true, domainPolicy: [
    { name: 'AI', domains: 'openai.com' },
    { name: 'Ads', domains: 'ads.example.com', target: 'GLOBAL' },
    { name: 'Bad', domains: 'bad.example.com', target: 'REJECT' },
  ] });
  assertNoUserDirectEgress(cfg, 'static+DPR');
  const ai = cfg['proxy-groups'].find(g => g.name === 'AI');
  assert.equal(ai.proxies[ai.proxies.length - 1], 'REJECT', 'DPR category escape slot = REJECT');
  cases++;
  ok();
}

// 3. DPR target DIRECT — fail-closed на обоих уровнях движка
{
  assert.throws(() => engine.buildMihomoConfig([], { domainPolicy: [
    { name: 'Track', domains: 'tracker.example.com', target: 'DIRECT' },
  ] }), /DIRECT is forbidden.*no-DIRECT/);
  cases++;
  ok();
}

// 4. Sub Mode ON (динамические подписки) — ПОЛНОСТЬЮ РАБОТАЕТ (positive
//    regression): провайдеры с служебным bootstrap-полем, AUTO-группы,
//    exclude-filter, GLOBAL без DIRECT-участников.
{
  const cfg = engine.buildMihomoSubscriptionConfig([SUB, 'https://b.example.org/s2'], [], {
    domainPolicy: [{ name: 'AI', domains: 'openai.com' }],
    excludeFilter: '(?i)ru|moscow',
  });
  const providerNames = Object.keys(cfg.providers);
  assert.equal(providerNames.length, 2, 'два провайдера');
  for (const provider of Object.values(cfg.providers)) {
    assert.equal(provider.proxy, 'DIRECT', 'service-plane bootstrap transport (download-only)');
  }
  const fastest = cfg.groups.find(g => g.name === '⚡ Fastest');
  assert.equal(fastest['empty-fallback'], 'REJECT', 'Fastest: empty-fallback REJECT');
  const ai = cfg.groups.find(g => g.name === 'AI');
  assert.equal(ai.proxies[ai.proxies.length - 1], 'REJECT', 'DPR category escape slot = REJECT');
  assert.ok(!cfg.groups.some(g => Array.isArray(g.proxies) && g.proxies.includes('DIRECT')),
    'no DIRECT member in any group');
  cases++;
  ok();
}

// 5. AUTO-WHITELIST priority (плоский fallback PRIMARY→FALLBACK) + DPR —
//    fail-closed без DIRECT
{
  const cfg = engine.buildMihomoPriorityConfig(
    { subUrls: [], beans: engine.buildBeansFromInput('vless://' + UUID + '@192.0.2.10:443#P') },
    { subUrls: [], beans: engine.buildBeansFromInput('vless://' + UUID + '@192.0.2.11:443#F') },
    { domainPolicy: [{ name: 'AI', domains: 'openai.com' }] },
  );
  const globalGroup = cfg.groups.find(g => g.name === 'GLOBAL');
  assert.equal(globalGroup.type, 'fallback');
  assert.equal(globalGroup['empty-fallback'], 'REJECT');
  assert.ok(!cfg.groups.some(g => Array.isArray(g.proxies) && g.proxies.includes('DIRECT')),
    'no DIRECT member in any priority group');
  cases++;
  ok();
}

// 6. dialer-proxy DIRECT (service plane: WG handshake) — emitted verbatim
{
  const wgBean = {
    name: 'WG-A',
    proto: 'wireguard',
    host: '192.0.2.73',
    port: 51820,
    wireguard: {
      privateKey: Buffer.alloc(32, 1).toString('base64'),
      publicKey: Buffer.alloc(32, 11).toString('base64'),
      ip: '10.66.1.2',
      allowedIPs: ['0.0.0.0/0'],
      dialerProxy: 'DIRECT',
    },
  };
  const res = engine.buildFromRequest({
    core: 'mihomo', input: 'vless://' + UUID + '@192.0.2.1:443#A', wgBeans: [wgBean],
    options: { addTun: true, addSocks: true, webUI: false },
  });
  assert.equal(res.kind, 'yaml');
  assert.ok(/dialer-proxy:\s*'?DIRECT/.test(res.data), 'dialer DIRECT preserved (service plane)');
  cases++;
  ok();
}

// 7. Empty input — fail-closed: GLOBAL = REJECT-only
{
  const single = engine.buildMihomoConfig([], { addSocks: true });
  const emptyGlobal = single['proxy-groups'].find(g => g.name === 'GLOBAL');
  assert.ok(emptyGlobal.proxies.length > 0 && emptyGlobal.proxies.every(m => m === 'REJECT'),
    'no proxies ⇒ GLOBAL is REJECT-only (fail-closed)');
  cases++;
  ok();
}

console.log('No-DIRECT egress policy: ' + cases + ' cases passed');
if (cases < 6) { console.error('registry smaller than expected'); process.exit(1); }

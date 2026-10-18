// No-DIRECT egress invariant (issue #284, owner decision 2026-10-18) —
// machine-checkable registry at the CONSUMER level (the vendored runtime bundle
// web4core.runtime.js, i.e. the exact artifact the Builder ships).
//
// Contract (repo constitution / PR #285):
//   1. Builder never emits YAML containing the token DIRECT (group members,
//      rules, fallback slots, auto-substituted values).
//   2. When no working output proxy remains, traffic is blocked (REJECT /
//      dial failure), never routed via the host public IP.
//   3. REJECT is allowed and is the escape slot of every generated group.
//   4. No hidden fallback routes to direct egress.
//   5. An explicit DIRECT domain-policy target fails the build (both layers).
//   6. A DIRECT dialer-proxy target normalizes to an omitted field
//      (semantically identical: a WG handshake without a dialer dials directly).
//
// Known documented exception (blocked at the page layer, see index.html
// buildMihomo gate): subscription proxy-providers keep the explicit
// `proxy: DIRECT` bootstrap download transport at engine level — mihomo routes
// provider fetches through the rule chain when the field is absent
// (verified on v1.19.31: empty provider-backed GLOBAL ⇒ immediate EOF,
// cold-start deadlock). Sub Mode ON therefore BLOCKS the build; Sub Mode OFF
// (inline expansion on Build) is fully compliant and covered below.
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
const DIRECT_TOKEN = /\bDIRECT\b/;
let cases = 0;
const ok = () => { cases++; };

function assertNoDirectToken(yaml, label) {
  const hits = String(yaml).split('\n')
    .map((line, i) => ({ no: i + 1, line: line.trim() }))
    .filter(x => DIRECT_TOKEN.test(x.line));
  assert.deepEqual(hits, [], label + ': token DIRECT found in generated YAML: '
    + JSON.stringify(hits.slice(0, 3)));
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
  for (const g of groups) {
    if (g.name === '🌐 static-health') continue; // скрытый health-checker, не маршрутизирует
    if (Array.isArray(g.proxies)) {
      assert.ok(!g.proxies.includes('DIRECT'), label + ': group ' + g.name + ' has no DIRECT member');
    }
  }
}

const STATIC_LINK = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A';
const TWO_LINKS = STATIC_LINK + '\nvless://00000000-0000-4000-8000-000000000001@192.0.2.2:443#B';
const SUB = 'https://subs.example.invalid/token';
const build = (input, options, extra) => engine.buildFromRequest({
  core: 'mihomo', input, wgBeans: [], ...(extra || {}), options,
});
const scrubHwid = (s) => s.replace(/^\s+- "?[0-9a-f]{32}"?\s*$/gm, 'HWID');

// 1. Static builds (1/2 proxies), router и VPS-профили (TUN) — ноль DIRECT
{
  for (const [label, input, opts] of [
    ['static/1 router', STATIC_LINK, { addTun: true, addSocks: true, webUI: false }],
    ['static/2 router', TWO_LINKS, { addTun: true, addSocks: true, webUI: false }],
    ['static/1 vps-local', STATIC_LINK, { addTun: false, addSocks: true, webUI: false }],
    ['static/2 vps-gateway-tun', TWO_LINKS, { addTun: true, addSocks: false, webUI: false, mihomoTunStack: 'mips' }],
    ['static/2 per-proxy-listeners', TWO_LINKS, { addTun: true, addSocks: true, webUI: false, mihomoPerProxyTun: true }],
    ['static/2 per-proxy-port', TWO_LINKS, { addTun: true, addSocks: true, webUI: false, perProxyPort: true }],
  ]) {
    const r = build(input, opts);
    assert.equal(r.kind, 'yaml');
    assertNoDirectToken(r.data, label);
    cases++;
  }
  ok();
}

// 2. Static + DPR: SELECT-карты (члены с REJECT), фиксированные GLOBAL/REJECT
{
  const r = build(TWO_LINKS, { addTun: true, webUI: false, mihomoDomainPolicy: [
    { name: 'AI', domains: 'openai.com' },
    { name: 'Ads', domains: 'ads.example.com', target: 'GLOBAL' },
    { name: 'Bad', domains: 'bad.example.com', target: 'REJECT' },
  ] });
  assertNoDirectToken(r.data, 'static+DPR');
  assert.ok(r.data.includes('  - "RULE-SET,policy-ads,GLOBAL"'));
  assert.ok(r.data.includes('  - "RULE-SET,policy-bad,REJECT"'));
  cases++;
  ok();
}

// 3. DPR target DIRECT — fail-closed на обоих уровнях движка
{
  assert.throws(() => build(TWO_LINKS, { addTun: true, webUI: false, mihomoDomainPolicy: [
    { name: 'Track', domains: 'tracker.example.com', target: 'DIRECT' },
  ] }), /DIRECT is forbidden.*no-DIRECT/);
  cases++;
  ok();
}

// 4. AWL (fallback PRIMARY→FALLBACK) + DPR в priority-режиме — ноль DIRECT.
// Обе стороны статические: fallback-ПОДПИСКА в Sub Mode ON дала бы provider с
// документированным bootstrap-полем — этот режим блокируется гейтом страницы
// (см. комментарий гейта в index.html), Builder его не выпускает.
{
  const r = build('vless://00000000-0000-4000-8000-000000000001@192.0.2.10:443#P', {
    mihomoSubscriptionMode: true, addTun: true, webUI: false,
    mihomoDomainPolicy: [{ name: 'AI', domains: 'openai.com' }],
  }, { fallbackInput: 'vless://00000000-0000-4000-8000-000000000001@192.0.2.11:443#F' });
  assert.ok(r.data.includes('type: fallback'), 'AW flat fallback present');
  assertNoDirectToken(r.data, 'AWL+DPR');
  cases++;
  ok();
}

// 5. Tiered/Priority backbone: обе стороны через движок priority-конфига —
// GLOBAL = fallback с empty-fallback REJECT, ноль DIRECT
{
  const beans = engine.buildBeansFromInput(TWO_LINKS);
  const cfg = engine.buildMihomoPriorityConfig(
    { subUrls: [], beans: beans.slice(0, 1) },
    { subUrls: [], beans: beans.slice(1) },
    {},
  );
  const globalGroup = cfg.groups.find(g => g.name === 'GLOBAL');
  assert.equal(globalGroup.type, 'fallback');
  assert.equal(globalGroup['empty-fallback'], 'REJECT');
  const yaml = engine.buildMihomoYaml(cfg.proxies, cfg.groups, null, cfg.rules, [], {});
  assertNoDirectToken(yaml, 'tiered priority backbone');
  cases++;
  ok();
}

// 6. Dialer-таргет DIRECT (legacy-профиль) → поле опускается, токена нет
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
  const r = engine.buildFromRequest({
    core: 'mihomo', input: STATIC_LINK, wgBeans: [wgBean],
    options: { addTun: true, addSocks: true, webUI: false },
  });
  assert.equal(r.kind, 'yaml');
  assert.ok(!r.data.includes('dialer-proxy'), 'DIRECT dialer target stamps nothing');
  assertNoDirectToken(r.data, 'wg dialer DIRECT');
  cases++;
  ok();
}

// 7. Fail-closed при отсутствии живых прокси: все члены GLOBAL — прокси и
// REJECT; пустые группы терминально REJECT (структурная проверка)
{
  const cfg = engine.buildMihomoConfig(engine.buildBeansFromInput(TWO_LINKS), { addSocks: true });
  assertFailClosed(cfg['proxy-groups'], 'static/2 structural');
  const single = engine.buildMihomoConfig([], { addSocks: true });
  assertFailClosed(single['proxy-groups'], 'static/0 structural');
  const emptyGlobal = single['proxy-groups'].find(g => g.name === 'GLOBAL');
  assert.ok(emptyGlobal.proxies.length > 0 && emptyGlobal.proxies.every(m => m === 'REJECT'),
    'no proxies ⇒ GLOBAL is REJECT-only (fail-closed)');
  cases += 2;
  ok();
}

// 8. Документированное исключение на уровне движка: провайдер подписки несёт
// bootstrap-транспорт (download-only). Builder блокирует этот режим (гейт в
// index.html), поэтому сгенерированный и отданный пользователю YAML
// провайдеров не содержит; здесь фиксируется сам контракт движка.
{
  const cfg = engine.buildMihomoSubscriptionConfig([SUB], [], {});
  for (const provider of Object.values(cfg.providers)) {
    assert.equal(provider.proxy, 'DIRECT', 'documented bootstrap field (engine-level exception)');
  }
  cases++;
  ok();
}

// 9. Sub Mode OFF (разворот подписки на Build) — совместимый путь: статические
// узлы, ноль DIRECT. Здесь вход статический (без сети), контракт тот же.
{
  const r = build(TWO_LINKS, { addTun: true, addSocks: true, webUI: false, mihomoSubscriptionMode: false });
  assertNoDirectToken(r.data, 'sub-off static expansion shape');
  cases++;
  ok();
}

console.log('No-DIRECT egress invariant: ' + cases + ' cases passed');
if (cases < 8) { console.error('registry smaller than expected'); process.exit(1); }

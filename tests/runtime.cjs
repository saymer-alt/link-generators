const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(process.argv[2] || path.join(root, 'web4core.runtime.js'), 'utf8');
function api(source) {
  const ctx = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } });
  vm.runInContext('Math.random = () => 0.5', ctx); // стабильный subscription x-hwid только в тесте
  vm.runInContext(source, ctx);
  return ctx.web4core;
}
const current = api(runtime);
const input = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#TEST-A\ntrojan://test-only@192.0.2.2:443#TEST-B';
const build = (engine, options) => engine.buildFromRequest({ core: 'mihomo', input:
  options.mihomoSubscriptionMode ? 'https://example.invalid/sub\n' + input : input, options }).data;
let cases = 0;
for (const sub of [false, true]) for (const perTun of [false, true]) {
  const options = { addTun: true, webUI: false, mihomoSubscriptionMode: sub, mihomoPerProxyTun: perTun };
  const defaults = build(current, options);
  for (const value of [undefined, 'gvisor', '', null]) {
    assert.equal(build(current, { ...options, mihomoTunStack: value }), defaults);
    cases++;
  }
  const mips = build(current, { ...options, mihomoTunStack: 'MIPS' }); // resolver нормализует регистр
  const stacks = [...mips.matchAll(/^\s+stack: (\w+)$/gm)].map(m => m[1]);
  assert.equal(stacks.length, perTun ? (sub ? 3 : 2) : 1);
  assert.ok(stacks.every(s => s === 'mips'));
  assert.equal(mips.replace(/stack: mips/g, 'stack: gvisor'), defaults); // тест сравнения, не генерация
  cases++;
  for (const stack of ['system', 'mixed']) {
    assert.match(build(current, { ...options, mihomoTunStack: stack }), new RegExp(`stack: ${stack}`));
    cases++;
  }
  for (const value of ['foobar', 1, {}, 'mips\nallow-lan: true']) {
    assert.throws(() => build(current, { ...options, mihomoTunStack: value }), /invalid TUN stack/);
    cases++;
  }
}
assert.doesNotMatch(build(current, { addTun: false, mihomoTunStack: 'mips' }), /stack:/);
assert.throws(() => current.buildMihomoYaml([], [], null, [], [], { tun: { stack: 'foobar' } }), /invalid TUN stack/);
assert.match(current.buildMihomoYaml([], [], null, [], [], { tun: { stack: 'mips' } }), /stack: mips/);
cases += 3;

// Device Model is opt-in: empty keeps previous provider headers; a value must reach every subscription provider.
const deviceModel = 'Keenetic Giga KN-1012';
const subWithoutDevice = build(current, { mihomoSubscriptionMode: true });
assert.doesNotMatch(subWithoutDevice, /x-device-model:/);
const subWithDevice = build(current, { mihomoSubscriptionMode: true, deviceModel });
assert.equal((subWithDevice.match(/x-device-model:/g) || []).length, 1);
assert.match(subWithDevice, /Keenetic Giga KN-1012/);
const priorityWithDevice = current.buildFromRequest({
  core: 'mihomo',
  input: 'https://example.invalid/primary',
  fallbackInput: 'https://example.invalid/fallback',
  options: { mihomoSubscriptionMode: true, deviceModel }
}).data;
assert.equal((priorityWithDevice.match(/x-device-model:/g) || []).length, 2);
cases += 4;

// Опциональный byte-for-byte baseline: исходный HEAD перед доработкой.
if (process.env.BASELINE_REF) {
  const old = execFileSync('git', ['show', `${process.env.BASELINE_REF}:web4core.runtime.js`], { cwd: root, encoding: 'utf8' });
  const baseline = api(old);
  // Нормализация намеренного изменения: скрытый per-proxy static checker
  // ('🌐 static-health') существует только в новом runtime и не должен ломать
  // byte-parity всего остального вывода.
  const stripChecker = y => y.replace(/^  - name: "🌐 static-health"\n(?:    [^\n]*\n)*/m, '');
  for (const sub of [false, true]) for (const tun of [false, true]) for (const perTun of [false, true]) for (const socks of [false, true]) {
    const opts = { addTun: tun, mihomoPerProxyTun: perTun, perProxyPort: socks, mihomoSubscriptionMode: sub };
    assert.equal(stripChecker(build(current, opts)), stripChecker(build(baseline, opts)));
    cases++;
  }
}
// Workflow must reject a runtime that silently ignores the second tier.
assert.equal(typeof current.buildMihomoPriorityConfig, 'function');
for (const sub of [false, true]) {
  const result = current.buildFromRequest({ core: 'mihomo', input,
    fallbackInput: (sub ? 'https://example.invalid/fallback\n' : '') + input,
    options: { mihomoSubscriptionMode: sub, addTun: true, mihomoTunStack: 'mips' } }).data;
  assert.match(result, /name: GLOBAL\n\s+type: fallback/);
  assert.doesNotMatch(result, /name: (PRIMARY|FALLBACK)\n/);
  assert.match(result, /filter: "\^\(PRIMARY-\|primary-\)`\^\(FALLBACK-\|fallback-\)"/);
  const groupsStart = result.indexOf('proxy-groups:');
  const rulesStart = result.indexOf('\nrules:', groupsStart);
  assert.ok(groupsStart >= 0 && rulesStart > groupsStart);
  assert.doesNotMatch(result.slice(groupsStart, rulesStart), /expected-status:/);
  assert.doesNotMatch(result, /listeners:/);
  cases++;
}

// WireGuard dialer-proxy (туннель в туннеле): opt-in, empty options keep output byte-identical.
const wgDialerConf = [
  '[Interface]',
  'PrivateKey = AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  'Address = 172.16.0.2/32',
  '[Peer]',
  'PublicKey = AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
  'AllowedIPs = 0.0.0.0/0, ::/0',
  'Endpoint = 162.159.198.2:2408',
].join('\n');
const wgDialerBean = current.parseWireGuardConf(wgDialerConf, 'WARP');
const dialerInput = 'vless://00000000-0000-4000-8000-0000000000b1@203.0.113.60:443#VPS-DK\ntrojan://p@203.0.113.61:443#VPS-EE';
const dialerBase = current.buildFromRequest({ core: 'mihomo', input: dialerInput, wgBeans: [wgDialerBean],
  options: { addTun: false, webUI: false, mihomoSubscriptionMode: false } }).data;
assert.doesNotMatch(dialerBase, /dialer-proxy/);
assert.equal(dialerBase, current.buildFromRequest({ core: 'mihomo', input: dialerInput, wgBeans: [wgDialerBean],
  options: { addTun: false, webUI: false, mihomoSubscriptionMode: false, wgDialerProxy: '', wgDialerGroupMembers: [] } }).data);
cases += 2;
const dialerA = current.buildFromRequest({ core: 'mihomo', input: dialerInput, wgBeans: [wgDialerBean],
  options: { addTun: false, webUI: false, mihomoSubscriptionMode: false, wgDialerProxy: 'VPS-DK' } }).data;
assert.match(dialerA, /dialer-proxy: VPS-DK/);
cases++;
const dialerB = current.buildFromRequest({ core: 'mihomo', input: dialerInput, wgBeans: [wgDialerBean],
  options: { addTun: false, webUI: false, mihomoSubscriptionMode: false, wgDialerProxy: 'WARP-DIALER', wgDialerGroupMembers: ['VPS-DK', 'VPS-EE'] } }).data;
assert.match(dialerB, /- name: WARP-DIALER\s*\n\s*type: select/);
assert.match(dialerB, /dialer-proxy: WARP-DIALER/);
assert.ok(dialerB.indexOf('- name: WARP-DIALER') < dialerB.indexOf('⚡ Fastest'));
cases++;
assert.throws(() => current.buildFromRequest({ core: 'mihomo', input: dialerInput, wgBeans: [wgDialerBean],
  options: { addTun: false, webUI: false, mihomoSubscriptionMode: false, wgDialerProxy: 'GHOST' } }),
  /dialer-proxy target "GHOST" not found/);
assert.throws(() => current.buildFromRequest({ core: 'mihomo', input: dialerInput, wgBeans: [wgDialerBean],
  options: { addTun: false, webUI: false, mihomoSubscriptionMode: false, wgDialerProxy: 'WARP', wgDialerGroupMembers: [] } }),
  /applies to no wireguard proxy/);
cases += 2;

// Variant C: provider-backed dialer group (use:) from existing URL subscriptions.
const geoUrl = 'https://account.geodema.org/api/sub?token=test';
const geoUrl2 = 'https://account.geodema.org/api/sub2?token=test';
const subDialerInput = geoUrl + '\n' + geoUrl2 + '\ntrojan://p@203.0.113.20:443#VPS-SE';
const subBase = (extraOpts) => current.buildFromRequest({ core: 'mihomo', input: subDialerInput, wgBeans: [wgDialerBean],
  options: Object.assign({ addTun: false, webUI: false, mihomoSubscriptionMode: true }, extraOpts) }).data;
const dialerC = subBase({ wgDialerProxy: 'WARP-DIALER', wgDialerProviders: [geoUrl] });
assert.match(dialerC, /- name: WARP-DIALER\s*\n\s*type: select\s*\n\s*use:\s*\n\s*- account\.geodema\.org/);
assert.match(dialerC, /dialer-proxy: WARP-DIALER/);
cases++;
const dialerC2 = subBase({ wgDialerProviders: [geoUrl, geoUrl2] });
const c2Block = dialerC2.slice(dialerC2.indexOf('- name: WARP-DIALER'), dialerC2.indexOf('⚡ Fastest'));
assert.equal((c2Block.match(/^\s+- account\.geodema\.org(-2)?$/gm) || []).length, 2);
cases++;
assert.throws(() => subBase({ wgDialerProxy: 'WARP-DIALER', wgDialerProviders: ['https://ghost.example.com/sub'] }),
  /dialer provider URL not found/);
assert.throws(() => subBase({ wgDialerProxy: 'VPS-SE', wgDialerProviders: [geoUrl] }),
  /conflicts with an existing proxy or group/);
cases += 2;

console.log(`Runtime: ${cases} cases passed`);

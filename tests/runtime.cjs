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
  for (const value of [undefined, 'gvisor', 'foobar', '', null, 1, {}, 'MIPS', 'mips\nallow-lan: true']) {
    assert.equal(build(current, { ...options, mihomoTunStack: value }), defaults);
    cases++;
  }
  const mips = build(current, { ...options, mihomoTunStack: 'mips' });
  const stacks = [...mips.matchAll(/^\s+stack: (\w+)$/gm)].map(m => m[1]);
  assert.equal(stacks.length, perTun ? (sub ? 3 : 2) : 1);
  assert.ok(stacks.every(s => s === 'mips'));
  assert.equal(mips.replace(/stack: mips/g, 'stack: gvisor'), defaults); // тест сравнения, не генерация
  cases++;
}
assert.doesNotMatch(build(current, { addTun: false, mihomoTunStack: 'mips' }), /stack:/);
assert.match(current.buildMihomoYaml([], [], null, [], [], { tun: { stack: 'foobar' } }), /stack: gvisor/);
assert.match(current.buildMihomoYaml([], [], null, [], [], { tun: { stack: 'mips' } }), /stack: mips/);
cases += 3;

// Опциональный byte-for-byte baseline: исходный HEAD перед доработкой.
if (process.env.BASELINE_REF) {
  const old = execFileSync('git', ['show', `${process.env.BASELINE_REF}:web4core.runtime.js`], { cwd: root, encoding: 'utf8' });
  const baseline = api(old);
  for (const sub of [false, true]) for (const tun of [false, true]) for (const perTun of [false, true]) for (const socks of [false, true]) {
    const opts = { addTun: tun, mihomoPerProxyTun: perTun, perProxyPort: socks, mihomoSubscriptionMode: sub };
    assert.equal(build(current, opts), build(baseline, opts));
    cases++;
  }
}
console.log(`Runtime: ${cases} cases passed`);

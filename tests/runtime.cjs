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
  assert.doesNotMatch(result, /listeners:/);
  cases++;
}
console.log(`Runtime: ${cases} cases passed`);

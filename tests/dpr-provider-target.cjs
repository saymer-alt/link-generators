// #351 DPR provider-target: «строго один выбранный provider» — node-only.
// 1) Baseline gap (SELECT-семантика): в Sub Mode ON NAME-AUTO пулит ВСЕ
//    proxy-providers подписок — это документированное поведение SELECT, не дефект.
// 2) Patch-контракт (extracted DPT-core из index.html — тот же код, что в
//    браузере): правило RULE-SET строго на provider-only url-test-группу,
//    use:[выбранный], empty-fallback REJECT, NAME select убирается при нулевых
//    ссылках, fail-closed на отсутствующий provider/группу/правило.
// 3) Движок НЕ принимает PROVIDER:<имя> напрямую — UI обязан слать
//    SELECT-плейсхолдер (контракт слоёв закреплён ошибкой движка).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const yaml = require(process.env.JS_YAML_PATH); // см. docs/TESTING.md

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'web4core.runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function engineApi() {
  const ctx = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } });
  vm.runInContext('Math.random = () => 0.5', ctx); // стабильный x-hwid только в тесте
  vm.runInContext(runtime, ctx);
  return ctx.web4core;
}
const engine = engineApi();

// DPT-core извлекается по маркерам (тот же код исполняется в браузере).
const dptStart = html.indexOf('=== DPR PROVIDER TARGET (#351) — DPT-START ===');
const dptEnd = html.indexOf('DPT-END ===');
assert.ok(dptStart !== -1 && dptEnd !== -1 && dptEnd > dptStart, 'DPT markers not found in index.html');
const dptStart2 = html.lastIndexOf('\n', dptStart) + 1;
const dptEnd2 = html.indexOf('\n', dptEnd) + 1;
const dptCore = html.slice(dptStart2, dptEnd2);
const dpt = new Function('jsyaml', 'dialerTargetsCache',
  dptCore + '\nreturn { isDprProviderTarget, dprProviderTarget, dprProviderName, dprProviderOptions, applyDprProviderTargets };')(yaml, []);

const SUBS = 'https://subs-a.example.invalid/token-a\nhttps://subs-b.example.invalid/token-b';
const build = (policies) => engine.buildFromRequest({
  core: 'mihomo', input: SUBS, wgBeans: [],
  options: { mihomoSubscriptionMode: true, addTun: false, webUI: false, ...(policies ? { mihomoDomainPolicy: policies } : {}) }
}).data;
const scrubHwid = (s) => s.replace(/^\s+- "?[0-9a-f]{32}"?\s*$/gm, 'HWID');

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.error('FAIL', name, e.message); }
};

// 1. Baseline gap: SELECT-политика пулит оба provider — reproduces issue #351
check('baseline gap: SELECT policy AUTO group pools BOTH providers (documented SELECT semantics)', () => {
  const doc = yaml.load(build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]));
  const auto = doc['proxy-groups'].find(g => g.name === 'GEMINI-AUTO');
  assert.deepEqual(auto.use, ['subs-a.example.invalid', 'subs-b.example.invalid']);
  assert.equal(doc['proxy-groups'].some(g => g.name === 'GEMINI' && g.type === 'select'), true);
  assert.ok(doc.rules.includes('RULE-SET,policy-gemini,GEMINI'), 'rule points at NAME select');
});

// 2. Positive: provider-target patch — rule → provider-only group, B never in use
check('provider target: RULE-SET strictly to GEMINI-AUTO with use:[A], B absent, empty-fallback REJECT', () => {
  const raw = build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]);
  const out = dpt.applyDprProviderTargets(raw, [{ name: 'GEMINI', target: 'PROVIDER:subs-a.example.invalid' }]);
  const doc = yaml.load(out);
  const auto = doc['proxy-groups'].find(g => g.name === 'GEMINI-AUTO');
  assert.ok(auto, 'GEMINI-AUTO kept');
  assert.equal(auto.type, 'url-test');
  assert.deepEqual(auto.use, ['subs-a.example.invalid'], 'strictly the chosen provider');
  assert.equal(auto['empty-fallback'], 'REJECT', 'fail-closed contract');
  assert.equal(doc['proxy-groups'].some(g => g.name === 'GEMINI'), false, 'unreachable NAME select removed');
  assert.ok(doc.rules.includes('RULE-SET,policy-gemini,GEMINI-AUTO'), 'rule rewritten');
  assert.equal(doc.rules[doc.rules.length - 1], 'MATCH,GLOBAL', 'MATCH,GLOBAL stays last');
  assert.equal(JSON.stringify(doc.rules).includes('GEMINI,'), false, 'no rule targets bare GEMINI anymore');
  // provider B не участвует в маршруте политики ни в каком виде
  const geminiRefs = JSON.stringify(auto);
  assert.equal(geminiRefs.includes('subs-b.example.invalid'), false, 'provider B never referenced');
  // no-DIRECT: no DIRECT member/target introduced
  for (const g of doc['proxy-groups']) assert.ok(!Array.isArray(g.proxies) || !g.proxies.includes('DIRECT'), 'no DIRECT member');
});

// 3. Mixed cards: SELECT policy untouched, provider policy strict — independent
check('mixed: SELECT policy keeps pooled AUTO, provider policy strict; both rules coherent', () => {
  const raw = build([
    { name: 'MEDIA', domains: 'media.example.invalid', target: 'SELECT' },
    { name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }
  ]);
  const out = dpt.applyDprProviderTargets(raw, [{ name: 'GEMINI', target: 'PROVIDER:subs-b.example.invalid' }]);
  const doc = yaml.load(out);
  const media = doc['proxy-groups'].find(g => g.name === 'MEDIA-AUTO');
  assert.deepEqual(media.use, ['subs-a.example.invalid', 'subs-b.example.invalid'], 'SELECT policy unchanged (both)');
  assert.deepEqual(media.proxies, undefined, 'AUTO group has use:, not proxies');
  const gemini = doc['proxy-groups'].find(g => g.name === 'GEMINI-AUTO');
  assert.deepEqual(gemini.use, ['subs-b.example.invalid'], 'provider policy strictly B');
  assert.ok(doc.rules.includes('RULE-SET,policy-media,MEDIA'), 'SELECT rule intact');
  assert.ok(doc.rules.includes('RULE-SET,policy-gemini,GEMINI-AUTO'), 'provider rule rewritten');
  assert.equal(doc['proxy-groups'].some(g => g.name === 'GEMINI'), false);
  assert.equal(doc['proxy-groups'].some(g => g.name === 'MEDIA'), true, 'SELECT select-group kept');
});

// 4. OFF parity: no wanted → byte-identical
check('no provider targets: output byte-identical (patch OFF parity)', () => {
  const raw = build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]);
  assert.equal(dpt.applyDprProviderTargets(raw, []), raw);
  assert.equal(dpt.applyDprProviderTargets(raw, [{ name: 'GEMINI', target: 'GLOBAL' }]), raw, 'non-provider targets ignored');
  assert.equal(dpt.applyDprProviderTargets(raw, undefined), raw);
});

// 5. Fail-closed: missing provider → error, no silent fallback
check('fail-closed: missing provider throws with policy name', () => {
  const raw = build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]);
  assert.throws(() => dpt.applyDprProviderTargets(raw, [{ name: 'GEMINI', target: 'PROVIDER:gone.example.invalid' }]),
    /подписка «gone\.example\.invalid» отсутствует/);
});

// 6. Fail-closed: engine contract drift (no NAME-AUTO) and missing RULE-SET
check('fail-closed: missing NAME-AUTO group or RULE-SET rule throws', () => {
  const raw = build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]);
  const noAuto = yaml.dump({ ...yaml.load(raw), 'proxy-groups': yaml.load(raw)['proxy-groups'].filter(g => g.name !== 'GEMINI-AUTO') });
  assert.throws(() => dpt.applyDprProviderTargets(noAuto, [{ name: 'GEMINI', target: 'PROVIDER:subs-a.example.invalid' }]),
    /GEMINI-AUTO не найдена/);
  const noRule = yaml.dump({ ...yaml.load(raw), rules: yaml.load(raw).rules.filter(r => !r.includes(',GEMINI')) });
  assert.throws(() => dpt.applyDprProviderTargets(noRule, [{ name: 'GEMINI', target: 'PROVIDER:subs-a.example.invalid' }]),
    /правило RULE-SET не найдено/);
});

// 7. Referenced NAME select is honestly kept (no dangling anywhere)
check('NAME select referenced by another group member is kept, rule still rewritten', () => {
  const raw = build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]);
  const docObj = yaml.load(raw);
  docObj['proxy-groups'].push({ name: 'MANUAL-OUT', type: 'select', proxies: ['GEMINI'] });
  const out = dpt.applyDprProviderTargets(yaml.dump(docObj), [{ name: 'GEMINI', target: 'PROVIDER:subs-a.example.invalid' }]);
  const doc = yaml.load(out);
  assert.equal(doc['proxy-groups'].some(g => g.name === 'GEMINI'), true, 'referenced select kept');
  assert.ok(doc['proxy-groups'].some(g => g.name === 'MANUAL-OUT'), 'reference holder intact');
  assert.ok(doc.rules.includes('RULE-SET,policy-gemini,GEMINI-AUTO'));
});

// 8. Provider-name helpers: roundtrip, empty/short values rejected
check('dprProvider helpers: PROVIDER:<name> roundtrip; bare prefix and empty rejected', () => {
  assert.equal(dpt.dprProviderTarget('subs-a.example.invalid'), 'PROVIDER:subs-a.example.invalid');
  assert.equal(dpt.dprProviderName('PROVIDER:subs-a.example.invalid'), 'subs-a.example.invalid');
  assert.equal(dpt.dprProviderName('PROVIDER:'), '', 'bare prefix is not a provider target');
  assert.equal(dpt.isDprProviderTarget('PROVIDER:'), true, 'bare prefix recognized but empty');
  assert.equal(dpt.dprProviderName('SELECT'), '');
  assert.equal(dpt.dprProviderName(''), '');
  assert.equal(dpt.dprProviderName(null), '');
  assert.equal(dpt.dprProviderName('GLOBAL'), '');
});

// 9. Layer contract: engine rejects PROVIDER target directly (UI must send SELECT)
check('engine contract: mihomoDomainPolicy target PROVIDER:x rejected at engine layer', () => {
  assert.throws(() => build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'PROVIDER:subs-a.example.invalid' }]),
    /must be SELECT, GLOBAL or REJECT/);
});

// 10. Global invariants: patched build keeps GLOBAL untouched and no-DIRECT backbone
check('patched build: GLOBAL group untouched vs baseline; rules end with MATCH,GLOBAL', () => {
  const base = yaml.load(build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]));
  const out = yaml.load(dpt.applyDprProviderTargets(build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]),
    [{ name: 'GEMINI', target: 'PROVIDER:subs-a.example.invalid' }]));
  assert.deepEqual(out['proxy-groups'].find(g => g.name === 'GLOBAL'), base['proxy-groups'].find(g => g.name === 'GLOBAL'),
    'GLOBAL identical to baseline');
  assert.deepEqual(out.rules.filter(r => r === 'MATCH,GLOBAL'), ['MATCH,GLOBAL']);
  for (const r of out.rules) assert.ok(!r.endsWith(',DIRECT'), 'no DIRECT rule target');
});

// 11. HWID/URL leakage: patched YAML carries the same scrubbed shape as baseline
check('no new secrets: patched output scrubbed equals baseline scrubbed modulo provider-target diff', () => {
  const base = scrubHwid(build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]));
  const patched = scrubHwid(dpt.applyDprProviderTargets(build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]),
    [{ name: 'GEMINI', target: 'PROVIDER:subs-a.example.invalid' }]));
  // только разрешённые различия: правило и use GEMINI-AUTO; никаких новых URL/токенов
  const tokens = (s) => new Set((s.match(/https?:\/\/[^\s"' ]+/g) || []));
  const baseTokens = tokens(base), patchedTokens = tokens(patched);
  for (const t of patchedTokens) assert.ok(baseTokens.has(t), 'no new URLs introduced: ' + t);
  assert.equal(patched.includes('token-b'), true, 'synthetic provider URL presence unchanged (engine-managed)');
});

// 12. Patch hardening: non-object YAML / missing proxy-providers fail-closed
check('patch hardening: non-object YAML and missing proxy-providers throw', () => {
  assert.throws(() => dpt.applyDprProviderTargets('[]', [{ name: 'GEMINI', target: 'PROVIDER:a.b' }]), /не является объектом/);
  assert.throws(() => dpt.applyDprProviderTargets(yaml.dump({ proxies: [], 'proxy-groups': [], rules: [] }),
    [{ name: 'GEMINI', target: 'PROVIDER:a.b' }]), /требует proxy-providers/);
});

console.log('\ndpr-provider-target: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

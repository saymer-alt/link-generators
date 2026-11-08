// #351 provider-target: parse-only Mihomo contracts on the pinned binary.
// Требует MIHOMO_BIN + JS_YAML_PATH (см. docs/TESTING.md). Никакой сети,
// синтетические домены/URL. ВАЖНО (честные границы): `mihomo -t` проверяет
// только структурную валидность YAML — это НЕ proof отсутствия утечек в рантайме;
// рантайм-семантика (health/failover/manual override) покрыта отдельными
// runtime-лабораториями и остаётся вне этого теста.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const yaml = require(process.env.JS_YAML_PATH);
assert.ok(process.env.MIHOMO_BIN, 'MIHOMO_BIN required');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'web4core.runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Тот же vm-контракт, что в tests/policy-routing.cjs
const ctx = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } });
vm.runInContext('Math.random = () => 0.5', ctx);
vm.runInContext(runtime, ctx);
const engine = ctx.web4core;
// DPT-core извлекается по маркерам (тот же код, что в браузере и node-тесте)
const dptStart = html.indexOf('=== DPR PROVIDER TARGET (#351) — DPT-START ===');
const dptEnd = html.indexOf('DPT-END ===');
assert.ok(dptStart !== -1 && dptEnd !== -1 && dptEnd > dptStart, 'DPT markers not found');
const dpt = new Function('jsyaml', 'dialerTargetsCache',
  html.slice(html.lastIndexOf('\n', dptStart) + 1, html.indexOf('\n', dptEnd) + 1) +
  '\nreturn { applyDprProviderTargets };')(yaml, []);

const SUBS = 'https://subs-a.example.invalid/token-a\nhttps://subs-b.example.invalid/token-b';
const build = (policies) => engine.buildFromRequest({
  core: 'mihomo', input: SUBS, wgBeans: [],
  options: { mihomoSubscriptionMode: true, addTun: false, webUI: false, ...(policies ? { mihomoDomainPolicy: policies } : {}) }
}).data;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-dpr-provider-'));
let cases = 0;
const runT = (file) => spawnSync(process.env.MIHOMO_BIN, ['-t', '-d', dir, '-f', file], { encoding: 'utf8', timeout: 30000 });
try {
  // 1. Baseline SELECT (gap-состояние из #351) структурно валиден
  {
    const file = path.join(dir, 'baseline-select.yaml');
    fs.writeFileSync(file, build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]));
    const r = runT(file);
    assert.equal(r.status, 0, 'baseline SELECT passes -t: ' + (r.stdout + r.stderr).slice(0, 400));
    cases++;
  }

  // 2. Provider-target (patched) — валиден для реального Mihomo
  {
    const patched = dpt.applyDprProviderTargets(
      build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]),
      [{ name: 'GEMINI', target: 'PROVIDER:subs-a.example.invalid' }]);
    const doc = yaml.load(patched);
    assert.deepEqual(doc['proxy-groups'].find(g => g.name === 'GEMINI-AUTO').use, ['subs-a.example.invalid']);
    const file = path.join(dir, 'provider-target.yaml');
    fs.writeFileSync(file, patched);
    const r = runT(file);
    assert.equal(r.status, 0, 'provider-target passes -t: ' + (r.stdout + r.stderr).slice(0, 400));
    cases += 2;
  }

  // 3. Mixed: SELECT + provider-target в одном конфиге — валиден
  {
    const patched = dpt.applyDprProviderTargets(
      build([
        { name: 'MEDIA', domains: 'media.example.invalid', target: 'SELECT' },
        { name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }
      ]),
      [{ name: 'GEMINI', target: 'PROVIDER:subs-b.example.invalid' }]);
    const file = path.join(dir, 'mixed.yaml');
    fs.writeFileSync(file, patched);
    const r = runT(file);
    assert.equal(r.status, 0, 'mixed passes -t: ' + (r.stdout + r.stderr).slice(0, 400));
    cases++;
  }

  // 4. Negative integrity proof: правило на несуществующую группу — -t отвергает.
  // Это фиксирует, что переписывание правила (а не просто удаление select-группы)
  // является обязательной частью контракта патча: dangling-ссылка невалидна.
  {
    const doc = yaml.load(dpt.applyDprProviderTargets(
      build([{ name: 'GEMINI', domains: 'gemini.example.invalid', target: 'SELECT' }]),
      [{ name: 'GEMINI', target: 'PROVIDER:subs-a.example.invalid' }]));
    const dangling = { ...doc, 'proxy-groups': doc['proxy-groups'].filter(g => g.name !== 'GEMINI-AUTO') };
    const file = path.join(dir, 'dangling.yaml');
    fs.writeFileSync(file, yaml.dump(dangling));
    const r = runT(file);
    assert.notEqual(r.status, 0, 'dangling RULE-SET target must fail -t');
    cases++;
  }

  console.log('PASS dpr-provider-target-mihomo-compat: ' + cases + ' parse-only cases');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

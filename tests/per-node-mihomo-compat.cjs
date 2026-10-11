// Per-node artifacts × реальный Mihomo (#187, P1.12): каждый артефакт со
// статусом READY обязан проходить `mihomo -t`. Только синтетика
// (RFC5737/example.invalid + dummy-пароли). env: MIHOMO_BIN обязателен.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MIHOMO = process.env.MIHOMO_BIN;
assert.ok(MIHOMO && fs.existsSync(MIHOMO), 'MIHOMO_BIN не задан или не существует');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(grab('PT-CORE-START', 'PT-CORE-END ===') + '\n' + grab('PT-GEN-START', 'PT-GEN-END ===') + '\nreturn { ptDemoTopologySpec, ptGenerateArtifacts };')();

const CREDS = { 'cred-client-msk': 'compat-synth-a', 'cred-msk-est': 'compat-synth-b', 'cred-est-swe': 'compat-synth-c' };

// Сценарий 1: референсная демо-топология (Moscow→Estonia→Sweden→WARP)
// — READY артефакты: msk-entry и est-transit (swe-exit = contract, НЕ -t).
const scenarios = [['demo-ss-chain', api.ptDemoTopologySpec(), CREDS]];

// Сценарий 2: socks-транспорт
const socksSpec = api.ptDemoTopologySpec();
socksSpec.links.forEach(l => { if (l.transport && l.transport.kind === 'ss') l.transport = { kind: 'socks', endpoint: l.transport.endpoint }; });
socksSpec.clientLink = { transport: { kind: 'socks', endpoint: 'ep-client-msk' } };
scenarios.push(['demo-socks-chain', socksSpec, {}]);

// Сценарий 3: http-транспорт
const httpSpec = api.ptDemoTopologySpec();
httpSpec.links.forEach(l => { if (l.transport && l.transport.kind === 'ss') l.transport = { kind: 'http', endpoint: l.transport.endpoint }; });
httpSpec.clientLink = { transport: { kind: 'http', endpoint: 'ep-client-msk' } };
scenarios.push(['demo-http-chain', httpSpec, {}]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-gen-compat-'));
let cases = 0;
let readyChecked = 0;
for (const [name, spec, creds] of scenarios) {
  const r = api.ptGenerateArtifacts(spec, creds);
  assert.equal(r.ok, true, name + ': генерация ok');
  for (const a of r.artifacts) {
    const cfg = a.files['config.yaml'];
    if (a.status === 'READY' && cfg) {
      const file = path.join(dir, name + '--' + a.nodeId + '.yaml');
      fs.writeFileSync(file, cfg);
      let out;
      try {
        out = execFileSync(MIHOMO, ['-t', '-d', dir, '-f', file], { timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        out = (e.stdout || '') + (e.stderr || '');
        assert.fail(name + '/' + a.nodeId + ': mihomo -t отверг READY артефакт: ' + out.slice(0, 300));
      }
      assert.ok(!/error|fatal/i.test(out), name + '/' + a.nodeId + ': чистый вывод');
      readyChecked++;
      console.log('  ok —', name + '/' + a.nodeId, '(mihomo -t PASS)');
    } else {
      // EXTERNAL_CONTRACT / PLACEHOLDERS: -t НЕ запускаем и совместимость НЕ заявляем
      if (cfg) {
        const file = path.join(dir, name + '--' + a.nodeId + '-skipped.yaml');
        fs.writeFileSync(file, cfg);
      }
      console.log('  skip —', name + '/' + a.nodeId, '(' + a.status + '): NOT_RUN');
    }
  }
  // честность: EXTERNAL_CONTRACT артефакты не содержат config.yaml с фейковым listener
  for (const a of r.artifacts) {
    if (a.status === 'EXTERNAL_CONTRACT_REQUIRED' && a.files['config.yaml']) {
      assert.fail(name + '/' + a.nodeId + ': контракт-артефакт не должен содержать config.yaml');
    }
  }
  cases++;
}
fs.rmSync(dir, { recursive: true, force: true });
assert.ok(readyChecked >= 3, 'минимум 3 READY артефакта проверено реальным mihomo');
console.log('PASS per-node-mihomo-compat: ' + cases + ' сценариев, READY проверено: ' + readyChecked);

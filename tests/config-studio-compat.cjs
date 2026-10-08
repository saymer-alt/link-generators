// Config Studio × реальный Mihomo (#178, PHASE 28): исходный синтетический
// фиксстурный конфиг и его правленые варианты обязаны проходить `mihomo -t`.
// Только синтетика (RFC5737/example.invalid/dummy-ключи). env: MIHOMO_BIN обязателен.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MIHOMO = process.env.MIHOMO_BIN;
assert.ok(MIHOMO && fs.existsSync(MIHOMO), 'MIHOMO_BIN не задан или не существует');

const CSYamlsSrc = fs.readFileSync(path.join(__dirname, '..', 'cs-yaml.runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(CSYamlsSrc + '\n' + grab('CS-CORE-START', 'CS-CORE-END') + '\n' + grab('CS-EDITOR-START', 'CS-EDITOR-END') + '\nreturn { CSYaml: CSYaml, csReplay };')();
const CSY = api.CSYaml;

const FIXTURE = [
  'mixed-port: 7890',
  'mode: rule',
  'log-level: warning',
  'proxies:',
  '  - name: Alpha-SS',
  '    type: ss',
  '    server: 198.51.100.10',
  '    port: 8443',
  '    password: compat-synth-pass-a',
  '    cipher: aes-128-gcm',
  '  - name: Beta-SS',
  '    type: ss',
  '    server: 198.51.100.20',
  '    port: 8443',
  '    password: compat-synth-pass-b',
  '    cipher: aes-128-gcm',
  'proxy-groups:',
  '  - name: MAIN',
  '    type: select',
  '    proxies:',
  '      - Alpha-SS',
  '      - Beta-SS',
  '      - DIRECT',
  'rules:',
  '  - DOMAIN-SUFFIX,example.invalid,MAIN',
  '  - MATCH,DIRECT'
].join('\n');

const SCENARIOS = [
  ['original', []],
  ['server-edit', [{ opKind: 'field-edit', type: 'proxy', name: 'Beta-SS', field: 'server', newText: '203.0.113.20' }]],
  ['port-edit', [{ opKind: 'field-edit', type: 'proxy', name: 'Beta-SS', field: 'port', newText: '9443' }]],
  ['rename-with-refs', [{ opKind: 'rename', type: 'proxy', name: 'Beta-SS', new: 'Beta-SS-2' }]],
  ['group-members', [{ opKind: 'group-members', name: 'MAIN', members: ['DIRECT', 'Alpha-SS', 'Beta-SS'] }]],
  ['rule-target', [{ opKind: 'rule-target', ruleIndex: 1, newTarget: 'Alpha-SS' }]],
  ['add-proxy', [{ opKind: 'add', fields: { name: 'Gamma-SS', type: 'ss', server: '203.0.113.30', port: '8443', password: 'compat-synth-pass-c', cipher: 'aes-128-gcm' } }]],
  ['multi-edit', [
    { opKind: 'field-edit', type: 'proxy', name: 'Beta-SS', field: 'server', newText: '203.0.113.20' },
    { opKind: 'rename', type: 'proxy', name: 'Beta-SS', new: 'Beta-SS-2' },
    { opKind: 'rule-target', ruleIndex: 0, newTarget: 'Alpha-SS' }
  ]]
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-compat-'));
let cases = 0;
for (const [name, ops] of SCENARIOS) {
  const { text } = api.csReplay(FIXTURE, ops, CSY);
  const file = path.join(dir, 'config-' + name + '.yaml');
  fs.writeFileSync(file, text);
  let out;
  try {
    out = execFileSync(MIHOMO, ['-t', '-d', dir, '-f', file], { timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    assert.fail(name + ': mihomo -t отверг конфиг: ' + out.slice(0, 300));
  }
  assert.ok(/configuration file .* test is successful|test is successful/i.test(out) || !/error|fatal/i.test(out), name + ': неожиданный вывод: ' + out.slice(0, 200));
  cases++;
  console.log('  ok —', name);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS config-studio-compat: ' + cases + ' сценариев против реального mihomo');

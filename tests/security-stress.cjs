// CODEX-02: bounded synthetic hostile input, source fidelity and fail-closed probes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const yaml = require(process.env.JS_YAML_PATH);
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(fs.readFileSync(path.join(__dirname, '..', 'cs-yaml.runtime.js'), 'utf8') + '\n' +
  grab('RD-CORE-START', 'RD-CORE-END ===') + grab('CS-CORE-START', 'CS-CORE-END ===') + grab('CS-EDITOR-START', 'CS-EDITOR-END ===') +
  grab('PT-CORE-START', 'PT-CORE-END ===') + grab('PT-GEN-START', 'PT-GEN-END ===') + grab('PT-RUNTIME-START', 'PT-RUNTIME-END ===') +
  '\nreturn { CSYaml, csLoadBounded, csScanSecrets, csRedactText, csDiagnostics, csGraphText, csTraceText, csLineDiff, csReplay, ptGenerateArtifacts, ptDemoTopologySpec, ptRuntimeParseProxies, ptResolveSelectionChain };')();
let cases = 0;
const load = text => api.csLoadBounded(text, yaml);
const reject = (text, pattern = /CS-LIMIT|CS-SHAPE|YAML/) => { assert.throws(() => load(text), pattern); cases++; };
const base = 'proxies:\n  - name: A\n    type: ss\n    server: 192.0.2.1 # keep\n    port: 443\n    password: SYNTH_SECRET_A\nproxy-groups:\n  - name: G\n    type: select\n    proxies: [A]\nproxy-providers:\n  P: {type: http, url: "https://example.invalid/public/feed", interval: 60}\nrules: ["MATCH,G"]\n';
reject('x: &cycle {child: *cycle}');
reject('x: ' + '['.repeat(100) + '0' + ']'.repeat(100));
let bomb = 'a0: &a0 [x,x,x,x,x,x,x,x,x,x]\n';
for (let i = 1; i < 6; i++) bomb += 'a' + i + ': &a' + i + ' [' + Array(10).fill('*a' + (i - 1)).join(',') + ']\n';
reject(bomb);
reject('x: ' + 'x'.repeat(16385));
reject('x: 1\n'.repeat(21000));
reject('x'.repeat(2 * 1024 * 1024 + 1));
reject('rules: ' + JSON.stringify(Array(10001).fill('MATCH,DIRECT')));
reject('proxy-groups: ' + JSON.stringify(Array.from({ length: 257 }, (_, i) => ({ name: 'g' + i }))));
reject('proxies: [null]'); reject('proxies: {bad: shape}'); reject('rules: [null]');
reject('proxy-groups: [{name: G, proxies: [null]}]'); reject('proxy-providers: {P: null}');
reject('x: 1\nx: 2'); reject('x: [unterminated'); reject('[]');
reject('x: "\\uD800"'); reject('x: \uD800');
const alias = load('x: &a {password: SYNTH_ALIAS_SECRET}\ny: *a\n');
assert.equal(alias.x, alias.y); assert.equal(api.csScanSecrets(alias).length, 1); cases++;
const secretDoc = load(base + 'nested:\n  private_key: |\n    SYNTH_BLOCK_ONE\n    SYNTH_BLOCK_TWO\n  headers: {Authorization: "Bearer SYNTH_BEARER", x-hwid: SYNTH_HWID}\n');
const raw = 'SYNTH_SECRET_A SYNTH_BLOCK_ONE SYNTH_BLOCK_TWO Bearer SYNTH_BEARER SYNTH_HWID https://example.invalid/a/opaque012345678901234567890?x=SYNTH_QUERY';
const masked = api.csRedactText(raw, secretDoc);
for (const value of ['SYNTH_SECRET_A', 'SYNTH_BLOCK_ONE', 'SYNTH_BLOCK_TWO', 'SYNTH_BEARER', 'SYNTH_HWID', 'opaque012345678901234567890', 'SYNTH_QUERY']) assert.ok(!masked.includes(value), value);
assert.equal(api.csRedactText('https://example.invalid/public/feed'), 'https://example.invalid/public/feed'); cases++;
for (const key of ['password', 'private-key', 'private_key', 'preshared-key', 'uuid', 'token', 'authorization', 'x-hwid']) {
  const secret = 'SYNTH_KNOWN_' + key;
  assert.ok(!api.csRedactText('echo ' + secret, { nested: { [key]: secret } }).includes(secret)); cases++;
}
// Mutations: unrelated syntax preserved, errors leave input intact, refs remain valid.
for (const eol of ['\n', '\r\n']) {
  const src = ('# comment\ncustom: {zero: "007", numeric: 007, bool: "true", emoji: "🌐", block: keep}\n' + base).replace(/\n/g, eol);
  assert.equal(api.csReplay(src, [], api.CSYaml).text, src);
  const edited = api.csReplay(src, [{ opKind: 'field-edit', type: 'proxy', name: 'A', field: 'server', newText: '203.0.113.2' }], api.CSYaml).text;
  assert.equal(edited, src.replace('192.0.2.1', '203.0.113.2'));
  cases++;
}
const ops = [
  { opKind: 'field-edit', type: 'proxy', name: 'A', field: 'port', newText: '8443' },
  { opKind: 'field-edit', type: 'proxy-providers', name: 'P', field: 'url', newText: 'https://example.invalid/new/feed' },
  { opKind: 'rename', type: 'proxy', name: 'A', new: '🌐 Renamed' },
  { opKind: 'rename', type: 'group', name: 'G', new: 'GG' },
  { opKind: 'rename', type: 'proxy-providers', name: 'P', new: 'PP' },
  { opKind: 'add', fields: { name: 'B', type: 'ss', server: '192.0.2.2', port: '443', password: 'SYNTH_B', cipher: 'aes-128-gcm' } },
  { opKind: 'rule-target', ruleIndex: 0, newTarget: 'B' },
  { opKind: 'group-members', name: 'GG', members: ['B'] },
  { opKind: 'delete', type: 'proxy', name: '🌐 Renamed', removeRefs: true }
];
const result = api.csReplay(base, ops, api.CSYaml);
assert.ok(!api.csDiagnostics(load(result.text)).some(d => d.severity === 'error'), JSON.stringify({ text: result.text, diagnostics: api.csDiagnostics(load(result.text)) }));
assert.equal(api.csReplay(base, [], api.CSYaml).text, base); cases++;
assert.throws(() => api.csReplay(base.replace('MATCH,G', 'MATCH,DIRECT'), [{ opKind: 'delete', type: 'proxy', name: 'A', removeRefs: true }], api.CSYaml), /flow/); cases++;
const logical = base.replace('MATCH,G', 'AND,((DOMAIN,a.example.invalid),(NETWORK,UDP)),G');
for (const op of [{ opKind: 'rename', type: 'group', name: 'G', new: 'GG' }, { opKind: 'rule-target', ruleIndex: 0, newTarget: 'DIRECT' }]) {
  const result = api.csReplay(logical, [op], api.CSYaml);
  assert.equal(load(result.text).rules[0], 'AND,((DOMAIN,a.example.invalid),(NETWORK,UDP)),' + (op.new || op.newTarget)); cases++;
}
const duplicate = base.replace('proxy-groups:', '  - name: A\n    type: ss\nproxy-groups:');
for (const opKind of ['field-edit', 'rename', 'delete']) assert.throws(() => api.csReplay(duplicate, [{ opKind, type: 'proxy', name: 'A', field: 'server', newText: 'x', new: 'B', removeRefs: true }], api.CSYaml), /неоднознач/);
assert.throws(() => api.csReplay(base + 'custom: &a {server: old}\nalias: *a\n', [{ opKind: 'delete', type: 'proxy', name: 'A', removeRefs: true }], api.CSYaml), /алиас/); cases++;
// Large-line-count diff cannot allocate n*m cells; still reconstructs both inputs.
const longA = Array.from({ length: 15000 }, (_, i) => 'line-' + i).join('\n');
const longB = longA.replace('line-7000\n', 'changed-7000\n');
const diff = api.csLineDiff(longA, longB);
assert.equal(diff.filter(x => x.t !== '+').map(x => x.line).join('\n'), longA);
assert.equal(diff.filter(x => x.t !== '-').map(x => x.line).join('\n'), longB); cases++;
// Topology malformed matrix: no unsupported route can become MATCH,DIRECT.
const demo = api.ptDemoTopologySpec();
const injected = structuredClone(demo); injected.nodes[0].label = 'label\nexternal-controller: 0.0.0.0:9090\n#';
assert.equal(api.ptGenerateArtifacts(injected, {}).ok, false); cases++;
for (const mutate of [s => delete s.clientLink, s => s.links[0].transport.kind = 'unknown', s => s.links[0].transport.kind = '__proto__', s => s.nodes[1].id = s.nodes[0].id, s => s.nodes[1].role = 'wrong', s => s.links.pop(), s => s.links.push({ from: s.nodes[1].id, to: s.nodes[0].id }), s => s.nodes[1].role = 'final-overlay', s => s.endpoints = {}]) {
  const spec = structuredClone(demo); mutate(spec);
  const r = api.ptGenerateArtifacts(spec, {});
  for (const a of r.artifacts || []) if (a.blockers.length) assert.ok(!a.files['config.yaml']);
  for (const a of r.artifacts || []) {
    if (a.files['contract.md']) assert.ok(a.files['contract.md'].includes('Статус: ' + a.status));
    if ((a.files['config.yaml'] || '').includes('MATCH,DIRECT')) assert.ok(a.role === 'exit' && !a.outbound && a.downstreamLabel === 'Internet');
  }
  assert.ok(!r.ok || r.artifacts.some(a => a.status !== 'READY')); cases++;
}
const proxies = api.ptRuntimeParseProxies('{"proxies":{"__proto__":{"type":"Selector","now":"DIRECT","all":["DIRECT"]}}}');
assert.equal(Object.getPrototypeOf(proxies), null);
assert.equal(api.ptResolveSelectionChain({}, 'constructor').unknown, true);
assert.equal(api.ptRuntimeParseProxies('{"proxies":[]}'), null); cases++;
// Measurements, not speed promises: elapsed wall time on this process and host.
for (const [count, groups, rules] of [[100, 20, 500], [1000, 100, 5000]]) {
  const source = yaml.dump({ proxies: Array.from({ length: count }, (_, i) => ({ name: 'P' + i, type: 'ss', server: '192.0.2.1', port: 443, password: 'SYNTH_PW_' + i })), 'proxy-groups': Array.from({ length: groups }, (_, i) => ({ name: 'G' + i, type: 'select', proxies: ['P' + i] })), 'proxy-providers': Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['provider' + i, { type: 'http', url: 'https://example.invalid/public/feed' }])), rules: Array.from({ length: rules }, (_, i) => 'DOMAIN,d' + i + '.example.invalid,G0') });
  const timings = {}, measure = (key, fn) => { const t = performance.now(); const value = fn(); timings[key] = +(performance.now() - t).toFixed(1); return value; };
  const doc = measure('parse_ms', () => load(source));
  measure('analysis_ms', () => api.csDiagnostics(doc));
  measure('graph_ms', () => api.csGraphText(doc));
  const edited = measure('edit_ms', () => api.csReplay(source, [{ opKind: 'field-edit', type: 'proxy', name: 'P0', field: 'server', newText: '203.0.113.1' }], api.CSYaml));
  measure('diff_ms', () => api.csLineDiff(source, edited.text));
  measure('export_ms', () => Buffer.from(edited.text));
  assert.ok(Object.values(timings).every(t => t < 10000), 'bounded completion, not a benchmark target');
  console.log('MEASURE', JSON.stringify({ proxies: count, groups, providers: 10, rules, bytes: Buffer.byteLength(source), ...timings })); cases++;
}
console.log('PASS security-stress:', cases, 'groups');

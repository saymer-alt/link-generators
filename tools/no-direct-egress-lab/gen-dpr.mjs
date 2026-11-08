// Lab config generator for the #355 provider-only DPR runtime-proof scenario.
// Depends on: #338 lab (this directory's lib/ + dest.mjs) and #352 (the DPT
// post-patch must exist in THIS checkout's index.html — the scenario tests the
// actual #352 build pipeline, not a hand-written stand-in YAML).
//
// Config pipeline per scenario (all steps in-tree, reproducible):
//   1. web4core.runtime.js builds the YAML from two synthetic provider URLs
//      (Sub Mode ON) + one DPR domain-policy card (engine layer contract:
//      the card is sent as SELECT, the engine emits GEMINI-AUTO + GEMINI
//      select + RULE-SET,policy-gemini,GEMINI);
//   2. applyDprProviderTargets — the EXACT #352 post-patch, extracted from
//      this checkout's index.html by its DPT markers (same code the browser
//      runs) — rewrites the rule to GEMINI-AUTO, use:[provider A],
//      empty-fallback: REJECT, and drops the unreachable GEMINI select;
//   3. clearly marked LAB-ONLY additions (external-controller, VLESS ingress
//      listener, TLS) and ONE marked rewrite: the health-check/test URL
//      https://www.gstatic.com/generate_204 -> http://10.210.0.1:8097/hc204
//      (the lab is offline by design; without a reachable 204 endpoint every
//      url-test member would be marked dead and even the POSITIVE case could
//      not run). The rewrite count is asserted; routing semantics (groups,
//      use, rules, empty-fallback) are NOT touched by it.
//
// Topology (all inside the contained netns lab):
//   root ns  : dest :8099 (dual-stack, #338 dest.mjs), DNS stub :5300,
//              dpr-sub.mjs :8097 (stateful provider payloads + /hc204),
//              nodeA stand-in mihomo :8442 ("provider A live node", exits
//              with source 10.210.0.1), client C (mixed :7897);
//   vps ns   : 10.210.0.3 — mihomo A with the DPR config (ingress VLESS);
//   egress ns: 10.211.0.2 — mihomo B ("provider B live node" stand-in).
// Observable exits for a user-plane GEMINI request:
//   via A node -> 10.210.0.1, via B node -> 10.211.0.2, direct -> 10.210.0.3.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';
const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(TOOL_DIR, '..', '..');
const OUT = path.join(TOOL_DIR, 'run', 'configs');

const require = createRequire(import.meta.url);
const jsYamlPath = process.env.JS_YAML_PATH;
if (!jsYamlPath) throw new Error('set JS_YAML_PATH to a js-yaml module (see docs/TESTING.md)');
const yaml = require(jsYamlPath);

const runtime = fs.readFileSync(path.join(REPO, 'web4core.runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const ctx = vm.createContext({
  URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
});
vm.runInContext('Math.random = () => 0.5', ctx);
vm.runInContext(runtime, ctx);
const engine = ctx.web4core;

// #352 DPT-core extraction by markers (identical logic to tests/dpr-provider-target.cjs).
const dptStart = html.indexOf('=== DPR PROVIDER TARGET (#351) — DPT-START ===');
const dptEnd = html.indexOf('DPT-END ===');
if (dptStart === -1 || dptEnd === -1 || dptEnd <= dptStart) {
  throw new Error('DPT markers not found in index.html — this scenario requires the #352 DPR provider-target code in the current checkout');
}
const dptCore = html.slice(html.lastIndexOf('\n', dptStart) + 1, html.indexOf('\n', dptEnd) + 1);
const dpt = new Function('jsyaml', 'dialerTargetsCache',
  dptCore + '\nreturn { applyDprProviderTargets };')(yaml, []);

// Synthetic lab constants (documented; no secrets).
const INGRESS_UUID = '00000000-0000-4000-8000-000000000001';
const EGRESS_UUID = 'a1b2c3d4-0000-4000-8000-0000000000e2';
const NODE_A_UUID = 'a1b2c3d4-0000-4000-8000-0000000000a7';
const SNI = 'lab.local';
const SUB_A_URL = 'http://10.210.0.1:8097/sub-a';
const SUB_B_URL = 'http://10.210.0.1:8097/sub-b';
const LAB_HC_URL = 'http://10.210.0.1:8097/hc204';
const GEMINI_DOMAIN = 'dpr-gemini.lab';

const cert = fs.readFileSync(path.join(TOOL_DIR, 'certs', 'server-cert.pem'), 'utf8').trim();
const key = fs.readFileSync(path.join(TOOL_DIR, 'certs', 'server-key.pem'), 'utf8').trim();
const pemYaml = (text) => text.split('\n').map((l) => '      ' + l).join('\n');
const TLS_BLOCK = `    certificate: |
${pemYaml(cert)}
    private-key: |
${pemYaml(key)}`;

const build = (input, options) => {
  const res = engine.buildFromRequest({ core: 'mihomo', input, options });
  if (res.kind !== 'yaml') throw new Error('unexpected build result kind: ' + res.kind);
  return res.data;
};

// --- Build the actual #352 config: engine output + EXACT DPT post-patch ---
const raw = build([SUB_A_URL, SUB_B_URL].join('\n'), {
  mihomoSubscriptionMode: true, addTun: false, addSocks: true, webUI: false,
  mihomoDomainPolicy: [{ name: 'GEMINI', domains: GEMINI_DOMAIN, target: 'SELECT' }],
});
const doc = yaml.load(raw);
const providers = doc['proxy-providers'] || {};
const nameA = Object.keys(providers).find((k) => String(providers[k].url) === SUB_A_URL);
const nameB = Object.keys(providers).find((k) => String(providers[k].url) === SUB_B_URL);
if (!nameA || !nameB) throw new Error('provider names for the lab subscription URLs not found in engine output');
const patched = dpt.applyDprProviderTargets(raw, [{ name: 'GEMINI', target: 'PROVIDER:' + nameA }]);

// --- LAB-ONLY additions to mihomo A (same stand-ins as gen.mjs) ---
const LAB_APPEND_A = `
# === LAB-ONLY (not Builder output) ===
external-controller: 0.0.0.0:9090
listeners:
  - name: vless-in
    type: vless
    port: 8443
    listen: 0.0.0.0
${TLS_BLOCK}
    users:
      - uuid: ${INGRESS_UUID}
`;

// LAB-ONLY health-check rewrite: the lab is offline by design; gstatic is
// unreachable, so every url-test member would be dead and the POSITIVE case
// could not run. Only the pinned health/test URL string is replaced (count
// asserted below); groups, use:, rules and empty-fallback stay untouched.
const HC_TARGET = 'https://www.gstatic.com/generate_204';
const hcCount = patched.split(HC_TARGET).length - 1;
if (hcCount !== 4) {
  throw new Error('expected exactly 4 gstatic health/test URLs in the patched config (2 provider hc + 2 url-test groups), got ' + hcCount);
}
const configA = patched.split(HC_TARGET).join(LAB_HC_URL) + LAB_APPEND_A
  + `# === LAB-ONLY rewrite note: ${hcCount} x ${HC_TARGET} -> ${LAB_HC_URL} (offline lab) ===\n`;

fs.mkdirSync(OUT, { recursive: true });
const write = (name, text) => {
  fs.writeFileSync(path.join(OUT, name), text);
  console.log('wrote', name, text.split('\n').length, 'lines');
};

write('configA-dpr.yaml', configA);

// --- Lab infra: provider B live node stand-in (egress ns; NOT generator output) ---
write('configB.yaml', `# LAB-ONLY egress node stand-in (not generator output)
mixed-port: 7891
allow-lan: false
mode: rule
log-level: warning
ipv6: false
listeners:
  - name: vless-in
    type: vless
    port: 8442
    listen: 0.0.0.0
${TLS_BLOCK}
    users:
      - uuid: ${EGRESS_UUID}
rules:
  - MATCH,DIRECT
`);

// --- Lab infra: provider A live node stand-in (lab root ns; NOT generator
// output). The GEMINI request carries the hostname dpr-gemini.lab end-to-end
// and the EXIT node is the one that resolves it: a static hosts mapping is
// used because the #338 DNS stub is an observation tool whose handcrafted
// answers mihomo's DNS client cannot parse ("overflow unpacking uint16"). ---
write('configNodeA.yaml', `# LAB-ONLY provider-A live node stand-in (not generator output)
mixed-port: 7893
allow-lan: false
mode: rule
log-level: warning
ipv6: false
hosts:
  dpr-gemini.lab: 10.210.0.1
dns:
  enable: true
  nameserver:
    - 10.210.0.1:5300
listeners:
  - name: vless-in
    type: vless
    port: 8442
    listen: 0.0.0.0
${TLS_BLOCK}
    users:
      - uuid: ${NODE_A_UUID}
rules:
  - MATCH,DIRECT
`);

// --- Lab infra: client C stand-in (same as gen.mjs) ---
write('configC.yaml', `# LAB-ONLY client stand-in (not generator output)
mixed-port: 7897
allow-lan: false
mode: rule
log-level: warning
ipv6: false
proxies:
  - name: ingress-a
    type: vless
    server: 10.210.0.3
    port: 8443
    uuid: ${INGRESS_UUID}
    tls: true
    servername: ${SNI}
    skip-cert-verify: true
    udp: true
proxy-groups:
  - name: PHONE
    type: select
    proxies: [ingress-a]
rules:
  - MATCH,PHONE
`);

// --- Static self-checks on the actual scenario config (mirrors gen.mjs +
// the #352 node-test contract): a lab config that violates the policy must
// fail HERE, before any runtime evidence is produced. ---
const aText = fs.readFileSync(path.join(OUT, 'configA-dpr.yaml'), 'utf8');
const adoc = yaml.load(aText);
if (/^\s*-\s*["']?DIRECT["']?\s*$/m.test(aText)) throw new Error('configA-dpr: DIRECT member found in groups');
if (/\bMATCH,DIRECT\b/.test(aText)) throw new Error('configA-dpr: MATCH,DIRECT rule found');
const auto = (adoc['proxy-groups'] || []).find((g) => g.name === 'GEMINI-AUTO');
if (!auto || auto.type !== 'url-test') throw new Error('configA-dpr: GEMINI-AUTO url-test group missing');
if (JSON.stringify(auto.use) !== JSON.stringify([nameA])) throw new Error('configA-dpr: GEMINI-AUTO use is not strictly [' + nameA + ']');
if (auto['empty-fallback'] !== 'REJECT') throw new Error('configA-dpr: empty-fallback REJECT missing');
if (!adoc['proxy-groups'].some((g) => g.name === nameB || (Array.isArray(g.use) && g.use.includes(nameB)))) {
  // provider B must still exist for the control path (GLOBAL/MATCH,GLOBAL)
  throw new Error('configA-dpr: provider B missing — control path unavailable');
}
if (JSON.stringify(auto).includes(nameB)) throw new Error('configA-dpr: provider B referenced by GEMINI-AUTO');
if (!adoc.rules.includes('RULE-SET,policy-gemini,GEMINI-AUTO')) throw new Error('configA-dpr: RULE-SET not on GEMINI-AUTO');
if (adoc.rules[adoc.rules.length - 1] !== 'MATCH,GLOBAL') throw new Error('configA-dpr: MATCH,GLOBAL not last');
if (adoc['proxy-groups'].some((g) => g.name === 'GEMINI' && g.type === 'select')) throw new Error('configA-dpr: orphan GEMINI select survived');
if (!adoc['rule-providers']?.['policy-gemini']?.payload?.some((l) => String(l).includes(GEMINI_DOMAIN))) {
  throw new Error('configA-dpr: inline rule-provider payload missing the GEMINI domain');
}
console.log('static self-checks OK (provider A:', nameA, '/ provider B:', nameB + ')');

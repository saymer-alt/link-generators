// MANUAL integration test: Selective Modern REALITY real handshake E2E. Never run in CI.
//
// Proves an actual Xray-core REALITY handshake plus proxied traffic for configs generated
// through web4core.runtime.js, across a small version matrix, with an ML-KEM-capable local
// TLS destination (OpenSSL 3.5+ `s_server`, groups X25519MLKEM768:X25519).
// A successful `mihomo -t` is NOT sufficient and is not used here.
//
// Prerequisites (binaries are NOT part of the repository — download them yourself):
//   1. Xray-core windows-64 binaries, pinned URLs, unpack as <XRAY_DIR>/<ver>/xray.exe:
//      https://github.com/XTLS/Xray-core/releases/download/v25.3.6/Xray-windows-64.zip
//      https://github.com/XTLS/Xray-core/releases/download/v25.5.16/Xray-windows-64.zip
//      https://github.com/XTLS/Xray-core/releases/download/v26.7.11/Xray-windows-64.zip
//   2. OpenSSL >= 3.5 in PATH (for the X25519MLKEM768-capable dest and the test certificate).
//   3. mihomo binary (MIHOMO_BIN), js-yaml 4.1.0 (JS_YAML_PATH), output dir (TEST_OUTPUT_DIR).
// Run (Git Bash):
//   XRAY_DIR=/absolute/xray MIHOMO_BIN=/absolute/mihomo \
//   JS_YAML_PATH=/absolute/js-yaml.min.js TEST_OUTPUT_DIR=/absolute/out \
//   node tests/mihomo-reality-handshake.manual.cjs
//
// Expected matrix (mihomo v1.19.31 era, recorded 2026-09-18):
//   Xray v25.3.6 + ML-KEM dest: legacy OK; selective(match) FAILS ("processed invalid
//     connection") — the exact hazard the selective flag guards against;
//   Xray v25.5.16: selective(match) OK with real ML-KEM negotiation
//     (mihomo logs "is using X25519MLKEM768 ...: true"); legacy/non-match/plain-TLS OK;
//   Xray v26.7.11: REALITY fails for mihomo v1.19.31 entirely (upper bound; a Mihomo-side
//     limitation, not a generator bug — recorded as expected-fail).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const vm = require('node:vm');
const { spawn, execFileSync } = require('node:child_process');
const yaml = require(process.env.JS_YAML_PATH);

const MIHOMO = process.env.MIHOMO_BIN;
const XRAY_DIR = process.env.XRAY_DIR;
const VERSIONS = (process.env.XRAY_VERSIONS || 'v25.3.6,v25.5.16,v26.7.11').split(',');
const UUID = 'a1b2c3d4-0000-4000-8000-000000000001';
const SNI = 'wp.example.invalid';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function freePort() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
function loadRuntime() {
  const p = process.env.TEST_RUNTIME_PATH || path.resolve(__dirname, '..', 'web4core.runtime.js');
  const ctx = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa });
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx);
  return ctx.web4core;
}
function opensslMajor() {
  try {
    const v = execFileSync('openssl', ['version'], { encoding: 'utf8' });
    const m = /OpenSSL (\d+)\.(\d+)/.exec(v);
    return m ? Number(m[1]) + Number(m[2]) / 10 : 0;
  } catch { return 0; }
}

(async () => {
  assert.ok(MIHOMO && process.env.JS_YAML_PATH && process.env.TEST_OUTPUT_DIR && XRAY_DIR,
    'Set XRAY_DIR, MIHOMO_BIN, JS_YAML_PATH, TEST_OUTPUT_DIR');
  const ver = opensslMajor();
  if (ver < 3.5) { console.log(`SKIP: OpenSSL >= 3.5 required for the ML-KEM dest, found ${ver}`); return; }
  for (const v of VERSIONS) {
    const bin = path.resolve(XRAY_DIR, v, process.platform === 'win32' ? 'xray.exe' : 'xray');
    assert.ok(fs.existsSync(bin), `missing ${bin} (see pinned URLs in the header)`);
  }
  const api = loadRuntime();
  const outDir = path.resolve(process.env.TEST_OUTPUT_DIR, 'reality-handshake');
  fs.mkdirSync(outDir, { recursive: true });

  // ephemeral synthetic REALITY keypair, generated fresh every run by xray itself
  const x25519 = execFileSync(path.resolve(XRAY_DIR, VERSIONS[1], process.platform === 'win32' ? 'xray.exe' : 'xray'),
    ['x25519'], { encoding: 'utf8' });
  const priv = /Private key: (\S+)/.exec(x25519)[1];
  const pub = /Public key: (\S+)/.exec(x25519)[1];
  assert.match(pub, /^[A-Za-z0-9_-]{43}$/, 'REALITY public key must be unpadded base64url');

  // ephemeral self-signed certificate for the dest and the plain-TLS inbound
  const certDir = fs.mkdtempSync(path.join(process.env.TEST_OUTPUT_DIR, 'cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'),
    '-days', '2', '-nodes', '-subj', `/CN=${SNI}`], { stdio: 'ignore' });

  const httpTarget = http.createServer((req, res) => res.end('TARGET-OK'));
  const targetPort = await new Promise(r => httpTarget.listen(0, '127.0.0.1', () => r(httpTarget.address().port)));
  const destPort = await freePort();
  const dest = spawn('openssl', ['s_server', '-accept', String(destPort), '-cert', path.join(certDir, 'cert.pem'),
    '-key', path.join(certDir, 'key.pem'), '-tls1_3', '-www', '-groups', 'X25519MLKEM768:X25519'], { windowsHide: true });
  await sleep(600);

  const probe = (mixed, timeoutMs = 4000) => new Promise(resolve => {
    const req = http.get({
      host: '127.0.0.1', port: mixed, path: `http://127.0.0.1:${targetPort}/data`,
      headers: { host: `127.0.0.1:${targetPort}` }, // the sing inbound dials the Host header
      agent: false,
    }, res => {
      let t = ''; res.on('data', d => t += d);
      res.on('end', () => resolve({ ok: res.statusCode === 200 && t === 'TARGET-OK', status: res.statusCode }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(Error('request timeout')));
    req.on('error', e => resolve({ ok: false, error: e.message }));
  });

  const results = [];
  try {
    for (const version of VERSIONS) {
      const xrayBin = path.resolve(XRAY_DIR, version, process.platform === 'win32' ? 'xray.exe' : 'xray');
      const xrayPort = await freePort(), tlsPort = await freePort();
      const link = (port, reality) => reality
        ? `vless://${UUID}@127.0.0.1:${port}?encryption=none&security=reality&sni=${SNI}&fp=chrome&pbk=${pub}&sid=0123abcd&type=tcp&flow=xtls-rprx-vision&allowInsecure=1#R1`
        : `vless://${UUID}@127.0.0.1:${port}?encryption=none&security=tls&sni=${SNI}&fp=chrome&type=tcp&allowInsecure=1#PLAIN1`;
      const scenarios = [
        { id: 'A-legacy', link: link(xrayPort, true), modernHosts: undefined },
        { id: 'B-selective-match', link: link(xrayPort, true), modernHosts: `127.0.0.1:${xrayPort}` },
        { id: 'C-selective-nonmatch', link: link(xrayPort, true), modernHosts: '203.0.113.99:443' },
        { id: 'D-plain-tls', link: link(tlsPort, false), modernHosts: undefined },
      ];
      const xrayConf = {
        log: { loglevel: 'debug' },
        inbounds: [
          {
            listen: '127.0.0.1', port: xrayPort, protocol: 'vless',
            settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none' },
            streamSettings: {
              network: 'tcp', security: 'reality',
              realitySettings: { show: true, dest: `127.0.0.1:${destPort}`, xver: 0, serverNames: [SNI], privateKey: priv, shortIds: ['0123abcd'] },
            },
          },
          {
            listen: '127.0.0.1', port: tlsPort, protocol: 'vless', tag: 'tls-in',
            settings: { clients: [{ id: UUID }], decryption: 'none' },
            streamSettings: {
              network: 'tcp', security: 'tls',
              tlsSettings: { certificates: [{ certificateFile: path.join(certDir, 'cert.pem'), keyFile: path.join(certDir, 'key.pem') }], alpn: ['http/1.1'] },
            },
          },
        ],
        outbounds: [{ protocol: 'freedom' }, { protocol: 'blackhole', tag: 'block' }],
      };
      const confPath = path.join(outDir, `xray-${version}.json`);
      fs.writeFileSync(confPath, JSON.stringify(xrayConf, null, 1));
      const xr = spawn(xrayBin, ['run', '-c', confPath], { windowsHide: true });
      await sleep(1200);
      try {
        for (const sc of scenarios) {
          const res = api.buildFromRequest({ core: 'mihomo', input: sc.link, options: { webUI: false, addTun: false, mihomoSubscriptionMode: false, ...(sc.modernHosts !== undefined ? { mihomoRealityModernHosts: sc.modernHosts } : {}) } });
          const doc = yaml.load(res.data);
          const node = doc.proxies[0];
          const control = await freePort(), mixed = await freePort();
          doc['external-controller'] = `127.0.0.1:${control}`;
          doc.secret = 'local-test'; doc['mixed-port'] = mixed;
          doc['bind-address'] = '127.0.0.1'; doc['allow-lan'] = false; doc['log-level'] = 'debug';
          const dir = path.join(outDir, `${version}-${sc.id}`);
          fs.mkdirSync(dir, { recursive: true });
          const cfg = path.join(dir, 'config.yaml');
          fs.writeFileSync(cfg, yaml.dump(doc));
          const mh = spawn(MIHOMO, ['-d', dir, '-f', cfg], { windowsHide: true });
          let mlog = '';
          mh.stdout.on('data', d => mlog += d); mh.stderr.on('data', d => mlog += d);
          try {
            await sleep(1500);
            const r = await probe(mixed);
            const mlkemMatches = [...mlog.matchAll(/using X25519MLKEM768 for TLS' communication: (true|false)/g)];
            const mlkemUsed = mlkemMatches.length ? mlkemMatches.at(-1)[1] === 'true' : null;
            const row = {
              xray: version, scenario: sc.id,
              mlkemFlag: node['reality-opts']?.['support-x25519mlkem768'] === true,
              trafficOk: r.ok,
              mihomoAuth: /REALITY Authentication: true/.test(mlog),
              mlkemUsed,
            };
            results.push(row);
            console.log(row.trafficOk ? 'PASS' : 'FAIL-EXPECTED-IF-NOTED', JSON.stringify(row));
            // strict assertions on the supported range
            if (version === 'v25.3.6') {
              assert.equal(row.trafficOk, sc.id !== 'B-selective-match', 'v25.3.6: only the selective-match row may fail');
              assert.ok(row.mlkemFlag === (sc.id === 'B-selective-match'), 'v25.3.6: flag only on match');
            }
            if (version === 'v25.5.16') {
              assert.equal(row.trafficOk, true, 'v25.5.16: all four scenarios must work');
              if (sc.id === 'B-selective-match') assert.equal(row.mlkemUsed, true, 'v25.5.16: real ML-KEM negotiation expected');
              // legacy rows may not log the mlkem line at all (share removed pre-handshake)
              if (sc.id !== 'B-selective-match') assert.notEqual(row.mlkemUsed, true, 'non-selective rows must stay legacy');
            }
            if (version === 'v26.7.11') {
              assert.equal(row.trafficOk, false, 'v26.7.11: mihomo v1.19.31 REALITY is expected to fail (upper bound)');
            }
          } finally {
            mh.kill(); await new Promise(r => mh.once('close', r)).catch(() => {});
            await sleep(200);
          }
        }
      } finally {
        xr.kill(); await new Promise(r => xr.once('close', r)).catch(() => {});
      }
    }
    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(results, null, 1));
    console.log('PASS mihomo-reality-handshake (manual)');
  } finally {
    httpTarget.close();
    if (dest.exitCode === null) dest.kill();
    fs.rmSync(certDir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

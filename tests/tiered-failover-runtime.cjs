// NIGHT-01 #148 runtime lab: Tiered Failover semantics on real local Mihomo.
// Deterministic: mock HTTP CONNECT outbounds (alive/dead switchable), local
// health responder, file provider for the provider-tier scenario. No external
// endpoints, no real credentials, no TUN.
//
// Evidence model (CONSTITUTION.md): this harness produces RUNTIME-PROVEN facts
// for TCP/HTTP health semantics on the exact binary under test; UDP and manual
// select overrides are explicitly OUT OF SCOPE (documented as boundaries, not
// silently claimed).
//
// Topology (session 1, url-test tiers):
//   ROOT (fallback) -> T1 (url-test [T1A, T1B]) -> T2 (fallback [T2A, T2B]) -> T3 (url-test [T3A])
// Session 2: T1 = fallback (nested fallback -> fallback -> proxy)
// Session 3: T2 members come from a file proxy-provider (provider refresh)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const yaml = require(process.env.JS_YAML_PATH);
const binary = process.env.MIHOMO_BIN;
const observer = require('../tools/tiered-stability/observe.cjs');
const { freeMixed } = require('../tools/tiered-stability/ports.cjs');
assert.ok(binary && process.env.TEST_OUTPUT_DIR, 'Set MIHOMO_BIN, JS_YAML_PATH, TEST_OUTPUT_DIR');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listen = server => new Promise((r, reject) => { server.once('error', e=>{observer.event('bind-error',observer.error(e));reject(e);}); server.listen(0, '127.0.0.1', () => { observer.event('listen', {port:server.address().port}); r(server.address().port); }); });
async function freePort() { const s = net.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; }
const until = observer.until;
async function mock(name) {
  const node = { name, alive: true, attempts: 0, requests: 0, connects:0, rejected:0, health:[], sockets: new Set() };
  observer.mocks.push(node);
  node.server = net.createServer(socket => {
    node.attempts++;
    node.sockets.add(socket);
    socket.on('close', () => node.sockets.delete(socket));
    socket.on('error', e => observer.event('mock-error',{name,...observer.error(e)}));
    if (!node.alive) { socket.destroy(); return; }
    let buffer = '', connected = false;
    socket.on('data', data => {
      buffer += data.toString();
      let end;
      while ((end = buffer.indexOf('\r\n\r\n')) !== -1) {
        const request = buffer.slice(0, end); buffer = buffer.slice(end + 4);
        if (!connected) {
          if (!request.startsWith('CONNECT 127.0.0.1:')) { node.rejected++; observer.event('connect-rejected',{name}); socket.destroy(); return; }
          node.connects++;
          connected = true;
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        } else {
          node.requests++;
          const head = request.startsWith('HEAD ');
          const healthObservation=request.split('\r\n')[0].includes('/health')?{requestedAt:Date.now(),method:head?'HEAD':'GET'}:null;
          if(healthObservation) { node.health.push(healthObservation); if(node.health.length>100)node.health.shift(); }
          const body = head ? '' : name;
          setTimeout(() => { if(healthObservation){healthObservation.responseAt=Date.now();observer.event('health-response',{name,latencyMs:healthObservation.responseAt-healthObservation.requestedAt,destroyed:socket.destroyed});} socket.end('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: ' + body.length + '\r\n\r\n' + body); }, 5);
        }
      }
    });
  });
  node.port = await listen(node.server);
  observer.servers.push(node.server);
  node.setAlive = alive => { node.alive = alive; observer.event('mock-alive',{name,alive}); if (!alive) for (const socket of node.sockets) socket.destroy(); };
  node.proxy = { name, type: 'http', server: '127.0.0.1', port: node.port, username: 'test', password: 'test' };
  return node;
}
function requestThrough(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: 'http://127.0.0.1:18080/data', agent: false }, res => {
      observer.event('http-response',{port,statusCode:res.statusCode});
      let text = ''; res.on('data', d => text += d); res.on('end', () => resolve(text));
    });
    req.setTimeout(3000, () => req.destroy(Error('request timeout'))); req.on('error', reject);
  });
}

const PROBE = { url: '', interval: 1, timeout: 500, lazy: false, 'expected-status': 200 };
const PROXY_PROVIDERS = {};
let providerDir = '';
function group(name, type, proxies, use) {
  const g = { name, type, url: PROBE.url, interval: 1, timeout: 500, lazy: false, 'expected-status': 200 };
  if (proxies) g.proxies = proxies;
  if (use) g.use = use;
  if (type === 'url-test') g.tolerance = 50;
  return g;
}
async function session(mihomoGroups, label, extraDoc, leafProxies) {
  const dir = path.resolve(process.env.TEST_OUTPUT_DIR, label); fs.mkdirSync(dir, { recursive: true });
  const control = await freePort(), mixed = await freeMixed(data=>observer.event('port-candidate-rejected',data));
  assert.notEqual(control,mixed,'controller and mixed ports must differ');
  const doc = Object.assign({
    'mixed-port': mixed,
    'bind-address': '127.0.0.1',
    'allow-lan': false,
    'log-level': 'debug',
    'external-controller': `127.0.0.1:${control}`,
    secret: 'local-test',
    profile: { 'store-selected': false },
    proxies: leafProxies || [],
    'proxy-groups': mihomoGroups,
    rules: ['MATCH,ROOT']
  }, extraDoc || {});
  const config = path.join(dir, 'config.yaml'); fs.writeFileSync(config, yaml.dump(doc));
  observer.ensureRunning();
  const child = spawn(binary, ['-d', dir, '-f', config], { windowsHide: true });
  let logs = ''; const append=d=>{logs=(logs+d).slice(-65536);s.startupLog=(s.startupLog+d).slice(0,8192);s.errorLines.push(...String(d).split(/\r?\n/).filter(line=>/level=(error|fatal)|bind:|panic:/i.test(line)));s.errorLines=s.errorLines.slice(-40);}; child.stdout.on('data', append); child.stderr.on('data', append);
  const get = async route => { const response=await fetch(`http://127.0.0.1:${control}${route}`, { headers: { Authorization: 'Bearer local-test' }, signal: AbortSignal.timeout(3000) }); if(!response.ok)throw Error('controller HTTP '+response.status); return observer.controller(s,route,await response.json()); };
  const s={ dir, child, get, control, mixed, logs: () => logs, config, startupLog:'', errorLines:[] }; observer.addSession(s); return s;
}
async function stopSession(s) {
  await observer.stop(s);
  await sleep(300);
}

// Global watchdog: a hung lab must never block the night queue.
const LAB_WATCHDOG = setTimeout(() => { console.error('LAB WATCHDOG: hard timeout 180s'); observer.finish(Error('LAB WATCHDOG: hard timeout 180s')).finally(()=>process.exit(3)); }, 180000);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearTimeout(LAB_WATCHDOG);observer.finish(Error(signal)).finally(()=>process.exit(1));});

(async () => {
  fs.mkdirSync(process.env.TEST_OUTPUT_DIR, { recursive: true });
  const version = execFileSync(binary, ['-v'], { encoding: 'utf8' }).trim();
  observer.setVersion(version);
  const evidence = { version, startedAt: new Date().toISOString(), scenarios: {} };
  const health = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); });
  const healthPort = await listen(health);
  observer.servers.push(health);
  PROBE.url = `http://127.0.0.1:${healthPort}/health`;
  let providerFile = '';
  const writeProvider = members => fs.writeFileSync(providerFile, yaml.dump({ proxies: members.map(m => m.proxy) }));

  const mocks = await Promise.all(['T1A', 'T1B', 'T2A', 'T2B', 'T3A'].map(mock));
  const [t1a, t1b, t2a, t2b, t3a] = mocks;
  const rootNow = async s => (await s.get('/proxies/' + encodeURIComponent('ROOT'))).now;
  const traffic = async s => { const t0=Date.now(); try { const body=await requestThrough(s.mixed); observer.traffic(s,t0,body); return body; } catch(e) { observer.traffic(s,t0,null,e); throw e; } };
  const wrap = async (s, label, fn) => {
    const t0 = Date.now();
    try { await fn(); } catch(e) { await observer.capture(e); throw e; }
    const ms = Date.now() - t0;
    evidence.scenarios[label] = evidence.scenarios[label] || {};
    evidence.scenarios[label].lastDurationMs = ms;
    console.log('  ok ' + label + ' (' + ms + 'ms)');
  };

  // ============ SESSION 1: url-test tiers (A, B, C, D, H, J) ============
  {
    const groups = [
      group('T1', 'url-test', ['T1A', 'T1B']),
      group('T2', 'fallback', ['T2A', 'T2B']),
      group('T3', 'url-test', ['T3A']),
      group('ROOT', 'fallback', ['T1', 'T2', 'T3'])
    ];
    const leaves = [t1a, t1b, t2a, t2b, t3a].map(m => m.proxy);
    const s = await session(groups, 's1-urltest', null, leaves);
    try {
      await until(() => s.get('/version'), 'controller startup s1');
      const mixed = s.mixed;
      evidence.scenarios.A = {};
      // --- A. strict priority: T1 alive, T2 alive -> traffic stays in T1
      await wrap(s, 'A-strict-priority', async () => {
        await until(async () => ['T1A', 'T1B'].includes(await traffic(s)), 'A: traffic via T1');
        assert.equal(await rootNow(s), 'T1', 'ROOT selects T1');
      });
      // --- B. partial T1 failure: T1A dead, T1B alive -> stay in T1
      await wrap(s, 'B-partial-tier1-failure', async () => {
        t1a.setAlive(false);
        await until(async () => (await traffic(s)) === 'T1B', 'B: traffic switched to T1B');
        assert.equal(await rootNow(s), 'T1', 'B: ROOT must stay on T1 (KEY contract)');
      });
      // --- C. total T1 failure -> Tier 2
      await wrap(s, 'C-total-tier1-failure', async () => {
        t1b.setAlive(false);
        await until(async () => ['T2A', 'T2B'].includes(await traffic(s)), 'C: traffic via T2');
        assert.equal(await rootNow(s), 'T2', 'C: ROOT moved to T2');
      });
      // --- D. failback after T1 recovery
      await wrap(s, 'D-failback', async () => {
        t1a.setAlive(true); t1b.setAlive(true);
        await until(async () => ['T1A', 'T1B'].includes(await traffic(s)), 'D: traffic back to T1');
        assert.equal(await rootNow(s), 'T1', 'D: ROOT returned to T1');
      });
      // --- H. restart: same config, fresh process
      await wrap(s, 'H-restart', async () => {
        await stopSession(s);
        const s2 = await session(groups, 's1-urltest-restart', null, leaves);
        try {
        await until(() => s2.get('/version'), 'controller restart', 25000);
        await until(async () => ['T1A', 'T1B'].includes(await traffic(s2)), 'H: traffic via T1 after restart');
        assert.equal(await rootNow(s2), 'T1', 'H: ROOT re-selected T1 after restart');
        evidence.scenarios.H = { note: 'fresh process re-probes and re-selects; no sticky tier state with store-selected=false' };
        console.log('  ok H-restart');
        } finally { await stopSession(s2); }
      });
    } finally { if (s.child.exitCode === null) await stopSession(s); }
  }

  // ============ SESSION 2: nested fallback tiers (F) ============
  {
    const groups = [
      group('T1', 'fallback', ['T1A', 'T1B']),
      group('T2', 'fallback', ['T2A', 'T2B']),
      group('ROOT', 'fallback', ['T1', 'T2'])
    ];
    const leaves = [t1a, t1b, t2a, t2b].map(m => m.proxy);
    const s = await session(groups, 's2-nested-fallback', null, leaves);
    try {
      await until(() => s.get('/version'), 'controller startup s2');
      evidence.scenarios.F = {};
      // --- F1: fallback -> fallback -> proxy; partial child failure
      await wrap(s, 'F1-nested-fallback-partial', async () => {
        t1a.setAlive(false);
        await until(async () => (await traffic(s)) === 'T1B', 'F1: traffic via T1B');
        assert.equal(await rootNow(s), 'T1', 'F1: ROOT stays on T1 while T1B alive (KEY: root must not misjudge live child)');
      });
      // --- F2: total child failure -> T2; the #2588 trap check (automatic mode)
      await wrap(s, 'F2-nested-fallback-total', async () => {
        t1b.setAlive(false);
        await until(async () => ['T2A', 'T2B'].includes(await traffic(s)), 'F2: traffic via T2');
        assert.equal(await rootNow(s), 'T2', 'F2: ROOT moved to T2');
      });
      // --- F3: #2588-class probe: root recovers to T1 automatically after child recovers
      await wrap(s, 'F3-nested-fallback-recovery', async () => {
        t1a.setAlive(true);
        await until(async () => (await traffic(s)) === 'T1A', 'F3: traffic back to T1');
        assert.equal(await rootNow(s), 'T1', 'F3: automatic recovery (no manual API probes involved)');
      });
    } finally { await stopSession(s); }
  }

  // ============ SESSION 3: provider tier (E) ============
  {
    const groups = [
      group('T1', 'url-test', ['T1A', 'T1B']),
      group('T2', 'url-test', null, ['tier2-provider']),
      group('ROOT', 'fallback', ['T1', 'T2'])
    ];
    const leaves = [t1a, t1b].map(m => m.proxy);
    providerFile = path.join(process.env.TEST_OUTPUT_DIR, 's3-provider', 'tier2.yaml');
    fs.mkdirSync(path.dirname(providerFile), { recursive: true });
    writeProvider([t2a, t2b]);
    PROXY_PROVIDERS['tier2-provider'] = {
      type: 'file', path: providerFile,
      'health-check': { enable: true, url: PROBE.url, interval: 1, timeout: 500, lazy: false, 'expected-status': 200 }
    };
    const s = await session(groups, 's3-provider', { 'proxy-providers': PROXY_PROVIDERS }, leaves);
    try {
      await until(() => s.get('/version'), 'controller startup s3');
      evidence.scenarios.E = {};
      // --- E1: baseline — provider-backed tier serves traffic while T1 dead
      await wrap(s, 'E1-provider-tier-baseline', async () => {
        t1a.setAlive(false); t1b.setAlive(false);
        await until(async () => ['T2A', 'T2B'].includes(await traffic(s)), 'E1: traffic via provider tier');
        assert.equal(await rootNow(s), 'T2', 'E1: ROOT on provider-backed T2');
      });
      // --- E2: partial provider failure — one provider node dead, other serves
      await wrap(s, 'E2-provider-partial-failure', async () => {
        t2a.setAlive(false);
        await until(async () => (await traffic(s)) === 'T2B', 'E2: provider tier switches to T2B');
        assert.equal(await rootNow(s), 'T2', 'E2: ROOT stays on provider tier (partial failure does not eject tier)');
      });
      // --- E3: provider refresh — payload rewritten without the dead node; recovery keeps contract
      await wrap(s, 'E3-provider-refresh', async () => {
        writeProvider([t2b]);
        // refresh via controller API (PUT provider) is the documented path
        const put = await fetch(`http://127.0.0.1:${s.control}/providers/proxies/tier2-provider`, { method: 'PUT', headers: { Authorization: 'Bearer local-test' } }).catch(e => ({ ok: false, error: String(e) }));
        evidence.scenarios.E3_refreshStatus = put.status || put.error;
        await until(async () => (await traffic(s)) === 'T2B', 'E3: traffic still via T2B after refresh');
        assert.equal(await rootNow(s), 'T2', 'E3: provider tier remains selected after refresh');
      });
    } finally { await stopSession(s); }
  }

  // --- I/J boundaries recorded (no false claims)
  evidence.scenarios.I_UDP = { status: 'OUT-OF-SCOPE', note: 'health probes are HTTP(S) only; no UDP-specific runtime claim made' };
  evidence.scenarios.J_timing = { note: 'per-scenario lastDurationMs recorded; intervals: group interval=1s, timeout=500ms, lazy=false' };
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR, 'tiered-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('TIERED RUNTIME LAB: all scenarios PASS (' + version + ')');
  clearTimeout(LAB_WATCHDOG);
  const diagnostic=await observer.finish();
  process.exit(diagnostic.status==='PASS'?0:1);
})().catch(async e => {
  console.error('LAB FAIL:', e.message);
  try { fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR, 'tiered-failure.txt'), String(e.message || e)); } catch {}
  clearTimeout(LAB_WATCHDOG);
  await observer.finish(e);
  process.exit(1);
});

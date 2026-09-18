// MANUAL production-interval AWL soak (~20-25 min). Never run in CI.
// Uses the GENERATED intervals (300s health-check interval, 60000ms check timeout,
// max-failed-times 2); only the probe URL is repointed to a local server.
// Phases: baseline -> active failover (refused) -> automatic failback (scheduler tick)
// -> slow-but-alive primary keeps priority -> CLEAN passive failover (traffic quiesced
// 60s before the kill; read-only polls only) -> all-down behaviour -> recovery.
// Run: MIHOMO_BIN=... JS_YAML_PATH=... TEST_OUTPUT_DIR=... node tests/mihomo-awl-soak.manual.cjs
// Requires an EXCLUSIVE machine window: no other Mihomo labs concurrently.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const yaml = require(process.env.JS_YAML_PATH);
const binary = process.env.MIHOMO_BIN;
assert.ok(binary && process.env.TEST_OUTPUT_DIR, 'Set MIHOMO_BIN, JS_YAML_PATH, TEST_OUTPUT_DIR');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa });
vm.runInContext(fs.readFileSync(process.env.TEST_RUNTIME_PATH || path.join(root, 'web4core.runtime.js'), 'utf8'), ctx);
const api = ctx.web4core;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
async function freePort() { const s = net.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; }
// Same mock contract as tests/mihomo-awl-priority.cjs (HEAD -> 204, GET -> name).
async function mock(name) {
  const node = { name, mode: 'ok', sockets: new Set() };
  node.server = net.createServer(socket => {
    node.sockets.add(socket);
    socket.on('close', () => node.sockets.delete(socket));
    socket.on('error', () => {});
    if (node.mode === 'refuse') { socket.destroy(); return; }
    let buffer = '', connected = false;
    socket.on('data', data => {
      buffer += data.toString();
      let end;
      while ((end = buffer.indexOf('\r\n\r\n')) !== -1) {
        const request = buffer.slice(0, end); buffer = buffer.slice(end + 4);
        if (!connected) {
          if (!request.startsWith('CONNECT 127.0.0.1:')) { socket.destroy(); return; }
          connected = true;
          const answer = () => socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          const m = /^slow:(\d+)$/.exec(node.mode);
          if (m) setTimeout(answer, Number(m[1])); else answer();
        } else {
          const head = request.startsWith('HEAD ');
          const reply = () => socket.end('HTTP/1.1 ' + (head ? '204 No Content' : '200 OK') +
            '\r\nConnection: close\r\nContent-Length: ' + (head ? 0 : name.length) + '\r\n\r\n' + (head ? '' : name));
          const m = /^slow:(\d+)$/.exec(node.mode);
          if (m) setTimeout(reply, Number(m[1])); else reply();
        }
      }
    });
  });
  node.port = await listen(node.server);
  node.setMode = async mode => {
    if (mode === node.mode) return;
    if (mode === 'refuse') {
      for (const s of node.sockets) s.destroy();
      if (node.server.listening) await new Promise(r => node.server.close(() => r()));
    } else if (node.mode === 'refuse') {
      for (let i = 0; i < 20; i++) {
        try { await new Promise((res, rej) => { node.server.once('error', rej); node.server.listen(node.port, '127.0.0.1', () => res()); }); break; }
        catch (e) { if (i === 19) throw e; await sleep(50); }
      }
    }
    node.mode = mode;
  };
  node.link = `http://test:test@127.0.0.1:${node.port}#${name}`;
  node.destroy = () => { for (const s of node.sockets) s.destroy(); try { node.server.close(); } catch {} };
  return node;
}
function requestThrough(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: 'http://127.0.0.1:18080/data', agent: false }, res => {
      let text = ''; res.on('data', d => text += d); res.on('end', () => resolve(text));
    });
    req.setTimeout(timeoutMs, () => req.destroy(Error('request timeout')));
    req.on('error', reject);
  });
}
async function probe(port, timeoutMs) {
  try { return { ok: true, body: await requestThrough(port, timeoutMs) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

(async () => {
  const outDir = path.resolve(process.env.TEST_OUTPUT_DIR, 'awl-soak');
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  const timeline = [];
  const rec = (phase, event, data) => {
    const e = { t: +((Date.now() - t0) / 1000).toFixed(1), ts: new Date().toISOString(), phase, event, ...data };
    timeline.push(e);
    fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 1));
    console.log(`[${e.t}s] ${phase} ${event} ${JSON.stringify(data || {})}`);
  };
  const version = execFileSync(binary, ['-v'], { encoding: 'utf8' }).trim();
  rec('init', 'version', { version });

  const P1 = await mock('P1'); const F1 = await mock('F1');
  const health = http.createServer((req, res) => { res.statusCode = 204; res.end(); });
  const healthPort = await listen(health);
  const doc = yaml.load(api.buildFromRequest({
    core: 'mihomo', input: P1.link, fallbackInput: F1.link,
    options: { webUI: false, addTun: false, mihomoSubscriptionMode: true },
  }).data);
  for (const g of doc['proxy-groups']) g.url = `http://127.0.0.1:${healthPort}/generate_204`; // interval/timeout stay generated
  rec('init', 'generated group', {
    type: doc['proxy-groups'][0].type, interval: doc['proxy-groups'][0].interval,
    timeout: doc['proxy-groups'][0].timeout, maxFailedTimes: doc['proxy-groups'][0]['max-failed-times'],
  });

  const control = await freePort(), mixed = await freePort();
  doc['external-controller'] = `127.0.0.1:${control}`;
  doc.secret = 'local-soak'; doc['mixed-port'] = mixed;
  doc['bind-address'] = '127.0.0.1'; doc['allow-lan'] = false; doc['log-level'] = 'debug';
  const dir = path.join(outDir, 'inst'); fs.mkdirSync(dir, { recursive: true });
  const config = path.join(dir, 'config.yaml'); fs.writeFileSync(config, yaml.dump(doc));
  let logs = '';
  const child = spawn(binary, ['-d', dir, '-f', config], { windowsHide: true });
  child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const get = async route => (await fetch(`http://127.0.0.1:${control}${route}`,
    { headers: { Authorization: 'Bearer local-soak' }, signal: AbortSignal.timeout(3000) })).json();
  const saveLogs = () => fs.writeFileSync(path.join(dir, 'mihomo.log'), logs);
  const probeOnce = async (tag, timeoutMs) => {
    const r = await probe(mixed, timeoutMs);
    rec('traffic', tag, r.ok ? { via: r.body } : { error: r.error });
    return r;
  };
  async function until(fn, message, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) { try { if (await fn()) return; } catch {} await sleep(200); }
    throw Error(message);
  }

  try {
    await until(async () => { try { await get('/version'); return true; } catch { return false; } }, 'controller startup', 90000);

    // Phase 0: baseline
    for (let i = 0; i < 3; i++) {
      const r = await probeOnce('baseline-' + i);
      assert.ok(r.ok && r.body === 'P1', 'baseline via P1');
      if (i < 2) await sleep(30000);
    }

    // Phase 1: active failover (refused) with 5s sporadic traffic
    const tKill = Date.now();
    await P1.setMode('refuse');
    rec('P1-failover', 'P1 refused');
    {
      const end = Date.now() + 240000;
      let done = null;
      while (Date.now() < end) {
        const r = await probeOnce('failover-observed');
        if (r.ok && r.body === 'F1') { done = Date.now() - tKill; break; }
        await sleep(5000);
      }
      assert.ok(done !== null, 'no active failover');
      rec('P1-failover', 'complete', { latencyMs: done });
    }

    // Phase 2: automatic failback at the next scheduler tick (no manual API writes)
    const tRestore = Date.now();
    await P1.setMode('ok');
    rec('P2-failback', 'P1 restored');
    {
      const end = Date.now() + 700000;
      let done = null;
      while (Date.now() < end) {
        const r = await probeOnce('failback-observed');
        if (r.ok && r.body === 'P1') { done = Date.now() - tRestore; break; }
        await sleep(5000);
      }
      assert.ok(done !== null, 'no automatic failback');
      rec('P2-failback', 'complete', { latencyMs: done, note: 'bounded by the 300s scheduler grid' });
    }

    // Phase 3: slow-but-alive primary keeps priority (2s << 60s check timeout,
    // but note mihomo bounds user-traffic dials at ~5s regardless of group timeout)
    await P1.setMode('slow:2000');
    rec('P3-slow', 'P1 now 2000ms slow; F1 fast');
    for (let i = 0; i < 3; i++) {
      const r = await probeOnce('slow-' + i, 10000);
      assert.ok(r.ok && r.body === 'P1', 'slow primary lost priority: ' + JSON.stringify(r));
    }

    // Phase 4: CLEAN passive failover — quiesce traffic, then read-only polls only
    await P1.setMode('ok');
    {
      const r = await probeOnce('pre-passive-confirm');
      assert.ok(r.ok && r.body === 'P1', 'P1 not re-confirmed healthy');
      await sleep(60000); // traffic quiesce: last dial well before the kill
    }
    const tKill2 = Date.now();
    await P1.setMode('refuse');
    rec('P4-passive', 'P1 refused; zero traffic until detection');
    {
      const end = Date.now() + 700000;
      let flipMs = null;
      while (Date.now() < end) {
        await sleep(15000);
        const p = await get('/proxies/GLOBAL');
        rec('P4-passive', 'poll', { now: p.now });
        if (p.now !== 'PRIMARY-1: P1') { flipMs = Date.now() - tKill2; break; }
      }
      assert.ok(flipMs !== null, 'no passive flip within 700s');
      rec('P4-passive', 'detected (scheduled checks only)', { flipMs });
      const r = await probeOnce('post-passive-traffic');
      assert.ok(r.ok && r.body === 'F1', 'first traffic after passive flip via F1');
    }

    // Phase 5: all candidates down — record actual behaviour (no assumptions)
    await F1.setMode('refuse');
    rec('P5-alldown', 'F1 also refused');
    for (let i = 0; i < 3; i++) {
      const r = await probeOnce('alldown-' + i);
      assert.ok(!r.ok, 'all-down traffic must fail, not silently succeed');
      await sleep(2000);
    }
    const pAll = await get('/proxies/GLOBAL');
    rec('P5-alldown', 'state', { now: pAll.now, all: pAll.all });

    // Phase 6: recovery via fallback
    const tF1 = Date.now();
    await F1.setMode('ok');
    rec('P6-recovery', 'F1 restored');
    {
      const end = Date.now() + 700000;
      let done = null;
      while (Date.now() < end) {
        const r = await probeOnce('recovery-observed');
        if (r.ok && r.body === 'F1') { done = Date.now() - tF1; break; }
        await sleep(5000);
      }
      assert.ok(done !== null, 'no recovery');
      rec('P6-recovery', 'complete', { latencyMs: done });
    }

    rec('done', 'soak complete', { totalMinutes: +((Date.now() - t0) / 60000).toFixed(1) });
    console.log('PASS awl-soak (manual)');
  } finally {
    if (child.exitCode === null) { child.kill(); await new Promise(r => child.once('close', r)); }
    saveLogs();
    P1.destroy(); F1.destroy(); health.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

// AWL priority semantics regression: priority-over-speed, return-to-primary,
// passive detection — plus the ordinary-mode (url-test) contrast on identical leaves.
// Real local Mihomo, mock HTTP CONNECT outbounds, no external endpoints, no TUN,
// read-only controller API (no manual health-check or selection writes).
// Fast lab intervals (2s) for determinism; production-interval behaviour is covered
// by tests/mihomo-awl-soak.manual.cjs (manual, never CI).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
async function until(fn, message, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch {} await sleep(100); }
  throw Error(message + ': ' + JSON.stringify(last));
}
// HTTP CONNECT mock: HEAD (health probe, two per check) -> 204 + Connection: close;
// GET (traffic probe) -> 200 + own name. Modes: ok | refuse | slow:<ms> | hang.
async function mock(name) {
  const node = { name, mode: 'ok', requests: 0, sockets: new Set() };
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
          node.requests++;
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
function requestThrough(port, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: 'http://127.0.0.1:18080/data', agent: false }, res => {
      let text = ''; res.on('data', d => text += d); res.on('end', () => resolve(text));
    });
    req.setTimeout(timeoutMs, () => req.destroy(Error('request timeout')));
    req.on('error', reject);
  });
}
async function probe(port) {
  try { return { ok: true, body: await requestThrough(port) }; }
  catch (e) { return { ok: false, error: e.message }; }
}
async function runMihomo(doc, dir, label) {
  const control = await freePort(), mixed = await freePort();
  doc['external-controller'] = `127.0.0.1:${control}`;
  doc.secret = 'local-test'; doc['mixed-port'] = mixed;
  doc['bind-address'] = '127.0.0.1'; doc['allow-lan'] = false; doc['log-level'] = 'debug';
  fs.mkdirSync(dir, { recursive: true });
  const config = path.join(dir, 'config.yaml'); fs.writeFileSync(config, yaml.dump(doc));
  let logs = '';
  const child = spawn(binary, ['-d', dir, '-f', config], { windowsHide: true });
  child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const get = async route => (await fetch(`http://127.0.0.1:${control}${route}`,
    { headers: { Authorization: 'Bearer local-test' }, signal: AbortSignal.timeout(2000) })).json();
  await until(async () => { try { await get('/version'); return true; } catch { return false; } }, label + ' startup');
  return { child, mixed, get, logs: () => logs, save: () => fs.writeFileSync(path.join(dir, 'mihomo.log'), logs),
    stop: async () => { if (child.exitCode === null) { child.kill(); await new Promise(r => child.once('close', r)); } } };
}
async function waitTraffic(inst, names, timeoutMs) {
  const want = Array.isArray(names) ? names : [names];
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await probe(inst.mixed);
    if (last.ok && want.includes(last.body)) return last.body;
    await sleep(120);
  }
  throw Error('traffic never via ' + want.join('|') + ': ' + JSON.stringify(last));
}
const now_ = async inst => (await inst.get('/proxies/GLOBAL')).now;

(async () => {
  const outDir = path.resolve(process.env.TEST_OUTPUT_DIR, 'awl-priority');
  fs.mkdirSync(outDir, { recursive: true });
  const evidence = { version: execFileSync(binary, ['-v'], { encoding: 'utf8' }).trim(), scenarios: [] };
  const rec = (s, d) => { evidence.scenarios.push({ s, ...d }); console.log(s, JSON.stringify(d)); };

  const nodes = await Promise.all(['P1', 'P2', 'F1', 'F2'].map(mock));
  const [P1, P2, F1, F2] = nodes;
  const subscriptions = http.createServer((req, res) => res.end(yaml.dump({ proxies: [] })));
  const subPort = await listen(subscriptions);
  const url = `http://127.0.0.1:${subPort}/health`; // answered by the mocks, not this server
  try {
    const doc = yaml.load(api.buildFromRequest({
      core: 'mihomo',
      input: P1.link + '\n' + P2.link,
      fallbackInput: F1.link + '\n' + F2.link,
      options: { webUI: false, addTun: false, mihomoSubscriptionMode: true },
    }).data);
    // generator contracts (only test-infra parameters are patched afterwards)
    const g = doc['proxy-groups'];
    assert.equal(g.length, 1, 'single flat group, no nesting');
    assert.equal(g[0].type, 'fallback'); assert.equal(g[0].name, 'GLOBAL');
    assert.equal(g[0].lazy, false); assert.equal(g[0]['expected-status'], 204);
    assert.equal(g[0]['max-failed-times'], 2); assert.equal(g[0]['empty-fallback'], 'REJECT');
    assert.deepEqual(g[0].proxies, ['PRIMARY-1: P1', 'PRIMARY-2: P2', 'FALLBACK-1: F1', 'FALLBACK-2: F2'],
      'PRIMARY members before FALLBACK members');
    assert.ok(!JSON.stringify(g[0]).includes('DIRECT'), 'no DIRECT among GLOBAL targets');
    for (const grp of g) { grp.url = url; grp.interval = 2; grp.timeout = 2000; }

    // Deterministic startup: every non-P1 node is slowest at the first round, so the
    // AWL group picks P1 by ORDER and the url-test control picks P1 by SPEED.
    await P2.setMode('slow:800');
    await F1.setMode('slow:800');
    await F2.setMode('slow:800');
    const docCtl = JSON.parse(JSON.stringify(doc));
    docCtl['proxy-groups'][0].type = 'url-test'; // ordinary-mode control, identical leaves
    const awl = await runMihomo(doc, path.join(outDir, 'awl'), 'awl');
    const ctl = await runMihomo(docCtl, path.join(outDir, 'ctl'), 'ctl');
    try {
      await waitTraffic(awl, 'P1', 15000);
      await waitTraffic(ctl, 'P1', 15000);
      assert.match(await now_(ctl), /^PRIMARY-1:/, 'control deterministically starts on P1');
      assert.deepEqual((await awl.get('/proxies/GLOBAL')).all,
        ['PRIMARY-1: P1', 'PRIMARY-2: P2', 'FALLBACK-1: F1', 'FALLBACK-2: F2'], 'flat first-alive order');

      // Contrast: primary alive but much slower. AWL must keep priority at all times;
      // url-test re-picks the faster node lazily (10s singledo cache in v1.19.31).
      await P1.setMode('slow:600'); await F1.setMode('ok');
      const tSlow = Date.now();
      let ctlSwitchMs = null;
      const end = Date.now() + 25000;
      while (Date.now() < end) {
        if (/^FALLBACK-/.test(await now_(ctl))) { ctlSwitchMs = Date.now() - tSlow; break; }
        assert.match(await now_(awl), /^PRIMARY-1:/, 'AWL keeps slower primary at all times');
        await sleep(200);
      }
      assert.match(await now_(awl), /^PRIMARY-1:/, 'AWL keeps slower primary (final)');
      rec('priority-over-speed', { awl: await now_(awl), ctlRepickMs: ctlSwitchMs, note: ctlSwitchMs === null ? 'ctl stayed on slower primary (sticky)' : 'ctl left slower primary' });

      // Return-to-primary: kill both primaries, then restore P1 still slower than F1/F2.
      await P1.setMode('refuse'); await P2.setMode('refuse');
      await waitTraffic(awl, ['F1', 'F2'], 15000);
      const ctlFallback = await now_(ctl);
      assert.match(ctlFallback, /^FALLBACK-/, 'control left the dead primary');
      await P1.setMode('slow:600');
      await waitTraffic(awl, 'P1', 15000);
      assert.equal(await now_(ctl), ctlFallback, 'url-test does NOT return to the slower primary (ordinary semantics)');
      rec('return-to-slower-primary', { awl: await now_(awl), ctl: await now_(ctl) });

      // Passive detection (AWL instance): no traffic at all; scheduled checks decide.
      await P1.setMode('ok');
      await waitTraffic(awl, 'P1', 15000);
      await sleep(2500); // fresh healthy round
      const tKill = Date.now();
      await P1.setMode('refuse');
      const endP = Date.now() + 8000;
      let passiveMs = null, flippedTo = null;
      while (Date.now() < endP) {
        await sleep(150);
        const n = await now_(awl); // read-only
        if (n !== 'PRIMARY-1: P1') { passiveMs = Date.now() - tKill; flippedTo = n; break; }
      }
      assert.ok(passiveMs !== null, 'passive failover within two check intervals');
      assert.match(flippedTo, /^FALLBACK-/, 'passive flip goes to fallback');
      rec('passive-detection', { passiveMs, flippedTo });
      console.log('PASS awl-priority: priority-over-speed, return-to-primary, passive detection');
    } finally {
      await awl.stop(); awl.save();
      await ctl.stop(); ctl.save();
    }
    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  } finally {
    for (const n of nodes) n.destroy();
    subscriptions.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

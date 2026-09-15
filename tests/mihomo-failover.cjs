// Real local Mihomo, mock HTTP CONNECT outbounds and HTTP subscription server.
// No external endpoints, TUN, controller selection writes, or external watchdog.
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
async function until(fn, message) {
  const end = Date.now() + 15000;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch {} await sleep(100); }
  throw Error(message + ': ' + JSON.stringify(last));
}
async function mock(name) {
  const node = { name, alive: true, attempts: 0, requests: 0, sockets: new Set() };
  node.server = net.createServer(socket => {
    node.attempts++;
    node.sockets.add(socket);
    socket.on('close', () => node.sockets.delete(socket));
    socket.on('error', () => {});
    if (!node.alive) { socket.destroy(); return; }
    let buffer = '', connected = false;
    socket.on('data', data => {
      buffer += data.toString();
      let end;
      while ((end = buffer.indexOf('\r\n\r\n')) !== -1) {
        const request = buffer.slice(0, end); buffer = buffer.slice(end + 4);
        if (!connected) {
          if (!request.startsWith('CONNECT 127.0.0.1:')) { socket.destroy(); return; }
          connected = true;
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        } else {
          node.requests++;
          const head = request.startsWith('HEAD ');
          const body = head ? '' : name;
          setTimeout(() => socket.end('HTTP/1.1 ' + (head ? '204 No Content' : '200 OK') + '\r\nConnection: close\r\nContent-Length: ' + body.length + '\r\n\r\n' + body), 5);
        }
      }
    });
  });
  node.port = await listen(node.server);
  node.setAlive = alive => { node.alive = alive; if (!alive) for (const socket of node.sockets) socket.destroy(); };
  node.proxy = { name, type: 'http', server: '127.0.0.1', port: node.port, username: 'test', password: 'test' };
  node.link = `http://test:test@127.0.0.1:${node.port}#${name}`;
  return node;
}
function requestThrough(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: 'http://127.0.0.1:18080/data', agent: false }, res => {
      let text = ''; res.on('data', d => text += d); res.on('end', () => resolve(text));
    });
    req.setTimeout(2000, () => req.destroy(Error('request timeout'))); req.on('error', reject);
  });
}
(async () => {
  fs.mkdirSync(process.env.TEST_OUTPUT_DIR, { recursive: true });
  const version = execFileSync(binary, ['-v'], { encoding: 'utf8' });
  const evidence = { version, binarySha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), scenarios: [] };
  const nodes = await Promise.all(['P-DEAD', 'P-ALIVE', 'F-ALIVE'].map(mock));
  const [p1, p2, f] = nodes;
  const subscriptions = http.createServer((req, res) => {
    const proxies = req.url === '/primary' ? [p1.proxy, p2.proxy] : req.url === '/fallback' ? [f.proxy] : [p2.proxy];
    res.end(yaml.dump({ proxies }));
  });
  const subPort = await listen(subscriptions);
  const url = `http://127.0.0.1:${subPort}/health`;
  try {
    for (const mode of (process.argv.includes('--nested-repro') ? ['nested-repro'] : ['static', 'providers', 'mixed'])) {
      nodes.forEach(n => n.setAlive(true)); p1.setAlive(false);
      const primary = mode === 'providers' ? `http://127.0.0.1:${subPort}/primary` : mode === 'mixed' ? p1.link + `\nhttp://127.0.0.1:${subPort}/mixed` : p1.link + '\n' + p2.link;
      const fallback = mode === 'providers' ? `http://127.0.0.1:${subPort}/fallback` : mode === 'mixed' ? f.link + `\nhttp://127.0.0.1:${subPort}/fallback` : f.link;
      const doc = yaml.load(api.buildFromRequest({ core: 'mihomo', input: primary, fallbackInput: fallback, options: { webUI: false, addTun: false, mihomoSubscriptionMode: true } }).data);
      if (mode === 'nested-repro') {
        // Reconstruct the rejected architecture; no historical runtime artifact required.
        const probe = { url: 'https://google.com/generate_204', interval: 300, 'expected-status': 204, lazy: false, 'empty-fallback': 'REJECT' };
        doc['proxy-groups'] = ['PRIMARY', 'FALLBACK'].map(name => ({ name, type: 'url-test', proxies: doc.proxies.filter(p => p.name.startsWith(name + '-')).map(p => p.name), ...probe }));
        doc['proxy-groups'].push({ name: 'GLOBAL', type: 'fallback', proxies: ['PRIMARY', 'FALLBACK'], ...probe });
      }
      // Only test infrastructure parameters change; grouping/filter/prefix/lazy/status stay generated.
      const groups = doc['proxy-groups'];
      const interval = mode === 'nested-repro' ? 3600 : 1;
      for (const g of groups) { assert.equal(g.lazy, false); g.url = url; g.interval = interval; g.timeout = 300; }
      for (const p of Object.values(doc['proxy-providers'] || {})) {
        assert.deepEqual({ ...p['health-check'], __comments: undefined }, { enable: true, interval: 300, url: 'https://google.com/generate_204', 'expected-status': 204, lazy: false, __comments: undefined });
        Object.assign(p['health-check'], { url, interval, timeout: 300 });
      }
      const control = await freePort(), mixed = await freePort();
      doc['external-controller'] = `127.0.0.1:${control}`;
      doc.secret = 'local-test'; doc['mixed-port'] = mixed;
      doc['bind-address'] = '127.0.0.1'; doc['allow-lan'] = false; doc['log-level'] = 'debug';
      const dir = path.resolve(process.env.TEST_OUTPUT_DIR, mode); fs.mkdirSync(dir, { recursive: true });
      const config = path.join(dir, 'config.yaml'); fs.writeFileSync(config, yaml.dump(doc));
      const child = spawn(binary, ['-d', dir, '-f', config], { windowsHide: true });
      let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
      const get = async route => (await fetch(`http://127.0.0.1:${control}${route}`, { headers: { Authorization: 'Bearer local-test' }, signal: AbortSignal.timeout(2000) })).json();
      try {
        await until(() => get('/version'), 'controller startup');
        if (mode === 'nested-repro') {
          p2.setAlive(false);
          const query = `?url=${encodeURIComponent(url)}&timeout=500&expected=204`;
          await get('/proxies/PRIMARY/delay' + query); // real failed probe of wrapper
          await get('/proxies/FALLBACK/delay' + query);
          p2.setAlive(true);
          await get('/group/PRIMARY/delay' + query); // real successful child probe only
          await sleep(1200); // let url-test selection cache expire
          const primaryState = await get('/proxies/PRIMARY');
          const childState = await get('/proxies/' + encodeURIComponent(primaryState.now));
          const chosen = await get('/proxies/GLOBAL');
          const traffic = await requestThrough(mixed);
          assert.equal(primaryState.alive, false);
          assert.equal(childState.alive, true);
          assert.ok(primaryState.now.includes('P-ALIVE'));
          assert.equal(chosen.now, 'FALLBACK');
          assert.equal(traffic, 'F-ALIVE');
          evidence.scenarios.push({ mode, primaryState, childState, chosen, traffic });
          console.log('REPRODUCED #2588: PRIMARY has a live selected child, but GLOBAL sends real traffic to FALLBACK');
        } else {
          const started = Date.now();
          const stages = [];
          async function stage(expected) {
            await until(async () => (await requestThrough(mixed)) === expected, mode + ' route ' + expected);
            const chosen = await get('/proxies/GLOBAL');
            assert.ok(chosen.now.includes(expected));
            assert.ok(chosen.all.every(n => n !== 'PRIMARY' && n !== 'FALLBACK' && n !== 'DIRECT'));
            const fallbackIndex = chosen.all.findIndex(n => /^(FALLBACK-|fallback-)/.test(n));
            assert.ok(chosen.all.slice(fallbackIndex).every(n => /^(FALLBACK-|fallback-)/.test(n)), 'all primary nodes precede every fallback node');
            stages.push({ expected, elapsedMs: Date.now() - started, chosen });
          }
          await stage('P-ALIVE');
          p2.setAlive(false); await stage('F-ALIVE');
          const attempts = p2.attempts;
          await sleep(2200);
          assert.ok(p2.attempts > attempts, 'primary health checks continue while traffic uses fallback');
          p2.setAlive(true); await stage('P-ALIVE');
          evidence.scenarios.push({ mode, stages, primaryCheckedWhileFallback: true });
          console.log('PASS ' + mode + ': dead+alive PRIMARY -> all dead -> recovered; actual traffic P -> F -> P, automatic health checks only');
        }
      } finally {
        child.kill(); await new Promise(r => child.once('close', r)); fs.writeFileSync(path.join(dir, 'mihomo.log'), logs);
      }
    }
  } finally {
    for (const n of nodes) { for (const s of n.sockets) s.destroy(); n.server.close(); }
    subscriptions.close();
    fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

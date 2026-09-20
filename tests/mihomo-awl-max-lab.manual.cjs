// Manual AWL lab for the Max field symptom: provider topology, blackhole, fixed selection, restart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const yaml = require(process.env.JS_YAML_PATH);
const binary = process.env.MIHOMO_BIN;
assert.ok(binary && process.env.TEST_OUTPUT_DIR, 'Set MIHOMO_BIN, JS_YAML_PATH, TEST_OUTPUT_DIR');

const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa });
vm.runInContext(fs.readFileSync(process.env.TEST_RUNTIME_PATH || path.join(root, 'web4core.runtime.js'), 'utf8'), ctx);
const api = ctx.web4core;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
async function freePort() { const s = net.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; }
async function until(fn, label, timeoutMs = 18000) {
  const end = Date.now() + timeoutMs; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch {} await sleep(100); }
  throw Error(label + ': timeout; last=' + JSON.stringify(last));
}

async function mock(name) {
  const n = { name, mode: 'ok', sockets: new Set(), connects: 0 };
  n.server = net.createServer(socket => {
    n.connects++; n.sockets.add(socket);
    socket.on('close', () => n.sockets.delete(socket)); socket.on('error', () => {});
    let buffer = '', connected = false;
    socket.on('data', data => {
      buffer += data.toString(); let end;
      while ((end = buffer.indexOf('\r\n\r\n')) !== -1) {
        const req = buffer.slice(0, end); buffer = buffer.slice(end + 4);
        if (!connected) {
          if (!req.startsWith('CONNECT ')) { socket.destroy(); return; }
          if (n.mode === 'hang') return;
          connected = true; socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        } else {
          const head = req.startsWith('HEAD '), body = head ? '' : name;
          socket.end('HTTP/1.1 ' + (head ? '204 No Content' : '200 OK') +
            '\r\nConnection: close\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
        }
      }
    });
  });
  n.port = await listen(n.server);
  n.setMode = mode => { n.mode = mode; for (const s of [...n.sockets]) s.destroy(); };
  n.proxy = { name, type: 'http', server: '127.0.0.1', port: n.port, username: 'test', password: 'test' };
  n.destroy = () => { for (const s of n.sockets) s.destroy(); try { n.server.close(); } catch {} };
  return n;
}
function requestThrough(port, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: 'http://127.0.0.1:18080/data', agent: false }, res => {
      let text = ''; res.on('data', d => text += d); res.on('end', () => resolve(text));
    });
    req.setTimeout(timeoutMs, () => req.destroy(Error('request timeout'))); req.on('error', reject);
  });
}
async function startMihomo(config, dir, control) {
  let logs = '';
  const child = spawn(binary, ['-d', dir, '-f', config], { windowsHide: true });
  child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const apiCall = async (method, route, body) => {
    const res = await fetch('http://127.0.0.1:' + control + route, {
      method, headers: { Authorization: 'Bearer local-test', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(2500)
    });
    if (!res.ok && res.status !== 204) throw Error(method + ' ' + route + ' -> ' + res.status + ' ' + await res.text());
    return res.status === 204 ? null : res.json();
  };
  await until(async () => { try { await apiCall('GET', '/version'); return true; } catch { return false; } }, 'controller startup', 10000);
  return { api: apiCall, logs: () => logs, stop: async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(r => child.once('close', r)); }
  }};
}

(async () => {
  const out = path.resolve(process.env.TEST_OUTPUT_DIR, 'awl-max-lab');
  fs.mkdirSync(out, { recursive: true });
  const evidence = {
    version: execFileSync(binary, ['-v'], { encoding: 'utf8' }).trim(),
    binarySha256: crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
    scenarios: []
  };
  const primary = await mock('PRIMARY-MOCK'), fallback = await mock('FALLBACK-MOCK');
  const subs = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    if (req.url === '/primary') return res.end(yaml.dump({ proxies: [primary.proxy] }));
    if (req.url === '/fallback') return res.end(yaml.dump({ proxies: [fallback.proxy] }));
    res.statusCode = 204; res.end();
  });
  const subPort = await listen(subs);
  const healthUrl = 'http://127.0.0.1:' + subPort + '/health';
  const doc = yaml.load(api.buildFromRequest({
    core: 'mihomo',
    input: 'http://127.0.0.1:' + subPort + '/primary',
    fallbackInput: 'http://127.0.0.1:' + subPort + '/fallback',
    options: { webUI: false, addTun: false, mihomoSubscriptionMode: true }
  }).data);

  const g = doc['proxy-groups'][0];
  assert.equal(g.type, 'fallback'); assert.equal(g.lazy, false);
  assert.equal(g.timeout, 60000); assert.equal(g['max-failed-times'], 2); assert.equal(g.interval, 300);
  g.url = healthUrl; g.interval = 2; // lab scheduler only; keep 60s dial-failure window
  for (const p of Object.values(doc['proxy-providers'])) {
    assert.equal(p['health-check'].lazy, false); assert.equal(p['health-check'].interval, 300);
    p['health-check'].url = healthUrl; p['health-check'].interval = 2;
    // No provider timeout override: exercise Mihomo's 5s default.
  }

  const control = await freePort(), mixed = await freePort();
  doc['external-controller'] = '127.0.0.1:' + control; doc.secret = 'local-test';
  doc['mixed-port'] = mixed; doc['bind-address'] = '127.0.0.1'; doc['allow-lan'] = false; doc['log-level'] = 'debug';
  const config = path.join(out, 'config.yaml'); fs.writeFileSync(config, yaml.dump(doc));

  let inst = await startMihomo(config, out, control);
  const state = () => inst.api('GET', '/proxies/GLOBAL');
  const waitNow = re => until(async () => { const s = await state(); return re.test(s.now) ? s : false; }, 'GLOBAL now ' + re);
  try {
    const initial = await waitNow(/^PRIMARY-/);
    const pName = initial.all.find(n => /^PRIMARY-/.test(n)), fName = initial.all.find(n => /^FALLBACK-/.test(n));
    assert.ok(pName && fName); assert.equal(await requestThrough(mixed), 'PRIMARY-MOCK');

    let t = Date.now(); primary.setMode('hang');
    const autoF = await waitNow(/^FALLBACK-/); const blackholeMs = Date.now() - t;
    assert.equal(autoF.fixed, '');
    primary.setMode('ok'); t = Date.now();
    const autoP = await waitNow(/^PRIMARY-/); const recoverMs = Date.now() - t;
    evidence.scenarios.push({ name: 'provider-blackhole-auto', blackholeMs, recoverMs, now: autoP.now });

    await inst.api('PUT', '/proxies/GLOBAL', { name: fName });
    const fixedF = await state(); assert.equal(fixedF.fixed, fName); assert.equal(fixedF.now, fName);
    await sleep(4500); const stillF = await state(); assert.equal(stillF.now, fName);
    await inst.api('DELETE', '/proxies/GLOBAL');
    const afterDelete = await waitNow(/^PRIMARY-/);
    evidence.scenarios.push({ name: 'manual-fallback-fixed', fixed: fixedF.fixed, afterChecks: stillF.now, afterDelete: afterDelete.now });

    await inst.api('PUT', '/proxies/GLOBAL', { name: pName }); assert.equal((await state()).fixed, pName);
    primary.setMode('hang'); t = Date.now();
    const fixedDead = await waitNow(/^FALLBACK-/); const fixedDeadMs = Date.now() - t;
    assert.equal(fixedDead.fixed, '');
    evidence.scenarios.push({ name: 'manual-primary-blackhole', fixedDeadMs, now: fixedDead.now, fixed: fixedDead.fixed });

    primary.setMode('ok'); await waitNow(/^PRIMARY-/);
    await inst.api('PUT', '/proxies/GLOBAL', { name: fName }); assert.equal((await state()).fixed, fName);
    await inst.stop(); fs.writeFileSync(path.join(out, 'before-restart.log'), inst.logs());
    inst = await startMihomo(config, out, control);
    const restart = await state();
    if (restart.fixed) await inst.api('DELETE', '/proxies/GLOBAL');
    const post = await waitNow(/^PRIMARY-/);
    evidence.scenarios.push({ name: 'restart-selection-persistence', restartFixed: restart.fixed, restartNow: restart.now, afterDelete: post.now });

    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await inst.stop(); fs.writeFileSync(path.join(out, 'mihomo.log'), inst.logs());
    fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
    primary.destroy(); fallback.destroy(); subs.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

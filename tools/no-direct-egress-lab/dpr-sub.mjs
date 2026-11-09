// Stateful provider-payload server for the #355 DPR runtime scenario (port 8097).
// Distinct from dest.mjs's :8098 subscription server so the #338 scenarios and
// this scenario never share provider state. All synthetic, no secrets.
//   /sub-a  — provider A payload; content controlled per-request by the mode
//             file (live | dead | empty) written by dpr-provider-runtime.sh:
//             live  -> VLESS node in the lab ROOT ns (exit source 10.210.0.1)
//             dead  -> VLESS node at 192.0.2.9 (TEST-NET-1, unreachable)
//             empty -> zero-byte body (provider with no proxies)
//   /sub-b  — provider B payload; constant live node in the egress ns.
//   /hc204  — health-check endpoint answering exactly 204 (lab-stand-in for
//             the pinned gstatic generate_204 URL, reachable THROUGH nodes).
// Every request is logged to run/logs/dpr-sub.jsonl: provider fetches arrive
// from the VPS IP (service plane); health checks arrive via node exits.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';
const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_ID = process.argv[2];
if (!RUN_ID) { console.error('usage: node dpr-sub.mjs <run-id>'); process.exit(1); }
const MODE_FILE = path.join(TOOL_DIR, 'run', RUN_ID, 'sub-a.mode');
const LOGDIR = path.join(TOOL_DIR, 'run', 'logs');
fs.mkdirSync(LOGDIR, { recursive: true });
const subLog = fs.createWriteStream(`${LOGDIR}/dpr-sub.jsonl`, { flags: 'a' });
const evt = (obj) => JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n';

const NODE_A_LIVE = 'vless://a1b2c3d4-0000-4000-8000-0000000000a7@10.210.0.1:8442?security=tls&allowInsecure=1&sni=lab.local#node-a-live';
const NODE_A_DEAD = 'vless://d4d4d4d4-0000-4000-8000-000000000d34@192.0.2.9:443#node-a-dead';
const NODE_B_LIVE = 'vless://a1b2c3d4-0000-4000-8000-0000000000e2@10.211.0.2:8442?security=tls&allowInsecure=1&sni=lab.local#node-b-live';

function modeA() {
  try { return fs.readFileSync(MODE_FILE, 'utf8').trim() || 'live'; } catch { return 'live'; }
}

const SUB = http.createServer((req, res) => {
  const remote = req.socket.remoteAddress || '';
  let body = '';
  if (req.url === '/sub-a') {
    const m = modeA();
    body = m === 'live' ? NODE_A_LIVE : m === 'dead' ? NODE_A_DEAD : '';
    subLog.write(evt({ kind: 'sub', provider: 'A', mode: m, remote, url: req.url, ua: req.headers['user-agent'] || '' }));
  } else if (req.url === '/sub-b') {
    body = NODE_B_LIVE;
    subLog.write(evt({ kind: 'sub', provider: 'B', remote, url: req.url, ua: req.headers['user-agent'] || '' }));
  } else if (req.url === '/hc204') {
    subLog.write(evt({ kind: 'hc', remote, url: req.url }));
    res.writeHead(204);
    res.end();
    return;
  } else {
    subLog.write(evt({ kind: 'sub', provider: '?', remote, url: req.url }));
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain', 'subscription-userinfo': 'upload=1; download=2; total=100; expire=0' });
  res.end(body);
});
SUB.listen(8097, '0.0.0.0', () => console.log('dpr-sub :8097 ready (mode file: ' + MODE_FILE + ')'));

process.on('SIGTERM', () => process.exit(0));

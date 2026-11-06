// Lab "internet" services (root namespace):
//  - 8099  controlled destination / IP-echo ("public control endpoint").
//          Responds { egress_ip } = observed source IP — the exact observable
//          Joe Doe's IP-check endpoint would show. Every hit logged as JSONL.
//  - 8098  subscription server (provider-fetch target, service plane).
//  - 5300/udp DNS logging stub (observations only; answers 10.210.0.1).
// A request logged with source 10.210.0.3 on PORT 8099 means the user data
// plane egressed directly with the simulated VPS public IP => scenario FAIL.
import http from 'node:http';
import path from 'node:path';
import dgram from 'node:dgram';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';
const LOGDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run', 'logs');
fs.mkdirSync(LOGDIR, { recursive: true });
const logStream = (name) => fs.createWriteStream(`${LOGDIR}/${name}`, { flags: 'a' });
const destLog = logStream('dest.jsonl');
const subLog = logStream('sub.jsonl');
const dnsLog = logStream('dns.jsonl');
const evt = (obj) => JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n';

const DEST = http.createServer((req, res) => {
  // One dual-stack listener; normalize v4-mapped addresses so log formats
  // (and the leak greps) stay identical for IPv4 and IPv6 sources.
  const raw = req.socket.remoteAddress || '';
  const remote = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  destLog.write(evt({ kind: 'dest', remote, method: req.method, url: req.url, host: req.headers.host, ua: req.headers['user-agent'] || '' }));
  const body = JSON.stringify({ egress_ip: remote, url: req.url }) + '\n';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(body);
});
DEST.on('clientError', () => {});
DEST.listen(8099, '::', () => console.log('dest :8099 ready (dual-stack)'));

const SUB = http.createServer((req, res) => {
  const remote = req.socket.remoteAddress || '';
  subLog.write(evt({ kind: 'sub', remote, method: req.method, url: req.url, ua: req.headers['user-agent'] || '' }));
  const body = req.url === '/sub-dead'
    ? 'vless://d4d4d4d4-0000-4000-8000-000000000d34@192.0.2.9:443#sub-dead-upstream\n'
    : 'vless://a1b2c3d4-0000-4000-8000-0000000000e2@10.211.0.2:8442?security=tls&allowInsecure=1&sni=lab.local#sub-egress-live\n';
  res.writeHead(200, { 'content-type': 'text/plain', 'subscription-userinfo': 'upload=1; download=2; total=100; expire=0' });
  res.end(body);
});
SUB.listen(8098, '0.0.0.0', () => console.log('sub :8098 ready'));

const DNS = dgram.createSocket('udp4');
DNS.on('message', (msg, rinfo) => {
  // Log every query with its source; then answer A 10.210.0.1 for any name.
  let qname = '';
  try {
    const parts = [];
    for (let i = 12; i < msg.length;) {
      const len = msg[i];
      if (len === 0) break;
      parts.push(msg.toString('latin1', i + 1, i + 1 + len));
      i += 1 + len;
    }
    qname = parts.join('.');
  } catch {}
  dnsLog.write(evt({ kind: 'dns', remote: rinfo.address, port: rinfo.port, qname }));
  const id = msg.subarray(0, 2);
  const hdr = Buffer.from([id[0], id[1], 0x85, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
  const name = msg.subarray(12, msg.length - 5);
  const ans = Buffer.concat([
    hdr, name, Buffer.from([0, 0, 0, 1]),
    Buffer.from([0xc0, 0x0c, 0, 1, 0, 0, 0, 60, 0, 0, 0, 4, 10, 210, 0, 1]),
  ]);
  DNS.send(ans, rinfo.port, rinfo.address);
});
DNS.bind(5300, () => console.log('dns :5300 ready'));

process.on('SIGTERM', () => process.exit(0));

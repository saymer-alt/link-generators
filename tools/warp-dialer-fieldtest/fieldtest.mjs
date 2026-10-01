#!/usr/bin/env node
// fieldtest.mjs — field harness for dialer-proxy / provider-backed WARP-DIALER
// on a live Mihomo v1.19.x. Research tool for the link-generators project;
// NOT part of the generator and NOT an automatic scanner of user subscriptions:
// every state change goes through explicit modes and flags (see --help).
//
// This entry wires the pure helpers of lib.mjs to real I/O (Mihomo REST API,
// curl through the SOCKS egress, report files). All error text is redacted
// before it reaches stdout or the reports; secrets (--secret, keys, tokens)
// are never printed or stored.

import { writeFileSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  parseArgs, usage, parseTrace, redactText, classifyPasses, errorClass,
  nullDevice, parseGroupResponse, replaceMtuInProfile, buildPlan, resultsToCsv,
  resolveNodeName,
} from './lib.mjs';

const EXIT_OK = 0;
const EXIT_PARTIAL = 1;
const EXIT_CONFIG = 2;
const EXIT_UNAVAILABLE = 3;
const EXIT_RESTORE = 4;

const args = parseArgs(process.argv.slice(2), process.env);
if (args.help) {
  console.log(usage());
  process.exit(EXIT_OK);
}
if (args.errors.length) {
  for (const e of args.errors) console.error('argument error: ' + e);
  console.error('run with --help for usage');
  process.exit(EXIT_CONFIG);
}

const headers = args.secret ? { Authorization: `Bearer ${args.secret}` } : {};
const apiFetch = async (path, method, body) => {
  const res = await fetch(args.api + path, {
    method: method || 'GET', headers,
    body, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok && res.status !== 204) throw new Error(`API ${path} -> HTTP ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
};
const curl = (urlArgs, timeout) => {
  try {
    const out = execFileSync('curl', ['-sS', '--max-time', String(timeout), '-x', args.socks, ...urlArgs],
      { encoding: 'utf8', timeout: (timeout + 5) * 1000, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, out };
  } catch (e) {
    const errText = String((e.stderr && e.stderr.toString().trim()) || e.message || e).slice(0, 200);
    return { ok: false, err: errText, code: e.status };
  }
};

// pre-flight: Mihomo availability is a distinct failure class
try {
  await apiFetch('/version');
} catch (e) {
  console.error('Mihomo API unreachable at ' + args.api + ': ' + redactText(String(e.message || e)));
  process.exit(EXIT_UNAVAILABLE);
}

// Switch a select group to a node. `node` may be a user-trimmed name; it is
// resolved against the REAL names Mihomo reports (exact first, then unique
// trim-normalized; the ORIGINAL name is what gets sent to the API).
// Returns { real, selectionChanged }.
const switchTo = async (group, node) => {
  const g0 = await apiFetch(`/proxies/${encodeURIComponent(group)}`);
  const { all } = parseGroupResponse(g0);
  const real = resolveNodeName(node, all);
  await apiFetch(`/proxies/${encodeURIComponent(group)}`, 'PUT', JSON.stringify({ name: real }));
  const g = await apiFetch(`/proxies/${encodeURIComponent(group)}`);
  if (!g || g.now !== real) throw new Error(`switch not confirmed: now=${g && g.now}`);
  const selectionChanged = g.now === real;
  if (args.closeConns) {
    try { await apiFetch('/connections', 'DELETE'); } catch { /* best effort */ }
  }
  await new Promise((r) => setTimeout(r, args.settleMs));
  return { real, selectionChanged };
};

// Force a fresh WireGuard handshake by reloading the isolated test config
// (PUT /configs?force=true with the payload). This recreates every outbound,
// so the next trace goes through a NEW handshake via the currently selected
// dialer node — the only reliable way to attribute a trace to a node, because
// an established WG session kept its old transport path for >150s in the field.
// After the reload: wait for API, then re-confirm the node selection (cache
// restore may reset it); fail closed if the selection cannot be restored.
const freshReload = async (group, real) => {
  if (!args.mainConf) throw new Error('--fresh-handshake requires --main-conf (path to the isolated test config)');
  const payload = readFileSync(args.mainConf, 'utf8');
  await apiFetch('/configs?force=true', 'PUT', JSON.stringify({ payload }));
  const deadline = Date.now() + 30000;
  let up = false;
  while (Date.now() < deadline) {
    try { await apiFetch('/version'); up = true; break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!up) throw new Error('API unavailable after config reload');
  const g = await apiFetch(`/proxies/${encodeURIComponent(group)}`);
  if (!g || g.now !== real) {
    await apiFetch(`/proxies/${encodeURIComponent(group)}`, 'PUT', JSON.stringify({ name: real }));
    const g2 = await apiFetch(`/proxies/${encodeURIComponent(group)}`);
    if (!g2 || g2.now !== real) throw new Error(`selection lost after reload: now=${g2 && g2.now}`);
  }
};

const traceOnce = () => {
  const t0 = Date.now();
  const r = curl(['https://www.cloudflare.com/cdn-cgi/trace'], args.traceTimeout);
  const fields = r.ok ? parseTrace(r.out) : { ip: '', loc: '', colo: '', warp: '' };
  return { ok: r.ok, ms: Date.now() - t0, curlExit: r.ok ? null : (r.code ?? null), ...fields, err: r.ok ? '' : r.err };
};
const metaOnce = () => {
  const r = curl(['https://speed.cloudflare.com/meta'], args.traceTimeout);
  if (!r.ok) return { ok: false, err: redactText(r.err) };
  try {
    const j = JSON.parse(r.out);
    return { ok: true, ip: j.clientIp, loc: j.country, colo: j.colo, city: j.city, asOrg: j.asOrganization };
  } catch { return { ok: false, err: 'meta not JSON' }; }
};
const transferOnce = () => {
  const sink = nullDevice();
  const r = curl(['-o', sink, '-w', '{"code":%{http_code},"bytes":%{size_download},"speed":%{speed_download}}',
    'https://speed.cloudflare.com/__down?bytes=' + args.dataBytes], Math.max(30, args.traceTimeout * 2));
  if (!r.ok) return { ok: false, err: redactText(r.err) };
  try {
    const j = JSON.parse(r.out);
    return { ok: j.code === 200, bytes: j.bytes, bps: Math.round(j.speed || 0) };
  } catch { return { ok: false, err: 'transfer stat not JSON' }; }
};
let http3Supported = null;
const http3Probe = () => {
  if (http3Supported !== null) return http3Supported;
  try {
    execFileSync('curl', ['-s', '-I', '--http3', '-x', args.socks, '--max-time', String(args.traceTimeout),
      'https://cloudflare.com/cdn-cgi/trace'], { encoding: 'utf8', timeout: (args.traceTimeout + 5) * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
    http3Supported = true;
  } catch (e) {
    const m = String(e.message || '');
    http3Supported = /option|protocol|Unsupported|unknown/i.test(m) ? 'unsupported-curl' : false;
  }
  return http3Supported;
};
const groupNodes = async (group) => {
  const g = await apiFetch(`/group/${encodeURIComponent(group)}`).catch(() => null)
    || await apiFetch(`/proxies/${encodeURIComponent(group)}`);
  const { all } = parseGroupResponse(g);
  return args.nodesLimit > 0 && !args.full ? all.slice(0, args.nodesLimit) : all;
};

// One row per node, exactly the report schema (README documents the fields).
// freshness: { selectionChanged, transportFresh, pathFreshness } — three distinct
// facts: the API confirmed the new `now` vs the outbound was actually recreated
// (fresh handshake) vs whether that has been proven at all for this row.
const rowFor = (node, passes, extra) => {
  const result = classifyPasses(passes);
  const lastOk = passes.filter((p) => p.ok && p.warp === 'on').pop() || null;
  const lastSeen = passes.filter((p) => p.ok).pop() || null;
  const fails = passes.filter((p) => !p.ok);
  const fr = extra.fresh || {};
  return {
    timestamp: new Date().toISOString(),
    mode: args.mode,
    node,
    pin: args.pin,
    result,
    curl_exit: fails.length ? (fails.pop().curlExit ?? null) : null,
    elapsed_ms: null,
    ip: (lastOk || lastSeen || {}).ip || '',
    loc: (lastOk || lastSeen || {}).loc || '',
    colo: (lastOk || lastSeen || {}).colo || '',
    warp: (lastOk || lastSeen || {}).warp || '',
    selection_changed: fr.selectionChanged ?? null,
    transport_fresh: fr.transportFresh ?? null,
    path_freshness: fr.pathFreshness ?? 'unverified',
    mtu: extra.mtu || null,
    transfer_bps: extra.transfer && extra.transfer.ok ? extra.transfer.bps : null,
    http3: extra.http3 ?? null,
    error_class: errorClass(result, passes),
    error_redacted: fails.slice(0, 3).map((p) => redactText(p.err)).join(' | '),
    passes_redacted: passes.map((p) => ({ ok: p.ok, warp: p.warp, curl_exit: p.curlExit, ms: p.ms, err: p.err ? redactText(p.err) : '' })),
  };
};

const testNode = async (group, node, startedAt, mtu, fresh) => {
  const passes = [];
  for (let i = 0; i < args.passes; i++) {
    passes.push(traceOnce());
    await new Promise((r) => setTimeout(r, 1500));
  }
  const result = classifyPasses(passes);
  const row = rowFor(node, passes, {
    mtu,
    fresh,
    transfer: result === 'WARP_OK' && args.transfer ? transferOnce() : null,
    http3: result === 'WARP_OK' ? http3Probe() : null,
  });
  row.elapsed_ms = Date.now() - startedAt;
  const meta = result === 'WARP_OK' ? metaOnce() : { ok: false };
  if (meta.ok) row.notes = `city=${meta.city || ''} as=${redactText(meta.asOrg || '')}`;
  return row;
};

const rows = [];
let restoreFailed = false;
let interrupted = false;

try {
  if (args.mode === 'list') {
    if (args.pin) {
      const [pg, pn] = args.pin.split('=');
      const g = await apiFetch(`/proxies/${encodeURIComponent(pg)}`);
      console.log(`pin  : ${pg} -> ${pn} (currently now=${g && g.now}; list mode does NOT switch)`);
    }
    const nodes = await groupNodes(args.group);
    const plan = buildPlan(args, nodes);
    console.log(`group: ${plan.group} (${plan.nodes} nodes)`);
    console.log(`pin  : ${plan.pin || '(none)'}`);
    console.log(`plan : ${plan.passes} traces/node, timeout ${plan.traceTimeoutSec}s, estimated >= ${Math.round(plan.estimatedMs / 1000)}s total`);
    for (const s of plan.steps) console.log(`  - ${s.step}: ${s.detail}`);
    console.log('nodes:');
    for (const n of plan.nodeNames) console.log('  ' + n);
    process.exit(EXIT_OK);
  }

  if (args.pin) {
    const [pg, pn] = args.pin.split('=');
    await switchTo(pg, pn);
    console.error(`pinned ${pg} -> ${pn}`);
  }

  if (args.mode === 'sweep') {
    if (!args.freshHandshake) {
      console.error('WARNING: --fresh-handshake is NOT set. An established WireGuard tunnel kept its old transport path for >150s after a group switch in field tests, so per-node results are path_freshness=unverified and must not be used as node->colo proof.');
    }
    const nodes = await groupNodes(args.group);
    console.error(`group=${args.group} nodes=${nodes.length} passes=${args.passes} close=${args.closeConns}${args.full ? ' FULL' : ` limit=${args.nodesLimit}`}${args.freshHandshake ? ' fresh-handshake' : ''}`);
    for (const node of nodes) {
      process.stderr.write(`[node] ${node} ... `);
      const t0 = Date.now();
      try {
        const { real } = await switchTo(args.group, node);
        let transportFresh = false;
        if (args.freshHandshake) {
          await freshReload(args.group, real);
          transportFresh = true;
        }
        const row = await testNode(args.group, real, t0, undefined, {
          selectionChanged: true, transportFresh, pathFreshness: transportFresh ? 'fresh' : 'unverified',
        });
        rows.push(row);
        console.error(`${row.result}${row.colo ? ' colo=' + row.colo : ''}${row.path_freshness === 'unverified' ? ' [stale-path?]' : ''}`);
      } catch (e) {
        rows.push({
          timestamp: new Date().toISOString(), mode: args.mode, node, pin: args.pin,
          result: 'UNKNOWN', curl_exit: null, elapsed_ms: Date.now() - t0, ip: '', loc: '',
          colo: '', warp: '', selection_changed: false, transport_fresh: false, path_freshness: 'unverified',
          mtu: null, transfer_bps: null, http3: null,
          error_class: 'unknown', error_redacted: redactText(String(e.message || e)).slice(0, 200),
        });
        console.error('UNKNOWN (switch failed)');
      }
    }
  } else if (args.mode === 'switchtest') {
    const explicit = args.switchNodes;
    const nodes = explicit.length ? explicit : (await groupNodes(args.group)).slice(0, 2);
    if (nodes.length < 2) { console.error('switchtest needs >= 2 nodes (use --switch-nodes "A,B,A")'); process.exit(EXIT_CONFIG); }
    for (const node of nodes) {
      process.stderr.write(`[switch] ${node} ... `);
      const t0 = Date.now();
      try {
        const { real } = await switchTo(args.group, node);
        let transportFresh = false;
        if (args.freshHandshake) {
          await freshReload(args.group, real);
          transportFresh = true;
        }
        const row = await testNode(args.group, real, t0, undefined, {
          selectionChanged: true, transportFresh, pathFreshness: transportFresh ? 'fresh' : 'unverified',
        });
        rows.push(row);
        console.error(`${row.result}${row.colo ? ' colo=' + row.colo : ''}`);
      } catch (e) {
        rows.push({ timestamp: new Date().toISOString(), mode: args.mode, node, pin: args.pin, result: 'UNKNOWN', curl_exit: null, elapsed_ms: Date.now() - t0, ip: '', loc: '', colo: '', warp: '', selection_changed: false, transport_fresh: false, path_freshness: 'unverified', mtu: null, transfer_bps: null, http3: null, error_class: 'unknown', error_redacted: redactText(String(e.message || e)).slice(0, 200) });
        console.error('UNKNOWN');
      }
    }
  } else if (args.mode === 'mtusweep') {
    if (!args.mainConf || !args.profile || !args.mtus.length) {
      console.error('mtusweep requires --main-conf, --profile and --mtus');
      process.exit(EXIT_CONFIG);
    }
    copyFileSync(args.mainConf, args.mainConf + '.fieldtest.bak');
    const original = readFileSync(args.mainConf, 'utf8');
    const restore = async () => {
      try {
        writeFileSync(args.mainConf, original);
        await apiFetch('/configs?force=true', 'PUT', JSON.stringify({ payload: original }));
        console.error('config restored from ' + args.mainConf + '.fieldtest.bak');
      } catch (e) {
        restoreFailed = true;
        console.error('RESTORE FAILED: check ' + args.mainConf + '.fieldtest.bak (' + redactText(String(e.message || e)) + ')');
      }
    };
    const onInterrupt = () => { interrupted = true; console.error('\ninterrupted'); };
    process.on('SIGINT', onInterrupt);

    try {
      const allNodes = await groupNodes(args.group);
      // resolve user (possibly trimmed) candidate names to the REAL provider names
      const candidates = args.sweepNodes.length
        ? args.sweepNodes.map((n) => resolveNodeName(n, allNodes))
        : allNodes;
      const working = [];
      for (const node of candidates) {
        if (interrupted) break;
        const t0 = Date.now();
        try {
          await switchTo(args.group, node);
          const row = await testNode(args.group, node, t0, undefined, {
            selectionChanged: true, transportFresh: false, pathFreshness: 'unverified',
          });
          rows.push(row);
          if (row.result === 'WARP_OK') working.push(node);
        } catch (e) {
          rows.push({ timestamp: new Date().toISOString(), mode: args.mode, node, pin: args.pin, result: 'UNKNOWN', curl_exit: null, elapsed_ms: Date.now() - t0, ip: '', loc: '', colo: '', warp: '', selection_changed: false, transport_fresh: false, path_freshness: 'unverified', mtu: null, transfer_bps: null, http3: null, error_class: 'unknown', error_redacted: redactText(String(e.message || e)).slice(0, 200) });
        }
        const maxN = parseInt(process.env.MAX_NODES || '1', 10);
        if (working.length >= maxN) break;
      }
      for (const mtu of args.mtus) {
        if (interrupted) break;
        for (const node of working.slice(0, parseInt(process.env.MAX_NODES || '1', 10))) {
          await switchTo(args.group, node);
          writeFileSync(args.mainConf, replaceMtuInProfile(original, args.profile, mtu));
          const edited = readFileSync(args.mainConf, 'utf8');
          await apiFetch('/configs?force=true', 'PUT', JSON.stringify({ payload: edited }));
          await new Promise((r) => setTimeout(r, args.settleMs));
          process.stderr.write(`[mtu] ${mtu} node=${node} ... `);
          const t0 = Date.now();
          // the payload reload recreates every outbound: the next trace goes
          // through a FRESH handshake via the selected dialer node
          const row = await testNode(args.group, node, t0, mtu, {
            selectionChanged: true, transportFresh: true, pathFreshness: 'fresh',
          });
          rows.push(row);
          console.error(`${row.result}${row.transfer_bps ? ' ' + Math.round(row.transfer_bps / 1024) + 'KB/s' : ''}`);
        }
      }
    } finally {
      await restore();
      process.removeListener('SIGINT', onInterrupt);
    }
  } else {
    console.error('unknown mode: ' + args.mode);
    process.exit(EXIT_CONFIG);
  }
} catch (e) {
  console.error('configuration/API error: ' + redactText(String(e.message || e)));
  process.exit(EXIT_CONFIG);
}

// ---- reports: JSON is the source of truth; CSV is derived from the same rows ----
mkdirSync(args.outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(join(args.outDir, `fieldtest-${stamp}.json`), JSON.stringify({
  schema: 'warp-dialer-fieldtest/1',
  timestamp: new Date().toISOString(),
  mode: args.mode,
  group: args.group,
  pin: args.pin,
  args: { ...args, secret: args.secret ? '[set]' : '' },
  rows,
}, null, 2));

const CSV_FIELDS = ['timestamp', 'mode', 'node', 'pin', 'result', 'curl_exit', 'elapsed_ms',
  'ip', 'loc', 'colo', 'warp', 'mtu', 'transfer_bps', 'http3', 'error_class', 'error_redacted', 'notes'];
writeFileSync(join(args.outDir, `fieldtest-${stamp}.csv`), resultsToCsv(rows));

const byNode = new Map();
for (const r of rows) if (r.warp === 'on') byNode.set(r.node + (r.mtu ? '@mtu' + r.mtu : ''), `${r.colo}/${r.loc} ip=${r.ip}`);
console.log('=== colo summary ===');
for (const [n, c] of byNode) console.log(`${n} -> ${c}`);
console.log(`reports: fieldtest-${stamp}.{json,csv}`);

const tested = rows.length;
const okCount = rows.filter((r) => r.result === 'WARP_OK').length;
if (restoreFailed || interrupted) process.exit(EXIT_RESTORE);
if (okCount === tested && tested > 0) process.exit(EXIT_OK);
if (okCount > 0 || rows.some((r) => r.result === 'UNKNOWN')) process.exit(EXIT_PARTIAL);
process.exit(EXIT_PARTIAL);

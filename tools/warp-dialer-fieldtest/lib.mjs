// Pure, side-effect-free helpers of the WARP dialer field-test harness.
// Everything here is importable and unit-testable without network or Mihomo;
// fieldtest.mjs (the CLI entry) wires these to real I/O.

// Terminals of a handshake route: never treated as dialer targets.
export const DIALER_DEAD_ENDS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);

export const RESULTS = {
  MODES: ['sweep', 'switchtest', 'mtusweep', 'list'],
  CLASSES: ['WARP_OK', 'UDP_OR_DIAL_FAIL', 'TIMEOUT', 'UNSTABLE', 'UNKNOWN'],
};

// Output sink for curl body downloads. Windows curl does not accept /dev/null.
export function nullDevice(platform = process.platform) {
  return platform === 'win32' ? 'NUL' : '/dev/null';
}

// Parse a Cloudflare /cdn-cgi/trace body into its fields of interest.
export function parseTrace(text) {
  const get = (k) => {
    const m = String(text || '').match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].trim() : '';
  };
  return { ip: get('ip'), loc: get('loc'), colo: get('colo'), warp: get('warp') };
}

// Redact potentially sensitive material from error strings and free text before
// it reaches reports: query strings of URLs (subscription tokens live there),
// credential-shaped key=value pairs, and standalone base64 blobs of WARP key
// length (44 chars with padding).
export function redactText(text) {
  let s = String(text || '');
  s = s.replace(/(https?:\/\/[^\s"']+)\?[^\s"']*/gi, (m, base) => base + '?[redacted]');
  s = s.replace(/\b(token|key|password|secret|auth|apikey|api_key)\s*[=:]\s*[^\s&"']+/gi, '$1=[redacted]');
  s = s.replace(/\b[A-Za-z0-9+/]{43}=/g, '[redacted-base64]');
  return s;
}

// curl exit codes actually observed in the field (Windows curl 8.x and Linux):
//   28 — operation timed out; 7 — could not connect; 35/56 — TLS send/recv
//   failure; 5/6 — proxy resolution. Classification below uses ONLY these
//   measurable features plus the `warp` field of successful traces — never
//   OS-specific error strings.
export const CURL_EXIT_TIMEOUT = 28;
export const CURL_EXIT_CONNECT = 7;
export const CURL_EXIT_TLS = [35, 56];

// passes: [{ ok, warp, curlExit }] — consolidated verdict of one node.
// Precedence: all-WARP_OK → some-OK (UNSTABLE) → exit-28 (TIMEOUT) →
// connect/TLS failures (UDP_OR_DIAL_FAIL) → any failure (UDP_OR_DIAL_FAIL) →
// traces fine but warp never "on" (UNKNOWN — traffic proved NOT to be WARP).
export function classifyPasses(passes) {
  const list = Array.isArray(passes) ? passes : [];
  if (!list.length) return 'UNKNOWN';
  const okCount = list.filter((p) => p.ok && p.warp === 'on').length;
  if (okCount === list.length) return 'WARP_OK';
  if (okCount > 0) return 'UNSTABLE';
  if (list.some((p) => !p.ok && p.curlExit === CURL_EXIT_TIMEOUT)) return 'TIMEOUT';
  if (list.some((p => !p.ok && (p.curlExit === CURL_EXIT_CONNECT || CURL_EXIT_TLS.includes(p.curlExit))))) return 'UDP_OR_DIAL_FAIL';
  if (list.some((p) => !p.ok)) return 'UDP_OR_DIAL_FAIL';
  return 'UNKNOWN';
}

// error_class for the report: a stable enum derived from the same features.
export function errorClass(result, passes) {
  if (result === 'WARP_OK') return 'none';
  if (result === 'UNSTABLE') return 'intermittent';
  if (result === 'TIMEOUT') return 'timeout';
  if (result === 'UDP_OR_DIAL_FAIL') {
    const fails = (Array.isArray(passes) ? passes : []).filter((p) => !p.ok);
    if (fails.some((p) => p.curlExit === CURL_EXIT_CONNECT)) return 'dial';
    if (fails.some((p) => CURL_EXIT_TLS.includes(p.curlExit))) return 'tls_in_tunnel';
    return 'udp_or_dial';
  }
  return 'unknown';
}

// ---- CLI arguments: flags primary, environment fallback (documented) ----

const FLAG_ENV = {
  mode: 'MODE', group: 'GROUP', pin: 'PIN', passes: 'PASSES', 'settle-ms': 'SETTLE_MS',
  'trace-timeout': 'TRACE_TIMEOUT', 'nodes-limit': 'NODES_LIMIT', 'data-bytes': 'DATA_BYTES',
  mtus: 'MTUS', 'main-conf': 'MAIN_CONF', profile: 'PROFILE', 'sweep-nodes': 'SWEEP_NODES',
  'switch-nodes': 'SWITCH_NODES', 'out-dir': 'OUT_DIR', api: 'MIHOMO_API',
  secret: 'MIHOMO_SECRET', socks: 'SOCKS',
};

export function usage() {
  return [
    'fieldtest.mjs — field harness for dialer-proxy / provider-backed WARP-DIALER.',
    '',
    'Usage: node fieldtest.mjs [mode] [flags]',
    '',
    'Modes:',
    '  list        show group, nodes, PIN and the test plan; NO state changes (default off)',
    '  sweep       test every node of GROUP (limited by --nodes-limit unless --full)',
    '  switchtest  node A -> B -> A path-change proof (--switch-nodes "A,B,A")',
    '  mtusweep    MTU ladder on working nodes with config reload and restore',
    '',
    'Key flags (env fallback in parentheses):',
    '  --group NAME          group to sweep (GROUP, default WARP-DIALER)',
    '  --pin "GROUP=NODE"    pin egress before the sweep, e.g. "TEST-OUT=WARP-DIALED" (PIN)',
    '  --passes N            consecutive WARP_OK traces required (PASSES, default 3)',
    '  --trace-timeout S     per-trace curl timeout (TRACE_TIMEOUT, default 15)',
    '  --settle-ms MS        wait after each switch (SETTLE_MS, default 8000)',
    '  --nodes-limit N       trial limit, default 8; --full removes the limit (NODES_LIMIT)',
    '  --full                sweep ALL nodes (explicit only)',
    '  --close-conns         DELETE /connections after each switch (CLOSE_CONNS=1)',
    '  --transfer            measure DATA_BYTES HTTPS download on WARP_OK nodes (TRANSFER=1)',
    '  --data-bytes N        transfer size, default 3145728 (DATA_BYTES)',
    '  --mtus "1280,..."     MTU ladder for mtusweep (MTUS)',
    '  --main-conf FILE      mihomo config with the inline PROFILE (MAIN_CONF)',
    '  --profile NAME        wireguard profile whose mtu: line the ladder rewrites (PROFILE)',
    '  --sweep-nodes "A,B"   restrict mtusweep candidates (SWEEP_NODES)',
    '  --switch-nodes "A,B,A" legs for switchtest (SWITCH_NODES)',
    '  --api URL             external controller (MIHOMO_API, default http://127.0.0.1:9090)',
    '  --socks URL           SOCKS egress for curl (SOCKS, default socks5h://127.0.0.1:7890)',
    '  --secret TOKEN        controller bearer token, never printed (MIHOMO_SECRET)',
    '  --out-dir DIR         report directory (OUT_DIR, default .)',
    '  --dry-run             same as mode list',
    '  --help                this text',
    '',
    'Exit codes: 0 success; 1 partial failures among nodes; 2 configuration/API error;',
    '3 Mihomo unavailable; 4 interrupted or config restore failure.',
    '',
    'Reports: fieldtest-<timestamp>.json (schema in README) + derived .csv.',
    'Secrets are never printed or stored: errors are redacted before reports.',
  ].join('\n');
}

const VALUE_FLAGS = new Set(['mode', 'group', 'pin', 'passes', 'settle-ms', 'trace-timeout',
  'nodes-limit', 'data-bytes', 'mtus', 'main-conf', 'profile', 'sweep-nodes',
  'switch-nodes', 'out-dir', 'api', 'secret', 'socks']);

export function parseArgs(argv, env = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const errors = [];
  const flag = (name) => {
    const i = args.indexOf('--' + name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const has = (name) => args.includes('--' + name);
  // positional mode: first bare token that is neither a flag nor a flag value
  let positional;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (!t.startsWith('-')) { if (positional === undefined) positional = t; continue; }
    if (VALUE_FLAGS.has(t.replace(/^--?/, ''))) i++;
  }
  const val = (name, envKey, dflt) => {
    const f = flag(name);
    if (f !== undefined) return f;
    if (env[envKey] !== undefined && env[envKey] !== '') return env[envKey];
    return dflt;
  };
  const int = (raw, min, max, label) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || String(n) !== String(raw).trim() || n < min || n > max) {
      errors.push(`${label} must be an integer in [${min}, ${max}], got: ${raw}`);
      return dfltOf(label);
    }
    return n;
  };
  const ints = { PASSES: 3, SETTLE_MS: 8000, TRACE_TIMEOUT: 15, NODES_LIMIT: 8, DATA_BYTES: 3145728 };
  const dfltOf = (label) => ({ 'passes': 3, 'settle-ms': 8000, 'trace-timeout': 15, 'nodes-limit': 8, 'data-bytes': 3145728 }[label]);

  const mode = has('dry-run') ? 'list' : (positional ?? String(val('mode', 'MODE', 'sweep')));
  const help = has('help') || args.includes('-h');

  const passes = int(val('passes', 'PASSES', ints.PASSES), 1, 20, 'passes');
  const settleMs = int(val('settle-ms', 'SETTLE_MS', ints.SETTLE_MS), 0, 120000, 'settle-ms');
  const traceTimeout = int(val('trace-timeout', 'TRACE_TIMEOUT', ints.TRACE_TIMEOUT), 3, 120, 'trace-timeout');
  let nodesLimit = int(val('nodes-limit', 'NODES_LIMIT', ints.NODES_LIMIT), 0, 100000, 'nodes-limit');
  if (has('full')) nodesLimit = 0;
  const dataBytes = int(val('data-bytes', 'DATA_BYTES', ints.DATA_BYTES), 1024, 1024 * 1024 * 1024, 'data-bytes');

  const mtusRaw = val('mtus', 'MTUS', '');
  let mtus = [];
  if (mtusRaw) {
    mtus = mtusRaw.split(',').map((x) => parseInt(x.trim(), 10));
    if (mtus.some((n) => !Number.isFinite(n) || n < 576 || n > 1500)) {
      errors.push('mtus must be integers in [576, 1500], comma-separated, got: ' + mtusRaw);
      mtus = [];
    }
  }

  if (!RESULTS.MODES.includes(mode)) errors.push(`mode must be one of ${RESULTS.MODES.join(', ')}, got: ${mode}`);

  return {
    help,
    errors,
    mode,
    group: String(val('group', 'GROUP', 'WARP-DIALER')),
    pin: String(val('pin', 'PIN', '')).trim(),
    passes,
    settleMs,
    traceTimeout,
    nodesLimit,
    full: has('full'),
    closeConns: has('close-conns') || env.CLOSE_CONNS === '1',
    transfer: has('transfer') || env.TRANSFER === '1',
    dataBytes,
    mtus,
    mainConf: String(val('main-conf', 'MAIN_CONF', '')).trim(),
    profile: String(val('profile', 'PROFILE', '')).trim(),
    sweepNodes: String(val('sweep-nodes', 'SWEEP_NODES', '')).split(',').map((s) => s.trim()).filter(Boolean),
    switchNodes: String(val('switch-nodes', 'SWITCH_NODES', '')).split(',').map((s) => s.trim()).filter(Boolean),
    outDir: String(val('out-dir', 'OUT_DIR', '.')).trim() || '.',
    api: String(val('api', 'MIHOMO_API', 'http://127.0.0.1:9090')).replace(/\/+$/, ''),
    secret: String(val('secret', 'MIHOMO_SECRET', '')),
    socks: String(val('socks', 'SOCKS', 'socks5h://127.0.0.1:7890')),
  };
}

// Normalize a /proxies or /group response into { now, all }.
export function parseGroupResponse(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.all)) {
    throw new Error('unexpected group payload: missing "all" list');
  }
  const all = json.all.filter((n) => typeof n === 'string' && n && !DIALER_DEAD_ENDS.has(n));
  return { now: typeof json.now === 'string' ? json.now : '', all };
}

// Rewrite the `mtu:` line inside one named proxy block of a mihomo config.
// Throws when the profile or its mtu line is absent — callers must restore
// the original text on any failure.
export function replaceMtuInProfile(configText, profile, mtu) {
  const lines = String(configText).split('\n');
  const start = lines.findIndex((l) => l.trim().replace(/^- /, '') === `name: ${profile}`);
  if (start === -1) throw new Error(`profile "${profile}" not found in config`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*-\s+name:/.test(lines[i])) { end = i; break; }
  }
  let replaced = false;
  for (let i = start; i < end; i++) {
    if (/^\s*mtu:\s*\d+\s*$/.test(lines[i])) {
      lines[i] = lines[i].replace(/\d+/, String(mtu));
      replaced = true;
      break;
    }
  }
  if (!replaced) throw new Error(`profile "${profile}" has no mtu: line`);
  return lines.join('\n');
}

// Dry-run plan: what a sweep WOULD do, with a conservative time estimate.
export function buildPlan(args, nodes) {
  const perNodeMs = args.settleMs + args.passes * (args.traceTimeout * 1000 + 1500);
  const steps = [
    { step: 'pin', detail: args.pin || '(no pin — node-direct measurement; see README "PIN trap")' },
    { step: 'switch+verify', detail: `PUT /proxies/${args.group} per node, confirm now` },
    { step: 'probe', detail: `${args.passes} traces per node, each <= ${args.traceTimeout}s, warp=on required` },
    { step: 'report', detail: 'JSON + derived CSV, redacted' },
  ];
  return {
    group: args.group,
    pin: args.pin,
    nodes: nodes.length,
    nodeNames: nodes,
    passes: args.passes,
    traceTimeoutSec: args.traceTimeout,
    estimatedMs: nodes.length * perNodeMs,
    steps,
  };
}

// CSV is a derived view of the same row objects the JSON report stores — never
// a separate data path. Fields in schema order; RFC-style quoting.
export const CSV_FIELDS = ['timestamp', 'mode', 'node', 'pin', 'result', 'curl_exit', 'elapsed_ms',
  'ip', 'loc', 'colo', 'warp', 'mtu', 'transfer_bps', 'http3', 'error_class', 'error_redacted', 'notes'];

export function resultsToCsv(rows) {
  const line = (vals) => vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  const out = [line(CSV_FIELDS)];
  for (const r of Array.isArray(rows) ? rows : []) out.push(line(CSV_FIELDS.map((f) => r[f])));
  return out.join('\n') + '\n';
}

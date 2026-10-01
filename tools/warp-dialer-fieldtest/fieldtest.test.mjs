// Offline unit tests of the field-test harness helpers: argument parsing,
// redaction, classification, trace parsing, JSON->CSV derivation, null device
// selection, config MTU restore editing, plan building, and mock Mihomo API
// response normalization. NO network, NO Mihomo, NO secrets — safe for CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveNodeName,
  nullDevice, parseTrace, redactText, classifyPasses, errorClass,
  parseArgs, usage, parseGroupResponse, replaceMtuInProfile, buildPlan,
  resultsToCsv,
} from './lib.mjs';

// ---- null device ----
test('nullDevice: windows NUL, everything else /dev/null', () => {
  assert.equal(nullDevice('win32'), 'NUL');
  assert.equal(nullDevice('linux'), '/dev/null');
  assert.equal(nullDevice('darwin'), '/dev/null');
});

// ---- trace parsing ----
test('parseTrace: cdn-cgi/trace fields extracted, missing fields empty', () => {
  const body = [
    'fl=1a2b', 'h=www.cloudflare.com', 'ip=203.0.113.7', 'ts=1700000000.1',
    'visit_scheme=https', 'uag=curl', 'colo=FRA', 'sliver=none',
    'http=http/2', 'loc=DE', 'tls=TLSv1.3', 'warp=on',
  ].join('\n');
  const t = parseTrace(body);
  assert.deepEqual(t, { ip: '203.0.113.7', loc: 'DE', colo: 'FRA', warp: 'on' });
  assert.deepEqual(parseTrace('nothing=here'), { ip: '', loc: '', colo: '', warp: '' });
});

// ---- redaction ----
test('redactText: URL query strings and credential pairs are redacted', () => {
  const out = redactText('fetch failed for https://sub.example.com/api/list?token=SECRET1&x=1 (see key=ABC123)');
  assert.ok(!out.includes('SECRET1'));
  assert.ok(!out.includes('ABC123'));
  assert.ok(out.includes('https://sub.example.com/api/list?[redacted]'));
  assert.ok(out.includes('key=[redacted]'));
});
test('redactText: 44-char padded base64 (WARP key length) is redacted', () => {
  const key = Buffer.alloc(32, 9).toString('base64');
  const out = redactText('decode private key: illegal base64 data at input byte 44 in ' + key);
  assert.ok(!out.includes(key));
  assert.ok(out.includes('[redacted-base64]'));
});
test('redactText: plain diagnostics pass through unchanged', () => {
  const s = 'dial tcp 203.0.113.5:443: i/o timeout';
  assert.equal(redactText(s), s);
});

// ---- classification: measurable features only (curl exit codes, warp field) ----
const p = (over = {}) => ({ ok: true, warp: 'on', curlExit: null, ...over });

test('classifyPasses: all warp=on passes -> WARP_OK', () => {
  assert.equal(classifyPasses([p(), p(), p()]), 'WARP_OK');
});
test('classifyPasses: some pass, some fail -> UNSTABLE', () => {
  assert.equal(classifyPasses([p(), p({ ok: false, warp: '', curlExit: 28 })]), 'UNSTABLE');
});
test('classifyPasses: curl exit 28 -> TIMEOUT (feature-based, not error text)', () => {
  assert.equal(classifyPasses([p({ ok: false, warp: '', curlExit: 28 })]), 'TIMEOUT');
});
test('classifyPasses: curl exit 7/35 -> UDP_OR_DIAL_FAIL', () => {
  assert.equal(classifyPasses([p({ ok: false, warp: '', curlExit: 7 })]), 'UDP_OR_DIAL_FAIL');
  assert.equal(classifyPasses([p({ ok: false, warp: '', curlExit: 35 })]), 'UDP_OR_DIAL_FAIL');
});
test('classifyPasses: traces fine but warp never on -> UNKNOWN', () => {
  assert.equal(classifyPasses([p({ warp: 'off' }), p({ warp: 'off' })]), 'UNKNOWN');
});
test('classifyPasses: empty -> UNKNOWN; errorClass mapping is stable', () => {
  assert.equal(classifyPasses([]), 'UNKNOWN');
  assert.equal(errorClass('WARP_OK', [p()]), 'none');
  assert.equal(errorClass('TIMEOUT', [p({ ok: false, curlExit: 28 })]), 'timeout');
  assert.equal(errorClass('UDP_OR_DIAL_FAIL', [p({ ok: false, curlExit: 7 })]), 'dial');
  assert.equal(errorClass('UNSTABLE', []), 'intermittent');
  assert.equal(errorClass('UNKNOWN', []), 'unknown');
});

// ---- argument parsing ----
test('parseArgs: documented defaults', () => {
  const a = parseArgs([], {});
  assert.equal(a.mode, 'sweep');
  assert.equal(a.group, 'WARP-DIALER');
  assert.equal(a.passes, 3);
  assert.equal(a.settleMs, 8000);
  assert.equal(a.traceTimeout, 15);
  assert.equal(a.nodesLimit, 8);
  assert.equal(a.full, false);
  assert.equal(a.api, 'http://127.0.0.1:9090');
  // regression: kebab-case lookup on the UPPERCASE defaults map once produced
  // spurious "must be an integer, got: undefined" argument errors
  assert.deepEqual(a.errors, []);
});
test('parseArgs: flags override env; --full removes the limit; --dry-run switches mode', () => {
  const a = parseArgs(['--group', 'TEST-OUT', '--full', '--dry-run', '--pin', 'TEST-OUT=WARP-DIALED'],
    { NODES_LIMIT: '4', GROUP: 'IGNORED' });
  assert.equal(a.group, 'TEST-OUT');
  assert.equal(a.full, true);
  assert.equal(a.nodesLimit, 0);
  assert.equal(a.mode, 'list');
  assert.equal(a.pin, 'TEST-OUT=WARP-DIALED');
});
test('parseArgs: env fallback applies when flag absent', () => {
  const a = parseArgs([], { PASSES: '5', MIHOMO_API: 'http://127.0.0.1:9095/', SOCKS: 'socks5h://127.0.0.1:7896' });
  assert.equal(a.passes, 5);
  assert.equal(a.api, 'http://127.0.0.1:9095');
  assert.equal(a.socks, 'socks5h://127.0.0.1:7896');
});
test('parseArgs: invalid values are collected, not thrown', () => {
  const a = parseArgs(['--mode', 'explode', '--passes', '999', '--mtus', '10,abc'], {});
  assert.ok(a.errors.length >= 3);
  assert.equal(a.mode, 'explode');
  assert.deepEqual(a.mtus, []);
});
test('parseArgs: positional mode (list/sweep) and flag-value boundaries', () => {
  assert.equal(parseArgs(['list', '--api', 'http://x'], {}).mode, 'list');
  assert.equal(parseArgs(['--group', 'X', 'sweep'], {}).mode, 'sweep');
  assert.equal(parseArgs(['--pin', 'TEST-OUT=WARP-DIALED', 'list'], {}).mode, 'list');
  // a bare token that is not a mode is still accepted here and rejected by mode validation
  assert.ok(parseArgs(['weird'], {}).errors.length === 1);
});

test('usage: mentions modes, PIN and exit codes', () => {
  const u = usage();
  for (const needle of ['sweep', 'switchtest', 'mtusweep', 'list', '--pin', 'Exit codes']) {
    assert.ok(u.includes(needle), 'usage missing: ' + needle);
  }
});

// ---- mock Mihomo API responses ----
test('parseGroupResponse: normalizes group payloads, drops dead ends', () => {
  const { now, all } = parseGroupResponse({
    now: 'WARP-A', all: ['WARP-A', 'WARP-B', 'WARP-DIALER', 'DIRECT', 'REJECT', ''],
  });
  assert.equal(now, 'WARP-A');
  assert.deepEqual(all, ['WARP-A', 'WARP-B', 'WARP-DIALER']);
});
test('parseGroupResponse: throws on malformed payload', () => {
  assert.throws(() => parseGroupResponse({ message: 'Not Found' }), /missing "all"/);
  assert.throws(() => parseGroupResponse(null), /missing "all"/);
});

// ---- config MTU editing (restore source of truth) ----
const CFG = [
  'mixed-port: 7890',
  'proxies:',
  '  - name: WARP-A',
  '    type: wireguard',
  '    server: 162.159.198.2',
  '    port: 2408',
  '    mtu: 1280',
  '  - name: WARP-B',
  '    type: wireguard',
  '    server: 162.159.198.1',
  '    port: 2408',
  '    mtu: 1408',
].join('\n');
test('replaceMtuInProfile: edits only the named block', () => {
  const out = replaceMtuInProfile(CFG, 'WARP-A', 1200);
  assert.ok(out.includes('mtu: 1200'));
  assert.ok(out.includes('mtu: 1408'), 'other profile untouched');
  const lines = out.split('\n');
  assert.equal(lines[lines.indexOf('    mtu: 1200') + 1], '  - name: WARP-B', 'mtu is the last line of the block');
});
test('replaceMtuInProfile: missing profile or mtu line throws (restore path)', () => {
  assert.throws(() => replaceMtuInProfile(CFG, 'NOPE', 1200), /not found/);
  assert.throws(() => replaceMtuInProfile('proxies:\n  - name: X\n    type: ss', 'X', 1200), /no mtu: line/);
});

// ---- dry-run plan ----
test('buildPlan: counts nodes and estimates time conservatively', () => {
  const args = parseArgs(['--passes', '3', '--settle-ms', '8000', '--trace-timeout', '15'], {});
  const plan = buildPlan(args, ['N1', 'N2', 'N3', 'N4']);
  assert.equal(plan.nodes, 4);
  assert.equal(plan.passes, 3);
  assert.equal(plan.estimatedMs, 4 * (8000 + 3 * (15000 + 1500)));
  assert.ok(plan.steps.some((s) => s.step === 'pin'));
});

// ---- CSV derivation ----
test('resultsToCsv: header order, quoting, derived from the same rows', () => {
  const rows = [
    {
      timestamp: '2026-10-01T00:00:00.000Z', mode: 'sweep', node: 'N"1", 🚀', pin: '',
      result: 'WARP_OK', curl_exit: null, elapsed_ms: 5323, ip: '203.0.113.9',
      loc: 'NL', colo: 'AMS', warp: 'on', mtu: 1280, transfer_bps: 3400000,
      http3: 'unsupported-curl', error_class: 'none', error_redacted: '', notes: 'x',
    },
  ];
  const csv = resultsToCsv(rows);
  const lines = csv.split('\n');
  assert.equal(lines[0], '"timestamp","mode","node","pin","result","curl_exit","elapsed_ms","ip","loc","colo","warp","selection_changed","transport_fresh","path_freshness","mtu","transfer_bps","http3","error_class","error_redacted","notes"');
  assert.ok(lines[1].startsWith('"2026-10-01T00:00:00.000Z","sweep","N""1"", 🚀",'));
  assert.ok(lines[1].includes('"3400000"'));
  assert.equal(lines[2], '');
});

// ---- exact provider node names: resolveNodeName (field defect #1) ----

const GEO_NODES = [' 🇩🇪 ⚡ Германия ', '🇩🇪 Hysteria 2 | Германия', '🇩🇪 Германия Torrent ', '🇳🇱 ⚡ Нидерланды'];

test('resolveNodeName: exact name without spaces wins as-is', () => {
  assert.equal(resolveNodeName('🇩🇪 Hysteria 2 | Германия', GEO_NODES), '🇩🇪 Hysteria 2 | Германия');
});
test('resolveNodeName: leading-space provider name resolved from trimmed request', () => {
  assert.equal(resolveNodeName('🇩🇪 ⚡ Германия', GEO_NODES), ' 🇩🇪 ⚡ Германия ');
});
test('resolveNodeName: trailing-space provider name resolved from trimmed request', () => {
  assert.equal(resolveNodeName('🇩🇪 Германия Torrent', GEO_NODES), '🇩🇪 Германия Torrent ');
});
test('resolveNodeName: unique normalized match returns the ORIGINAL name', () => {
  assert.equal(resolveNodeName(' 🇳🇱 ⚡ Нидерланды ', GEO_NODES), '🇳🇱 ⚡ Нидерланды');
});
test('resolveNodeName: ambiguous normalized match fails closed', () => {
  const dup = ['Alpha ', ' Alpha'];
  // request 'Alpha' has NO exact match, but both entries trim to 'Alpha'
  assert.throws(() => resolveNodeName('Alpha', dup), /ambiguous after trim/);
});
test('resolveNodeName: unknown name fails closed with node count', () => {
  assert.throws(() => resolveNodeName('GHOST', GEO_NODES), /not found among 4/);
});
test('resolveNodeName: empty request fails closed', () => {
  assert.throws(() => resolveNodeName('  ', GEO_NODES), /empty node name/);
});

// ---- fresh-handshake flag ----
test('parseArgs: --fresh-handshake and FRESH_HANDSHAKE=1 both enable the flag', () => {
  assert.equal(parseArgs(['--fresh-handshake'], {}).freshHandshake, true);
  assert.equal(parseArgs([], { FRESH_HANDSHAKE: '1' }).freshHandshake, true);
  assert.equal(parseArgs([], {}).freshHandshake, false);
});

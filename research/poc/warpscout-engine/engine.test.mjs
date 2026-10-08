// Тесты WARPSCOUT Observation Engine PoC — офлайн, синтетика, node --test.
// План из docs/research/future/WARPSCOUT-REVALIDATION.md §8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateObservation, aggregate, freshness, dedup, maskForPublication,
  observationFingerprint
} from './engine.mjs';

let seq = 0;
const obs = (over = {}) => Object.assign({
  $schema: 'warpscout-observation-v1',
  observationId: 'obs-20261008-' + (++seq),
  profileRef: 'profile-a',
  transport: 'wg',
  endpoint: { host: '198.51.100.10', port: 443 },
  checkedAt: '2026-10-08T20:00:00Z',
  levels: {
    reachable: { status: 'PASS', latencyMs: 12 },
    tunnel: { status: 'PASS', handshakeAgeSec: 42 },
    exit: { status: 'PASS', country: 'SE', colo: 'ARN', egressIp: '203.0.113.7' },
    service: { status: 'PASS', target: 'ref-gen-check', httpStatus: 204 },
    sni: { status: 'PASS' }
  },
  source: 'warpscout-scan'
}, over);

const profile = {
  profileRef: 'profile-a',
  transport: 'wg',
  endpoint: { host: '198.51.100.10', port: 443 },
  keyFingerprint: 'k1'
};

test('§8.1 валидная observation проходит и агрегируется в PASS', () => {
  const o = obs();
  assert.deepEqual(validateObservation(o), []);
  assert.equal(aggregate(o).state, 'PASS');
});

test('§8.2 L2 FAIL + остальные PASS → FAIL «tunnel not established»', () => {
  const o = obs({ levels: { reachable: { status: 'PASS' }, tunnel: { status: 'FAIL' }, exit: { status: 'UNKNOWN' }, service: { status: 'PASS' }, sni: { status: 'PASS' } } });
  // L3 UNKNOWN → UNKNOWN доминирует (проверка §8.3 в этом же кейсе)
  assert.equal(aggregate(o).state, 'UNKNOWN');
  const o2 = obs({ levels: { reachable: { status: 'PASS' }, tunnel: { status: 'FAIL' }, exit: { status: 'PASS', country: 'SE' }, service: { status: 'PASS' }, sni: { status: 'PASS' } } });
  const agg = aggregate(o2);
  assert.equal(agg.state, 'FAIL');
  assert.ok(agg.reasons[0].includes('tunnel'), 'причина — туннель');
  assert.ok(!agg.reasons.some(r => r.includes('endpoint мёртв') || r.includes('unreachable')));
});

test('§8.3 любой уровень UNKNOWN → aggregate UNKNOWN', () => {
  const o = obs({ levels: Object.assign(obs().levels, { exit: { status: 'UNKNOWN' } }) });
  const agg = aggregate(o);
  assert.equal(agg.state, 'UNKNOWN');
  assert.ok(agg.reasons[0].includes('exit'));
});

test('§6 «endpoint мёртв» только при L1 FAIL; L4 FAIL не значит endpoint dead', () => {
  const l1 = aggregate(obs({ levels: Object.assign(obs().levels, { reachable: { status: 'FAIL', latencyMs: 0 } }) }));
  assert.equal(l1.state, 'FAIL');
  assert.ok(l1.reasons[0].includes('endpoint unreachable'));
  const l4 = aggregate(obs({ levels: Object.assign(obs().levels, { service: { status: 'FAIL', target: 'ref' } }) }));
  assert.ok(!l4.reasons.some(r => r.includes('endpoint unreachable')));
});

test('§8.4 смена endpoint/key/transport → STALE (структурно, не по возрасту)', () => {
  const o = obs({ profileFingerprint: 'k1' });
  assert.equal(freshness([o], profile, { now: '2026-11-08T20:00:00Z' })[0].reviewDue, true, 'старое наблюдение → reviewDue');
  const staleEndpoint = freshness([o], Object.assign({}, profile, { endpoint: { host: '198.51.100.11', port: 443 } }));
  assert.equal(staleEndpoint[0].state, 'STALE');
  const staleKey = freshness([o], Object.assign({}, profile, { keyFingerprint: 'k2' }));
  assert.equal(staleKey[0].state, 'STALE');
  const staleTransport = freshness([o], Object.assign({}, profile, { transport: 'masque-h3' }));
  assert.equal(staleTransport[0].state, 'STALE');
});

test('§4 review-interval — напоминание, НЕ деградация статуса', () => {
  const o = obs({ checkedAt: '2026-09-01T20:00:00Z', profileFingerprint: 'k1' });
  const f = freshness([o], profile, { now: '2026-10-08T20:00:00Z' })[0];
  assert.equal(f.state, 'PASS', 'статус не деградирует от возраста');
  assert.equal(f.reviewDue, true);
});

test('§8.5 дедупликация: одинаковые ключ за минуту → одна запись (последняя)', () => {
  const a = obs({ checkedAt: '2026-10-08T20:00:10Z' });
  const b = obs({ checkedAt: '2026-10-08T20:00:50Z', levels: Object.assign(obs().levels, { sni: { status: 'PASS' } }) });
  const c = obs({ checkedAt: '2026-10-08T20:01:00Z' });
  const out = dedup([a, b, c]);
  assert.equal(out.length, 2);
  assert.equal(out[0].observationId, b.observationId, 'в батче остаётся последняя');
  assert.equal(out[1].observationId, c.observationId, 'следующая минута — отдельная запись');
});

test('§8.6 маскирование для публикации: egressIp всегда, key/token-поля всегда', () => {
  const o = obs();
  o.tunnelKeyRef = 'k1';
  const m = maskForPublication(o);
  assert.equal(m.levels.exit.egressIp, '***MASKED***');
  assert.equal(m.levels.exit.country, 'SE', 'country не маскируется');
  assert.equal(m.levels.exit.colo, 'ARN', 'colo не маскируется');
  assert.equal(m.tunnelKeyRef, '***MASKED***');
  assert.equal(o.levels.exit.egressIp, '203.0.113.7', 'оригинал не мутируется');
});

test('§8.7 транспорты не смешиваются: fingerprints разные', () => {
  const wg = observationFingerprint(Object.assign({}, profile, { transport: 'wg' }));
  const h3 = observationFingerprint(Object.assign({}, profile, { transport: 'masque-h3' }));
  assert.notEqual(wg, h3);
});

test('мусорные наблюдения: INVALID, не падение', () => {
  assert.ok(validateObservation(null).length > 0);
  assert.ok(validateObservation({}).length > 0);
  const bad = obs(); bad.levels.exit.status = 'FAIL';
  assert.ok(validateObservation(bad).some(e => e.includes('exit')), 'exit FAIL отвергается схемой');
  assert.equal(aggregate(bad).state, 'INVALID');
});

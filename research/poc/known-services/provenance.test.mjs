// Тесты Known-Services Provenance PoC — офлайн, синтетика, node --test.
// План из docs/research/future/KNOWN-SERVICES-PROVENANCE.md §6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEntry, enforceConfidence, lookup, merge, isReviewDue,
  normalizeDomain, normalizeCidr
} from './provenance.mjs';

let seq = 0;
const entry = (over = {}) => Object.assign({
  entryId: 'ks-' + (++seq),
  kind: 'domain',
  value: 'service.example',
  service: 'Пример-сервис',
  category: 'ai',
  provenance: { source: 'manual:owner', observedAt: '2026-10-08', confidence: 'SOURCE-VERIFIED' },
  freshness: { reviewIntervalDays: 180, reviewDue: '2027-04-07' }
}, over);

test('§6.1 валидная запись проходит', () => {
  assert.deepEqual(validateEntry(entry()), []);
});

test('§6.2 конфликт SOURCE-VERIFIED vs COMMUNITY — обе записи видны', () => {
  const strong = entry();
  const weak = entry({ entryId: 'ks-weak', provenance: { source: 'community:list@abc', observedAt: '2026-10-01', confidence: 'COMMUNITY' } });
  const { entries, conflicts } = merge([strong], [weak]);
  assert.equal(entries.length, 1, 'слабая не перезаписывает сильную');
  assert.equal(entries[0].entryId, strong.entryId);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].rejected.entryId, 'ks-weak', 'отклонённая запись видна');
});

test('§6.2 наоборот: SOURCE-VERIFIED заменяет COMMUNITY — и это НЕ молчаливая замена', () => {
  const weak = entry({ entryId: 'ks-weak', provenance: { source: 'community', observedAt: '2026-10-01', confidence: 'COMMUNITY' } });
  const strong = entry({ provenance: { source: 'github:meta@sha', observedAt: '2026-10-08', confidence: 'SOURCE-VERIFIED' } });
  const { entries, conflicts } = merge([weak], [strong]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].provenance.confidence, 'SOURCE-VERIFIED');
  assert.equal(conflicts.length, 1, 'замена зарегистрирована');
  assert.equal(conflicts[0].rejected.entryId, weak.entryId);
});

test('§6.3 запись без observedAt → HEURISTIC принудительно', () => {
  const e = entry({ provenance: { source: 'manual', confidence: 'SOURCE-VERIFIED' } });
  assert.ok(validateEntry(e).length === 0, 'observedAt отсутствует — не ошибка валидации');
  const enforced = enforceConfidence(e);
  assert.equal(enforced.provenance.confidence, 'HEURISTIC');
});

test('§6.4 review-due просрочен → пометка, запись не удаляется', () => {
  const e = entry({ freshness: { reviewIntervalDays: 7, reviewDue: '2026-10-01' } });
  assert.equal(isReviewDue(e, { today: '2026-10-08' }), true);
  assert.ok(validateEntry(e).length === 0, 'просроченная запись валидна (не удаляется)');
  assert.equal(isReviewDue(e, { today: '2026-09-30' }), false);
  assert.equal(isReviewDue(entry()), false, 'нет reviewDue → false');
});

test('§6.5 нормализация домена: регистр/хвостовая точка/punycode', () => {
  assert.equal(normalizeDomain('EXAMPLE.com.'), 'example.com');
  assert.equal(normalizeDomain('пример.испытание'), 'xn--e1afmkfd.xn--80akhbyknj4f');
  assert.equal(normalizeDomain('bad host'), null);
  assert.equal(normalizeDomain(''), null);
});

test('§6.6 CIDR-нормализация и проверка маски', () => {
  assert.equal(normalizeCidr('192.0.2.0/24'), '192.0.2.0/24');
  assert.equal(normalizeCidr('192.0.2.1/24'), null, 'хостовые биты не чисты → null');
  assert.equal(normalizeCidr('192.0.2.0/33'), null);
  const cidrEntry = entry({ kind: 'ip-cidr', value: '192.0.2.0/24' });
  assert.deepEqual(validateEntry(cidrEntry), []);
  const hit = lookup([cidrEntry], '192.0.2.77');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].match, 'cidr');
  assert.equal(lookup([cidrEntry], '192.0.3.1').length, 0);
});

test('lookup: exact/suffix/keyword-матчи и сортировка по confidence', () => {
  const db = [
    entry({ entryId: 'ks-exact', kind: 'domain', value: 'api.service.example', provenance: { source: 's1', observedAt: '2026-10-08', confidence: 'COMMUNITY' } }),
    entry({ entryId: 'ks-suffix', kind: 'domain-suffix', value: 'service.example', provenance: { source: 's2', observedAt: '2026-10-08', confidence: 'SOURCE-VERIFIED' } }),
    entry({ entryId: 'ks-kw', kind: 'domain-keyword', value: 'service', provenance: { source: 's3', observedAt: '2026-10-08', confidence: 'HEURISTIC' } })
  ];
  const hits = lookup(db, 'API.Service.Example.');
  assert.equal(hits.length, 3);
  assert.equal(hits[0].entry.entryId, 'ks-suffix', 'SOURCE-VERIFIED раньше остальных');
  assert.ok(hits.some(h => h.match === 'exact'));
  assert.ok(hits.some(h => h.match === 'suffix'));
  assert.ok(hits.some(h => h.match === 'keyword'));
});

test('битые записи не участвуют в lookup и merge, ошибки — с осмысленным текстом', () => {
  assert.ok(validateEntry(null).length > 0);
  assert.ok(validateEntry({ kind: 'nope', value: '' }).some(e => e.includes('kind')));
  const db = [entry(), entry({ kind: 'nope' })];
  assert.equal(lookup(db, 'service.example').length, 1);
  const { entries } = merge([entry()], [{ kind: 'nope', value: 'x' }]);
  assert.equal(entries.length, 1);
});

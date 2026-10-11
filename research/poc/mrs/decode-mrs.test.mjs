// Тесты MRS decode PoC (NIGHT-MEGA-01 B2) — офлайн, node --test.
// Ключевая эмпирика: фикстуры созданы ОФИЦИАЛЬНЫМ бинарником mihomo v1.19.31
// (convert-ruleset) и декомпрессированы zstd v1.5.6; см. fixtures/PROVENANCE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseMrsContainer, readDomainSetBin, has, foreach,
  buildDomainSet, domainSetWriteBin, insertKeys
} from './decode-mrs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = name => readFileSync(path.join(here, 'fixtures', name));

const DOMAINS = readFileSync(path.join(here, 'fixtures', 'domains.list'), 'utf8')
  .split(/\r?\n/).filter(Boolean);

test('реальный domain-MRS: заголовок behavior=0(domain), count=7, extra пуст', () => {
  const mrs = parseMrsContainer(fx('synthetic.inner'));
  assert.equal(mrs.behavior, 'domain');
  assert.equal(mrs.behaviorByte, 0);
  assert.equal(mrs.count, DOMAINS.length);
  assert.equal(mrs.extra.length, 0);
});

test('реальный ipcidr-MRS: behavior byte=1 (enum domain=0, ipcidr=1 — эмпирика)', () => {
  const mrs = parseMrsContainer(fx('synthetic-ip.inner'));
  assert.equal(mrs.behavior, 'ipcidr');
  assert.equal(mrs.behaviorByte, 1);
  assert.equal(mrs.count, 4);
});

test('DomainSet читается, payload исчерпывается ровно', () => {
  const mrs = parseMrsContainer(fx('synthetic.inner'));
  const { set, end } = readDomainSetBin(mrs.payload);
  assert.equal(end, mrs.payload.length, 'за DomainSet не должно быть хвоста (domain: без values)');
  assert.ok(set.labels.length > 0);
});

test('членство: все домены списка находятся, негативные контролы — нет', () => {
  const { set } = readDomainSetBin(parseMrsContainer(fx('synthetic.inner')).payload);
  for (const d of DOMAINS) assert.equal(has(set, d), true, 'positive: ' + d);
  for (const neg of ['example.org', 'notgoogle.com', 'googlex.com', 'youtube.com', 'sub.githubusercontent.com']) {
    assert.equal(has(set, neg), false, 'negative: ' + neg);
  }
});

test('wildcard-семантика: +.google.com → поддомены и сам домен; *.openai.com → ровно один label', () => {
  const { set } = readDomainSetBin(parseMrsContainer(fx('synthetic.inner')).payload);
  assert.equal(has(set, 'a.google.com'), true, '+. → поддомен');
  assert.equal(has(set, 'google.com'), true, '+. → сам домен (вторая вставка)');
  assert.equal(has(set, 'a.b.openai.com'), false, '* → только ОДИН label');
  assert.equal(has(set, 'openai.com'), false, '* → сам домен не матчится');
  assert.equal(has(set, 'chat.openai.com'), true, '* → один label');
});

test('регистр и точное совпадение: EXAMPLE.COM находит, префикс-ловушка нет', () => {
  const { set } = readDomainSetBin(parseMrsContainer(fx('synthetic.inner')).payload);
  assert.equal(has(set, 'EXAMPLE.COM'), true);
  assert.equal(has(set, 'GitHub.COM'), true);
  assert.equal(has(set, 'example.co'), false);
});

test('foreach возвращает паттерны списка (+. → ведущая точка, как в Go Foreach)', () => {
  const { set } = readDomainSetBin(parseMrsContainer(fx('synthetic.inner')).payload);
  const patterns = foreach(set).sort();
  // "+.google.com" даёт ОБЕ вставки: точную "google.com" (parts[1:]) и
  // суффиксную ".google.com" (хвостовая точка реверсированного ключа).
  const expected = ['*.openai.com', 'cloudflare-dns.com', 'dns.google', 'github.com', '.google.com', 'google.com', 'example.com', 'www.youtube.com'].sort();
  assert.deepEqual(patterns, expected);
});

test('JS-порт builder воспроизводит байты официального бинарника bit-for-bit', () => {
  const mrs = parseMrsContainer(fx('synthetic.inner'));
  const keys = DOMAINS.flatMap(insertKeys);
  const mine = domainSetWriteBin(buildDomainSet(keys));
  assert.ok(mine.equals(mrs.payload), 'serialized DomainSet != official payload (' + mine.length + ' vs ' + mrs.payload.length + ' bytes)');
});

test('синтетический round-trip: builder → ReadBin → has', () => {
  const keys = ['moc.elgoog.www', 'moc.buhtig', 'moc.elpmaxe'].sort();
  const ds = buildDomainSet(keys);
  const bin = domainSetWriteBin(ds);
  const { set } = readDomainSetBin(bin);
  assert.equal(has(set, 'www.google.com'), true);
  assert.equal(has(set, 'github.com'), true);
  assert.equal(has(set, 'example.com'), true);
  assert.equal(has(set, 'gitlab.com'), false);
});

test('мусорные контейнеры отвергаются с осмысленными ошибками', () => {
  assert.throws(() => parseMrsContainer(Buffer.from('NOPE')), /too small/);
  assert.throws(() => parseMrsContainer(Buffer.alloc(21, 0x41)), /MrsMagic/);
  const mrs = parseMrsContainer(fx('synthetic.inner'));
  const bad = Buffer.from(mrs.payload); bad[0] = 9;
  assert.throws(() => readDomainSetBin(bad), /version/);
});

// MRS inspect PoC (NIGHT-FUTURE-01) — автономный исследовательский скрипт.
// НЕ production-код: не подключён к генератору/CI.
//
// Проверяет контейнерный формат MRSv1 по SOURCE-PROVEN раскладке
// (rules/provider/mrs_reader.go, MetaCubeX/mihomo v1.19.32):
//   [zstd stream] → 'M','R','S',0x01 | behavior(1) | count int64 BE | extraLen int64 BE | extra
//
// Ограничение (честное): zstd-декодирование здесь НЕ выполняется (node:zlib
// не поддерживает zstd). Скрипт работает с УЖЕ декомпрессированным
// inner-payload (флаг --decompressed) либо генерирует synthetic fixture
// (флаг --make-fixture) без zstd-обёртки. Полный zstd-decode — задача
// будущего MRS viewer (см. docs/research/future/MRS-TOOLCHAIN.md §5).
//
// Использование:
//   node inspect-mrs.mjs --make-fixture inner.fixture        # создать fixture
//   node inspect-mrs.mjs inner.fixture                        # разобрать (трактуя как decompressed)
//   node inspect-mrs.mjs --decompressed raw.bin               # разобрать декомпрессированный payload
//   cat real.mrs | node inspect-mrs.mjs --detect-only         # только zstd-magic детект

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const MAGIC = Buffer.from([0x4d, 0x52, 0x53, 0x01]); // 'MRS' + 1 (MRSv1)
const BEHAVIORS = { 1: 'domain', 2: 'ipcidr', 3: 'classical' }; // INFERRED iota-порядок; эмпирическая сверка — задача №1

function makeFixture({ behavior = 1, count = 3, extra = Buffer.alloc(0) } = {}) {
  const parts = [];
  parts.push(MAGIC);
  parts.push(Buffer.from([behavior]));
  const countBuf = Buffer.alloc(8);
  countBuf.writeBigInt64BE(BigInt(count));
  parts.push(countBuf);
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigInt64BE(BigInt(extra.length));
  parts.push(lenBuf);
  if (extra.length) parts.push(extra);
  // payload (не декодируется этим PoC — succinct DomainSet, SOURCE-PROVEN указатель на
  // openacid/succinct; здесь — синтетический хвост)
  parts.push(Buffer.from('SYNTHETIC-PAYLOAD-NOT-A-REAL-MRS-BODY'));
  return Buffer.concat(parts);
}

function inspect(buf, { decompressedAssumed = false } = {}) {
  const report = { size: buf.length, container: 'raw (assumed decompressed)', problems: [] };
  if (!decompressedAssumed) {
    if (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) {
      report.container = 'zstd (MTS outer stream)';
      report.problems.push('zstd-декодирование PoC не выполняет — распакуйте и передайте --decompressed');
      return report;
    }
  }
  if (buf.length < 21) {
    report.problems.push(`слишком короткий payload (${buf.length} < 21)`);
    return report;
  }
  const magic = buf.subarray(0, 4);
  report.magicOk = magic.equals(MAGIC);
  if (!report.magicOk) {
    report.problems.push('magic не MRSv1: ' + magic.toString('hex'));
    return report;
  }
  const behavior = buf[4];
  report.behavior = { byte: behavior, label: BEHAVIORS[behavior] ?? 'INFERRED-unknown (сверьте эмпирически)' };
  report.count = Number(buf.readBigInt64BE(5));
  const extraLen = Number(buf.readBigInt64BE(13));
  report.extraLength = extraLen;
  if (report.count < 0) report.problems.push('count < 0 (SOURCE-PROVEN отказ в mrs_reader)');
  if (extraLen < 0) report.problems.push('extra-length < 0 (SOURCE-PROVEN отказ в mrs_reader)');
  const expected = 21 + Math.max(extraLen, 0);
  if (buf.length < expected) report.problems.push(`усечённый extra: есть ${buf.length}, ожидалось ${expected}`);
  else {
    report.extra = extraLen ? buf.subarray(21, 21 + extraLen).toString('hex').slice(0, 64) + (extraLen > 32 ? '…' : '') : '(пусто)';
    report.payloadOffset = expected;
    report.payloadBytes = buf.length - expected;
    report.payloadNote = 'succinct DomainSet / IpCidrSet — парсится будущим MRS-декодером (PoC-граница)';
  }
  return report;
}

const arg = args[0] ?? '';
if (arg === '--make-fixture') {
  const out = args[1] ?? 'inner.fixture';
  writeFileSync(out, makeFixture());
  console.log('synthetic inner-fixture записан:', out);
} else if (arg === '--detect-only') {
  const buf = readFileSync(0);
  console.log('zstd-магия:', buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd);
} else {
  const buf = readFileSync(arg || 'inner.fixture');
  const decompressed = args.includes('--decompressed');
  const report = inspect(buf, { decompressedAssumed: decompressed });
  console.log(JSON.stringify(report, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2));
  if (report.problems?.length) { console.error('problems:', report.problems); process.exit(1); }
}

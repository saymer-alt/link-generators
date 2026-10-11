// MRS DomainSet decode PoC (NIGHT-MEGA-01 TRACK B2) — автономный исследовательский код.
// НЕ production-код: не подключён к генератору/CI.
//
// Байт-в-байт порт из mihomo v1.19.32:
//   - serialization: component/trie/domain_set_bin.go (WriteBin/ReadDomainSetBin)
//   - trie:          component/trie/domain_set.go (buildDomainSet, Has, keys/Foreach)
//   - контейнер:     rules/provider/mrs_reader.go (rulesMrsParse)
//
// Числа uint64 хранятся как BigInt (JS-битовые операции 32-битны — слова
// бит-векторов могут иметь значащие биты выше 31).
//
// Эмпирическая сверка: research/poc/mrs/fixtures/*.inner — декомпрессированный
// payload файла, созданного ОФИЦИАЛЬНЫМ бинарником mihomo v1.19.31
// (`mihomo convert-ruleset domain text domains.list synthetic.mrs` + `zstd -d`).
// Список доменов — research/poc/mrs/fixtures/domains.list (синтетика).

// ---------- бит-вектор (BigInt-слова) ----------

export function popcount(x) {
  let n = 0n;
  let v = x;
  while (v) { n += v & 1n; v >>= 1n; }
  return Number(n);
}

export class BitVector {
  constructor(words) {
    this.words = words; // BigInt[]
  }
  get(i) {
    const w = this.words[i >> 6];
    if (w === undefined) return 0n;
    return (w >> BigInt(i & 63)) & 1n;
  }
  // rank: число единиц в [0, i)
  rank(i) {
    let n = 0;
    const full = i >> 6;
    for (let w = 0; w < full; w++) n += popcount(this.words[w] ?? 0n);
    const rem = i & 63;
    if (rem) n += popcount((this.words[full] ?? 0n) & ((1n << BigInt(rem)) - 1n));
    return n;
  }
  // select: индекс i-й единицы (0-based); -1 если единиц меньше i+1.
  // PoC-простота: линейный скан 64 битов слова (производительность — не цель).
  select(i) {
    if (i < 0) return -1;
    let seen = 0;
    for (let w = 0; w < this.words.length; w++) {
      const word = this.words[w];
      const c = popcount(word);
      if (seen + c > i) {
        let rem = i - seen + 1; // нужна rem-я единица этого слова (1-based)
        for (let b = 0; b < 64; b++) {
          if ((word >> BigInt(b)) & 1n) {
            if (--rem === 0) return w * 64 + b;
          }
        }
        return -1; // недостижимо при корректном popcount
      }
      seen += c;
    }
    return -1;
  }
}

// ---------- DomainSet ----------

const COMPLEX_WILDCARD = 0x2b; // '+'
const WILDCARD = 0x2a;         // '*'
const DOMAIN_STEP = 0x2e;      // '.'

export class DomainSet {
  constructor(leaves, labelBitmap, labels) {
    this.leaves = new BitVector(leaves);            // BigInt[]
    this.labelBitmap = new BitVector(labelBitmap);  // BigInt[]
    this.labels = labels;                           // Uint8Array
  }
}

// Порт domain_set.go Has()/MatchDomain() — вход: домен в естественном порядке.
// Ключи в трее хранятся байт-реверсированными; обход читает вход с конца
// (revLowerAt) и понижает регистр. RESTART-переходы (goto в Go) — через
// continue walk с компенсацией счётчика внешнего for.
export function has(ds, key) {
  if (!ds) return false;
  // Go нормализует не-ASCII отдельной веткой (rune-ToLower); для PoC — toLowerCase
  // всей строки (расхождение на не-ASCII — см. §6 research-документа).
  const keyBytes = Buffer.from(String(key).toLowerCase(), 'utf8');
  const len = keyBytes.length;
  const revLowerAt = i => {
    const c = keyBytes[len - 1 - i];
    return c >= 0x41 && c <= 0x5a ? c + 32 : c;
  };
  const countZeros = i => i - ds.labelBitmap.rank(i);
  const stack = []; // { bmIdx, index }
  let nodeId = 0, bmIdx = 0;

  walk: for (let i = 0; i < len; i++) {
    const c = revLowerAt(i);
    // скан меток текущего узла; на выходе bmIdx указывает на метку совпадения
    let matched = -1;
    for (;;) {
      if (ds.labelBitmap.get(bmIdx) !== 0n) {
        // меток больше нет — раскрутка wildcard-стека (Go: while len(stack)>0)
        while (stack.length > 0) {
          const cursor = stack.pop();
          const nextNodeId = countZeros(cursor.bmIdx + 1);
          let j = cursor.index;
          for (; j < len && revLowerAt(j) !== DOMAIN_STEP; j++) { /* scan */ }
          if (j === len) {
            if (ds.leaves.get(nextNodeId) !== 0n) return true;
            continue; // следующая сохранённая wildcard-ветка
          }
          const firstBm = ds.labelBitmap.select(nextNodeId - 1) + 1;
          for (let nb = firstBm; ds.labelBitmap.get(nb) === 0n; nb++) {
            if (ds.labels[nb - nextNodeId] === DOMAIN_STEP) {
              // goto RESTART: i=j, nodeId=nextNodeId, bmIdx=nb
              nodeId = nextNodeId;
              bmIdx = nb;
              i = j - 1; // -1: внешний for сделает i++
              continue walk;
            }
          }
          // ветка не подошла — следующая из стека
        }
        return false;
      }
      const label = ds.labels[bmIdx - nodeId];
      if (label === COMPLEX_WILDCARD) return true;
      if (label === WILDCARD) stack.push({ bmIdx, index: i });
      if (label === c) { matched = bmIdx; break; }
      bmIdx++;
    }
    const nextNodeId = matched - nodeId + 1;
    if (i === len - 1) {
      if (ds.leaves.get(nextNodeId) !== 0n) return true;
      if (stack.length === 0) return false;
      bmIdx = ds.labelBitmap.select(nextNodeId); // RESTART с тем же i
      nodeId = nextNodeId;
      i--; // внешний for вернёт i на место — goto RESTART сохраняет i
      continue walk;
    }
    nodeId = nextNodeId;
    bmIdx = ds.labelBitmap.select(nextNodeId - 1) + 1;
  }
  return ds.leaves.get(nodeId) !== 0n;
}

// Порт keys()/Foreach — полный обход; внутренние ключи реверсированы, хвостовой
// '+' срезается (domain_set.go Foreach). Паттерны: '*' — один label, ведущий '.'
// — только поддомены; '+.' не выводится.
export function foreach(ds) {
  const out = [];
  const currentKey = [];
  const traverse = (nodeId, bmIdx) => {
    if (ds.leaves.get(nodeId) !== 0n) out.push(currentKey.join(''));
    for (;;) {
      if (ds.labelBitmap.get(bmIdx) !== 0n) return;
      currentKey.push(String.fromCharCode(ds.labels[bmIdx - nodeId]));
      const nextNodeId = bmIdx - nodeId + 1;
      const nextBmIdx = ds.labelBitmap.select(nextNodeId - 1) + 1;
      traverse(nextNodeId, nextBmIdx);
      currentKey.pop();
      bmIdx++;
    }
  };
  traverse(0, 0);
  return out.map(k => [...k.replace(/\+$/, '')].reverse().join(''));
}

// ---------- разбор контейнера/пейлоада ----------

// Эмпирика B2: domain=0 (прежнее INFERRED 1/2/3 опровергнуто реальным файлом);
// ipcidr=1 (сверено на ipcidr-фикстуре).
export const BEHAVIORS = { 0: 'domain', 1: 'ipcidr' };

export function parseMrsContainer(buf) {
  if (buf.length < 21) throw new Error('too small for MRS header');
  if (!(buf[0] === 0x4d && buf[1] === 0x52 && buf[2] === 0x53 && buf[3] === 0x01)) {
    throw new Error('invalid MrsMagic bytes');
  }
  const behaviorByte = buf[4];
  const count = Number(buf.readBigInt64BE(5));
  const extraLen = Number(buf.readBigInt64BE(13));
  if (extraLen < 0) throw new Error('length is invalid');
  if (21 + extraLen > buf.length) throw new Error('truncated extra');
  return {
    behavior: BEHAVIORS[behaviorByte] ?? ('unknown(' + behaviorByte + ')'),
    behaviorByte,
    count,
    extra: buf.subarray(21, 21 + extraLen),
    payload: buf.subarray(21 + extraLen)
  };
}

export function readDomainSetBin(buf, offset = 0) {
  let p = offset;
  if (buf[p++] !== 1) throw new Error('version is invalid');
  const readWords = () => {
    const n = Number(buf.readBigInt64BE(p)); p += 8;
    if (n < 1) throw new Error('length is invalid');
    const words = [];
    for (let i = 0; i < n; i++) { words.push(buf.readBigUInt64BE(p)); p += 8; }
    return words;
  };
  const leaves = readWords();
  const labelBitmap = readWords();
  const nLabels = Number(buf.readBigInt64BE(p)); p += 8;
  if (nLabels < 1) throw new Error('length is invalid');
  const labels = buf.subarray(p, p + nLabels);
  return { set: new DomainSet(leaves, labelBitmap, labels), end: p + nLabels };
}

// ---------- синтетический builder (порт buildDomainSet + WriteBin + Insert) ----------

// keysInput — УЖЕ реверсированные ключи (b.keys у DomainSetBuilder).
export function buildDomainSet(keysInput) {
  const keys = [...new Set([...keysInput].sort())];
  if (keys.length === 0) return null;
  const leaves = [];
  const labelBitmap = [];
  const labels = [];
  const setBit = (arr, i, v) => {
    while (i >> 6 >= arr.length) arr.push(0n);
    if (v) arr[i >> 6] |= (1n << BigInt(i & 63));
  };
  let lIdx = 0, nodeID = 0, col = 0;
  let queue = [{ s: 0, e: keys.length }];
  while (queue.length > 0) {
    const next = [];
    for (const elt of queue) {
      if (col === keys[elt.s].length) { setBit(leaves, nodeID, 1); elt.s++; }
      for (let j = elt.s; j < elt.e;) {
        const frm = j;
        for (; j < elt.e && keys[j][col] === keys[frm][col]; j++) { /* group */ }
        next.push({ s: frm, e: j });
        labels.push(keys[frm].charCodeAt(col));
        setBit(labelBitmap, lIdx, 0);
        lIdx++;
      }
      setBit(labelBitmap, lIdx, 1);
      lIdx++;
      nodeID++;
    }
    queue = next;
    col++;
  }
  return new DomainSet(leaves, labelBitmap, new Uint8Array(labels));
}

// Порт DomainSet.WriteBin (domain_set_bin.go)
export function domainSetWriteBin(ds) {
  const word = w => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt.asUintN(64, w)); return b; };
  const cnt = n => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n)); return b; };
  return Buffer.concat([
    Buffer.from([1]),
    cnt(ds.leaves.words.length), ...ds.leaves.words.map(word),
    cnt(ds.labelBitmap.words.length), ...ds.labelBitmap.words.map(word),
    cnt(ds.labels.length), Buffer.from(ds.labels)
  ]);
}

// Порт DomainSetBuilder.Insert: домен → реверсированные ключи ('+'/'*'/'.' семантика).
export function insertKeys(domain) {
  const parts = String(domain).toLowerCase().split('.').filter(p => p.length > 0);
  const keys = [];
  const push = ps => keys.push([...ps.join('.')].reverse().join(''));
  if (parts[0] === '+') {
    push(parts.slice(1));
    push(parts);
  } else {
    if (parts[0] === '.') parts[0] = '+'; // dotWildcard → complexWildcard
    push(parts);
  }
  return keys;
}

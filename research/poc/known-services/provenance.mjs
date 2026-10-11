// Known-Services Provenance PoC (NIGHT-MEGA-01 TRACK B5).
// НЕ production-код: не подключён к генератору/CI; никакая база не встроена.
//
// Контракт из docs/research/future/KNOWN-SERVICES-PROVENANCE.md:
//   §2 формат записи v1, §4 правила обновления (конфликты видимы, COMMUNITY
//   не перезаписывает SOURCE-VERIFIED, review-due — пометка, не удаление),
//   §6 нормализация доменов/CIDR.
//
// Чистые функции: validate / normalize / lookup / merge.

export const KINDS = ['domain', 'domain-suffix', 'domain-keyword', 'ip-cidr', 'ip-asn'];
export const CONFIDENCE_ORDER = ['HEURISTIC', 'COMMUNITY', 'FIELD-OBSERVED', 'SOURCE-VERIFIED'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- нормализация ----------

export function normalizeDomain(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || s.includes('/') || s.includes(' ')) return null;
  // punycode для IDN — через URL API (без сети; only parsing)
  try {
    if (/[^\x00-\x7f]/.test(s)) {
      const u = new URL('http://' + s);
      return u.hostname; // URL API переводит IDN в punycode
    }
  } catch (_) { return null; }
  return s.replace(/\.$/, '');
}

export function normalizeCidr(v) {
  const m = String(v || '').trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return null;
  const octets = m[1].split('.').map(Number);
  if (octets.some(o => o > 255)) return null;
  const prefix = Number(m[2]);
  if (prefix > 32) return null;
  // хостовые биты должны быть чистыми — иначе запись неоднозначна
  const ip = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  if (((ip & mask) >>> 0) !== ip) return null;
  return octets.join('.') + '/' + prefix;
}

// ---------- валидация записи (§2) ----------

export function validateEntry(e) {
  const errors = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['entry: not an object'];
  if (!KINDS.includes(e.kind)) errors.push('kind: one of ' + KINDS.join('|'));
  if (typeof e.value !== 'string' || !e.value) errors.push('value: non-empty string expected');
  if (typeof e.service !== 'string' || !e.service) errors.push('service: non-empty string expected');
  const p = e.provenance;
  if (!p || typeof p !== 'object') errors.push('provenance: object expected');
  else {
    if (typeof p.source !== 'string' || !p.source) errors.push('provenance.source: non-empty string expected');
    // §2: записи без observedAt — HEURISTIC принудительно (не ошибка, см. enforceConfidence)
    if (p.observedAt !== undefined && (typeof p.observedAt !== 'string' || !ISO_DATE_RE.test(p.observedAt))) {
      errors.push('provenance.observedAt: YYYY-MM-DD expected');
    }
  }
  if (e.kind === 'domain' || e.kind === 'domain-suffix') {
    if (!normalizeDomain(e.value)) errors.push('value: not a normalizable domain');
  }
  if (e.kind === 'ip-cidr' && !normalizeCidr(e.value)) errors.push('value: not a normalized ip-cidr');
  if (e.freshness && typeof e.freshness === 'object' && e.freshness.reviewIntervalDays !== undefined
    && (!Number.isInteger(e.freshness.reviewIntervalDays) || e.freshness.reviewIntervalDays < 1)) {
    errors.push('freshness.reviewIntervalDays: positive integer expected');
  }
  return errors;
}

// §2 правило: без observedAt → HEURISTIC принудительно; некорректный
// confidence-токен — тоже HEURISTIC (fail-safe к самому слабому).
export function enforceConfidence(e) {
  const clone = JSON.parse(JSON.stringify(e));
  clone.provenance = clone.provenance || {};
  const valid = CONFIDENCE_ORDER.includes(clone.provenance.confidence);
  if (!clone.provenance.observedAt || !valid) clone.provenance.confidence = 'HEURISTIC';
  return clone;
}

// ---------- lookup (§1: «что это и откуда мы знаем») ----------

export function lookup(entries, query) {
  const qDomain = normalizeDomain(query);
  let qCidr = normalizeCidr(query);
  if (!qCidr) {
    // голый IPv4 (без префикса) валиден для поиска — считаем его /32
    const bare = String(query || '').trim();
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare) && normalizeCidr(bare + '/32')) qCidr = bare + '/32';
  }
  const hits = [];
  for (const raw of entries) {
    if (validateEntry(raw).length) continue; // битые записи не участвуют
    const e = enforceConfidence(raw);
    if (e.kind === 'domain' && qDomain === normalizeDomain(e.value)) hits.push({ entry: e, match: 'exact' });
    else if (e.kind === 'domain-suffix' && qDomain) {
      const suf = normalizeDomain(e.value);
      if (qDomain === suf || qDomain.endsWith('.' + suf)) hits.push({ entry: e, match: 'suffix' });
    }
    else if (e.kind === 'domain-keyword' && qDomain && qDomain.includes(String(e.value).toLowerCase())) hits.push({ entry: e, match: 'keyword' });
    else if (e.kind === 'ip-cidr' && qCidr && cidrContains(e.value, qCidr)) hits.push({ entry: e, match: 'cidr' });
    else if (e.kind === 'ip-asn' && String(query).toUpperCase() === 'AS' + String(e.value).replace(/^AS/i, '')) hits.push({ entry: e, match: 'asn' });
  }
  // §1/§4: сортировка по confidence (сильнее — раньше), конфликты НЕ схлопываются
  hits.sort((a, b) => CONFIDENCE_ORDER.indexOf(b.entry.provenance.confidence) - CONFIDENCE_ORDER.indexOf(a.entry.provenance.confidence));
  return hits;
}

function cidrContains(cidr, ip) {
  const [net, plen] = cidr.split('/');
  const [iNet, iIp] = [toUint(net), toUint(ip.split('/')[0])];
  const mask = Number(plen) === 0 ? 0 : (0xffffffff << (32 - Number(plen))) >>> 0;
  return ((iNet & mask) >>> 0) === ((iIp & mask) >>> 0);
}
const toUint = s => s.split('.').reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);

// ---------- merge (§4: COMMUNITY не перезаписывает SOURCE-VERIFIED) ----------

// Возвращает { entries, conflicts } — конфликтующие записи ОБЕ сохраняются,
// конфликт регистрируется (молча разрешать запрещено §1/§4).
export function merge(existingList, incomingList) {
  const entries = existingList.map(e => enforceConfidence(e));
  const conflicts = [];
  for (const raw of incomingList) {
    if (validateEntry(raw).length) continue;
    const inc = enforceConfidence(raw);
    const sameValue = entries.find(e => e.kind === inc.kind
      && normalizeValue(e) === normalizeValue(inc));
    if (!sameValue) { entries.push(inc); continue; }
    const strong = CONFIDENCE_ORDER.indexOf(inc.provenance.confidence) > CONFIDENCE_ORDER.indexOf(sameValue.provenance.confidence);
    if (!strong) {
      conflicts.push({ kept: sameValue.entryId || '(id)', rejected: inc, reason: 'incoming confidence ≤ existing' });
      continue; // §4: слабый источник не перезаписывает сильный
    }
    // даже при перезаписи сильным источником прежняя запись остаётся в conflicts
    // (видимая история, не молчаливая замена)
    conflicts.push({ kept: inc.entryId || '(id)', rejected: sameValue, reason: 'replaced by stronger source' });
    const idx = entries.indexOf(sameValue);
    entries[idx] = inc;
  }
  return { entries, conflicts };
}

function normalizeValue(e) {
  if (e.kind === 'domain' || e.kind === 'domain-suffix') return normalizeDomain(e.value);
  if (e.kind === 'ip-cidr') return normalizeCidr(e.value);
  return String(e.value).toLowerCase();
}

// ---------- freshness (§4.3: review-due — пометка, не удаление) ----------

export function isReviewDue(entry, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const f = entry.freshness;
  if (!f || !f.reviewDue) return false;
  return String(f.reviewDue) < String(today);
}

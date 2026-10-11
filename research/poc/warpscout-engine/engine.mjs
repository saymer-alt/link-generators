// WARPSCOUT Observation Engine PoC (NIGHT-MEGA-01 TRACK B4).
// НЕ production-код: не подключён к генератору/CI.
//
// Реализует контракт из docs/research/future/WARPSCOUT-REVALIDATION.md:
//   §3 schema v1 (валидация), §4 freshness ПО СОБЫТИЯМ (структурный STALE,
//   review-interval — только напоминание), §5 дедуп по ключу, §6 UNKNOWN/STALE
//   правила, §7 транспортная изоляция (wg/masque-h2/masque-h3 не смешиваются).
//
// Чистые функции, без сети; наблюдения — обычные JS-объекты.

export const TRANSPORTS = ['wg', 'masque-h2', 'masque-h3'];
export const LEVEL_STATUSES = ['PASS', 'FAIL', 'UNKNOWN'];
export const LEVELS = ['reachable', 'tunnel', 'exit', 'service', 'sni'];
export const SOURCES = ['warpscout-scan', 'manual', 'revalidation'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// ---------- §3 валидация schema v1 ----------

export function validateObservation(o) {
  const errors = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['observation: not an object'];
  if (o.$schema !== 'warpscout-observation-v1') errors.push('$schema: expected warpscout-observation-v1');
  if (typeof o.profileRef !== 'string' || !o.profileRef) errors.push('profileRef: non-empty string expected');
  if (!TRANSPORTS.includes(o.transport)) errors.push('transport: one of ' + TRANSPORTS.join('|'));
  if (!SOURCES.includes(o.source)) errors.push('source: one of ' + SOURCES.join('|'));
  if (typeof o.checkedAt !== 'string' || !ISO_RE.test(o.checkedAt)) errors.push('checkedAt: ISO-8601 Z expected');
  if (!o.endpoint || typeof o.endpoint !== 'object') errors.push('endpoint: object expected');
  else {
    if (typeof o.endpoint.host !== 'string' || !o.endpoint.host) errors.push('endpoint.host: non-empty string expected');
    if (!Number.isInteger(o.endpoint.port) || o.endpoint.port < 1 || o.endpoint.port > 65535) errors.push('endpoint.port: integer 1..65535');
  }
  const levels = o.levels;
  if (!levels || typeof levels !== 'object') errors.push('levels: object expected');
  else {
    for (const name of LEVELS) {
      const l = levels[name];
      if (!l || typeof l !== 'object') { errors.push('levels.' + name + ': object expected'); continue; }
      if (!LEVEL_STATUSES.includes(l.status)) errors.push('levels.' + name + '.status: PASS|FAIL|UNKNOWN');
      if (name === 'exit' && l.status === 'FAIL') errors.push('levels.exit.status: FAIL не допускается (exit либо наблюдаем, либо UNKNOWN)');
    }
  }
  return errors;
}

// ---------- §6 агрегация (UNKNOWN доминирует; «endpoint мёртв» — только при L1 FAIL) ----------

export function aggregate(o) {
  const errs = validateObservation(o);
  if (errs.length) return { state: 'INVALID', reasons: errs };
  const levels = o.levels;
  const statuses = LEVELS.map(n => levels[n].status);
  if (statuses.includes('UNKNOWN')) {
    const unknownLevels = LEVELS.filter(n => levels[n].status === 'UNKNOWN');
    return { state: 'UNKNOWN', reasons: unknownLevels.map(n => n + ' UNKNOWN') };
  }
  if (statuses.includes('FAIL')) {
    const failed = LEVELS.filter(n => levels[n].status === 'FAIL');
    // §6: FAIL агрегируется с уровневой причиной; «endpoint мёртв» формулируем
    // только когда FAIL на L1 (reachable).
    const reasons = failed.map(n => {
      if (n === 'reachable') return 'endpoint unreachable (L1 FAIL)';
      if (n === 'tunnel') return 'tunnel not established (L2 FAIL)';
      if (n === 'exit') return 'exit not observable'; // не бывает: exit FAIL отвергнут валидацией
      if (n === 'service') return 'service check failed (L4 FAIL)';
      return 'sni check failed (L5 FAIL)';
    });
    return { state: 'FAIL', reasons };
  }
  return { state: 'PASS', reasons: [] };
}

// ---------- §4 freshness: структурный STALE по fingerprint профиля ----------

// profile: { profileRef, endpoint:{host,port}, transport, keyFingerprint } —
// keyFingerprint — ХЕШ ключа (не сам ключ). Свежесть ПО СОБЫТИЯМ: наблюдение
// STALE ⟺ fingerprint наблюдения ≠ текущему fingerprint профиля.
export function observationFingerprint(profile) {
  return [profile.transport, profile.endpoint.host, profile.endpoint.port, profile.keyFingerprint || ''].join('|');
}

export function freshness(obsList, profile, { now = new Date().toISOString(), reviewIntervalDays = 7 } = {}) {
  const out = [];
  for (const o of obsList) {
    const errs = validateObservation(o);
    if (errs.length) { out.push({ observationId: o && o.observationId, state: 'INVALID', reasons: errs }); continue; }
    // Endpoint/transport сравнимы всегда (поля есть в самой observation);
    // смену ключа видно только если наблюдение записало profileFingerprint.
    const endpointChanged = o.transport !== profile.transport
      || o.endpoint.host !== profile.endpoint.host
      || o.endpoint.port !== profile.endpoint.port;
    const keyChanged = typeof o.profileFingerprint === 'string'
      && profile.keyFingerprint !== undefined
      && o.profileFingerprint !== profile.keyFingerprint;
    if (endpointChanged || keyChanged) {
      out.push({
        observationId: o.observationId, state: 'STALE',
        reasons: endpointChanged ? ['profile endpoint/transport changed'] : ['profile key changed (profileFingerprint mismatch)']
      });
      continue;
    }
    const ageDays = (Date.parse(now) - Date.parse(o.checkedAt)) / 86400000;
    const reviewDue = ageDays > reviewIntervalDays;
    const agg = aggregate(o);
    out.push({
      observationId: o.observationId,
      state: agg.state,
      reasons: agg.reasons.concat(reviewDue ? ['review-interval exceeded — пора перепроверить (не деградация)'] : []),
      reviewDue
    });
  }
  return out;
}

// ---------- §5 дедупликация ----------

const minuteBucket = iso => String(iso).slice(0, 16); // до минуты

export function dedupKey(o) {
  return [o.profileRef, o.transport, o.endpoint.host, o.endpoint.port, minuteBucket(o.checkedAt)].join('|');
}

// Оставляет ПОСЛЕДНЕЕ наблюдение на ключ (лог сжимается до последнего
// уникального на батч); порядок первых появлений сохраняется.
export function dedup(obsList) {
  const lastByKey = new Map();
  const order = [];
  for (const o of obsList) {
    const k = dedupKey(o);
    if (!lastByKey.has(k)) order.push(k);
    lastByKey.set(k, o);
  }
  return order.map(k => lastByKey.get(k));
}

// ---------- маскирование для публикации ----------

const SECRETISH = /(key|token|secret|password|hwid|authorization)/i;

export function maskForPublication(o) {
  const clone = JSON.parse(JSON.stringify(o));
  const walk = node => {
    if (Array.isArray(node)) { node.forEach(walk); return node; }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        if (SECRETISH.test(k)) node[k] = '***MASKED***';
        else if (typeof node[k] === 'object' && node[k] !== null) walk(node[k]);
      }
      if (node.levels && node.levels.exit && typeof node.levels.exit === 'object') {
        // egressIp маскируется ВСЕГДА; country/colo остаются (§3)
        if ('egressIp' in node.levels.exit) node.levels.exit.egressIp = '***MASKED***';
      }
    }
    return node;
  };
  return walk(clone);
}

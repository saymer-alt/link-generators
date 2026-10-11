// DNS↔Routing Intelligence PoC (v1.12 candidate) — статический аудит
// согласованности dns:-секции и rules: одного Mihomo-конфига.
//
// Только чтение, чистая функция, без сети. Вход — разобранный YAML-документ
// (JS-объект), выход — список находок с уровнями доказательности:
//   CONFIRMED — поведение доказано по исходникам mihomo v1.19.32 (файл:строка
//               в docs/research/future/DNS-ROUTING-INTELLIGENCE.md §2);
//   INFERRED  — код-уровень подтверждён, влияние на окружение зависит от
//               сценария (утечка DNS / подмена ответов провайдером).
//
// Анализатор НЕ претендует на полноту: GEOSITE/GEOIP-провайдеры, sub-rules и
// вложенные группы даются как честные ограничения (см. §6 документа).

const BUILTIN_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL']);
const IP_RULE_TYPES = new Set(['IP-CIDR', 'IP-CIDR6', 'SRC-IP-CIDR', 'GEOIP', 'IP-ASN', 'SRC-GEOIP', 'SRC-IP-ASN']);
const DOMAIN_RULE_TYPES = new Set(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-REGEX', 'GEOSITE']);
// NEQ: прямые DNS-цели, которые аудитор считает «локальным разрешением» —
// схемы без прокси-маршрутизации (ip://, system, dhcp:// и пустая схема).
const DIRECT_DNS_SCHEMES = new Set(['', 'system', 'dhcp']);

function ruleParts(rule) {
  const parts = String(rule).split(',').map(s => s.trim());
  return { type: (parts[0] || '').toUpperCase(), payload: parts[1] || '', target: parts[2] || '', noResolve: parts.slice(3).some(p => p === 'no-resolve') };
}

function isPlainHost(s) {
  return typeof s === 'string' && s !== '' && !s.includes('://') && !s.startsWith('dhcp') && !s.startsWith('system');
}

function dnsTargetClass(v) {
  // Класс цели nameserver: 'direct' (локальное разрешение) | 'proxy' (через
  // прокси-адаптер по имени) | 'respect-rules' (маркер RULES).
  if (typeof v !== 'string' || !v) return 'direct';
  let u;
  try { u = new URL(v.includes('://') ? v : 'default://' + v); } catch (_) { return 'direct'; }
  const scheme = (u.protocol.replace('default:', '').replace(':', '') || '').toLowerCase();
  if (scheme === 'rules') return 'respect-rules';
  if (DIRECT_DNS_SCHEMES.has(scheme) || scheme === 'ip') return 'direct';
  if (u.hostname && isPlainHost(u.hostname)) return 'proxy';
  return 'direct';
}

function collectRuleFacts(doc) {
  const facts = { proxiedDomains: [], domainTargets: new Map(), ipRules: [], hasMatch: false, matchTarget: null };
  const rules = Array.isArray(doc.rules) ? doc.rules : [];
  for (const raw of rules) {
    const r = ruleParts(raw);
    if (!r.type) continue;
    if (r.type === 'MATCH') { facts.hasMatch = true; facts.matchTarget = r.target; continue; }
    if (DOMAIN_RULE_TYPES.has(r.type) && r.payload) {
      facts.domainTargets.set(r.payload.toLowerCase(), r.target);
      if (r.target && !BUILTIN_TARGETS.has(r.target)) facts.proxiedDomains.push({ domain: r.payload, target: r.target, type: r.type });
    }
    if (IP_RULE_TYPES.has(r.type)) facts.ipRules.push({ type: r.type, payload: r.payload, target: r.target, noResolve: r.noResolve });
  }
  return facts;
}

function collectDnsFacts(doc) {
  const dns = (doc.dns && typeof doc.dns === 'object') ? doc.dns : null;
  const facts = {
    enabled: !!(dns && dns.enable !== false && dns.enable !== 'false'),
    respectRules: !!(dns && (dns['respect-rules'] === true || dns['respect-rules'] === 'true')),
    proxyServerNameserver: (dns && Array.isArray(dns['proxy-server-nameserver'])) ? dns['proxy-server-nameserver'] : [],
    nameservers: (dns && Array.isArray(dns.nameserver)) ? dns.nameserver : [],
    nameserverPolicy: (dns && dns['nameserver-policy'] && typeof dns['nameserver-policy'] === 'object') ? dns['nameserver-policy'] : null,
    enhancedMode: (dns && typeof dns['enhanced-mode'] === 'string') ? dns['enhanced-mode'] : null,
    fakeIpFilter: (dns && Array.isArray(dns['fake-ip-filter'])) ? dns['fake-ip-filter'] : []
  };
  return facts;
}

// Ядро аудита. Каждая находка: { id, severity, evidence, message, refs }.
// refs — источник в исходниках mihomo v1.19.32; детали в research-документе §2.
export function dnsRoutingAudit(doc) {
  const findings = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return findings;
  const dns = collectDnsFacts(doc);
  const rf = collectRuleFacts(doc);
  const refs = {
    respect: 'config.go:1420-1421 (v1.19.32)',
    dialer: 'tunnel/dns_dialer.go:57 (v1.19.32)',
    resolve: 'tunnel/tunnel.go:337-350 (v1.19.32)',
    ipcidr: 'rules/common/ipcidr.go:35-45 (v1.19.32)'
  };

  if (!dns.enabled) return findings;

  // A [CONFIRMED]: respect-rules без proxy-server-nameserver — конфиг невалиден,
  // mihomo откажется стартовать. Генератор мог бы ловить это ДО деплоя.
  if (dns.respectRules && dns.proxyServerNameserver.length === 0) {
    findings.push({ id: 'dns-respect-rules-no-psns', severity: 'error', evidence: 'CONFIRMED', message: 'dns.respect-rules: true требует непустой dns.proxy-server-nameserver — mihomo не стартует.', refs: refs.respect });
  }

  // B [INFERRED]: без respect-rules и без proxy-name DNS-запросы к nameserver
  // уходят напрямую (dns_dialer.go: proxyAdapter == nil → dialer напрямую).
  // Домены, маршрутизируемые через прокси, разрешаются в обход туннеля —
  // классический DNS-утечка/подмена. Severity warning: легитимные сценарии есть
  // (доверенный локальный резолвер), влияние зависит от окружения.
  if (!dns.respectRules && rf.proxiedDomains.length > 0) {
    findings.push({
      id: 'dns-bypass-for-proxied-domains', severity: 'warning', evidence: 'INFERRED',
      message: 'Правила маршрутизируют домены через прокси (' + rf.proxiedDomains.length + ' шт.), но dns.respect-rules выключен — запросы к nameserver идут напрямую, минуя туннель (риск утечки/подмены DNS).',
      refs: refs.dialer, hint: 'dns.respect-rules: true + dns.proxy-server-nameserver (или proxy-name у каждого nameserver).'
    });
  }

  // C [INFERRED]: nameserver-policy по домену, который правила гонят через
  // прокси, при локальной («direct») цели политики — расхождение: ответ DNS
  // получают для прямой сети, а трафик пойдёт через прокси (гео-рассинхрон).
  if (dns.nameserverPolicy) {
    for (const [dom, target] of Object.entries(dns.nameserverPolicy)) {
      // Ключ политики может нести wildcard-префикс («+.dom»/«.dom») — снимаем
      // его для сопоставления с payload правил; ограничение честно описано в §6.
      const bare = String(dom).toLowerCase().replace(/^\+?\./, '');
      const ruleTarget = rf.domainTargets.get(bare);
      if (!ruleTarget || BUILTIN_TARGETS.has(ruleTarget)) continue;
      const cls = dnsTargetClass(target);
      if (cls === 'direct') {
        findings.push({
          id: 'dns-policy-vs-rule-mismatch', severity: 'warning', evidence: 'INFERRED',
          message: 'Домен «' + dom + '»: nameserver-policy резолвит локально, а правило маршрутизирует через «' + ruleTarget + '» — возможен гео-рассинхрон ответа DNS и пути трафика.',
          refs: refs.dialer
        });
      }
    }
  }

  // D [CONFIRMED, severity info]: fake-ip + IP-правила. Соединение с fake-ip
  // уже «resolved» (DstIP = 198.18/16), helper.ResolveIP (tunnel.go:337) не
  // срабатывает, IP-CIDR/GEOIP матчатся по фейковому адресу. Флаг: если IP-
  // правила стоят ПОСЛЕ доменных и целуют «далёкие» подсети — честно информируем.
  if ((dns.enhancedMode || '').toLowerCase() === 'fake-ip' && rf.ipRules.length > 0) {
    findings.push({
      id: 'fake-ip-with-ip-rules', severity: 'info', evidence: 'CONFIRMED',
      message: 'enhanced-mode: fake-ip + ' + rf.ipRules.length + ' IP-правил: соединения с fake-ip уже «resolved», IP-правила видят адрес 198.18.0.0/16, а не реальный. Ставьте доменные правила раньше IP или используйте no-resolve осознанно.',
      refs: refs.resolve + '; ' + refs.ipcidr
    });
  }

  return findings;
}

// Реестр находок — для UI-слоя (v1.12): стабильные id + дефолтные severity.
export const AUDIT_FINDINGS = {
  'dns-respect-rules-no-psns': { severity: 'error', evidence: 'CONFIRMED' },
  'dns-bypass-for-proxied-domains': { severity: 'warning', evidence: 'INFERRED' },
  'dns-policy-vs-rule-mismatch': { severity: 'warning', evidence: 'INFERRED' },
  'fake-ip-with-ip-rules': { severity: 'info', evidence: 'CONFIRMED' }
};

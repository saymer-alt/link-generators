// Recoverability Probe (OWNER-REVERSE-01 PR A) — исследовательский pure-код.
// НЕ production: проверяет утверждения REVERSE-BUILD-RECOVERABILITY.md на
// синтетических YAML-фикстурах; станет ядром PHASE C Analyzer.
//
// Только детерминированные маркеры (RECOVERABILITY §2): никаких regex-эвристик
// по «похожим структурам» и никаких догадок (CONSTITUTION §2/§3).

// --- маркеры (SOURCE-PROVEN: web4core src/core/mihomo.js, index.html) ---
export const MARKERS = {
  awlProxyPrefix: /^(PRIMARY|FALLBACK)-\d+: /,
  awlGlobalFilter: '^(PRIMARY-|primary-)`^(FALLBACK-|fallback-)',
  tieredGroup: /^🪜 /,
  tieredRoot: '🪜 TIERED-AUTO',
  policyProvider: /^policy-/,
  subGroup: /^SUB-/,
  vpsDnsHijack: 'any:53',
};

// computeProviderName — порт web4core mihomo.js:31/42 (детерминированный пересчёт).
export function sanitizeProviderName(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/^www\./, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[._-]{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 48);
}
export function computeProviderName(url, index, total, used) {
  let base = '';
  try { base = sanitizeProviderName(new URL(String(url || '').trim()).hostname || ''); } catch (_) {}
  if (!base) base = total === 1 ? 'my_subscription' : `subscription_${index + 1}`;
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}-${i++}`;
  used.add(name);
  return name;
}

// --- детекторы режимов ---

export function detectSubscriptionMode(doc) {
  const providers = doc && doc['proxy-providers'];
  if (providers && typeof providers === 'object' && Object.keys(providers).length) {
    return { mode: 'subscriptions', providers: Object.keys(providers), confidence: 'EXACT' };
  }
  return { mode: 'expanded-or-links', providers: [], confidence: 'EXACT', note: 'URL развёрнутых подписок в YAML отсутствуют — NOT RECOVERABLE' };
}

export function detectAutoWhitelist(doc) {
  const global_ = doc && Array.isArray(doc['proxy-groups'])
    ? doc['proxy-groups'].find(g => g && g.name === 'GLOBAL') : null;
  const prefixed = (doc && Array.isArray(doc.proxies) ? doc.proxies : []).some(p => p && MARKERS.awlProxyPrefix.test(String(p.name || '')));
  if ((global_ && global_.filter === MARKERS.awlGlobalFilter) || prefixed) {
    return { awl: true, confidence: 'EXACT' };
  }
  return { awl: false, confidence: 'EXACT', note: 'отсутствие AWL-маркеров = режим выключен (byte-parity контракт OFF)' };
}

export function detectTieredFailover(doc) {
  const groups = (doc && Array.isArray(doc['proxy-groups'])) ? doc['proxy-groups'] : [];
  const tiered = groups.filter(g => g && MARKERS.tieredGroup.test(String(g.name || '')));
  if (!tiered.length) return { tiered: false, cards: [] };
  const cards = tiered
    .filter(g => g.name !== MARKERS.tieredRoot)
    .map(g => ({
      name: String(g.name).replace(/^🪜\s+\d+\s+/, ''),
      strategy: g.type || 'url-test',
      members: Array.isArray(g.proxies) ? g.proxies.slice() : []
    }));
  const hasRoot = tiered.some(g => g.name === MARKERS.tieredRoot);
  return { tiered: hasRoot, cards, rootOrder: tiered.map(g => g.name), confidence: hasRoot ? 'EXACT' : 'UNKNOWN' };
}

export function detectDomainPolicyRouting(doc) {
  const rps = (doc && doc['rule-providers'] && typeof doc['rule-providers'] === 'object') ? doc['rule-providers'] : {};
  const slugs = Object.keys(rps).filter(n => MARKERS.policyProvider.test(n));
  if (!slugs.length) return { dpr: false, cards: [] };
  const cards = slugs.map(slug => ({
    name: slug.slice('policy-'.length),
    domains: String(rps[slug].payload || ''),
    // цель категории = RULE-SET,<slug>,<target> — первое совпадение
    target: (Array.isArray(doc.rules) ? doc.rules : []).map(r => String(r).split(','))
      .filter(p => p[0] === 'RULE-SET' && p[1] === slug).map(p => p[2])[0] || 'UNKNOWN'
  }));
  return { dpr: true, cards, confidence: 'EXACT' };
}

export function detectDeploymentProfile(doc) {
  const tun = (doc && doc.tun && typeof doc.tun === 'object') ? doc.tun : null;
  const hasTun = !!(tun && (tun.enable === true || tun.device));
  const hijack = !!(tun && Array.isArray(tun['dns-hijack']) && tun['dns-hijack'].some(h => String(h).includes(MARKERS.vpsDnsHijack)));
  const sniffer = !!(doc && doc.sniffer && typeof doc.sniffer === 'object' && (doc.sniffer.enable !== false));
  const storeFakeIp = !!(doc && doc.profile && typeof doc.profile === 'object' && doc.profile['store-fake-ip'] === true);
  const controller = String((doc && doc['external-controller']) || '');
  const vpsController = controller === '127.0.0.1:9090';
  if (hijack && storeFakeIp) return { profile: 'vps-gateway', confidence: 'EXACT' };
  if (!hasTun && vpsController) return { profile: 'vps-local', confidence: 'EXACT' };
  if (hasTun && !hijack && !vpsController) return { profile: 'router', confidence: 'DERIVED', note: 'отсутствие VPS-маркеров — вывод по умолчанию' };
  return { profile: 'UNKNOWN', confidence: 'UNKNOWN', facts: { hasTun, hijack, sniffer, storeFakeIp, vpsController } };
}

// --- WG/AWG (C3) ---

// Форма bean = выход parseWireGuardConf (web4core): camelCase-поля, AWG —
// wireguard['amnezia-wg-option'] (SOURCE-PROVEN по фактическому parse+emit).
// Эмиттер YAML: server/port/private-key/udp/ip/public-key/allowed-ips/
// ip-version/dns/remote-dns-resolve/mtu?/persistent-keepalive?/reserved?/
// amnezia-wg-option? (проверено фактическим Build; нюанс: raw-строка
// keepalive-диапазона ('25-35') в YAML не попадает — восстанавливается
// эффективное значение, исходный raw = NOT RECOVERABLE).
export function extractWgProfiles(doc) {
  const out = [];
  for (const p of (doc && Array.isArray(doc.proxies) ? doc.proxies : [])) {
    if (!p || p.type !== 'wireguard') continue;
    const awg = (p['amnezia-wg-option'] && typeof p['amnezia-wg-option'] === 'object') ? p['amnezia-wg-option'] : null;
    const wg = {
      ip: p.ip || '', ipv6: p.ipv6 || '',
      addresses: [p.ip, p.ipv6].filter(Boolean),
      privateKey: p['private-key'] || '',
      publicKey: p['public-key'] || '',
      preSharedKey: p['pre-shared-key'] || '',
      allowedIPs: Array.isArray(p['allowed-ips']) ? p['allowed-ips'].slice() : [],
      dns: Array.isArray(p.dns) ? p.dns.slice() : [],
      remoteDnsResolve: !!p['remote-dns-resolve']
    };
    if (p.mtu !== undefined) wg.mtu = p.mtu;
    if (p['persistent-keepalive'] !== undefined) wg.persistentKeepalive = p['persistent-keepalive'];
    if (p.reserved !== undefined) wg.reserved = p.reserved;
    if (awg) wg['amnezia-wg-option'] = Object.assign({}, awg);
    out.push({
      recovered: 'RECOVERED_FROM_YAML',
      originalFilename: 'UNKNOWN',
      originalFormatting: 'NOT RECOVERABLE',
      bean: {
        proto: 'wireguard',
        name: String(p.name || ''),
        host: p.server,
        port: p.port,
        ipVersion: p['ip-version'] || 'ipv4',
        wireguard: wg
      },
      mode: p['dialer-proxy'] ? 'proxy' : 'direct',
      target: p['dialer-proxy'] ? String(p['dialer-proxy']) : '',
      kind: awg ? 'awg' : 'wg',
      confidence: 'EXACT',
      notes: p['persistent-keepalive'] !== undefined ? ['persistent-keepalive raw-range NOT RECOVERABLE (восстановлено эффективное значение)'] : [],
      secretsPresent: {
        privateKey: !!p['private-key'],
        presharedKey: !!p['pre-shared-key']
      }
    });
  }
  return out;
}

// --- сводка recoverability по всему doc ---

export function analyze(doc) {
  const subs = detectSubscriptionMode(doc);
  const awl = detectAutoWhitelist(doc);
  const tiered = detectTieredFailover(doc);
  const dpr = detectDomainPolicyRouting(doc);
  const profile = detectDeploymentProfile(doc);
  const wg = extractWgProfiles(doc);
  const proxies = (doc && Array.isArray(doc.proxies) ? doc.proxies : []);
  const findings = [];
  if (subs.mode === 'expanded-or-links') {
    findings.push({ field: 'subscription URLs', state: 'MISSING', note: subs.note });
  }
  for (const w of wg) {
    findings.push({ field: 'wg:' + w.bean.name, state: 'EXACT', note: 'filename: ' + w.originalFilename + ', formatting: ' + w.originalFormatting });
  }
  return { subscriptions: subs, autoWhitelist: awl, tiered, domainPolicy: dpr, deploymentProfile: profile, wgProfiles: wg,
    directProxies: proxies.filter(p => p && p.type !== 'wireguard').length,
    findings };
}

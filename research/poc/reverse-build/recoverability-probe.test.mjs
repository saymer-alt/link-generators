// Тесты Recoverability Probe (PR A) — синтетические фикстуры, node --test.
// Проверяют утверждения REVERSE-BUILD-RECOVERABILITY.md §2 на раскладках,
// которые produce web4core/index.html (SOURCE-PROVEN структура, синтетика).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProviderName, sanitizeProviderName, analyze, extractWgProfiles,
  detectDeploymentProfile, detectTieredFailover
} from './recoverability-probe.mjs';

const SYNTH_HWID = /^[0-9a-f]{32}$/;

// Фикстура 1: Sub Mode ON — раскладка как в mihomo.js:740-815 (синтетика).
const SUB_MODE_YAML = {
  'mixed-port': 7890,
  'external-controller': '0.0.0.0:9090',
  'proxy-providers': {
    'sub1-example': {
      type: 'http', proxy: 'DIRECT', url: 'https://sub1.example/feed',
      interval: 86400, header: { 'x-hwid': ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
      'health-check': { enable: true, interval: 300, url: 'https://www.gstatic.com/generate_204', 'expected-status': 204 }
    },
    'sub2-example': {
      type: 'http', proxy: 'DIRECT', url: 'https://sub2.example/feed',
      interval: 86400, header: { 'x-hwid': ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'] },
      'exclude-filter': '(?i)ru|russia',
      'health-check': { enable: true, interval: 300, url: 'https://www.gstatic.com/generate_204', 'expected-status': 204 }
    }
  },
  'proxy-groups': [
    { name: '⚡ Fastest', type: 'url-test', use: ['sub1-example', 'sub2-example'], url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 50 },
    { name: 'GLOBAL', type: 'select', proxies: ['⚡ Fastest'] }
  ],
  rules: ['MATCH,GLOBAL']
};

test('C1: имена провайдеров пересчитываются из URL+порядка (EXACT)', () => {
  const used = new Set();
  const n1 = computeProviderName('https://sub1.example/feed', 0, 2, used);
  const n2 = computeProviderName('https://sub2.example/feed', 1, 2, used);
  assert.equal(n1, 'sub1-example');
  assert.equal(n2, 'sub2-example');
  // дедуп суффикс как в движке
  const dup = computeProviderName('https://sub1.example/other', 1, 2, new Set(['sub1-example']));
  assert.equal(dup, 'sub1-example-2');
  assert.equal(sanitizeProviderName('Sub.Example.COM'), 'sub-example-com');
});

test('C1: режим подписок обнаруживается по proxy-providers; exclude-filter читается', () => {
  const a = analyze(SUB_MODE_YAML);
  assert.equal(a.subscriptions.mode, 'subscriptions');
  assert.deepEqual(a.subscriptions.providers, ['sub1-example', 'sub2-example']);
  assert.equal(SUB_MODE_YAML['proxy-providers']['sub2-example']['exclude-filter'], '(?i)ru|russia');
});

test('C2: развёрнутый режим — URL честно MISSING, узлы не группируются в подписки', () => {
  const expanded = {
    proxies: [
      { name: 'DE node 1', type: 'vless', server: '198.51.100.1', port: 443, uuid: '00000000-0000-4000-8000-000000000001' },
      { name: 'SE node 2', type: 'ss', server: '198.51.100.2', port: 8443, cipher: 'aes-128-gcm', password: 'synth' }
    ],
    'proxy-groups': [{ name: 'GLOBAL', type: 'select', proxies: ['DE node 1', 'SE node 2'] }],
    rules: ['MATCH,GLOBAL']
  };
  const a = analyze(expanded);
  assert.equal(a.subscriptions.mode, 'expanded-or-links');
  assert.equal(a.directProxies, 2);
  const missing = a.findings.find(f => f.field === 'subscription URLs');
  assert.ok(missing && missing.state === 'MISSING');
  assert.ok(missing.note.includes('NOT RECOVERABLE'));
});

// Фикстура AWL — раскладка mihomo.js:893-922 (синтетика).
const AWL_YAML = {
  proxies: [
    { name: 'PRIMARY-1: node-a', type: 'ss', server: '192.0.2.1', port: 1, cipher: 'aes-128-gcm', password: 'x' },
    { name: 'FALLBACK-1: node-b', type: 'ss', server: '192.0.2.2', port: 1, cipher: 'aes-128-gcm', password: 'x' }
  ],
  'proxy-providers': {
    'primary-sub1-example': { type: 'http', url: 'https://sub1.example/feed', 'health-check': { lazy: false }, override: { 'additional-prefix': 'primary-sub1-example: ' } }
  },
  'proxy-groups': [
    { name: 'GLOBAL', type: 'fallback', proxies: ['PRIMARY-1: node-a', 'FALLBACK-1: node-b'], use: ['primary-sub1-example'], filter: '^(PRIMARY-|primary-)`^(FALLBACK-|fallback-)' }
  ],
  rules: ['MATCH,GLOBAL']
};

test('AWL: режим обнаруживается EXACT (фильтр GLOBAL + префиксы узлов)', () => {
  const a = analyze(AWL_YAML);
  assert.equal(a.autoWhitelist.awl, true);
  assert.equal(a.autoWhitelist.confidence, 'EXACT');
  const plain = analyze(SUB_MODE_YAML);
  assert.equal(plain.autoWhitelist.awl, false);
});

// Фикстура Tiered — index.html:7305/7322 (🪜 канонические имена).
const TIERED_YAML = {
  'proxy-groups': [
    { name: '🪜 1 fast', type: 'url-test', proxies: ['node-a', 'node-b'], url: 'https://www.gstatic.com/generate_204' },
    { name: '🪜 2 backup', type: 'fallback', proxies: ['🪜 1 fast', 'node-c'] },
    { name: '🪜 TIERED-AUTO', type: 'select', proxies: ['🪜 1 fast', '🪜 2 backup'] },
    { name: 'GLOBAL', type: 'select', proxies: ['🪜 TIERED-AUTO'] }
  ],
  rules: ['MATCH,GLOBAL']
};

test('Tiered: карточки восстанавливаются из канонических имён (EXACT)', () => {
  const t = detectTieredFailover(TIERED_YAML);
  assert.equal(t.tiered, true);
  assert.equal(t.cards.length, 2);
  assert.equal(t.cards[0].name, 'fast');
  assert.equal(t.cards[0].strategy, 'url-test');
  assert.deepEqual(t.cards[1].members, ['🪜 1 fast', 'node-c']);
  const none = detectTieredFailover(SUB_MODE_YAML);
  assert.equal(none.tiered, false);
});

// DPR — policy-<slug> rule-providers (DPR PR #78 раскладка).
const DPR_YAML = {
  'rule-providers': {
    'policy-ai': { type: 'http', behavior: 'domain', format: 'yaml', url: 'data:application/yaml;base64,cGF5bG9hZDo=', payload: 'gemini.google.com\n+.openai.com' },
    'policy-youtube': { type: 'http', behavior: 'domain', format: 'yaml', url: 'data:application/yaml;base64,cGF5bG9hZDo=', payload: '+.youtube.com' }
  },
  'proxy-groups': [{ name: 'ai-AUTO', type: 'url-test', use: ['policy-ai'] }],
  rules: ['RULE-SET,policy-ai,ai-AUTO', 'RULE-SET,policy-youtube,DIRECT', 'MATCH,GLOBAL']
};

test('DPR: карточки (имя/домены/цель) восстанавливаются EXACT', () => {
  const d = analyze(DPR_YAML).domainPolicy;
  assert.equal(d.dpr, true);
  assert.equal(d.cards.length, 2);
  assert.equal(d.cards[0].name, 'ai');
  assert.ok(d.cards[0].domains.includes('gemini.google.com'));
  assert.equal(d.cards[0].target, 'ai-AUTO');
  assert.equal(d.cards[1].target, 'DIRECT');
});

// Deployment profiles — applyDeploymentProfile маркеры.
test('Deployment-профиль: vps-gateway/vps-local/router по маркерам', () => {
  assert.equal(detectDeploymentProfile({ tun: { enable: true, 'dns-hijack': ['any:53'], 'auto-route': false }, sniffer: { enable: true }, profile: { 'store-fake-ip': true }, 'external-controller': '127.0.0.1:9090' }).profile, 'vps-gateway');
  assert.equal(detectDeploymentProfile({ 'external-controller': '127.0.0.1:9090', port: 7890 }).profile, 'vps-local');
  const r = detectDeploymentProfile({ tun: { enable: true, stack: 'mips' } });
  assert.equal(r.profile, 'router');
  assert.equal(r.confidence, 'DERIVED');
});

// WG/AWG (C3): bean извлекается с секретами; WG vs AWG по фактическим полям.
const WG_YAML = {
  proxies: [
    {
      name: 'wg-main', type: 'wireguard', server: '198.51.100.10', port: 51820,
      ip: '10.7.0.2/32', 'private-key': 'SYNTH_PRIVATE_KEY_AAA=', 'public-key': 'SYNTH_PUB_BBB=',
      mtu: 1420, udp: true, 'dialer-proxy': 'SUB-node-group',
      reserved: [209, 98, 59]
    },
    {
      name: 'awg-backup', type: 'wireguard', server: '198.51.100.11', port: 51820,
      ip: '10.7.0.3/32', 'private-key': 'SYNTH_PRIVATE_KEY_CCC=', 'public-key': 'SYNTH_PUB_DDD=',
      'amnezia-optimization': true, h1: 100, h2: 200, h3: 300, h4: 400, s1: 5, s2: 50
    }
  ],
  rules: ['MATCH,GLOBAL']
};

test('C3: WG/AWG bean EXACT; dialer→mode/target; AWG по фактическим полям; filename UNKNOWN', () => {
  const [wg, awg] = extractWgProfiles(WG_YAML);
  assert.equal(wg.bean.name, 'wg-main');
  assert.equal(wg.bean.wireguard['private-key'], 'SYNTH_PRIVATE_KEY_AAA=');
  assert.equal(wg.mode, 'proxy');
  assert.equal(wg.target, 'SUB-node-group');
  assert.equal(wg.kind, 'wg');
  assert.equal(wg.recovered, 'RECOVERED_FROM_YAML');
  assert.equal(wg.originalFilename, 'UNKNOWN');
  assert.equal(awg.kind, 'awg');
  assert.equal(awg.mode, 'direct');
  assert.equal(awg.bean.h1, 100);
  assert.equal(awg.bean.s2, 50);
  assert.equal(awg.bean.wireguard['private-key'], 'SYNTH_PRIVATE_KEY_CCC=');
});

test('свободный проход analyze: counts и findings согласованы', () => {
  const a = analyze(WG_YAML);
  assert.equal(a.wgProfiles.length, 2);
  assert.equal(a.directProxies, 0);
  assert.ok(a.findings.some(f => f.state === 'EXACT' && f.field.startsWith('wg:')));
  assert.ok(!SYNTH_HWID.test('not-hwid'));
});

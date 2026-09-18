// MASQUE/DPI generator regression: deterministic, randomized-input-free coverage of the
// load-bearing anti-DPI strategy in index.html. Math.random is replaced INS THE TEST ONLY
// (addInitScript) with a queue fed with boundary values, so each weighted bucket, endpoint
// selection and the anti-correlation branch are exercised deterministically. Production
// randomness is not touched.
// Requires Playwright (NODE_PATH), same conventions as tests/browser.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

// Synthetic keys that contain every character urlEncodeKey must escape.
const PK = 'abc+def/ghi=';
const PUB = 'pub+key=';

function parseLink(link) {
  const [u, name] = link.split('#');
  const m = /^masque:\/\/([^:/]+):(\d+)\?(.*)$/.exec(u);
  assert.ok(m, 'masque link structure: ' + link);
  const q = Object.fromEntries(m[3].split('&').map(kv => kv.split('=')));
  return { host: m[1], port: Number(m[2]), q, name };
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, timeout: 30000 });
  const results = [];
  const rec = (s, d) => { results.push({ s, ...d }); console.log(s, JSON.stringify(d)); };
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
    // rand queue: shifts values; when exhausted, repeats the last value (deterministic)
    await page.addInitScript(() => {
      const queue = [];
      let last = 0;
      Math.random = () => {
        if (queue.length) last = queue.shift();
        return last;
      };
      window.__feedRand = values => { queue.length = 0; queue.push(...values); };
    });
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

    // contract defaults on the form itself
    assert.equal(await page.locator('#safePortsOnly').isChecked(), true, 'Safe Ports Only is the default');
    assert.equal(await page.locator('#sni').inputValue(), '4pda.to');
    assert.equal(await page.locator('#dns').inputValue(), '1.1.1.1,1.0.0.1');
    assert.equal(await page.locator('#ip').inputValue(), '172.16.0.2');
    assert.equal(await page.locator('#profileName').inputValue(), 'WARP-MASQUE');

    await page.evaluate(keys => {
      document.getElementById('privateKey').value = keys.pk;
      document.getElementById('publicKey').value = keys.pub;
    }, { pk: PK, pub: PUB });

    async function generate(randValues, { count, safePortsOnly, profile } = {}) {
      await page.evaluate(v => { window.__feedRand(v); }, randValues);
      if (count) await page.fill('#pairCount', String(count));
      if (safePortsOnly !== undefined) await page.setChecked('#safePortsOnly', safePortsOnly);
      if (profile !== undefined) await page.fill('#profileName', profile);
      await page.evaluate(() => generateWarp());
      return page.evaluate(() => lastGeneratedLinks.slice());
    }

    // urlEncodeKey contract
    assert.equal(await page.evaluate(() => urlEncodeKey('a+b/c=')), 'a%2Bb%2Fc%3D');

    // QUIC pool, order, port 443, no network=h2; pair numbering
    let links = await generate([0, 0, 0, 0, 0, 0, 0, 0, 0], { count: 3 });
    assert.equal(links.length, 6);
    const quic = links.filter(l => parseLink(l).name.includes('-QUIC'));
    assert.deepEqual(quic.map(l => parseLink(l).host + ':' + parseLink(l).port),
      ['162.159.198.2:443', '162.159.198.1:443', '162.159.199.2:443'], 'fixed QUIC pool, always port 443');
    assert.deepEqual(quic.map(l => parseLink(l).name), ['WARP-MASQUE-QUIC-1', 'WARP-MASQUE-QUIC-2', 'WARP-MASQUE-QUIC-3'],
      'count>1 numbers every pair, first included');
    for (const l of quic) assert.ok(!parseLink(l).q['network'], 'QUIC links carry no network=h2');
    rec('quic-pool', { endpoints: quic.map(l => parseLink(l).host + ':' + parseLink(l).port) });

    // Weighted buckets, safe mode: boundary rands deterministically hit each bucket.
    // weightedRandom: r = rand*100; each bucket owns (prevEdge, edge] (the `<= 0`
    // comparison makes the upper edge inclusive; exact products like 0.9*100 === 90
    // land on the upper bucket, so the next bucket starts just above the edge).
    const safeBuckets = [
      ['0', '443'], ['0.69999', '443'], ['0.7', '443'], ['0.700001', '8443'],
      ['0.89999', '8443'], ['0.9', '8443'], ['0.900001', '4443'], ['0.949999', '4443'], ['0.95', '4443'],
      ['0.950001', '8095'], ['0.999999', '8095'],
    ];
    for (const [r, port] of safeBuckets) {
      links = await generate([Number(r), 0, 0], { count: 1 });
      const h2 = parseLink(links[1]);
      assert.equal(String(h2.port), port, 'safe bucket rand ' + r + ' -> port ' + port);
      assert.match(h2.name, new RegExp('-H2-' + port + '$'));
    }
    rec('safe-buckets', { covered: [...new Set(safeBuckets.map(b => b[1]))] });

    // Full mode: extra VPN ports become reachable through their own buckets.
    for (const [r, port] of [['0.79', '500'], ['0.84', '1701'], ['0.9', '4500'], ['0.999999', '8443']]) {
      links = await generate([Number(r), 0, 0], { count: 1, safePortsOnly: false });
      assert.equal(String(parseLink(links[1]).port), port, 'full bucket rand ' + r + ' -> port ' + port);
    }
    // Safe mode can never produce the VPN ports even at the far end of the range.
    links = await generate([0.999999, 0, 0], { count: 1, safePortsOnly: true });
    assert.ok(['443', '8443', '4443', '8095'].includes(String(parseLink(links[1]).port)));
    rec('full-mode-ports', { extra: ['500', '1701', '4500'] });

    // H2 IP ranges: subnet 198/199, octet 1..254 (never .0/.255); boundary octets.
    for (const [subnetRand, octetRand, ip] of [
      ['0.75', String(136 / 254), '162.159.199.137'],
      ['0.499999', '0', '162.159.198.1'],
      ['0.5', '0.999999', '162.159.199.254'],
    ]) {
      links = await generate([0.8, Number(subnetRand), Number(octetRand)], { count: 1 }); // port 8443: no QUIC correlation
      assert.equal(parseLink(links[1]).host, ip, 'H2 ip rand ' + subnetRand + '/' + octetRand);
    }
    rec('h2-ip-ranges', { sample: '162.159.199.137', bounds: ['162.159.198.1', '162.159.199.254'] });

    // Anti-correlation: H2 port 443 (== QUIC port) must not reuse the QUIC IP.
    // Force the first pick onto the excluded QUIC endpoint (162.159.198.2,
    // rand 0.1 -> subnet 198, rand 1/254 -> octet 2); the generator must retry
    // and return the second pick (162.159.199.99).
    links = await generate([0, 0.1, 0.004, 0.6, 98 / 254], { count: 1 });
    assert.equal(parseLink(links[0]).host, '162.159.198.2');
    const h2 = parseLink(links[1]);
    assert.equal(h2.q['network'], 'h2');
    assert.equal(h2.host, '162.159.199.99', 'collision with QUIC IP must be retried away');
    rec('anti-correlation', { quic: parseLink(links[0]).host, h2: h2.host });

    // Escape hatch: after 19 rejected collisions the generator returns the only
    // candidate (documents the attempts>18 branch; both sides are 443 then).
    // 20 pairs of (subnet=198, octet=2) rands: attempts 0..18 are rejected as
    // collisions, attempt 19 hits `attempts > 18` and returns the duplicate.
    links = await generate([0, ...Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.1 : 0.005))], { count: 1 });
    assert.equal(parseLink(links[1]).host, '162.159.198.2', 'attempts>18 fallback returns the candidate');

    // urlEncodeKey through the full link + round-trip through the runtime parser.
    links = await generate([0.8, 0.75, 136 / 254], { count: 1 });
    const h2Link = links[1];
    assert.ok(h2Link.includes('private-key=abc%2Bdef%2Fghi%3D'), 'pk encoded');
    assert.ok(h2Link.includes('public-key=pub%2Bkey%3D'), 'pub encoded');
    const ctx = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa });
    vm.runInContext(fs.readFileSync(path.join(root, 'web4core.runtime.js'), 'utf8'), ctx);
    const beans = ctx.web4core.buildBeansFromInput(links.join('\n'));
    assert.equal(beans.length, 2);
    const bean = beans[1];
    assert.equal(bean.host, '162.159.199.137');
    assert.equal(bean.port, 8443);
    assert.equal(bean.masque.privateKey, PK, 'round-trip decodes %2B/%2F/%3D');
    assert.equal(bean.masque.publicKey, PUB);
    assert.equal(bean.masque.sni, '4pda.to');
    assert.equal(bean.masque.network, 'h2');
    assert.deepEqual([...bean.masque.dns], ['1.1.1.1', '1.0.0.1']); // spread: vm-realm array
    rec('round-trip', { bean: { host: bean.host, port: bean.port, network: bean.masque.network } });

    // Defaults and empty-profile fallback
    await page.fill('#profileName', '');
    links = await generate([0.8, 0.75, 136 / 254], { count: 1 });
    const q = parseLink(links[0]).q;
    assert.equal(q.sni, '4pda.to');
    assert.equal(q.dns, '1.1.1.1,1.0.0.1');
    assert.equal(q.ip, '172.16.0.2');
    assert.equal(q.udp, 'true');
    assert.equal(q['remote-dns-resolve'], 'true');
    assert.match(links[0].split('#')[1], /^WARP-MASQUE-QUIC$/, 'empty profile falls back to WARP-MASQUE');
    rec('defaults', { sni: q.sni, dns: q.dns, ip: q.ip });

    console.log('PASS masque-dpi-regression: ' + results.length + ' groups');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

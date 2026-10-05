// YAML parity regression: byte-identical output contract for the scenarios
// that must not change without an explicit owner decision. Runs the same
// DOM-driven build against two checkouts (base ref and the current tree) and
// compares the YAML byte-for-byte (x-hwid normalized).
//
// Usage: node tests/parity.cjs <baseRoot> <candRoot>
//   baseRoot — checkout of the comparison base (CI: merge-base with main;
//              локально: второй worktree, например origin/main).
//
// Если PR сознательно меняет default-вывод одного из сценариев — обнови
// сценарий/ожидание в этом файле в том же PR и объясни это в описании PR:
// красная parity = сигнал, что дефолтный YAML меняется молча.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function build(page) {
  await page.locator('button[onclick="buildMihomo()"]').click();
  await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID', null, { timeout: 15000 });
  return page.evaluate(() => document.getElementById('mihomoOutput').value);
}

async function runScenario(browser, root, candRoot, name, actions) {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
  await actions(page, candRoot);
  let yaml = await build(page);
  await page.close();
  // x-hwid — случайный per-subscription идентификатор Mihomo-провайдера;
  // нормализуем, он не является частью сравниваемого контракта.
  // EXPECTED v1.8.0 default change (web4core#13): Google health-check URL
  // заменён на официальный https://www.gstatic.com/generate_204 — нормализуем
  // к старому, чтобы parity ловила только посторонние изменения.

  yaml = yaml.replace(/https:\/\/www\.gstatic\.com\/generate_204/g, 'https://google.com/generate_204');
  return yaml.replace(/^[ \t]+- [0-9a-f]{32}$/gm, 'XHWID');
}

(async () => {
  const [,, baseRoot, candRoot] = process.argv;
  if (!baseRoot || !candRoot) {
    console.error('usage: node tests/parity.cjs <baseRoot> <candRoot>');
    process.exit(2);
  }
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const scenarios = {
    router: async p => {
      await p.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\ntrojan://t@192.0.2.2:443#B');
      await p.locator('#cfgSubMode').uncheck();
    },
    'vps-local': async p => {
      await p.selectOption('#cfgProfile', 'vps-local');
      // Осознанное изменение контракта (v1.7.1): external-controller в VPS-профилях
      // стал 127.0.0.1:9090 (было 0.0.0.0:9090). Сценарий явно выключает Web UI,
      // чтобы сравнивать неизменившуюся часть вывода; дефолтная дельта закреплена
      // в tests/profile-matrix.cjs (§26 controller bind).
      await p.locator('#cfgWebUI').uncheck();
      await p.fill('#mihomoInput', 'ss://YWVzLTI1Ni1nY206dGVzdHBhc3M=@192.0.2.1:443#s1');
      await p.locator('#cfgSubMode').uncheck();
    },
    'vps-gateway': async p => {
      await p.selectOption('#cfgProfile', 'vps-gateway');
      // см. vps-local: контроллер-bind стал профильным (127.0.0.1), Web UI выключен явно
      await p.locator('#cfgWebUI').uncheck();
      // Осознанное изменение контракта (fix/vps-allow-lan-router-only): Allow LAN
      // стал router-only, в VPS-профилях выключается принудительно. Пользователь
      // в сценарии явно выключает чекбокс: на старом коде он протекал из router
      // default (allow-lan: true + bind-address: "*"), на новом уже disabled+OFF.
      // Дефолтный контракт vps-gateway (allow-lan: false без действий) закреплён
      // в tests/profile-matrix.cjs.
      if (await p.locator('#cfgLan').isEnabled()) await p.locator('#cfgLan').uncheck();
      await p.fill('#mihomoInput', 'ss://YWVzLTI1Ni1nY206dGVzdHBhc3M=@192.0.2.1:443#s1');
      await p.locator('#cfgSubMode').uncheck();
    },
    'vps-gateway-dns-off': async p => {
      await p.selectOption('#cfgProfile', 'vps-gateway');
      await p.locator('#cfgWebUI').uncheck();
      if (await p.locator('#cfgLan').isEnabled()) await p.locator('#cfgLan').uncheck();
      await p.locator('#vpsDnsEnabled').uncheck();
      await p.fill('#mihomoInput', 'ss://YWVzLTI1Ni1nY206dGVzdHBhc3M=@192.0.2.1:443#s1');
      await p.locator('#cfgSubMode').uncheck();
    },
    'dpr-on': async p => {
      await p.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A\nvless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#B');
      await p.locator('#cfgSubMode').uncheck();
      await p.locator('#cfgPolicyRouting').check();
      await p.locator('#btnPolicyAdd').click();
    },
    'wg-single': async p => {
      await p.locator('#wgFile').setInputFiles(path.join(candRoot, 'tests', 'fixtures', 'awg31.conf'));
      await p.waitForFunction(() => wgUploadPending === false && wgBeans.length === 1);
      await p.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');
      await p.locator('#cfgSubMode').uncheck();
    },
    'auto-whitelist': async p => {
      await p.locator('#cfgAutoWhitelist').check();
      await p.fill('#mihomoInput', 'vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');
      await p.fill('#whitelistInput', 'vless://00000000-0000-4000-8000-000000000002@192.0.2.2:443#F1');
      await p.locator('#cfgSubMode').uncheck();
    },
  };
  let fail = 0;
  for (const [name, actions] of Object.entries(scenarios)) {
    const a = await runScenario(browser, baseRoot, candRoot, name, actions);
    const b = await runScenario(browser, candRoot, candRoot, name, actions);
    const same = a === b;
    if (!same) fail++;
    console.log(`${same ? 'PARITY-OK ' : 'PARITY-DIFF'} ${name} (base ${a.length}B / cand ${b.length}B)`);
    if (!same) {
      const out = process.env.PARITY_OUT_DIR || process.env.RUNNER_TEMP || '.';
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, `diff-${name}.txt`), `--- BASE\n${a}\n\n--- CAND\n${b}`);
    }
  }
  await browser.close();
  console.log(fail === 0 ? 'ALL PARITY' : `${fail} DIFFS`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

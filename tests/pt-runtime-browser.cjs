// PT Runtime Evidence UI (#188, v1.11) — browser regression с synthetic-контроллерами.
// Никаких реальных контроллеров: все ответы — page.route моки (Fixture A/B/C/E/G).
// Секреты: SUPER_SECRET_RUNTIME_TOKEN_123 не должен появиться нигде кроме input.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let passed = 0;
const ok = name => { passed++; console.log('  ok —', name); };

const SECRET = 'SUPER_SECRET_RUNTIME_TOKEN_123';
const PROXIES_CONSISTENT = JSON.stringify({ proxies: {
  GLOBAL: { type: 'Selector', now: 'TO_EE', all: ['TO_EE'] },
  'TO_EE': { type: 'Selector', now: 'EE-Mieru', all: ['EE-Mieru', 'EE-VLESS', 'DIRECT'], alive: true },
  'EE-Mieru': { type: 'ss', alive: true }
}});
const PROXIES_DIRECT = JSON.stringify({ proxies: {
  'TO_SE': { type: 'Selector', now: 'DIRECT', all: ['SE-WG', 'DIRECT'], alive: true },
  'SE-WG': { type: 'wireguard', alive: true }
}});

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const controllerRequests = [];
  let slowStartedResolve;
  const slowStarted = new Promise(resolve => { slowStartedResolve = resolve; });
  if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));

  // synthetic controllers (Fixture A/C/E): ни один реальный контроллер не задействован
  await page.route('http://127.0.0.1:19090/**', (route, request) => {
    controllerRequests.push(request.url());
    if (request.url().endsWith('/version')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'v1.19.32-test' }) });
    return route.fulfill({ contentType: 'application/json', body: PROXIES_CONSISTENT });
  });
  await page.route('http://127.0.0.1:29090/**', (route, request) => {
    controllerRequests.push(request.url());
    if (request.url().endsWith('/version')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Unauthorized"}' });
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Unauthorized"}' });
  });
  await page.route('http://127.0.0.1:39090/**', (route, request) => {
    controllerRequests.push(request.url());
    if (request.url().endsWith('/version')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'v1.19.32-test' }) });
    return route.fulfill({ contentType: 'application/json', body: PROXIES_DIRECT });
  });
  await page.route('http://127.0.0.1:49090/**', (route, request) => {
    controllerRequests.push(request.url());
    return route.abort('connectionrefused'); // Fixture B: unreachable
  });
  await page.route('http://127.0.0.1:59090/**', async (route, request) => {
    controllerRequests.push(request.url());
    slowStartedResolve();
    await new Promise(resolve => setTimeout(resolve, 500));
    if (request.url().endsWith('/version')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'v1.19.32-slow' }) });
    return route.fulfill({ contentType: 'application/json', body: PROXIES_CONSISTENT });
  });

  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);

  await page.locator('#physicalTopologyPanel > summary').click();
  await page.locator('#ptDemoBtn').click();
  await page.waitForFunction(() => document.getElementById('ptGraphBox').style.display === 'block', null, { polling: 250 });
  await page.locator('#ptRuntimePanel > summary').click();

  // --- 1. профили появились для 3 физических узлов (overlay исключён) ---
  const profileBoxes = await page.locator('#ptRuntimeProfiles > div').count();
  assert.equal(profileBoxes, 3, 'профили для 3 физических узлов');
  // --- 2. no auto-fetch: до клика ни одного запроса ---
  assert.equal(controllerRequests.length, 0, 'нет auto-fetch');
  ok('профили рендерятся, auto-fetch отсутствует');

  // --- 3. memory-only: ввод секретов не пишет storage ---
  await page.fill('input[data-rt-node="msk-entry"][data-rt-key="endpoint"]', '127.0.0.1:19090');
  await page.fill('input[data-rt-node="msk-entry"][data-rt-key="secret"]', SECRET);
  await page.fill('input[data-rt-node="msk-entry"][data-rt-key="group"]', 'TO_EE');
  await page.fill('input[data-rt-node="msk-entry"][data-rt-key="members"]', 'EE-Mieru, EE-VLESS');
  await page.fill('input[data-rt-node="est-transit"][data-rt-key="endpoint"]', '127.0.0.1:29090');
  await page.fill('input[data-rt-node="est-transit"][data-rt-key="group"]', 'TO_MISSING');
  await page.fill('input[data-rt-node="est-transit"][data-rt-key="members"]', 'EE-Mieru');
  await page.fill('input[data-rt-node="swe-exit"][data-rt-key="endpoint"]', '127.0.0.1:39090');
  await page.fill('input[data-rt-node="swe-exit"][data-rt-key="group"]', 'TO_SE');
  await page.fill('input[data-rt-node="swe-exit"][data-rt-key="members"]', 'SE-WG');
  const storage = await page.evaluate(() => ({
    localBefore: null,
    keys: []
  }));
  // память-only контракт: ни одного ключа runtime-evidence ни в одном storage;
  // (device-identities — легитимное существующее хранилище другой фичи)
  const rt = await page.evaluate(() => {
    const all = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
    return all.filter(k => /runtime|evidence|pt-/i.test(k));
  });
  assert.deepEqual(rt, [], 'никаких runtime-evidence ключей в storage');
  ok('memory-only профили/секреты');

  // --- 4. явная проверка: CONSISTENT + AUTH_ERROR + INCONSISTENT(DIRECT) ---
  await page.locator('#ptRuntimeCheckBtn').click();
  await page.waitForFunction(() => {
    const t = document.getElementById('ptRuntimeStatus').textContent;
    return t.includes('Chain evidence:');
  }, null, { polling: 250, timeout: 15000 });
  const status = await page.textContent('#ptRuntimeStatus');
  const out = await page.textContent('#ptRuntimeOut');
  assert.ok(status.includes('Chain evidence: INCONSISTENT'), 'DIRECT на swe → INCONSISTENT в агрегате: ' + status);
  assert.ok(out.includes('Moscow · ENTRY'), 'Moscow в отчёте');
  assert.ok(out.includes('INTENDED'), 'INTENDED блок присутствует');
  assert.ok(out.includes('RUNTIME EVIDENCE'), 'OBSERVED блок присутствует');
  assert.ok(out.includes('OBSERVED'), 'состояние OBSERVED для Moscow');
  assert.ok(out.includes('AUTH_ERROR'), '401 на Estonia → AUTH_ERROR');
  assert.ok(out.includes('INCONSISTENT'), 'DIRECT на Sweden → INCONSISTENT');
  assert.ok(out.includes('TO_EE → EE-Mieru') || out.includes('TO_EE → EE-Mieru'), 'selection chain отображён');
  assert.ok(out.includes('Packet-path') || out.includes('packet-path'), 'дисклеймер packet-path присутствует');
  assert.ok(out.includes('не является доказательством пути пакета') || out.includes('Packet-path не доказывается'), 'прямой дисклеймер');
  ok('проверка: states/verdicts/дисклеймеры');

  // --- 5. секрет нигде кроме input ---
  const bodyText = await page.evaluate(() => document.body.innerText);
  assert.ok(!bodyText.includes(SECRET), 'секрет не в тексте страницы');
  assert.ok(!controllerRequests.some(u => u.includes(SECRET)), 'секрет не в URL');
  ok('секрет не утёк в рендер/URL');

  // --- 6. topologie immutable ---
  const specBefore = await page.inputValue('#ptSpecInput');
  assert.ok(specBefore.includes('msk-entry'), 'спецификация на месте');

  // --- 7. Fixture B: unreachable middle → PARTIAL, не «узел выключен» ---
  // (swe → консистентный контроллер, чтобы INCONSISTENT не маскировал PARTIAL)
  await page.fill('input[data-rt-node="msk-entry"][data-rt-key="endpoint"]', '127.0.0.1:19090');
  await page.fill('input[data-rt-node="est-transit"][data-rt-key="endpoint"]', '127.0.0.1:49090');
  await page.fill('input[data-rt-node="swe-exit"][data-rt-key="endpoint"]', '127.0.0.1:19090');
  await page.fill('input[data-rt-node="swe-exit"][data-rt-key="group"]', 'TO_EE');
  await page.fill('input[data-rt-node="swe-exit"][data-rt-key="members"]', 'EE-Mieru, EE-VLESS');
  await page.locator('#ptRuntimeCheckBtn').click();
  await page.waitForFunction(() => document.getElementById('ptRuntimeStatus').textContent.includes('Chain evidence: PARTIAL'), null, { polling: 250, timeout: 15000 });
  const out2 = await page.textContent('#ptRuntimeOut');
  assert.ok(out2.includes('UNREACHABLE'), 'UNREACHABLE состояние');
  assert.ok(out2.includes('НЕ означает, что узел выключен'), 'UNREACHABLE ≠ node down');
  assert.ok(!/CHAIN DOWN|цепочка мертва/i.test(out2), 'никакого «CHAIN DOWN»');
  ok('Fixture B: unreachable → PARTIAL');

  // --- 8. STALE структурный: изменили binding после проверки → рендер помечает ---
  await page.fill('input[data-rt-node="swe-exit"][data-rt-key="group"]', 'ДРУГАЯ_ГРУППА');
  const statusStale = await page.textContent('#ptRuntimeStatus');
  assert.ok(statusStale.includes('STALE'), 'структурный STALE после изменения профилей: ' + statusStale);
  ok('profile edit automatically marks evidence STALE');

  // --- 9. delayed response cannot overwrite a changed runtime profile ---
  await page.fill('input[data-rt-node="msk-entry"][data-rt-key="endpoint"]', '127.0.0.1:59090');
  await page.fill('input[data-rt-node="est-transit"][data-rt-key="endpoint"]', '');
  await page.fill('input[data-rt-node="swe-exit"][data-rt-key="endpoint"]', '');
  await page.locator('#ptRuntimeCheckBtn').click();
  await slowStarted;
  await page.fill('input[data-rt-node="msk-entry"][data-rt-key="group"]', 'CHANGED_DURING_FETCH');
  await page.waitForTimeout(650);
  const canceledStatus = await page.textContent('#ptRuntimeStatus');
  const canceledOut = await page.textContent('#ptRuntimeOut');
  assert.ok(canceledStatus.includes('STALE') && canceledStatus.includes('отменена'), 'profile edit cancels and marks in-flight check stale: ' + canceledStatus);
  assert.ok(!canceledOut.includes('controller: reachable'), 'late response did not overwrite current profile state');
  ok('stale response race guard');

  // --- 10. topology draft is stale and cannot be checked before re-analysis ---
  const beforeDraftCheck = controllerRequests.length;
  await page.fill('#ptSpecInput', specBefore.replace('Moscow', 'Moscow edited'));
  const draftStatus = await page.textContent('#ptRuntimeStatus');
  assert.ok(draftStatus.includes('STALE'), 'topology draft change marks evidence stale');
  await page.locator('#ptRuntimeCheckBtn').click();
  assert.ok((await page.textContent('#ptRuntimeStatus')).includes('Сначала проанализируйте'), 'changed topology cannot reuse old analyzed model');
  assert.equal(controllerRequests.length, beforeDraftCheck, 'no controller request for stale topology draft');
  await page.locator('#ptAnalyzeBtn').click();
  await page.fill('#ptSpecInput', specBefore);
  await page.locator('#ptAnalyzeBtn').click();
  // --- topology/artifacts are not modified by evidence ---
  const specAfter = await page.inputValue('#ptSpecInput');
  assert.equal(specAfter, specBefore, 'spec restored without runtime evidence mutation');
  assert.ok(await page.evaluate(() => !document.getElementById('mihomoOutput').value.includes('runtime-evidence')), 'generated YAML чист');
  ok('topology/config immutable');

  // --- 11. mobile widths: runtime profiles, evidence, controls ---
  for (const width of [320, 360, 390, 412, 480]) {
    await page.setViewportSize({ width, height: 820 });
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(overflow.sw <= overflow.iw + 1, 'mobile ' + width + ': no runtime evidence overflow (' + overflow.sw + ' vs ' + overflow.iw + ')');
    passed++;
  }

  assert.deepEqual(errors, [], 'нет pageerror');
  await browser.close();
  console.log('PASS pt-runtime-browser: ' + passed + ' checks');
})().catch(e => { console.error('FAIL:', e.message); console.error('AT:', (e.stack || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ')); process.exit(1); });

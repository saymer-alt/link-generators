// #349 i18n foundation: dictionary contract + t() semantics, Node-only (no browser).
// Verifies RU/EN key parity, safe text-only interpolation, enum-only persistence
// with memory fallback, and that i18n.js introduces no network/HTML-injection surface.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
const DICT_KEYS = [
  'ui.lang.label', 'ui.lang.title',
  'ui.tabs.warp', 'ui.tabs.builder', 'ui.tabs.studio',
  'ui.warp.parsedBadge',
  'ui.warp.import.title', 'ui.warp.import.placeholder', 'ui.warp.import.parse',
  'ui.warp.import.clear', 'ui.warp.import.hint',
  'ui.warp.params.title', 'ui.warp.params.profileName'
];

function makeSandbox({ storage, storedValue } = {}) {
  const doc = {
    readyState: 'complete',
    documentElement: { lang: 'ru' },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  const storageMap = new Map();
  const win = {
    document: doc,
    addEventListener: () => {}
  };
  if (storage === 'throw') {
    Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError'); } });
  } else if (storage === 'map') {
    win.localStorage = {
      getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v))
    };
    if (storedValue !== undefined) storageMap.set('link-generators.locale.v1', storedValue);
  }
  const ctx = vm.createContext({ window: win, document: doc, console });
  vm.runInContext(src, ctx, { filename: 'i18n.js' });
  return { api: ctx.window.LGI18N, doc, storageMap, win };
}

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.error('FAIL', name, e.message); }
}

check('source hygiene: no fetch/XHR/WS/import()/innerHTML assignment in i18n.js', () => {
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /XMLHttpRequest|WebSocket|EventSource|\bimport\s*\(/);
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.doesNotMatch(src, /document\.cookie|navigator\.geolocation/);
});

check('RU/EN exact key parity: identical key sets, no empty/non-string values', () => {
  const { api } = makeSandbox();
  const ru = Object.keys(api.DICT.ru).sort(), en = Object.keys(api.DICT.en).sort();
  assert.deepEqual(ru, en, 'key sets differ');
  assert.deepEqual(ru, [...DICT_KEYS].sort(), 'unexpected/missing dictionary keys');
  for (const k of ru) {
    assert.equal(typeof api.DICT.ru[k], 'string', 'ru[' + k + '] not a string');
    assert.equal(typeof api.DICT.en[k], 'string', 'en[' + k + '] not a string');
    assert.ok(api.DICT.ru[k].length > 0, 'ru[' + k + '] empty');
    assert.ok(api.DICT.en[k].length > 0, 'en[' + k + '] empty');
  }
});

check('default lang is ru and html lang synced', () => {
  const { api, doc } = makeSandbox({ storage: 'map' });
  assert.equal(api.getLang(), 'ru');
  assert.equal(doc.documentElement.lang, 'ru');
});

check('t() resolves RU by default, EN after setLang, html lang follows', () => {
  const { api, doc } = makeSandbox({ storage: 'map' });
  assert.equal(api.t('ui.warp.import.parse'), '🔍 Распарсить');
  assert.equal(api.setLang('en'), true);
  assert.equal(api.getLang(), 'en');
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(api.t('ui.warp.import.parse'), '🔍 Parse');
  assert.equal(api.setLang('ru'), true);
  assert.equal(api.t('ui.warp.import.parse'), '🔍 Распарсить');
});

check('setLang rejects non-enum values (no detection, no free-form locale)', () => {
  const { api, doc } = makeSandbox({ storage: 'map' });
  for (const bad of ['de', 'RU', '', null, undefined, ' ru', 'en-US']) {
    assert.equal(api.setLang(bad), false, 'accepted ' + JSON.stringify(bad));
  }
  assert.equal(api.getLang(), 'ru');
  assert.equal(doc.documentElement.lang, 'ru');
});

check('missing key falls back to key itself without throwing', () => {
  const { api } = makeSandbox();
  assert.equal(api.t('ui.does.not.exist'), 'ui.does.not.exist');
  assert.equal(api.t(''), '');
  assert.equal(api.t(null), '');
});

check('interpolation is text-only string substitution (no HTML execution surface)', () => {
  const { api } = makeSandbox();
  api.DICT.ru['__test.hi'] = 'Привет, {name}!';
  api.DICT.en['__test.hi'] = 'Hello, {name}!';
  try {
    assert.equal(api.t('__test.hi', { name: 'МИР' }), 'Привет, МИР!');
    assert.equal(api.setLang('en'), true);
    assert.equal(api.t('__test.hi', { name: 'world' }), 'Hello, world!');
    const payload = '<img src=x onerror=window.__xss=1>';
    assert.equal(api.t('__test.hi', { name: payload }), 'Hello, ' + payload + '!');
    // Unknown params and repeated tokens behave literally; ${} stays inert text.
    assert.equal(api.t('__test.hi'), 'Hello, {name}!');
    assert.equal(api.t('__test.hi', { name: '${process.exit}' }), 'Hello, ${process.exit}!');
  } finally {
    delete api.DICT.ru['__test.hi'];
    delete api.DICT.en['__test.hi'];
  }
  assert.deepEqual(Object.keys(api.DICT.ru).sort(), [...DICT_KEYS].sort(), 'temp key leaked');
  assert.deepEqual(Object.keys(api.DICT.en).sort(), [...DICT_KEYS].sort(), 'temp key leaked');
});

check('persistence stores ONLY the enum string in the dedicated key', () => {
  const { api, storageMap } = makeSandbox({ storage: 'map' });
  api.setLang('en');
  assert.equal(storageMap.get('link-generators.locale.v1'), 'en');
  assert.equal(storageMap.size, 1, 'i18n must not write other keys');
  api.setLang('ru');
  assert.equal(storageMap.get('link-generators.locale.v1'), 'ru');
  api.setLang('de');
  assert.equal(storageMap.get('link-generators.locale.v1'), 'ru', 'rejected value must not touch storage');
});

check('invalid stored value is ignored (fresh start falls back to ru)', () => {
  const { api } = makeSandbox({ storage: 'map', storedValue: 'fr' });
  assert.equal(api.getLang(), 'ru');
  const { api: api2 } = makeSandbox({ storage: 'map', storedValue: 'ru' });
  assert.equal(api2.getLang(), 'ru');
  const { api: api3 } = makeSandbox({ storage: 'map', storedValue: 'en' });
  assert.equal(api3.getLang(), 'en');
});

check('storage throwing: setLang still switches via memory fallback, no throw', () => {
  const { api, doc } = makeSandbox({ storage: 'throw' });
  assert.equal(api.setLang('en'), true);
  assert.equal(api.getLang(), 'en');
  assert.equal(doc.documentElement.lang, 'en');
});

check('storage unavailable: memory fallback holds the choice for the session', () => {
  const { win, doc } = makeSandbox({ storage: 'throw' });
  const api = win.LGI18N;
  assert.equal(api.getLang(), 'ru'); // fresh init without storage → default ru
  assert.equal(api.setLang('en'), true);
  assert.equal(api.getLang(), 'en'); // memory fallback retains the choice
  assert.equal(api.t('ui.warp.import.parse'), '🔍 Parse');
  assert.equal(doc.documentElement.lang, 'en');
});

check('STORAGE_KEY is dedicated/versioned and carries no user data by design', () => {
  const { api } = makeSandbox();
  assert.equal(api.STORAGE_KEY, 'link-generators.locale.v1');
  assert.deepEqual(JSON.parse(JSON.stringify(api.LANGS)), ['ru', 'en']); // cross-realm array
  assert.equal(api.DEFAULT_LANG, 'ru');
});

console.log('\ni18n-foundation: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

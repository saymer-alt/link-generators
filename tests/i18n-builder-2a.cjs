// #353 Phase 2A — Builder i18n slice: словарь/разметка/динамическая подсказка.
// Node-only контракт: RU/EN parity builder-ключей, RU-значения совпадают с
// исходными текстами index.html (никакого дрейфа), разметка data-i18n /
// allowlisted data-i18n-attr не трогает form-контролы (data-i18n запрещён на
// input/select/textarea — значение не переводится), option.value не изменились,
// profileHintLocalized падает на RU-константу при отсутствии i18n, onLangChange
// уведомляет только при валидном переключении. Язык не попадает в YAML/fingerprint
// (проверяется структурно: data-i18n не касается генераторов; runtime — browser-тест).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const i18nSrc = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const BUILDER_KEYS = [
  'builder.actionbar.aria', 'builder.build.title',
  'builder.downloadYaml', 'builder.openStudio', 'builder.copy.title',
  'builder.saveProject', 'builder.saveProject.title',
  'builder.loadProject', 'builder.loadProject.title',
  'builder.undoRestore', 'builder.undoRestore.title',
  'builder.rebuild', 'builder.reset', 'builder.jumpToYaml',
  'builder.nav.aria', 'builder.section.start',
  'builder.nav.routing', 'builder.nav.diagnostics', 'builder.nav.options',
  'builder.toolsDirectory', 'builder.quickStart.steps',
  'builder.profile.title',
  'builder.profile.option.router', 'builder.profile.option.vpsLocal', 'builder.profile.option.vpsGateway',
  'builder.profile.hint.router', 'builder.profile.hint.vps-local', 'builder.profile.hint.vps-gateway',
  'builder.awl.routerHint',
  'builder.routing.title', 'builder.routing.awlToggle',
  'builder.sources.title', 'builder.sources.label', 'builder.sources.placeholder',
  'builder.sources.providerRowsAria', 'builder.sources.reserveLabel', 'builder.sources.reserveRowsAria'
];

// RU-значения обязаны совпадать с исходными текстами продукта (обнаружение
// случайного дрейфа при переводе: словарь — зеркало существующего UI).
const RU_EXPECT = {
  'builder.actionbar.aria': 'Действия Builder',
  'builder.build.title': 'Собрать YAML из текущих данных и настроек; после сборки выполняется автоматическая проверка структуры',
  'builder.downloadYaml': '💾 Скачать YAML',
  'builder.openStudio': '🔎 Открыть YAML в Config Studio',
  'builder.copy.title': 'Скопировать итоговый YAML (доступно только после успешной проверки)',
  'builder.saveProject': '💾 Сохранить проект',
  'builder.loadProject': '📂 Загрузить проект',
  'builder.undoRestore': '↩︎ Отменить восстановление',
  'builder.rebuild': 'Пересобрать YAML',
  'builder.reset': '🧹 Сбросить проект',
  'builder.jumpToYaml': '↓ Перейти к YAML',
  'builder.nav.aria': 'Разделы Mihomo Builder',
  'builder.section.start': '🏠 Быстрый старт',
  'builder.nav.routing': '🌐 Маршрутизация и DNS',
  'builder.nav.diagnostics': '🔍 Диагностика',
  'builder.nav.options': '⚙️ Дополнительно',
  'builder.toolsDirectory': 'Все инструменты — экспертный доступ',
  'builder.profile.title': '🎯 Где будет работать Mihomo?',
  'builder.profile.option.router': 'Роутер / обычный TUN (Keenetic)',
  'builder.profile.option.vpsLocal': 'VPS — локальный Mihomo / SOCKS для Xray / 3X-UI',
  'builder.profile.option.vpsGateway': 'VPS Transparent Gateway (amnezia-mihomo-gateway)',
  'builder.awl.routerHint': 'Автоматический режим белых списков доступен только для профиля «Роутер / обычный TUN».',
  'builder.routing.title': '🛡️ 2. Режим маршрутизации',
  'builder.routing.awlToggle': '🛡️ Автоматический режим белых списков',
  'builder.sources.title': '📋 3. Основные серверы и подписки',
  'builder.sources.label': 'Основные серверы и подписки',
  'builder.sources.providerRowsAria': 'Имена основных подписок',
  'builder.sources.reserveLabel': 'Резервные серверы и подписки',
  'builder.sources.reserveRowsAria': 'Имена резервных подписок'
};

const ATTR_ALLOWLIST = { 'title': true, 'placeholder': true, 'aria-label': true, 'aria-description': true };

function loadI18n({ storedValue } = {}) {
  const doc = {
    readyState: 'complete',
    documentElement: { lang: 'ru' },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  const storageMap = new Map();
  const win = { document: doc, addEventListener: () => {} };
  win.localStorage = {
    getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v))
  };
  if (storedValue !== undefined) storageMap.set('link-generators.locale.v1', storedValue);
  const ctx = vm.createContext({ window: win, document: doc, console });
  vm.runInContext(i18nSrc, ctx, { filename: 'i18n.js' });
  return { api: ctx.window.LGI18N, doc, win };
}

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.error('FAIL', name, e.message); }
}

check('dictionary: 37 builder-ключей, RU/EN parity, непустые строки', () => {
  const { api } = loadI18n();
  for (const k of BUILDER_KEYS) {
    assert.equal(typeof api.DICT.ru[k], 'string', 'ru[' + k + '] missing');
    assert.equal(typeof api.DICT.en[k], 'string', 'en[' + k + '] missing');
    assert.ok(api.DICT.ru[k].length > 0, 'ru[' + k + '] empty');
    assert.ok(api.DICT.en[k].length > 0, 'en[' + k + '] empty');
  }
  assert.equal(Object.keys(api.DICT.ru).length, Object.keys(api.DICT.en).length, 'key count parity');
  assert.deepEqual(Object.keys(api.DICT.ru).sort(), Object.keys(api.DICT.en).sort(), 'key set parity');
});

check('RU-значения зеркалят исходные тексты UI (без дрейфа при переводе)', () => {
  const { api } = loadI18n();
  for (const [k, expected] of Object.entries(RU_EXPECT)) {
    assert.equal(api.DICT.ru[k], expected, 'ru[' + k + '] drifted from product text');
  }
});

check('EN-переводы отличаются от RU и не содержат кириллицы (presentation только латиница/символы)', () => {
  const { api } = loadI18n();
  // Продуктовые имена/IDs легитимно совпадают в обоих языках.
  const EN_MAY_EQUAL_RU = new Set(['builder.profile.option.vpsGateway']);
  for (const k of BUILDER_KEYS) {
    if (!EN_MAY_EQUAL_RU.has(k)) {
      assert.notEqual(api.DICT.en[k], api.DICT.ru[k], 'en[' + k + '] === ru (not translated)');
    }
    assert.doesNotMatch(api.DICT.en[k], /[\u0400-\u04FF]/, 'en[' + k + '] contains Cyrillic');
  }
});

check('index.html: каждый статический builder-ключ подключён в разметке (data-i18n или data-i18n-attr)', () => {
  const DYNAMIC = new Set(['builder.profile.hint.router', 'builder.profile.hint.vps-local', 'builder.profile.hint.vps-gateway']);
  for (const k of BUILDER_KEYS) {
    if (DYNAMIC.has(k)) continue; // hint — динамический textContent из JS, не data-i18n
    const plain = (html.match(new RegExp('data-i18n="' + k + '"', 'g')) || []).length;
    const attr = (html.match(new RegExp('data-i18n-attr="[^"]*' + k + '[^"]*"', 'g')) || []).length;
    assert.ok(plain + attr >= 1, 'key not wired into markup: ' + k);
  }
  // динамический профильный hint НЕ подключается как data-i18n (он textContent из JS)
  assert.equal((html.match(/data-i18n="builder\.profile\.hint\./g) || []).length, 0,
    'profile hints are dynamic textContent messages, not data-i18n markup');
});

check('data-i18n не вешается на form-контролы (input/select/textarea) — значения не переводятся', () => {
  // data-i18n (text) запрещён на контролах; data-i18n-attr с allowlist-атрибутом разрешён.
  const re = /<(input|select|textarea)\b[^>]*\bdata-i18n="/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    assert.fail('data-i18n text assignment on a form control (' + m[1] + ') would overwrite its value');
  }
});

check('data-i18n-attr: только allowlisted атрибуты (никогда value/href/src/onclick)', () => {
  const re = /data-i18n-attr="([^"]+)"/g;
  let m, count = 0;
  while ((m = re.exec(html)) !== null) {
    count++;
    for (const pair of m[1].split(';')) {
      const attr = pair.trim().split(':')[0];
      assert.ok(ATTR_ALLOWLIST[attr], 'non-allowlisted attribute in data-i18n-attr: ' + attr);
    }
  }
  assert.ok(count >= 1, 'no data-i18n-attr usage found');
});

check('cfgProfile: option.value не изменились, router остаётся selected, тексты помечены data-i18n', () => {
  const block = html.match(/<select id="cfgProfile">[\s\S]*?<\/select>/)[0];
  assert.match(block, /<option value="router" selected data-i18n="builder\.profile\.option\.router">/, 'router option');
  assert.match(block, /<option value="vps-local" data-i18n="builder\.profile\.option\.vpsLocal">/, 'vps-local option');
  assert.match(block, /<option value="vps-gateway" data-i18n="builder\.profile\.option\.vpsGateway">/, 'vps-gateway option');
  assert.equal((block.match(/selected/g) || []).length, 1, 'exactly one selected option (RU default preserved)');
  assert.doesNotMatch(block, /value="(?:домашний|home|vpsLocal|vpsGateway)"/i, 'no renamed option values');
});

check('AWL-тогл: чекбокс вне span-обёртки, span-текст помечен data-i18n', () => {
  const row = html.match(/<div class="toggle-row"><label><input type="checkbox" id="cfgAutoWhitelist">[\s\S]{0,200}?ctx-help-wrap/)[0];
  assert.match(row, /<input type="checkbox" id="cfgAutoWhitelist"> <span data-i18n="builder\.routing\.awlToggle">/);
  assert.equal((row.match(/<input/g) || []).length, 1, 'exactly one checkbox input inside the label');
});

check('profileHintLocalized: EN/RU через LGI18N, fallback на RU-константу без i18n/ключа', () => {
  const m = html.match(/\/\/ === I18N BUILDER PROFILE HINT \(#353\) — START ===([\s\S]*?)\/\/ === I18N BUILDER PROFILE HINT \(#353\) — END ===/);
  assert.ok(m, 'marker slice not found');
  const code = m[1];
  const { api } = loadI18n();
  const mk = (win, profileHints, target) => {
    const fn = new Function('window', 'PROFILE_HINTS', 'target', code + '\nreturn profileHintLocalized(target);');
    return fn(win, profileHints, target);
  };
  const hints = { router: 'RU-HINT-ROUTER', 'vps-local': 'RU-HINT-VPS' };
  // i18n есть, язык en → перевод из словаря
  const winEn = { LGI18N: { t: (k) => api.t(k) } };
  api.setLang('en');
  assert.equal(mk(winEn, hints, 'vps-local'), api.DICT.en['builder.profile.hint.vps-local'], 'EN via dictionary');
  // язык ru → RU из словаря
  api.setLang('ru');
  assert.equal(mk(winEn, hints, 'router'), api.DICT.ru['builder.profile.hint.router'], 'RU via dictionary');
  // i18n отсутствует → ровно прежнее поведение (RU-константа / пусто)
  assert.equal(mk({}, hints, 'router'), 'RU-HINT-ROUTER', 'fallback to RU constant when no LGI18N');
  assert.equal(mk({}, {}, 'unknown'), '', 'empty fallback for unknown target (pre-#353 parity)');
  // ключ отсутствует в словаре → t() вернул бы сам ключ, helper обязан уйти в fallback
  assert.equal(mk({ LGI18N: { t: () => 'builder.profile.hint.router' } }, hints, 'router'),
    'RU-HINT-ROUTER', 'missing-key sentinel falls back to constant');
});

check('PROFILE_HINTS-константа не дрейфует от словаря (RU == DICT.ru)', () => {
  const { api } = loadI18n();
  const constBlock = html.match(/const PROFILE_HINTS = \{([\s\S]*?)\n\};/)[1];
  const extract = p => {
    const lit = p === 'router' ? 'router' : "'" + p + "'";
    const re = new RegExp("(?:^|[\\n,])\\s*" + lit + ":\\s*'((?:[^'\\\\]|\\\\')*)'");
    const mm = constBlock.match(re);
    return mm ? mm[1].replace(/\\'/g, "'") : null;
  };
  for (const p of ['router', 'vps-local', 'vps-gateway']) {
    const ru = api.DICT.ru['builder.profile.hint.' + p];
    const c = extract(p);
    assert.ok(c, 'PROFILE_HINTS[' + p + '] parseable');
    assert.equal(ru, c, 'dict RU text must mirror PROFILE_HINTS[' + p + '] exactly');
  }
});

check('renderMihomo hint-строка переключена на profileHintLocalized (только одна точка рендера)', () => {
  assert.equal((html.match(/hint\.textContent = profileHintLocalized\(target\)/g) || []).length, 1, 'applyProfileUiState uses helper');
  assert.equal((html.match(/hint\.textContent = PROFILE_HINTS\[target\]/g) || []).length, 0, 'old raw render removed');
});

check('i18n.js hygiene: без fetch/innerHTML/cookie; onLangChange уведомляет только валидные setLang', () => {
  assert.doesNotMatch(i18nSrc, /\bfetch\s*\(|XMLHttpRequest|\.innerHTML\s*=|document\.cookie/);
  const { api, win } = loadI18n();
  const seen = [];
  api.onLangChange(lang => seen.push(lang));
  api.onLangChange(() => { throw new Error('bad listener must not break switching'); });
  assert.equal(api.setLang('en'), true);
  assert.deepEqual(seen, ['en'], 'notified with normalized value');
  assert.equal(api.setLang('de'), false);
  assert.equal(api.setLang('ru'), true);
  assert.deepEqual(seen, ['en', 'ru'], 'invalid switch not notified');
  assert.equal(typeof win.LGI18N.onLangChange, 'function', 'API exported');
});

check('язык не проникает в build-состояние: builder.* ключи не встречаются в YAML-генераторе/проекте', () => {
  // Машинные поверхности (генерация YAML, проект, fingerprint) не содержат словарных ключей.
  const yamlGen = html.match(/function buildMihomo\(\)[\s\S]{0,6000}/)[0];
  assert.doesNotMatch(yamlGen, /LGI18N|builder\./, 'buildMihomo must not consume i18n');
  const fp = html.match(/function buildStateFingerprint\(\)[\s\S]*?\n}/)[0];
  assert.doesNotMatch(fp, /LGI18N|builder\./, 'fingerprint must not consume i18n');
  // locale в localStorage-ключе — единственный носитель; он не входит в проект
  const project = html.match(/function rbCollectProject\(\)[\s\S]*?\n}/)[0];
  assert.doesNotMatch(project, /locale/i, 'project format must stay locale-free');
});

console.log('\ni18n-builder-2a: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

// i18n foundation (#349 / umbrella #265 Phase 1). Classic script: no fetch, no CDN,
// no npm runtime — file:// stays fully offline. RU/EN is NOT complete: this stage
// covers a limited representative static set (tabs, language switcher, WARP import
// labels). Presentation only — never translates YAML, proxy/group names, HWID,
// subscription URLs, secrets or generated output. See issue #349 for follow-up phases.
(function () {
  'use strict';

  var LANGS = ['ru', 'en'];
  var DEFAULT_LANG = 'ru';
  // Dedicated versioned key storing ONLY the enum 'ru'|'en'. Separate from device
  // identities / HWID / project state; never contains secrets, UUIDs, HWID or URLs.
  var STORAGE_KEY = 'link-generators.locale.v1';

  // Semantic keys; RU/EN must stay in exact key parity (tests/i18n-foundation.cjs).
  var DICT = {
    ru: {
      'ui.lang.label': 'Язык интерфейса:',
      'ui.lang.title': 'Выбор языка интерфейса',
      'ui.tabs.warp': '⚡ WARP MASQUE Links',
      'ui.tabs.builder': '⚙️ Mihomo Config Builder',
      'ui.tabs.studio': '🔎 Config Studio',
      'ui.warp.parsedBadge': 'Заполнено',
      'ui.warp.import.title': '📥 Импорт WARP YAML',
      'ui.warp.import.placeholder': 'Вставьте WARP YAML-конфиг (бот, WARPSCOUT или другой совместимый источник)…',
      'ui.warp.import.parse': '🔍 Распарсить',
      'ui.warp.import.clear': 'Очистить',
      'ui.warp.import.hint': 'Поддерживается совместимый WARP YAML; источник не важен.',
      'ui.warp.params.title': '🔑 Параметры',
      'ui.warp.params.profileName': 'Имя профиля (база)'
    },
    en: {
      'ui.lang.label': 'Interface language:',
      'ui.lang.title': 'Interface language selection',
      'ui.tabs.warp': '⚡ WARP MASQUE Links',
      'ui.tabs.builder': '⚙️ Mihomo Config Builder',
      'ui.tabs.studio': '🔎 Config Studio',
      'ui.warp.parsedBadge': 'Parsed',
      'ui.warp.import.title': '📥 Import WARP YAML',
      'ui.warp.import.placeholder': 'Paste a WARP YAML config (bot, WARPSCOUT or another compatible source)…',
      'ui.warp.import.parse': '🔍 Parse',
      'ui.warp.import.clear': 'Clear',
      'ui.warp.import.hint': 'A compatible WARP YAML is supported; the source does not matter.',
      'ui.warp.params.title': '🔑 Parameters',
      'ui.warp.params.profileName': 'Profile name (base)'
    }
  };

  // Attributes a translation may ever touch (allowlist; never value/href/src/onclick).
  var ATTR_ALLOWLIST = { 'title': true, 'placeholder': true, 'aria-label': true, 'aria-description': true };

  var currentLang = DEFAULT_LANG;
  var memoryLang = null; // fallback when localStorage is unavailable (disabled/blocked)

  function normalizeLang(value) {
    if (value === 'ru' || value === 'en') return value;
    return null;
  }

  function readStoredLang() {
    var value = null;
    try { value = window.localStorage.getItem(STORAGE_KEY); } catch (_) { return normalizeLang(memoryLang); }
    return normalizeLang(value);
  }

  // t(key, params): text-only interpolation via {name} tokens. Returns a plain
  // string — safe only when assigned through textContent/createTextNode or
  // allowlisted attribute setters; never feed t() output into innerHTML.
  // Missing key falls back to the key itself (CI parity tests make dictionary-backed
  // missing keys a hard failure; console.warn keeps it visible during development).
  function t(key, params) {
    if (typeof key !== 'string' || !key) return '';
    var table = DICT[currentLang] || DICT[DEFAULT_LANG];
    var template = Object.prototype.hasOwnProperty.call(table, key) ? table[key]
      : (Object.prototype.hasOwnProperty.call(DICT[DEFAULT_LANG], key) ? DICT[DEFAULT_LANG][key] : null);
    if (template === null) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[i18n] missing key: ' + key);
      return key;
    }
    if (!params) return template;
    var out = template;
    for (var name in params) {
      if (!Object.prototype.hasOwnProperty.call(params, name)) continue;
      out = out.split('{' + name + '}').join(String(params[name]));
    }
    return out;
  }

  // Applies data-i18n (textContent) and data-i18n-attr="attr:key;…" (allowlisted
  // attributes only). Never re-creates elements — inputs/textareas/state survive.
  function applyTranslations(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    var i, el, key;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      key = el.getAttribute('data-i18n');
      if (!key) continue;
      el.textContent = t(key);
    }
    var attrNodes = scope.querySelectorAll('[data-i18n-attr]');
    for (i = 0; i < attrNodes.length; i++) {
      el = attrNodes[i];
      var spec = (el.getAttribute('data-i18n-attr') || '').split(';');
      for (var k = 0; k < spec.length; k++) {
        var pair = spec[k].trim();
        var idx = pair.indexOf(':');
        if (idx <= 0) continue;
        var attr = pair.slice(0, idx).trim();
        var akey = pair.slice(idx + 1).trim();
        if (!ATTR_ALLOWLIST[attr] || !akey) continue;
        el.setAttribute(attr, t(akey));
      }
    }
  }

  function syncDocument() {
    document.documentElement.lang = currentLang;
    applyTranslations(document);
    var sel = document.getElementById('uiLangSelect');
    if (sel && sel.value !== currentLang) sel.value = currentLang;
  }

  // Accepts only 'ru'|'en'; anything else is ignored (no language detection, no IP).
  function setLang(lang) {
    var normalized = normalizeLang(lang);
    if (!normalized) return false;
    currentLang = normalized;
    try { window.localStorage.setItem(STORAGE_KEY, normalized); } catch (_) { /* storage disabled — memory fallback below */ }
    memoryLang = normalized;
    syncDocument();
    return true;
  }

  function init() {
    var stored = readStoredLang();
    if (stored) currentLang = stored;
    syncDocument();
    var sel = document.getElementById('uiLangSelect');
    if (sel && !sel.getAttribute('data-i18n-bound')) {
      sel.setAttribute('data-i18n-bound', '1');
      sel.addEventListener('change', function () { setLang(sel.value); });
    }
  }

  window.LGI18N = {
    t: t,
    setLang: setLang,
    getLang: function () { return currentLang; },
    LANGS: LANGS,
    DEFAULT_LANG: DEFAULT_LANG,
    STORAGE_KEY: STORAGE_KEY,
    DICT: DICT,
    applyTranslations: applyTranslations
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

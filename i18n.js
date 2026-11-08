// i18n foundation (#349 / umbrella #265 Phase 1) + Builder slice (#353 Phase 2A).
// Classic script: no fetch, no CDN, no npm runtime — file:// stays fully offline.
// RU/EN is NOT complete: this stage covers a limited representative static set
// (tabs, language switcher, WARP import labels) plus the visible basic working
// path of the Mihomo Builder (action bar, workspace nav, quick start, profile /
// routing / subscription source cards, 3 dynamic profile hints). Presentation
// only — never translates YAML, proxy/group names, HWID, subscription URLs,
// secrets or generated output. See issues #349/#353 and umbrella #265.
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
      'ui.warp.params.profileName': 'Имя профиля (база)',
      // #353 Phase 2A — Mihomo Builder: видимая база (action bar, навигация,
      // быстрый старт, карточки профиля/маршрутизации/источников).
      'builder.actionbar.aria': 'Действия Builder',
      'builder.build.title': 'Собрать YAML из текущих данных и настроек; после сборки выполняется автоматическая проверка структуры',
      'builder.downloadYaml': '💾 Скачать YAML',
      'builder.openStudio': '🔎 Открыть YAML в Config Studio',
      'builder.copy.title': 'Скопировать итоговый YAML (доступно только после успешной проверки)',
      'builder.saveProject': '💾 Сохранить проект',
      'builder.saveProject.title': 'Сохранить проект генератора (все подписки, WG/AWG-профили, настройки) в .lgproject.json. ВНИМАНИЕ: файл содержит приватные ключи и токены',
      'builder.loadProject': '📂 Загрузить проект',
      'builder.loadProject.title': 'Загрузить проект генератора (.lgproject.json) и восстановить Builder',
      'builder.undoRestore': '↩︎ Отменить восстановление',
      'builder.undoRestore.title': 'Вернуть состояние Builder до загрузки проекта',
      'builder.rebuild': 'Пересобрать YAML',
      'builder.reset': '🧹 Сбросить проект',
      'builder.jumpToYaml': '↓ Перейти к YAML',
      'builder.nav.aria': 'Разделы Mihomo Builder',
      'builder.section.start': '🏠 Быстрый старт',
      'builder.nav.routing': '🌐 Маршрутизация и DNS',
      'builder.nav.diagnostics': '🔍 Диагностика',
      'builder.nav.options': '⚙️ Дополнительно',
      'builder.toolsDirectory': 'Все инструменты — экспертный доступ',
      'builder.quickStart.steps': '1. Выберите платформу. 2. Выберите режим маршрутизации. 3. Добавьте серверы и соберите YAML. Инженерные настройки доступны в отдельных разделах ниже.',
      'builder.profile.title': '🎯 Где будет работать Mihomo?',
      'builder.profile.option.router': 'Роутер / обычный TUN (Keenetic)',
      'builder.profile.option.vpsLocal': 'VPS — локальный Mihomo / SOCKS для Xray / 3X-UI',
      'builder.profile.option.vpsGateway': 'VPS Transparent Gateway (amnezia-mihomo-gateway)',
      'builder.profile.hint.router': 'Домашний роутер / обычный TUN: Mihomo поднимает TUN-интерфейс (MIPS stack), слушает Mixed Port 7890, разрешает доступ из локальной сети. Все параметры ниже можно менять вручную.',
      'builder.profile.hint.vps-local': 'Для VPS, где Xray/3X-UI или другое локальное приложение отправляет трафик в Mihomo через 127.0.0.1:7890. TUN и системная маршрутизация VPS не используются.',
      'builder.profile.hint.vps-gateway': 'Только для transparent-gateway с Linux policy routing / iptables / Docker/AWG. Генератор создаёт Mihomo-часть, но не Linux routing/firewall. Для обычного VPS с Xray/3X-UI используйте профиль «VPS — локальный Mihomo / SOCKS».',
      'builder.awl.routerHint': 'Автоматический режим белых списков доступен только для профиля «Роутер / обычный TUN».',
      'builder.routing.title': '🛡️ 2. Режим маршрутизации',
      'builder.routing.awlToggle': '🛡️ Автоматический режим белых списков',
      'builder.sources.title': '📋 3. Основные серверы и подписки',
      'builder.sources.label': 'Основные серверы и подписки',
      'builder.sources.placeholder': 'vless://...\nmasque://...\nhttps://sub.url/...\nМожно вставить ссылки, созданные во вкладке «⚡ WARP MASQUE Links»',
      'builder.sources.providerRowsAria': 'Имена основных подписок',
      'builder.sources.reserveLabel': 'Резервные серверы и подписки',
      'builder.sources.reserveRowsAria': 'Имена резервных подписок'
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
      'ui.warp.params.profileName': 'Profile name (base)',
      'builder.actionbar.aria': 'Builder actions',
      'builder.build.title': 'Build YAML from the current data and settings; an automatic structural check runs after the build',
      'builder.downloadYaml': '💾 Download YAML',
      'builder.openStudio': '🔎 Open YAML in Config Studio',
      'builder.copy.title': 'Copy the final YAML (available only after a successful check)',
      'builder.saveProject': '💾 Save project',
      'builder.saveProject.title': 'Save the generator project (all subscriptions, WG/AWG profiles, settings) to .lgproject.json. WARNING: the file contains private keys and tokens',
      'builder.loadProject': '📂 Load project',
      'builder.loadProject.title': 'Load a generator project (.lgproject.json) and restore the Builder',
      'builder.undoRestore': '↩︎ Undo restore',
      'builder.undoRestore.title': 'Return the Builder to the state before the project was loaded',
      'builder.rebuild': 'Rebuild YAML',
      'builder.reset': '🧹 Reset project',
      'builder.jumpToYaml': '↓ Jump to YAML',
      'builder.nav.aria': 'Mihomo Builder sections',
      'builder.section.start': '🏠 Quick start',
      'builder.nav.routing': '🌐 Routing and DNS',
      'builder.nav.diagnostics': '🔍 Diagnostics',
      'builder.nav.options': '⚙️ Advanced',
      'builder.toolsDirectory': 'All tools — expert access',
      'builder.quickStart.steps': '1. Choose the platform. 2. Choose the routing mode. 3. Add servers and build the YAML. Engineering settings are available in dedicated sections below.',
      'builder.profile.title': '🎯 Where will Mihomo run?',
      'builder.profile.option.router': 'Router / regular TUN (Keenetic)',
      'builder.profile.option.vpsLocal': 'VPS — local Mihomo / SOCKS for Xray / 3X-UI',
      'builder.profile.option.vpsGateway': 'VPS Transparent Gateway (amnezia-mihomo-gateway)',
      'builder.profile.hint.router': 'Home router / regular TUN: Mihomo raises a TUN interface (MIPS stack), listens on Mixed Port 7890 and allows access from the local network. Every parameter below can be changed manually.',
      'builder.profile.hint.vps-local': 'For a VPS where Xray/3X-UI or another local application sends traffic to Mihomo via 127.0.0.1:7890. The TUN interface and the system routing of the VPS are not used.',
      'builder.profile.hint.vps-gateway': 'Only for a transparent gateway with Linux policy routing / iptables / Docker/AWG. The generator creates the Mihomo part but not the Linux routing/firewall. For a regular VPS with Xray/3X-UI use the «VPS — local Mihomo / SOCKS» profile.',
      'builder.awl.routerHint': 'The automatic whitelist mode is available only for the «Router / regular TUN» profile.',
      'builder.routing.title': '🛡️ 2. Routing mode',
      'builder.routing.awlToggle': '🛡️ Automatic whitelist mode',
      'builder.sources.title': '📋 3. Main servers and subscriptions',
      'builder.sources.label': 'Main servers and subscriptions',
      'builder.sources.placeholder': 'vless://...\nmasque://...\nhttps://sub.url/...\nYou can paste links generated in the ⚡ WARP MASQUE Links tab',
      'builder.sources.providerRowsAria': 'Main subscription names',
      'builder.sources.reserveLabel': 'Fallback servers and subscriptions',
      'builder.sources.reserveRowsAria': 'Fallback subscription names'
    }
  };

  // Attributes a translation may ever touch (allowlist; never value/href/src/onclick).
  var ATTR_ALLOWLIST = { 'title': true, 'placeholder': true, 'aria-label': true, 'aria-description': true };

  var currentLang = DEFAULT_LANG;
  var memoryLang = null; // fallback when localStorage is unavailable (disabled/blocked)
  // #353: presentation-only callbacks for dynamic strings rendered outside
  // data-i18n markup (e.g. profile hints). Listeners are notified only after a
  // successful setLang of a normalized enum value; failures never break switching.
  var langListeners = [];

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
  function onLangChange(fn) {
    if (typeof fn !== 'function') return;
    langListeners.push(fn);
  }

  function setLang(lang) {
    var normalized = normalizeLang(lang);
    if (!normalized) return false;
    currentLang = normalized;
    try { window.localStorage.setItem(STORAGE_KEY, normalized); } catch (_) { /* storage disabled — memory fallback below */ }
    memoryLang = normalized;
    syncDocument();
    for (var i = 0; i < langListeners.length; i++) {
      try { langListeners[i](normalized); } catch (_) { /* one bad listener must not break the switch */ }
    }
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
    applyTranslations: applyTranslations,
    onLangChange: onLangChange
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

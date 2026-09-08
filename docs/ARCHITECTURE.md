# ARCHITECTURE — link-generators

Внутренняя документация. Описывает фактическое состояние кода (по состоянию на commit
`f5ea0a3`, 2026-09-08). Источник истины — код; при расхождении чинить документацию или
код, но не делать вид, что расхождения нет. Полный контракт для агентов — [AGENTS.md](../AGENTS.md)
в корне репо; здесь — архитектурная картина.

## Что это

«WARP & Mihomo Unified Generator» — статический одностраничный веб-инструмент на GitHub
Pages: https://saymer-alt.github.io/link-generators/ . Две вкладки:

1. **⚡ WARP MASQUE Links** — генератор пар `masque://`-ссылок (QUIC + HTTP/2) из ключей
   WARP с анти-DPI стратегией портов/IP.
2. **⚙️ Mihomo Config Builder** — сборка `config.yaml` для Mihomo (Clash Meta) из ссылок,
   подписок и WireGuard/AmneziaWG-файлов + pre-copy базовая валидация результата.

## Чего в проекте нет (принципиально)

- Бэкенда. Всё исполняется в браузере.
- npm / package.json / сборки / бандлера в самом репо. Единственный build — у апстрима
  web4core, его артефакт коммитится готовым файлом (см. [UPDATES.md](UPDATES.md)).
- Автотестов и CI-проверок кода. Единственный workflow — автообновление рантайма.
  Тестирование — ручное, см. [TESTING.md](TESTING.md).
- ES-модулей. Подключение классическое (`<script src>`), поэтому страница работает и с `file://` — это фича.

Каждый push в `main` немедленно публикуется на Pages: **main = прод**. Язык проекта — русский.

## Состав репозитория

| Файл | Природа | Роль |
|---|---|---|
| `index.html` | **handwritten** | Единственная страница приложения: inline CSS + inline JS (~880 строк) |
| `web4core.runtime.js` | **generated/vendor** | IIFE-бандл апстрима spatiumstas/web4core (~4380 строк). Руками не редактировать |
| `.github/workflows/update-web4core-runtime.yml` | handwritten (automation) | Автообновление рантайма из апстрима; имеет право коммитить в `main` |
| `README.md` | документация | Пользовательская документация (обновляется вручную) |
| `AGENTS.md` | документация | Контракт для AI-агентов |
| `docs/` | документация | Эта внутренняя база знаний |
| `.nojekyll` | служебный | Отключает Jekyll на Pages |
| `LICENSE` | BSD-3-Clause | Унаследована от web4core |

Внешняя сетевая зависимость страницы: `js-yaml@4.1.0` с jsdelivr CDN. Всё остальное —
локальные файлы. Сама страница `fetch` не использует; исключение по сети внутри рантайма
одного — `fetchSubscription` (см. [DATAFLOW.md](DATAFLOW.md), в текущем UI не задействован).

## Где какая логика

### `index.html` — handwritten слой

- **Вкладка 1**: `parseYaml()` (импорт YAML от Telegram-бота), `generateWarp()` (генерация
  ссылок, DPI-стратегия «П.1/П.2/П.3»), `sendToMihomo()` (передача в Builder).
- **Вкладка 2, обёртка над рантаймом**: `buildMihomo()` (сборка options и вызов
  `web4core.buildFromRequest`), `initWgUpload()` (чтение .conf/.awg файлов).
- **Вкладка 2, собственные слои поверх рантайма** (добавлены локально, существуют только в этом репо):
  - **AWG-совместимость** (c0b28ce): `normalizeWgText` (диапазон `PersistentKeepalive = 25-35`
    → нижняя граница до парсинга), `normalizeWgBeans` (вывод `version: 3` для AWG 3.x),
    `injectWgDns` (инжекция `dns`/`remote-dns-resolve` в wireguard-прокси после сборки);
  - **DNS-защита** (16690f2): перехват нестабильного DNS Amnezia `100.64.0.1` → подстановка
    публичных DNS + поле «WireGuard DNS» (`#wgCustomDns`);
  - **Pre-copy валидатор** (f5ea0a3): `validateMihomoYaml()` + state machine + блокировка
    Copy YAML. Подробно — [VALIDATION.md](VALIDATION.md).

### `web4core.runtime.js` — весь парсинг и генерация YAML

Парсеры всех схем, внутреннее представление (beans), строители mihomo/sing-box/xray,
эмиссия YAML (собственный сериализатор `toYAML`, не jsyaml). Точка экспорта одна:
`globalThis.web4core = { … }` — 17 функций (полный список в [UPDATES.md](UPDATES.md)).

Страница использует только три: `buildFromRequest`, `parseWireGuardConf`, `URLTEST_CHOICES`.
Остальные — публичный API рантайма, зарезервированный для будущих задач.

### Исторический артефакт: `mihomo.html`

Ранее в репо жил `mihomo.html` — побайтовая копия `index.html` под вторым адресом
(заведён через GitHub web-upload на заре проекта). Удалён 2026-09-08 как неиспользуемый
артефакт: ни код, ни workflows, ни README на него не ссылались. URL `/mihomo.html` на
Pages теперь 404 — это ожидаемо, redirect не предусмотрен. `index.html` — единственная
страница приложения.

## Схема потоков (по фактическому коду)

```text
ВКЛАДКА 1: YAML от бота → parseYaml() → поля формы → generateWarp() → пары masque://-ссылок
                                                       └→ sendToMihomo() → вставка во вкладку 2

ВКЛАДКА 2 (Mihomo Builder), путь данных:

  textarea #mihomoInput (ссылки/подписки)        файлы .conf/.awg (#wgFile)
        │                                              │
        │                                    normalizeWgText()      ← локальный патч (PKA-диапазон)
        │                                              │
        │                                   web4core.parseWireGuardConf()
        │                                              │ wgBeans
        ▼                                              ▼
  web4core.buildFromRequest({ core:'mihomo', input, wgBeans, options })
        │   внутри: buildBeansFromInput → beans; validateBean; assertCoreSupports;
        │   buildMihomoConfig / buildMihomoSubscriptionConfig → buildMihomoYaml (toYAML)
        ▼
  { kind: 'yaml', data: <YAML-строка> }
        │
        ▼
  injectWgDns(result, wgBeans)        ← локальный патч: DNS из #wgCustomDns в wireguard-прокси
        │                               (jsyaml.load → правка → jsyaml.dump { lineWidth: -1 })
        ▼
  allow-lan регэксп-патч              ← локальный патч: allow-lan: false→true + bind-address: "*"
        │
        ▼
  #mihomoOutput (readonly textarea)   ← итоговый YAML показан пользователю
        │
        ▼
  runMihomoValidation(yaml)           ← локальный слой
        │   state: NOT_BUILT → VALIDATING → validateMihomoYaml(yaml) → VALID | INVALID
        ▼
  ┌─────────────────────────────────────────────┐
  │ VALID   → #copyYamlBtn включена             │
  │ INVALID → статус «❌ Ошибка базовой         │
  │           проверки» + Proxy/Field/Value,    │
  │           Copy заблокирована (двойной       │
  │           рубеж: disabled + guard)          │
  └─────────────────────────────────────────────┘
        │
        ▼
  copyMihomo() → navigator.clipboard.writeText
```

Любое событие `input`/`change` на документе сбрасывает состояние валидации в `NOT_BUILT`
(устаревший `VALID` недопустим).

## Границы и инварианты, которые нельзя нарушать

- `web4core.runtime.js` — generated/vendor: единственный путь изменения — апстрим
  (см. [UPDATES.md](UPDATES.md)). Локальные адаптации — только wrapper'ами в `index.html`
  над входом/выходом рантайма.
- Никакого backend, npm, ES-модулей, телеметрии: конфиги и ключи не покидают браузер
  (сетевые исключения перечислены в [DATAFLOW.md](DATAFLOW.md)).
- Формат `masque://`-ссылок и структура выходного YAML — внешние контракты (их парсят
  сторонние импортеры и роутеры), не «улучшать» молча.
- DPI-стратегия генерации ссылок (фиксированный QUIC-пул, веса портов H2, анти-корреляция
  IP) — load-bearing, описана в [AGENTS.md](../AGENTS.md).

## Related documentation

- [DATAFLOW.md](DATAFLOW.md) — прохождение данных по каждому типу входа, beans, post-processing, приватность.
- [MIHOMO.md](MIHOMO.md) — настройки Builder'а, структура генерируемого YAML, валидатор кратко.
- [PROTOCOLS.md](PROTOCOLS.md) — таблица «протокол → парсер → bean → mihomo type», ограничения.
- [VALIDATION.md](VALIDATION.md) — pre-copy валидатор: полный список ERROR/WARNING, state machine, почему не `mihomo -t`.
- [UPDATES.md](UPDATES.md) — жизненный цикл `web4core.runtime.js`, workflow автообновления.
- [DEVELOPMENT.md](DEVELOPMENT.md) — как запускать, менять и проверять; safe change rules.
- [TESTING.md](TESTING.md) — реальная тестовая стратегия и выполненные прогоны.

# WEB4CORE-FORK — архитектура двух репозиториев

## Автоматический режим белых списков (2026-09-15)

Контракт и точная структура YAML: [AUTO-WHITELIST.md](AUTO-WHITELIST.md).
UI передаёт опциональный `fallbackInput`; engine строит один плоский GLOBAL fallback
с конечными узлами primary → fallback, без DIRECT и вложенных групп (#2588). Выключенный режим сохраняет прежний путь.
Опции «на каждый прокси» и VPS исключаются независимо от скрытия UI; существующий validator
проверяет итоговый YAML. Runtime требуется с поддержкой нового generic API.


Карта для разработчиков и AI-агентов. Это источник истины о границе engine/UI;
правила конкретного репозитория находятся в его `AGENTS.md`.

```text
spatiumstas/web4core
        ↓ sync
saymer-alt/web4core:main
        ↓ merge
saymer-alt/web4core:link-generators
        ↓ build
web4core.runtime.js
        ↓
saymer-alt/link-generators
```

`saymer-alt/web4core` — настоящий fork. `main` остаётся максимально близким к upstream;
custom branch `link-generators` содержит наши source-level расширения. Remotes fork:
`origin` → saymer-alt/web4core, `upstream` → spatiumstas/web4core.
Source sync — controlled merge с review и тестами; разрешено также вливать upstream/main
непосредственно в candidate branch после проверки того же SHA.

Статический consumer — UI/browser layer: формы, UX, WARP UI, UI-specific normalization,
post-processing, pre-copy validation. Protocol engine — в fork. Приложение не получает
package.json/npm dependencies/build step; классический script и `file://` сохраняются.

## Куда вносить изменение

| Изменение | Репозиторий и слой |
|---|---|
| Новый протокол / parser / builder | web4core:link-generators, исходники engine |
| UI checkbox / форма / UX | link-generators, index.html |
| Новый outbound validation | Обычно оба: engine bean/core validation и browser validator |
| Обновление upstream | Сначала web4core sync/tests/build, затем consumer runtime |
| Generated runtime вручную | Запрещено; только воспроизводимая сборка fork |

Не дублировать parser/builder в `index.html`. Нормализация/post-processing остаются
здесь только при UI responsibility: например, выбранный deployment profile или DNS
переопределение формы. Общая семантика протокола принадлежит engine.
Существующие AWG wrappers не переносить попутно без отдельной задачи и baseline review.

Для протокола обязательна цепочка `share/input parser → bean → validation/core support
→ Mihomo builder → tests → build`. Наличие YAML-типа в validator или распознавание URI
не означает поддержку end-to-end. README/docs должны описывать только доказанную
цепочку и ограничения конкретной версии ядра. SSR/Hysteria/OpenVPN и другие новые
протоколы требуют отдельной задачи; архитектурная миграция их не добавляет.

## Текущий MIPS-контракт

`cfgTunMips → tunStack → options.mihomoTunStack → buildFromRequest → opts.tun.stack
→ normal TUN / Per-Proxy listeners`. В fork затронуты `src/build.js` и `src/core/yaml.js`.
Только точное `mips` включает MIPS (Mihomo >= 1.19.31); default/invalid → `gvisor`.
UI/VPS/AWG pipeline сохранён. Maintained textual patch удалён после доказанной
побайтовой эквивалентности source build и прежнего runtime.

## Безопасный workflow будущего агента

1. Прочитать [AGENTS.md](../AGENTS.md) consumer и
   [AGENTS.md fork](https://github.com/saymer-alt/web4core/blob/link-generators/AGENTS.md).
2. Проверить branch/remotes/status/log обоих checkout; не перезаписывать чужие изменения.
3. Определить слой изменения по таблице, изучить реальные функции и existing tests.
4. Внести минимальный diff в соответствующие исходники; соблюдать согласованный scope.
5. Выполнить tests/build (команды в AGENTS fork и [DEVELOPMENT.md](DEVELOPMENT.md)).
6. Сравнить runtime с baseline: байты/SHA-256, объяснить весь diff до копирования.
   Backward compatibility проверять consumer runtime/browser suite и baseline.
7. Для новых Mihomo output contracts выполнить реальный `mihomo -t` целевой версии
   на синтетических fixtures. Не заявлять handshake по результату syntax validation.
8. Синхронизировать validator/README/docs с фактической end-to-end поддержкой.
9. Показать review до commit/push: файлы, diff-stat, tests/build/core validation,
   runtime comparison, security/scope и порядок публикации.

## Sync, публикация и security boundaries

Единая подробная процедура, варианты sync, граница read/write jobs и порядок
публикации — [UPDATES.md](UPDATES.md); тестовая матрица — [TESTING.md](TESTING.md).
Upstream сначала проходит review и проверки в candidate branch. При merge conflict
или test failure — ничего не публиковать. Force-push, подавление конфликтов и
отключение тестов запрещены. Scheduled auto-merge сейчас не включён.

Consumer workflow воспроизводимо собирает custom branch; ошибка checkout/build/test
блокирует публикацию. Внешний build-код выполняется только в read-only job без secrets;
отдельный write-job копирует единственный artifact, не выполняя его.
Это защищает write-token, но не заменяет review исходников/зависимостей.
Реальные ключи и приватные конфиги запрещены в fixtures, логах и review.

Сначала публикуются проверенные source-изменения fork, затем миграция consumer.
Пока в удалённой custom branch нет MIPS source test, новый workflow должен падать,
а не пропускать проверку. Generated runtime руками не чинить.

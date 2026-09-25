# docs — навигатор технической базы знаний

README.md в корне репозитория — пользовательская landing page; здесь — внутренняя
документация. Источник истины — код; при расхождении чинить документацию.

## Быстрый старт по задачам

| Задача | Документы |
|---|---|
| Понять, как работает страница | [ARCHITECTURE.md](ARCHITECTURE.md), [DATAFLOW.md](DATAFLOW.md) |
| Какие опции/поля что генерируют | [MIHOMO.md](MIHOMO.md) |
| Как добавить опцию/прототип UI | [DEVELOPMENT.md](DEVELOPMENT.md) |
| Протоколы: форматы ссылок и поддержка | [PROTOCOLS.md](PROTOCOLS.md) |
| Валидатор: что проверяется | [VALIDATION.md](VALIDATION.md) |
| Тесты: как запускать и что покрыто | [TESTING.md](TESTING.md) |
| Автообновление рантайма из fork | [UPDATES.md](UPDATES.md), [WEB4CORE-FORK.md](WEB4CORE-FORK.md) |
| Auto-Whitelist (резерв БС) | [AUTO-WHITELIST.md](AUTO-WHITELIST.md) |
| VPS Gateway профиль | [VPS-GATEWAY.md](VPS-GATEWAY.md) |
| WARPSCOUT: Windows / Keenetic / VPS | [WARPSCOUT-WINDOWS.md](WARPSCOUT-WINDOWS.md), [WARPSCOUT-KEENETIC.md](WARPSCOUT-KEENETIC.md), [WARPSCOUT-VPS.md](WARPSCOUT-VPS.md) |
| История решений | [FALLBACK-REVIEW.md](FALLBACK-REVIEW.md), [AUDIT-MIHOMO-1.19.31.md](AUDIT-MIHOMO-1.19.31.md) |

## Ключевые контракты (не нарушать молча)

- `masque://` формат и anti-DPI стратегия — описаны в AGENTS.md (корень).
- Целевая версия Mihomo — 1.19.31; MIPS stack требует >= 1.19.31 (warning в валидаторе, не блокер); gVisor — fallback.
- Flat GLOBAL fallback в Auto-Whitelist; nested-группы запрещены (#2588).
- `web4core.runtime.js` — generated; меняется только через fork `saymer-alt/web4core@link-generators` + workflow.

# Future Research Index (NIGHT-FUTURE-01)

Дата: 2026-10-08. Индекс исследовательских работ для будущих версий. **Всё ниже — не утверждённый scope релиза**: `v1.12+` — предварительный backlog, `later` — без назначенной версии, `undecided` — требуется решение владельца. Никакие материалы отсюда не входят в production bundle/CI без отдельного решения.

| Документ | Статус | Evidence | Проверенные версии | Ключевые upstream-источники | Воспроизведение | Ограничения | Следующие шаги | Release candidate |
|---|---|---|---|---|---|---|---|---|
| [MRS-TOOLCHAIN.md](MRS-TOOLCHAIN.md) | RESEARCHED (container SOURCE-PROVEN; succinct payload INFERRED) | SOURCE-PROVEN + INFERRED | mihomo v1.19.32 | rules/provider/mrs_reader.go, mrs_converter.go, domain_strategy.go; component/trie/domain_map_bin.go, domain_set.go (openacid/succinct) | research/poc/mrs/inspect-mrs.mjs (header/behavior/count/extra PoC + synthetic fixture) |succinct-бинарный формат не подтверждён побайтовой реализацией; zstd в браузере — отдельное решение | behavior-byte эмпирика; succinct-декодер в JS; ipcidr payload; viewer-прототип | v1.12+ |
| [WG-AWG-WATCHDOG.md](WG-AWG-WATCHDOG.md) | RESEARCHED (дизайн read-only collector'а; auto-restart — NOT PROVEN) | SOURCE-PROVEN (wireguard-go таймеры/пределы) + UNKNOWN (реальные инциденты) | wireguard-go/amneziawg-go семантика; CLI awg/wg show | docs/research/WG-AWG-RUNTIME-RECOVERY.md; wireguard-tools/amneziawg-tools вывод | incident-snapshot состав в §4 (shell, read-only) | нет FIELD-OBSERVED инцидент-данных; NAT-vs-server доля неизвестна | read-only collector-скрипт (отдельная задача) → сбор реального инцидента → только потом auto-restart решение | later |
| [AUTO-MTU-PROOF-GATES.md](AUTO-MTU-PROOF-GATES.md) | RESEARCHED (гейты G1–G6 сформулированы) | PARTIALLY PROVEN (WG константы) + NOT PROVEN (AWG RandomTrailers/CPA) | WG-MTU-MIHOMO.md, AWG-MTU-OVERHEAD.md базис | docs/research/WG-MTU-MIHOMO.md, AWG-MTU-OVERHEAD.md | synthetic per-транспорт гейт-тесты описаны в §3 | path MTU не измерялся; gVisor vs system — PARTIAL | FIELD-OBSERVED замеры path MTU → только потом решение об auto-MTU | v1.12+ / undecided |
| [WARPSCOUT-REVALIDATION.md](WARPSCOUT-REVALIDATION.md) | RESEARCHED (JSON schema v1, TTL/freshness, дедуп) | INFERRED (дизайн по FIELD-OBSERVED #77) | — (полевой контракт WARPSCOUT-*.md) | docs/WARPSCOUT-KEENETIC/VPS/WINDOWS.md | план тестов §8 (synthetic) | никакой реальной перепроверки не выполнялось | реализация revalidation-процесса после owner field-test | v1.12+ / undecided |
| [KNOWN-SERVICES-PROVENANCE.md](KNOWN-SERVICES-PROVENANCE.md) | RESEARCHED (архитектура записей/конфликтов/обновлений) | INFERRED (переиспользование CDG/#136-паттернов) | — | docs/CONFIGURATION-INTELLIGENCE.md; #136 tracked-blob модель | план тестов §6 | никакая база не встроена и не скачана | формат-файл + поисковая прослойка в Domain Coverage | v1.12+ / undecided |
| [ADDITIONAL-DIRECTIONS.md](ADDITIONAL-DIRECTIONS.md) | RESEARCHED-BRIEF | INFERRED | — | PT-GENERATION.md; mihomo listener/parse.go | — | всё требует runtime proof | по решению владельца | v1.12+ / undecided |

Связанный документ вне future/: [V1.9-TO-V1.11-BACKLOG-RECONCILIATION.md](../V1.9-TO-V1.11-BACKLOG-RECONCILIATION.md) — сверка идей v1.9 с фактическим состоянием v1.11 (DONE/PARTIAL/…).

## Правила

- `v1.12+` — предварительный backlog, **не утверждённый scope**; начало v1.12 — только по явному owner GO после релиза v1.11.
- PoC живут в `research/poc/` (изолированно; не в production bundle/CI).
- Никаких реальных credentials/HWID/подписок/VPS-обращений в материалах.

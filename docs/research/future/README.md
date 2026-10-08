# Future Research Index (NIGHT-FUTURE-01)

Дата: 2026-10-08 (обновлено NIGHT-MEGA-01: B1–B5 PoC-и реализованы, см. статусы). Индекс исследовательских работ для будущих версий. **Всё ниже — не утверждённый scope релиза**: `v1.12+` — предварительный backlog, `later` — без назначенной версии, `undecided` — требуется решение владельца. Никакие материалы отсюда не входят в production bundle/CI без отдельного решения.

Сводка «версия → темы → гейты»: [V1.12-V1.14-CANDIDATE-ROADMAP.md](V1.12-V1.14-CANDIDATE-ROADMAP.md).

| Документ | Статус | Evidence | Проверенные версии | Ключевые upstream-источники | Воспроизведение | Ограничения | Следующие шаги | Release candidate |
|---|---|---|---|---|---|---|---|---|
| [DNS-ROUTING-INTELLIGENCE.md](DNS-ROUTING-INTELLIGENCE.md) | RESEARCHED + PoC WORKING (13/13) | SOURCE-PROVEN (config.go/dns_dialer.go/tunnel.go/ipcidr.go v1.19.32) + INFERRED (влияние на окружение) | mihomo v1.19.32 | config/config.go:1420; tunnel/dns_dialer.go:57; tunnel/tunnel.go:337; rules/common/ipcidr.go:35 | research/poc/dns-routing/ (node --test) | DOMAIN-SUFFIX-семантика сведена к точному совпадению; GEOSITE/providers — честный UNKNOWN | live-прогон на fleet-конфигах; сверка error-находок с `mihomo -t` | v1.12 |
| [MRS-TOOLCHAIN.md](MRS-TOOLCHAIN.md) | RESEARCHED + EMPIRICAL (domain payload байт-в-байт) | SOURCE-PROVEN + EMPIRICAL (официальный бинарник v1.19.31) | mihomo v1.19.32 (source), v1.19.31 (фикстуры) | mrs_reader.go, mrs_converter.go, domain_strategy.go; component/trie/domain_set.go, domain_set_bin.go | research/poc/mrs/ (decode-mrs.mjs + 10 тестов + fixtures/PROVENANCE.md) | ipcidr payload не декодирован; zstd в браузере — отдельное решение; rank/select-кэши нужны для production-скорости | viewer-прототип; ipcidr; решение по zstd-decode | v1.12+ |
| [WG-AWG-WATCHDOG.md](WG-AWG-WATCHDOG.md) | RESEARCHED + collector PoC (14/14 offline) | SOURCE-PROVEN (wireguard-go таймеры/пределы) + UNKNOWN (реальные инциденты) | wireguard-go/amneziawg-go семантика; CLI awg/wg show | docs/research/WG-AWG-RUNTIME-RECOVERY.md; wireguard-tools/amneziawg-tools вывод | research/poc/wg-awg-collector/ (stubs-on-PATH offline-тесты) | нет FIELD-OBSERVED инцидент-данных; NAT-vs-server доля неизвестна | живой запуск по operator-задаче при реальном инциденте → только потом auto-restart решение (§4.4) | later |
| [AUTO-MTU-PROOF-GATES.md](AUTO-MTU-PROOF-GATES.md) | RESEARCHED (гейты G1–G6 сформулированы) | PARTIALLY PROVEN (WG константы) + NOT PROVEN (AWG RandomTrailers/CPA) | WG-MTU-MIHOMO.md, AWG-MTU-OVERHEAD.md базис | docs/research/WG-MTU-MIHOMO.md, AWG-MTU-OVERHEAD.md | synthetic per-транспорт гейт-тесты описаны в §3 | path MTU не измерялся; gVisor vs system — PARTIAL | FIELD-OBSERVED замеры path MTU → только потом решение об auto-MTU | v1.12+ / undecided |
| [WARPSCOUT-REVALIDATION.md](WARPSCOUT-REVALIDATION.md) | RESEARCHED + engine PoC (10/10) | INFERRED (дизайн по FIELD-OBSERVED #77) | — (полевой контракт WARPSCOUT-*.md) | docs/WARPSCOUT-KEENETIC/VPS/WINDOWS.md | research/poc/warpscout-engine/ (node --test) | никакой реальной перепроверки не выполнялось; источник наблюдений не определён | реализация revalidation-процесса после owner field-test | v1.12+ / undecided |
| [KNOWN-SERVICES-PROVENANCE.md](KNOWN-SERVICES-PROVENANCE.md) | RESEARCHED + PoC (9/9) | INFERRED (переиспользование CDG/#136-паттернов) | — | docs/CONFIGURATION-INTELLIGENCE.md; #136 tracked-blob модель | research/poc/known-services/ (node --test) | никакая база не встроена и не скачана | выбор первого источника записей; прослойка в Domain Coverage | v1.12+ / undecided |
| [ADDITIONAL-DIRECTIONS.md](ADDITIONAL-DIRECTIONS.md) | RESEARCHED-BRIEF | INFERRED | — | PT-GENERATION.md; mihomo listener/parse.go | — | всё требует runtime proof | по решению владельца | v1.12+ / undecided |

Связанный документ вне future/: [V1.9-TO-V1.11-BACKLOG-RECONCILIATION.md](../V1.9-TO-V1.11-BACKLOG-RECONCILIATION.md) — сверка идей v1.9 с фактическим состоянием v1.11 (DONE/PARTIAL/…).

## Правила

- `v1.12+` — предварительный backlog, **не утверждённый scope**; начало v1.12 — только по явному owner GO после релиза v1.11.
- PoC живут в `research/poc/` (изолированно; не в production bundle/CI).
- Никаких реальных credentials/HWID/подписок/VPS-обращений в материалах; фиксстуры PoC — синтетические (PROVENANCE.md в каждом наборе фикстур).

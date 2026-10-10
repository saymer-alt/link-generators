# Physical Topology: product review после Owner Acceptance Round 2

Дата исследования: 2026-10-10. База: PR #238, `7062b15a38875fa15b744fab666dff456143085a`.
Решение текущего owner task: убрать Physical Topology из публичного GUI v1.11,
сохранить реализацию, fixtures и тесты за внутренним выключенным gate.
Это продуктовая приёмка, а не доказательство исправления всех алгоритмов.

## 1. История первоначальной идеи

[Issue #149](https://github.com/saymer-alt/link-generators/issues/149), созданный
аккаунтом владельца saymer-alt 2026-10-06, описывает распределённую цепочку VPS
и историческое полевое наблюдение владельца весной 2026 года. Это источник
требования, а не независимая проверка новой реализации. Комментарий владельца
ссылается на [#177](https://github.com/saymer-alt/link-generators/issues/177)
как на канонический scope v1.11: линейная цепочка, локальная маршрутизация
Mihomo на каждом узле, отсутствие обещания физического failover.

Последовательность реализации, проверенная по merged PR и Git history:

| PR | Назначение | Merge commit |
|---|---|---|
| [#180](https://github.com/saymer-alt/link-generators/pull/180) | Чистая модель, validate/explain/simulate | `2013c5ecfc4cacdb6d49442810bddc20883e2080` |
| [#181](https://github.com/saymer-alt/link-generators/pull/181) | JSON/demo/read-only UI | `042a721aeb842ac045d712b6bb2f7161e6becd4e` |
| [#190](https://github.com/saymer-alt/link-generators/pull/190) | Per-node artifacts, issue #187 | `391298b24d2df92aae443acdbb594b3aa593b4a4` |
| [#191](https://github.com/saymer-alt/link-generators/pull/191) | Controller evidence, issue #188 | `40a81cd090287bffc7ce5ae7bbe9343593537cb0` |
| [#198](https://github.com/saymer-alt/link-generators/pull/198) | TCP/UDP, DNS и MTU declarations | `5373232c6eda468cbd7e3131669037ebbb22b14c` |
| [#201](https://github.com/saymer-alt/link-generators/pull/201) | What-if refresh, role-based exit, safe lookup | `8d397c96266b4fa6c6b285bab70e9a3b375375b0` |

GitHub показывает автора этих PR как saymer-alt. По одному аккаунту нельзя
установить, кто именно писал код: человек или агент. Требования владельца
зафиксированы в issues; предположения об авторстве реализации здесь не используются.

## 2. Какие проблемы планировалось решить

Необходимость выразить физические границы процессов и серверов: где вход,
следующий сервер, выход, какие пары outbound/listener должны совпадать.
[#177](https://github.com/saymer-alt/link-generators/issues/177) требует
Validate → Explain → Simulate → Runtime proof → Generate, устойчивые IDs и
графовую модель. [#187](https://github.com/saymer-alt/link-generators/issues/187)
добавляет согласованные per-link contracts и per-node artifacts.
[#188](https://github.com/saymer-alt/link-generators/issues/188) отделяет
intended topology от наблюдений контроллеров и от пути пакетов.

В одном процессе `dialer-proxy` не описывает настройку listeners на трёх VPS.
Группа fallback выбирает участника локально; она сама не создаёт распределённый
канал и не переносит сессии между физическими цепочками.

## 3. Предполагаемая цепочка

```text
Keenetic → Москва ENTRY → Эстония TRANSIT → Швеция EXIT → WARP → Интернет
           Mihomo A        Mihomo B         Mihomo C     overlay
```

Каждый VPS — самостоятельный процесс: inbound предыдущего звена, outbound к
следующему звену, локальное правило выбора. WARP — финальное attachment,
не четвёртый VPS. Несколько транспортных кандидатов между Эстонией и Швецией
остаются одним физическим ребром. Их локальное переключение не доказывает
альтернативную физическую цепочку. Исторический пользовательский опыт —
FIELD-OBSERVED владельцем; текущий demo — только синтетическая модель.

## 4. Реализованная архитектура

В [index.html](../../index.html) сохранены независимые блоки `PT-CORE`,
`PT-GEN`, `PT-RUNTIME`, `PT-DIAG` и внутренний UI. Они не включены в обычный
`buildMihomo()` как генератор маршрутизации. Публичный Config Dependency Graph
и Visual Routing Graph работают с финальным локальным YAML и остаются доступны.
Их удаление не требуется для выключения Physical Topology.

Gate: `globalThis.__LG_INTERNAL_PHYSICAL_TOPOLOGY__ === true` до загрузки
inline script. По умолчанию DOM-контейнер `hidden inert`, без публичных ссылок,
URL-параметра или сохранённого переключателя. Это изоляция интерфейса, не граница
безопасности от пользователя с DevTools. Тесты явно включают gate через init script.

## 5. Основные компоненты

| Компонент / функции | Назначение и предел |
|---|---|
| `ptAnalyzeTopology`, `ptSerialize` | Linear roles/links, cycles/branches/orphans, canonical model |
| `ptTraceTopology`, `ptSimulateTopology` | Intended trace, отказ узла/ребра; без выдуманного обхода |
| `ptGenerateArtifacts`, `PT_TRANSPORTS` | Поддержанные outbound/listener pairs и честные external contracts |
| `ptResolveSelectionChain`, `ptClassifyEdge`, `ptAggregateChain` | Bounded controller selection, consistency classification |
| `ptRuntimeFingerprint`, `ptIsStale` | Структурная актуальность evidence, не uptime |
| `ptNetworkDiagnostics` | Объявленные TCP/UDP, DNS и MTU; неизвестное остаётся UNKNOWN |
| Внутренние UI handlers | JSON/demo, what-if, explicit fetch, per-file downloads |

Controller secrets находятся только в памяти; fetch выполняется по явному
действию. Старые ответы отбрасываются по sequence/abort. Автоматического deployment нет.

## 6. Что сделано и проверено

Проверяемые источники: [архитектура](PHYSICAL-MULTIHOP-ARCHITECTURE.md),
[transport research](PT-GENERATION.md), [controller research](PT-RUNTIME-EVIDENCE.md).
Они содержат привязку к исходникам Mihomo v1.19.32, а не к текущей mutable Alpha.

| Доказательство | Воспроизводимая проверка | Что подтверждает |
|---|---|---|
| Pure model | `node tests/physical-topology.cjs` | Валидация линейной модели, simulate/trace |
| Artifacts | `node tests/per-node-generation.cjs` | 2/3-hop READY, overlay external contract, determinism, secret exclusion |
| Real parser | `node tests/per-node-mihomo-compat.cjs` с `MIHOMO_BIN` | Принятие READY SS/SOCKS/HTTP YAML реальными 1.19.31/1.19.32 |
| Controller classification | `node tests/pt-runtime-evidence.cjs` | Bound depth/cycles/bindings/UNKNOWN/PARTIAL/STALE |
| Controller browser | `node tests/pt-runtime-browser.cjs` | В CI loopback controllers; синтетические ответы и stale/abort guards |
| Network declarations | `node tests/pt-network-diagnostics.cjs` | Консервативное TCP/UDP/DNS/MTU объяснение |
| Internal UI | `node tests/physical-topology-browser.cjs` | Init gate, demo, analysis, mobile, no Build mutation |
| Public removal | Owner UX42 | Нет публичных входов/пустой лаборатории/JS errors/overflow |

Результаты текущего candidate публикуются в handoff и CI. Наличие теста не
подменяет результат запуска. `mihomo -t` доказывает parseability, не сквозной канал.

## 7. Что осталось экспериментальным

Нет доказательства текущей цепочки Keenetic–три VPS–WARP на реальных узлах.
Не измерялись packet path, DNS leakage, UDP end-to-end, MTU/PMTU, потери,
recovery timing, continuity действующих соединений, latency или throughput.
Нет SSH/deployment/firewall/routing ownership/rollback orchestration.
Не реализованы mesh/branch, N×M×K topology failover и универсальный server compiler.
Эти пункты не исправлены скрытием UI и не обещаны в новой версии.

## 8. Артефакты и работа с ними

| Файл | Практическое назначение | Следующее действие |
|---|---|---|
| `topology.json` | Secret-free manifest IDs/roles/links/transport/status, NOT_MEASURED | Проверить соответствие собственному проекту; хранить как intended inventory |
| `deployment-map.md` | Человекочитаемая карта intended звеньев и статусов | Сверить endpoint/listener/outbound между соседними узлами |
| per-node `config.yaml` | Локальный Mihomo конфиг для поддержанного полного контракта | Проверить `mihomo -t`, затем отдельно спланировать контролируемое развёртывание |
| per-node `contract.md` | Что требуется, когда compiler не имеет доказанного transport contract | Спроектировать/проверить серверную часть отдельно; не запускать как YAML |

Внутренний demo Москва→Эстония→Швеция→WARP использует SS для первых звеньев.
При синтетических resolved credentials первые узлы READY, а Sweden→WARP
требует EXTERNAL_CONTRACT_REQUIRED. WARP не получает отдельный per-node artifact.
Без заполнения credentials появляются placeholders. Нажатие Generate не
создаёт работающий WARP exit и не доказывает сетевую достижимость.
Per-node configs могут содержать credentials; manifest/map их не содержат.

## 9. Статусы и ограничения

| Статус | Значение |
|---|---|
| READY | Поддержанный полный контракт; parse validation нужна для конкретной версии Mihomo |
| PLACEHOLDERS_REQUIRED | Не хватает данных или credentials; запуск не принят |
| EXTERNAL_CONTRACT_REQUIRED | Неподдержанная серверная пара; config.yaml намеренно отсутствует |
| NOT_MEASURED | Нет измерения сетевого поведения |
| CONSISTENT | Выбор контроллера согласуется с явным binding; packet path не доказан |
| INCONSISTENT | Наблюдаемый известный выбор нарушает intended binding |
| UNKNOWN / PARTIAL | Недостаточно доказательств / неполная выборка или binding |
| STALE | Evidence относится к старой структуре topology/profile |
| CHAIN_UNAVAILABLE | What-if отказ разрывает заданную цепочку; альтернативы не изобретаются |

UNREACHABLE controller не означает NODE DOWN. Controller показывает selection,
а не путь всех пакетов. Возраст наблюдения сам по себе не меняет классификацию.

## 10. Практические сценарии с доказательствами

**Согласование трёх уже нужных владельцу VPS.** Pure generation suite, case
entry→transit→exit, получает три READY артефакта; transit содержит listener
`shadowsocks` и outbound `ss` с endpoint следующего звена. Это конкретная польза:
меньше ручных несогласованных ссылок. Доказан artifact contract; экономия
времени на реальном deployment количественно не измерена.

**Аудит отказа transit.** Pure what-if возвращает CHAIN_UNAVAILABLE и объясняет
разрыв без fake fallback. Полезно для анализа намерения; доступность сети не измеряется.

**Проверка выбора local fallback.** Controller fixtures различают CONSISTENT,
INCONSISTENT, UNKNOWN и PARTIAL по bindings. Полезно при ручном расследовании
нескольких процессов, но IP выхода и UDP/DNS path требуют самостоятельных probes.

**Обычный Keenetic → выбранный exit / AWL / Tiered.** В этом сценарии нет
практической необходимости вводить физическую модель: обычные Builder, Inspector
и VRG уже показывают локальный YAML. Физическая лаборатория увеличивает число
понятий и шагов без доказанной дополнительной пользы для текущей приёмки владельца.

## 11. Сравнение с существующими способами

| Способ | Область действия | Чего не заменяет |
|---|---|---|
| `dialer-proxy` | Выход одного proxy через другой в одном Mihomo | Настройку listeners/системной маршрутизации на трёх VPS |
| Tiered | Строгий порядок локальных групп, url-test/fallback внутри | Физический маршрут/мгновенный failover сессий |
| AWL | Два источника PRIMARY/FALLBACK, доменные политики | Распределённый deployment |
| CDG/VRG/Inspector | Зависимости и rules финального локального YAML | Физическую достижимость следующего сервера |
| Ручные per-node configs + карта | Максимально прямой контроль существующих VPS | Автоматическую согласованность; её проверяет PT model |
| PT | Intended multi-process contracts и bounded observations | Полноценный оркестратор и packet-level acceptance |

## 12. Почему убрано из GUI v1.11

Прямое решение текущего owner task: основной GUI должен обслуживать работающий
генератор и понятную диагностику. Лаборатория требовала отдельного JSON,
контрактов и знания разных уровней evidence, показывала неполный WARP result
и не имела подтверждённой текущей owner field need. Непонятные artifacts и
ложный STALE от lab inputs дополнительно мешали обычному Builder.

UI удалён из навигации/каталога/quick-start, контейнер скрыт и inert. Локальные
отступы internal steps исправлены. Lab/profile inputs исключены из Builder
fingerprint и freshness events; это реальный UI fix. Недостающие транспорты
и сетевые доказательства по-прежнему отсутствуют.

## 13. Затраты сопровождения

Отдельная IR, identity/roles/refs, transport registry с server/client парами,
controller authentication/CORS/abort/staleness, evidence wording, секреты,
downloads, DNS/UDP/MTU semantics, browser/mobile/a11y и двухверсионная Mihomo
матрица. Каждый новый транспорт увеличивает необходимость синхронной проверки
inbound/outbound и external-contract поведения. Код остаётся в inline bundle;
скрытие интерфейса не уменьшает размер загрузки и не устраняет maintenance cost.

## 14. Условия возвращения

Новый Owner GO и конкретная текущая задача с независимыми узлами; согласованный
минимальный topology/transport набор; реальные безопасно предоставленные fixtures;
владелец операций deployment; измеримые acceptance criteria. Обязательны
отдельные TCP/UDP/DNS/MTU/path/recovery проверки и ясное отличие intended,
controller evidence, parser validation и field acceptance. Автоматического
плана v1.12 или нового мастера этот документ не создаёт.

## 15. Что потребуется для восстановления интерфейса

Сначала проверить актуальность compiler contracts на выбранных версиях Mihomo,
оценить выделение experimental module из основного bundle, определить понятный
ввод реальной задачи и результаты по каждому узлу. Затем минимальный UI с
проверяемыми статусами, secret handling и явными действиями без deployment по
умолчанию. Повторно выполнить browser/mobile/a11y/no-Build-mutation проверки и
получить отдельную field acceptance. Нельзя просто добавить ссылку обратно и
считать старую синтетическую матрицу достаточной.

## 16. Итог

**Сохранить в резерве с выключенным публичным интерфейсом.** В pure model и
artifact contracts есть конкретная ценность для согласования распределённых
Mihomo процессов. Однако текущая обычная owner workflow не требует этого
уровня модели, demo WARP остаётся external contract, а сетевой выигрыш новой
реализации не измерен. Развитие отдельно имеет смысл после новой практической
задачи и Owner GO. Окончательное удаление исходников сейчас потеряло бы
проверенные контракты и fixtures без необходимости; автоматическое возвращение
в roadmap также не обосновано.

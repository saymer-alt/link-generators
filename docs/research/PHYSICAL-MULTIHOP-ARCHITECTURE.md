# Physical Multi-Hop: архитектурный аудит и дизайн foundation (v1.11)

> Owner Round 2: публичный Physical Topology UI выключен. Этот документ описывает сохранённый эксперимент, а не доступную пользовательскую функцию. См. [Product Review](PHYSICAL-TOPOLOGY-PRODUCT-REVIEW.md).


Внутренний документ цикла v1.11.0 (canonical scope — issue #177; primary capability — #149).
Базис: v1.10.0 released (stable `447af22`), main после bootstrap = `1.11.0-dev` / `main`.
Дата: 2026-10-07/08. Статус: дизайн-документ; реализованные части помечены, обещания — разделены по уровням evidence.

Evidence-дисциплина цикла: **SOURCE-PROVEN** (проверено по исходникам/документации), **RUNTIME-PROVEN** (проверено на живом mihomo), **FIELD-OBSERVED** (наблюдение владельца), **INFERRED** (следствие из доказанного), **HYPOTHESIS** (не проверено), **UNKNOWN** (не исследовано). Ничто не повышает уровень без нового доказательства.

**Текущий статус на main (2026-10-08):** последующие этапы реализованы после исходных design-разделов ниже. #188 добавил memory-only Runtime Evidence через Controller API; #187 добавил per-node generation для SS/SOCKS/HTTP и внешние контракты для остальных транспортов. Разделы 7–8 и Phase 14–15 сохраняют первоначальные проектные решения и формулировки того времени; актуальные контракты: [PT-RUNTIME-EVIDENCE.md](PT-RUNTIME-EVIDENCE.md) и [PT-GENERATION.md](PT-GENERATION.md). Ни одна функция не доказывает фактический packet path.

---

## 0. Продуктовая рамка (из #177, authoritative)

Physical Multi-Hop ≠ Tiered Failover (#148). Tiered Failover выбирает один exit из группы эшелонов **внутри одного конфига**. Physical Multi-Hop — один поток последовательно проходит через несколько **физически разных** узлов:

```
Client → ENTRY → TRANSIT (0..N) → EXIT → optional FINAL OVERLAY → Internet
```

Owner-решения цикла:

1. Initial topology class = **LINEAR CHAIN**. Внутренняя модель graph-friendly, обещанная семантика v1.11 — linear.
2. Конечная цель — per-node конфигурация **после proof gates**: Topology → Validate → Explain → Simulate → Runtime prove → Generate.
3. Orchestration engine = **Mihomo**; другие стеки — только endpoint/transport context.
4. LOCAL failover внутри узла разрешён; **automatic topology failover — NOT PROMISED** до отдельного runtime proof.
5. Историческая топология владельца (санитизированная): Client → VPS Moscow (ENTRY) → VPS Estonia (TRANSIT) → VPS Sweden (EXIT) → WARP overlay → Internet. Каждый узел — отдельная машина со своим Mihomo/локальным стеком, решающая только задачу следующего hop'а.

---

## 1. Архитектурный аудит существующего генератора (PHASE 3)

### A. Input/UI state

`index.html` — единственный handwritten-файл; состояние ввода живёт в DOM (поля по id) + память вкладки (не-persisted переменные: `wgBeans`, `tierCards` canonical state, `lastPreviewSummary`, runtime-import данные). Персистентность — точечный localStorage (device identity registry, user settings); телеметрии и сети без явного действия нет. Правило приватности: `fetch`/`XMLHttpRequest`/`sendBeacon`/`localStorage` для новых фич запрещены без явного решения.

### B. Canonical state/model

Канонические модели уже есть и все — **локальные для одной сборки**:

- `lastRoutingDoc` — снапшот последнего Build (сгенерированный объект конфига);
- canonical tier-cards state (`saveTierCardsState`/`renderTierCards`, `pendingSelect`);
- device identity registry (`link-generators.device-identities.v1`);
- wgBeans (профили WG/AWG) + `wgRejected`.

### C. Validation

Pre-copy валидатор `validateMihomoYaml` (state machine, Copy gated on VALID) — про итоговый YAML. Локальные валидаторы слоёв: tier-правила (пустое имя/дубликат/неизвестный участник), WG-парсер (rejected-список), dialer-граф.

### D. Build

`buildMihomo()` собирает options → `web4core.buildFromRequest` (runtime). Фича-переключатели дают byte-parity в выключенном состоянии — контракт подтверждён тестами parity.

### E. Dependency Graph (Config Dependency Graph, CDG)

Ядро — marker-блок `CDG-CORE-START/END` внутри `RD-CORE-START/END` в `index.html` (строки ~5021–5238 на момент аудита): `cdgBuildGraph(doc)` строит ориентированный граф **только из generated config**: узлы `rule:N`, `rule-provider:<name>`, `group:<name>`, `proxy:<name>`, `builtin:<T>`, `proxy-provider:<name>`, `dns:config`; рёбра `routes-to` / `uses` / `dialed-through` / `resolves-via`. Инварианты (owner review #140): один semantic ID → один node (детерминированный merge, конфликт metadata → throw), referential integrity обоих концов каждого ребра, детерминированный порядок построения. Тест извлекает блок из index.html по маркерам и исполняет через `new Function` — **это канонический паттерн для новых pure-ядер**.

### F. Semantic Trace

Два уровня уже существуют:

1. **Value trace** (docs/CONFIGURATION-INTELLIGENCE.md §5): `raw input → parsed → normalized/emitted | omitted + reason` — реализовано в Explainability UX (SELECT semantics, stale build).
2. **Path trace**: Domain Coverage (`cdgDomainCoverage`) — статический путь домена до цели с честными границами (`runtime-selected` для select/url-test/fallback, UNKNOWN для GEOSITE/GEOIP/external). WG MTU chain planner (`web4core.planWireGuardMtu`, docs/MIHOMO.md) — обход dialer-подграфа с распространением диагностического факта вдоль рёбер.

Ни один из них не описывает цепочку из нескольких независимых Mihomo-инстансов.

### G. Runtime Import

v1.10 Runtime Import (#159): один контроллер, `GET /providers/proxies`, канонический парсер, secret в памяти, никакого прокси-посредника. Контракт: импорт не мутирует конфиг и не делает build STALE.

### H. YAML generation

`buildMihomo()` → `web4core.buildFromRequest`. Все emission-решения — в web4core форке; продукт добавляет middleware-слои поверх (AWG 3.1 compat, DNS interception, DPR, tiered, dialer). Fingerprint/stale: `buildStateFingerprint()` по DOM-инпутам минус `BUILD_STALE_EXCLUDED_IDS` (диагностические поля сознательно исключены: rdTestInput, dcInput, rtControllerInput, rtSecretInput).

### I. web4core/runtime boundary

Парсинг/emission — форк; продукт — UI, middleware, диагностика. Physical topology — **продуктовая** модель (не emission), поэтому живёт в index.html; если когда-нибудь понадобится runtime-функция (например emission per-node конфигов) — сначала форк, потом продукт (порядок публикации: форк → workflow → consumer).

### J. Tests

Паттерны: node-тесты с извлечением ядра по маркерам (`dependency-graph.cjs`), browser-тесты Playwright (channel msedge), runtime-тесты с реальным mihomo (`*-runtime.cjs`), parity-тесты байт-в-байт. CI-инвариант: каждый `tests/*.cjs` обязан быть вписан в `generator-ci.yml` (step «Every deterministic test is wired into CI»); `*.manual.cjs` исключены.

### Ответы на 10 ключевых вопросов

**1. Можно ли physical topology представить расширением existing graph (CDG)?**
**Нет — отдельный IR с явной границей.** CDG по построению принимает **один generated config** (`doc`) и описывает зависимости ВНУТРИ него; его узлы — объекты конфига, а physical topology описывает **несколько независимых машин/инстансов**, существующих до и независимо от любой генерации. Затягивание topology в CDG потребовало бы фальшивого `doc`-входа и нарушило бы контракт «узел/ребро создаётся, только когда связь доказуема из конфига». Reuse берётся на другом уровне: **паттерны** (marker-блок pure-ядра, `new Function`-извлечение в тестах, structured diagnostics с severity, детерминированная canonical-форма, no-speculation) и **будущий adapter**: узел topology → (в будущем) per-node generated config → который сам анализируется CDG. Точка интеграции зафиксирована: physical topology ссылается на local routing policy узла, но не содержит её; CDG продолжает работать только по сгенерированным документам.

**2. Какие node types уже существуют?** CDG: rule / rule-provider / proxy-group / proxy (incl. wireguard) / builtin / proxy-provider / dns-policy / unresolved. Это типы объектов конфига, не физические узлы.

**3. Какие edge semantics уже существуют?** routes-to, uses, dialed-through, resolves-via, derived-from (зарезервирован), contains/matches (концептуально). Для topology вводятся **свои** ребра физического уровня (`physical-hop` между node ID), не переиспользующие CDG-типы.

**4. Где хранится distinction proxy/group/provider/WG bean/runtime-only?** В CDG — поле `kind` узла; в build-слоях — по месту в options/документе. Топологии это не касается: у неё свои типы узлов по РОЛИ (entry/transit/exit/final-overlay), а не по объекту конфига.

**5. Может ли current Semantic Trace описать boundary между несколькими независимыми Mihomo instances?**
Нет — и это не баг: существующие trace'ы честно работают в пределах одного документа/одной сборки. Physical trace добавляется отдельным слоем с явным контрактом: **INTENDED (configured) vs RUNTIME-OBSERVED**; до появления multi-controller evidence наблюдаемая топология = `NOT_MEASURED`, и никаких формулировок «трафик сейчас идёт через …».

**6. Какие функции implicitly assume one generated config == one Mihomo runtime?** Весь build/validate/parity путь; CDG/Domain Coverage (`lastRoutingDoc`); Runtime Import (один контроллер); fingerprint (одна сборка). Для v1.11 это не ломается: topology — diagnostics-only слой рядом, не внутри.

**7. Где future multi-controller runtime data может быть attached, не ломая current Runtime Import?** К узлу topology как **optional Runtime Evidence Source** (адрес + secret, per-node, по явному действию, memory-only; см. §7). Существующий Runtime Import (#159) остаётся как есть — его контракт не расширяется в v1.11.

**8. Где разместить topology state?** Модель — pure-ядро в index.html (marker-блок, тестируемое через `new Function`), UI-состояние — память вкладки (JSON-спецификация в textarea + производный разбор; недоступные в what-if узлы — Set в памяти). НЕ в build model, НЕ в fingerprint (см. 9), НЕ в localStorage.

**9. Как не включить topology editor state в YAML fingerprint, пока generation semantics не реализована?** Все инпуты панели добавить в `BUILD_STALE_EXCLUDED_IDS` (прецедент: rdTestInput/dcInput/rtControllerInput/rtSecretInput) + регрессионный тест «topology edits не делают build STALE и не меняют YAML» (фича OFF → byte-parity тривиален, т.к. topology не участвует в build вообще).

**10. Какие current tests можно reuse?** Паттерн извлечения ядра (dependency-graph.cjs); browser-инфраструктура (Playwright msedge, js-yaml роутинг); mobile-tabs подход для 320/360/412/480 проверок; version-badge подход для «фича не влияет на YAML».

---

## 2. Upstream research: Mihomo и физическая цепочка (PHASE 4)

Источники проверены 2026-10-07/08. Навигационный факт: в репозитории `MetaCubeX/mihomo` ядро живёт на ветке **`Alpha`** (ветка `main` содержит посторонний контент, не относящийся к ядру — проверено raw-fetch README обеих веток).

### 2.1 `dialer-proxy` — SOURCE-PROVEN

- Официальная документация (wiki.metacubex.one, страница «dialer-proxy», дата 2026-05-14): поле ставится **на отдельный outbound-прокси** (`proxies: - name: ss1 / dialer-proxy: <proxy|group>`), либо на все прокси провайдера через `override: dialer-proxy: …` (http/inline провайдеры). Семантика: «указанный прокси устанавливает сетевое соединение через dialer-proxy»; пример ядра → ss1 wrapper → ss2 server → ss1 server → target. Внешний наблюдатель (цель) видит только ss1; провайдер ss1-сервера — только ss2.
- Исходник `config/config.go` (Alpha): `DialerProxy string \`yaml:"dialer-proxy"\`` в конфиге прокси; после построения всех прокси вызывается `validateDialerProxies(proxies)`.
- Исходник `config/utils.go` (Alpha): `validateDialerProxies` — каждый `dialer-proxy` обязан ссылаться на существующий прокси/группу (`proxy [X] dialer-proxy [Y] not found` — конфиг НЕ загружается), DFS-детектор циклов (`proxy [X] has circular dialer-proxy dependency`).
- Прямого поля `dialer-proxy` у proxy-groups нет (документация; в parseProxyGroup отсутствует) — SOURCE-PROVEN на уровне «в парсере групп поля нет».

### 2.2 relay — SOURCE-PROVEN (удалён)

В `adapter/outboundgroup` ветки Alpha файлов `relay.go` **нет** (fallback/groupbase/loadbalance/parser/selector/urltest/util — полный список на 2026-10-08). Документация называет relay deprecated и предлагает миграцию: первый hop — select-группа, вторые hop'ы — inline-провайдер с `override: dialer-proxy: <первая группа>`. Вывод для v1.11: **не строить физическую цепочку на relay**; межузловая цепочка — не внутри одного инстанса вообще (см. 2.4).

### 2.3 Операционные ограничения цепочек — SOURCE-PROVEN (как рекомендации wiki) / behavior — UNKNOWN

- UDP-протоколы (hy2/tuic/wg) и TLS-камуфляж (reality/shadowtls) **не рекомендуются** через транзитный узел — рекомендация документации, НЕ enforcement.
- В сценарии «всё через SOCKS-front»: скачивание подписок и DNS-резолв **не автоматически** идут через front — требуется отдельная конфигурация. Отсюда архитектурный тезис v1.11: **DNS path ≠ data path по умолчанию; совпадение требует доказательства** (см. §6).
- Поведение UDP end-to-end через N физических узлов — UNKNOWN до per-hop тестов (каждый hop должен поддерживать UDP своего транспорта; итог — конъюнкция, не аксиома).

### 2.4 Ключевой архитектурный вывод

Вся доказанная механизмика `dialer-proxy` — про цепочку **внутри одного инстанса Mihomo**. Physical Multi-Hop по определению #149 — это цепочка **нескольких независимых инстансов** на разных машинах: клиентский Mihomo соединяется с ENTRY обычным прокси-протоколом; ENTRY-стек по СВОЕЙ локальной конфигурации передаёт поток к TRANSIT; и т.д. Из этого следуют产品设计 решения:

1. Ядро физической цепочки — не YAML-конструкции, а **контракт между машинами**; YAML появляется только на per-node generation этапе (после proof gates).
2. Ни один контроллер не видит всю цепочку: `GET /connections` показывает локальную цепочку прокси инстанса (SOURCE-PROVEN по семантике API; полнота полей — UNKNOWN до проверки). Multi-hop доказательство — это **сведение evidence с нескольких контроллеров**, а не чтение одного поля (см. §7).
3. «N × M × K независимых маршрутов» — HYPOTHESIS-интуиция: пересечение локальных выборов разных инстансов не образует единого координированного механизма. Не продукт-контракт.

### 2.5 Верхняя граница применимости

Runtime-версии, на которых строятся совместимости проекта: 1.19.31/1.19.32 (RUNTIME-PROVEN полы проекта). Требования конкретных версий к per-node конфигурации — предмет будущего compat matrix (§8), сейчас UNKNOWN.

---

## 3. Canonical Physical Topology Model (PHASE 5)

### 3.1 Решения

- **Schema version**: `ptSchemaVersion: 1` в модели; несовместимые изменения = bump + мигратор.
- **Идентичность**: стабильные node ID — произвольные непустые строки, trim; **display label — не identity** («Estonia» может быть переименовано без изменения связей).
- **Роли**: `entry` / `transit` / `exit` / `final-overlay`. Client и Internet — **границы цепочки, не узлы**: они не имеют ID и не участвуют в ссылках; trace рисует их как концевые элементы пути.
- **FINAL_OVERLAY — узел или attachment?** Решение: **узел с ролью `final-overlay`** (участвует в порядке и links, ровно один, строго последний, физическим hop'ом от exit). Обоснование: линейная семантика валидатора и trace единообразно работают с «последним элементом цепочки»; overlay-attachment как отдельная сущность добавил бы второй механизм позиционирования без выигрыша. Отличие от физических узлов фиксируется полем роли (семантика «overlay-сервис на внешнем пути», например WARP) и валидатором (overlay не может быть в середине, не может быть entry/exit).
- **Physical links**: направленные пары `from→to` node ID — отдельные записи (не неявный порядок массива), чтобы модель была graph-ready для будущего расширения.
- **Local routing policy**: `localPolicies: [{ nodeId, targetNodeId, candidates: [{id, label?}] }]` — ссылка на ЛОКАЛЬНУЮ политику узла: какой физический узел является целью и какими транспортными кандидатами узел к ней идёт. Кандидаты — строки-идентичности (не node ref'ы): «candidate transport A/B/C» из #177. Политика хранится рядом, **не** в графе ссылок: physical graph остаётся одним ребром Estonia→Sweden, сколько бы кандидатов у hop'а ни было (принцип Physical ≠ Local Policy).
- **Secret-free**: модель не содержит адресов, ключей, URL, учётных данных. Engine/capability identity — опциональные человекочитаемые метки (`engine: "mihomo"`, `transport: "awg"` и т.п.), без значений.
- **Детерминизм**: без времени, без случайности, каноническая сериализация (§3.3).

### 3.2 Форма спецификации (вход разбора)

```json
{
  "nodes": [
    { "id": "msk-entry",  "label": "Moscow · ENTRY",  "role": "entry",  "engine": "mihomo" },
    { "id": "est-transit","label": "Estonia · TRANSIT","role": "transit","engine": "mihomo" },
    { "id": "swe-exit",   "label": "Sweden · EXIT",   "role": "exit" },
    { "id": "warp-out",   "label": "WARP · overlay",  "role": "final-overlay" }
  ],
  "links": [
    { "from": "msk-entry", "to": "est-transit" },
    { "from": "est-transit", "to": "swe-exit" },
    { "from": "swe-exit", "to": "warp-out" }
  ],
  "localPolicies": [
    { "nodeId": "est-transit", "targetNodeId": "swe-exit",
      "candidates": [ { "id": "candidate-a", "label": "AWG" }, { "id": "candidate-b", "label": "Mieru" } ] }
  ]
}
```

### 3.3 Каноническая сериализация

`ptSerialize(model)` — для валидной линейной модели: узлы в **порядке цепочки** (traversal от entry), фиксированный порядок ключей, без display-зависимостей. Две спецификации с разным порядком массива `nodes`, описывающие одну цепочку, дают байт-равную каноническую форму (порядок массива не семантичен; порядок цепочки определяется links+roles). Для невалидной модели сериализация не производится (возвращается null) — не канонизируем мусор.

---

## 4. Linear chain invariants и валидатор (PHASE 6/7)

### 4.1 Инварианты (полный список валидатора)

VALID формы: `Client → Entry → Exit [→ Overlay] → Internet`; с 0..N transit между entry и exit.

ERROR-классы: `PT-DUP-ID`, `PT-BAD-ROLE`, `PT-LINK-DANGLING`, `PT-LINK-SELF`, `PT-LINK-DUP`, `PT-CYCLE`, `PT-ENTRY-MISSING`, `PT-ENTRY-MULTIPLE`, `PT-EXIT-MISSING`, `PT-EXIT-MULTIPLE`, `PT-ROLE-ORDER` (transit до entry / после exit; entry после exit), `PT-DISCONNECTED` (узел вне цепочки entry→exit), `PT-OVERLAY-POSITION` (overlay не последним / не после exit), `PT-POLICY-DANGLING`, `PT-POLICY-TARGET-ROLE` (цель локальной политики — не физический узел подходящей роли).

WARNING-классы: `PT-POLICY-TARGET-MISMATCH` (цель локальной политики не совпадает с физическим следующим hop'ом — легально, но подозрительно), `PT-POLICY-EMPTY` (политика без кандидатов).

INFO: `PT-INFO-CHAIN` (сводка цепочки: hops, роли), `PT-INFO-LABEL-DEFAULT` (label не задан — используется id).

Принципы: **no silent-fix** (никакой автоматической починки структуры), **diagnostics before mutation**, детерминированный порядок диагностик (по фазам разбора: schema → identity → graph → roles → policies; внутри фазы — по входному порядку), structured `{severity, code, message, refs?}`.

### 4.2 Границы валидатора

Валидатор — **структурный**: он доказывает свойства модели, не сети. «Связность» здесь = графовая, не сетевая достижимость; сетевой уровень — предмет будущего runtime evidence (§7). Валидатор не зависит от DOM/сети/YAML — pure.

---

## 5. Semantic Trace физического слоя (PHASE 9)

`ptTraceTopology(model)` — детерминированный текст + структура:

```
Configured (intended) physical path:
Client → Moscow · ENTRY [entry] → Estonia · TRANSIT [transit] → Sweden · EXIT [exit] → WARP · overlay [final-overlay] → Internet

Local policy at Estonia · TRANSIT:
  физическая цель: Sweden · EXIT
  транспортные кандидаты: AWG (candidate-a), Mieru (candidate-b)
```

Контракты формулировок:

- Только **«configured/intended»**. Поле `observed: "NOT_MEASURED"` в результате; формулировки «трафик сейчас идёт через …» запрещены до runtime evidence.
- Physical и local policy НЕ сплющиваются в один путь: основной путь — физические узлы; локальные политики — отдельные секции по узлам.
- Формулировки не содержат секретов/адресов (их в модели и нет).

---

## 6. DNS path / MTU: диагностические foundation (PHASE 12/13)

### DNS path

Факты: wiki SOURCE-PROVEN — скачивание подписок и DNS через front-прокси **не автоматичны** (§2.3). Значит: где резолвится имя следующего hop'а (на каком узле), где резолвится конечный домен, совпадает ли юрисдикция DNS с цепочкой — **свойства конфигурации каждого узла, по умолчанию UNKNOWN**. v1.11 foundation: research-раздел (этот) + поле осознанного незнания в trace/диагностике («DNS path: UNKNOWN — не моделируется»); анализатор скелетом (`ptDnsPathNote(model)` — статический текст с перечнем открытых вопросов) без выдумывания behavior. Автоматических DNS-мутаций нет.

### MTU

Reuse: docs/research/AWG-MTU-OVERHEAD.md (CPA/RandomTrailers ветки, RandomTrailers без верхней границы → auto-MTU небезопасен), docs/research/WG-MTU-MIHOMO.md (verdict PARTIALLY PROVEN), docs/MIHOMO.md (planWireGuardMtu — «расчётный потолок», не гарантия). Для N физических hop'ов: эффективный MTU = ограничение по худшему звену, но overhead **каждого** межузлового транспорта — отдельная транспорт-специфичная величина; **складывать числа на глаз запрещено** (решение #177). v1.11: диагностика перечисляет звенья и маркирует каждое UNKNOWN/PARTIAL по наличию proof; auto-MTU — OUT OF SCOPE (без изменений политики проекта).

---

## 7. Multi-controller runtime evidence (PHASE 14, design only)

Контракт «Topology Node ↔ optional Runtime Evidence Source»:

- адрес контроллера — user-editable per node; secret — только память вкладки; никаких auto-fetch/прокси-посредников; запрос — только явное действие;
- evidence **никогда не мутирует** topology автоматически;
- разделение «configured physical edge» vs «runtime-observed proxy/group/controller state» — разные типы фактов, разные поля;
- **потолок доказательности** (documented evidence ceiling): контроллер инстанса доказывает состояние СВОЕГО инстанса (прокси/группы/соединения локальной цепочки). Он **не доказывает** сетевой путь между машинами (traceroute-семантики в API нет), не доказывает UDP-сквозняк и не видит соседние узлы. Поле `observed` остаётся NOT_MEASURED, пока сведение evidence с узлов не покрыто тест-планом §9.

В v1.11 реализация НЕ планируется (дизайн); Runtime Import #159 не расширяется.

---

## 8. Per-node generation contract (PHASE 15, design only)

Будущий генератор (после proof gates) должен выдавать на topology `Client → Entry → Transit → Exit [→ Overlay]`:

- артефакт per физический узел: ENTRY/TRANSIT/EXIT — mihomo config; CLIENT — фрагмент/конфиг; опционально overlay-attachment;
- deployment manifest (human-readable install map) — без SSH.

Дизайн-вопросы (зафиксированы, не решены реализацией):

- **Глобальные данные**: топология, роли, порядок, имена артефактов (детерминированные: `<node-id>.yaml`).
- **Per-node данные**: локальная политика узла, её транспортные кандидаты и их параметры.
- **Ссылки между артефактами**: узел A ссылается на узел B через транспортный endpoint B — место для **placeholder-инъекции секретов** (не персистить; вычислять в момент выгрузки). Схема placeholder'ов — открытый вопрос.
- **Валидация**: `mihomo -t` на каждый артефакт (пол проекта: binary path per platform — существующий опыт compat matrix); compatibility matrix per узел (полы 1.19.30/1.19.31 и т.п.).
- **Порядок генерации**: детерминированный (порядок цепочки).

Никакой фейковой production-реализации: этот раздел — граница, а не код.

---

## 9. Future real VPS test plan (PHASE 16, sanitized, НЕ выполняется в цикле)

Потенциальный testbed владельца: Moscow / EE / SE (санитизированные метки; никаких адресов). Матрица будущих доказательств (каждый пункт: expected / actual / evidence class при исполнении):

1. 2-hop TCP сквозняк; 2. 3-hop TCP; 3. UDP отдельно (не «вместе с TCP»); 4. DNS path (где резолвится hop-имя, где конечный домен); 5. restart middle-hop процесса; 6. полная недоступность middle-hop; 7. отказ downstream-транспорта; 8. local failover внутри Transit; 9. failback; 10. session continuity: существующий TCP / новый TCP / UDP-сессия при смене локального выбора; 11. MTU/крупные пакеты; 12. latency; 13. throughput; 14. controller evidence сведение; 15. final overlay (WARP); 16. отсутствие route loop; 17. отсутствие экспозиции контроллеров; 18. отсутствие утечки секретов.

Правила: тесты выполняет владелец на своей инфраструктуре; никаких SSH/мутаций из цикла разработки; до исполнения все пункты UNKNOWN.

---

## 10. Что реализовано в v1.11-dev foundation (этот цикл)

- Pure-ядро в index.html (marker-блок `PT-CORE-START/END`): `ptAnalyzeTopology` (schema+identity+graph+roles+policies, диагностический контракт §4), `ptSerialize` (каноническая форма §3.3), `ptTraceTopology` (§5), `ptSimulateTopology` (what-if §11 ниже), sanitized reference fixture (`ptDemoTopologySpec`, §11).
- Regression: `tests/physical-topology.cjs` (20+ групп; chain 2/3-hop, multiple transits, дубликаты, self/2-node/3-node циклы, disconnected, unreachable exit, role order, multiple entry/exit, overlay placement, детерминизм сериализации и trace, Physical≠Local разделение, отсутствие секретов в диагностиках, Unicode labels, what-if middle-hop, parity при выключенной фиче).
- Что сознательно НЕ реализовано **на момент этой PHASE 10/11 фиксации**: runtime evidence (§7), per-node generation (§8), DNS/MTU-анализаторы глубже скелета (§6), automatic topology failover, mesh. Текущий статус первых двух этапов указан в заметке в начале документа.

### What-if (PHASE 11)

`ptSimulateTopology(model, { unavailableNodeIds, unavailableLinkIndexes })` — pure, без мутаций: любая недоступная вершина/ребро цепочки ⇒ `CHAIN_UNAVAILABLE` с диагнозом «Physical chain broken: A → B (узел недоступен). No alternate physical transit path is configured.». Альтернативная физическая топология **не** подставляется никогда — её просто нет в модели (решение #177: topology failover not promised).

### Визуализация (PHASE 10)

Read-only вертикальный срез: экспериментальная панель в Builder-вкладке (details, бейдж EXPERIMENTAL · v1.11-dev): demo-топология / paste JSON / анализ; вертикальный линейный рендер цепочки; what-if кликом по узлу; всё в памяти вкладки, excluded из build fingerprint, YAML не меняется. Desktop + 320–480 mobile, без горизонтального overflow; controls — кнопки/textarea с aria-label.

## Owner field-test entry point (v1.11)

Builder exposes the local lab as «Межсерверные цепочки: лаборатория» with a practical introduction, a demo and Analyze before the expert JSON editor. Inspect the route and generated artifacts, then follow the manual/external acceptance contract. Only the documented SS/SOCKS/HTTP combinations are represented; the UI does not deploy servers or prove live failover. A guided multi-server wizard remains v1.12 work. See [Owner field-test UX report](OWNER-FIELD-TEST-UX-POLISH.md).

# Mihomo Config Studio: аудит импорта и дизайн source-preserving editing (v1.11)

Документ цикла v1.11 (#177): #176 (import/inspector) + #178 (dependency-aware editor).
Дата: 2026-10-08. Базис: main `6a389c0` (Physical Topology foundation из NIGHT-01).

Evidence-метки как в PHYSICAL-MULTIHOP-ARCHITECTURE.md.

---

## 1. Аудит существующих путей обработки конфига (PHASE 2)

| Компонент | Где | Вход | Пригодность для импорта |
|---|---|---|---|
| YAML-парсер страницы | js-yaml 4.1.0 (CDN) | текст → plain object | **да** для анализа; комментарии/порядок/форматирование ТЕРЯЕТ при dump — для экспорта НЕ годится |
| Pre-copy валидатор | `validateMihomoYaml` (index.html) | сгенерированный YAML | заточен под генератор; для импорта не переиспользуем (иная цель), статические проверки студии — свои, поверх CDG |
| Config Dependency Graph | `cdgBuildGraph(doc)` в RD-CORE | **любой** doc-объект (`{rules, proxies, proxy-groups, rule-providers, proxy-providers, dns}`) | **полное переиспользование**: тесты CDG уже скармливают hand-made docs; импортированный конфиг после js-yaml-парса — такой же вход. Спекулятивных узлов нет, unknown-target'ы становятся typed-узлами |
| Routing Inspector | `routingInspect(doc, input)`, `rdParseRule`, `cdgDomainCoverage(doc, domains)` | doc + строка | **полное переиспользование** (pure); GEOSITE/GEOIP/external — честный UNKNOWN |
| Semantic Trace | value-trace (Explainability), path-trace (`cdgDomainCoverage`) | doc | переиспользование; формулировки «configured», никогда «runtime selected» |
| Routing Diagnostics UI | `updateRoutingDiagnostics(yaml)` | YAML-текст | НЕ переиспользуем напрямую: пишет в снапшот последнего Build (`lastRoutingDoc`) — принадлежит генератору; Studio вызывает pure-функции со своим doc |
| Runtime Import (#159) | контроллер | API JSON | отдельный источник; Studio не трогает |
| web4core | parse links / build | генерация | не нужен для анализа импорта |

**Ответ на ключевой вопрос PHASE 2: да** — импортированный конфиг после обычного `jsyaml.load` скармливается существующим `cdgBuildGraph` / `routingInspect` / `cdgDomainCoverage` напрямую, без нормализующего слоя и без второго аналитического фреймворка. Studio добавляет только: import UI, сводку, redaction, editor и source-preserving export.

## 2. Архитектура

```text
импортированный YAML-текст (память вкладки)
  ├─ js-yaml parse → doc ─→ CDG / Inspector / Trace / сводка / диагностики / secret-scan
  └─ CSYaml.parseDocument(src, {keepSourceTokens:true})  ← лениво (vendored cs-yaml.runtime.js)
        └─ CST-диапазоны → PATCH-план мутации → точечная сплайс-правка ИСХОДНОГО ТЕКСТА
```

- **Анализ** — js-yaml (уже на странице, сеть не нужна).
- **Редактирование/экспорт** — vendored `cs-yaml.runtime.js` (npm `yaml@2.9.1`, ISC; IIFE, глобал `CSYaml`), ленивая загрузка локального файла по явному действию (первое открытие редактора/экспорта). CDN не используется; `file://` работает офлайн.

## 3. Source-preserving модель (PHASE 11) — решение

Эмпирика (2026-10-08, `CSYaml.parseDocument(src).toString()` без правок):

| Кейс | Результат |
|---|---|
| `a:   1` | → `a: 1` (лишние пробелы схлопнуты) |
| `b :` | → `b:` |
| `list:` + элементы `- x` без отступа | → перенапечатаны с отступом 2 |
| `num: 007` | → `num: 7` (**тип скралара потерян**) |
| `x: "v"  # inline` | → `x: "v" # inline` (пробелы перед `#` нормализованы) |

`toString()` перепечатывает значения из parsed-данных ⇒ **«parse → мутировать документ → stringify всего» запрещён** контрактом владельца. Принятое решение — **гибрид «CST-диапазоны + точечная текстовая сплайс-правка»**:

1. `parseDocument(исходник)` даёт узлам `.range [start, end]` в исходных байтах.
2. Каждая мутация (поле/переименование/удаление/член группы/таргет правила) планирует список патчей `{start, end, replacement}` по диапазонам узлов.
3. Патчи применяются к ТЕКСТУ; после каждого шага — повторный парс (`CSYaml.parse`) как структурный guard + проверка ссылок.
4. Экспорт = исходный текст с применёнными патчами.

Следствия: no-op round trip **байт-в-байт** (ноль патчей — возврат исходника); одиночная правка меняет ровно свой диапазон; комментарии/порядок/кавычки/неизвестные ключи/`007`/anchors не переписываются никогда, потому что не переносятся вовсе.

Ограничения (документированы честно):
- редактирование значений внутри block-scalars/flow-коллекций ограничено скалярными диапазонами (справедливо для заявленного scope);
- anchors/aliases: переименование якоря, на который есть `*alias`, блокируется с диагностикой (честно, без «умного» переписывания);
- multi-document YAML (`---…---`) не поддерживается — явная ошибка;
- добавление объектов вставляет новый блок, отформатированный по соседям (локальная вставка, не перепечатка секции).

## 4. Secret redaction (PHASE 9)

Центральные правила `csIsSecretKey`/`csRedactValue`: ключи `password/private-key/secret/token/uuid/preshared-key/auth/authorization/x-hwid/psk/obfs-password/ws-headers.*(auth|token)` и tokenized-URL (query `token|key|auth|sig|…`, а также длинные path-токены после `/token/|/api/v1/…`). Значения секретов не попадают в сводку/диагностики/trace/граф/диф/ошибки; в редакторе секретные поля — masked inputs; в localStorage импортированное не пишется (вкладка-память). Фикстуры тестов — только синтетика (`example.invalid`, RFC5737, `00000000-0000-4000-8000-000000000001`).

## 5. Semantic boundary (PHASE 5)

STATIC CONFIG GRAPH (из YAML) ≠ LOCAL ROUTING POLICY (семантика групп) ≠ PHYSICAL TOPOLOGY (owner-declared, #149) ≠ RUNTIME EVIDENCE (#159/будущие контроллеры). Импортированный `dialer-proxy`/fallback в Studio подписывается словами «статическая цепочка конфига» — без VPS-утверждений.

## 6. Валидация перед экспортом (PHASE 16)

Статическая: повторный парс + CS-диагностики (dangling/duplicate/unused refs) + известные протокольные ограничения из существующего генераторного валидатора, где применимы к импорту. Формулировка: «Статическая валидация: PASS/FAIL · Runtime-валидация Mihomo: NOT RUN» — `mihomo -t` в браузере не исполняется, и мы не делаем вид, что исполнился. CI-фикстуры (синтетические) гоняются реальным mihomo 1.19.31/1.19.32 (шаг в compat job).

## 7. Non-goals

Никакого произвольного raw-YAML дизайнера; никакого auto-deployment/SSH/контроллерных мутаций; никакой отправки конфига куда-либо; без owner-конфигов в фиксстурах.

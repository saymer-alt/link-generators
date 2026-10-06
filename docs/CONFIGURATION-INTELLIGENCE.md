# Configuration Intelligence / Explainability

Этот документ фиксирует архитектурное направление после v1.8 research-цикла. Это **не обещание конкретной версии** и не описание уже реализованной функции. Цель — сохранить общую модель, чтобы Routing Graph, Domain Coverage, DNS↔Routing и другие анализаторы не выросли как независимые эвристики.

Связанный принцип проекта: [CONSTITUTION.md](../CONSTITUTION.md).

## 1. Зачем это нужно

До v1.8 генератор в основном отвечал на вопрос:

> «Какой YAML собрать из этих входных данных?»

Следующий уровень полезности:

> «Почему получился именно такой YAML, что изменилось по пути и куда фактически ведёт конкретное правило?»

То есть генератор становится не только builder, но и **объяснимым анализатором конфигурации**.

Это направление условно называется **Configuration Intelligence**. `Routing Intelligence` остаётся его первой и самой практичной частью.

## 2. Основная модель: Config Dependency Graph

Предлагаемая внутренняя абстракция — ориентированный граф зависимостей конфигурации.

Примерные типы узлов:

- routing rule;
- rule-provider;
- proxy-group;
- proxy leaf;
- WG/AWG proxy;
- dialer-proxy edge;
- DNS policy / nameserver path;
- subscription/provider;
- service/domain query как временный аналитический узел.

Примерные типы рёбер:

- `routes-to` — правило направляет в target;
- `uses` — group/provider использует другой объект;
- `dialed-through` — outbound использует промежуточный outbound;
- `resolves-via` — домен/набор доменов разрешается через DNS policy;
- `contains` — provider/group содержит дочерние элементы;
- `matches` — domain/query совпал с rule/provider.

Граф не обязан сразу быть отдельной публичной структурой API. Но новые анализаторы желательно проектировать так, чтобы их факты можно было свести к общей модели, а не дублировать обход конфигурации.

## 3. Что уже показывает ценность общей модели

### Routing Diagnostics

Уже существующие/подготовленные инструменты решают части одной задачи:

- Routing Preview;
- Generated Policy Inspector;
- Duplicate Detector;
- Shadow Analyzer;
- Rule Provider Explorer;
- unused/missing provider diagnostics.

Их естественное развитие — граф `rule → provider → target → group → proxy`.

### WG/AWG MTU chain

MTU planner исследует другой подграф:

`WG/AWG A → dialer-proxy B → dialer-proxy C → ...`

Это та же структурная задача: определить зависимости, цикл, границу известности и распространить диагностический факт вдоль рёбер.

### Cycle detection

WG self/cycle rejection и будущие routing cycles — частные случаи графового анализа.

## 4. Первые продукты поверх модели

### 4.1 Domain Coverage Checker

Пользователь вводит домен, например:

```text
gemini.google.com
youtube.com
github.com
```

Инструмент должен объяснить:

- какое первое правило совпало;
- было ли совпадение через inline rule или rule-provider;
- какой target выбран;
- куда target ведёт дальше;
- есть ли потенциально конфликтующие/затенённые совпадения;
- есть ли домен, который пользователь ожидал покрыть, но он не покрыт известным набором.

Важно: Coverage Checker не должен обещать абсолютную полноту сторонних domain lists.

### 4.2 Routing Graph

Минимальный полезный граф:

`rule → rule-provider? → target/group → proxy/provider → leaf`

Цель — не «красивая картинка», а объяснение маршрута и обнаружение:

- dangling references;
- cycles;
- dead/unused nodes;
- targets, которые фактически ведут в неожиданный leaf;
- скрытых fallback-paths.

Визуальный UI — вторичен. Сначала нужна корректная модель фактов.

### 4.3 DNS ↔ Routing consistency

Анализ должен сопоставлять:

- каким DNS-path разрешается домен;
- каким routing-path затем идёт его трафик;
- совпадают ли ожидаемые policy boundaries;
- нет ли очевидного direct/proxy mismatch;
- где анализ невозможен из-за динамики/runtime state.

Важно не выдавать статический анализ за packet capture: результат должен маркировать границы уверенности.

### 4.4 What-if simulator

Поздняя функция поверх того же графа:

> «Что изменится, если это правило поднять выше / target заменить / provider отключить?»

What-if должен работать на копии модели и **не изменять пользовательский YAML автоматически**.

## 5. Semantic Trace: что произошло с пользовательским вводом

Отдельная, но родственная модель — trace значения от input до output.

Минимальный путь:

`raw input → parsed value → normalized/policy decision → emitted value | omitted → diagnostic reason`

Статусы из WG/AWG value semantics дают хорошую основу:

- `SUPPORTED`;
- `SUPPORTED_NORMALIZED`;
- `UNSUPPORTED`;
- `INVALID`;
- `UNKNOWN`;
- `IGNORED_BY_POLICY`.

В будущем это можно обобщить на другие подсистемы, чтобы пользователь мог получить ответ:

> «Что генератор изменил относительно моего исходного ввода?»

Это не означает обязательный глобальный audit log в v1.9. Сначала достаточно сохранять структурированные факты в тех местах, где уже есть риск silent semantic change.

## 6. Evidence model для диагностики

Каждый нетривиальный вывод желательно уметь отнести к уровню доказанности:

| Уровень | Значение |
|---|---|
| `SOURCE-PROVEN` | подтверждено кодом/контрактом upstream |
| `RUNTIME-PROVEN` | воспроизведено контролируемым PoC |
| `FIELD-OBSERVED` | наблюдалось в реальной сети/на устройстве |
| `HYPOTHESIS` | вероятное объяснение без доказанной причинности |
| `UNKNOWN` | данных недостаточно |

Это особенно важно для:

- MTU и fragmentation;
- runtime reconnect;
- provider/network health;
- external service domain/IP coverage;
- WARPSCOUT colo/node observations.

UI не обязан показывать эти англоязычные метки буквально. Но внутренняя документация и research должны сохранять уровень уверенности.

## 7. Provenance и freshness внешних данных

Known services/domains нельзя проектировать как вечный словарь `service → domains` без происхождения.

Рекомендуемая модель записи:

```text
value
source
observed_at / updated_at
scope/environment
confidence/evidence
notes
```

Примеры источников:

- официальная документация сервиса;
- собственное field observation;
- OpenCCK или другой внешний каталог;
- maintained Gist/subscription;
- вручную добавленный пользовательский список.

Правила:

- сторонний каталог не становится source-of-truth только потому, что он большой;
- данные без даты/freshness не должны выглядеть как гарантированно актуальные;
- сравнение нескольких источников полезнее слепого merge;
- remote list fetch должен быть opt-in и иметь понятный privacy/network contract.

## 8. WARPSCOUT как пример freshness-модели

Полевые тесты WARPSCOUT показали общий принцип:

`endpoint IP:port` не имеет вечного свойства `FRA/ARN/DME`.

Нужно различать три факта:

1. endpoint reachable;
2. tunnel works;
3. current exit/node подходит конкретному сервису.

Поэтому будущая automation может проверять изменение node/colo во времени, но не должна превращать единичный scan в постоянное metadata endpoint'а.

Тот же принцип переносится на SNI, service IP ranges, provider health и CDN routing.

## 9. Diagnostics before mutation

Для всех анализаторов этого семейства действует общий safety rule:

- сначала показать факт/проблему;
- затем предложить действие;
- автоматическую правку делать только при доказанной семантике.

Примеры:

- Domain Coverage может показать gap, но не должен сам добавлять случайный список доменов;
- DNS↔Routing может показать mismatch, но не должен автоматически менять policy;
- MTU planner показывает расчётный потолок, пока live/runtime proof недостаточен для auto-MTU;
- provider health может показать недоступность, но не должен автоматически переписывать topology без отдельного пользовательского режима.

## 10. Границы v1.9

Рекомендуемый минимальный смысловой набор для v1.9:

1. **Domain Coverage Checker**;
2. **Routing Graph**;
3. **DNS ↔ Routing consistency**.

Это единая тема: **Configuration Intelligence / Explainability**.

Необязательно включать в тот же релиз:

- MRS viewer/parser/converter/builder;
- полный what-if simulator;
- remote provider live checks;
- большой known-services catalog;
- auto-MTU.

Эти блоки можно строить поверх той же архитектуры позже.

## 11. Definition of done для нового анализатора

Новый анализатор считается зрелым, когда:

- использует канонические данные engine/config, а не независимый regex-парсер там, где можно избежать;
- имеет явные границы того, что знает и чего не знает;
- не скрывает unsupported/unknown состояния;
- имеет regression fixtures;
- не меняет output в diagnostics-only режиме;
- документирует provenance внешних данных;
- не отправляет пользовательские конфиги/секреты наружу без отдельного opt-in контракта;
- может объяснить результат человеку, а не только вернуть внутренний код состояния.

---

Документ намеренно описывает архитектурное направление, а не обещание срока. Конкретный scope релиза определяется отдельным owner decision и release plan.
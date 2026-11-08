# Agent token efficiency — Link Generators

> **По необходимости, не стартовый контекст.** Обязательные инструкции — [AGENTS.md](../AGENTS.md) и [CONSTITUTION.md](../CONSTITUTION.md). Адаптация [KAS agent-token-efficiency](https://github.com/saymer-alt/keenetic-auto-setup/blob/main/docs/agent-token-efficiency.md), просмотрено по `main` 08.11.2026. Это **методика, а не установленный TokenEconomizer или hooks**. Доказанной процентной экономии LG нет: `NO_COMPARABLE_BASELINE`.

## 1. Loop Guard

После **двух безрезультатных одинаковых попыток** (тот же SHA, команда, ошибка, нет новых фактов) не делать третью: сменить гипотезу, получить новую диагностику или отметить `BLOCKED`. Исключения: изменившийся код/среда, обоснованный инфраструктурный retry, подтверждённый flake и ожидание CI. Не создавать пустые коммиты и не повторять весь CI без новых причин.

## 2. Evidence Reuse

Перед работой установить актуальные `main`/`stable` HEAD, Issue/PR, существующий код и состояние соседних агентов. Не чинить повторно уже исправленное в merged PR. Переиспользовать PASS только при совпадении SHA, кода, окружения и области тестирования (либо доказанной идентичности тестируемого дерева с явными границами). Локальный Node PASS, GitHub CI, браузер, синтетическая netns-лаборатория, `mihomo -t` и реальный FIELD не эквивалентны; не выполнено = `NOT TESTED`. Исторические отчёты и `docs/research/` не являются текущим состоянием.

Факты о среде записывать как `наблюдение | источник | дата | условия применимости`. Гипотезы не выдавать за доказанную причину.

## 3. Tool Calls

- Читать точные функции/блоки, callers, DOM ID и связанные тесты. Не загружать весь большой `index.html`, все docs/research, полные CI-логи и всю браузерную матрицу по умолчанию.
- При правке маршрутизации, NO-DIRECT, подписок, HWID, privacy, парсера, YAML, профилей, rollback или интеграции web4core изучать **полную затронутую цепочку данных и обязательные контракты**, даже если это дороже. Нельзя экономить на проверке безопасности.
- Перед дорогим CI проверить адресный `node --check` для изменяемого JS, `node tests/agent-context-contract.cjs` для инструкций, точечные `node tests/<case>.cjs`, применимые позитивные/негативные тесты и потребителей изменённого контракта. Затем обязательные CI/browser/profile/field gates — не ослаблять их ради экономии. См. [разработку и тесты](agent-guidance/04-development-tests-and-debt.md), [TESTING](TESTING.md), [профильные требования](DEPLOYMENT-PROFILES-TEST-CONTRACT.md).
- Перед повторной дорогой матрицей записать, что изменилось со времени прошлого прогона и почему прежний evidence неприменим. Финальный отчёт привязать к итоговому SHA.

## 4. Один активный цикл

Планировать не более **трёх направлений**, но выполнять **одну ограниченную задачу за раз** с понятным DoD, целевыми файлами и STOP.

| Режим | Результат | STOP |
| --- | --- | --- |
| **TRIAGE (read-only)** | Симптом, проверяемые факты, до 3 гипотез и дешёвые опровергающие проверки | Нет новой информации → BLOCKED |
| **PATCH** | Подтверждённая причина, минимальный diff, тест воспроизведения и отрицательная регрессия | Прошли адресные тесты → необходимые итоговые gates |
| **REVIEW / INTEGRATE** | Точные SHA, diff, достаточные CI/field evidence, GO/NO-GO | Изменился HEAD/не хватает owner GO/gate → STOP |

Узкие TRIAGE+PATCH можно выполнить в одном заходе. Не заводить автоматическую очередь несвязанных задач и не перерасследовать готовый PR ради «занятости». Работа — в отдельной ветке/Draft PR. `main` — разработка, `stable` — production. **Отдельный owner GO** нужен на merge, promotion в stable, Pages, tag/release, удаление/деплой и физический VPS/роутер. Ни PR, ни остаток квоты не дают эти права.

Сохранять `file://`, генерацию, no-silent-DIRECT, защищённые пользовательские данные; `web4core.runtime.js` генерируется из утверждённого форка и не редактируется вручную.

## 5. Сессионный бюджет ZCode / Codex / API (пилот)

| Тип реальной работы | Мягкий начальный ориентир | На границе |
| --- | ---: | --- |
| Малый баг + тест | 1–3 млн токенов | Зафиксировать минимальный результат и evidence |
| Ревью уже готового PR | 1–5 млн | Точный GO/NO-GO с SHA, не ещё один полный аудит |
| Средняя UI/Builder-правка | 5–10 млн | Отделить DoD от необязательных улучшений |
| Сложная интеграция | 10–30 млн | Сохранить рабочий slice, уточнить зависимости |
| Неясное browser/field расследование | по риску и доказательствам | STOP при отсутствии новых данных |

Это **плановые ориентиры из KAS, не измеренные для LG**, не жёсткие лимиты качества и не разрешение прерывать критическую операцию. Точные input/output/cache отсутствуют? Писать `NOT_AVAILABLE`. Округлённые проценты бонусной квоты — только `COARSE`, не точная цена PR. Параллельные агенты/сессии: `CONTAMINATED`. API-рубли и бонусные единицы не взаимозаменяемы. [Протокол измерений](agent-token-measurement-protocol.md) запускать только на реальных задачах; новых дефектов для эксперимента не создавать.

**Если полезная работа закончилась до истечения бонусной квоты — STOP.** Нет задачи «потратить всё».

## 6. Краткий handoff и /compact

Сохранять в Issue/PR **ссылки на проверки, не гигантские журналы**. Никогда не сохранять настоящие private keys, subscription URLs/bodies, HWID/identity, credentials и пользовательские конфиги.

```text
Issue/PR | mode=TRIAGE/PATCH/REVIEW | base SHA → final SHA
IMPLEMENTED: ... | CI: PASS/FAIL/NOT TESTED + run URL | FIELD: PASS/NOT TESTED
Blocker: ... | Next exact action: ... | Next owner GO: ...
input/output/cache: NOT_AVAILABLE | calls: ... | futile repeats: ... | quota: COARSE/CONTAMINATED/UNKNOWN
```

Разделять `IMPLEMENTED`, `CI PASS`, `FIELD PASS`, `MERGED`, `PUBLISHED`. После фиксации результатов в GitHub оператор **сам** может вызвать `/compact` в ZCode; текст «сделай /compact» не запускает slash-команду. Для новой сессии достаточно issue/PR, SHA, доказанного состояния и следующего действия.

## 7. Минимальная карточка задачи

```text
Repo / Issue / branch / baseline SHA:
Human-visible goal / Definition of Done:
Protected behavior and non-goals:
Affected files, callers and tests:
Permitted actions now / separate owner GO needed:
Positive, negative and regression checks:
STOP condition / handoff links and final SHA:
```

Пропорционально расширять требования для cross-repo, security, routing, runtime, production и release. [Constitution](../CONSTITUTION.md) и профильные safety-контракты выше любых соображений экономии.

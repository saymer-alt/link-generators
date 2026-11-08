# Link Generators — протокол замера расхода токенов

> **Только по необходимости, не стартовая инструкция.** Адаптация [KAS measurement protocol](https://github.com/saymer-alt/keenetic-auto-setup/blob/main/docs/agent-token-measurement-protocol.md), 08.11.2026. Рабочие правила — [agent-token-efficiency.md](agent-token-efficiency.md). Пока нет сопоставимой исходной серии: `NO_COMPARABLE_BASELINE`.

## До начала настоящей задачи

1. Записать ссылку на Issue/PR, цель и DoD, модель/режим агента, категорию сложности, дату/часовой пояс, branch/HEAD SHA. Не придумывать баг ради теста.
2. Сохранить доступные показания input/output/cache tokens с **единицами и источником**. Нет данных → `NOT_AVAILABLE`; округлённая бонусная квота → `COARSE`, не подменять точным расходом.
3. Проверить параллельную работу других агентов/сессий на той же квоте. Если есть либо неизвестно — `CONTAMINATED`, не приписывать весь расход одному PR.

## После задачи

4. Записать показания того же счётчика, tool calls, бесполезные retries, CI reruns, время и ручные `/compact`. Недоступное оставлять `NOT_AVAILABLE`.
5. Записать качество: final SHA, DoD выполнен или нет, позитивные/негативные gates, URL run и scope, замечания ревью, `IMPLEMENTED`/`CI PASS`/`FIELD PASS`/`MERGED`/`PUBLISHED`/`NOT TESTED`.
6. Прикрепить короткую обезличенную карточку к Issue/PR. Не раскрывать API keys, WARP/WG private keys, URL/тела подписок, HWID/identity, реальные конфигурации и персональные детали сети.

```text
Issue/PR | task category | model/mode | date/timezone:
Base SHA → final SHA | DoD | outcome:
Tokens input/output/cache before/after = NOT_AVAILABLE
Quota before/after (units, source, precision) = NOT_AVAILABLE
Other quota consumers = NONE / YES / UNKNOWN
Tool calls / futile retries / CI reruns / manual /compact = NOT_AVAILABLE
Gates + CI run URLs | review fixes | blockers:
Measurement reliability = EXACT / COARSE / CONTAMINATED / NOT_AVAILABLE
```

## Интерпретация

3–5 сопоставимых новых задач на близких моделях и одинаковых гейтах — **наблюдательная серия после внедрения**, не A/B и не доказательство «экономия N%». Настоящее A/B требует отдельной тестовой копии, одинаковых условий и явного согласования; production-мутации и пропуск safety checks запрещены. Без измерения «до» — `NO_COMPARABLE_BASELINE`. Оценивать проверенный рабочий результат и регрессии вместе с затратами. Итог `GO`/`INCONCLUSIVE`/`NO-GO` только по фактам.

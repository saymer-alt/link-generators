# Как участвовать / Contributing

Спасибо за интерес к проекту **link-generators**. Исправления документации, отчёты с воспроизводимыми ошибками и небольшие целевые PR приветствуются.

## С чего начать

1. Прочитайте [README](README.md) и существующие инструкции.
2. Перед новой задачей проверьте открытые Issues и Pull Requests, чтобы не дублировать работу.
3. Для ошибки создайте Issue через форму «Ошибка»; для идеи — «Предложение».
4. Для изменения кода создайте отдельную ветку от актуальной `main` и PR с небольшим, обозримым diff.

## Правила для этого проекта

- Check `AGENTS.md`, `CONSTITUTION.md`, `docs/DATAFLOW.md` and tests before changing generation logic.
- Prefer reproducible synthetic configurations and non-secret proxy examples; **never** post real subscription URLs, private keys, controller secrets or credentials.
- Describe affected deployment profile (router/VPS), browser, selected mode and expected output.
- Changes to privacy, subscription processing or networking require an explicit data-flow review; do not silently add outbound requests.

## Проверка PR

- Объясните **что** изменено, **почему** и как это проверено.
- Запустите подходящие проверки из README, `tests/` или GitHub Actions; если проверить на устройстве невозможно, прямо укажите это.
- Не утверждайте, что физическое устройство или VPS протестировано, если такой проверки не было.
- Не меняйте release-теги, `stable` или исполняемую инфраструктуру в документационном PR.
- Уважайте действующую лицензию и атрибуцию сторонних компонентов.

## Безопасность и приватные данные

**Не сообщайте о нераскрытых уязвимостях публично через Issues.** Для конфиденциальных отчётов необходим отдельный согласованный приватный канал; не прикладывайте секреты к публичным PR, логам или формам. Конфигурации и логи перед публикацией обезличивайте. Публичные Issues подходят для несекретных ошибок и предложений.

Работы, требующие доступа к чужим сетям или серверу, не являются обязательным условием участия.

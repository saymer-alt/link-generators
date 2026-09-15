# Автоматический режим белых списков

Opt-in checkbox `Автоматический режим белых списков` во вкладке Mihomo. Верхний ввод
и загруженные WG/AWG-файлы образуют основной набор; отдельное поле — резерв БС.
Оба набора обязательны. Каждый допускает несколько ссылок, подписок или их смесь.
При включённом Sub Mode URL без userinfo становится HTTP provider; сами подписки
загружает Mihomo. Ссылки без подписок разрешены. При выключенном Sub Mode наличие
подписки даёт ошибку; URL с userinfo сохраняет значение HTTP(S) proxy.

## Архитектура

- `link-generators/index.html`: checkbox, второй ввод, снимок состояний только в
  памяти, скрытие и отключение опций «TUN на каждый прокси» / «SOCKS-порт на каждый
  прокси» и всей карточки VPS Gateway.
  При сборке независимо от DOM принудительно `mihomoPerProxyTun: false`,
  `perProxyPort: false`, локальный `deploymentProfile: 'generic'`.
- `web4core/src/build.js`: универсальное необязательное поле `fallbackInput`.
  Его отсутствие сохраняет прежний путь без новой нормализации/сериализации.
  Его наличие включает раздельный parsing/validation двух сторон; `wgBeans` — primary.
  Engine отклоняет сочетание primary/fallback с Per-Proxy listeners.
- `web4core/src/core/mihomo.js`: `buildMihomoPriorityConfig` переиспользует готовые
  builders прокси и providers, создаёт один плоский GLOBAL fallback. Parser и YAML
  emitter не дублируются. Терминов БС/whitelist в engine нет.
- Runtime собирается из fork; экспорт `buildMihomoPriorityConfig` служит также
  проверкой совместимости в UI. Старый runtime вызывает ошибку, а не потерю резерва.

Две независимые обычные сборки в UI потребовали бы разбирать готовый YAML,
согласовывать имена/providers и воспроизводить разделение input. Поэтому общая
композиция групп живёт рядом с существующими engine builders; пользовательская
политика белых списков остаётся в consumer.

Имена статических прокси получают `PRIMARY-<N>: ` / `FALLBACK-<N>: `.
Имена providers получают `primary-` / `fallback-`; `override.additional-prefix`
разделяет имена узлов подписок. Совпадения имён и одинаковые ссылки между наборами
не объединяют стороны. Дедупликация внутри обычного набора использует прежний builder.

## Точная структура групп

Для обычной ссылки `A`, резервной `B` и подписки с каждой стороны (Google health-check):

```yaml
proxy-groups:
  - name: GLOBAL
    type: fallback
    proxies:
      - "PRIMARY-1: A"
      - "FALLBACK-1: B"
    use:
      - primary-example.invalid
      - fallback-example.invalid
    filter: "^(PRIMARY-|primary-)`^(FALLBACK-|fallback-)"
    url: "https://google.com/generate_204"
    interval: 300
    expected-status: 204
    lazy: false
    empty-fallback: REJECT
rules:
  - "MATCH,GLOBAL"
```

`filter` содержит две regex, разделённые обратной кавычкой. Mihomo 1.19.31
сортирует объединённый список конечных узлов по этим фильтрам: **все primary,
затем все fallback**, включая статические узлы и узлы любых providers.
Без этого поля `proxies` предшествуют `use`, и статический БС-узел мог бы обойти
живой primary provider. Префиксы — часть контракта, их нельзя менять отдельно от фильтра.
Внутри каждого набора выбирается первый живой узел; выбор минимальной задержки
не выполняется. Вложенных групп нет. При чистых подписках `proxies` отсутствует,
без подписок отсутствует `use`. URL и expected-status следуют Ping server.
`DIRECT` отсутствует среди целей GLOBAL.
Поле `proxy: DIRECT` у HTTP provider сохранено: оно относится только к скачиванию
подписки, не является fallback пользовательского трафика.

## Поведение и ограничения

- GLOBAL выбирает первый живой конечный выход в порядке primary → fallback.
  После восстановления primary возвращается к нему по результатам проверок.
  Надёжность и строгий приоритет обеспечиваются без выбора самого быстрого узла.
- Это проверка доступности заданного HTTP endpoint, а не детектор белых списков.
  Успешная проба не гарантирует доступность каждого сайта или UDP.
- `lazy: false` поддерживает проверки обоих наборов, включая неиспользуемый резерв.
  Интервал — 300 секунд; переключение зависит от свежести проб и timeout,
  это не мгновенный SLA. Отдельного внешнего watchdog нет.
- Пустой provider использует REJECT вместо неявного DIRECT. Если оба набора
  недоступны, Mihomo может продолжать попытки через первый; выхода DIRECT нет.
- Существующие соединения не мигрируют автоматически. Ручной выбор GLOBAL через
  controller может влиять на стандартное поведение fallback Mihomo.
- Обычный TUN и gVisor/MIPS, Mixed Port, Web UI, Allow LAN и Sub Mode остаются.
  Ordinary TUN сохраняет прежний `device: mitun0`, `auto-route: false`.
  MIPS требует Mihomo >= 1.19.31.
- Выключение checkbox восстанавливает опции «на каждый прокси» и профиль VPS из
  снимка в памяти; обновление
  страницы снимок не сохраняет. Содержимое второго поля при выключенном режиме
  игнорируется. Генерация выключенного режима не меняет байты; случайный `x-hwid`
  сравнивается с фиксированным RNG исключительно в тестах.
- Новые протоколы не добавлены. Загрузка подписок из браузера не добавлена.

## Проверки

Команды и результат — [TESTING.md](TESTING.md). Помимо `mihomo -t`, локальные
сетевые тесты подтверждают PRIMARY → FALLBACK → PRIMARY для static/providers/mixed.
Проверки проходят на mock HTTP CONNECT endpoints, без реальных подписок и TUN;
они не доказывают handshake каждого поддерживаемого протокола или доступность сайтов.

## #2588 и providers

В v1.19.31 issue [#2588](https://github.com/MetaCubeX/mihomo/issues/2588)
фактически воспроизводится. `Fallback.findAliveProxy` проверяет `AliveForTestUrl`
вложенной группы, не детей. Локальный repro показывает `PRIMARY.alive=false`,
`child.alive=true`, `GLOBAL.now=FALLBACK` и реальный HTTP-трафик через резерв.
Поэтому схема fallback → url-test заменена плоской; `lazy: false` сама по себе
не исправляет это расхождение состояний. Подробный анализ — [FALLBACK-REVIEW.md](FALLBACK-REVIEW.md).

Каждый HTTP provider независимо генерирует полный блок:

```yaml
health-check:
  enable: true
  url: "https://google.com/generate_204"
  interval: 300
  lazy: false
  expected-status: 204
```

Это не полагается на group-level `url`. В 1.19.31 есть регистрация дополнительных
URL групп у providers, но основной provider URL остаётся отдельным механизмом.
`HealthCheck.process` при `lazy: false` запускает проверки по таймеру независимо
от последнего использования. Локальный тест проверяет новые попытки к мёртвому
primary, пока запросы обслуживает БС, и автоматический возврат после восстановления.

Семантика сверена с [fallback](https://wiki.metacubex.one/en/config/proxy-groups/fallback/),
[providers](https://wiki.metacubex.one/en/config/proxy-providers/) и исходниками
[Mihomo v1.19.31](https://github.com/MetaCubeX/mihomo/tree/v1.19.31/adapter/outboundgroup).

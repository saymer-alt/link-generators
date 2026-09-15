# Review #2588: плоский автоматический fallback

## Verdict для Mihomo v1.19.31

Проблема **не исправлена фактически**. Проверен tag v1.19.31,
source SHA `ab405bad5beeeac8b003bb01f60f134f6df54471`, официальный Windows amd64
binary SHA256 `9f2ad8968022eae9b972c01a87de1a4dc19c949834db899d732bc0129b103478`.
Issue [#2588](https://github.com/MetaCubeX/mihomo/issues/2588) открыт, но verdict
основан на исходниках и воспроизведении, а не статусе issue.

- [fallback.go, findAliveProxy](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/adapter/outboundgroup/fallback.go#L105):
  цикл проверяет `proxy.AliveForTestUrl(f.testUrl)` непосредственно у каждого
  элемента. Рекурсивной проверки дочерних proxy-groups нет.
- [adapter.go, AliveForTestUrl](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/adapter/adapter.go#L47):
  читается сохранённое состояние проверки wrapper; оно независимо от детей.
- В локальном repro сначала PRIMARY реально проваливает HTTP-пробу; затем один
  ребёнок восстанавливается и проходит пробу, wrapper остаётся unhealthy.
  Получено: `PRIMARY.alive=false`, `PRIMARY.now=PRIMARY-2: P-ALIVE`,
  `child.alive=true`, `GLOBAL.now=FALLBACK`. HTTP-запрос через mixed-port реально
  возвращает идентификатор резервного mock endpoint. Interval 3600 фиксирует
  окно до следующей wrapper-пробы; API delay лишь воспроизводит порядок проб,
  не записывает alive вручную.

## Принятое изменение

Удалены промежуточные PRIMARY/FALLBACK группы. GLOBAL видит конечные узлы напрямую.
Фильтр `^(PRIMARY-|primary-)` и затем `^(FALLBACK-|fallback-)`, разделённые обратной
кавычкой, задаёт строгий порядок всего объединённого списка. Пример YAML находится
в [AUTO-WHITELIST.md](AUTO-WHITELIST.md).

Почему недостаточно просто перечислить `proxies` и `use` по сторонам:

- [parser.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/adapter/outboundgroup/parser.go#L161)
  превращает статические proxies в CompatibleProvider и добавляет его перед `use`.
  Без сортировки живой статический fallback обойдёт живой primary provider.
- [groupbase.go, GetProxies](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/adapter/outboundgroup/groupbase.go#L122)
  разворачивает providers; несколько backtick-фильтров сортируют общий список
  всех providers, включая статический CompatibleProvider.
- При одном источнике статических узлов исходный список уже primary → fallback;
  при нескольких источниках применяется глобальная сортировка. Обновление provider
  меняет Version, инвалидируя кеш списка, после чего фильтры применяются вновь.

В пределах стороны выбирается **первый живой**, а не самый быстрый. Это явный
компромисс плоского native fallback. Обычный url-test минимизирует задержку,
но не обеспечивает абсолютный приоритет primary; возврат к nested-группам
вернул бы #2588. Внешний watchdog или изменение самого Mihomo не добавлены.
Ручной выбор через controller может отменять автоматический порядок; тесты
не используют операции выбора. Состояние доступности всё равно зависит от
свежести health-check, а не от мгновенного знания сетевой доступности.

## Providers

Каждый provider генерирует собственные `health-check.enable: true`, URL,
interval 300, `lazy: false`, expected-status из того же resolver, что GLOBAL.
Контракт проверяется source/browser/network tests.

[HealthCheck.process](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/adapter/provider/healthcheck.go#L48)
проверяет `!hc.lazy || since < hc.interval`: при false проверки продолжаются без
трафика через provider. `registerHealthCheckTask` может добавлять URL группы,
но совпадающий с provider URL пропускается. Мы не полагаемся на этот механизм:
полный provider health-check задан явно и сохранён при переходе к плоской схеме.

## Runtime proof

`tests/mihomo-failover.cjs` запускает настоящий Mihomo и локальные HTTP CONNECT
прокси/HTTP providers. Все слушатели — loopback; внешняя сеть и TUN не используются.
Из generated YAML для теста меняются только адрес probe, interval (1s), timeout,
локальные порты/controller/logging. Группы, filter, имена, prefixes, expected-status,
lazy и membership остаются сгенерированными.

| Ввод | PRIMARY dead+alive | Все PRIMARY dead | PRIMARY восстановлен |
|---|---|---|---|
| Static | P-ALIVE | F-ALIVE | P-ALIVE |
| HTTP providers | P-ALIVE | F-ALIVE | P-ALIVE |
| Mixed static + HTTP providers | P-ALIVE из provider | F-ALIVE static | P-ALIVE из provider |

Каждая ячейка проверяется реальным запросом через mixed-port и effective `GLOBAL.all/now`.
Пока трафик идёт по fallback, тест наблюдает дополнительные попытки к мёртвому
primary, затем восстанавливает его. Переключение выполняет Mihomo без записей
выбора и без вызовов forced health-check в положительных сценариях.

Переменные: `MIHOMO_BIN` — абсолютный путь к официальному Mihomo;
`JS_YAML_PATH` — абсолютный путь к js-yaml 4.1.0;
`TEST_OUTPUT_DIR` — отдельная scratch-директория для config/log/evidence.json.

```bash
node tests/mihomo-failover.cjs
node tests/mihomo-failover.cjs --nested-repro
```

Для команд использовать разные TEST_OUTPUT_DIR. Последняя реконструирует старую
архитектуру и ожидает воспроизведение бага, а не исправляет ядро. Тест охватывает
HTTP/TCP routing semantics; не обещает handshake всех протоколов, UDP или SLA 300s.

UI, внутренние guards Per-Proxy/VPS и `fallbackInput` не изменены. Выключенный
режим повторно проверен 256 byte-for-byte browser baseline cases и runtime suite.
Commit/push не выполнялись.

# warp-dialer-fieldtest — полевой harness для dialer-proxy / provider-backed WARP-DIALER

Воспроизводимый исследовательский инструмент для живого Mihomo v1.19.x: измеряет
`WARP direct`, `WARP → dialer-proxy → provider node`, `WARP-over-WARP`, MTU-лестницу,
стабильность переключения и UDP/WARP capability узлов.

Принцип: **это не часть генератора и не автоматический сканер пользовательских подписок** —
каждое изменение состояния Mihomo проходит через явные режимы и флаги; отчёты обезличены.

Состав: `fieldtest.mjs` (CLI), `lib.mjs` (чистая логика), `fieldtest.test.mjs` (offline-тесты),
`check-secrets.mjs` (сканер секретов), `example-config.yaml` (пример без реальных секретов).

## Полевая находка 1: Geodema/Remnawave требует HWID (иначе «App not supported»)

Подписка Geodema — панель Remnawave. Запрос subscription URL даже с «правильным»
User-Agent, но **без заголовков устройства**, возвращает намеренную заглушку:
`x-hwid-not-supported: true` + единственный узел `App not supported` (vless 0.0.0.0:1).
Это НЕ означает, что у аккаунта нет серверов.

С корректными заголовками тот же endpoint отдаёт полную подписку
(в поле: 195 узлов Clash YAML / 97 sing-box outbound):

```yaml
proxy-providers:
  account.geodema.org:
    type: http
    header:
      x-hwid:
        - <DEVICE_HWID>          # 10-64 символов [A-Za-z0-9=-]
      x-device-os:
        - Linux
      x-device-model:
        - <device-model>
```

Диагностика: явные эндпоинты `<subscription>/mihomo`, `/clash`, `/singbox`, `/json`;
ответные заголовки `x-hwid-active` / `x-hwid-not-supported` /
`x-hwid-max-devices-reached` / `x-hwid-limit`, плюс `subscription-userinfo` и
`profile-title` (квота/срок/имя профиля).

## Полевая находка 2: переключение группы ≠ свежий transport path (обязательно к прочтению)

Переключение select-group меняет выбранный dialer node, но уже установленный
WireGuard handshake может продолжать использовать **старый transport path**:
в поле (SE VPS, Mihomo v1.19.31) старый путь сохранялся **более 150 секунд** после
подтверждённого API переключения. Поэтому связка `PUT group → now changed → sleep 8s → trace`
**не доказывает**, что trace прошёл через новый provider node — обычный sweep способен
приписать предыдущий FRA/AMS path следующему узлу. Увеличивать обычный `--settle-ms`
для этого бесполезно (фиксированный sleep недостаточен).

Harness различает три разных факта (поля отчёта):

- `selection_changed` — Mihomo API подтвердил новое `now` (переключение принято);
- `transport_fresh` — outbound реально пересоздан (перезагрузка изолированного конфига)
  и выбранный узел подтверждён повторно после reload;
- `path_freshness` — `fresh` (доказан fresh handshake) или `unverified`
  (результат потенциально stale).

### `--fresh-handshake` — режим строгого per-node сравнения

```bash
node fieldtest.mjs sweep --group DIAL-FRA --pin "TEST-OUT=WARP-DIALED-FRA" --fresh-handshake --main-conf /etc/mihomo/config.yaml
```

После выбора provider node: подтверждение `now` → безопасный reload того же тестового
конфига (`PUT /configs?force=true {"payload": …}`) → ожидание API → повторное
подтверждение выбранного узла → только затем trace. Reload пересоздаёт все outbound
(fresh WG handshake) — допустимо для изолированного userspace-стенда; process/systemd
не рестартуются. Без `--main-conf` режим завершится ошибкой конфигурации.
Без `--fresh-handshake` все строки получают `path_freshness: unverified` + предупреждение
в CLI: такой sweep — research-данные, а не доказательство `node → colo`.

### Field-test evidence (SE VPS, Mihomo v1.19.31, 2026-10-01)

```text
SE direct WARP       → ARN
SE → Geodema DE → WARP → FRA
SE → Geodema NL → WARP → AMS
```

DE-транспорт проверен на 3 узлах (vless-TCP и hysteria2); MTU-лестница 1280→1200 —
все ступени `WARP_OK` (transfer 6.9–7.6 MB/s). Это **field-test evidence**, а не
гарантия Cloudflare routing: colo выбирается Cloudflare и может меняться.
A→B→A с fresh reload (DE → FRA, NL → AMS, DE → FRA) воспроизведён этим harness.
## Методика (рекомендуемый порядок)

```text
1. baseline        WARP-A / WARP-B direct (GROUP=TEST-OUT, узлы — сами профили)
2. dry-run         mode list: группа, узлы, PIN, план; БЕЗ изменений состояния
3. limited sweep   sweep c NODES_LIMIT=8 (дефолт) — пробная выборка
4. full sweep      sweep c --full — все узлы группы
5. switchtest      A → B → A (SWITCH_NODES) — доказательство смены path
6. MTU sweep       лестница 1280→1200, поиск МАКСИМАЛЬНОГО стабильного MTU
7. WARP-over-WARP  профиль с dialer-proxy на второй WARP — как обычный узел sweep
```

## Примеры запуска

Windows (портативный node, системный curl):

```bat
set MIHOMO_API=http://127.0.0.1:9095
set SOCKS=socks5h://127.0.0.1:7896
node tools\warp-dialer-fieldtest\fieldtest.mjs list
node tools\warp-dialer-fieldtest\fieldtest.mjs sweep --pin "TEST-OUT=WARP-DIALED" --transfer
node tools\warp-dialer-fieldtest\fieldtest.mjs switchtest --switch-nodes "WARP-A,WARP-B,WARP-A"
node tools\warp-dialer-fieldtest\fieldtest.mjs mtusweep --main-conf C:\mihomo\config.yaml --profile WARP-A --mtus "1280,1260,1240,1220,1200"
```

Linux/VPS:

```bash
MIHOMO_API=http://127.0.0.1:9090 node tools/warp-dialer-fieldtest/fieldtest.mjs list
PIN="TEST-OUT=WARP-DIALED" GROUP=WARP-DIALER node tools/warp-dialer-fieldtest/fieldtest.mjs sweep --transfer
MAIN_CONF=/etc/mihomo/config.yaml PROFILE=WARP-A MTUS=1280,1260,1240,1220,1200 \
  node tools/warp-dialer-fieldtest/fieldtest.mjs mtusweep
```

## Как доказать, что тестируется именно WARP поверх dialer, а не provider node напрямую

Механика: egress трафика определяется тем, что выбрано в группе, стоящей в `rules`/`TEST-OUT`,
а НЕ группой-транспортом. Sweep группы `WARP-DIALER` переключает её узлы, но трафик идёт
так, как выбрано в egress-селекторе. Отсюда ловушка, найденная в первом же полевом прогоне:

- **Без PIN**: `TEST-OUT` остаётся на `WARP-DIALER` (или на чём угодно ещё) → trace проходит,
  но `warp=off`, а `colo`/`ip` принадлежат **самому provider-узлу**. Отчёт выглядит успешно
  и измеряет не то.
- **С `--pin "TEST-OUT=WARP-DIALED"`**: egress зафиксирован на WARP-профиле с
  `dialer-proxy: WARP-DIALER`; теперь переключение узлов `WARP-DIALER` меняет только
  транспорт WG-хендшейка, и успешный результат (`warp=on`) доказывает ровно
  «WARP поверх dialer-транспорта».

Доказательство корректности измерения — трёхточечная сверка:

1. непиннованный прогон узла: trace OK, `warp=off`, colo узла (TCP-путь жив);
2. пиннованный прогон того же узла: `warp=on` → узел ретранслирует UDP, WARP поднялся
   через него (colo — ближайший к узлу WARP-регион), либо таймаут → UDP-relay нет;
3. контрольный WARP direct: `warp=on`, colo исходной сети.

`node-direct test` (без PIN) и `PIN=WARP-DIALED` (узел — только транспорт) — **разные
эксперименты**; harness требует явно указывать PIN для транспортных sweep и печатает
`pin` в каждой строке отчёта.

## Классификация (измеримые признаки, не тексты ошибок)

| result | признак |
|---|---|
| `WARP_OK` | все трейсы OK и `warp=on` |
| `UNSTABLE` | часть трейсов `warp=on`, часть нет/ошибка |
| `TIMEOUT` | есть failure с curl exit 28 |
| `UDP_OR_DIAL_FAIL` | есть failure с curl exit 7 / 35 / 56 или иной failure |
| `UNKNOWN` | все трейсы прошли, но `warp` ни разу не `on` (трафик доказанно не WARP) |

Дополнительно `error_class`: `none / intermittent / timeout / dial / tls_in_tunnel /
udp_or_dial / unknown`. Коды curl: 28=таймаут, 7=не удалось подключиться, 35/56=TLS.

## Ограничения (не скрываются, а задокументированы)

- `GET /proxies/{provider-node}` возвращает 404: **тип и `udp`-флаг provider-узлов ядро
  через API не отдаёт** — колонка TYPE для них пуста.
- HTTP/3-проба зависит от сборки локального curl (`--http3`); без неё пишется
  `unsupported-curl`.
- `udp: true` в конфиге узла/группы — только намерение; **не гарантирует** рабочий
  nested WireGuard: подтверждается только реальным хендшейком (этот harness).
- Cloudflare `colo` **не гарантирован географией** proxy-узла — это наблюдение,
  а не SLA; для происхождения страницы доверять полю `commit`/`warp` трейса.
- Бесплатные публичные подписки — **не бенчмарк качества provider**: в обкатке 26/26
  узлов не ретранслировали UDP.

## Отчёты и схема

`fieldtest-<timestamp>.json` — источник истины: `schema`, `timestamp`, `mode`, `group`,
`pin`, redacted `args`, `rows[]`. Каждая строка `rows`:

```text
timestamp, mode, node, pin, result, curl_exit, elapsed_ms,
ip, loc, colo, warp, mtu, transfer_bps, http3,
error_class, error_redacted, notes, passes_redacted[]
```

`fieldtest-<timestamp>.csv` — **производное представление** тех же `rows`
(один генератор `resultsToCsv`, поля в порядке схемы, RFC-квотирование).
Ошибки и free text проходят `redactText()`: query-строки URL, `key=/token=/password=`
пары и standalone base64-блобы длины WARP-ключей вырезаются; `--secret` никогда
не печатается и в JSON попадает только как `[set]`.

## Exit codes

| код | значение |
|---|---|
| 0 | успех (все протестированные узлы WARP_OK / режим list) |
| 1 | частичные отказы среди узлов |
| 2 | ошибка конфигурации/API (аргументы, группа не найдена, switch не подтвердился) |
| 3 | Mihomo недоступен (pre-flight `/version`) |
| 4 | прервано или не удалось восстановить конфиг после MTU sweep |

MTU sweep всегда восстанавливает исходный конфиг: `try/finally` + обработчик SIGINT;
бэкап `.fieldtest.bak` рядом с конфигом.

## Безопасность

- Никаких телеметрии, хранения ключей, записи конфигов вне явно указанного `--main-conf`.
- `check-secrets.mjs` сканирует каталог перед коммитом (запускается и в CI).
- Офлайн-тесты harness: `node --test fieldtest.test.mjs` (22 теста: аргументы,
  redaction, классификация, трейс-парсер, CSV, null-device, MTU-редактирование,
  план, нормализация ответов API) — сеть и Mihomo не нужны.

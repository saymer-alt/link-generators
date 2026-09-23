# VPS-GATEWAY — опциональный профиль генерации для amnezia-mihomo-gateway

С ревизии v1.19.31 `applyDeploymentProfile(yaml, profile, tunStack)` сохраняет явный
выбор MIPS из Builder. С 2026-09-17 (NIGHT-09) продукт по умолчанию шлёт `mips`
и для vps-профиля; если gateway-тюнинг (см. `rp_filter` ниже) рассчитан на gvisor —
явно выберите gVisor в генераторе. Разрешены `mips`/`gvisor`. Это TUN stack,
не CPU MIPS, требуется Mihomo >= 1.19.31.
Работает также при VPS + «TUN на каждый прокси» (Per-Proxy TUN): основной TUN и listeners получают выбранный
стек. Остальные перечисленные ниже gateway-инварианты не менялись.

Внутренняя документация. Описывает opt-in профиль «VPS Gateway» (добавлен 2026-09-09).
Реализация — `applyDeploymentProfile()` в `index.html`; тесты — раздел «Профиль VPS
Gateway» в [TESTING.md](TESTING.md). Источник истины — код; общие правила —
[AGENTS.md](../AGENTS.md).

## Зачем существует этот режим

Редкий сценарий: **Mihomo на VPS как часть transparent gateway** из проекта
[`amnezia-mihomo-gateway`](https://github.com/saymer-alt/amnezia-mihomo-gateway) —
трафик Docker-контейнера AmneziaAWG через Linux policy routing заводится в TUN-интерфейс
`tun-mihomo` и выходит через proxy/WARP. Для этого Mihomo нужен конфиг с «gateway-видом»
TUN и fake-ip DNS; обычный вывод генератора (TUN `mitun0` без `inet4-address`, без секции
`dns:`) этот сценарий не покрывает.

Профиль готовит **только Mihomo-половину** такой конфигурации. Генератор **не является
VPS-инсталлятором** и никогда им не станет.

## Generic-режим от него не зависит

Основной сценарий проекта (Keenetic и обычные конфиги) — превалирующий и защищён
инвариантом:

- селектор «Профиль развёртывания» (`#cfgProfile`) по умолчанию = **Универсальный**;
- при `generic` функция `applyDeploymentProfile()` **не вызывается вовсе** (в `buildMihomo()`
  стоит guard `if (deploymentProfile === 'vps')`) — нет ни одного лишнего
  `jsyaml.load/dump`, вывод **байт-в-байт** совпадает с прежним;
- при переключении на VPS и обратно состояние `cfgTun` восстанавливается, панель VPS
  скрывается, «мусора» в YAML не остаётся.

## Архитектура и граница ответственности

```text
link-generators
      ↓  (генерирует только Mihomo configuration)
Mihomo configuration (config.yaml)
      ↓  (развёртывание и маршрутизация)
amnezia-mihomo-gateway (install.sh)
      ↓
Docker / AmneziaWG / Linux policy routing / iptables
```

| Генератор (эта страница) | amnezia-mihomo-gateway (НЕ генератор) |
|---|---|
| секция `tun:` gateway-вида | контейнер `amnezia-awg`, подсеть, UDP-порт WG |
| корневой `find-process-mode`, `profile.store-*` | `ip rule` / таблица `100 mihomo` / fwmark 0x88 |
| секция `dns:` (fake-ip, по sub-toggle) | iptables (MARK, TCPMSS, MASQUERADE, FORWARD) |
| proxies / proxy-groups (обычный ввод) | sysctl (`rp_filter=0`), resolv.conf, Docker DNS |
| — | systemd-юниты, watchdog, firewall |

## Параметры профиля

**Наследуется из Builder:**

| Параметр | Значение | Зачем нужен |
|---|---|---|
| `tun.stack` | выбранный TUN stack; UI-default v1.4.0+ = `mips` | профиль сохраняет общий выбор Builder; для совместимости можно явно выбрать `gvisor` |

**Fixed (не редактируются, задаются кодом):**

| Параметр | Значение | Зачем нужен |
|---|---|---|
| `tun.enable` | `true` | TUN — вход перехваченного трафика |
| `tun.auto-route` | `false` **(инвариант)** | иначе Mihomo перехватит весь трафик сервера и убьёт SSH; в UI не выставляется |
| `tun.auto-detect-interface` | `true` | «критично для upload» (install.sh); корректный egress-интерфейс |
| `tun.gso` | `true` | эмпирическая оптимизация v2.0 (замеры install.sh) |
| `find-process-mode` (корень) | `off` | не тратить время на process-matching форвардед-трафика |
| `profile.store-selected` / `store-fake-ip` | `false` / `false` | детерминизм при пересоздании правил; merge — прочие ключи `profile` сохраняются |

**Editable (редактируемые поля с боевыми дефолтами):**

| Поле UI | Параметр | Дефолт | Зачем нужен |
|---|---|---|---|
| `#vpsDevice` | `tun.device` | `tun-mihomo` | имя, которое ищут routing-скрипт и watchdog |
| `#vpsInet4` | `tun.inet4-address` | `10.255.255.1/30` | без IPv4 на интерфейсе MASQUERADE не работает |
| `#vpsMtu` | `tun.mtu` | `1420` | двойная инкапсуляция AWG+WARP; вместе с TCPMSS clamp на Linux-стороне давал ~2x |
| `#vpsFakeIp` | `dns.fake-ip-range` | `198.18.0.0/16` | диапазон fake-ip; должен совпадать с main-маршрутом в routing-скрипте |
| `#vpsDnsEnabled` | секция `dns:` целиком | включён | DNS-перехват (fake-ip); выключение удаляет `dns` без остатков |
| `#vpsDnsListen` | `dns.listen` | `0.0.0.0:53` | адрес DNS-слушателя Mihomo (см. ниже) |
| `#vpsDnsNs` | `dns.nameserver` | `1.1.1.1, 8.8.8.8` | upstream-резолверы |
| `#vpsProxyNs` | `dns.proxy-server-nameserver` | `1.1.1.1` | резолвер имён самих proxy-серверов |

Пустое поле → значение по умолчанию. Источник всех дефолтов — **текущий
`install.sh` amnezia-mihomo-gateway** (переменные `PROXY_IF` / `TUN_INET_ADDR` /
`FAKE_IP_RANGE`, пакет v2.0); якорь-комментарий — `VPS_GATEWAY_DEFAULTS` в `index.html`.

## Четыре точки сцепки с gateway (контракт)

| Точка | Дефолт | Что сломается при рассинхроне |
|---|---|---|
| `tun.device` | `tun-mihomo` | routing-скрипт и watchdog ждут интерфейс с этим именем — правил не будет, watchdog будет циклично рестартовать Mihomo |
| `tun.inet4-address` | `10.255.255.1/30` | MASQUERADE не заработает — трафик клиентов уйдёт без NAT |
| `dns.fake-ip-range` | `198.18.0.0/16` | не совпадёт с main-маршрутом `FAKE_IP_RANGE` — пакеты на fake-ip не попадут в TUN |
| `tun.auto-route` | `false` (инвариант) | `true` перехватит весь трафик VPS — потеря SSH; в UI исключено |

## `listen: 0.0.0.0:53` — что это и почему осторожно

Mihomo поднимает DNS-слушатель на всех интерфейсах — фактически публичный резолвер на
VPS. Это боевой дефолт схемы (потребители — клиенты/контейнеры, использующие VPS как
резолвер), но **оставлять его доступным из интернета бездумно нельзя**: открытый резолвер
притягивает абьюз/amplification. Ограничение доступа (firewall/сетевой уровень VPS) —
**вне scope генератора**, ответственность VPS-слоя. В UI на `0.0.0.0:53` показывается
постоянное предупреждение. Значение редактируемо (например, привязка к конкретному
адресу/порту).

## Правило синхронизации с routing-скриптом

Изменение `device`, `inet4-address` или `fake-ip-range` **обязано** соответствовать
переменным routing-скрипта gateway (`PROXY_IF` / `TUN_INET_ADDR` / `FAKE_IP_RANGE`).
Установщик при следующем запуске перезапишет `fake-ip-range` и `inet4-address` в конфиге
своими значениями (sed-патчи в §2.7 install.sh) — рассинхрон бесполезен и вреден.

## Cross-project contract: generator -> gateway -> bootstrap

Этот профиль нельзя рассматривать отдельно от двух соседних проектов:

```text
link-generators
  -> формирует desired Mihomo config для VPS Gateway
amnezia-mihomo-gateway
  -> сегодня применяет host-side AWG -> Mihomo routing/integration
vps-gateway-bootstrap
  -> будущий orchestration/ownership/rollback слой
```

Live-аудит SE2 от 2026-09-23 показал, почему эта граница важна. После старого удаления gateway
на сервере могли оставаться Docker DNS override, запись `100 mihomo` и installer-era изменения
Mihomo config. Поэтому:

- генератор отвечает только за **желаемый YAML**, а не за ownership или rollback системного состояния;
- `amnezia-mihomo-gateway` должен хранить/восстанавливать только доказуемо принадлежащее ему состояние;
- будущий `vps-gateway-bootstrap` не должен повторно «патчить по догадке» YAML или системные файлы:
  сначала discovery/ownership, затем plan/apply/validate/rollback;
- изменение VPS-профиля здесь требует проверки не только `mihomo -t`, но и совместимости с
  фактическими host-side инвариантами `amnezia-mihomo-gateway`;
- значения `tun.device`, `fake-ip-range`, DNS и TUN-поля — межпроектный контракт, а не локальная
  деталь UI.

### Live evidence: host DNS is not guaranteed by valid YAML

Второй live-аудит 2026-09-23 на Ubuntu 24.04 показал важную границу ответственности.
Mihomo с `dns.listen: 0.0.0.0:53` реально слушал TCP/UDP 53, а запросы самого хоста к
`127.0.0.1:53` и адресу `docker0` проходили. При этом контейнер AmneziaWG не мог
резолвить имена: UFW с default incoming deny блокировал `container -> host:53`.
Точечные UDP+TCP правила только от Docker bridge/subnet к адресу host DNS немедленно
восстановили DNS и HTTPS из контейнера.

Следствие для этого репозитория: **это не ошибка генератора и не повод добавлять управление
UFW в `link-generators`**. Валидный `dns:` в YAML описывает желаемый Mihomo listener, но
не доказывает, что Linux firewall разрешает реальному потребителю добраться до него.
Host-side слой обязан отдельно discover/apply/validate такую доступность и владеть своими
firewall-правилами.

На том же EE-хосте production Mihomo логировал `H3_REQUEST_CANCELLED` и закрытия
`WARP-MASQUE-QUIC`, а `Fastest_MASQUE` периодически активировал health-check и в момент
проверки выбрал H2. Это operational evidence для дальнейшего сравнения H3/H2, но не
доказательство ошибки MASQUE-генерации и не основание менять transport defaults без
повторяемых тестов.

Кроме того, уже на двух VPS наблюдалось расхождение между desired YAML
`tun.inet4-address: 10.255.255.1/30` и live-адресом `tun-mihomo 198.18.0.0/30`.
Причина пока не установлена. Генератор должен продолжать описывать desired state, а
runtime discovery должен проверять фактическое состояние перед выводами о маршрутизации.

Текущий live-audit и rollout-status хранятся в
[`amnezia-mihomo-gateway/docs/LIVE_AUDIT_2026-09-23.md`](https://github.com/saymer-alt/amnezia-mihomo-gateway/blob/stable/docs/LIVE_AUDIT_2026-09-23.md).
До отдельного расходного VPS автоматический rollback в gateway остаётся непроверенным; это не
причина менять значения VPS-профиля генератора без отдельного доказательства.

## Что генератор НЕ делает (никогда)

Docker, AmneziaWG, `ip rule`/policy routing, iptables, MASQUERADE, fwmark, TCPMSS,
sysctl, systemd, watchdog, firewall, любую настройку самого VPS. Это ответственность
[`amnezia-mihomo-gateway`](https://github.com/saymer-alt/amnezia-mihomo-gateway)
(README «Настройка Mihomo» / «Как это работает», AGENTS.md «Несущая логика»).

## Заметки для агентов

- Порядок постобработки в `buildMihomo()`: `injectWgDns` → `applyDeploymentProfile`
  → allow-lan регэксп-патч. Профильный шаг вызывается **только** при `vps`.
- Повторная сериализация — только `jsyaml.dump(doc, { lineWidth: -1 })`, иначе рвутся
  длинные AWG base64-строки (тот же гочай, что в `injectWgDns`).
- jsyaml квотит строку `off` (защита от YAML 1.1 bool): в выводе будет
  `find-process-mode: 'off'` — валидный YAML; mihomo (yaml.v3) читает как строку `"off"`.
- Сочетание VPS-профиля с опциями «на каждый прокси» (Per-Proxy TUN/SOCKS) технически
  возможно (патчится только основная секция `tun:`), но gateway-сценарий предполагает обычный TUN.
- `web4core.runtime.js` не затронут; расширение — только wrapper'ом, как `injectWgDns`.

## Связанные документы

Параметры Builder'а — [MIHOMO.md](MIHOMO.md); тесты — [TESTING.md](TESTING.md);
контракт для агентов — [AGENTS.md](../AGENTS.md).

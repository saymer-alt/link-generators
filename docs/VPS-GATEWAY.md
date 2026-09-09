# VPS-GATEWAY — опциональный профиль генерации для amnezia-mihomo-gateway

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

**Fixed (не редактируются, задаются кодом):**

| Параметр | Значение | Зачем нужен |
|---|---|---|
| `tun.enable` | `true` | TUN — вход перехваченного трафика |
| `tun.stack` | `gvisor` | в связке с `rp_filter=0` на VPS; `endpoint-independent-nat` ломает gvisor и удаляется |
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
- Сочетание VPS-профиля с Per-Proxy TUN/SOCKS технически возможно (патчится только
  основная секция `tun:`), но gateway-сценарий предполагает обычный TUN.
- `web4core.runtime.js` не затронут; расширение — только wrapper'ом, как `injectWgDns`.

## Связанные документы

Параметры Builder'а — [MIHOMO.md](MIHOMO.md); тесты — [TESTING.md](TESTING.md);
контракт для агентов — [AGENTS.md](../AGENTS.md).

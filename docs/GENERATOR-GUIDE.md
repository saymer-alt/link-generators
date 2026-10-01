# Короткая инструкция по генератору

Эта страница — быстрый справочник по `WARP & Mihomo Unified Generator`. Она отвечает на вопрос **«что выбрать прямо сейчас»**. Подробная техническая документация остаётся в `docs/` и нужна, когда требуется понять механизм или отладить нестандартную схему.

## 1. Сначала выберите, где будет работать Mihomo

| Профиль | Когда выбирать | Что генератор делает автоматически |
|---|---|---|
| **Роутер / обычный TUN (Keenetic)** | Keenetic и другие сценарии, где трафик приходит в Mihomo через TUN | TUN включён, MIPS выбран по умолчанию, Mixed Port 7890 и Allow LAN включены; эти параметры можно менять вручную |
| **VPS — локальный Mihomo / SOCKS для Xray / 3X-UI** | Xray/3X-UI или другое приложение на том же VPS отправляет трафик в `127.0.0.1:7890` | TUN принудительно выключен, Mixed Port 7890 принудительно включён, Allow LAN принудительно выключен; системная маршрутизация VPS не используется |
| **VPS Transparent Gateway (amnezia-mihomo-gateway)** | Только схема `amnezia-mihomo-gateway`: Docker/AWG + Linux policy routing → TUN Mihomo | TUN принудительно включён, `device: tun-mihomo`, `auto-route: false`, gateway-поля и fake-ip DNS доступны в отдельной панели |

### Самый частый VPS-сценарий

Если на VPS уже работает 3X-UI/Xray и вы просто хотите отправить его трафик в локальный Mihomo на `127.0.0.1:7890`, выбирайте **«VPS — локальный Mihomo / SOCKS»**. Профиль Transparent Gateway для этого не нужен.

`VPS Transparent Gateway` сам по себе не включает `auto-route`: генератор жёстко сохраняет `auto-route: false`, чтобы Mihomo не перехватил маршрутизацию всего VPS и не оборвал SSH. Но Linux policy routing / iptables / Docker этот профиль тоже не создаёт — это задача `amnezia-mihomo-gateway`.

Подробно: [VPS-GATEWAY.md](VPS-GATEWAY.md).

## 2. Входные данные

- **Основные прокси-ссылки / URL-подписки** — сюда вставляются `vless://`, `trojan://`, `ss://`, `hy2://`, `tuic://`, `masque://` и другие поддерживаемые ссылки. HTTP(S)-URL подписок используются при включённом режиме **«Использовать URL-подписки»**.
- **Автоматический режим белых списков** — отдельная primary/fallback-схема. Используйте только когда нужен автоматический переход между основным и резервным набором. Подробно: [AUTO-WHITELIST.md](AUTO-WHITELIST.md).
- **WireGuard / AmneziaWG** — загрузка `.conf/.wg/.awg`; можно использовать вместе с обычными proxy-ссылками.

## 3. Основные переключатели Mihomo

| Переключатель | Что делает | Обычно |
|---|---|---|
| **Allow LAN** | Разрешает подключение к inbound Mihomo не только с localhost (`allow-lan: true`, `bind-address: "*"`) | Keenetic: ON; VPS local: принудительно OFF |
| **Mixed Port 7890** | Поднимает локальный HTTP/SOCKS mixed inbound на 7890 | Нужен для Xray/3X-UI → Mihomo |
| **Web UI** | Добавляет controller + внешний dashboard | По желанию; на VPS доступ должен ограничиваться firewall/SSH-туннелем |
| **Использовать URL-подписки** | HTTP(S) URL превращаются в `proxy-providers` | ON для подписок, OFF если вводите только обычные proxy-ссылки |
| **TUN Interface** | Создаёт TUN inbound Mihomo | Keenetic/transparent gateway: нужен; VPS local SOCKS: не нужен |
| **MIPS stack для TUN** | Выбирает TUN/IP stack `mips` | Дефолт для Keenetic; требует Mihomo >= 1.19.31 |
| **Расширенный TUN stack** | Даёт `system` / `mixed` | Только для осознанных экспериментов |
| **Ping server** | Endpoint health-check для `url-test` и providers | Обычно можно оставить Google |

## 4. Подписки

- **Exclude Filter** — фильтрует узлы по их **фактическим именам**. Например, `ru|russia` не совпадёт с кириллическим `Россия`; подробнее: [EXCLUDE-FILTER.md](EXCLUDE-FILTER.md).
- **Device Model** — HTTP-заголовок `x-device-model` provider'а. Может использоваться панелью подписки для идентификации устройства.
- **Modern REALITY** — включает X25519+ML-KEM только для перечисленных REALITY-серверов. Не включайте его массово без подтверждённой совместимости.

## 5. WARP / WireGuard через `dialer-proxy`

Поле **«Промежуточный proxy / dialer-proxy»** заставляет WireGuard/WARP устанавливать свой туннель через другой proxy или select-группу.

Типичный вариант с подпиской:

```text
WARP
  └─ dialer-proxy: WARP-DIALER
       └─ use: Geodema / другой proxy-provider
```

После генерации в dashboard можно выбирать транспортный узел группы `WARP-DIALER`.

### Два обязательных ограничения

1. **Транспорт должен реально поддерживать UDP relay.** То, что узел открывает сайты по TCP, ещё не доказывает, что через него поднимется WireGuard/WARP. Для provider-backed группы генератор не может заранее проверить UDP у каждого удалённого узла.
2. **Переключение узла `WARP-DIALER` не означает немедленную смену уже поднятого WireGuard-пути.** В полевых тестах существующий handshake продолжал использовать старый транспорт более 150 секунд. Для гарантированной немедленной смены маршрута нужно пересоздать/reload WireGuard outbound/Mihomo.

Полевые тесты показали на SE VPS: прямой WARP → ARN; WARP через Geodema Germany → FRA; через Netherlands → AMS. Это наблюдение конкретной сети, а не гарантия будущего Cloudflare routing.

Подробно: [MIHOMO.md](MIHOMO.md) и `tools/warp-dialer-fieldtest/README.md`.

## 6. ADVANCED: отдельный вход на каждый прокси

Этот режим нужен редко. После его включения можно создать отдельный TUN-интерфейс и/или отдельный SOCKS-порт для каждого proxy/provider. Если вам нужен обычный Keenetic, обычный VPS local `127.0.0.1:7890` или стандартный Transparent Gateway — оставьте блок закрытым и выключенным.

## 7. Кнопки

- **Build Config** — собирает YAML и запускает встроенную базовую проверку.
- **Copy YAML** — доступна только после успешной базовой проверки. Она не заменяет настоящий `mihomo -t`.
- **Загрузить .conf/.awg** — добавляет WireGuard/AmneziaWG profile в будущий YAML.
- **В Mihomo Builder** на вкладке WARP — переносит сгенерированные `masque://` ссылки во вкладку Mihomo и переключает её в режим обычных proxy-ссылок.

Перед production-использованием итоговый файл рекомендуется проверить настоящим Mihomo:

```bash
mihomo -t -f /path/to/config.yaml
```

## 8. Если нужна техническая глубина

- [MIHOMO.md](MIHOMO.md) — полная модель Builder, TUN, dialer-proxy и dependency graph.
- [VPS-GATEWAY.md](VPS-GATEWAY.md) — Transparent Gateway.
- [AUTO-WHITELIST.md](AUTO-WHITELIST.md) — primary/fallback.
- [VALIDATION.md](VALIDATION.md) — что проверяет браузер и чего он проверить не может.
- [TESTING.md](TESTING.md) — лабораторные и regression-проверки.
- [EXCLUDE-FILTER.md](EXCLUDE-FILTER.md) — фильтры proxy-provider.

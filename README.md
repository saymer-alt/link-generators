# WARP & Mihomo Unified Generator

Новый opt-in: **Автоматический режим белых списков** — обычные выходы приоритетны,
отдельные БС-ссылки/подписки используются как резерв по health-check. Per-Proxy и
VPS Gateway в этом режиме отключены; обычный TUN и MIPS доступны. По умолчанию
режим выключен. [Настройка, структура YAML и ограничения](docs/AUTO-WHITELIST.md).


Генератор конфигураций для [Mihomo](https://github.com/MetaCubeX/mihomo) (Clash Meta) и ссылок MASQUE для Cloudflare WARP. Статическое клиентское веб-приложение: разбор ссылок и сборка конфигов выполняются прямо в браузере — приватные ключи, ссылки и конфигурации никуда не отправляются.

🌐 **Открыть генератор:** [saymer-alt.github.io/link-generators](https://saymer-alt.github.io/link-generators/)

---

## Что это

Одна страница — две функции:

- **⚙️ Mihomo Config Builder** — собирает готовый `config.yaml` для Mihomo из proxy-ссылок, HTTP(S)-подписок и файлов WireGuard / AmneziaWG. Перед копированием конфиг проходит базовую структурную проверку.
- **⚡ WARP MASQUE Links** — генерирует пары ссылок `masque://` (QUIC + HTTP/2) для WARP по анти-DPI стратегии: фиксированный пул QUIC-endpoint'ов, взвешенные «безопасные» порты для H2, анти-корреляция IP.

## Быстрый старт

**Ссылки → Mihomo YAML**

1. Откройте вкладку **⚙️ Mihomo Config Builder**.
2. Вставьте proxy-ссылки. Если это обычные ссылки (а не URL подписок) — снимите галочку **📡 Sub Mode**.
3. Нажмите **⚡ Build Config**: под YAML появится результат базовой проверки. Если ошибок нет — **📋 Copy YAML**.

**WireGuard / AmneziaWG → Mihomo YAML**

1. Нажмите **📂 Загрузить .conf / .awg** и выберите один или несколько файлов.
2. При необходимости задайте **WireGuard DNS** — если в конфиге обнаружен нестабильный DNS Amnezia (`100.64.0.1`), публичные DNS подставятся автоматически.
3. **⚡ Build Config** → **📋 Copy YAML**.

**YAML от WARP-бота → ссылки `masque://`**

1. На вкладке **⚡ WARP MASQUE Links** вставьте YAML-конфиг от бота и нажмите **🔍 Распарсить** — ключи и параметры подставятся в форму.
2. **⚡ Сгенерировать ссылки** — получите пары `masque://`-ссылок (QUIC + H2).
3. Кнопка **🚀 В Mihomo Builder** перенесёт их в сборщик конфига.

## Какие данные можно подать на вход

- **Proxy-ссылки** — по одной в строке (список протоколов ниже).
- **HTTP(S)-подписки** — в режиме 📡 Sub Mode; генератор прописывает их как `proxy-providers`, скачивать подписку будет сам Mihomo, а не страница.
- **WireGuard / AmneziaWG** — файлы `.conf`, `.wg`, `.awg` (можно несколько сразу).
- **YAML от WARP-ботов** — см. следующий раздел.

## Совместимость с WARP-ботами

Вкладка «WARP MASQUE Links» принимает YAML-конфигурации WARP-ботов и аналогичных генераторов — например, `@warp_generator_bot`, но подойдёт любой бот, выдающий совместимый YAML. Генератор ищет в документе стандартные поля WARP-конфигурации:

- `private-key` (обязателен) и `public-key`;
- внутренний IP туннеля `ip` (опционально `ipv6`);
- `sni` и `dns`.

Название бота не важно — важно наличие этих полей. Из них собираются `masque://`-ссылки; порты и распределение QUIC/H2 подбираются анти-DPI стратегией автоматически.

## Поддерживаемые протоколы

Ниже — входы, которые текущий UI принимает и превращает в Mihomo YAML. Для обычных
proxy-ссылок отключите **📡 Sub Mode**.

| Протокол | Вход | Mihomo output | Примечание |
|---|---|---|---|
| VLESS | `vless://` | `type: vless` | TLS/Reality, transport и flow |
| VMess | `vmess://` | `type: vmess` | UUID, cipher и transport |
| Trojan | `trojan://` | `type: trojan` | Пароль и TLS |
| Shadowsocks | `ss://` | `type: ss` | Cipher, пароль, plugin options |
| Hysteria2 | `hysteria2://`, `hy2://` | `type: hysteria2` | Именно v2; не Hysteria v1 |
| TUIC | `tuic://` | `type: tuic` | UUID/пароль или token |
| AnyTLS | `anytls://` | `type: anytls` | Пароль и параметры сессии |
| Mieru | `mieru://`, `mierus://` | `type: mieru` | Логин/пароль, TCP/UDP; одиночный порт или `port-range` |
| MASQUE | `masque://` | `type: masque` | Включая ссылки WARP из первой вкладки, QUIC и HTTP/2 |
| TrustTunnel | `tt://` | `type: trusttunnel` | Payload формата TrustTunnel |
| SOCKS5 / SOCKS5H | `socks://`, `socks5://`, `socks5h://` | `type: socks5` | Алиасы входа; логин/пароль при необходимости |
| HTTP / HTTPS proxy | `http://`, `https://` | `type: http` | HTTPS включает TLS; URL прокси не путать с подпиской |
| WireGuard | `.conf`, `.wg` (также `.awg`) | `type: wireguard` | Импорт файла через кнопку загрузки |
| AmneziaWG | `.conf`, `.awg` (также `.wg`) | `type: wireguard` + `amnezia-wg-option` | Параметры AWG 1.x / 1.5 / 2.x / 3.0 / 3.1; особенности версий ниже |

**Отдельный тип входа — HTTP(S)-подписки:** URL `http://` / `https://` без логина/пароля
в режиме **📡 Sub Mode** превращаются в `proxy-providers`. Подписку скачивает сам Mihomo;
это способ получения прокси, а не отдельный proxy protocol.

**Пока не поддерживается генератором напрямую:** SSR, Hysteria v1, OpenVPN import, SSH
и специализированные профили Tailscale / ZeroTier / EasyTier. Полная матрица и границы
поддержки — в [аудите Mihomo 1.19.31](docs/AUDIT-MIHOMO-1.19.31.md).

## WireGuard / AmneziaWG

- Поддерживается обычный **WireGuard** (`.conf` / `.wg`).
- Поддерживается **AmneziaWG**: классическая обфускация (`Jc/Jmin/Jmax/S1/S2/H1–H4`), параметры AWG 1.5 (`S3/S4/I1–I5`, `J1–J3/itime`), диапазоны H-параметров AWG 2+ и современные **AWG 3.x** (`HeaderProtectionKey`, content padding, rekey-параметры, `RandomTrailers`, `DisableCookies`).
- Для конфигов с AWG 3.x-параметрами генератор автоматически включает движок AWG 3.x в итоговом YAML (`version: 3`) — без этого Mihomo молча работал бы в legacy-режиме и 3.x-параметры не действовали.
- **AWG 3.1** требует **Mihomo >= 1.19.30**: сохраняются все девять поддерживаемых 3.x-полей, диапазоны таймеров и `RandomTrailers` / `DisableCookies = on/off` как YAML booleans. Параметры разных поколений нельзя произвольно смешивать; [форматы и ограничения версий](docs/PROTOCOLS.md#wireguard--amneziawg).
- Нестабильный DNS Amnezia (`100.64.0.1`) автоматически заменяется на публичные (`1.1.1.1`, `8.8.8.8`) с предупреждением; свой DNS можно задать в поле **WireGuard DNS**.

## Как работает генерация

```text
ссылки / подписки / .conf-файлы
      ↓  парсинг и нормализация (полностью в браузере)
      ↓  сборка Mihomo YAML
      ↓  базовая структурная проверка
      ↓  Copy YAML
```

- Всё выполняется локально: приватные ключи и конфиги **не отправляются на сервер** — сервера у проекта просто нет.
- Базовая проверка ловит очевидные ошибки до копирования (например, `transport: TPC` вместо `TCP`, неизвестный тип прокси, битый YAML) и блокирует Copy YAML, пока ошибка не исправлена.
- Это **не** полноценная проверка: настоящий Mihomo в браузере недоступен. Авторитетная проверка — на целевой машине:

```bash
mihomo -t -f config.yaml
```

## Возможности Mihomo Builder

- **Proxy groups** — группа быстрейшего прокси (url-test) и селектор GLOBAL; при Per-Proxy режимах — отдельная группа на каждый прокси.
- **Health checks** — выбор endpoint'а: Google, Cloudflare, Apple, Microsoft, Ubuntu, Fedora.
- **📡 Sub Mode** — HTTP(S)-подписки как `proxy-providers`: обновление раз в 12 часов, встроенный health-check. Включён по умолчанию; **для обычных ссылок отключите**.
- **🛡️ TUN** и **🔒 Per-Proxy TUN** — системный туннель либо отдельный TUN-интерфейс на каждый прокси.
- **MIPS stack для TUN** — opt-in для **Mihomo >= 1.19.31**, выключен по умолчанию; стандартом остаётся **gVisor**. MIPS здесь — **TUN stack, не архитектура CPU**. Работает для обычного и Per-Proxy TUN, включая профиль VPS Gateway.
- **🎯 Профиль VPS Gateway** (опционально, выключен по умолчанию) — Mihomo-конфиг для transparent-gateway-сценария [amnezia-mihomo-gateway](https://github.com/saymer-alt/amnezia-mihomo-gateway); обычная генерация не меняется. Подробнее — [docs/VPS-GATEWAY.md](docs/VPS-GATEWAY.md).
- **🔌 Per-Proxy SOCKS** — отдельный SOCKS-порт на каждый прокси.
- **🌐 Allow LAN** и **Mixed Port 7890**.
- **🖥️ Web UI** — подключение дашборда metacubexd к `external-controller`.
- **WireGuard / AmneziaWG** — см. раздел выше.
- **Mieru port ranges** — поддерживается диапазон портов вместо одиночного порта; ошибки диапазона проверяются до копирования.
- **Защита обновлений** — автоматические regression tests проверяют runtime, а обновление сохраняет адаптацию MIPS; при несовместимом изменении апстрима оно останавливается. [Подробнее о проверках](docs/TESTING.md).

## Ограничения и важные замечания

- Базовая проверка структурная: она отсеивает заведомо невалидные конфиги, но не гарантирует, что Mihomo примет конфигурацию. Финальная проверка — `mihomo -t` на целевой машине.
- 📡 Sub Mode включён по умолчанию: он предназначен для URL-подписок — обычные ссылки требуют его отключения.
- Подписки скачивает сам Mihomo на вашем устройстве, страница их не загружает.
- IPv6 в генерируемом конфиге по умолчанию выключен (`ipv6: false`).
- Старый адрес `/mihomo.html` больше не существует (файл удалён) — используйте главную страницу.

## Подробная документация

Ревизия **Mihomo v1.19.31**, проверка AWG 3.1 и полная матрица протоколов с предложениями следующего этапа: [отчёт аудита](docs/AUDIT-MIHOMO-1.19.31.md). Pipeline AWG сохраняет все девять 3.1-полей, диапазоны и `on/off` → YAML booleans; AWG 3.1 требует Mihomo >= 1.19.30.

Техническая база знаний — каталог [`docs/`](docs/):

| Документ | О чём |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | архитектура и схема потоков |
| [DATAFLOW](docs/DATAFLOW.md) | прохождение данных, приватность |
| [MIHOMO](docs/MIHOMO.md) | настройки Builder'а и структура YAML |
| [PROTOCOLS](docs/PROTOCOLS.md) | протоколы: вход → bean → Mihomo |
| [VALIDATION](docs/VALIDATION.md) | pre-copy валидатор подробно |
| [VPS-GATEWAY](docs/VPS-GATEWAY.md) | опциональный профиль для amnezia-mihomo-gateway |
| [UPDATES](docs/UPDATES.md) | жизненный цикл `web4core.runtime.js` |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | разработка и проверки |
| [TESTING](docs/TESTING.md) | тестовая стратегия |

---

## Credits

Based on [web4core](https://github.com/spatiumstas/web4core) by [spatiumstas](https://github.com/spatiumstas) (BSD-3-Clause).

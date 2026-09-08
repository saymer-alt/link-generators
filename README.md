# WARP & Mihomo Unified Generator

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

В Mihomo YAML попадают ссылки протоколов:

**vless · vmess · trojan · ss (Shadowsocks) · hysteria2 (hy2) · tuic · anytls · mieru/mierus · masque · trusttunnel (tt) · socks5/socks5h · http/https** — плюс **WireGuard и AmneziaWG** из `.conf`-файлов и **HTTP(S)-подписки** (Sub Mode).

## WireGuard / AmneziaWG

- Поддерживается обычный **WireGuard** (`.conf`).
- Поддерживается **AmneziaWG**: классическая обфускация (`Jc/Jmin/Jmax/S1/S2/H1–H4`), параметры AWG 1.5 (`S3/S4/I1–I5`, `J1–J3/itime`), диапазоны H-параметров AWG 2+ и современные **AWG 3.x** (`HeaderProtectionKey`, content padding, rekey-параметры, `RandomTrailers`, `DisableCookies`).
- Для конфигов с AWG 3.x-параметрами генератор автоматически включает движок AWG 3.x в итоговом YAML (`version: 3`) — без этого Mihomo молча работал бы в legacy-режиме и 3.x-параметры не действовали.
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
- **🔌 Per-Proxy SOCKS** — отдельный SOCKS-порт на каждый прокси.
- **🌐 Allow LAN** и **Mixed Port 7890**.
- **🖥️ Web UI** — подключение дашборда metacubexd к `external-controller`.
- **WireGuard / AmneziaWG** — см. раздел выше.

## Ограничения и важные замечания

- Базовая проверка структурная: она отсеивает заведомо невалидные конфиги, но не гарантирует, что Mihomo примет конфигурацию. Финальная проверка — `mihomo -t` на целевой машине.
- 📡 Sub Mode включён по умолчанию: он предназначен для URL-подписок — обычные ссылки требуют его отключения.
- Подписки скачивает сам Mihomo на вашем устройстве, страница их не загружает.
- IPv6 в генерируемом конфиге по умолчанию выключен (`ipv6: false`).
- Старый адрес `/mihomo.html` больше не существует (файл удалён) — используйте главную страницу.

## Подробная документация

Техническая база знаний — каталог [`docs/`](docs/):

| Документ | О чём |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | архитектура и схема потоков |
| [DATAFLOW](docs/DATAFLOW.md) | прохождение данных, приватность |
| [MIHOMO](docs/MIHOMO.md) | настройки Builder'а и структура YAML |
| [PROTOCOLS](docs/PROTOCOLS.md) | протоколы: вход → bean → Mihomo |
| [VALIDATION](docs/VALIDATION.md) | pre-copy валидатор подробно |
| [UPDATES](docs/UPDATES.md) | жизненный цикл `web4core.runtime.js` |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | разработка и проверки |
| [TESTING](docs/TESTING.md) | тестовая стратегия |

---

## Credits

Based on [web4core](https://github.com/spatiumstas/web4core) by [spatiumstas](https://github.com/spatiumstas) (BSD-3-Clause).

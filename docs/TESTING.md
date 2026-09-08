# TESTING — реальная тестовая стратегия

В проекте **нет** автотестов и CI-проверок кода (единственный workflow — автообновление
рентайма, он тестов не содержит). Тестирование — ручное: браузерный прогон через локальный
сервер + юнит-матрица валидатора, выполняемая в консоли/evaluate на живой странице.
Здесь зафиксированы **фактически выполненные** проверки (последний полный прогон —
2026-09-08, перед commit `f5ea0a3`) и регрессионный минимум. Придумывать CI не нужно —
если он появится, этот документ обновляется.

## Инфраструктура прогона

```bash
cd link-generators
py -m http.server 8017 --bind 127.0.0.1
# открыть http://127.0.0.1:8017/index.html (in-app browser или обычный браузер)
```

Юнит-кейсы валидатора вызываются прямо на странице (`validateMihomoYaml(yaml)` — глобальная
функция; состояние — `MIHOMO_VALIDATION_STATE`); e2e — через UI или те же evaluate-вызовы
(`buildMihomo()`, `copyMihomo()`). Файлы WG подсовываются через `DataTransfer` + событие
`change` на `#wgFile` (нативный file-пикер не автоматизируется). Все фикстуры —
синтетические (фейковые base64-ключи); реальные конфиги пользователя в тестах не
использовать никогда.

Гочаи прогона:

- после правок обновлять вкладку (`reload`) — свежий page build может закэшироваться;
- **Sub Mode включён по умолчанию**: `buildMihomo` отвергает не-URL ввод («Provide one or
  more HTTP(S) URLs…») — для ссылок выключать `#cfgSubMode` (это не баг патчей);
- mieru-ссылка требует userinfo: `mieru://user:pass@host:port?transport=…`, иначе
  «mieru: missing username/password»;
- клик по Build в evaluate — через `#tab-mihomo button[onclick="buildMihomo()"]`
  (первая `.btn` вкладки — кнопка загрузки WG-файла).

## Юнит-матрица валидатора (42 кейса, все зелёные на 2026-09-08)

Функция `validateMihomoYaml(yaml)`:

- **TPC-регресс**: `mieru` c `transport: TPC` → INVALID, ошибка содержит
  Proxy=`Sweden Mieru`, Field=`transport`, Value=`"TPC"`; с `TCP` → VALID (0 ошибок);
- неизвестный `type` (`vles`) → INVALID; отсутствующий `server` → INVALID; порты
  `0`, `70000`, `"abc"`, `443.5` → INVALID;
- битый YAML → INVALID с сообщением о синтаксисе; корень-список → INVALID; `dns` не
  словарь → INVALID;
- неизвестное дополнительное поле → **VALID** (намеренно не проверяется);
- группы: битая ссылка на несуществующий прокси → INVALID; неизвестный тип группы
  (`fallback2`) → INVALID; forward-ссылка на группу → VALID; все 5 типов групп → VALID;
  пустой `proxies` группы → VALID + 1 warning;
- listeners: порт `0` → INVALID; дубликат имени → INVALID; дубликат имени прокси → INVALID;
- AWG 3.1 фикстура (wireguard + `amnezia-wg-option` с `version: 3`, header-protection-key,
  диапазоны) → **VALID** — валидатор не должен ломать AWG;
- 17 позитивов: ss, ssr, vmess, vless, trojan, hysteria2, tuic, ssh, anytls, masque,
  trusttunnel, mieru (TCP), http, socks5, hysteria (`type: hysteria` в YAML — v1 ядро
  поддерживает, хотя ссылки `hysteria://` не парсятся, см. [PROTOCOLS.md](PROTOCOLS.md)),
  snell, direct (без server) → VALID;
- коллизия «имя группы = имени прокси» → VALID + warning.

## Браузерные e2e (выполнены 2026-09-08)

| Сценарий | Ожидание | Статус |
|---|---|---|
| VLESS-ссылка → Build Config | state `VALID`, бокс «⚠️ Базовая проверка пройдена. Это не эквивалент проверки mihomo -t.», Copy включена | ✅ |
| изменение input после VALID (событие input) | state `NOT_BUILT`, Copy выключена | ✅ |
| `mieru://…?transport=TPC` → Build | state `INVALID`, Copy выключена, бокс с Proxy/Field/Value; `TPC` реально в готовом YAML (валидация пост-билд) | ✅ |
| та же ссылка с `TCP` → Build | state `VALID`, Copy включена | ✅ |
| `copyMihomo()` в INVALID | toast «Копирование заблокировано…», clipboard не тронут (guard) | ✅ |
| AWG 3.1 `.conf` (фейковые ключи, `PersistentKeepalive = 25-35`, `HeaderProtectionKey`) через DataTransfer → Build | state `VALID`; в YAML `version: 3`, `persistent-keepalive: 25`, `amnezia-wg-option` на месте — AWG-слой не задет | ✅ |
| захват фактических YAML (links / per-proxy SOCKS / per-proxy TUN / sub-mode / mieru / masque / socks5 / WG) | сверка структуры с документацией (`docs/`) | ✅ |
| отказы рантайма: `sdns://`, `socks4://`, `hysteria://` | «Mihomo does not support: sdns/socks4», «Unknown link: hysteria» | ✅ |

## Runtime untouched check

Перед каждым commit:

```bash
git status --short                         # только задуманные файлы
git diff --check                           # whitespace
git diff --name-only web4core.runtime.js   # пусто = рантайм не тронут
```

## Регрессионный минимум перед любым пушем

1. Обе вкладки: полный сценарий «YAML бота → ссылки → Builder → Build → Copy».
2. Валидатор: TPC → INVALID + Copy заблокирована; TCP → VALID; изменение input сбрасывает.
3. AWG 3.1 `.conf` → VALID (`version: 3` в YAML).
4. Allow LAN: `allow-lan: true` + `bind-address: "*"` в выводе (регэксп-патч не сломан).
5. `web4core.runtime.js` не тронут (см. команду выше).

## Что не тестируется

Ничего не гоняется автоматически: после пуша проверяется живая страница вручную, а после
бот-коммита рантайма прогон повторяется (см. [UPDATES.md](UPDATES.md), [DEVELOPMENT.md](DEVELOPMENT.md)).

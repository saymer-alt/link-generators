# Ревизия Mihomo v1.19.31 (2026-09-15)

База генератора: `fb285850bae09ba2f2336993e6b34fc2318a23af`, ветка `main`,
чистое рабочее дерево до изменений. Ядро: тег `v1.19.31`, commit
`ab405bad5beeeac8b003bb01f60f134f6df54471` (релиз 2026-09-14).
Проверка по исходникам, а не только release notes.

## TUN: ground truth и реализация

- [constant/tun.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/constant/tun.go):
  `StackTypeMapping`, `TunMips`, `UnmarshalText` принимают `mips`.
- [config/config.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/config/config.go):
  основная секция TUN использует `Stack C.TUNStack`.
- [listener/inbound/tun.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/listener/inbound/tun.go):
  `TunOption.Stack C.TUNStack` передаётся в `listener/config.Tun`.
- [listener/sing_tun/server.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/listener/sing_tun/server.go):
  `tun.NewStack(strings.ToLower(options.Stack.String()), stackOptions)`.
- [sing-tun v0.4.24 stack.go](https://github.com/metacubex/sing-tun/blob/v0.4.24/stack.go)
  выбирает `NewMipstack`; `stack_mipstack.go` использует библиотеку
  `github.com/metacubex/mipstack`. Это **TUN/IP stack, не архитектура CPU MIPS**.

В исходном генераторе: UI `cfgTun`, `cfgPerProxyTun`; `buildMihomo()` передаёт
`addTun`/`mihomoPerProxyTun`; runtime `buildFromRequest()` создаёт `mihomoTunOpts`;
`buildMihomoYaml()` содержал два `stack: "gvisor"` — обычный TUN и TUN listeners.
Третье `stack: "gvisor"` в runtime относится к sing-box и не меняется.
Отдельный hardcode был в `applyDeploymentProfile()` страницы.

Новый checkbox `cfgTunMips` выключен. Цепочка:
`buildMihomo → options.mihomoTunStack → mihomoTunOpts.stack → buildMihomoYaml → tun/listeners`.
Только точное значение `mips` включает новый стек; всё остальное, включая отсутствие
опции, даёт `gvisor`. Такая нормализация соответствует существующим безопасным
дефолтам runtime и не допускает произвольных строк в YAML. Прямой вызов
`buildMihomoYaml(..., {tun: {stack}})` защищён тем же ограничением.
При выключенном TUN выбор стека сам по себе TUN не создаёт.

VPS получает выбранный стек отдельным аргументом (включая сочетание VPS + per-proxy TUN,
когда VPS создаёт дополнительный основной TUN). Остальные gateway-поля, DNS toggle,
`auto-route: false`, порядок постобработки и generic guard сохранены.
Нужен **Mihomo >= 1.19.31**; это opt-in для обычного и per-proxy TUN.

## AWG 3.1: проверка pipeline

Источник схемы, выбора движка и передачи в UAPI:
[adapter/outbound/wireguard.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/adapter/outbound/wireguard.go).
Точная зависимость из `go.mod`: `amneziawg-go@0c1c6f40ecd7a0c83b8dcd3e54b938eda8cccc8d`:
[uapi.go](https://github.com/metacubex/amneziawg-go/blob/0c1c6f40ecd7a0c83b8dcd3e54b938eda8cccc8d/device/uapi.go),
[noise-types.go](https://github.com/metacubex/amneziawg-go/blob/0c1c6f40ecd7a0c83b8dcd3e54b938eda8cccc8d/device/noise-types.go).

| `.conf/.awg` | `amnezia-wg-option` | Тип Mihomo / обработка |
|---|---|---|
| HeaderProtectionKey | header-protection-key | string: base64 → hex; ключ движка 32 байта |
| ContentPaddingAddition | content-padding-addition | string, UintRange |
| RekeyAfterTime | rekey-after-time | string, UintRange |
| RekeyTimeout | rekey-timeout | string, UintRange |
| RejectAfterTime | reject-after-time | string, UintRange |
| KeepaliveTimeout | keepalive-timeout | string, UintRange |
| MaxHandshakeAttempts | max-handshake-attempts | string, UintRange |
| RandomTrailers | random-trailers | bool, `on` → `1` → `true` |
| DisableCookies | disable-cookies | bool, `off` → `0` → `false` |

`UintRange.FromString` принимает десятичный uint32 либо `lo-hi`, обе границы
0..4294967295, `hi >= lo`; отрицательные, дробные, перевёрнутые диапазоны и
переполнение отвергаются движком. Это синтаксические границы, не рекомендация
для безопасных эксплуатационных таймингов. Генератор сохраняет диапазоны строками;
структурный валидатор не проверяет их семантику.

`normalizeWgText` снимает BOM, сворачивает PersistentKeepalive и переводит on/off.
`parseWireGuardConf` сохраняет семь строковых и два булевых поля в bean.
`normalizeWgBeans` добавляет `version: 3`, если версия отсутствует и есть любое
3.x-поле (в том числе `false`); явно заданную версию не переопределяет.
`buildMihomoProxy` передаёт весь `amnezia-wg-option`; YAML, DNS injection и VPS dump
с `lineWidth: -1` сохраняют значения. В Mihomo только `Version == 3` выбирает
`amneziav3`; true-флаги превращаются в UAPI `=1`, false остаются дефолтными false.

Нового gap в **UI pipeline** этих девяти полей не обнаружено. AWG runtime не менялся.
Известное ограничение прямого `parseWireGuardConf` остаётся: on/off требуют wrapper;
прямой API также сам не добавляет version 3. Поддержка страницы и сырого API различны.
Не смешивать поля v1.5 `j1-j3/itime` с v3: это ограничение движка.
Синтетическая fixture `tests/fixtures/awg31.conf` содержит реальный синтаксис 3.1,
все девять полей, диапазоны и открытые тестовые ключи; это не рабочий VPN-профиль.

## Полная outbound-матрица

Источник полного списка: [adapter/parser.go v1.19.31](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/adapter/parser.go).
28 `case`-типов: 24 сетевых + 4 служебных. AWG — вариант `wireguard`, не отдельный type.
«Да» в колонке ядра означает наличие реализации; некоторые сборки исключают возможности
build tags (например `no_easytier`). Это не подтверждение каждого транспорта handshake-тестом.
Parser/builder/UI относятся к прямому импорту генератора; внешний proxy-provider может
содержать другие типы, но это не реализация их импорта страницей.

| Outbound | Mihomo | Share-link / степень стандартизации | Parser | Builder | UI | Разумный путь |
|---|---|---|---|---|---|---|
| VMess `vmess` | да | распространённый vmess:// base64 JSON | да | да | ввод | уже есть |
| VLESS `vless` | да | распространённый vless:// | да | да | ввод | уже есть |
| Trojan `trojan` | да | распространённый trojan:// | да | да | ввод | уже есть |
| Shadowsocks `ss` | да | ss://, SIP002 | да | да | ввод | уже есть |
| ShadowsocksR `ssr` | да | распространённый ssr://, converter ядра | нет | нет | нет | **A**, следующий этап №1 |
| SOCKS5 `socks5` | да | socks/socks5/socks5h URI conventions | да | да | ввод | уже есть |
| HTTP `http` | да | http/https URL, неоднозначность с подпиской | да | да | ввод | уже есть |
| Snell `snell` | да | единый полный share URI не подтверждён | нет | нет | нет | **B**, форма/config import |
| Hysteria v1 `hysteria` | да | hysteria://, converter ядра | нет | нет | нет | **A**, следующий этап №2 |
| Hysteria2 `hysteria2` | да | hy2/hysteria2:// | да | да | ввод | уже есть |
| TUIC `tuic` | да | распространённый tuic://; варианты token/UUID | да | да | ввод | уже есть |
| AnyTLS `anytls` | да | anytls://, URI schema проекта | да | да | ввод | уже есть |
| WireGuard `wireguard` | да | единого полного URI нет | .conf | да | файлы | уже есть |
| AmneziaWG (`wireguard`) | да | .conf/.awg с расширениями | wrapper + .conf | да | файлы | уже есть, аудит выше |
| Mieru `mieru` | да | mierus://; runtime также mieru:// | да | да | ввод | уже есть |
| MASQUE `masque` | да | локальный masque:// контракт, не общий стандарт MASQUE | да | да | ввод + генератор | уже есть |
| TrustTunnel `trusttunnel` | да | tt:// payload формата проекта | да | да | ввод | уже есть |
| SSH `ssh` | да | ssh:// недостаточен для ключей/host-key/options | нет | нет | нет | **B**, форма + ключ, этап №4 |
| OpenVPN `openvpn` | да | профиль .ovpn; полного общего share URI нет | нет | нет | нет | **B**, file import, этап №3 |
| ShadowQUIC `shadowquic` | да | общий стабильный полный URI не подтверждён | нет | нет | нет | **B**, форма; URI требует отдельной проверки |
| Sudoku `sudoku` | да | общий стабильный полный URI не подтверждён | нет | нет | нет | **B**, форма; URI требует отдельной проверки |
| Tailscale `tailscale` | да | enrolment/auth/exit-node profile, не proxy link | нет | нет | нет | **C**, отдельный сетевой профиль |
| ZeroTier `zerotier` | да | network-id/identity profile, не proxy link | нет | нет | нет | **C**, отдельный сетевой профиль |
| EasyTier `easytier` | да* | network/peers/identity profile | нет | нет | нет | **C**, отдельный профиль, зависит от сборки |
| GOST Relay `gost-relay` | да | relay:// conventions экосистемы GOST, переносимость не подтверждена | нет | нет | нет | **B** сейчас; **A** после фиксации URI-контракта |
| `direct`, `reject`, `dns`, `rematch` | да | служебные конфигурационные типы | не proxy links | не импорт | нет | исключены из кандидатов |

Подтверждение существующих URI: [common/convert/converter.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/common/convert/converter.go)
содержит hysteria, SSR (с полным описанием base64/параметров), VMess, SS, SOCKS/HTTP,
AnyTLS и Mierus. Дополнительные форматы текущего генератора подтверждены его parser code.
«Не подтверждён» не означает, что URI нигде не существует: без устойчивого контракта
не следует объявлять его стандартом или автоматически добавлять импорт.
Например, [официальная документация Snell](https://manual.nssurge.com/policies/snell.html)
описывает конфигурационную декларацию; [Surge URL schemes](https://manual.nssurge.com/tools/url-scheme.html)
описывают установку полного config URL, что не равно универсальному Snell proxy URI.

## Proposal следующей волны (здесь не реализовано)

1. **SSR**: ssr:// → bean → Mihomo ssr; URL-safe base64, IPv6, remarks,
   protocol/obfs и их параметры, ошибки декодирования, безопасный вывод секретов.
2. **Hysteria v1**: отдельно от hy2; auth/auth-str, up/down, protocol, peer/SNI,
   obfs, ALPN, TLS; не переносить дефолты Hysteria2 на v1.
3. **OpenVPN .ovpn**: whitelist поддерживаемых директив и inline cert/key/CA,
   TLS-auth/crypt, auth-user-pass через отдельную форму. Не исполнять hooks/scripts,
   не читать произвольные пути из файла. Проверять против `OpenVPNOption` ядра.
4. **SSH**: форма сервера/user/password или private key/passphrase плюс host-key;
   `ssh://` можно использовать только для частичного заполнения.
5. C-профили: отдельное решение о UX, state directory/identity, exit node,
   платформе и build tags. Не маскировать их обычными proxy links.

Отдельный gap валидатора: `MIHOMO_PROXY_TYPES` содержит 27 типов до EasyTier;
ядро уже имеет 28. EasyTier в текущем генераторе не создаётся. Изменение enum
отложено вместе с соответствующей поддержкой; аудит не расширяет генератор.

## Граница проверок

Команды и воспроизводимые регрессии — [TESTING.md](TESTING.md).
Структурный/browser тест, `mihomo -t` и реальный сетевой туннель — разные уровни.
Даже успешный `-t` не доказывает создание TUN на целевом роутере или AWG handshake.
Сеть и credentials пользователя для ревизии не использовались.

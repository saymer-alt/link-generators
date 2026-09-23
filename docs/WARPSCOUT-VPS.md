# WARPSCOUT на VPS — Ubuntu 24.04 / Debian 12

Практическая инструкция для серверов, на которых уже работает Mihomo из экосистемы
`link-generators` / `amnezia-mihomo-gateway`.

Цель — не просто установить WARPSCOUT, а получить воспроизводимую диагностику **именно из
сети конкретного VPS**:

1. найти WARP / WireGuard endpoint;
2. найти MASQUE H3 / QUIC endpoint;
3. найти MASQUE H2 / TCP endpoint;
4. сравнить это с тем, как уже работающий Mihomo выводит трафик через H3 и H2;
5. зафиксировать внешний IP, Cloudflare `colo`, WARP-state и фактическое поведение сервисов
   вроде Gemini.

Актуальный upstream: [vernette/warpscout](https://github.com/vernette/warpscout).

> WARPSCOUT запускается как обычная программа и сам по себе не заменяет и не перезапускает Mihomo.
> Скан идёт из сетевого namespace хоста. Если на сервере есть глобальный TUN/policy-routing,
> который перехватывает вообще весь локальный трафик, это надо учитывать отдельно.

## 1. Установка зависимостей

Ubuntu 24.04 и Debian 12:

```bash
sudo apt update
sudo apt install -y curl ca-certificates tar jq
```

Если вы уже вошли как `root`, `sudo` не нужен:

```bash
apt update
apt install -y curl ca-certificates tar jq
```

`jq` нужен только для удобного чтения JSON в диагностике.

Если `sudo` пишет `unable to resolve host <hostname>`, это отдельная проблема
локального hostname/`/etc/hosts`; она не связана с WARPSCOUT и обычно не мешает
самой установке. Исправить её лучше отдельно, прежде чем использовать `sudo` дальше.

## 2. Установка WARPSCOUT

Официальный install script upstream:

```bash
curl -fsSL https://raw.githubusercontent.com/vernette/warpscout/master/install.sh | sh
```

По умолчанию на обычном Linux бинарник ставится в:

```text
~/.local/bin/warpscout
```

Для пользователя `root` это:

```text
/root/.local/bin/warpscout
```

Сразу после install script сначала проверьте **сам бинарник по прямому пути**:

```bash
~/.local/bin/warpscout version
```

Если эта команда работает, WARPSCOUT установлен корректно независимо от состояния `PATH`.

Если затем обычная команда:

```bash
warpscout version
```

отвечает `command not found`, проблема только в `PATH`. Добавьте каталог
**в текущую SSH-сессию**:

```bash
export PATH="$HOME/.local/bin:$PATH"
warpscout version
```

Для следующих login-сессий добавьте ту же строку в `~/.profile`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
```

Либо после записи перечитайте профиль в текущем shell:

```bash
. ~/.profile
```

Проверка:

```bash
warpscout version
```

Если `~/.local/bin/warpscout` запускается, а `warpscout` отвечает
`command not found`, установка исправна — проблема только в `PATH`.

Install script умеет обновлять уже установленную версию повторным запуском.

### Проверено на реальном VPS

Проверенный smoke-test от 2026-09-23:

```text
Ubuntu 24.04.5 LTS
x86_64 / amd64
WARPSCOUT 0.16.0
install path для root: /root/.local/bin/warpscout
```

Наблюдавшийся сценарий после установки:

```text
~/.local/bin/warpscout    -> запускается
warpscout version         -> command not found
```

означал именно отсутствие `/root/.local/bin` в текущем `PATH`, а не неудачную
установку WARPSCOUT. После `export PATH="$HOME/.local/bin:$PATH"` команда становится
доступна в той же SSH-сессии.

## 3. Отдельный каталог для аккаунта

`warpscout register` пишет `warpscout-account.json` в **текущую директорию**. Лучше сразу
дать ему постоянное место:

```bash
mkdir -p ~/warpscout-data
chmod 700 ~/warpscout-data
cd ~/warpscout-data
```

Регистрация:

```bash
warpscout register
chmod 600 warpscout-account.json
```

Файл содержит токены и приватные ключи. Не добавляйте его в Git и не пересылайте публично.

### Как открыть warpscout-account.json через nano

Если позже понадобится посмотреть или вручную проверить содержимое файла:

```bash
cd ~/warpscout-data
nano warpscout-account.json
```

Если вы уже находитесь в другой директории, можно открыть его полным путём:

```bash
nano ~/warpscout-data/warpscout-account.json
```

Полезные клавиши `nano`:

- `Ctrl+O` — сохранить файл;
- `Enter` — подтвердить имя файла после `Ctrl+O`;
- `Ctrl+X` — выйти;
- если ничего не меняли, `Ctrl+X` просто закроет редактор;
- если изменения были, `nano` спросит, сохранять ли их.

Для обычной диагностики файл лучше **только просматривать**, а не редактировать вручную:
WARPSCOUT сам управляет account ID, токенами и ключами. Перед копированием содержимого в чат
или тикет обязательно удаляйте `token`, `private_key` и другие секретные значения.

Все следующие команды этой инструкции удобно выполнять из:

```bash
cd ~/warpscout-data
```

---

## 4. Сначала снять baseline с клиента

Перед серверными сканами сначала зафиксируйте, что видит внешний сервис от **реального
клиентского трафика через уже работающий Mihomo на этом VPS**.

1. Подключите клиент к текущему **MASQUE H3**-выходу этого VPS.
2. Откройте в браузере:

   https://www.cloudflare.com/cdn-cgi/trace

3. Сохраните как минимум строки:

```text
ip=
loc=
colo=
warp=
```

4. Переключите клиент на **MASQUE H2** того же VPS.
5. Откройте ту же ссылку ещё раз и сохраните те же поля.

Это даёт исходное сравнение H3/H2 с точки зрения **реального пользовательского трафика**,
до любых изменений на сервере. Поле `colo` показывает Cloudflare PoP, обслуживший этот
HTTP-запрос. Не делайте вывод только по `colo`: рядом сохраняйте `ip`, `loc` и
`warp`.

Если H3 и H2 уже здесь дают разные значения, это важная зацепка для дальнейшей диагностики.
Если значения совпадают, а Gemini ведёт себя по-разному, проблема, вероятно, не сводится
только к очевидной разнице внешнего IP/страны/Cloudflare PoP.

---

## 5. Затем снять baseline самого VPS

До WARP/MASQUE полезно записать, что видно **напрямую с сервера**:

```bash
curl -4s https://www.cloudflare.com/cdn-cgi/trace   | grep -E '^(ip|loc|colo|warp)='
```

Cloudflare официально рекомендует `/cdn-cgi/trace` для определения обслуживающего дата-центра;
поле `colo` — трёхбуквенный IATA-код Cloudflare PoP.

Дополнительно:

```bash
curl -4s https://ifconfig.co/json | jq .
```

Сохраните этот baseline: потом его можно сравнить с H3/H2.

### Проверенное наблюдение: GeoIP-источники могут расходиться

На контрольном VPS при реальном запуске 2026-09-23 один и тот же прямой серверный выход
одновременно дал:

- Cloudflare `/cdn-cgi/trace`: `loc=SE`, `colo=FRA`, `warp=off`;
- `ifconfig.co/json`: страна `DE`.

Это не противоречие в WARPSCOUT: разные сервисы используют разные геолокационные данные.
Поэтому при сравнении H2/H3 нельзя опираться на один GeoIP-источник — сохраняйте рядом
Cloudflare `loc/colo/warp`, внешний IP и независимый GeoIP.

В том же прямом baseline обычный:

```bash
curl -4s https://speed.cloudflare.com/meta | jq .
```

вернул `{}`. Не используйте пустой прямой ответ как доказательство неисправности
WARPSCOUT: сам WARPSCOUT обращается к `speed.cloudflare.com/meta` **через поднятый
тестовый WARP-туннель** в своей фазе проверки и отображает результат как `SEEN AS` /
`NODE`.

---

## 6. Найти WARP / WireGuard endpoint с этого VPS

Обычный WARP:

```bash
warpscout scan -p wg -P
```

Лучший адрес одной строкой:

```bash
warpscout scan -p wg -P -best
```

Сразу получить native-конфиг для нашего Mihomo Builder:

```bash
warpscout scan -p wg -P -conf warp.conf
```

Дальше `warp.conf` можно забрать с VPS и загрузить кнопкой
**«Загрузить .conf / .awg»** в Mihomo Config Builder.

Если обычный WG на конкретной сети сервера режется:

```bash
warpscout scan -p awg -P -gen-i1 quic
```

---

## 7. Найти MASQUE H3 / QUIC с этого VPS

```bash
warpscout scan -p masque -masque-sni 4pda.to
```

Только лучший endpoint:

```bash
warpscout scan -p masque -masque-sni 4pda.to -best
```

Получить Mihomo YAML / MASQUE identity:

```bash
warpscout scan -p masque -masque-sni 4pda.to   -conf - -conf-type mihomo
```

В выводе H3 будет:

```yaml
type: masque
server: ...
port: ...
sni: 4pda.to
private-key: ...
public-key: ...
ip: 172.16.0.2
```

и **не будет** `network: h2`.

YAML можно вставить в первую вкладку `link-generators` и нажать **«Распарсить»**. Текущий
контракт проекта: импортируются MASQUE identity-поля, а transport endpoint/port затем выбирает
наш собственный генератор.

---

## 8. Найти MASQUE H2 / TCP с этого VPS

```bash
warpscout scan -p masque-h2 -masque-sni 4pda.to
```

Лучший endpoint:

```bash
warpscout scan -p masque-h2 -masque-sni 4pda.to -best
```

Mihomo YAML:

```bash
warpscout scan -p masque-h2 -masque-sni 4pda.to   -conf - -conf-type mihomo
```

У H2 в блоке будет:

```yaml
network: h2
```

WARPSCOUT может выбрать `500`, `1701` или `4500`. Это корректный результат его
сканирования, но наш генератор **не обязан наследовать этот порт**. В режиме Safe Ports Only
он использует только:

```text
443, 8443, 4443, 8095
```

Это намеренная anti-DPI стратегия проекта.

---

## 9. Что означают SEEN AS и NODE на VPS

WARPSCOUT во второй фазе поднимает настоящий туннель и запрашивает
`https://speed.cloudflare.com/meta`.

Из ответа он показывает:

- **SEEN AS** — страну WARP-выхода;
- **NODE** — Cloudflare edge node;
- **NODE LOCATION** — расположение этого узла.

Для VPS это особенно полезно: GeoIP самого хостинга и фактический регион WARP могут
отличаться.

Важно для MASQUE: upstream WARPSCOUT указывает, что в одном MASQUE-прогоне все endpoint'ы
выходят через одну ноду; выбор ноды зависит от сети, из которой идёт соединение, а не от
перебора конкретного MASQUE IP. Поэтому «просканировать ещё сто H2 IP» не означает
«получить сто разных colo».

---

# Диагностика уже работающего Mihomo

Следующий раздел нужен, когда WARPSCOUT уже показал картину сети VPS, а надо понять,
**что происходит сейчас в реальном трафике Mihomo**.

Примеры ниже соответствуют обычному output нашего проекта:

- `mixed-port: 7890`;
- `external-controller: 0.0.0.0:9090`;
- основная группа `GLOBAL`;
- controller secret пустой.

Если вы изменили эти значения — подставьте свои.

## 10. Узнать, какой proxy сейчас выбран

На самом VPS:

```bash
curl -s http://127.0.0.1:9090/proxies/GLOBAL | jq '{now, all}'
```

Пример смысла результата:

```json
{
  "now": "WARP-MASQUE-QUIC",
  "all": [
    "WARP-MASQUE-QUIC",
    "WARP-MASQUE-H2-443",
    "REJECT"
  ]
}
```

Если у controller настроен `secret`, к запросам API добавьте:

```bash
-H "Authorization: Bearer YOUR_SECRET"
```

## 11. Проверить текущий выход через Mihomo

Запрос обязательно отправляем **через mixed-port**, а не напрямую:

```bash
curl -x socks5h://127.0.0.1:7890 -s   https://www.cloudflare.com/cdn-cgi/trace   | grep -E '^(ip|loc|colo|warp)='
```

Для WARP-трафика поле:

```text
warp=on
```

является полезной проверкой, что запрос действительно видится Cloudflare как WARP.

Полный ответ Cloudflare meta:

```bash
curl -x socks5h://127.0.0.1:7890 -s   https://speed.cloudflare.com/meta | jq .
```

Независимая проверка внешнего адреса:

```bash
curl -x socks5h://127.0.0.1:7890 -s   https://ifconfig.co/json | jq .
```

### Не смешивать NODE и colo без проверки

- `NODE` WARPSCOUT приходит из `speed.cloudflare.com/meta` внутри проверяемого WARP-туннеля.
- `colo=` в `/cdn-cgi/trace` означает Cloudflare дата-центр, обслуживший именно этот HTTP-запрос.

Они связаны с маршрутом через Cloudflare, но в диагностике лучше записывать оба значения,
а не считать их автоматически одним и тем же измерением.

---

## 12. Сравнить текущие H3 и H2 один к одному

Сначала получите точные имена:

```bash
curl -s http://127.0.0.1:9090/proxies/GLOBAL | jq -r '.all[]'
```

### Выбрать H3

Подставьте реальное имя H3 из списка:

```bash
curl -s -X PUT   -H 'Content-Type: application/json'   -d '{"name":"WARP-MASQUE-QUIC"}'   http://127.0.0.1:9090/proxies/GLOBAL
```

После переключения:

```bash
curl -x socks5h://127.0.0.1:7890 -s   https://www.cloudflare.com/cdn-cgi/trace   | grep -E '^(ip|loc|colo|warp)='

curl -x socks5h://127.0.0.1:7890 -s   https://speed.cloudflare.com/meta | jq .
```

Запишите результат.

### Выбрать H2

Имя H2 зависит от сгенерированного порта, например:

```text
WARP-MASQUE-H2-443
```

Переключение:

```bash
curl -s -X PUT   -H 'Content-Type: application/json'   -d '{"name":"WARP-MASQUE-H2-443"}'   http://127.0.0.1:9090/proxies/GLOBAL
```

И снова те же две проверки:

```bash
curl -x socks5h://127.0.0.1:7890 -s   https://www.cloudflare.com/cdn-cgi/trace   | grep -E '^(ip|loc|colo|warp)='

curl -x socks5h://127.0.0.1:7890 -s   https://speed.cloudflare.com/meta | jq .
```

Так получается честное сравнение H3 vs H2 на одном VPS.

---

## 13. Проверка проблемы с Gemini

Сам факт «Gemini ругается на H2, но не на H3» ещё не доказывает причину. Сначала для обоих
маршрутов надо записать одинаковый набор данных:

```text
transport
имя proxy в Mihomo
endpoint из config.yaml
Cloudflare trace: ip / loc / colo / warp
speed.cloudflare.com/meta
ifconfig.co
результат Gemini
время проверки
```

Быстрый HTTP-smoke test:

```bash
curl -x socks5h://127.0.0.1:7890 -sS -L   -o /dev/null   -w 'HTTP=%{http_code} FINAL=%{url_effective}\n'   https://gemini.google.com/
```

Это **не заменяет проверку Gemini в браузере**: приложение зависит от JavaScript, cookies и
Google account state. Но HTTP status/redirect полезно сохранить рядом с сетевой диагностикой.

### Как интерпретировать сравнение

Если H2 и H3 дают **разные** `ip`, `loc`, `colo` или Cloudflare meta, сначала надо
расследовать различие выхода/маршрута/геолокации.

Если сетевые признаки совпадают, но Gemini стабильно ведёт себя по-разному, это уже основание
искать различие выше простого GeoIP — например в конкретном пути/транспорте или репутации
соединения. Это гипотеза для следующей проверки, а не доказательство причины.

Не делайте вывод «H2 плохой» по одному тесту: повторите H3 → H2 → H3 и сравните результаты.

---

## 14. Проверить endpoint WARPSCOUT без Mihomo

Это полезно, чтобы разделить:

```text
WARPSCOUT / Cloudflare endpoint
            vs
наш config / Mihomo / selector
```

Сначала получите endpoint:

```bash
warpscout scan -p masque-h2 -masque-sni 4pda.to -best
```

Затем поднимите временный SOCKS непосредственно через него:

```bash
warpscout socks -e IP:PORT -p masque-h2 -masque-sni 4pda.to
```

WARPSCOUT слушает локально `socks5h://127.0.0.1:1080`.

В другом SSH-сеансе:

```bash
curl -x socks5h://127.0.0.1:1080 -s   https://www.cloudflare.com/cdn-cgi/trace   | grep -E '^(ip|loc|colo|warp)='
```

Для H3 аналогично:

```bash
warpscout scan -p masque -masque-sni 4pda.to -best
warpscout socks -e IP:PORT -p masque -masque-sni 4pda.to
```

Команда `warpscout socks` предназначена upstream'ом именно для диагностики, а не как
постоянный production proxy.

---

## Live-наблюдения 2026-09-23

Эти результаты — диагностические точки, а не универсальные нормы Cloudflare.

### SE2

- WG scan: 70/70 рабочих; лучшие маршруты шли через `ARN` с примерно 1 ms TUN ping и 0% loss.
- Лучший отдельный WG endpoint в одном из прогонов: `188.114.97.165:2408`, `NODE=ARN`, `SEEN AS=SE`.
- MASQUE H3 с `SNI=4pda.to`: 2/14 рабочих.
- MASQUE H2 с тем же SNI: 70/70 рабочих.
- Реальный клиент при переключении WARP WG / MASQUE H2 / MASQUE H3 в тот момент получил
  одинаковый Cloudflare exit: `104.28.225.221`, `loc=SE`, `colo=FRA`, `warp=on`.
- Gemini в момент проверки работал во всех трёх режимах, поэтому транспортную причину
  предыдущего сбоя установить не удалось. Такой тест надо повторять именно во время сбоя.

### EE / Ubuntu 24.04

До установки WARPSCOUT production Mihomo уже дал полезное независимое наблюдение:
`WARP-MASQUE-QUIC` логировал `H3_REQUEST_CANCELLED`/closed network connection,
`Fastest_MASQUE` неоднократно активировал health-check и в момент аудита выбрал H2.
Это прямое evidence текущего production path, но WARPSCOUT scan с отдельным свежим
аккаунтом всё равно нужен для сравнения доступности endpoint'ов H3/H2/WG из сети EE VPS.

Не смешивайте эти уровни доказательств: WARPSCOUT измеряет отдельный тестовый WARP account
и набор endpoint'ов; production Mihomo измеряет текущую конфигурацию пользователя.

---

## 15. Быстрый чек-лист для каждого VPS

```bash
cd ~/warpscout-data

# 0. Прямой VPS baseline
curl -4s https://www.cloudflare.com/cdn-cgi/trace | grep -E '^(ip|loc|colo|warp)='

# 1. WARP / WireGuard
warpscout scan -p wg -P -best

# 2. MASQUE H3
warpscout scan -p masque -masque-sni 4pda.to -best
warpscout scan -p masque -masque-sni 4pda.to -conf - -conf-type mihomo

# 3. MASQUE H2
warpscout scan -p masque-h2 -masque-sni 4pda.to -best
warpscout scan -p masque-h2 -masque-sni 4pda.to -conf - -conf-type mihomo

# 4. Что выбрано сейчас в Mihomo
curl -s http://127.0.0.1:9090/proxies/GLOBAL | jq '{now, all}'

# 5. Фактический выход через Mihomo
curl -x socks5h://127.0.0.1:7890 -s   https://www.cloudflare.com/cdn-cgi/trace   | grep -E '^(ip|loc|colo|warp)='
```

С таким набором уже можно сравнивать разные VPS между собой и отдельно H2/H3 на одном сервере,
не восстанавливая команды по памяти.

## См. также

- [WARPSCOUT на Windows](WARPSCOUT-WINDOWS.md)
- [WARPSCOUT upstream README_RU](https://github.com/vernette/warpscout/blob/master/README_RU.md)
- [Как работает WARPSCOUT](https://github.com/vernette/warpscout/blob/master/docs/ru/how-it-works.md)
- [WARPSCOUT: MASQUE](https://github.com/vernette/warpscout/blob/master/docs/ru/masque.md)
- [WARPSCOUT: SOCKS5 для диагностики](https://github.com/vernette/warpscout/blob/master/docs/ru/socks.md)
- [Cloudflare: /cdn-cgi/ endpoint](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/)

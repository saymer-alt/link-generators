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

## 0. Полевой контракт: node/colo — наблюдаемое состояние (Sep–Oct 2026)

Все полевые наблюдения в этой и соседних WARPSCOUT-инструкциях относятся к
**сентябрю–октябрю 2026** (конкретные даты указаны в разделах). Это наблюдаемые состояния,
а не характеристики, которые можно один раз измерить и записать навсегда.

Главный контракт, который надо держать в голове:

- **Cloudflare node / colo — это наблюдаемое текущее состояние маршрута, а не постоянное
  свойство найденного IP:port или VPS.** Anycast-маршрут определяется BGP/peering
  провайдера и traffic-engineering Cloudflare, поэтому без смены endpoint'а, IP или самого
  сервера «вчера FRA, сегодня ARN» — нормальная реальность (подтверждённый полевой дрифт —
  в разделе 15).
- **Три уровня «работает» не надо смешивать:**
  1. *reachable* — endpoint отвечает (handshake проходит);
  2. *tunnel works* — через endpoint поднимается туннель и передаёт данные;
  3. *exit colo подходит сервису* — фактический Cloudflare path/colo устраивает целевой
     сервис (например Gemini).
  Рабочий туннель автоматически не означает подходящий выход, и наоборот.
- **Не хардкодьте чужие endpoint'ы.** Endpoint'ы в примерах этой документации — исторические
  наблюдения конкретных сканов, а не рекомендации и не «вечные хорошие» адреса. Свои рабочие
  endpoint'ы ищутся сканом в своей сети и перепроверяются по триггерам из раздела 15.
- Идея на будущее (не реализовано): автоматическая периодическая revalidation colo
  (cron-скан + запись NODE в лог). Сейчас перепроверка — ручная операция.

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

Повторные команды WARPSCOUT будут сообщать
`Using cached WARP account from warpscout-account.json` — это **нормальное поведение**:
аккаунт регистрируется один раз и переиспользуется; повторный `register` перед каждым
сканом не нужен.

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

Про `-gen-i1 quic`: это смена «первого пакета» AWG-маскировки на QUIC-подобный —
актуальный способ прохода через сети, где plain WireGuard режется. Upstream
поддерживает и другие варианты (`dns`, `sip`, `stun`, `random`); в наших полевых
наблюдениях Sep–Oct 2026 рабочим выбором был именно `quic`.

О времени: полный `-P`-скан в наших наблюдениях занимал порядка **15–20 минут**
на VPS. Upstream обещает «пару минут» только для базового скана без `-P`; точное
время зависит от сети, `-jt` и протокола и **не гарантируется** — закладывайте
запас и не прерывайте скан на полпути.

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

YAML можно вставить во вкладку **WARP MASQUE Links** и нажать **«Распарсить»**. Текущий
контракт проекта: импортируются MASQUE identity-поля, а transport endpoint/port затем выбирает
наш собственный генератор. После импорта и Build проверьте **фактический** node/colo выхода
через `/cdn-cgi/trace` и `speed.cloudflare.com/meta` (раздел 11): импорт переносит identity,
но не задаёт и не гарантирует конкретный Cloudflare path.

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

Как читать остальные поля и сообщения вывода:

- **Working / torn down** — endpoint поднял тестовый туннель и передал данные / туннель
  был разорван на середине; при `-P` torn-down endpoint'ы отфильтровываются и не участвуют
  в выборе лучшего;
- **Best** (`-best`) — один лучший адрес `ip:port` одной строкой, выбирается по TUN ping/loss;
  `-exclude-node`/`-exclude-country` (и `-node`/`-country`) применяются **до** выбора лучшего:
  фильтры сужают выборку, из которой `-best` берёт результат;
- **Junk/маскировка** — для AWG WARPSCOUT подбирает маскировочные параметры, проходящие
  фильтр (отдельная upstream-команда `find-junk`);
- `no endpoint landed on node X` и `every endpoint was excluded by node X` — **не ошибки
  программы**, а честный ответ скана: в текущем маршруте такие node не видны. Troubleshooting
  и триггеры перепроверки — в разделе 15.

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

### Gemini validation workflow

Проверка «работает ли Gemini через этот маршрут» — это четыре шага, а не только запрос
к GeoIP-базе:

```text
1. endpoint: какой endpoint/transport выбран в Mihomo сейчас (раздел 10);
2. tunnel: поднимается ли туннель и передаёт ли данные (curl через :7890, health-check);
3. exit/colo: /cdn-cgi/trace + speed.cloudflare.com/meta — ip / loc / colo / warp (+ NODE);
4. Gemini: реальное поведение в браузере под своим account state.
```

Полевое наблюдение (SE2, 2026-09-24, детали в live-наблюдениях ниже): при одинаковом
`ip=104.28.225.221`, `loc=SE`, `warp=on` рабочий вариант давал `colo=FRA`, проблемный —
`colo=ARN`. Отсюда **field observation, не гарантия**: для Gemini-sensitive задач на этих
VPS `FRA` — желательный colo, `ARN` — нежелательный; пока фактический colo нежелателен,
практический ответ — подбор endpoint с `-exclude-node ARN` (раздел 15). Состав
«желательных/нежелательных» colo сам подвержен дрифту — перепроверяйте на своём маршруте.
Сводка политик по всем окружениям (VPS vs дача GSM vs дача провод) — в
[WARPSCOUT-KEENETIC.md](WARPSCOUT-KEENETIC.md); политики разных окружений не смешивать.

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

Затем на этом же VPS был зарегистрирован свежий WARPSCOUT 0.16.0 account и выполнены
сканы из сети самого сервера:

- WG: **68/70 working**, 1 torn down; все наблюдаемые ноды `ARN`, `SEEN AS=EE`,
  TUN ping около 7-8 ms;
- `warpscout scan -p wg -P -best` в одном прогоне выбрал
  `8.34.146.127:2408`, TUN ping 7 ms, loss 0%;
- MASQUE H3 с `SNI=4pda.to`: **8/14 working**, 2 torn down, `ARN / EE`,
  TUN ping около 7-8 ms;
- MASQUE H2 с тем же SNI: **56/70 working**, 3 torn down, `ARN / EE`,
  TUN ping около 7 ms.

В этом конкретном прогоне H2 снова оказался доступнее H3, но уже не был «идеальным»:
80% рабочих против примерно 57% у H3; WG был самым доступным (~97%). Это заметно мягче
SE2, где H3 был 2/14, а H2 70/70. Значит, практический вывод пока такой: разница H2/H3
зависит от конкретного VPS/маршрута и момента времени, хотя на обоих проверенных VPS H2
показал более высокий working ratio.

Не смешивайте уровни доказательств: WARPSCOUT измеряет отдельный тестовый WARP account
и набор endpoint'ов; production Mihomo измеряет текущую пользовательскую конфигурацию.
Совпадение направления результатов усиливает наблюдение, но не превращает его в доказательство
универсальной неисправности H3.


### SE2 — воспроизведение Gemini 2026-09-24

Во время повторного теста удалось воспроизвести различие, которое днём ранее поймать не удалось.

При одном и том же видимом WARP exit-IP `104.28.225.221` и `loc=SE` поведение Gemini
менялось вместе с Cloudflare path / colo:

- MASQUE H2 — Gemini работал;
- MASQUE H3 — Gemini работал, Cloudflare trace показывал `colo=FRA`;
- обычный WARP/WG — Gemini не работал, Cloudflare trace показывал `colo=ARN`.

Для H3 и обычного WARP при этом совпадали как минимум:

```text
ip=104.28.225.221
loc=SE
warp=on
```

но отличался `colo`: рабочий вариант давал `FRA`, проблемный — `ARN`.

Это не доказывает, что сам по себе `ARN` «ломает Gemini», но показывает важную вещь:
проблема в этом наблюдении не сводилась к одному только внешнему IP или стране GeoIP.
Cloudflare path / edge selection оказался значимой диагностической переменной.

Практический обход для обычного WARP/WG — исключить проблемный node при подборе endpoint:

```bash
warpscout scan -p wg -P \
  -exclude-node ARN \
  -best
```

После выбора другого WARP endpoint/node Gemini снова заработал.

Для контрольного сравнения без каких-либо node-фильтров используйте обычный поиск лучшего
WG endpoint:

```bash
warpscout scan -p wg -P -best
```

Важно: `-exclude-node` применим к WG/AWG-поиску. Для MASQUE H2/H3 выбор Cloudflare node
не управляется перебором endpoint'ов тем же способом, поэтому этот фильтр не является
универсальным способом «переключить colo» для MASQUE.

### Moscow VPS — MASQUE caveat (Sep–Oct 2026)

Отдельное наблюдение на московском VPS: MASQUE QUIC (H3) не передал данные ни на одном
endpoint — несколько полных прогонов завершались upstream-сообщением
`no MASQUE endpoint passed data - this network blocks it, try -p awg`; H2-сессии на
большинстве endpoint'ов обрывались mid-stream. Это наблюдение конкретной сети и момента,
а не доказательство «MASQUE сломан глобально»: на SE-VPS в тот же период H3 работал
(пусть и с низкой долей рабочих endpoint'ов), H2 — с подходящим SNI; на дачных
Keenetic-профилях картина была совсем другой
([WARPSCOUT-KEENETIC.md](WARPSCOUT-KEENETIC.md)). Общий вывод полевых наблюдений
Sep–Oct 2026: **в наших ISP/маршрутных сценариях WG/AWG обычно доступнее MASQUE** —
но это наблюдение, а не абсолют: на других uplink'ах MASQUE может быть единственным
рабочим транспортом.


---


## 15. Обязательный acceptance-тест нового VPS: Cloudflare node / colo

Для нового VPS недостаточно проверить только ping, bandwidth и доступность WARP endpoint'ов.
До ввода сервера в постоянную эксплуатацию обязательно зафиксируйте, к какому Cloudflare
node / colo реально приходит трафик.

Cloudflare использует Anycast: один и тот же IP объявляется из множества дата-центров, а
конкретный путь определяется BGP/peering-маршрутом провайдера, текущей доступностью и
traffic-engineering Cloudflare. Поэтому физически близкий дата-центр не гарантирован, а
смена конкретного WARP endpoint IP/порта может вообще не изменить node.

Минимальный acceptance-набор:

```bash
# 1. Лучший WG без фильтров
warpscout scan -p wg -P -best

# 2. Полный WG scan: какие nodes вообще доступны
warpscout scan -p wg -P

# 3. Проверка, существует ли альтернатива проблемному node
warpscout scan -p wg -P \
  -exclude-node ARN \
  -best

# 4. MASQUE H3
warpscout scan -p masque -P \
  -masque-sni 4pda.to \
  -best

# 5. MASQUE H2
warpscout scan -p masque-h2 -P \
  -masque-sni 4pda.to \
  -best

# 6. Реальный production-выход через Mihomo
curl -x socks5h://127.0.0.1:7890 -s \
  https://www.cloudflare.com/cdn-cgi/trace \
  | grep -E '^(ip|loc|colo|warp)='
```

Записывайте как минимум:

```text
VPS/provider/location
public VPS IP
transport: WG / MASQUE H3 / MASQUE H2
endpoint
SEEN AS
NODE / NODE LOCATION
Cloudflare trace: ip / loc / colo / warp
Gemini: OK / FAIL
timestamp
```

### Практическое правило

Если все WG endpoint'ы сходятся в один node и `-exclude-node <NODE>` отвечает
`every endpoint was excluded`, не надо бесконечно перебирать IP/порты: в текущем
маршруте VPS альтернативного Cloudflare node не видно.

В таком случае возможны только внешние изменения маршрута: другой VPS/провайдер/ASN/локация,
изменение peering/BGP у провайдера или изменение traffic-engineering Cloudflare. Иногда
маршрут может поменяться сам со временем, поэтому node нельзя считать вечным свойством VPS,
но при покупке/приёмке нового сервера его нужно считать важной характеристикой текущего
сетевого пути.

Отдельно проверяйте WG, H3 и H2: transport'ы могут попасть в один и тот же node, а могут
повести себя по-разному. Один хороший WG endpoint ещё не доказывает, что H2/H3 будут иметь
тот же Cloudflare path.

### Подтверждённый routing drift: FRA → ARN, 2026-09-30

На ранее проверенной сети VPS, где до этого удавалось получать `FRA`, 2026-09-30 повторная
проверка показала, что `FRA` перестал находиться, а доступные WG/AWG-маршруты сходятся в `ARN`.
Контрольный прогон на `Saymer2` дал:

```text
warpscout scan -p wg -P -node FRA
→ no endpoint landed on node FRA

warpscout scan -p wg -P -node FRA -n 20
→ no endpoint landed on node FRA

warpscout scan -p awg -P -exclude-node ARN -gen-i1 quic
→ every endpoint was excluded by node ARN
```

По сообщению хостера, Cloudflare к этому моменту также перестал выдавать его сети `FRA`.
Это согласуется с измерениями WARPSCOUT, но само сообщение хостера фиксируется как отдельный
источник наблюдения, а не как замена собственным тестам.

Практический вывод: ранее подтверждённый `FRA` **не является постоянным свойством VPS**.
Без смены конфигурации, IP-адреса или самого сервера текущий сетевой путь может измениться так,
что прежний node исчезнет из доступной выборки. Поэтому Cloudflare node надо проверять не только
при покупке/приёмке VPS, но и периодически в эксплуатации, а также при внезапном изменении
поведения сервисов вроде Gemini.

Для быстрой повторной проверки целевого `FRA` и отсутствия альтернативы `ARN`:

```bash
warpscout scan -p wg -P -node FRA -n 20
warpscout scan -p awg -P -exclude-node ARN -gen-i1 quic
```

Если первый тест снова не находит `FRA`, а второй отвечает
`every endpoint was excluded by node ARN`, дальнейший перебор обычных endpoint IP/портов
не следует считать способом «вернуть FRA»: сначала ждите изменения внешней маршрутизации
или проверяйте другой VPS/провайдера/ASN/локацию.

`no endpoint landed on node FRA` — **не ошибка программы**: скан честно сообщает, что ни
один проверенный endpoint не попал в запрошенный node. Что можно сделать:

1. повторить скан позже — дрифт двусторонний, маршрут может вернуться сам;
2. сменить протокол: `-p awg` вместо `-p wg` (и наоборот);
3. расширить выборку: `-n 20` на прогон или `-f` (полный перебор подсети, заметно дольше);
4. смягчить фильтр: убрать `-node`/`-exclude-country`, сделать обычный `-best` и смотреть
   фактический NODE в полном выводе;
5. проверить внешние изменения: смена peering у провайдера, новый публичный IP/маршрут,
   другой VPS/ASN/локация.

### Rescan triggers: когда перепроверять node/colo

Node/colo перепроверяют не только при приёмке VPS, но и в эксплуатации:

- изменилось поведение сервисов (Gemini стал недоступен или ругаться);
- фактический colo сменился в `/cdn-cgi/trace` или `speed.cloudflare.com/meta`;
- заметно упала скорость или вырос loss без локальных причин;
- сменился провайдер/ASN/публичный IP у VPS;
- прошло много времени с последней проверки: полевые наблюдения Sep–Oct 2026 показывают
  смену node за дни без каких-либо изменений конфигурации.

Штатный обходной путь без смены серверной архитектуры — `dialer-proxy` Mihomo (секция «dialer-proxy»
в [MIHOMO.md](MIHOMO.md)): WARP остаётся outbound текущего Mihomo, но его туннельное UDP-соединение
устанавливается через промежуточный VPS другой сети. Полевой чек-лист:

```text
1. На SE-VPS: Mihomo с WARP (.conf, MTU 1200-1280) + dialer-proxy на proxy до DK/другой сети.
2. curl -x socks5h://127.0.0.1:7890 https://www.cloudflare.com/cdn-cgi/trace  → baseline (ожид. ARN).
3. Переключить узел в dialer-группе (дашборд/API) на DK-VPS → повторить trace.
4. Зафиксировать ip/loc/colo/warp/NODE для: WARP direct vs WARP через dialer.
5. Цель: direct → ARN, dialer via другой сети → FRA (или иная нода).
```

Автоматизирует эту методику harness `tools/warp-dialer-fieldtest/` (sweep узлов, switchtest, MTU-лестница, JSON/CSV-отчёты); инструкция и ловушка PIN — его README.

Field-test конфиг для provider-варианта (Geodema как промежуточная сеть; BUILDER сам создаёт группу `WARP-DIALER` с `use:`, если в поле «URL-подписки для dialer-группы» указан тот же URL подписки, а WARP загружен .conf с MTU 1200–1280):

```yaml
proxy-groups:
  - name: WARP-DIALER
    type: select
    use:
      - account.geodema.org
proxies:
  - name: WARP
    type: wireguard
    # ...identity из .conf...
    mtu: 1280
    dialer-proxy: WARP-DIALER
```

Протокол сравнения (все три состояния, подряд, без смены машины):

```text
A. WARP direct (поле dialer пусто):            curl -x socks5h://127.0.0.1:7890 https://www.cloudflare.com/cdn-cgi/trace
B. WARP + dialer на Geodema (узел по умолчанию): та же команда после Build с заполненным полем
C. В MetaCubeXD вручную перебирать узлы в WARP-DIALER (только те, что живут как UDP relay),
   после каждого выбора повторять trace и speed.cloudflare.com/meta
Фиксировать: ip / loc / colo / warp / NODE для A, B, C; ожидание: A → ARN (текущий дрифт),
B/C → colo меняется вместе с сетью выбранного узла; warp=on во всех состояниях.
Узлы подписки, не передающие UDP, дадут таймаут WARP-хендшейка — такие узлы исключать из выбора.
```

Дополнительный сценарий — **WARP-over-WARP** (второй independent WARP-профиль как транзит): в Builder загрузите оба .conf (разные ключи/endpoint/tunnel IP), в поле dialer укажите имя внутреннего профиля (например `WARP-INNER`) — внешний получит `dialer-proxy: WARP-INNER`. Цепочки через группы/провайдеры также валидны; генератор и валидатор отклоняют только маршруты, замыкающиеся на исходный outbound. Сравнить trace: WARP direct / WARP-over-WARP / provider-backed WARP.


## 16. Быстрый чек-лист для каждого VPS

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

- [WARPSCOUT на Keenetic / Entware](WARPSCOUT-KEENETIC.md) — полевые кейсы дачных роутеров и сводная таблица политик по окружениям
- [WARPSCOUT на Windows](WARPSCOUT-WINDOWS.md)
- [WARPSCOUT upstream README_RU](https://github.com/vernette/warpscout/blob/master/README_RU.md)
- [Как работает WARPSCOUT](https://github.com/vernette/warpscout/blob/master/docs/ru/how-it-works.md)
- [WARPSCOUT: MASQUE](https://github.com/vernette/warpscout/blob/master/docs/ru/masque.md)
- [WARPSCOUT: SOCKS5 для диагностики](https://github.com/vernette/warpscout/blob/master/docs/ru/socks.md)
- [Cloudflare: /cdn-cgi/ endpoint](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/)

# WARPSCOUT на VPS: установка и поиск лучших WARP WG / MASQUE H3 / H2 endpoint'ов

> **Для кого:** новый пользователь VPS с Ubuntu 24.04 или Debian 12, который хочет подключиться по SSH, установить WARPSCOUT и **за один последовательный проход получить список рабочих endpoint'ов WireGuard WARP, MASQUE H3 (QUIC) и MASQUE H2 (TCP), их задержки, потери и Cloudflare NODE / colo**.
>
> На VPS обычно начинаем с **обычного WG**, поскольку, в отличие от некоторых российских домашних сетей, на многих хостингах он работает без маскировки. Для MASQUE сначала используем **штатный SNI**, без выдуманных обязательных обходов. **Никаких фильтров по RU, DME или ARN по умолчанию:** VPS может находиться в любой стране, а задача первого прогона — увидеть действительную картину сети.

**Основной путь:** 1. SSH и зависимости → 2. установка → 3. WARP account → 4. WG → 5. MASQUE H3 → 6. MASQUE H2 → 7. чтение отчётов и итоговая таблица. Дальнейшие разделы — **по желанию**. Не нужно использовать Mihomo, менять маршруты, устанавливать AWG или запускать `find-sni`, если три основных скана уже проходят.

## 0. Перед началом: важные отличия VPS от Keenetic

- Команды ниже вводятся **на самом VPS**, в Linux SSH. Рассчитаны на **root**. Если вошли обычным пользователем с правом sudo, один раз выполните `sudo -i` и продолжайте уже в root-сессии. **Не меняйте пользователя посередине:** аккаунт WARPSCOUT хранится в текущем каталоге.
- Нужны доступ в интернет и свободное место для небольших отчётов. Примеры проверены по синтаксису WARPSCOUT 0.16.0 и документации upstream; точные результаты зависят от сети VPS.
- **WARPSCOUT — сканер, не VPN-маршрутизатор.** Он самостоятельно тестирует WARP и не должен менять настройки существующего Mihomo/Xray. Если на хосте глобальная TUN/policy-routing уже перехватывает **весь трафик самого VPS**, результаты могут отражать этот перехват, а не прямой канал хостера.
- **NODE / NODE LOCATION** — узел Cloudflare, наблюдавшийся внутри WARP-туннеля; **SEEN AS** — наблюдаемая страна выхода. Они могут отличаться от страны VPS и друг от друга. Узел может измениться со временем.
- Никогда не публикуйте `warpscout-account.json`, `warp-wg.conf`, `warp-h2.yaml`, `warp-h3.yaml`: в конфигурациях есть **приватные ключи**.

## 1. Подключиться по SSH и установить зависимости

Войдите на VPS своим обычным SSH-клиентом. Для дальнейших команд нужна root-сессия:

~~~bash
whoami
~~~

Если результат `root`, продолжайте. Если нет, выполните:

~~~bash
sudo -i
~~~

Обновите список пакетов и установите нужное:

~~~bash
apt-get update && apt-get install -y curl ca-certificates tar jq
~~~

Если команда установки пакетов завершилась ошибкой — сначала устраните её, иначе следующие шаги могут не сработать. `jq` пригодится для последующей диагностики JSON.

## 2. Установить WARPSCOUT и проверить запуск

Выполните **одну** команду установки из официального `vernette/warpscout`:

~~~bash
INSTALL_DIR=/usr/local/bin sh -c "$(curl -fsSL https://raw.githubusercontent.com/vernette/warpscout/master/install.sh)"
~~~

Здесь **явно задан путь `/usr/local/bin`**, поэтому на обычном VPS команда `warpscout` доступна сразу — без `export PATH`, настройки `~/.profile` и поиска `~/.local/bin`. Установщик скачивает подходящий Linux AMD64/ARM64 release. Как и перед запуском любого удалённого установщика, источник кода должен вызывать у вас доверие.

Проверка:

~~~bash
warpscout version
~~~

Если отображается версия (например, `0.16.0`), установка завершена. Если получаете `command not found`, проверьте бинарник напрямую:

~~~bash
/usr/local/bin/warpscout version
~~~

Если напрямую работает, проверьте системный `PATH` этой shell-сессии и продолжайте с `/usr/local/bin/warpscout`. **Не устанавливайте WARPSCOUT повторно только из-за PATH.**

## 3. Подготовить каталог, один раз зарегистрировать WARP

Создайте каталог и перейдите в него. **Все дальнейшие команды выполняются из него**:

~~~bash
mkdir -p /root/warpscout-data && chmod 700 /root/warpscout-data && cd /root/warpscout-data && umask 077
~~~

Проверьте, есть ли уже аккаунт (при первом запуске его, скорее всего, не будет):

~~~bash
ls -lh warpscout-account.json
~~~

Если файла нет, зарегистрируйте аккаунт:

~~~bash
warpscout register
~~~

После успеха:

~~~bash
chmod 600 warpscout-account.json && ls -lh warpscout-account.json
~~~

Файл `warpscout-account.json` — **данные аккаунта, не команда**. Не открывайте его в публичных логах и не выкладывайте на GitHub. Если файл уже существует и WARPSCOUT его использует, `register` **повторно не требуется**. Сообщение `Using cached WARP account from warpscout-account.json` при скане — нормальное.

При каждом новом SSH-подключении возвращайтесь в каталог:

~~~bash
cd /root/warpscout-data && umask 077
~~~

**Теперь всё готово для трёх основных сканов.**

## 4. Основной скан №1 — обычный WARP / WireGuard (WG)

**Первым делом найдём список лучших WG endpoint'ов с этого VPS. Фильтры стран и узлов не нужны.**

~~~bash
warpscout scan -p wg -P -jt 10 -o wg-report.txt -conf warp-wg.conf
~~~

Что происходит:

- `-p wg` — чистый WireGuard WARP, **не** AWG и **не** MASQUE;
- `-P` — полноценная проверка туннеля с `TUN PING` и `LOSS`, а не только доступности UDP-порта;
- `-jt 10` — явно задаём десять параллельных проверок; если VPS перегружен, снизьте до `4`;
- `-o wg-report.txt` — сохранит **список всех рабочих endpoint'ов** и лучшие варианты по узлам/подсетям;
- `-conf warp-wg.conf` — **в этом же скане** запишет нативный WG-конфиг лучшего кандидата.

После скана обязательно смотрите итоговую таблицу: `Working`, `Torn down`, `TUN PING`, `LOSS`, `SEEN AS`, `NODE`, `NODE LOCATION`. Низкий `ENDPOINT PING` сам по себе не значит, что туннель работает.

Проверьте, что оба файла появились:

~~~bash
ls -lh wg-report.txt warp-wg.conf
~~~

Посмотреть **только** адрес выбранного WG endpoint'а (без ключа):

~~~bash
grep -i '^Endpoint[[:space:]]*=' warp-wg.conf
~~~

**Не надо отдельно запускать `scan -best` и `scan -conf`** — это повторные независимые сканы, в которых выбор может измениться. Один законченный прогон уже создал и список, и конфиг.

## 5. Основной скан №2 — MASQUE H3 / QUIC

Для стандартного VPS сначала используем **обычный MASQUE H3 с SNI по умолчанию**. Не копируем SNI `4pda.to` из старых полевых испытаний как обязательное значение.

~~~bash
warpscout scan -p masque -P -jt 10 -o h3-report.txt -conf warp-h3.yaml -conf-type mihomo
~~~

- `-p masque` — **H3 / QUIC**;
- `-P` — проверка передачи данных, задержки и потерь внутри H3-туннеля;
- `-o h3-report.txt` — подробный список протестированных MASQUE H3 endpoint'ов;
- `-conf warp-h3.yaml -conf-type mihomo` — готовый блок `proxies:` для Mihomo (с приватным ключом), полученный из **того же прогона**.

После успеха:

~~~bash
ls -lh h3-report.txt warp-h3.yaml
~~~

В конечном выводе обратите внимание на `Working`, `Torn down`, `NODE` и `NODE LOCATION`. Для H3 у WARPSCOUT небольшое фиксированное множество anycast endpoint'ов; не нужно пытаться искать «новый colo» бесконечным перебором IP.

**Если H3 не передал данные,** переходите к разделу 9: можно подобрать другой SNI. Но успешный H3 не требует `find-sni`.

## 6. Основной скан №3 — MASQUE H2 / TCP

H2 — отдельный транспорт Cloudflare через TCP. Проверяйте его **отдельно от H3**:

~~~bash
warpscout scan -p masque-h2 -P -jt 10 -o h2-report.txt -conf warp-h2.yaml -conf-type mihomo
~~~

- `-p masque-h2` — **H2 / TCP**;
- `-P` — проверка реальной передачи данных внутри H2;
- `-o h2-report.txt` — результат скана H2, независимо от H3;
- `-conf warp-h2.yaml -conf-type mihomo` — YAML для Mihomo. У H2 будет `network: h2`.

После успеха:

~~~bash
ls -lh h2-report.txt warp-h2.yaml
~~~

Обычный H2 в WARPSCOUT может находить порт `500`, `1701` или `4500` и другие рабочие порты. Это **наблюдаемый результат сканера**, а не ошибка. В link-generators встроенная стратегия H2 Safe Ports Only (`443, 8443, 4443, 8095`) применяется **только когда нет импортированного точного endpoint'а**; импорт `type: masque` сохраняет выбранный WARPSCOUT `server:port` в Advanced MASQUE.

**Для MASQUE H2 и H3 фильтры `-node`, `-country`, `-exclude-node` и `-exclude-country` не применяются**: по документации WARPSCOUT выбор node в MASQUE определяется текущим маршрутом сети, а не подбором отдельного IP. Даже если VPS размещён в Европе, заранее заказывать конкретный `FRA` или `ARN` здесь нельзя.

## 7. Что получилось: пять-семь минут на осмысленный разбор результатов

Все три сканирования закончились успешно? Теперь можно **не выполнять дополнительных сканов**. На сервере должны быть:

| Транспорт | Список результатов | Готовая конфигурация |
|---|---|---|
| WARP WG | `wg-report.txt` | `warp-wg.conf` |
| MASQUE H3 / QUIC | `h3-report.txt` | `warp-h3.yaml` |
| MASQUE H2 / TCP | `h2-report.txt` | `warp-h2.yaml` |

Проверить названия и размеры:

~~~bash
ls -lh wg-report.txt h3-report.txt h2-report.txt warp-wg.conf warp-h3.yaml warp-h2.yaml
~~~

Быстро прочитать **отчёты, а не файлы с приватными ключами**:

~~~bash
head -n 35 wg-report.txt
~~~

~~~bash
tail -n 35 wg-report.txt
~~~

~~~bash
head -n 35 h3-report.txt
~~~

~~~bash
head -n 35 h2-report.txt
~~~

В отчёте WG ищите **лучший endpoint по каждой подсети и Cloudflare NODE** (и, при необходимости, полный список рабочих IP:port). Это важнее, чем просто один `-best`: у разных endpoint'ов могут быть разные NODE и разные показатели.

Для сравнения запишите такую небольшую таблицу (значения **берутся из ваших сканов**, не из примеров):

| Протокол | Working / Probed | Лучший IP:port | TUN PING / LOSS | NODE / NODE LOCATION | SEEN AS |
|---|---|---|---|---|---|
| WG | из WG | из WG | из WG | из WG | из WG |
| H3 | из H3 | из H3 | из H3 | из H3 | из H3 |
| H2 | из H2 | из H2 | из H2 | из H2 | из H2 |

Расшифровка показателей:

- **Working** — туннель действительно прошёл проверку; **Torn down** — handshake был, но передача данных оборвалась.
- **ENDPOINT PING** — обычная задержка до удалённого IP; **TUN PING** и **LOSS** — внутри работающего туннеля. Для практического выбора обычно предпочтительны `LOSS 0%` и меньший `TUN PING`.
- **SEEN AS** — наблюдаемая страна WARP-выхода. **NODE** — узел Cloudflare, например `FRA` / `ARN` / `DME`; **NODE LOCATION** — его расположение. Не путайте эти величины со страной самого VPS.
- В рамках одного MASQUE-скана NODE обычно общий для найденных endpoint'ов. Смена MASQUE IP:port **не гарантирует** смену NODE.

Если скан сообщает «no working endpoints found», это **результат проверки данного протокола**, а не сбой установки WARPSCOUT. Сначала прочитайте раздел 9, а не переустанавливайте программу.

## 8. Как дополнительно проверить Cloudflare colo и реальный выход

Сначала выясните, куда выходит **сам VPS без WARP**, чтобы иметь сравнение:

~~~bash
curl -4fsS https://www.cloudflare.com/cdn-cgi/trace | grep -E '^(ip|loc|colo|warp)='
~~~

Это *direct baseline*, а не тест выбранного WG/H2/H3. Сам по себе этот ответ **не показывает WARP NODE найденного endpoint'а**. `colo=` в `cdn-cgi/trace` — Cloudflare PoP для конкретного HTTP-запроса; `NODE` WARPSCOUT — результат внутри тестового WARP-туннеля. Их нужно фиксировать отдельно.

Если на VPS **уже работает Mihomo и его mixed-port SOCKS5 доступен на `127.0.0.1:7890`**, можно выполнить чтение **текущего**, уже выбранного прокси без изменения маршрутов:

~~~bash
curl -x socks5h://127.0.0.1:7890 -fsS https://www.cloudflare.com/cdn-cgi/trace | grep -E '^(ip|loc|colo|warp)='
~~~

~~~bash
curl -x socks5h://127.0.0.1:7890 -fsS https://speed.cloudflare.com/meta | jq .
~~~

**Это проверка текущего proxy в Mihomo, а не обязательно найденных WARPSCOUT файлов.** Чтобы честно проверить *конкретный* новый WG/H2/H3 endpoint, сначала импортируйте соответствующий конфиг в подходящий клиент, выберите этот outbound и только потом повторите проверку. Если Mihomo отсутствует или используется другой порт, **пропустите эти команды** — для первичного результата достаточно WARPSCOUT.

Не делайте вывод «сервис работает/не работает» только по стране GeoIP или `colo`. Сам факт рабочего туннеля — не гарантия, что целевой сайт примет именно этот WARP exit.

## 9. Если возникли проблемы: отдельные ветки, не обязательные шаги

### WG работает, но нужен определённый NODE (например, исключить ARN)

**Только после просмотра первого полного отчёта WG** при необходимости можно повторить скан с явно выбранным фильтром:

~~~bash
warpscout scan -p wg -P -jt 10 -exclude-node ARN -o wg-without-arn.txt -conf warp-wg-without-arn.conf
~~~

Или оставить только узел, который **уже видели в отчёте**, например `FRA`:

~~~bash
warpscout scan -p wg -P -jt 10 -node FRA -o wg-fra-report.txt -conf warp-wg-fra.conf
~~~

Это **примеры**, а не универсальная политика! На другом VPS ни `ARN`, ни `FRA` могут вообще не встретиться. `no endpoint landed on node FRA` или `every endpoint was excluded by node ARN` означает, что текущая выборка не дала альтернативы. Более широкий поиск через `-n 20` возможен, но **не обещает** смены Cloudflare NODE.

### H2 или H3 не работает со штатным SNI

WARPSCOUT по умолчанию использует `consumer-masque.cloudflareclient.com`. На некоторых маршрутах помогает другой SNI, но **не копируйте один SNI для двух транспортов без проверки**.

Для H3:

~~~bash
warpscout find-sni -p masque -jt 10
~~~

Для H2:

~~~bash
warpscout find-sni -p masque-h2 -jt 10
~~~

`find-sni` выводит кандидатов и рекомендацию для повторного скана. Замените **`www.apple.com` в примере ниже на реально найденное значение для соответствующего протокола**:

~~~bash
warpscout scan -p masque -P -jt 10 -masque-sni www.apple.com -o h3-custom-sni-report.txt -conf warp-h3-custom-sni.yaml -conf-type mihomo
~~~

~~~bash
warpscout scan -p masque-h2 -P -jt 10 -masque-sni www.apple.com -o h2-custom-sni-report.txt -conf warp-h2-custom-sni.yaml -conf-type mihomo
~~~

**Успех `find-sni` не заменяет полноценный `scan -P`**: на фильтрованных сетях бывает, что SNI подходит для handshake, но передача данных обрывается. Если MASQUE недоступен на данном VPS, не выдавайте результат WG за доказательство работы H2/H3 — это отдельные протоколы.

### WG не проходит на конкретном VPS (исключение для основной задачи)

На некоторых VPS UDP/WG всё же фильтруется. Тогда, **только как резервный вариант**, протестируйте AWG:

~~~bash
warpscout scan -p awg -P -jt 10 -gen-i1 quic -o awg-fallback-report.txt -conf warp-awg-fallback.conf
~~~

Но на типовом неограниченном VPS **не нужно** начинать с AWG или тратить время на подбор `I1`.

### Нужна дополнительная проверка скорости

Обычный порядок результатов строится по качеству туннеля/задержке. Для измерения скорости скачивания и выбора по ней:

~~~bash
warpscout scan -p wg -P -jt 10 -speed -best-by speed -o wg-speed-report.txt -conf warp-wg-speed.conf
~~~

Это отдельная долгая фаза и дополнительный трафик. По данным upstream, она тестирует **выбранные по ping кандидаты**, а не все IP в полном скане. Сами значения — измерение одиночного потока, не максимальная скорость многопоточного speedtest.

### «Unknown command», нет файлов, `command not found`

| Симптом | Что делать |
|---|---|
| `warpscout: command not found` | Проверьте `/usr/local/bin/warpscout version` — возможно, отличается `PATH` |
| `warpscout-account.json: no such file` | Вернитесь `cd /root/warpscout-data`; при первой установке выполните `warpscout register` |
| `invalid value "" for flag -jt` | Здесь в примерах **число `-jt 10`**, нет зависимости от `$JT` |
| Порты доступны, но `0 Working` | Handshake / доступность UDP — не подтверждение data path, смотрите `Torn down` и протокол |
| Нет `warp-h2.yaml` или `warp-h3.yaml` | Проверьте итог скана: `-conf` создаётся при наличии подходящего endpoint'а; при провале протокола результат не выдумывается |
| `no MASQUE endpoint passed data` | Попробуйте `find-sni`, затем полноценный `scan -P` или проверьте другую сеть |
| Вывод показывает только один NODE | Это возможно по текущей BGP/peering-схеме; на MASQUE обычно так и ожидается |
| VPS в одной стране, `SEEN AS` или `NODE LOCATION` в другой | Это не ошибка: маршрутизация WARP/Cloudflare не обязана совпадать с GeoIP хостера |

## 10. Импорт результатов в link-generators (не обязателен для сканирования)

Откройте [WARP & Mihomo Unified Generator](https://saymer-alt.github.io/link-generators/).

**WG:** файл `warp-wg.conf` импортируется в **Mihomo Config Builder → Загрузить .conf / .awg**. После сборки проверьте YAML, работу целевого Mihomo и DNS/routing. Не путайте экспорт WARPSCOUT с уже установленным системным WG VPN.

**MASQUE H3/H2:** содержимое `warp-h3.yaml` и `warp-h2.yaml` по отдельности можно вставить во вкладку **WARP MASQUE Links → Импорт WARP YAML → Распарсить**. Для распознанных `proxies:` с `type: masque` генератор переносит WARP identity, per-transport SNI и **точный найденный endpoint**. Если импортируете оба профиля, следите за согласованностью identity (выбранные H2/H3 не должны иметь разные ключи/IP). Для H2 в YAML будет `network: h2`.

**Не публикуйте YAML с `private-key`.** Импорт в генератор сам по себе **не доказывает** работоспособность новой конфигурации или нужный colo на production Mihomo. После импорта обязателен отдельный реальный тест.

## 11. Что сохранить о каждом VPS

Для своих заметок достаточно:

~~~text
Провайдер / страна / ASN VPS, дата и время
WARPSCOUT version
WG: Working / Probed; несколько лучших endpoint'ов; TUN PING / LOSS; NODE; SEEN AS
MASQUE H3: Working / Probed; лучший endpoint; TUN PING / LOSS; NODE; SEEN AS
MASQUE H2: Working / Probed; лучший endpoint; TUN PING / LOSS; NODE; SEEN AS
При необходимости: прямой VPS trace и trace текущего Mihomo
Есть ли нежелательный routing drift относительно прежнего скана?
~~~

**Cloudflare NODE — наблюдение момента, не пожизненное свойство endpoint'а.** Если через несколько дней `FRA` превратился в `ARN`, это не значит, что WARPSCOUT неверно работал раньше. Влияют сеть VPS, BGP/peering и Cloudflare.

### Дополнительные материалы

- [Архив оригинальной VPS-статьи и полевых испытаний (сентябрь–октябрь 2026)](research/WARPSCOUT-VPS-FIELD-NOTES-2026-09-10.md) — подробные сканы SE/EE/RU, диагностика Gemini, Mihomo controller, dialer-proxy и зафиксированный routing drift. Это **исследования**, не обязательные шаги установки.
- [WARPSCOUT на Keenetic](WARPSCOUT-KEENETIC.md) — другой сценарий, где из-за фильтрации WAN основным является **AWG**, а географические исключения используются по конкретной задаче.
- [Официальный WARPSCOUT README_RU](https://github.com/vernette/warpscout/blob/master/README_RU.md), [MASQUE](https://github.com/vernette/warpscout/blob/master/docs/ru/masque.md), [конфиги и фильтры](https://github.com/vernette/warpscout/blob/master/docs/ru/configs.md).

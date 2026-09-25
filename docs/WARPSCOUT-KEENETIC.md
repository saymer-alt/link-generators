# WARPSCOUT на Keenetic / Entware — практическая инструкция

Эта страница дополняет инструкции для [Windows](WARPSCOUT-WINDOWS.md) и
[VPS](WARPSCOUT-VPS.md). Здесь собран практический сценарий запуска WARPSCOUT
прямо на роутерах Keenetic с установленным Entware.

Цель та же, что и на Windows/VPS:

1. проверить plain WARP / WireGuard как общий baseline там, где он применим, и AWG на фильтрованных сетях;
2. проверить MASQUE H3 / QUIC;
3. проверить MASQUE H2 / TCP;
4. получить Mihomo YAML с MASQUE identity для импорта в первую вкладку
   **WARP MASQUE Links**.

Важно: текущий импорт в link-generators использует WARPSCOUT YAML только как источник
**MASQUE identity** — ключи, SNI, внутренний IP и DNS. Найденные WARPSCOUT
`server`, `port` и `network` намеренно не заменяют transport-стратегию генератора.
Для H2 по умолчанию продолжают использоваться Safe Ports Only.

---

## 0. Установка на Keenetic / Entware

Проверенный на двух 512 MB-class дачных 1012 роутерах способ:

```sh
opkg update && opkg install curl ca-bundle && \
curl -fSsL https://raw.githubusercontent.com/saymer-alt/entware-go/gh-action-build/warpscout/install.sh | sh
```

В полевой проверке 2026-09-25 пакет `warpscout` ещё отсутствовал в подключённых
opkg feeds, поэтому installer штатно перешёл на GitHub latest release,
скачал `warpscout_0.16.0-1_aarch64-3.10.ipk`, установил WARPSCOUT 0.16.0 и
запустил регистрацию WARP account. Это fallback installer'а, а не ошибка установки.

На фильтрованной GSM/LTE-сети прямой Cloudflare registration API и relay не прошли;
installer/ WARPSCOUT смог зарегистрировать account через generated QUIC I1. Не
копируйте в документацию или issue приватную строку I1 и содержимое
`warpscout-account.json`.

## 1. Где запускать

Для Keenetic удобно держать WARPSCOUT в отдельном каталоге Entware:

```sh
mkdir -p /opt/etc/warpscout
cd /opt/etc/warpscout
```

Проверьте бинарник:

```sh
warpscout version
```

В наших тестах использовался WARPSCOUT 0.16.0.

Если `warpscout` не находится через PATH, используйте полный путь к бинарнику,
который установили в Entware.

---

## 2. WARP account

WARPSCOUT хранит регистрацию в файле:

```text
warpscout-account.json
```

Он ищется в **текущем каталоге**, поэтому перед сканированием удобно всегда делать:

```sh
cd /opt/etc/warpscout
```

Первичная регистрация:

```sh
warpscout register
```

После этого последующие команды должны писать примерно:

```text
Using cached WARP account from warpscout-account.json
```

Файл `warpscout-account.json` содержит приватные данные WARP. Не публикуйте его и
не добавляйте в GitHub.

---

## 3. Ограничить параллелизм на роутере

На Keenetic не нужно запускать WARPSCOUT с серверным уровнем параллелизма.
Для роутеров мы используем ограничение примерно до четырёх параллельных задач:

```sh
JT=4
```

Дальше переменная передаётся через:

```sh
-jt "$JT"
```

Это особенно полезно на моделях с 128/256 MB RAM и снижает лишнюю нагрузку на CPU/RAM.

---

## 4. Plain WARP / WireGuard baseline и AWG

Полный скан:

```sh
warpscout scan -p wg -P -jt "$JT"
```

Только лучший endpoint:

```sh
warpscout scan -p wg -P -jt "$JT" -best
```

Получить конфиг:

```sh
warpscout scan -p wg -P -jt "$JT" -conf warp-wg.conf
```

Потом файл можно посмотреть:

```sh
cat warp-wg.conf
```

### Проверка Cloudflare node

Если нужно понять, в какой Cloudflare node попадает WARP-трафик, смотрите
`NODE`, `NODE LOCATION` и `SEEN AS` в полном WG scan.

Если есть подозрение на проблемный node, например `ARN`, можно проверить наличие
альтернативы:

```sh
warpscout scan -p wg -P -jt "$JT" \
  -exclude-node ARN \
  -best
```

Если WARPSCOUT отвечает, что все endpoint'ы исключены, то в текущем маршруте
альтернативного node он не видит. Бесконечный перебор IP/портов в такой ситуации
обычно бессмысленен.

### AWG на фильтрованных сетях

Обычный `-p wg` полезен как baseline, но в полевых тестах 2026-09-25 на двух
дачных 1012 основной рабочий сценарий был **AWG**, а не plain WG:

```sh
warpscout scan -p awg -P -jt "$JT" -gen-i1 quic
```

Для поиска пути без российского Cloudflare node/country:

```sh
warpscout scan -p awg -P -jt "$JT" -gen-i1 quic -exclude-country RU
```

`-exclude-country RU` фильтрует выбранный Cloudflare path/node в терминах
WARPSCOUT. Он **не гарантирует смену выходной GeoIP-страны**: в обоих дачных
тестах после исключения DME/российского path поле `SEEN AS` всё равно оставалось
`RU`.

Важно для журнала тестов: сегодняшнее A/B-сравнение проводного NC-1012 и GSM
KN-1012 проверяло именно `-p awg`. Plain `-p wg` **намеренно не включён** в
дачный acceptance: для целевого российского фильтрованного сценария обычный
WARP/WireGuard не является рабочим транспортом, поэтому отдельный A/B-прогон
не даёт практической пользы. Команды `-p wg` в этой инструкции остаются только
как общий baseline для других сетей/маршрутов, где plain WG применим.

---

## 5. MASQUE H3 / QUIC

В WARPSCOUT H3 соответствует протоколу `masque`.

```sh
warpscout scan -p masque -P -jt "$JT" \
  -masque-sni 4pda.to
```

Лучший endpoint:

```sh
warpscout scan -p masque -P -jt "$JT" \
  -masque-sni 4pda.to \
  -best
```

Mihomo YAML с MASQUE identity:

```sh
warpscout scan -p masque -P -jt "$JT" \
  -masque-sni 4pda.to \
  -conf - -conf-type mihomo
```

Полученный `proxies:` блок можно вставить в первую вкладку link-generators
как источник MASQUE identity.

---

## 6. MASQUE H2 / TCP

Для H2 используется `masque-h2`.

```sh
warpscout scan -p masque-h2 -P -jt "$JT" \
  -masque-sni 4pda.to
```

Лучший endpoint:

```sh
warpscout scan -p masque-h2 -P -jt "$JT" \
  -masque-sni 4pda.to \
  -best
```

Mihomo YAML:

```sh
warpscout scan -p masque-h2 -P -jt "$JT" \
  -masque-sni 4pda.to \
  -conf - -conf-type mihomo
```

В H2-блоке будет:

```yaml
network: h2
```

Но текущий link-generators не обязан наследовать найденные WARPSCOUT
`server` / `port`. При стандартной настройке H2 transport продолжает собираться
по Safe Ports Only:

```text
443, 8443, 4443, 8095
```

Порты `500`, `1701`, `4500`, которые иногда находит WARPSCOUT, в стандартную
Safe Ports стратегию проекта не входят.

---

## 7. Точечная проверка endpoint'ов

На роутере особенно полезно не гонять полный набор повторно, а проверить несколько
конкретных адресов через `-target`.

```sh
warpscout scan -p masque-h2 -P -jt "$JT" \
  -target 162.159.198.30,162.159.199.51 \
  -masque-sni consumer-masque.cloudflareclient.com
```

Ещё один пример:

```sh
warpscout scan -p masque-h2 -P -jt "$JT" \
  -target 162.159.198.80,162.159.199.203 \
  -masque-sni consumer-masque.cloudflareclient.com
```

Если получаете `No working endpoints found` или сообщение
`handshake ok, then cut mid-stream`, это ещё не доказывает, что MASQUE H2 в сети
роутера не работает вообще. Результат зависит от конкретного endpoint, SNI,
текущего маршрута и состояния Cloudflare.

---

## 8. SNI имеет значение

В сегодняшних тестах на Keenetic поведение H2 заметно менялось при смене SNI.

Для обычных тестов проекта мы часто используем `4pda.to`, но для диагностики
самого Cloudflare MASQUE полезно отдельно проверить:

```sh
warpscout scan -p masque-h2 -P -jt "$JT" \
  -masque-sni consumer-masque.cloudflareclient.com
```

Практический вывод: один неудачный скан с одним SNI не следует превращать в вывод
«H2 на этом Keenetic не работает». Для диагностики сравнивайте как минимум два SNI
и несколько endpoint'ов.

---

## 9. Получить identity для link-generators

H3:

```sh
warpscout scan -p masque -P -jt "$JT" \
  -masque-sni 4pda.to \
  -conf - -conf-type mihomo
```

H2:

```sh
warpscout scan -p masque-h2 -P -jt "$JT" \
  -masque-sni 4pda.to \
  -conf - -conf-type mihomo
```

В выводе нужен `proxies:` блок с `private-key`, `public-key`, `ip`, `sni`
и `dns`. Для H2 дополнительно будет `network: h2`.

Вставьте YAML в первую вкладку **WARP MASQUE Links** и нажмите
**«Распарсить»**. Генератор заберёт identity-поля, после чего сам применит свою
QUIC/H2 transport-стратегию.

---

## 10. Не путать три разных результата

На Keenetic удобно разделять:

```text
1. WARPSCOUT нашёл рабочий endpoint
2. WARPSCOUT поднял через него тестовый WARP/MASQUE туннель
3. production Mihomo реально использует свой endpoint и transport
```

Это не одно и то же.

---

## 11. Минимальный набор команд для роутера

```sh
cd /opt/etc/warpscout
JT=4

# Plain WARP / WG baseline
warpscout scan -p wg -P -jt "$JT" -best

# AWG — основной полевой сценарий на фильтрованных сетях
warpscout scan -p awg -P -jt "$JT" -gen-i1 quic

# MASQUE H3
warpscout scan -p masque -P -jt "$JT" \
  -masque-sni 4pda.to \
  -best

# MASQUE H2
warpscout scan -p masque-h2 -P -jt "$JT" \
  -masque-sni 4pda.to \
  -best

# MASQUE H3 identity для link-generators
warpscout scan -p masque -P -jt "$JT" \
  -masque-sni 4pda.to \
  -conf - -conf-type mihomo

# MASQUE H2 identity для link-generators
warpscout scan -p masque-h2 -P -jt "$JT" \
  -masque-sni 4pda.to \
  -conf - -conf-type mihomo
```

---

## 12. Что записывать при сравнении роутеров

```text
модель Keenetic
KeeneticOS
провайдер
протокол: WG / AWG / MASQUE H3 / MASQUE H2
SNI
endpoint
working / torn down
TUN ping / loss
SEEN AS
NODE / NODE LOCATION
время проверки
```

Один и тот же WARPSCOUT может показывать заметно разные результаты на домашнем,
рабочем или мобильном подключении из-за различий маршрута провайдера.

---

## 13. Полевой кейс: KN-1012 через GSM/LTE, 2026-09-25

Реальная проверка выполнялась на **Keenetic Giga KN-1012 / KeeneticOS 5.1.6 / aarch64**
в роли дачного GSM/LTE-роутера. Entware находился во внутреннем UBIFS `/opt`,
активен штатный zRAM; параллельно работали Mihomo 1.19.31 с `tun.stack: mips`
и MagiTrickle. Для WARPSCOUT использовалась версия **0.16.0** и ограничение:

```sh
JT=4
```

На этом профиле WARPSCOUT занимал примерно 3.1 MB, каталог
`/opt/etc/warpscout` — несколько килобайт; после установки на `/opt` оставалось
около 60 MB свободного места. Для такого 512 MB-класса `-jt 4` показал себя
нормальной консервативной стартовой настройкой.

### Контекст uplink на момент полевых тестов

Live MCP-снимок того же вечера показывает двухмодемную схему:

- `UsbLte0` — **MCN Telecom / T2**, модем **Fibocom FM350-GL**,
  APN `modem.tele2.ru`; именно этот интерфейс был default route;
- `UsbLte1` — резервный **Megafon**, модем **L860-GL-16**,
  APN `router.megafon.ru`; интерфейс был подключён, но не являлся default gateway;
- в конфигурации есть multipathing policy с обоими LTE-интерфейсами, поэтому для
  любого вывода о конкретном per-flow пути лучше опираться на отдельную трассировку,
  а не только на наличие двух активных модемов.

На post-test снимке основной FM350-GL работал как **4G+** с агрегацией
**B3 + B3 + B7**; наблюдались примерно `RSRP -95 dBm`, `RSRQ -8 dB`,
`RSSI -70 dBm`, `CINR 3 dB`. Резервный L860-GL-16 был на **B3** с более
слабым уровнем: примерно `RSRP -113 dBm`, `RSRQ -10 dB`,
`RSSI -84 dBm`, `CINR 4 dB`.

Это **контекстный снимок после тестов, а не синхронный radio capture каждой
WARPSCOUT попытки**. Радиопараметры и serving cell могут меняться, поэтому их
нельзя использовать как точные условия каждого отдельного scan. Для сегодняшнего
A/B важен более устойчивый факт: GSM-роутер работал в двухмодемной LTE-схеме с
MCN/T2 на основном/default пути и Megafon как резервом.

### Регистрация WARP account на фильтрованной сети

Прямой доступ к Cloudflare registration API не прошёл. Relay тоже не смог
зарегистрировать account. WARPSCOUT затем перебрал generated AWG I1 и успешно
зарегистрировал свежий account через **generated QUIC I1**. В ходе разных запусков
рабочими маскировочными host для generated QUIC I1 встречались
`cdn.jsdelivr.net`, `www.microsoft.com` и `www.google.com`.

Приватную строку I1 и содержимое `warpscout-account.json` публиковать нельзя.

### AWG

Команда:

```sh
warpscout scan -p awg -P -jt "$JT" -gen-i1 quic
```

дала **70/70 working** в одном полном прогоне. Наблюдались Cloudflare nodes:

```text
DME  ARN  FRA  AMS
```

При этом `SEEN AS` оставался `RU`. Лучший DME-маршрут был примерно 30 ms
внутри туннеля; ARN — примерно 51–65 ms.

Повтор:

```sh
warpscout scan -p awg -P -jt "$JT" -gen-i1 quic -exclude-country RU
```

убрал DME из результата и оставил ARN/FRA/AMS, но `SEEN AS` всё равно остался
`RU`. Это практическое подтверждение: выбор/исключение Cloudflare node или country
в WARPSCOUT **не следует трактовать как гарантированную смену страны выходного IP**.
Node/colo описывает путь обработки трафика, а не обещание GeoIP выхода.

### MASQUE H2

Для H2 штатный:

```text
consumer-masque.cloudflareclient.com
```

дал **0/14** в `find-sni`.

Зато:

```text
www.apple.com
```

дал **14/14 working** в `find-sni -p masque-h2`, а полный запуск:

```sh
warpscout scan -p masque-h2 -P -jt "$JT" \
  -masque-sni www.apple.com
```

дал **70/70 working**, nodes DME и FRA, loss 0%.

В конкретном прогоне лучший DME endpoint был на `:4500` примерно с 32 ms TUN ping,
а FRA встречался, например, на `:8095` примерно с 69 ms. Для проекта важно
разделять эти результаты и transport-стратегию генератора: стандартный
**Safe Ports Only** по-прежнему использует только:

```text
443, 8443, 4443, 8095
```

и не наследует автоматически найденные WARPSCOUT `500/1701/4500`.

### MASQUE H3 / QUIC

H3 оказался принципиально другим.

`find-sni -p masque` показал:

- `consumer-masque.cloudflareclient.com` — **0/14**;
- `www.apple.com` — **4/14**;
- `www.google.com` — **4/14**;
- `www.microsoft.com` — **4/14**;
- `cdn.jsdelivr.net` — **4/14**.

Но последующие полноценные запуски с лучшим найденным SNI:

```sh
warpscout scan -p masque -P -jt "$JT" \
  -masque-sni www.apple.com
```

несколько раз подряд завершались:

```text
no MASQUE endpoint passed data - this network blocks it, try -p awg
```

Точечная перепроверка именно IP, которые `find-sni` предварительно называл
рабочими, дала тот же результат:

```sh
warpscout scan -p masque -P -jt "$JT" \
  -target 162.159.198.1,162.159.198.2 \
  -masque-sni www.apple.com
```

Итог для этого GSM/LTE-подключения: **MASQUE H3 не прошёл реальный data-path
acceptance**, даже несмотря на предварительные `4/14` в `find-sni`.

### Главное правило из этого кейса

**Успех `find-sni` не равен подтверждению работоспособности MASQUE транспорта.**

`find-sni` используется для поиска кандидата SNI. После него обязателен
полноценный `scan` с найденным SNI; при необходимости — повторный точечный
`-target` scan. Только прохождение реального data-path scan следует считать
acceptance.

Итоговая матрица этого KN-1012 GSM/LTE:

| Транспорт | Результат |
|---|---|
| AWG + generated QUIC I1 | работает стабильно, до 70/70 |
| MASQUE H2 + `www.apple.com` | работает стабильно, 70/70 |
| MASQUE H3 + `www.apple.com` | `find-sni` видел 4/14, но полноценный scan не передал данные |
| MASQUE H3 + штатный Cloudflare SNI | не работает |

Это наблюдение относится к конкретному операторскому маршруту GSM/LTE на момент
проверки. Оно не доказывает универсальную блокировку H3 у оператора или на всех
Keenetic; цель кейса — показать правильную методику проверки и различие H2/H3 на
одной и той же сети.


---

## 14. Полевой кейс: NC-1012 через проводной WAN, 2026-09-25

Для сравнения с GSM/LTE-профилем выполнен тот же WARPSCOUT-набор на
**Netcraze Giga NC-1012 / KeeneticOS 5.1.6 / aarch64** с проводным WAN.
Фактический WAN этого роутера — **PPPoE `Mynetcity`** поверх
`GigabitEthernet1`; live snapshot показывает link **1 Gbit/s**, PPPoE MTU **1492**
и default route через `PPPoE0`. Entware находится на внешнем EXT4 `/opt`
на пользовательском **USB/NVMe 32 GB** накопителе; MCP одновременно видит этот
USB 3.x media device. WARPSCOUT 0.16.0 запускался с:

```sh
JT=4
```

### AWG

```sh
warpscout scan -p awg -P -jt "$JT" -gen-i1 quic
```

дал **65/70 working**. Наблюдались nodes **DME / ARN / AMS**, `SEEN AS RU`.
Лучший DME-маршрут был около **10 ms** TUN ping; ARN — около **28–30 ms**,
AMS — около **50–53 ms**.

При повторе:

```sh
warpscout scan -p awg -P -jt "$JT" -gen-i1 quic -exclude-country RU
```

остались только **ARN / AMS**, результат был **30/35 working**, но
`SEEN AS` всё равно оставался `RU`. Это повторяет GSM-наблюдение: исключение
Cloudflare country/node влияет на путь/colo, но не гарантирует смену GeoIP выхода.

### MASQUE H2

`find-sni -p masque-h2` дал:

- `consumer-masque.cloudflareclient.com` — **0/14**;
- `www.apple.com` — **0/14**;
- `www.google.com` — **14/14 working**.

То есть для этого проводного uplink лучшим найденным H2 SNI был
**`www.google.com`**, а не `www.apple.com` как на GSM/LTE.

Полный acceptance-scan с тем же SNI:

```sh
warpscout scan -proto masque-h2 -masque-sni www.google.com
```

дал **70/70 working**, node **DME**, `SEEN AS RU`. Лучшие показанные endpoint'ы:

```text
162.159.198.44:500   ~5 ms endpoint ping
162.159.199.59:8443  ~6 ms endpoint ping
```

Для стандартной transport-стратегии link-generators из этих результатов интересен
`:8443`; `:500` в Safe Ports Only не входит.

### MASQUE H3

`find-sni -p masque` дал:

- `consumer-masque.cloudflareclient.com` — **0/14**;
- `www.apple.com` — **4/14**;
- `www.google.com` — **4/14**;
- `www.microsoft.com` — **4/14**;
- `cdn.jsdelivr.net` — **14/14 working**.

Лучшим найденным H3 SNI был **`cdn.jsdelivr.net`**.

Полный acceptance-scan с тем же SNI:

```sh
warpscout scan -proto masque -masque-sni cdn.jsdelivr.net
```

дал **13/14 working**, node **DME**, `SEEN AS RU`. Лучшие показанные endpoint'ы:

```text
162.159.198.2:8095  ~30 ms endpoint ping
162.159.198.1:8443  ~33 ms endpoint ping
```

Итог: на проводном WAN MASQUE H3 **реально проходит data path**, в отличие от
проверенного GSM/LTE-профиля, где H3 после `find-sni` не прошёл ни полный scan,
ни точечную перепроверку.

Для практической задачи этого проводного дачного роутера есть дополнительный
критерий: **избежать DME**. В текущем полном acceptance и H2, и H3 дали только
node **DME**, поэтому технически рабочие MASQUE H2/H3 сейчас не решают эту задачу.
AWG, напротив, показал ARN/AMS после исключения российского path и потому является
проверенным non-DME-кандидатом. Это вывод про текущий маршрут, а не запрет на
MASQUE вообще: при другом uplink/маршруте node может измениться.

Plain WARP/WG (`-p wg`) в этот дачный A/B намеренно не включался: для целевого
российского фильтрованного сценария он не является практическим транспортом.
Не следует записывать результаты AWG как доказательство plain WG, но и отдельный
plain-WG acceptance здесь не нужен.

Этот A/B-кейс усиливает правило из GSM/LTE-теста:
**результаты `find-sni` и полноценного `scan` нужно связывать одним и тем же
SNI**. Здесь отрицательный scan с `www.apple.com` не описывал транспорт в целом:
правильные SNI `www.google.com` для H2 и `cdn.jsdelivr.net` для H3 дали
успешный full-scan.


### Сравнение проводного WAN и GSM/LTE на даче

| Профиль | AWG | MASQUE H2 | MASQUE H3 |
|---|---|---|---|
| KN-1012 GSM/LTE | до 70/70; DME/ARN/FRA/AMS | 70/70 с `www.apple.com` | не прошёл full data-path scan |
| NC-1012 проводной WAN | 65/70; DME/ARN/AMS | 70/70 с `www.google.com` | 13/14 с `cdn.jsdelivr.net` |

Практический вывод: различие H3 между двумя роутерами нельзя объяснить только
моделью железа или WARPSCOUT — на проводном **Mynetcity/PPPoE** uplink H3 проходит,
а на дачном GSM-профиле с **MCN Telecom/T2 как основным/default LTE path** — нет.
Это сильный признак зависимости от конкретного сетевого маршрута/фильтрации uplink,
но не доказательство универсальной политики конкретного оператора. Наличие второго
активного Megafon-модема и multipathing policy тоже нужно помнить: без отдельного
per-flow capture нельзя превращать эту запись в универсальное утверждение о каждом
пакете конкретного scan.

## См. также

- [WARPSCOUT на Windows](WARPSCOUT-WINDOWS.md)
- [WARPSCOUT на VPS](WARPSCOUT-VPS.md)
- [WARPSCOUT upstream README_RU](https://github.com/vernette/warpscout/blob/master/README_RU.md)
- [WARPSCOUT: MASQUE](https://github.com/vernette/warpscout/blob/master/docs/ru/masque.md)

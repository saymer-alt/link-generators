# WARPSCOUT на VPS: обновить, найти лучшие WARP WG / MASQUE H2 / H3 и импортировать в генератор

**Практическая инструкция для Debian 12 / Ubuntu 24.04.** Подходит для первого запуска и, главное, для возвращения к уже установленному WARPSCOUT спустя месяцы. Проверено на VPS Saymer2 (Debian 12, x86_64) 6 ноября 2026 года с WARPSCOUT **0.16.1**.

**Маршрут:** SSH → узнать установленную версию → при необходимости обновить **ту же копию** → найти прежний WARP-аккаунт → сохранить предыдущие результаты → выполнить три скана со скоростью → посмотреть файлы → перенести их в [WARP & Mihomo Unified Generator](https://saymer-alt.github.io/link-generators/).

WARPSCOUT — **сканер, а не постоянно работающая служба**. Для него не нужны `systemctl start`, автозапуск, перезагрузка VPS или изменения текущей конфигурации Mihomo. Сами по себе команды ниже **не подключают весь VPS через WARP**. Результаты зависят от сети и даты; найденные endpoint'ы со временем меняются.

> **Безопасность:** файл `warpscout-account.json`, `.conf` и `.yaml` с ключами — секретные. Не публикуйте их, не отправляйте в issue и чужие чаты, не выкладывайте в GitHub. Сканирование и обновление выполняются от `root`; проверяйте источник скачиваемого установщика.

## 1. Вернулся спустя месяцы: найти программу и проверить версию

Подключитесь к нужному VPS по SSH. Все дальнейшие команды — в **root-сессии**. Если вошли обычным пользователем, сначала сделайте `sudo -i` (отдельной командой).

~~~bash
whoami
command -v warpscout || true
for p in /root/.local/bin/warpscout /usr/local/bin/warpscout /usr/bin/warpscout; do
  if [ -x "$p" ]; then
    printf '%s: ' "$p"
    "$p" version
  fi
done
~~~

Если `command -v` пуст, программа всё ещё может быть в `/root/.local/bin` (нет каталога в `PATH`). Если бинарников несколько, **определите, какой раньше использовали**; не обновляйте все подряд. Если WARPSCOUT отсутствует — переходите к [первой установке](#8-если-warpscout-ещё-нет-на-vps).

Узнать актуальную версию: [релизы WARPSCOUT](https://github.com/vernette/warpscout/releases/latest). При установленном `jq`:

~~~bash
curl -fsSL https://api.github.com/repos/vernette/warpscout/releases/latest | jq -r '.tag_name'
~~~

На 06.11.2026 последняя версия upstream — **0.16.1**. При следующем возвращении проверяйте версию заново, не запоминайте эту цифру как постоянную.

## 2. Обновить установленный WARPSCOUT без потери аккаунта

**Самая частая ошибка:** установить новый бинарник в `/usr/local/bin`, хотя старый лежит в `/root/.local/bin`. Тогда получаются две копии и остаётся непонятно, какая запускается.

Ниже **реальный, подтверждённый на Saymer2 путь**: `/root/.local/bin/warpscout`. На другом VPS замените только `BINDIR` на каталог **своего** установленного бинарника, найденного в шаге 1 (например, `/usr/local/bin`). Если путь `/usr/bin` принадлежит системному пакету, выясните способ его установки и обновления, прежде чем перезаписывать.

~~~bash
BINDIR=/root/.local/bin
(
  set -eu
  [ -x "$BINDIR/warpscout" ] || { echo "Бинарник не найден: проверьте BINDIR" >&2; exit 1; }
  INSTALLER="$(mktemp)"
  trap 'rm -f "$INSTALLER"' EXIT
  curl -fsSL https://raw.githubusercontent.com/vernette/warpscout/master/install.sh -o "$INSTALLER"
  INSTALL_DIR="$BINDIR" sh "$INSTALLER" --yes
) && "$BINDIR/warpscout" version
~~~

Установщик официальный: `vernette/warpscout`. Он скачивается **до выполнения**; ошибка `curl` останавливает обновление, а не превращается в ложный успех `curl | sh`. `--yes` разрешает замену. Для работы не нужен `reinstall` аккаунта и не нужен `systemctl restart`.

**Что означает результат:** `Installed warpscout 0.16.1 to ...` и следующая строка `0.16.1` — успешное обновление. При повторном запуске `warpscout 0.16.1 is already installed` — штатно. Если установщик завершился с ошибкой, обновление **не подтверждено**.

## 3. Найти существующий WARP-аккаунт; не регистрироваться заново

На Saymer2 и по нашей инструкции рабочий каталог — `/root/warpscout-data`. **Здесь нужно выполнять сканы**, поскольку WARPSCOUT читает `warpscout-account.json` из текущей директории.

~~~bash
ls -ld /root/warpscout-data 2>/dev/null || true
ls -l /root/warpscout-data/warpscout-account.json 2>/dev/null || true
~~~

Если файл найден:

~~~bash
cd /root/warpscout-data
umask 077
~~~

Если не найден, ищите только **путь**, не содержимое приватного файла:

~~~bash
find /root -maxdepth 5 -type f -name 'warpscout-account.json' -print 2>/dev/null
~~~

Нашли в другом каталоге? Перейдите именно туда и сделайте `umask 077`. Сообщение `Using cached WARP account from warpscout-account.json` — **нормально**, аккаунт уже используется. Повторный `register` не нужен. Если аккаунта действительно нет нигде, см. [первую регистрацию](#8-если-warpscout-ещё-нет-на-vps).

**При новом SSH-подключении возвращайтесь в каталог аккаунта перед сканами.** Переменные и выбранный каталог между SSH-сессиями не сохраняются.

## 4. Сохранить предыдущие отчёты, если они нужны

Следующие сканы пишут `wg-best-report.txt`, `h2-best-report.txt`, `h3-best-report.txt` и соответствующие `*-best.conf/yaml`. Если они уже существуют, новые сканы могут их заменить. До нового прогона, **находясь в каталоге аккаунта**, сохраните их отдельной датированной копией:

~~~bash
(
  set -eu
  SNAPSHOT="history/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$SNAPSHOT"
  chmod 700 "$SNAPSHOT"
  for f in wg-best-report.txt h2-best-report.txt h3-best-report.txt wg-best.conf h2-best.yaml h3-best.yaml; do
    [ ! -f "$f" ] || cp -p -- "$f" "$SNAPSHOT/"
  done
  echo "Сохранено в $SNAPSHOT"
)
~~~

Если копирование не удалось, не запускайте следующие сканы, пока не сохранили важное. Архив тоже содержит конфиги **с ключами**, не делайте его публичным. Старые датированные `warpscout-report-2026-09-*.txt` не перезаписываются приведёнными ниже именами.

## 5. Основной запуск: лучшие WG, MASQUE H2 и H3 по скорости

**Это главный блок для повторного использования.** Никаких обязательных фильтров `RU`, `ARN`, `DME`, поиска SNI или AWG. На VPS без фильтрации начните с обычного WG. Важен **работающий туннель**, а не только открытый UDP/TCP-порт.

Если `warpscout` находится в `PATH`, скопируйте целиком:

~~~bash
(
  cd /root/warpscout-data || exit 1
  umask 077
  WS="$(command -v warpscout)" || { echo "WARPSCOUT не найден в PATH. Используйте полный путь из §1." >&2; exit 1; }
  [ -f warpscout-account.json ] || { echo "Аккаунт не найден: проверьте каталог из §3." >&2; exit 1; }

  echo "=== WG / UDP ==="
  "$WS" scan -p wg -P -jt 10 -speed -best-by speed \
    -o wg-best-report.txt -conf wg-best.conf

  echo "=== MASQUE H2 / TCP ==="
  "$WS" scan -p masque-h2 -P -jt 10 -speed -best-by speed \
    -o h2-best-report.txt -conf h2-best.yaml -conf-type mihomo

  echo "=== MASQUE H3 / QUIC ==="
  "$WS" scan -p masque -P -jt 10 -speed -best-by speed \
    -o h3-best-report.txt -conf h3-best.yaml -conf-type mihomo
)
~~~

**Важно:** пример каталога `/root/warpscout-data` замените на **свой**, если аккаунт находится не там. Если WARPSCOUT есть, но не находится в `PATH`, в блоке замените строку `WS="$(command -v warpscout)" ...` на `WS=/root/.local/bin/warpscout` или другой **проверенный в §1** полный путь.

Три скана намеренно **независимы**: неуспех одного протокола не должен мешать попробовать остальные. Смотрите итог каждого, а не считайте наличие файла доказательством успеха. Если возникла ошибка — ниже есть [раздел диагностики](#9-если-что-то-не-работает).

Что делают флаги:

| Флаг | Зачем |
|---|---|
| `-p wg` / `masque-h2` / `masque` | WireGuard UDP / MASQUE H2 TCP / MASQUE H3 QUIC |
| `-P` | Проверка передачи данных *внутри* туннеля, TUN PING, LOSS; отсеивает ложные «рабочие» endpoint'ы |
| `-jt 10` | До десяти параллельных проверок (если VPS слабый, уменьшите до `4`) |
| `-speed -best-by speed` | Однопоточный speed-тест **предварительно выбранных** кандидатов, выбор лучшего из них по скорости |
| `-o` | Файл полного отчёта с найденными результатами |
| `-conf` | Готовый конфиг выбранного endpoint'а **из того же скана** |
| `-conf-type mihomo` | YAML `proxies:` для H2/H3, который можно импортировать в генератор |

Результат `-speed` — **не** гарантированный максимум канала и **не** тест каждого IP из всего пула. Нужна стабильность, а не только один высокий пик: дополнительно смотрите `Working`, `Torn down`, `TUN PING`, `LOSS`, `NODE` и при необходимости перепроверяйте позже. Не запускайте лишние `-best`/`-conf` отдельными сканами.

## 6. Посмотреть результаты и сами файлы на VPS

После успешных сканов обычно появляются шесть файлов:

| Протокол | Отчёт (без приватных ключей) | Конфигурация (секретная) |
|---|---|---|
| WG | `wg-best-report.txt` | `wg-best.conf` |
| MASQUE H2 | `h2-best-report.txt` | `h2-best.yaml` |
| MASQUE H3 | `h3-best-report.txt` | `h3-best.yaml` |

~~~bash
cd /root/warpscout-data
ls -lh *best*
less wg-best-report.txt
less h2-best-report.txt
less h3-best-report.txt
~~~

В `less`: стрелки — прокрутка, `/слово` — поиск, `q` — выйти. Полные конфиги можно **прочитать локально** через `less wg-best.conf`, `less h2-best.yaml`, `less h3-best.yaml`; **не присылайте их текст с private-key**.

Посмотреть **только несекретные параметры**:

~~~bash
cd /root/warpscout-data

echo "=== WG ==="
grep -iE '^[[:space:]]*(Endpoint|Address|DNS|MTU)[[:space:]]*=' wg-best.conf

echo "=== MASQUE H2 ==="
grep -E '^[[:space:]]*(name|server|port|network|sni|udp):' h2-best.yaml

echo "=== MASQUE H3 ==="
grep -E '^[[:space:]]*(name|server|port|network|sni|udp):' h3-best.yaml
~~~

WG обычно содержит внутренний адрес `172.16.0.2/32` — это **адрес интерфейса WARP**, а не публичный IP сервера. У H2 в YAML есть `network: h2`; у H3 этой строки обычно нет, поскольку стандартный MASQUE использует QUIC. `udp: true` у H2 не меняет внешний транспорт с TCP на QUIC.

Если `-conf` не создал файл после неудачного скана, это не повод использовать старый файл как «новый успешный результат».

## 7. Перенести в наш генератор

Откройте [WARP & Mihomo Unified Generator](https://saymer-alt.github.io/link-generators/) на своём ПК. WARPSCOUT **не меняет** запущенный Mihomo; импорт — отдельное действие пользователя.

- **WG:** возьмите `wg-best.conf` → вкладка **Mihomo Config Builder** → загрузка файла `.conf / .awg`. Затем проверьте сгенерированный YAML и маршруты.
- **MASQUE H2/H3:** файлы `h2-best.yaml` и `h3-best.yaml` по отдельности → **WARP MASQUE Links → Импорт WARP YAML → Распарсить**. Для распознанного `proxies:` с `type: masque` генератор импортирует WARP identity, транспорт/SNI и **точный `server:port`** (он имеет приоритет над встроенными портами, в том числе над H2 Safe Ports Only). У H2 будет `network: h2`.
- Сравните выход генератора с найденными endpoint'ами и ключами; если импортируете оба MASQUE-профиля, убедитесь в согласованности identity. Не считайте, что два последовательных импорта автоматически объединяют профили.
- Проверяйте конфигурацию в целевом Mihomo и **реальный пользовательский путь** отдельно. Успех WARPSCOUT ещё не доказывает работоспособность маршрута через ваш Keenetic/VPS или долгосрочную стабильность выбранного endpoint'а.

Чтобы перенести файлы на ПК, используйте ваш обычный SSH/SFTP-клиент (например, WinSCP) из `/root/warpscout-data/` по защищённому соединению. **Не храните конфиги в публичном облаке.** Если SFTP-клиент не имеет root-доступа, не ослабляйте права каталога или ключей ради копирования; используйте разрешённый защищённый способ доступа.

## 8. Если WARPSCOUT ещё нет на VPS

Этот раздел **только для первой установки**. На давно настроенном сервере пропустите его: повторная регистрация не нужна.

От `root` на Debian 12 / Ubuntu 24.04:

~~~bash
apt-get update && apt-get install -y curl ca-certificates tar jq
(
  set -eu
  INSTALLER="$(mktemp)"
  trap 'rm -f "$INSTALLER"' EXIT
  curl -fsSL https://raw.githubusercontent.com/vernette/warpscout/master/install.sh -o "$INSTALLER"
  INSTALL_DIR=/usr/local/bin sh "$INSTALLER" --yes
) && /usr/local/bin/warpscout version
~~~

Установщик берёт подходящий `linux_amd64` или `linux_arm64` релиз. Для новой установки выбран `/usr/local/bin`; при будущем обновлении используйте **этот же путь**.

Если **точно нет старого аккаунта**, создайте каталог, зарегистрируйте WARP один раз:

~~~bash
mkdir -p /root/warpscout-data
chmod 700 /root/warpscout-data
cd /root/warpscout-data
umask 077
/usr/local/bin/warpscout register
chmod 600 warpscout-account.json
~~~

Далее — к [основным сканам](#5-основной-запуск-лучшие-wg-masque-h2-и-h3-по-скорости). Если `warpscout` не находится в `PATH`, используйте полный путь (см. §5). **Никогда не регистрируйте новый аккаунт только потому, что забыли рабочий каталог.**

## 9. Если что-то не работает

| Симптом | Что делать |
|---|---|
| `warpscout: command not found` | Смотрите три пути в §1 и используйте полный путь; не устанавливайте второй бинарник только из-за `PATH` |
| `warpscout-account.json: no such file` | Найдите старый каталог по §3. `register` — только для действительно нового аккаунта |
| `0 Working`, `Torn down` | Порт/handshake не равен работоспособному data-path; смотрите полный `-P`-отчёт |
| `every endpoint was excluded by node ARN` | Успешный отбор исключил все кандидаты на ARN; это не поломка версии. Попробуйте скан **без фильтра** или другую сеть |
| Нет `.conf`/`.yaml` | Проверьте, завершился ли соответствующий скан успешно. Не импортируйте старую копию как новую |
| Нет скорости у части строк | `-speed` измеряет выбранных кандидатов, а не все найденные IP |
| H2/H3 не проходит со штатным SNI | Только тогда попробуйте `find-sni` для каждого транспорта отдельно, затем подтвердите новым `scan -P` |

### Фильтры WG по Cloudflare NODE — необязательно

**Только для WG/AWG**, если вам действительно нужен иной узел. Пример исключения ARN:

~~~bash
warpscout scan -p wg -P -jt 10 -exclude-node ARN \
  -o wg-without-arn.txt -conf wg-without-arn.conf
~~~

Расширение выборки (не гарантия другого узла):

~~~bash
warpscout scan -p wg -P -jt 10 -n 20 -exclude-node ARN \
  -o wg-extended-without-arn.txt -conf wg-extended-without-arn.conf
~~~

Фильтр **не перенаправляет** сеть Cloudflare — он только отбрасывает результаты, которые не устраивают вас. На Saymer2 оба варианта вернули `every endpoint was excluded by node ARN`. Бесконечное увеличение `-n` на том же маршруте бессмысленно. У **MASQUE H2/H3** фильтры `-node`, `-country`, `-exclude-node`, `-exclude-country` не поддерживаются: NODE определяется маршрутом, а не выбранным адресом.

### Если MASQUE не проходит

Для H3:

~~~bash
warpscout find-sni -p masque -jt 10
~~~

Для H2:

~~~bash
warpscout find-sni -p masque-h2 -jt 10
~~~

`find-sni` ищет варианты; после него нужно выполнить **новый `scan -P -masque-sni ИМЯ`** для соответствующего транспорта. SNI, сработавший для H3, не обязательно подходит H2. Если обычный WG на VPS фильтруется, отдельно допускается AWG (`-p awg -gen-i1 quic`); для типового VPS не надо начинать с AWG.

## 10. Проверенный результат: Saymer2, Швеция, 06.11.2026

Это **исторический пример**, а не готовый список вечных endpoint'ов. VPS: Debian 12, `amd64`. Установленная версия `0.16.0` находилась в `/root/.local/bin/warpscout`; обновление через `INSTALL_DIR=/root/.local/bin` до `0.16.1` прошло успешно. Повторный запуск сообщил `already installed`. Старый аккаунт в `/root/warpscout-data/warpscout-account.json` использован без перерегистрации.

После обновления и **основного** `-P -speed -best-by speed`-сканирования:

| Транспорт | Working / Probed | Выбранный endpoint | Однопоточная скорость | TUN PING / LOSS | NODE / SEEN AS |
|---|---|---|---|---|---|
| **WG** | 70 / 70 | `8.35.211.157:2408` | **396.0 Mbps** | 1 ms / 0% | ARN / SE |
| **MASQUE H2** | 66 / 70 | `162.159.199.113:443` | **74.1 Mbps** | 1 ms / 0% | ARN / SE |
| **MASQUE H3** | 14 / 14 | `162.159.198.2:1701` | **166.2 Mbps** | 1 ms / 0% | ARN / SE |

Конфиги: `wg-best.conf`, `h2-best.yaml`, `h3-best.yaml`. В обоих MASQUE использовался штатный `consumer-masque.cloudflareclient.com`; у H2 — `network: h2`, у H3 — QUIC.

При проверке WG с `-exclude-node ARN` (обычная и расширенная `-n 20` выборки) **все найденные endpoint'ы были исключены**. Это показывает текущее попадание протестированных кандидатов на ARN, но не невозможность когда-либо получить другую NODE с этого VPS.

**Практический вывод для данного теста:** WG оказался самым быстрым из измеренных вариантов; H3 и H2 остаются самостоятельными альтернативами. Эти скорости не подтверждают длительную стабильность и не означают, что сами VPS/Mihomo начали маршрутизировать трафик через WARP.

## Дополнительные материалы

- [WARPSCOUT upstream: README_RU](https://github.com/vernette/warpscout/blob/master/README_RU.md), [MASQUE](https://github.com/vernette/warpscout/blob/master/docs/ru/masque.md), [конфиги/фильтры](https://github.com/vernette/warpscout/blob/master/docs/ru/configs.md).
- [Новые полевые результаты 06.11.2026: Saymer2 и hungry-boyd](research/WARPSCOUT-VPS-FIELD-NOTES-2026-11-06.md) — сравнение WG/H2/H3, резервные endpoint'ы, SNI, H2/TCP на порту 500 и два файла WARP-аккаунта.
- [Архив предыдущих исследований на VPS](research/WARPSCOUT-VPS-FIELD-NOTES-2026-09-10.md) — исторические SE/EE/RU измерения, routing drift, более глубокая диагностика.
- [WARPSCOUT на Keenetic](WARPSCOUT-KEENETIC.md) — другой сценарий: в фильтрованной домашней сети обычно нужен AWG, не копируйте эти требования на VPS.

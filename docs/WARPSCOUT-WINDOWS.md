# WARPSCOUT на Windows — практическая инструкция для link-generators

Эта страница не заменяет документацию WARPSCOUT. Здесь собран только рабочий сценарий для
`saymer-alt/link-generators`: с Windows-машины найти рабочие Cloudflare WARP / MASQUE
endpoint'ы, понять куда выходит трафик и получить данные, которые можно использовать в нашем
генераторе.

Актуальный upstream: [vernette/warpscout](https://github.com/vernette/warpscout).

## Что мы хотим получить

Три прикладные задачи:

1. **WARP (WireGuard)** — найти рабочий endpoint и при необходимости получить `.conf`,
   который можно загрузить в **Mihomo Config Builder**.
2. **MASQUE H3 / QUIC** — проверить H3 endpoint'ы и получить Mihomo YAML с актуальной
   MASQUE identity (ключи, SNI, внутренний IP, DNS).
3. **MASQUE H2 / TCP** — то же для H2, включая реальные endpoint'ы, которые видит именно
   текущая сеть Windows-компьютера.

Важно: для MASQUE текущая первая вкладка нашего проекта использует WARPSCOUT YAML как
**источник identity**, а не как источник transport endpoint'а. Поля `server`, `port`,
`network` из WARPSCOUT не переопределяют нашу проверенную стратегию генерации.

## 1. Установка

Скачайте Windows-архив `warpscout_..._windows_amd64.zip` со страницы
[Releases](https://github.com/vernette/warpscout/releases) и распакуйте его, например:

```text
C:\DPI\warpscout
```

Откройте CMD или PowerShell и перейдите в папку:

```bat
cd /d C:\DPI\warpscout
```

Проверьте запуск:

```bat
.\warpscout.exe version
```

## 2. Регистрация WARP-аккаунта

WARPSCOUT хранит регистрацию в `warpscout-account.json` в текущей директории.

Первый запуск:

```bat
.\warpscout.exe register
```

После успешной регистрации **не публикуйте** `warpscout-account.json`: в нём есть
токены и приватные ключи.

Если последующие команды пишут:

```text
Using cached WARP account from warpscout-account.json
```

аккаунт найден и используется повторно.

---

## 3. Задача: найти WARP endpoint

Обычный WARP поверх WireGuard:

```bat
.\warpscout.exe scan -p wg -P
```

`-P` добавляет проверку задержки/потерь **внутри туннеля**, поэтому это полезнее простого
скана доступности.

Только лучший endpoint:

```bat
.\warpscout.exe scan -p wg -P -best
```

Пример результата:

```text
188.114.98.58:2408
```

### Сразу получить файл для Mihomo Builder

```bat
.\warpscout.exe scan -p wg -P -conf warp.conf
```

Файл `warp.conf` можно загрузить на второй вкладке нашего проекта кнопкой
**«Загрузить .conf / .awg»**.

### Если обычный WireGuard режется DPI

Для диагностического сравнения используйте AmneziaWG:

```bat
.\warpscout.exe scan -p awg -P -gen-i1 quic
```

Если нужен готовый файл:

```bat
.\warpscout.exe scan -p awg -P -gen-i1 quic -conf warp.awg
```

Это уже отдельный AWG-сценарий; не надо подменять им обычный `-p wg`, если WG и так работает.

---

## 4. Задача: MASQUE H3 / QUIC

В нашем проекте H3 соответствует WARPSCOUT-протоколу `masque`.

Быстрый рабочий скан с нашим обычным SNI:

```bat
.\warpscout.exe scan -p masque -masque-sni 4pda.to
```

Только лучший endpoint:

```bat
.\warpscout.exe scan -p masque -masque-sni 4pda.to -best
```

Получить Mihomo YAML с MASQUE identity:

```bat
.\warpscout.exe scan -p masque -masque-sni 4pda.to -conf - -conf-type mihomo
```

Типичный полезный блок:

```yaml
proxies:
  - name: "MASQUE H3 WARP"
    type: masque
    server: 162.159.198.2
    port: 8443
    sni: 4pda.to
    private-key: ...
    public-key: ...
    ip: 172.16.0.2
    udp: true
    remote-dns-resolve: true
    dns: ['1.1.1.1', '1.0.0.1']
```

Для H3 поля `network: h2` нет — это нормально: для Mihomo MASQUE по умолчанию работает
через HTTP/3/QUIC.

### Использование в link-generators

1. Скопируйте **YAML-блок `proxies:`**, а не таблицу скана.
2. Вставьте его во вкладку **WARP MASQUE Links**.
3. Нажмите **«Распарсить»**.
4. Убедитесь, что появились private/public key, SNI, IP и DNS.
5. Нажмите **«Сгенерировать ссылки»**.
6. При необходимости отправьте результат кнопкой **«В Mihomo Builder»**.

Текущий parser импортирует identity. Найденный WARPSCOUT endpoint не становится endpoint'ом
генератора автоматически.

---

## 5. Задача: MASQUE H2 / TCP

H2 в WARPSCOUT — отдельный режим:

```bat
.\warpscout.exe scan -p masque-h2 -masque-sni 4pda.to
```

Только лучший endpoint:

```bat
.\warpscout.exe scan -p masque-h2 -masque-sni 4pda.to -best
```

Mihomo YAML:

```bat
.\warpscout.exe scan -p masque-h2 -masque-sni 4pda.to -conf - -conf-type mihomo
```

От H3 он отличается прежде всего:

```yaml
network: h2
```

Пример:

```yaml
proxies:
  - name: "MASQUE H2 WARP"
    type: masque
    server: 162.159.198.28
    port: 1701
    network: h2
    sni: 4pda.to
    private-key: ...
    public-key: ...
    ip: 172.16.0.2
    udp: true
    remote-dns-resolve: true
    dns: ['1.1.1.1', '1.0.0.1']
```

### Почему мы не копируем port из WARPSCOUT в генератор

WARPSCOUT проверяет реальные порты Cloudflare и может показать, например, `500`, `1701`
или `4500`. Это полезный **результат сканирования**, но в нашем генераторе эти VPN-порты
специально исключены из режима **Safe Ports Only**.

Наш production-default:

```text
443, 8443, 4443, 8095
```

Порты:

```text
500, 1701, 4500
```

доступны только в расширенной стратегии генератора и по умолчанию не используются из-за
возможного семантического конфликта с DPI.

Поэтому сценарий «WARPSCOUT нашёл `:1701` → генератор выпустил H2 на `:443`» сам по себе
**не является ошибкой**.

---

## 6. Если SNI не работает

SNI нужно проверять **отдельно для H3 и H2**. Рабочий SNI одного транспорта не обязан работать
у другого.

Для H3:

```bat
.\warpscout.exe find-sni -p masque
```

Для H2:

```bat
.\warpscout.exe find-sni -p masque-h2
```

WARPSCOUT напечатает готовую команду скана с найденным SNI.

Если `4pda.to` работает стабильно, ничего подбирать не нужно.

---

## 7. Как читать таблицу WARPSCOUT

Основные поля:

- **ENDPOINT** — адрес и порт, которые реально проверялись;
- **ENDPOINT PING** — задержка до endpoint'а;
- **SEEN AS** — страна, которой Cloudflare считает WARP-выход;
- **NODE** — Cloudflare edge node/PoP, через который прошёл тест.

`SEEN AS` и `NODE` — разные вещи. Endpoint может обслуживаться одной нодой, а выход
географически определяться иначе.

Для MASQUE есть важное ограничение: в рамках одного запуска все endpoint'ы обычно попадают
на одну ноду; нода зависит прежде всего от сети, из которой запущен скан, а не от выбора
конкретного MASQUE IP.

---

## 8. Минимальный набор команд

Если нужно быстро повторить диагностику через месяц:

```bat
REM WARP / WireGuard
.\warpscout.exe scan -p wg -P -best

REM MASQUE H3 / QUIC
.\warpscout.exe scan -p masque -masque-sni 4pda.to -best
.\warpscout.exe scan -p masque -masque-sni 4pda.to -conf - -conf-type mihomo

REM MASQUE H2 / TCP
.\warpscout.exe scan -p masque-h2 -masque-sni 4pda.to -best
.\warpscout.exe scan -p masque-h2 -masque-sni 4pda.to -conf - -conf-type mihomo
```

## См. также

- [WARPSCOUT upstream README_RU](https://github.com/vernette/warpscout/blob/master/README_RU.md)
- [WARPSCOUT: MASQUE](https://github.com/vernette/warpscout/blob/master/docs/ru/masque.md)
- [WARPSCOUT: конфиги и фильтры](https://github.com/vernette/warpscout/blob/master/docs/ru/configs.md)
- [WARPSCOUT на VPS](WARPSCOUT-VPS.md)

# No-DIRECT egress lab (#284) — synthetic netns field test

Полностью локальная синтетическая проверка no-DIRECT инварианта #284 в сетевых
namespace (Linux/WSL2). Реальные VPS не используются; endpoint — локальный
логирующий echo-сервер. Критерий утечки: запрос на контролируемый endpoint с
source-IP, назначенным «VPS»-namespace, из пользовательского сценария.

## Топология

- root ns: destination/echo :8099 (dual-stack, логирует source каждого запроса),
  сервер подписок :8098, DNS-стаб :5300 (наблюдение);
- vps ns (10.210.0.3 / fd00:2010::3) — «публичный IP VPS»: mihomo A с YAML от
  Builder (runtime `web4core.runtime.js`), ingress — lab VLESS-listener;
- egress ns (10.211.0.2 / fd00:2011::2) — «разрешённый внешний egress»: mihomo B;
- root ns: клиент C (mixed :7897) — стенд VLESS-клиента (телефонный TUN на
  VPS-сторону не влияет).

## Запуск

```bash
MIHOMO_BIN=/absolute/mihomo(>=1.19.31) bash lab.sh            # основная матрица А/Б/В/Г/Д
bash dns-observe.sh                                            # DNS-наблюдение (наблюдения, не PASS/FAIL)
bash ipv6-observe.sh && bash ipv6-live-exit.sh                 # IPv6: fail-closed exit + позитив через v6-capable egress
```

`lab.sh` сам генерирует конфиги через vendored Builder runtime (`gen.mjs`,
lab-only добавки промаркированы), самоподписанный lab-CA держит ТОЛЬКО в
`certs/` и доверяет ему исключительно через `SSL_CERT_FILE` у процесса A
(системный trust store не изменяется), проверяет каждый хоп (liveness), а
вердикт — жёсткий: любой endpoint-hit с source «VPS» вне selftest = FAIL
(exit 1). По завершении trap убивает только собственные процессы и
namespace'ы; `run/` и `certs/` gitignored.

## Что доказано этим стендом (см. Issue #284)

А/Б/В/Г/Д матрица: пользовательский трафик выходит только через разрешённый
upstream; полный отказ upstream → 502/REJECT и 0 попаданий на endpoint;
GLOBAL manual без DIRECT-варианта; Sub Mode ON provider-fetch живёт (service
plane); IPv6-литералы: fail-closed при `ipv6: false` у exit-узла, через
v6-capable egress — endpoint видит egress-v6, не VPS-v6; 0 запросов с
source VPS (v4 и v6) во всех сценариях.

## Границы

Это не proof свойств ОС: host firewall/PBR/NAT, resolv.conf, реальный TUN и
реальные клиенты — отдельный packet-path/полевой этап (BLOCKED до owner GO).
`urlTest` фиксирован на публичные URL (контракт Builder) и в изолированной
сети не отвечает — детерминизм обеспечен ручным выбором GLOBAL через API.

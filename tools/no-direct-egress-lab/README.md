# No-DIRECT egress lab (#284) — contained netns field test

Полностью локальная синтетическая проверка no-DIRECT инварианта #284 внутри
приватного сетевого namespace (Linux/WSL2). Реальные VPS не используются;
endpoint — локальный логирующий echo-сервер. Критерий утечки: запрос на
контролируемый endpoint с source-IP, назначенным «VPS»-namespace, из
пользовательского сценария.

## Изоляция (containment)

- Первый side-effect каждого скрипта — `require_lab_isolation()`
  (`lib/netns.sh`): повторный `exec` внутрь **приватного** `unshare -n`
  namespace. Все sysctl, ссылки, адреса и forwarding-флаги живут в этом
  namespace и исчезают вместе с ним; общий host-стек не изменяется.
  Если `unshare` недоступен — запуск **отказывается** работать (нет fallback
  на host-namespace).
- Вложенные namespace («vps», «egress») — **безымянные**, создаются по PID
  (`unshare -n ... &` + `ip link set ... netns $PID`); ничего не
  регистрируется в `/run/netns`, общего имени нет — коллизии с чужими
  namespace исключены.
- Отсутствие host-мутаций подтверждено парным снимком состояния
  (iptables/ip6tables -S, sysctl ip_forward/forwarding, `ip netns list`,
  ссылки, процессы) до и после полного прогона всех скриптов: **различий
  нет**.

## Владение процессами и очистка

- Каждый запущенный процесс регистрируется (`lab_own`) с уникальным для
  запуска маркером; trap-очистка убивает **только** зарегистрированные PID,
  у которых `/proc/PID/cmdline` всё ещё содержит этот маркер. Никаких
  `pkill`/pattern-kill, никакого удаления чужих процессов.
- Удаляются только каталог этого запуска (`run/<run-id>`) и lock-каталог.
  Системные сертификаты, CA-файлы, чужие файлы не затрагиваются: lab-серт
  живёт в `certs/` (gitignored) и доверяется исключительно через
  `SSL_CERT_FILE` процесса A.
- Одновременные запуски блокируются mkdir-локом с записью PID держателя
  (устойчивее flock на сетевых FS); лок с мёртвым PID считается протухшим и
  перехватывается.

## Fail-closed вердикт (`lib/verdict.sh`)

Любое невыполненное обязательное условие — упавший позитивный сценарий,
неожиданно прошедший негативный, HTTP-ответ не с ожидаемым статусом
(`lab_curl`/`api_ok`/`api_select` = 204), недоступность хопа, ошибка выбора
GLOBAL — увеличивает счётчик FAIL. Финальный `lab_verdict`: PASS только при
нуле FAIL **и** нуле не-selftest попаданий на endpoint с source «VPS»
(v4+v6); иначе `exit 1`. LAB-инфраструктурные пробы помечены URL
(`/self-vps`, `/self-egress`, `/selftest-direct`) и исключены из критерия
утечки; корректность самого детектора проверяется обязательным selftest в
начале каждого прогона.

## Топология и сценарии

- root ns: destination/echo :8099 (dual-stack, логирует source каждого
  запроса), сервер подписок :8098, DNS-стаб :5300 (наблюдение);
- vps ns (10.210.0.3 / fd00:2010::3) — «публичный IP VPS»: mihomo A с YAML от
  Builder (runtime `web4core.runtime.js`), ingress — lab VLESS-listener;
- egress ns (10.211.0.2 / fd00:2011::2) — «разрешённый внешний egress»: mihomo B;
- root ns: клиент C (mixed :7897) — стенд VLESS-клиента.

`lab.sh`: A (живой upstream, трафик только через разрешённый egress) → B
(полный отказ: all-dead url-test, ручной выбор мёртвого узла, GLOBAL=REJECT —
всё fail-closed) → C (ручной возврат на разрешённый узел) → D (Sub Mode ON:
provider-fetch наблюдается с VPS-IP как service-plane bootstrap, user-plane
через узел подписки) → D2 (мёртвый узел в подписке: fetch живёт, user-plane
fail-closed). Плюс обязательные проверки: каждый хоп, selftest детектора
утечки, аудит `/proxies` (ни одного DIRECT-члена в группах, REJECT в GLOBAL).

`dns-observe.sh`: наблюдение DNS-пути при мёртвых upstream (информационное,
не PASS/FAIL). `ipv6-observe.sh`: v6-литерал через строгий exit (`ipv6:
false`) — fail-closed. `ipv6-live-exit.sh`: v6-capable egress — endpoint видит
egress-v6, никогда VPS-v6.

## Запуск

```bash
MIHOMO_BIN=/absolute/mihomo(>=1.19.31) bash lab.sh
MIHOMO_BIN=... bash test-guards.sh   # 38 статических/mock-проверок: нет pkill,
                                     # нет ip netns add/del, gate до мутаций,
                                     # строгие статусы, ownership-очистка, вердикт
bash dns-observe.sh; bash ipv6-observe.sh; bash ipv6-live-exit.sh
```

Готовность API проверяется по `GET /proxies/GLOBAL == 200`
(`lab_wait_api_ready`): `/version` отвечает уже в окне стартовой конфигурации,
когда применён дефолтный (пустой) конфиг — selections в этом окне дали бы 404.
Каждый перезапуск сценария получает свежий `-d` каталог: генерируемые конфиги
несут `profile.store-selected`, и переиспользование каталога молча
восстанавливало бы GLOBAL-выбор предыдущего сценария.

## Результаты последнего прогона (2026-11-06, mihomo 1.19.31)

`lab.sh` → `VERDICT: PASS`, `LAB-EXIT=0` (A1/A2 через egress, B1–B3
fail-closed 502, C восстановление через ручной re-select, D через узел
подписки, D2 fail-closed при живом fetch; 0 не-selftest попаданий с VPS-IP).
`test-guards.sh` → `GUARDS: ALL PASS` (exit 0). Все три observe-скрипта →
`VERDICT: PASS`. Host-состояние до/после — идентично.

## Границы

Это не proof свойств ОС: host firewall/PBR/NAT, resolv.conf, реальный TUN и
реальные клиенты — отдельный packet-path/полевой этап (BLOCKED до owner GO).
`urlTest` фиксирован на публичные URL (контракт Builder) и в изолированной
сети не отвечает — детерминизм обеспечен ручным выбором GLOBAL через API.
Вердикт относится к data-plane ядра mihomo с Builder-YAML в lab-топологии и
не заменяет полевую проверку на реальном сервере.

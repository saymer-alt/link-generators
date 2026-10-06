# WG/AWG runtime / reconnect investigation (NIGHT-07 research)

Status: research document. No production behavior changed by this file.
Research-only. Verdict summary at the end.

## Observed symptom (field, not proof of cause)

```text
AWG работает → через время offline при неизменном конфиге → reload/restart → снова работает
```

Наблюдалось на двух роутерах Max и ранее на другом KN-1012. Собранных артефактов
(логи/capture на момент отвала) нет — симптом классифицируется, причина не доказана.

## Environments

| | Mihomo 1.19.31 | Mihomo 1.19.32 |
|---|---|---|
| WG implementation | wireguard-go@a6cecdd7f57f | тот же |
| AWG v1.5/2.x | amneziawg-go@0c1c6f40 device_v1 | тот же |
| AWG v3 | amneziawg-go@0c1c6f40 device/ | тот же |
| WG IP stack (`auto`) | **gVisor** (sing-wireguard StackDevice) на with_gvisor-билдах | **mipstack** (безусловный mips) |
| WG IP stack (явный `ip-stack: gvisor`) | gVisor | gVisor |

## Ответы на обязательные вопросы (кратко, детали ниже)

1. **Config reload пересоздаёт WG/AWG полностью?** Прокси-адаптер — да (новый device,
   новый bind, новый UDP-сокет, новый handshake state). НО: старый device при этом
   **гарантированно не закрывается** — upstream issue [#3255](https://github.com/MetaCubeX/mihomo/issues/3255)
   (open): старый WG живёт до финализатора GC (в idle-процессе до ~2 минут, при живых
   соединениях — неопределённо долго) с тем же приватным ключом → два активных
   source-порта → endpoint flapping у пира.
2. **Full restart отличается?** Да: process restart уничтожает все экземпляры детерминированно.
3. **Stale socket/device переживает reload?** Да — см. п.1 (#3255). Также старый
   экземпляр может остаться при provider-update (та же механика).
4. **WAN/source-IP change может сломать существующий WG instance?** Да — класс
   stale connected UDP socket: `ClientBind` (sing-wireguard `client_bind.go`) создаёт
   **connected** UDP-сокет и переиспользует его, пока тот не закрыт; self-heal
   срабатывает **только при ошибках** (`ReadFrom`/`WriteTo` fail → Close → пересоздание
   при следующей операции). Тихая потеря (NAT mapping истёк, DPI drop, путь без ICMP) —
   без ошибки → сокет жив, handshake'и повторяются «в никуда».
5. **Endpoint DNS stale?** Да — endpoint резолвится при создании instance;
   `endpoint` внутри wireguard-go не пере-резолвится. Механизм есть только при
   `refresh-server-ip-interval: N` (сек; по умолчанию **0 = выключено**):
   `updateServerAddr` (`wireguard.go:591`) переразрешает и обновляет peer через IpcSet.
   Config reload → новый instance → свежий resolve.
6. **MaxHandshakeAttempts terminal state?** В wireguard-go постоянного terminal state
   нет: после неудачной серии handshake повторяется при следующем исходящем пакете
   (пока не истёк `RejectAfter*`). «Terminal» выглядит так только если каждое новое
   попытка упирается в тот же stale socket/сеть — т.е. это симптом 4, а не независимое состояние.
   AWG v3 `max-handshake-attempts` (range) — таймерный параметр того же класса.
7. **PersistentKeepalive решает этот symptom?** Только NAT-класс: поддерживает UDP
   mapping и предотвращает простой. Против stale socket/device (п.4/1) — **не помогает**:
   keepalive-пакеты пишутся в тот же (возможно мёртвый) сокет. Не рекомендуется «всем
   автоматически». — Update v1.9 (#137): в генераторе появилась ЯВНАЯ user-visible policy
   «🛡 Поддерживать AWG-соединение через NAT (keepalive 25 с)» (default ON по решению
   владельца, trace в diagnostic report). Она закрывает только NAT-класс и честно
   позиционируется как NAT/LTE-мера; классы stale socket/device (п.1/4) — не её забота.
8. **NAT expiry может быть trigger?** Да, один из: после expiry первый пакет инициирует
   новый handshake — обычно self-heal (если сокет жив и путь симметричен). Не работает
   при асимметрии/CGNAT/DPI (см. 4).
9. **Upstream issue/fix?** Да:
   - [#3253](https://github.com/MetaCubeX/mihomo/issues/3253) (closed 2026-09-29) —
     **mips IP stack: один ICMP error завершает всю UDP-сессию**; fix:
     [mipstack 3ec3a765c](https://github.com/MetaCubeX/mipstack/commit/3ec3a765c58add571d313de0d)
     + mihomo `60f70cec`.
   - [#3255](https://github.com/MetaCubeX/mihomo/issues/3255) (open) — reload оставляет
     старый device (два устройства с одним ключом → flap).
   - [#3271](https://github.com/MetaCubeX/mihomo/pull/3271) (open PR, «fix: close the
     outdated wireguard device when its replacement starts») — исправление #3255, не слит.
10. **Затронутые версии:** 1.19.31 — #3255 (все сборки); 1.19.32 — #3255 (все сборки);
    mips-класс ICMP-бага — 1.19.31 (явный `ip-stack: mips`) и 1.19.32 **до** бампа
    mipstack; в опубликованном 1.19.32 (mipstack 961d4b1c) основной ICMP-фикс присутствует.
11. **Нужно ли менять generator?** Нет (см. Generator responsibility).
12. **Нужен ли watchdog?** Не для v1.8.0 (риски: ложные restart, обрыв всех прокси,
    flapping, маскировка upstream bug). Кандидат на отдельное owner-решение после
    сбора полевых артефактов.
13. **Что собирать при следующем отвале:** diagnostic bundle ниже.

## Reload vs restart (таблица)

| Событие | WG device | UDP socket | handshake state | endpoint resolve | dialer/стек |
|---|---|---|---|---|---|
| API/UI config reload | новый instance (лениво при первом использовании) | новый | новый | заново (плюс `refresh-server-ip-interval` опционально) | новый |
| Provider update (тот же прокси) | новый instance | новый | новый | заново | новый |
| Полный process restart | новый процесс | новый | новый | новый | новый |
| Ничего (idle) | старый живёт; ICMP-класс (mips): одна ошибка может убить сессию (#3253) | возможно stale | retry в никуда при stale-пути | кеширован навсегда (без refresh-интервала) | без PMTU-фидбэка |

Старый экземпляр после reload: live до GC ≤~2 мин в idle, неопределённо долго при
трафике (#3255) — детерминированного close нет (PR #3271 не смержен).

## AWT-специфика

AWG v1.5/v3 используют тот же bind/стек; отличие только в полях handshake/junk
(NIGHT-03). `RejectAfter*`/`RekeyAfter*`/`MaxHandshakeAttempts` — таймеры: постоянного
terminal state не образуют; «последняя попытка» всегда возобновляется новым outbound
пакетом. Для AWG 3.1 (device/) поведение таймеров то же + `disable-cookies` может
убирать underload-ответы (косметика восстановления — не MTU/путь).

## Log signatures (grep patterns, без секретов)

```text
connect to server            # ClientBind: не смог создать сокет
read packet                  # ошибка чтения (сокет будет пересоздан)
handshake failed             # серия неудачных handshake
RekeyAttemptTime / handshake did not complete
device closed / Close with err
network unreachable / connection refused / i/o timeout / context canceled
endpoint resolve failed / UpdateServerAddr failed
```

## Decision tree для следующего инцидента (ступенчатое восстановление)

```text
Шаг 0. Собрать capture (см. bundle ниже).
Шаг 1. Force /delay по AWG-прокси (controller) и/или сгенерировать трафик.
   → ожил: КЛАСС A (idle/NAT/handshake) — задокументировать интервал простоя.
Шаг 2. Config reload (UI/PUT /configs), не полный restart.
   → ожил: КЛАСС B — reload-механика; собрать: был ли перед этим reload/провайдер-апдейт
     (симптом #3255 — конкуренция двух device).
Шаг 3. Полный restart Mihomo.
   → ожил: КЛАСС C — stale process/runtime state.
   → не ожил: КЛАСС D — внешняя сеть/DPI/провайдер (сменить endpoint/сеть для проверки).
Шаг E. Если routed traffic жив, а карточка/`/delay` мёртвы → КЛАСС E — false-dead
   health-check/reporting (отдельная задача, не сетевая).
```

## Diagnostic bundle (read-only, safe)

Выполнять на устройстве с Mihomo controller (порт/secret — из конфига владельца).
Только GET; никаких POST/PUT/PATCH/DELETE.

```bash
HOST=127.0.0.1:9090            # контроллер Mihomo
SECRET=...                     # secret из конфига, если задан
AWG="<имя AWG-прокси>"
AUTH=(-H "Authorization: Bearer $SECRET")

curl -s "${AUTH[@]}" "http://$HOST/version"
curl -s "${AUTH[@]}" "http://$HOST/configs" | head -c 2000
curl -s "${AUTH[@]}" "http://$HOST/proxies" | head -c 4000
curl -s "${AUTH[@]}" "http://$HOST/proxies/$AWG"
# задержка (только явный замер, изменяет счётчики — выполнять один раз):
curl -s "${AUTH[@]}" "http://$HOST/proxies/$AWG/delay?timeout=5000&url=https://www.gstatic.com/generate_204"
# логи (stream — снимать Ctrl+C после 10–20 сек):
curl -s -N "${AUTH[@]}" "http://$HOST/logs?level=warning"
```

Снимок окружения (Keenetic/Opkg):
```bash
date; opkg list-installed | grep -i mihomo   # или версия из UI/doctor
# WAN/маршруты (read-only):
ip route show; ip rule show
```

Полный чек-лист сбора — см. `WG-AWG-RUNTIME-RECOVERY.md` § Incident capture.

## Incident capture procedure (для владельца)

До любого восстановления:
1. timestamp, Mihomo version (`mihomo -v` или /version), модель роутера, WAN/провайдер;
2. имя AWG-профиля, direct или dialer-proxy (и через кого);
3. обычный интернет работает? другие прокси работают?
4. AWG endpoint reachable? (`ping`/`curl` до endpoint IP:port не всегда возможен — UDP;
   достаточно факта «менялся ли WAN IP»);
5. /proxies/{AWG} + /delay результат;
6. последние 50–100 строк логов;
7. текущий WAN/public IP vs момент, когда работало;
8. был ли failover/переподключение WAN (журнал Keenetic).

Затем ступени восстановления по decision tree, с capture на каждой ступени.

## Generator responsibility

**NO — генератор ничего не меняет.** Контракт эмита корректен (значения/типы
подтверждены NIGHT-03/06); наблюдаемый симптом — runtime/жизненный цикл Mihomo.
Разрешено docs-only: этот документ. Watchdog/auto-restart — не для v1.8.0
(риски ложных рестартов/маскировки upstream бага; отдельное owner-решение при
наличии полевых артефактов). `refresh-server-ip-interval` и `persistent-keepalive`
— не добавляются автоматически; могут быть рассмотрены владельцем как
user-заполняемые опции после сбора артефактов по decision tree.

## Sources

- Issues/PR: [#3253](https://github.com/MetaCubeX/mihomo/issues/3253),
  [#3255](https://github.com/MetaCubeX/mihomo/issues/3255),
  [#3271](https://github.com/MetaCubeX/mihomo/pull/3271),
  fix commit mihomo `60f70cec`, mipstack `3ec3a765c` (+ коммиты
  `5e78149cf`, `98e5ad53a` — ICMP fairness).
- Код: sing-wireguard@c3ae17d19f9e `client_bind.go` (self-heal только по ошибкам),
  mihomo `adapter/outbound/wireguard.go` (`init0` once, `updateServerAddr`,
  `refresh-server-ip-interval`), wireguard-go@a6cecdd7f57f (таймеры handshake).

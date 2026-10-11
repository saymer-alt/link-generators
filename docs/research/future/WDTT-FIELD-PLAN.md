# WDTT — план полевых испытаний на неделе 12–18 октября 2026

**Статус:** ЗАПЛАНИРОВАНО / NOT RUN. Владелец ожидает испытания на ближайшей неделе, без утверждённой даты и оборудования. Это **план доказательств, не разрешение на установку**. Ссылки: [дизайн Builder](WDTT-BUILDER-INTEGRATION.md), [#250](https://github.com/saymer-alt/link-generators/issues/250), [KAS #125](https://github.com/saymer-alt/keenetic-auto-setup/pull/125), [entware-go #10](https://github.com/saymer-alt/entware-go/pull/10).

## A. STOP-gates до любых изменений

1. **Лицензирование:** подтверждён статус fhttp, notices и лицензионная совместимость всех компонентов. До этого допускается **только read-only preflight**, не установка, выдача IPK или обход install-admission. Карантинные бинарники запрещены.
2. **Разрешения:** владелец отдельно согласовал конкретное устройство, тестовый сервер и сетевые действия. Производственные домашние/рабочие Keenetic и production VPS не трогать. KN-4210 и KN-1010 — возможные стенды, если подтвердится доступность и пригодность.
3. **Состояние стенда:** read-only снимок модели, KeeneticOS/kernel, ARM64/MIPSel ABI, RAM/swap, Entware/ext4, портов, текущих сервисов, маршрутов, DNS, VLAN/IPv6, возможности восстановления доступа.
4. **Реальный VK:** заранее подтверждена корректная клиент-серверная пара VK TURN. Логин/секреты — лишь в приватном защищённом файле, не в argv, переписке, PR или логе.
5. **Безопасность:** исключены подмена системного TUN, лишний WireGuard Manager, изменение firewall или DIRECT fallback на production. Перед испытанием есть исходная схема Direct WG и документированный rollback.
6. Если любой gate не пройден — **STOP/BLOCKED**, сохраняем отчёт; не используем локальный Pion TURN как «доказательство VK» и не отключаем проверки ради запуска.

## B. Полевая матрица W1–W10

| Gate | Условие PASS |
|---|---|
| W1 — реальный VK TURN | Доказан обмен через действительный VK TURN endpoint, а не Pion/mock/localhost lab |
| W2 — WireGuard handshake | Свежий WG handshake и увеличение tx/rx с обеих сторон по пути WDTT, без второго WG-демона |
| W3 — TCP | Реальные HTTP/HTTPS-данные проходят через WDTT+WG по ожидаемому выходу; нет незаметного DIRECT |
| W4 — UDP | Передача UDP 64/512/1200/1400 байт, где позволяет MTU, подтверждена счётчиками |
| W5 — DNS | Запросы уходят через предусмотренный резолвер/туннель; нет неожиданных IPv4/IPv6 DNS leaks |
| W6 — NAT/MTU | Проверены потери, фрагментация, NAT/reconnect и MTU; сравнение с тем же стендом на прямом WG |
| W7 — отказ транспорта | Остановка wt-client или разрыв VK прекращают работу fail-closed, без обхода через DIRECT; restart восстанавливает |
| W8 — перезагрузка | При reboot корректны порядок монтирования Entware, запуск службы, отсутствие гонок и чужих процессов |
| W9 — безопасность | UDP-сокет loopback-only; ключи не в argv/stdout/stderr/core/log; нет routing-loop или общедоступного listener |
| W10 — откат | Удалены только собственные файлы/процессы sandbox, первоначальные Mihomo/Entware/KAS/route/firewall сохранены |

**Предлагаемая дополнительная выдержка:** 15–30 минут работы в одной среде с повторением при изменённой сети по возможности. Это не доказательство долговременной стабильности. Измерять CPU %, RSS/PSS, swap, handshake/recovery time, TCP/UDP throughput, packet loss и реальные MTU. Для сравнений нужен Direct WG baseline **на том же стенде**.

## C. Шаблон обезличенного результата

    Дата/время: YYYY-MM-DD, сеть/регион обезличены
    Стенд: модель, версия KeeneticOS, kernel, ABI, RAM, swap, Entware
    Бинарник: коммит/версия, SHA256, происхождение сборки
    Разрешение владельца, preflight и лицензия: PASS|FAIL|BLOCKED
    Тип транспорта: Pion lab | реальный VK TURN (обязательно различать)
    wt-client listener: 127.0.0.1:PORT, network namespace
    IPv4/IPv6, DNS, policy routing, firewall, fail-closed guard:
    Direct WG baseline: handshake, TCP, UDP, DNS, CPU/RSS/throughput
    W1 реальный VK: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W2 handshake: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W3 TCP: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W4 UDP: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W5 DNS: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W6 NAT/MTU: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W7 отказ/restart: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W8 reboot: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W9 security: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    W10 rollback: PASS|FAIL|NOT RUN|BLOCKED — evidence:
    CPU/RSS/MTU/потери/времена восстановления:
    Блокеры и ограничения:
    Решение владельца: продолжить research | доработать | отдельный GO на Builder

Не публиковать WG private keys, VK cookies/token, приватные конфиги, subscription URLs с токенами и секретные IP. Статусы NOT RUN, BLOCKED и INFERRED не считаются PASS.

## D. Что после полевых испытаний

1. Приложить к [#250](https://github.com/saymer-alt/link-generators/issues/250) обезличенный отчёт и ссылки на безопасные доказательства. Сверить результаты с KAS/entware-go PR, не изменяя production.
2. Если fhttp/VK/Keenetic/reboot gate не закрыт — оставить WDTT исследованием; не выдавать пакеты и не обещать возможность установки.
3. Если W1–W10 доказаны — по отдельному разрешению разработать **минимальный** opt-in Builder: обычный WireGuard YAML с локальным endpoint, сохранением оригинального server:port и совместимостью #249 PRIMARY/FALLBACK.
4. После разработки обязательны browser/Mihomo регрессии, RED→GREEN для исправленных багов, полный CI и отдельное решение о продвижении. Выпущенный stable v1.11.0 остаётся нетронутым.

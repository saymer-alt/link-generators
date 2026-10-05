# ROADMAP — backlog после v1.8.0

**Это только документация/backlog.** Здесь зафиксированы направления, которые обсуждались
после feature freeze v1.8.0, чтобы идеи не жили только в чатах. Никакие пункты этого
файла не являются обещаниями, сроками или обязательствами; реализация любого пункта —
отдельная owner-задача. Routing Diagnostics MVP (5/5: Generated Policy Inspector,
Human-readable Preview, Duplicate Detector, Strict Shadow Analyzer, Rule Provider
Explorer) завершён в v1.8.0; новые крупные функции до релиза v1.8.0 не добавляются.

## 1. Routing Diagnostics после v1.8.0

- **Domain Coverage Checker** — проверка покрытия: какие домены из пользовательских
  списков/политик реально попадают в правила итогового конфига.
- **Extended Dead/Unused analysis** — расширение текущих UNUSED/missing-пометок
  Explorer'а на группы и прокси (мертвые цели правил, пустые группы).
- **Routing Graph** — граф `rule → provider → group → proxy` с визуализацией цепочек.
- **DNS ↔ Routing consistency** — сверка DNS-секции (fake-ip, nameservers) с
  фактическими правилами маршрутизации.
- **Provider live health / external-provider checks** — проверки доступности внешних
  провайдеров; **только opt-in** и только по явному действию пользователя (приватный
  контракт страницы: никаких фоновых запросов).
- **What-if routing simulator** — «что будет с доменом, если добавить/убрать правило»;
  поздняя идея, после остальных пунктов.

## 2. MRS (отдельный future block)

Не смешивать с Rule Provider Explorer: Explorer намеренно показывает MRS как
«metadata-only, contents unavailable offline».

- MRS viewer;
- MRS parser/decode;
- converter (yaml/text → mrs и обратно);
- builder/generator MRS-файлов.

Любая работа с MRS — отдельный owner-цикл с собственным решением о формате и рисках.

## 3. Known services / domains (curated catalog)

Идея: справочник вида

```text
service → domains → IP/CIDR → source
```

с обязательными оговорками:

- данные меняются со временем — любой срез устаревает;
- ни один внешний каталог не является абсолютной истиной;
- нужны provenance (кто/откуда/когда) и update policy, иначе каталог молча протухает.

Reference для будущего исследования: **OpenCCK IP List** — `iplist.opencck.org/ru/`.
Оценка:

- полезен как reference и source of ideas;
- каталог неполный;
- не копировать автоматически;
- не считать source-of-truth.

Сюда же относятся отложенные идеи:

- **service presets** (готовые наборы «сервис → список доменов» для политик);
- **known-domain collections** (курируемые коллекции доменов по сервисам);
- **optional remote subscriptions / Gist-style maintained lists** — опциональные
  удалённые списки в стиле существующего Gist-подписочного контракта
  (см. [GIST-SUBSCRIPTION.md](GIST-SUBSCRIPTION.md));
- **coverage comparison** — сравнение покрытия наших списков с внешними источниками.

## 4. MTU auto-planner (заблокирован live-PoC гейтом)

Исследование v1.8.0 (source-pinned): формула вложенности `innerA + 32 (WG hdr+tag) + S4/contentPadding-worst ≤ MTU_B` структурно подтверждена исходниками (wireguard-go MessageTransportSize=32; amneziawg-go v3 `elem.padding = paddings.transport` пер-пакетно; calculatePaddingSize с cap по mtu), НО auto-correction в v1.8.0 **не включён**. Для включения нужны live-PoC на управляемых endpoints: 1–4 хопа (WG/WG, WG/AWG, AWG/WG, AWG/AWG), ping DF max-payload, TCP/UDP throughput, packet capture wire sizes, сравнение auto-MTU vs known-safe ручной MTU на 1.19.31 и 1.19.32. До этого: imported MTU сохраняется, diagnostics-only.

## 5. Остальной backlog link-generators

- **YAML 1.1 scalar hardening** — аккуратность с `yes/no/on/off/y/n` как булевыми
  скалярами YAML 1.1 в пользовательских вводах и примерах.
- **optional production Pages smoke** — необязательная автоматическая smoke-проверка
  опубликованной Pages-страницы после promotion.
- **optional RELEASE-FIELD-TEST document** — шаблон/документ полевого теста релиза.
- **configurable controller port** — только при реальной коллизии порта 9090;
  без задачи не делать.
- **provider/data provenance improvements** — происхождение и свежесть данных
  (в т.ч. для каталогов из §3).

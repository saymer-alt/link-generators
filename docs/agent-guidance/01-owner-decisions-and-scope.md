# Owner decisions, scope and composition

> **Relocated source guidance (2026-11-07).** Original owner decisions and scope. Dated decisions and incidents are evidence; confirm current code, active owner intent and branch state before acting.
> This is **task-scoped reference material**, not the unconditional agent startup file. Binding safety rules in [root AGENTS.md](../../AGENTS.md) and [CONSTITUTION.md](../../CONSTITUTION.md) still apply. The material below preserves all original sections in their former order (except that Markdown relative link targets are rebased for this directory); "this file" in old prose means the former root AGENTS.md.

---

> **Обязательно для всех агентов и постановщиков задач (решение владельца 30.10.2026):** [Общий контракт подробных технических заданий без «эффекта обезьяньей лапки»](https://github.com/saymer-alt/saymer-alt/blob/main/AGENT-TASK-CONTRACT.md). Перед реализацией прочитать его, проверить исходные refs/SHA и готовые наработки, подробно зафиксировать цель, scope, non-goals, защищённые данные, зависимости, owner GO, негативные проверки и Definition of Done. Не сокращать существенные требования ради токенов. Формальный результат, нарушающий смысл задачи, — **FAIL**. Местные safety/architecture-правила сохраняются.

> **Владелец, 26.10.2026 — общее правило для всех проектов:** перед внедрением новой функции / серьёзной переделки требуется короткая «защита идеи» — доказать проблему, сравнить альтернативы (включая ничего не менять / штатную ОС / ждать upstream), оценить пользу, **ТЭО**, стоимость сопровождения, риски, измеримый тест и критерии STOP. Нет доказательства пользы — DEFER/SKIP. Мелкие исправления не требуют отдельной бюрократии. **Источник:** [Proof Before Build](https://github.com/saymer-alt/saymer-alt/blob/main/PROOF-BEFORE-BUILD.md) ([центральный PR #9](https://github.com/saymer-alt/saymer-alt/pull/9)). Существующие safety/CI/permissions сохраняются.

# AGENTS.md — link-generators

## Owner decision — WORKING-FIRST, bounded licensing review (11.10.2026)

- Keep approved functional releases, security/CI gates, and tested workflows
  moving when an unrelated, routine third-party license/NOTICE audit remains
  incomplete (especially the historical experimental WDTT review, tracked at
  [KAS #126](https://github.com/saymer-alt/keenetic-auto-setup/issues/126)).
  **Do not reopen a generic licensing questionnaire** in every unrelated task.
- This is **not** an exemption from software licenses: personal/non-commercial
  work and public GitHub do not grant redistribution rights. Preserve applicable
  copyright, license and NOTICE obligations. If a *specific verified*
  distribution conflicts with them, block or fix **that affected distribution**,
  surface exact evidence and owner decision, not a blanket freeze on independent
  components.
- Existing supply-chain integrity, credential-safety, fail-closed, regression,
  explicit Owner GO and immutable-release safeguards remain mandatory.
- Revisit broad attribution/license research on owner request or new concrete
  evidence. The original dated [PR #256](https://github.com/saymer-alt/link-generators/pull/256)
  is historical context, not a branch to merge over later AGENTS changes.


> **Стандарт проверки ИИ-изменений (30.10.2026):** [CONSTITUTION.md §11](../../CONSTITUTION.md) и [общий стандарт (PR #11)](https://github.com/saymer-alt/saymer-alt/pull/11): реальный пользовательский путь, blast radius, подтверждённые измерения и регрессионные доказательства. Не отменяет release invariant и owner GO.

## Owner-wide design gate — SIMPLICITY-FIRST (2026-10-24)

Before adding a new subsystem, UI, installer/uninstaller, controller, watcher, multi-stage recovery mechanism, or expensive CI path, apply the [common saymer-alt simplicity rule](https://github.com/saymer-alt/saymer-alt/pull/7): compare (A) the existing/manual workflow, (B) the smallest safe solution, and (C) extended architecture. Choose A/B by default; C needs evidence of need, a maintenance/test-cost estimate and explicit owner approval. If supporting logic grows into its own platform or repeated full E2E runs add no new evidence, STOP expanding and report alternatives. Preserve existing safety invariants, user data, foreign resources and working behavior; this does not authorize refactoring stable code or changing production. [KAS uninstall #225](https://github.com/saymer-alt/keenetic-auto-setup/issues/225) is an **anti-pattern retrospective**, not a template to copy.

## Owner intent — why four VPS and multiple Mihomo tiers exist (2026-10-25)

**Do not ask again “why so many VPS/protocols/tiers?” as if these were accidental complexity.** The owner intentionally designed four autonomous VPS (SE, SE2, EE, MSK), diversified ingress transports, locally ordered Mihomo egress/failover, ENTRY/TRANSIT/EXIT separation, and fail-closed user data paths in response to recurring ISP/protocol/IP-prefix/UDP/DNS failures and censorship. The goal is to survive *different classes of failure*, not collect technologies or mandate five identical tiers everywhere. **Mandatory reference:** [owner rationale / VPS PR #42](https://github.com/saymer-alt/vps-gateway-bootstrap/pull/42) (proposed canonical `docs/OWNER-THREAT-DRIVEN-RESILIENCE.md`) and this repo's [v1.12 architecture #292](https://github.com/saymer-alt/link-generators/issues/292).

Before changing Builder's VPS profiles, GLOBAL/Tiered, Physical Topology or provider handling, demonstrate that manual override, each server's independent tiers, service/bootstrap connections, allowed egress and no silent DIRECT/fail-closed, working YAML compatibility, and useful observability are preserved. Prefer *simple autonomous components* and the smallest justified change; do **not** build a fleet manager, force every VPS into one graph, or delete meaningful fallback just to make a diagram/config shorter. This documents owner intent, **not** permission to alter `main`, `stable`, actual VPS, router settings or release scope.

## Owner composition principle and agent intent algorithm (18.10, consolidated 31.10)

Владелец проектирует сложные системы из множества простых автономных компонентов — «кирпичиков», каждый из которых выполняет ровно одну ограниченную роль и не обязан знать всю схему. Логику общей схемы, связи, режимы отказа и совместимость проектирует архитектор, а не всезнающий модуль. Сложность живёт в композиции и контрактах, а не в сложности отдельного компонента. Полная формулировка и универсальные примеры — [CONSTITUTION.md, «Принцип композиции»](../../CONSTITUTION.md); инвариант автономной многослойной архитектуры — в разделе «Owner intent» выше.

**Алгоритм агента перед нетривиальным изменением:**

1. **Восстановить намерение:** какую реальную проблему решает владелец, какой эффект ожидается и какие рабочие сценарии обязаны сохраниться. Не заменять смысл простой проверкой отсутствия слова/файла/функции.
2. **Проверить контекст:** AGENTS, связанные issue/PR, историю решений, рабочие режимы и тесты. Зафиксировать инварианты «что должно измениться» и «что НЕ должно ухудшиться».
3. **Оценить побочные эффекты:** перед запретом, удалением опции, сменой default или перестройкой маршрутизации перечислить, кто пострадает и есть ли менее разрушительная альтернатива.
4. **Спросить владельца до необратимого или крупного компромисса**, если существенная неоднозначность остаётся. Краткий вопрос с 2–3 вариантами, последствиями и рекомендацией. **Не считать молчание разрешением.** Пока ответа нет — обратимое исследование/черновой PR с явно отмеченным блокером.
5. **Выбирать наименее разрушительное решение:** массовый `Build blocked`, скрытие вкладки, удаление подсистемы или изменение существующих проектов не эквивалентны исправлению одной функции без прямого согласия владельца.
6. **Приёмка по поведению:** негативный тест на устранённую проблему + позитивные регрессии прежних рабочих сценариев. Красный CI и отключённые тесты нельзя объявлять «готово».
7. **Границы полномочий:** `stable`, рабочие серверы, сети, релизы — только по отдельному явному разрешению.

**Разбор инцидента #284 / PR #286 (пример анти-паттерна):** запрос «не допускать прямой выход пользовательского трафика с IP VPS» был исполнен как буквальный запрет токена `DIRECT` везде, что шире исходной задачи: служебная загрузка подписок через `proxy-providers.*.proxy` и настройка транспортов не тождественны маршруту пользовательского `MATCH`/групп. Запретив весь Sub Mode ON или часть Physical Topology, можно убрать строку `DIRECT`, но ухудшить продукт. Всегда разделять **user-data-plane vs service/control-plane** и сохранять рабочие подписки, построение транспорта и ручное управление; неоднозначное — на решение владельца. Не трактовать пример как разрешение на произвольный прямой служебный трафик: допустимые исключения одобряет владелец.

## Addendum: automatic whitelist mode

See [docs/AUTO-WHITELIST.md](../../docs/AUTO-WHITELIST.md). UI policy remains here;
generic `fallbackInput` and flat primary/fallback GLOBAL live in the fork. Absence of
`fallbackInput` preserves the previous output. `tests/whitelist.cjs`,
baseline, real Mihomo -t, and `tests/mihomo-failover.cjs` are mandatory; the source suite includes `mihomo-priority.test.mjs`.

Instructions for AI agents (primarily ZCode) working in this repository.
There are three documentation layers: **README.md** — user-facing landing page (what it is and
how to use it), **docs/** — detailed technical knowledge base (architecture, dataflow,
protocols, validation, runtime updates, testing), **this file** — agent rules.
If they disagree, trust the code; fix documentation that disagrees with code, and change code
only for an explicit owner task.


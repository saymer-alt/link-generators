# Release Field Test v1.10 — RESULTS TEMPLATE

> ## ⚠️ DO NOT COMMIT REAL SECRETS / SUBSCRIPTION URLS / KEYS / TOKENS ⚠️
>
> Заполнять ЛОКАЛЬНО. Не пушить заполненную версию в репозиторий, если в неё попали
> реальные данные. В issue/отчётах указывать только: имена узлов (display names),
> counts, классы форматов, тексты ошибок — sanitized.
> Никаких готовых «полей для секрета» в шаблоне нет намеренно.

Заполняй по ходу прогона RUNBOOK
([docs/RELEASE-FIELD-TEST-v1.10-RUNBOOK.md](RELEASE-FIELD-TEST-v1.10-RUNBOOK.md)).
Каждый пункт: `RESULT: PASS / FAIL / NOT TESTED` + evidence + notes.

## Environment

```text
Generator SHA (main): 13a21f65d7b87038ba25e82e3ccdc9057c2e4c3e (или актуальный на момент теста)
Бейдж страницы:        v1.10.0-dev · MAIN  (подтверждено: да/нет)
Браузер:               <браузер и версия>
Устройство/роутер:     <модель, без серийников>
Mihomo version:        <вывод mihomo -v>
Сеть:                  <тип сети, без адресов>
Дата прогона:          <дата>
```

## Tests

### [ ] Home baseline (RUNBOOK §1)

```text
RESULT: PASS / FAIL / NOT TESTED
EVIDENCE: mihomo -t вывод (успех), факт трафика
NOTES:
```

### [ ] Subscription preview (RUNBOOK §2)

```text
RESULT: PASS / FAIL / NOT TESTED
EVIDENCE: 2A success refresh / 2B stale / 2C UNKNOWN≠0 / 2D union+resizable — по строке на каждый
NOTES:
```

### [ ] Identity (RUNBOOK §3)

| Action | Expected local | Expected remote hypothesis | Actual | PASS/FAIL |
|---|---|---|---|---|
| Reload | | | | |
| Rebuild same device | | | | |
| Rename | | | | |
| Device Model change | | | | |
| Second identity (intentional) | | | | |
| Delete extra | | | | |

```text
RESULT: PASS / FAIL / NOT TESTED
NOTES: remote-проверка выполнялась? да/нет (если нет — FIELD-OBSERVED: not checked)
```

### [ ] Runtime import — direct controller (RUNBOOK §4B)

```text
RESULT: PASS / FAIL / NOT TESTED
EVIDENCE: сводка «Провайдеров/Узлов/Уникальных имён» (числа), без адресов
NOTES: код ответа curl при диагностике (если была): 200/401/403/timeout
```

### [ ] Runtime import — paste/upload (RUNBOOK §4C)

```text
RESULT: PASS / FAIL / NOT TESTED
NOTES:
```

### [ ] Preview/runtime reconciliation (RUNBOOK §5)

```text
RESULT: PASS / FAIL / NOT TESTED
EVIDENCE: ∩ = N · только preview = N (имена) · только runtime = N (имена)
```

### [ ] AEZA / runtime-only exclude (RUNBOOK §5)

```text
RESULT: PASS / FAIL / NOT TESTED / N/A (узла нет в этом прогоне)
EVIDENCE: имя узла в exclude-filter (exact), факт исчезновения после reload provider
NOTES: AEZA в preview в этом прогоне: да/нет (записывать как есть)
```

### [ ] Tiered failover (RUNBOOK §6)

```text
RESULT: PASS / FAIL / NOT TESTED
EVIDENCE:
- Tier1 alive → группа: ______, трафик: ок/нет
- отказ Tier1 → переключение на Tier2: ≈______ с (наблюдение, не SLA)
- возврат Tier1 → failback: ≈______ с (наблюдение, не SLA)
- race fix (#165): select → re-render → Add: PASS/FAIL
NOTES: UDP не тестировался (не заявлен)
```

### [ ] WG plain (RUNBOOK §7)

```text
RESULT: PASS / FAIL / NOT TESTED
EVIDENCE: бейдж WG · уверенность exact · mihomo -t successful · runtime ______
```

### [ ] AWG legacy/classic (RUNBOOK §7)

```text
RESULT: PASS / FAIL / NOT TESTED / N/A (профиля нет)
EVIDENCE: бейдж ______ · уверенность ______ · mihomo -t ______ · runtime ______
NOTES: маркеры в профиле (имена полей, без значений):
```

### [ ] AWG 3.0-like (RUNBOOK §7)

```text
RESULT: PASS / FAIL / NOT TESTED / N/A (профиля нет)
EVIDENCE: бейдж ______ · уверенность ______ · mihomo -t ______ · runtime ______
```

### [ ] AWG 3.1 (RUNBOOK §7)

```text
RESULT: PASS / FAIL / NOT TESTED / N/A (профиля нет)
EVIDENCE: бейдж ______ · уверенность ______ · mihomo -t ______ · runtime ______
```

### [ ] Privacy sweep (RUNBOOK §8)

```text
RESULT: PASS / FAIL / NOT TESTED
EVIDENCE:
- HWID в UI: не встречался / встречался (где)
- secret в UI/статусах: нет / да
- subscription URL в предупреждениях: [URL hidden] / утечка
- Runtime Import: только имена / видел server/UUID/password
- localStorage: только identity-registry (ожидалось) / лишнее (что)
```

## Итог

```text
PASS: ______ / FAIL: ______ / NOT TESTED: ______
Release-blocking (P0/P1) находки: ______ (или «нет»)
Готовность recommendation: GO / NO-GO / GO после fix (какого)
```

# Portable Builder Project — формат `.lgproject.json` v1 (OWNER-REVERSE-01, PHASE B)

Дата: 2026-10-09. Цель: точное сохранение и восстановление проекта генератора (версия Owner-Reverse-01 §PHASE B). Связанные: [REVERSE-BUILD-RECOVERABILITY.md](REVERSE-BUILD-RECOVERABILITY.md) (что вообще восстановимо), [REVERSE-BUILD-ARCHITECTURE.md](REVERSE-BUILD-ARCHITECTURE.md) (компоненты).

## 1. Требования

- Versioned (`schemaVersion`), явная миграция вперёд.
- Сохраняет поддерживаемое состояние `rbCollectProject`, включая то, чего в YAML не бывает (URL развёрнутых подписок, имена WG-файлов) — т.е. восполняет все MISSING из RECOVERABILITY §2.
- Секреты (ключи WG, токены подписок) — ВНУТРИ файла по необходимости (иначе восстановление бессмысленно), поэтому: экспорт только по явному действию; предупреждение о конфиденциальном содержимом; никаких auto-save/upload/localStorage; никаких секретов в логах.
- Круглыйtrip: import → Build (тот же движок, те же входные данные) = эквивалент первоначальной сборки; для детерминированных synthetic fixtures — byte-for-byte (единственный недетерминизм известен: `header.x-hwid` — случайный 32-hex на сборку, SOURCE-PROVEN mihomo.js:757; паритет проверяется с нормализацией этой строки, как в существующих тестах).

## 2. Формат v1

```jsonc
{
  "schemaVersion": 1,
  "meta": {
    "app": "link-generators",
    "created": "2026-10-09T00:00:00Z",       // информационное
    "generatorVersion": "<GENERATOR_META на момент экспорта>",  // информационное
    "origin": "builder"                       // builder | yaml-reverse
  },
  "sources": {
    "subMode": true,
    "mainInput": "https://sub1.example/…\nhttps://sub2.example/…",   // дословно textarea
    "fallbackInput": "",               // whitelistInput (AWL)
    "autoWhitelist": false
  },
  "wgProfiles": [
    {
      "id": 1,                          // стабильный id в рамках проекта
      "filename": "server.awg",         // исходное имя файла (иначе MISSING в YAML-only)
      "bean": { /* полный parseWireGuardConf-выход, включая секретные поля */ },
      "mode": "direct",                 // direct | proxy
      "target": ""                      // dialer-таргет при mode=proxy
    }
  ],
  "options": {
    "profile": "router",                // router | vps-local | vps-gateway
    "addTun": true, "tunMips": true, "tunStackAdvanced": false, "tunStackEx": "gvisor",
    "addSocks": false, "lan": false,
    "perProxyMaster": false, "perProxyTun": false, "perProxySocks": false,
    "webUI": false, "webUiDashboard": "metacubexd", "webUiCustomUrl": "",
    "urlTestPreset": "https://www.gstatic.com/generate_204", "urlTestCustomUrl": "",
    "excludeFilter": "",                // ручное поле; выбор server-list — отдельно
    "serverList": { "names": [], "nodes": 0, "selected": [] },   // выбор из списка серверов
    "realityModern": "",                // исходный текст realityModernInput
    "deviceModel": "",
    "wgCustomDns": "",
    "awgKeepalive": false, "awgRtDiag": false,
    "vpsDnsEnabled": true, "vpsDevice": "", "vpsMtu": "", "vpsFakeIp": "",
    "vpsDnsListen": "", "vpsDnsNs": "", "vpsProxyNs": ""
  },
  "dialer": { "name": "", "members": "", "providers": "" },
  "domainPolicy": { "enabled": true, "cards": [ { "name": "ai", "domains": "…", "target": "SELECT" } ] },
  "tiered": { "enabled": false, "cards": [ { "name": "…", "strategy": "url-test", "members": [] } ] },
  "passthrough": null                   // для yaml-reverse: UNSUPPORTED raw-объекты (§4)
}
```

Правила:
- JSON-структуры зеркалят DOM-поля 1:1 (id элемента → имя поля задокументировано в реализации); никакой «умной» нормализации при экспорте.
- `bean` WG-профиля — структура web4core (совместима с `wgProfiles` напрямую); приватные ключи не маскируются В ФАЙЛЕ (иначе Restore бесполезен), но маскируются во всех отображениях.
- Порядок массивов значим (подписки, профили, карточки, tier-члены) — часть контракта.
- Сохраняются serverList names/nodes/selected для продолжения выбора фильтра. Не сохраняются runtime evidence, controller secrets и dialer-targets cache; это не полный снимок вкладки.

## 3. Миграция

`schemaVersion` целочисленный. Текущий reader поддерживает schemaVersion 1. Более новая версия отклоняется, неподдерживаемая старая — тоже. Будущие миграции не реализованы и не обещаются.

## 4. Passthrough (UNSUPPORTED из YAML-reverse)

Если проект создан через YAML Reverse Build, объекты вне модели Builder (`passthrough`) сохраняются как JSON-совместимые parsed-объекты; полная исходная модель находится в `passthrough['source-config']`. Это evidence для восстановления, а не raw YAML: комментарии, порядок форматирования и исходные байты не сохраняются. Save Project сохраняет passthrough; новый Build его не накладывает. Предупреждение об этом показывается до подтверждения Restore (CONSTITUTION §3 — raw-факт не исчезает молча).

## 5. Безопасность

- Экспорт: явная кнопка → предупреждение «файл содержит приватные ключи и токены» → скачивание через Blob (как существующий экспорт config.yaml).
- Импорт: bounded (размер-лимит как у csLoadBounded, JSON.parse, shape-валидация, глубина), секреты остаются в памяти вкладки.
- Не попадает: localStorage, логи, статусы, диагностики, CI-артефакты; тестовые фикстуры — только синтетические (example.invalid, RFC5737, синтетические base64-ключи вида `SYNTH_…`).
- Шифрование файла — вне v1 (если потребуется — WebCrypto AES-GCM + passphrase, отдельное решение).

## 6. Тест-план (PHASE F/G — часть PR B)

1. Roundtrip: Builder (6 подписок + 8 WG/AWG) → export → import (чистая вкладка) → полевое сравнение всех DOM-полей/wgProfiles → Build → byte-parity против исходного Build (нормализация x-hwid).
2. Модификация: −1 AWG, +2 подписки → Build → 8 подписок / 7 WG, остальные эквивалентны, без dangling refs (проверка через CDG).
3. Секреты: ключи в bean не меняются ни на одном шаге; ни одно отображение их не показывает.
4. Миграция: v1 файл читается; битый/чужой JSON — bounded-ошибка.
5. Мобильные 320–480 и клавиатура — в PR E (browser-сюита).

## 7. Фактические границы reader после независимого аудита

Размер до 2 МБ, глубина до 64, до 50000 посещений; опасные ключи отклоняются. Boolean/string options проверяются по типу, WG IDs положительные и уникальные; до 2000 WG profiles, 256 cards, 5000 элементов в ограниченных списках. Dashboard values: metacubexd / yacd / zashboard / custom. Load всегда показывает counts/typed Compare и требует Confirm, даже в пустой сессии; Cancel ничего не меняет. Состояние, изменённое за время чтения файла, не перезаписывается. Apply валидирует до мутации, откатывает ошибку и инвалидирует async Build. Undo хранится только в памяти. Поддерживаемое состояние — поля `rbCollectProject`, а не весь UI или running core.

# Portable Builder Project — формат `.lgproject.json` v1 (OWNER-REVERSE-01, PHASE B)

Дата: 2026-10-09. Цель: точное сохранение и восстановление проекта генератора (версия Owner-Reverse-01 §PHASE B). Связанные: [REVERSE-BUILD-RECOVERABILITY.md](REVERSE-BUILD-RECOVERABILITY.md) (что вообще восстановимо), [REVERSE-BUILD-ARCHITECTURE.md](REVERSE-BUILD-ARCHITECTURE.md) (компоненты).

## 1. Требования

- Versioned (`schemaVersion`), явная миграция вперёд.
- Сохраняет ВСЁ состояние Builder, включая то, чего в YAML не бывает (URL развёрнутых подписок, имена WG-файлов) — т.е. восполняет все MISSING из RECOVERABILITY §2.
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
    "urlTest": "https://www.gstatic.com/generate_204", "urlTestCustom": false,
    "excludeFilter": "",                // ручное поле; выбор server-list — отдельно
    "serverList": { "names": [], "selected": [] },   // выбор из списка серверов
    "realityModern": "",                // исходный текст realityModernInput
    "deviceModel": "",
    "wgCustomDns": "",
    "awgKeepalive": false, "awgRtDiag": false
  },
  "dialer": { "name": "", "members": [], "providers": [] },
  "domainPolicy": { "enabled": true, "cards": [ { "name": "ai", "domains": "…", "target": "SELECT" } ] },
  "tiered": { "enabled": false, "cards": [ { "name": "…", "strategy": "url-test", "members": [] } ] },
  "passthrough": null                   // для yaml-reverse: UNSUPPORTED raw-объекты (§4)
}
```

Правила:
- JSON-структуры зеркалят DOM-поля 1:1 (id элемента → имя поля задокументировано в реализации); никакой «умной» нормализации при экспорте.
- `bean` WG-профиля — структура web4core (совместима с `wgProfiles` напрямую); приватные ключи не маскируются В ФАЙЛЕ (иначе Restore бесполезен), но маскируются во всех отображениях.
- Порядок массивов значим (подписки, профили, карточки, tier-члены) — часть контракта.
- Не сохраняются runtime-снимки (preview-списки серверов, runtime evidence, dialer-targets cache) — только пользовательский ввод.

## 3. Миграция

`schemaVersion` целочисленный. Reader принимает N ≤ текущего; N < current → прогон упорядоченных миграций; N > current → явный отказ «файл создан более новой версией». Миграции — чистые функции с тестами.

## 4. Passthrough (UNSUPPORTED из YAML-reverse)

Если проект создан через YAML Reverse Build, объекты вне модели Builder (`passthrough`) сохраняются в файл как raw-YAML-фрагменты с доказуемой привязкой (ключ верхнего уровня / индекс в массиве) и статусом UNSUPPORTED. Повторный экспорт после Build НЕ претендует на них: они присутствуют в отчёте сравнения как «не перенесено» (CONSTITUTION §3 — raw-факт не исчезает молча).

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

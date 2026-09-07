# WARP & Mihomo Unified Generator

Клиентский генератор ссылок и конфигураций для обхода глубокого анализа трафика (DPI) и сборки конфигов Mihomo. Всё выполняется локально в браузере: вводимые данные никуда не отправляются и не сохраняются.

🌐 **Live Demo:** [saymer-alt.github.io/link-generators](https://saymer-alt.github.io/link-generators/)

---

## ⚡ Ключевые возможности

*   **Умная генерация MASQUE:** Создание ссылок `masque://` (QUIC и HTTP/2) с использованием взвешенного рандома безопасных портов (443, 8443, 4443, 8095) и анти-корреляцией IP-адресов.
*   **Импорт из YAML:** Вставка конфига от Telegram-бота — ключи, IP, SNI и DNS заполняются автоматически.
*   **Mihomo Config Builder:** Сборка полноценных конфигураций из ссылок (VLESS, VMess, Trojan, SS, Hysteria2, TUIC, MASQUE, Mieru, TrustTunnel и др.), HTTP(S)-подписок и файлов WireGuard/AmneziaWG (`.conf`, `.awg`).

---

## 📖 Как этим пользоваться?

Генератор разбит на две вкладки, закрывающие разные сценарии.

### Сценарий 1: Быстрая генерация MASQUE-ссылок
Если у вас есть YAML-конфиг от Telegram-бота:
1. Откройте вкладку **⚡ WARP MASQUE Links**.
2. Вставьте текст конфига в верхнее окно и нажмите «Распарсить» (ключи и IP заполнятся автоматически).
3. Укажите нужное количество пар и нажмите «Сгенерировать ссылки». 
4. Полученные ссылки можно сразу отправить в Mihomo Builder одной кнопкой.

### Сценарий 2: Сборка конфига Mihomo
Чтобы получить готовый `config.yaml` из разрозненных ссылок и WireGuard-конфигов:
1. Откройте вкладку **⚙️ Mihomo Config Builder**.
2. Вставьте ссылки (`vless://`, `masque://`, …) или HTTP(S)-подписку в верхнее текстовое поле.
3. При необходимости нажмите кнопку **«📂 Загрузить .conf / .awg»** и выберите файлы WireGuard/AmneziaWG.
4. Отметьте нужные опции (Allow LAN, Mixed Port, TUN, Sub Mode, health-check endpoint) и нажмите **«Build Config»**.
5. Скопируйте готовый YAML кнопкой **«Copy YAML»**.

---

## Credits

Based on [web4core](https://github.com/spatiumstas/web4core) by [spatiumstas](https://github.com/spatiumstas) (BSD-3-Clause).

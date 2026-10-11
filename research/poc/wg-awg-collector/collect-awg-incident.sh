#!/bin/sh
# collect-awg-incident.sh — READ-ONLY сборщик снимка WG/AWG-инцидента
# (NIGHT-MEGA-01 TRACK B3; проект из docs/research/future/WG-AWG-WATCHDOG.md §4).
#
# НЕ production-код keenetic-auto-setup: исследовательский PoC, живёт в
# research/poc/. Запуск — ТОЛЬКО вручную на роутере во время инцидента.
#
# Гарантии:
#   - ни одной мутирующей команды (нет set/conf/restart/rm; только show/dump/
#     cat/logread/curl GET/date/uptime);
#   - секреты маскируются ДО записи файла (PrivateKey/PresharedKey/приватные
#     подсети); публикация снимка всё равно требует ручной проверки владельцем;
#   - отсутствие инструмента — не ошибка: секция помечается SKIPPED;
#   - выход: один файл incident-YYYYMMDD-HHMMSS.txt в текущем каталоге.
#
# Использование: sh collect-awg-incident.sh [iface]
#   iface — интерфейс WireGuard/AmneziaWG (по умолчанию: авто-детект по
#   выводу `awg show`/`wg show`; детект тоже read-only).

# ---------- каркас ----------

SELF_NAME="collect-awg-incident"
STAMP="$(date -u +%Y%m%d-%H%M%S 2>/dev/null || date +%Y%m%d-%H%M%S)"
OUT="incident-${STAMP}.txt"

log_section() {
  printf '\n===== [%s] %s =====\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
}

# run <section> <command...> — выполнить read-only команду в секцию;
# отсутствие бинаря или ненулевой код = SKIPPED-пометка, не фейл.
run() {
  _sec="$1"; shift
  log_section "$_sec"
  if command -v "$1" >/dev/null 2>&1; then
    "$@" 2>&1
    _rc=$?
    if [ "$_rc" -ne 0 ]; then
      printf '[collector] %s завершилась с кодом %s (секция помечена SKIPPED)\n' "$1" "$_rc"
    fi
  else
    printf '[collector] SKIPPED: %s не найден\n' "$1"
  fi
}

# mask_stream — фильтр секретов для потока (stdin → stdout).
# Маскируются: PrivateKey/PresharedKey-значения, ключевые строки awg/wg dump
# (3-е поле = private key интерфейса; 4-е поле = preshared key пира).
mask_stream() {
  sed -E \
    -e 's/(PrivateKey|PresharedKey)[[:space:]]*=[[:space:]]*[^[:space:]]+/\1 = ***MASKED***/g' \
    -e 's/(private[-_]?key|preshared[-_]?key)[":[:space:]]+["]?[A-Za-z0-9+\/=]{20,}["]?/\1 = ***MASKED***/Ig'
}

# mask_dump — для `awg show <iface> dump`: строка 1 = интерфейс (поле 1 —
# private key); строки пиров = public key(1), preshared key(2), endpoint(3),
# allowed-ips(4), … Маскируем: private key интерфейса и PSK пиров. Публичные
# ключи и allowed-ips ОСТАЮТСЯ (диагностическая ценность локального снимка).
mask_dump() {
  awk 'NR == 1 { $1 = "***MASKED***"; print; next }
       NF >= 2  { $2 = "***MASKED***"; print }
       NF == 1  { print }'
}

# ---------- заголовок ----------

{
  printf '# WG/AWG incident snapshot (%s)\n' "$SELF_NAME"
  printf '# READ-ONLY collection; secrets masked; review before publishing.\n'
} > "$OUT"

# ---------- системный уровень ----------

log_section "system/date-uptime" >> "$OUT"
{ date; uptime; } >> "$OUT" 2>&1

run "system/logread-tail" logread -n 200 >> "$OUT" 2>&1 || true

# ---------- интерфейсный уровень ----------

IFACE="${1:-}"
WG_BIN=""
if command -v awg >/dev/null 2>&1; then WG_BIN="awg"; elif command -v wg >/dev/null 2>&1; then WG_BIN="wg"; fi

log_section "wg/summary (${WG_BIN:-none})" >> "$OUT"
if [ -n "$WG_BIN" ]; then
  if [ -z "$IFACE" ]; then
    IFACE="$("$WG_BIN" show 2>/dev/null | mask_stream | awk 'NR==1{print $1}')"
  fi
  "$WG_BIN" show 2>&1 | mask_stream >> "$OUT"
else
  printf '[collector] SKIPPED: ни awg, ни wg не найдены\n' >> "$OUT"
fi

if [ -n "$IFACE" ] && [ -n "$WG_BIN" ]; then
  log_section "wg/dump ($IFACE)" >> "$OUT"
  "$WG_BIN" show "$IFACE" dump 2>&1 | mask_dump >> "$OUT"
fi

run "ip/addr" ip addr show "$IFACE" >> "$OUT" 2>&1 || true
run "ip/routes-all" sh -c 'ip route show table all 2>&1' >> "$OUT" 2>&1 || true

# ---------- mihomo уровень ----------

MIHOMO_URL="${MIHOMO_URL:-http://127.0.0.1:9090}"
log_section "mihomo/version" >> "$OUT"
if command -v curl >/dev/null 2>&1; then
  curl -s --max-time 3 "$MIHOMO_URL/version" 2>&1 >> "$OUT" || printf '[collector] контроллер недоступен (%s)\n' "$MIHOMO_URL" >> "$OUT"
  log_section "mihomo/proxies (alive/history)" >> "$OUT"
  curl -s --max-time 5 "$MIHOMO_URL/proxies" 2>&1 | mask_stream >> "$OUT" || true
else
  printf '[collector] SKIPPED: curl не найден\n' >> "$OUT"
fi

# ---------- финал ----------

printf '\n===== [done] снимок: %s =====\n' "$OUT"
printf 'Перед публикацией: проверьте вручную (allowedips/endpoint могут раскрывать адреса).\n'

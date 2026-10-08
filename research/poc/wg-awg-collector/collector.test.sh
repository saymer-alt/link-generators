#!/bin/sh
# Offline-тесты collect-awg-incident.sh (NIGHT-MEGA-01 B3).
# Запуск: sh collector.test.sh
# Никакой сети и никакого роутера: все инструменты — стабы на временного PATH,
# каждый стаб ПРОТОКОЛИРУЕТ argv в $FAKE_LOG, чтобы тест проверял read-only
# дисциплину (ни одной мутирующей команды).

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
COLLECTOR="$HERE/collect-awg-incident.sh"
PASS=0; FAIL=0

ok() { PASS=$((PASS+1)); printf '  ok — %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL — %s\n' "$1"; }
check() { if [ "$2" = "0" ]; then ok "$1"; else bad "$1"; fi; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKE="$WORK/bin"; mkdir -p "$FAKE"
FAKE_LOG="$WORK/invocations.log"; : > "$FAKE_LOG"

# stub <name> <stdout-file> — общий шаблон: логирует argv, печатает фикстуру.
make_stub() {
  name="$1"; fixture="$2"
  cat > "$FAKE/$name" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$FAKE_LOG"
cat "$fixture" 2>/dev/null
exit 0
EOF
  chmod +x "$FAKE/$name"
}

# ---- фикстуры (синтетика; ключи/адреса — RFC 5737 и явный мусор) ----
printf 'interface: awg0\n  public key: PUBK\n' > "$WORK/awg-show.txt"
# dump: строка 1 = интерфейс (private key!), далее пиры (с PSK и без)
printf 'PRIVATEKEYABC123DEF456GH\tPUBK-IFACE\t51820\toff\nPEER1PUBKEYBASE64XYZ\tPSKSECRETVALUE0987654321\t51820\ton\t10.10.0.0/16\nPEER2PUBKEYBASE64XYZ\t\t51820\ton\n' > "$WORK/awg-dump.txt"

make_stub_record() {
  name="$1"
  cat > "$FAKE/$name" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$FAKE_LOG"
exit 0
EOF
  chmod +x "$FAKE/$name"
}

# awg: `show` (без iface) → summary; `show <iface> dump` → dump ($3 = dump)
cat > "$FAKE/awg" <<EOF
#!/bin/sh
printf 'awg %s\n' "\$*" >> "$FAKE_LOG"
if [ "\$#" -ge 3 ] && [ "\$3" = "dump" ]; then cat "$WORK/awg-dump.txt"; else cat "$WORK/awg-show.txt"; fi
EOF
chmod +x "$FAKE/awg"
# ip: addr → addr-фикстура; route → routes-фикстура
cat > "$FAKE/ip" <<EOF
#!/bin/sh
printf 'ip %s\n' "\$*" >> "$FAKE_LOG"
case "\$1" in
  addr) cat "$WORK/ip-addr.txt" ;;
  route) cat "$WORK/ip-routes.txt" ;;
esac
EOF
chmod +x "$FAKE/ip"
# curl: URL с /version → version; /proxies → proxies
cat > "$FAKE/curl" <<EOF
#!/bin/sh
printf 'curl %s\n' "\$*" >> "$FAKE_LOG"
case "\$*" in
  */version*) cat "$WORK/curl-version.txt" ;;
  */proxies*) cat "$WORK/curl-proxies.txt" ;;
esac
EOF
chmod +x "$FAKE/curl"
make_stub wg ""
make_stub logread "$WORK/logread.txt"
# остальные фикстуры
printf '2: awg0: <POINTOPOINT,UP,LOWER_UP> mtu 1420\n    inet 10.10.0.1/16 scope global awg0\n' > "$WORK/ip-addr.txt"
printf '10.10.0.0/16 dev awg0 scope link\ndefault via 192.168.1.1 dev eth3\n' > "$WORK/ip-routes.txt"
printf 'Thu Oct  8 20:00:00 2026 auth.info ndm: kernel\n' > "$WORK/logread.txt"
printf '{"version":"v1.19.31-synthetic"}\n' > "$WORK/curl-version.txt"
printf '{"proxies":{"G":{"alive":true}}}\n' > "$WORK/curl-proxies.txt"
# date/uptime/awk/sed/sh — системные, не стабы.

run_collector() {
  extra_path="$1"
  : > "$FAKE_LOG"
  ( cd "$WORK" && PATH="$FAKE:$extra_path" sh "$COLLECTOR" awg0 >/dev/null 2>&1 )
}

echo "collect-awg-incident offline tests"

# 1. Синтаксис
sh -n "$COLLECTOR"; check "sh -n чист" "$?"

# 2. Happy path: файл создан, секции на месте
run_collector "/usr/bin:/bin"
OUTF="$(ls "$WORK"/incident-*.txt 2>/dev/null | head -1)"
[ -n "$OUTF" ] && [ -f "$OUTF" ]; check "файл снимка создан" "$?"
grep -q 'wg/summary' "$OUTF" && grep -q 'wg/dump' "$OUTF" && grep -q 'mihomo/version' "$OUTF" && grep -q 'system/logread-tail' "$OUTF"; check "ключевые секции присутствуют" "$?"

# 3. Маскирование: приватный ключ и PSK не попадают в файл
grep -q 'PRIVATEKEYABC123DEF456GH' "$OUTF"; [ $? -ne 0 ]; check "private key интерфейса замаскирован" "$?"
grep -q 'PSKSECRETVALUE0987654321' "$OUTF"; [ $? -ne 0 ]; check "preshared key пира замаскирован" "$?"
grep -q '\*\*\*MASKED\*\*\*' "$OUTF"; check "маскирующие маркеры присутствуют" "$?"
# публичные данные остаются
grep -q 'PEER1PUBKEYBASE64XYZ' "$OUTF"; check "публичные ключи сохранены (диагностическая ценность)" "$?"
grep -q '10.10.0.0/16' "$OUTF"; check "allowedips сохранены в локальном снимке" "$?"

# 4. Read-only дисциплина: ни один вызванный инструмент не получил мутирующий глагол
MUTATING=0
while IFS= read -r line; do
  case "$line" in
    *set*|*" add "*|*" del "*|*" flush "*|*" restart "*|*" down "*|*" up "*) MUTATING=$((MUTATING+1)) ;;
  esac
done < "$FAKE_LOG"
[ "$MUTATING" -eq 0 ]; check "мутирующих команд не было ($MUTATING совпадений)" "$?"
grep -q '^awg show' "$FAKE_LOG"; check "awg вызывалась только с show" "$?"
N_AWG=$(grep -c '^awg ' "$FAKE_LOG"); N_AWG_SHOW=$(grep -c '^awg show' "$FAKE_LOG")
[ "$N_AWG" -eq "$N_AWG_SHOW" ] && [ "$N_AWG" -gt 0 ]; check "все awg-вызовы — show ($N_AWG/$N_AWG_SHOW)" "$?"

# 5. SKIPPED-ветки: awg/wg отсутствуют
rm -f "$FAKE/awg" "$FAKE/wg"
run_collector "/usr/bin:/bin"
OUTF2="$(ls -t "$WORK"/incident-*.txt | head -1)"
grep -q 'SKIPPED: ни awg, ни wg не найдены' "$OUTF2"; check "отсутствие awg/wg → SKIPPED, не фейл" "$?"

# 6. curl отсутствует → SKIPPED
rm -f "$FAKE/curl"
run_collector "/usr/bin:/bin"
OUTF3="$(ls -t "$WORK"/incident-*.txt | head -1)"
grep -q 'SKIPPED: curl не найден' "$OUTF3"; check "отсутствие curl → SKIPPED" "$?"

# 7. Секреты не попадают в stdout/stderr коллектора (тихий финал)
rm -rf "$FAKE"; mkdir -p "$FAKE"
make_stub awg "$WORK/awg-show.txt"
( cd "$WORK" && PATH="$FAKE:/usr/bin:/bin" sh "$COLLECTOR" awg0 2>&1 | grep -q 'PRIVATEKEYABC123' )
[ $? -ne 0 ]; check "stdout коллектора без секретов" "$?"

printf '\nPASS collect-awg-collector: %d ok, %d fail\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]

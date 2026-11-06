#!/usr/bin/env bash
# IPv6 scenario, v6-capable exit (#284, item Ж positive): the exit node gets
# `ipv6: true` (lab-only variant of configB) so the positive path is provable:
# the IPv6 request must succeed THROUGH the allowed upstream and the endpoint
# must see the EGRESS v6 (fd00:2011::2), never the VPS v6. GLOBAL on the dead
# upstream must still fail closed.
set -u
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_RUN_DIR="$LAB/run"
MIHOMO="${MIHOMO_BIN:?set MIHOMO_BIN to the pinned mihomo binary (>= 1.19.31)}"
# shellcheck source=lib/netns.sh
source "$LAB/lib/netns.sh"
# shellcheck source=lib/verdict.sh
source "$LAB/lib/verdict.sh"
require_lab_isolation "$@"
lab_run_lock
# namespace-local forwarding in the outer lab ns: v4 (vps→egress child
# transit) and v6 (egress→v6 destination transit)
sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null
trap lab_cleanup EXIT INT TERM

LAB_WD_DIR="$LAB_RUN_DIR/$LAB_RUN_ID"
LOGS="$LAB_RUN_DIR/logs"; RESULTS="$LOGS/results-ipv6-live.txt"
mkdir -p "$LAB_WD_DIR" "$LOGS"
: > "$LOGS/dest.jsonl"; : > "$RESULTS"
say() { echo "$@" | tee -a "$RESULTS"; }

VPS_V4=10.210.0.3; VPS_V6=fd00:2010::3
EGRESS_V4=10.211.0.2; EGRESS_V6=fd00:2011::2
EGRESS_GW_V4=10.211.0.1; EGRESS_GW_V6=fd00:2011::1
DEST_V4=10.210.0.1; DEST_V6=fd00:2010::1
API="http://$VPS_V4:9090"; CLIENT="http://127.0.0.1:7897"; DEST_LOG="$LOGS/dest.jsonl"

mkdir -p "$LAB/certs"
[ -f "$LAB/certs/server-cert.pem" ] || openssl req -x509 -newkey rsa:2048 \
  -keyout "$LAB/certs/server-key.pem" -out "$LAB/certs/server-cert.pem" -days 3 -nodes \
  -subj "/CN=lab.local" -addext "subjectAltName=DNS:lab.local,IP:10.211.0.2,IP:10.210.0.3" \
  -addext "basicConstraints=critical,CA:TRUE" >/dev/null 2>&1
export SSL_CERT_FILE="$LAB/certs/server-cert.pem"
node "$LAB/gen.mjs" >"$LOGS/gen.out" 2>&1 || { say "FATAL: gen.mjs failed"; exit 1; }
sed 's/^ipv6: false/ipv6: true/' "$LAB/run/configs/configB.yaml" > "$LAB/run/configs/configB-v6.yaml"
"$MIHOMO" -t -d "$LAB_WD_DIR/t" -f "$LAB/run/configs/configB-v6.yaml" >/dev/null 2>&1 \
  || { say "FATAL: mihomo -t configB-v6 FAILED"; exit 1; }

node "$LAB/dest.mjs" --run "$LAB_RUN_ID" >"$LOGS/dest.stdout" 2>&1 &
lab_own "$!" "$LAB_RUN_ID"
VPS_PID=$(lab_start_vns "$LAB_WD_DIR/vps.ready" "$LAB_WD_DIR/vps" "$LAB/run/configs/configA.yaml" "$LOGS/mihomo-A.out")
lab_own "$VPS_PID" "$LAB_WD_DIR/vps"
EGRESS_PID=$(lab_start_vns "$LAB_WD_DIR/egress.ready" "$LAB_WD_DIR/egress" "$LAB/run/configs/configB-v6.yaml" "$LOGS/mihomo-B.out")
lab_own "$EGRESS_PID" "$LAB_WD_DIR/egress"
lab_wire_veth "$VPS_PID" vps-v0 "$VPS_V4/24" "$DEST_V4/24" "$VPS_V6/64" "$DEST_V6/64"
lab_wire_veth "$EGRESS_PID" eg-v0 "$EGRESS_V4/24" "$EGRESS_GW_V4/24" "$EGRESS_V6/64" "$EGRESS_GW_V6/64"
touch "$LAB_WD_DIR/vps.ready" "$LAB_WD_DIR/egress.ready"
"$MIHOMO" -d "$LAB_WD_DIR/client" -f "$LAB/run/configs/configC.yaml" >"$LOGS/mihomo-C.out" 2>&1 &
lab_own "$!" "$LAB_WD_DIR/client"

lab_wait_port "http://127.0.0.1:8099/self-outer" 40 || { say "FATAL: dest not listening"; exit 1; }
lab_curl 200 "http://127.0.0.1:8099/self-outer" >/dev/null || { say "FATAL: dest down"; exit 1; }
nsenter -t "$VPS_PID" -n curl -s -o /dev/null --max-time 3 "http://[$DEST_V6]:8099/self-vps" || { say "FATAL: dest unreachable from vps ns (v6)"; exit 1; }
nsenter -t "$EGRESS_PID" -n curl -s -o /dev/null --max-time 3 "http://[$DEST_V6]:8099/self-egress" || { say "FATAL: dest unreachable from egress ns (v6)"; exit 1; }
lab_wait_api_ready "$API" 60 || { say "FATAL: A API not ready"; exit 1; }
lab_wait_port "$CLIENT" 60 || { say "FATAL: client C down"; exit 1; }
api_select "$API" egress-live || { say "FATAL: GLOBAL select egress-live refused"; exit 1; }
sleep 1

say "== IPv6 run, v6-capable exit — contained netns =="
# V1b positive: v6 destination through the allowed upstream — endpoint must
# report the EGRESS v6 address, not the VPS v6.
v1body=$(curl -sS --max-time 15 -x "$CLIENT" "http://[$DEST_V6]:8099/ipcheck-v6-live" 2>/dev/null)
if printf '%s' "$v1body" | grep -q "\"egress_ip\":\"$EGRESS_V6\""; then
  say "V1b v6 via allowed upstream -> PASS (endpoint saw $EGRESS_V6)"
else
  lab_fail "V1b v6 via allowed upstream -> expected egress $EGRESS_V6, got: $(printf '%s' "$v1body" | head -c 160)"
fi
# V2b negative: GLOBAL on the dead upstream — must fail closed.
api_select "$API" dead-upstream || { say "FATAL: GLOBAL select dead-upstream refused"; exit 1; }
sleep 1
v2=$(curl -sS --max-time 15 -x "$CLIENT" -o /dev/null -w '%{http_code}' "http://[$DEST_V6]:8099/ipcheck-v6-deadb" 2>/dev/null)
[ "$v2" != "200" ] || lab_fail "V2b: IPv6 destination unexpectedly succeeded through the dead upstream"
say "V2b v6 destination, GLOBAL=dead-upstream: http=$v2 (fail-closed expected)"
lab_verdict "$DEST_LOG" "$VPS_V4" "$VPS_V6"

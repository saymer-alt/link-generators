#!/usr/bin/env bash
# IPv6 scenario, strict exit node (#284, item Ж): the VPS namespace also has a
# simulated public IPv6 (fd00:2010::3); the exit node keeps the Builder default
# `ipv6: false`. Mandatory: with GLOBAL on the live upstream the IPv6 request
# must FAIL CLOSED (the exit refuses IPv6 dialing), with GLOBAL dead it must
# fail too, and the endpoint must never see fd00:2010::3.
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
# namespace-local forwarding in the outer lab ns: the vps child must be able
# to reach the egress child (child-to-child transit) — without it a transport
# timeout would masquerade as the strict-exit fail-closed result
sysctl -w net.ipv4.ip_forward=1 >/dev/null
trap lab_cleanup EXIT INT TERM

LAB_WD_DIR="$LAB_RUN_DIR/$LAB_RUN_ID"
LOGS="$LAB_RUN_DIR/logs"; RESULTS="$LOGS/results-ipv6.txt"
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
"$MIHOMO" -t -d "$LAB_WD_DIR/t" -f "$LAB/run/configs/configA.yaml" >/dev/null 2>&1 \
  || { say "FATAL: mihomo -t configA FAILED"; exit 1; }

node "$LAB/dest.mjs" --run "$LAB_RUN_ID" >"$LOGS/dest.stdout" 2>&1 &
lab_own "$!" "$LAB_RUN_ID"
VPS_PID=$(lab_start_vns "$LAB_WD_DIR/vps.ready" "$LAB_WD_DIR/vps" "$LAB/run/configs/configA.yaml" "$LOGS/mihomo-A.out")
lab_own "$VPS_PID" "$LAB_WD_DIR/vps"
EGRESS_PID=$(lab_start_vns "$LAB_WD_DIR/egress.ready" "$LAB_WD_DIR/egress" "$LAB/run/configs/configB.yaml" "$LOGS/mihomo-B.out")
lab_own "$EGRESS_PID" "$LAB_WD_DIR/egress"
lab_wire_veth "$VPS_PID" vps-v0 "$VPS_V4/24" "$DEST_V4/24" "$VPS_V6/64" "$DEST_V6/64"
lab_wire_veth "$EGRESS_PID" eg-v0 "$EGRESS_V4/24" "$EGRESS_GW_V4/24" "$EGRESS_V6/64" "$EGRESS_GW_V6/64"
touch "$LAB_WD_DIR/vps.ready" "$LAB_WD_DIR/egress.ready"
"$MIHOMO" -d "$LAB_WD_DIR/client" -f "$LAB/run/configs/configC.yaml" >"$LOGS/mihomo-C.out" 2>&1 &
lab_own "$!" "$LAB_WD_DIR/client"

lab_wait_port "http://127.0.0.1:8099/self-outer" 40 || { say "FATAL: dest not listening"; exit 1; }
lab_curl 200 "http://127.0.0.1:8099/self-outer" >/dev/null || { say "FATAL: dest down"; exit 1; }
nsenter -t "$VPS_PID" -n curl -s -o /dev/null --max-time 3 "http://$DEST_V4:8099/self-vps" || { say "FATAL: dest unreachable from vps ns (v4)"; exit 1; }
nsenter -t "$VPS_PID" -n curl -s -o /dev/null --max-time 3 "http://[$DEST_V6]:8099/self-vps" || { say "FATAL: dest unreachable from vps ns (v6)"; exit 1; }
lab_wait_api_ready "$API" 60 || { say "FATAL: A API not ready"; exit 1; }
lab_wait_port "$CLIENT" 60 || { say "FATAL: client C down"; exit 1; }
leak_detector_selftest() { :; } # v6 selftest below is the scenario itself
api_select "$API" egress-live || { say "FATAL: GLOBAL select egress-live refused"; exit 1; }
sleep 1

say "== IPv6 run, strict exit (ipv6: false) — contained netns =="
# V1: v6 destination, GLOBAL on the LIVE upstream — the exit must refuse IPv6.
v1=$(curl -sS --max-time 15 -x "$CLIENT" -o /dev/null -w '%{http_code}' "http://[$DEST_V6]:8099/ipcheck-v6-allowed" 2>/dev/null)
[ "$v1" != "200" ] || lab_fail "V1: IPv6 destination unexpectedly succeeded through a strict (ipv6:false) exit"
say "V1 v6 destination, GLOBAL=egress-live, strict exit: http=$v1 (fail-closed expected)"
# V2: v6 destination, GLOBAL on the dead upstream.
api_select "$API" dead-upstream || { say "FATAL: GLOBAL select dead-upstream refused"; exit 1; }
sleep 1
v2=$(curl -sS --max-time 15 -x "$CLIENT" -o /dev/null -w '%{http_code}' "http://[$DEST_V6]:8099/ipcheck-v6-dead" 2>/dev/null)
[ "$v2" != "200" ] || lab_fail "V2: IPv6 destination unexpectedly succeeded through the dead upstream"
say "V2 v6 destination, GLOBAL=dead-upstream: http=$v2 (fail-closed expected)"
lab_verdict "$DEST_LOG" "$VPS_V4" "$VPS_V6"

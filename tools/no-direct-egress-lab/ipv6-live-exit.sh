#!/usr/bin/env bash
# IPv6 variant V1b/V2b: same topology as ipv6-observe.sh, but the egress node
# is IPv6-capable (ipv6: true) to prove the positive path: v6 user traffic
# rides the allowed upstream and the endpoint sees the EGRESS v6, never the
# VPS v6 (fd00:2010::3). Reuses the namespaces still up from ipv6-observe.sh
# (recreates them if missing).
set -u
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF=$LAB/run/configs; MIHOMO="${MIHOMO_BIN:?set MIHOMO_BIN to the pinned mihomo binary (>= 1.19.31)}"
pkill -x A_our_unpacked_ 2>/dev/null; sleep 1
if ! ip netns list 2>/dev/null | grep -q '^vps'; then
  echo "FATAL: run ipv6-observe.sh first (topology missing)"; exit 1
fi
sed 's/^ipv6: false/ipv6: true/' "$CONF/configB.yaml" > /tmp/configB-v6.yaml
: > "$LAB/run/logs/dest.jsonl"
node "$LAB/dest.mjs" >"$LAB/run/logs/dest-v6b.stdout" 2>&1 &
rm -rf "$LAB/wdB6b"; mkdir -p "$LAB/wdB6b"
ip netns exec egress sh -c "exec $MIHOMO -d $LAB/wdB6b -f /tmp/configB-v6.yaml" >"$LAB/run/logs/mihomo-B-v6b.out" 2>&1 &
rm -rf "$LAB/wdC6b"; mkdir -p "$LAB/wdC6b"
$MIHOMO -d "$LAB/wdC6b" -f "$CONF/configC.yaml" >"$LAB/run/logs/mihomo-C-v6b.out" 2>&1 &
rm -rf "$LAB/wdA6b"; mkdir -p "$LAB/wdA6b"
ip netns exec vps sh -c "exec $MIHOMO -d $LAB/wdA6b -f $CONF/configA.yaml" >"$LAB/run/logs/mihomo-A-v6b.out" 2>&1 &
sleep 4
ip netns exec egress curl -s --max-time 3 http://10.210.0.1:8099/self -o /dev/null && echo 'hop: dest from egress alive' || { echo 'FATAL dest'; exit 1; }
ip netns exec vps timeout 2 bash -c 'exec 3<>/dev/tcp/10.211.0.2/8442' 2>/dev/null && echo 'hop: A->B TCP ok' || { echo 'FATAL A->B'; exit 1; }
curl -s -X PUT -d '{"name":"egress-live"}' http://10.210.0.3:9090/proxies/GLOBAL -o /dev/null -w 'select egress-live: %{http_code}\n'
sleep 1
echo "--- V1b: v6 destination, GLOBAL=egress-live, exit node ipv6-capable ---"
curl -sS --max-time 12 -x http://127.0.0.1:7897 'http://[fd00:2010::1]:8099/ipcheck-v6-live' -w '\nhttp=%{http_code}\n' 2>&1 | tail -2
echo "--- V2b: GLOBAL=dead-upstream, v6 request ---"
curl -s -X PUT -d '{"name":"dead-upstream"}' http://10.210.0.3:9090/proxies/GLOBAL -o /dev/null
sleep 1
curl -sS --max-time 12 -x http://127.0.0.1:7897 'http://[fd00:2010::1]:8099/ipcheck-v6-deadb' -o /dev/null -w 'http=%{http_code}\n'
echo "--- V3b: verdict ---"
grep 'fd00:2010::3' "$LAB/run/logs/dest.jsonl" && echo 'IPv6 DIRECT EGRESS DETECTED (LEAK)' || echo 'no IPv6 direct egress: endpoint never saw the VPS v6'
tail -3 "$LAB/run/logs/dest.jsonl"

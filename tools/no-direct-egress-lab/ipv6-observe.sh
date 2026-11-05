#!/usr/bin/env bash
# IPv6 negative test for #284 (local isolated netns lab, WSL):
# the "VPS" namespace ALSO gets a simulated public IPv6 (fd00:2010::3).
# Question: can user-plane traffic to an IPv6 destination bypass the allowed
# upstream and egress directly with the VPS IPv6 address, given the Builder
# YAML pins `ipv6: false` and routes everything through MATCH,GLOBAL?
# Leak = dest hit with source fd00:2010::3. Via-egress = fd00:2011::2.
set -u
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF=$LAB/run/configs; MIHOMO="${MIHOMO_BIN:?set MIHOMO_BIN to the pinned mihomo binary (>= 1.19.31)}"
pkill -f 'dest.mjs' 2>/dev/null; pkill -x A_our_unpacked_ 2>/dev/null
ip netns del vps 2>/dev/null; ip netns del egress 2>/dev/null; sleep 1
ip netns add vps; ip netns add egress
ip link add vps-v1 type veth peer name vps-v0; ip link add eg-v1 type veth peer name eg-v0
ip link set vps-v0 netns vps; ip link set eg-v0 netns egress
ip addr add 10.210.0.1/24 dev vps-v1; ip addr add 10.211.0.1/24 dev eg-v1
ip -6 addr add fd00:2010::1/64 dev vps-v1; ip -6 addr add fd00:2011::1/64 dev eg-v1
ip link set vps-v1 up; ip link set eg-v1 up
ip -n vps addr add 10.210.0.3/24 dev vps-v0; ip -n egress addr add 10.211.0.2/24 dev eg-v0
ip -n vps -6 addr add fd00:2010::3/64 dev vps-v0; ip -n egress -6 addr add fd00:2011::2/64 dev eg-v0
ip -n vps link set vps-v0 up; ip -n egress link set eg-v0 up
ip -n vps link set lo up; ip -n egress link set lo up
ip -n vps route add default via 10.210.0.1; ip -n egress route add default via 10.211.0.1
ip -n vps -6 route add default via fd00:2010::1 dev vps-v0; ip -n egress -6 route add default via fd00:2011::1 dev eg-v0
sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null
if command -v iptables >/dev/null 2>&1; then
  iptables -C FORWARD -s 10.210.0.0/24 -d 10.211.0.0/24 -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD 1 -s 10.210.0.0/24 -d 10.211.0.0/24 -j ACCEPT
  iptables -C FORWARD -s 10.211.0.0/24 -d 10.210.0.0/24 -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD 1 -s 10.211.0.0/24 -d 10.210.0.0/24 -j ACCEPT
fi
: > "$LAB/run/logs/dest.jsonl"
node "$LAB/dest.mjs" >"$LAB/run/logs/dest-v6.stdout" 2>&1 &
rm -rf "$LAB/wdB6"; mkdir -p "$LAB/wdB6"
ip netns exec egress sh -c "exec $MIHOMO -d $LAB/wdB6 -f $CONF/configB.yaml" >"$LAB/run/logs/mihomo-B-v6.out" 2>&1 &
rm -rf "$LAB/wdC6"; mkdir -p "$LAB/wdC6"
$MIHOMO -d "$LAB/wdC6" -f "$CONF/configC.yaml" >"$LAB/run/logs/mihomo-C-v6.out" 2>&1 &
rm -rf "$LAB/wdA6"; mkdir -p "$LAB/wdA6"
ip netns exec vps sh -c "exec $MIHOMO -d $LAB/wdA6 -f $CONF/configA.yaml" >"$LAB/run/logs/mihomo-A-v6.out" 2>&1 &
sleep 4
# Per-hop liveness INSIDE the live session — every check must pass before the matrix.
curl -s --max-time 3 http://127.0.0.1:8099/self -o /dev/null && echo "hop0 dest (root) alive" || { echo "FATAL: dest down"; exit 1; }
ip netns exec vps curl -s --max-time 3 http://10.210.0.1:8099/self -o /dev/null && echo "hop1 dest from vps ns alive" || { echo "FATAL: dest unreachable from vps ns"; exit 1; }
ip netns exec egress curl -s --max-time 4 http://10.210.0.1:8099/self -o /dev/null && echo "hop2 dest from egress ns alive (FORWARD)" || { echo "FATAL: dest unreachable from egress ns"; exit 1; }
ip netns exec vps timeout 2 bash -c 'exec 3<>/dev/tcp/10.211.0.2/8442' 2>/dev/null && echo "hop3 A->B:8442 TCP ok" || { echo "FATAL: A cannot reach B"; exit 1; }
curl -s --max-time 3 http://10.210.0.3:9090/version -o /dev/null && echo "hop4 A API reachable" || { echo "FATAL: A API down"; exit 1; }
curl -s -X PUT -d '{"name":"egress-live"}' http://10.210.0.3:9090/proxies/GLOBAL -o /dev/null -w 'select egress-live -> http %{http_code}\n'
sleep 1
# A debug stream during the request (capture, then stop).
(curl -s -N --max-time 20 'http://10.210.0.3:9090/logs?level=debug' >"$LAB/run/logs/A-debug-v6.txt" 2>&1 &)
sleep 1
echo "--- V1: IPv6 destination via allowed upstream (GLOBAL=egress-live) ---"
curl -sS --max-time 12 -x http://127.0.0.1:7897 "http://[fd00:2010::1]:8099/ipcheck-v6-allowed" -w "\nhttp=%{http_code}\n" 2>&1 | tail -2
sleep 2
echo "--- A debug trace for the request (no gstatic noise) ---"
grep -v gstatic "$LAB/run/logs/A-debug-v6.txt" | tail -5
echo "--- V2: IPv6 destination with dead upstream (GLOBAL=dead-upstream) ---"
curl -s -X PUT -d '{"name":"dead-upstream"}' http://10.210.0.3:9090/proxies/GLOBAL -o /dev/null
sleep 1
curl -sS --max-time 12 -x http://127.0.0.1:7897 "http://[fd00:2010::1]:8099/ipcheck-v6-dead" -w "\nhttp=%{http_code}\n" 2>&1 | tail -2
echo "--- V3: destination log (any hit with source fd00:2010::3 = IPv6 LEAK) ---"
grep 'fd00:2010::3' "$LAB/run/logs/dest.jsonl" && echo "IPv6 DIRECT EGRESS DETECTED" || echo "no IPv6 direct egress observed"
echo "--- V4: dest log tail ---"
tail -4 "$LAB/run/logs/dest.jsonl"
echo "--- V5: A dial errors ---"
grep -E "error" "$LAB/run/logs/mihomo-A-v6.out" | tail -3

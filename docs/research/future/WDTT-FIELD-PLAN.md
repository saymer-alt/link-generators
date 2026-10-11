# WDTT field acceptance — planned for 12–18 October 2026

Status: PLANNED / NOT RUN. Owner expects field trials during the week, no fixed day or hardware authorization recorded. This text is an evidence checklist, NOT permission to install or alter routers/VPS. Related: [Builder design](WDTT-BUILDER-INTEGRATION.md), [#250](https://github.com/saymer-alt/link-generators/issues/250), [KAS #125](https://github.com/saymer-alt/keenetic-auto-setup/pull/125), [entware-go #10](https://github.com/saymer-alt/entware-go/pull/10).

## Preflight and STOP gates

1. Confirm fhttp license/notice, upstream obligations, no secrets or unsafe binary distribution. While unresolved: READ-ONLY PREFLIGHT ONLY; no quarantined IPK or live install.
2. Owner separately approves exact isolated device and server for each active probe/install. Candidate KN-4210 or KN-1010 subject to actual availability and ABI/RAM; no production home/work router/VPS. No assumption that QEMU equals hardware proof.
3. Read-only capture: firmware/kernel, architecture ABI (ARM64/MIPSel softfloat), RAM/swap/storage/Entware, current ports and services, baseline network, recoverable rollback/out-of-band access.
4. Verify server pair for REAL VK TURN (not local Pion/mock); secure credentials only private restricted files, never command args or GitHub.
5. Confirm fail-closed network and independent baseline DIRECT WireGuard, no automatic fallback to unaudited DIRECT, no routing/firewall/TUN modifications outside controlled sandbox.
6. If any gate fails: STOP; record BLOCKED with reason, do not bypass admission controls.

## Tests W1–W10

| Gate | Evidence and acceptance |
|---|---|
| W1 Real VK | Demonstrate actual VK TURN endpoint transaction, not Pion TURN lab or simulated network |
| W2 WireGuard | Fresh handshake and tx/rx counters on both ends, no duplicate WG manager running |
| W3 TCP | Actual TCP payload through WG+WDTT and intended remote egress; no silent DIRECT |
| W4 UDP | Verify varying UDP payloads (64/512/1200/1400 when MTU permits) plus counters |
| W5 DNS | DNS queries follow intended tunnel; classify IPv4/IPv6, no resolver leak |
| W6 NAT/MTU | Compare direct WG baseline, loss, fragmentation, reconnect and MTU; record limitations |
| W7 Service down | Stop wt-client or VK service: failure is closed, no unexpected direct route; recovery on restart |
| W8 Reboot | Controlled device reboots; service/Entware mount ordering, no early escape or broken startup |
| W9 Security | Loopback-only socket, process namespaces, secrets permissions, no stdout/argv/core/log exposure, no recursive TUN |
| W10 Rollback | Tear down only owned sandbox/process/config; restore untouched existing services/routing/firewall |

Optional soak proposal: 15–30 min per stable condition and repeat on a changed access path if available. Record time to handshake/recovery, Mbps TCP/UDP, packet loss, CPU %, RSS, swap, interface counters and relevant log excerpts. Do not label soak as long-term stability proof.

## Fill-in report (no live credentials)

    Test date: YYYY-MM-DD; site/network anonymized
    Device / firmware / architecture / RAM / kernel / Entware:
    Binary git commit / SHA256 / build provenance:
    License notice approved: PASS | FAIL | BLOCKED
    Mode: local Pion laboratory | real VK TURN (exact classification required)
    Config: synthetic/redacted; loopback namespace and listener:
    Route and DNS: intended path / IPv4-IPv6 policy:
    Direct WG baseline: handshake, TCP/UDP/DNS, RSS, throughput:
    W1: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W2: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W3: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W4: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W5: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W6: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W7: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W8: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W9: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    W10: PASS | FAIL | NOT RUN | BLOCKED  Evidence:
    Resource profile; packet loss; MTU; restart/recovery timing:
    Open blockers / environment caveats:
    Owner decision: iterate / design only / proceed with separate implementation GO

Redact WG private keys, VK secrets/cookies, subscription tokens and sensitive IPs before posting. NEVER treat NOT RUN or BLOCKED as PASS. If tests fail, preserve evidence without pretending the blocker is resolved.

After trials: post sanitized result to #250; update KAS/entware-go evidence; decide minimum Builder UI or docs-only approach. Full product merge requires its own PR with RED->GREEN regression, Node/browser/Mihomo CI and separate owner approval; stable v1.11.0 remains untouched.

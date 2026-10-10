# ZAI-82 — AI-Agent Usability Report: WARPSCOUT → link-generators → Mihomo

Autonomous AI-agent evaluation of the `link-generators` Mihomo
builder, based on the ZAI-82 live experiment (an agent — no human —
discovered a Cloudflare WARP endpoint with WARPSCOUT and produced a
working Mihomo configuration through this project). Environment:
Playwright 1.49.1 + Edge (headless) driving `index.html` at commit
`bbec9e41` over `file://`. The agent DID eventually produce a valid
configuration that passed `mihomo -t` — the report documents what
cost it.

Classification used below: **[DEFECT]** product behavior worth
changing; **[DOC-GAP]** behavior is intentional but undocumented
where the agent needed it; **[HARNESS]** the agent's own mistake.

## 1. Reproduction and findings

### 1.1 WG `.conf` import is asynchronous — a Build clicked too early fails SILENTLY — [DEFECT, minor]

- Steps: `#wgFile.setInputFiles(warp.conf)` → wait for `#wgStatus`
  ("✅ Загружено: 1 конфиг(ов)") → click Build.
- Expected: build proceeds (the status implies the import completed).
- Observed: "Ошибка сборки / проверки" with an EMPTY validation box
  and NO rendered reason; the output stays empty. Root cause: the
  file read is asynchronous — `wgProfiles`/`wgBeans` are still empty
  when Build runs; the builder counts zero data sources and fails.
- The project's own tests wait for
  `wgUploadPending === false && wgBeans.length === 1` — the contract
  exists but is invisible to anyone driving the UI by its visible
  state.
- Proposed improvement: make Build wait for (or reject with a clear
  message about) a pending import — the infrastructure for the
  correct message already exists (`wgUploadPending` + the
  "WG/AWG файл ещё читается" toast used elsewhere). Minimal
  regression: build-during-pending-import shows that toast.
- Root-cause confidence: HIGH (reproduced; verified by evaluating
  `wgBeans.length` directly).

### 1.2 Sub Mode defaults ON — a WG-only build fails until it is unchecked — [DOC-GAP]

- Steps: with the WG profile loaded, click Build.
- Observed: toast "Режим «URL-подписки» включён, но URL подписки не
  найден…". The toast IS clear and actionable — but nothing in the
  WARPSCOUT documentation (which sends users to the builder with a
  `.conf` and no subscription) mentions it, and the failure renders
  ONLY in the transient toast: the persistent validation box still
  says "проверка ещё не выполнялась".
- Proposed improvements: (a) when the only data source is a WG/AWG
  import, do not let the Sub-Mode precheck mask the build — auto-
  uncheck or mention WG imports in the toast; (b) mirror build
  errors into the persistent validation box, not only the toast.
- Root-cause confidence: HIGH.

### 1.3 Headless `waitForFunction` raf-polling is unreliable — [HARNESS]

- The agent's first two harnesses timed out on waits that the page
  state demonstrably satisfied (`wgBeans.length === 1`); the cause
  was Playwright's default raf polling in headless Edge. Explicit
  `polling: 250` fixed it.
- Classification: harness mistake, not a product issue. Worth a note
  in any future automation documentation.

### 1.4 The async/Build/sub-mode interactions compound — [DEFECT, minor]

Individually each issue has a remedy; together they cost the agent
four debugging iterations. A single "programmatic build" entry point
would eliminate the whole class:

- A CLI or headless API (`node build.js --wg warp.conf --out
  config.yaml`, or an exported function from the runtime bundle)
  would make autonomous use trivial and testable. The heavy lifting
  already exists in the runtime (`web4core.parseWireGuardConf`, the
  build pipeline); only the UI event wiring is browser-bound.
- Justification: YES — ZAI-82 (and any CI use) needs exactly this,
  and the existing `tests/` browser suite would shrink to pure UI
  checks once logic is callable headlessly. Proposed as a follow-up
  task, not implemented here.

### 1.5 What worked well

- The WG import parsed the WARPSCOUT `.conf` faithfully (endpoint,
  keys, address 172.16.0.2, MTU default 1408 semantics — the profile
  card even rendered the diagnostic notes).
- The generated YAML passed `mihomo -t` on the first try.
- The IPv4-only pinning and MTU documentation in `docs/MIHOMO.md`
  matched the generated output exactly — the source-first contracts
  held.
- `file://` operation worked without a dev server.

## 2. Defects vs documentation gaps vs harness mistakes (summary)

| # | Item | Class |
|---|---|---|
| 1 | Silent build failure during pending WG import | DEFECT (minor) |
| 2 | Sub Mode default masks WG-only builds with toast-only errors | DOC-GAP (+minor UX) |
| 3 | raf polling in headless automation | HARNESS |
| 4 | No headless/CLI build entry point | FEATURE PROPOSAL |

## 3. Minimal regression tests (proposed, not implemented here)

1. Import a `.conf`, click Build while `wgUploadPending === true` →
   expect the "файл ещё читается" toast (asserts the existing
   mechanism covers the import path).
2. Import a `.conf`, wait for the bean, uncheck Sub Mode, Build →
   expect YAML containing the wireguard proxy (already implicitly
   covered by browser.cjs patterns; make it explicit for WG-only +
   Sub-Mode-ON input).

## 4. Verification of the generated output (ZAI-82 evidence)

The generated config passed the real `mihomo -t`, was integrated
into a live gateway, and carried real client traffic through a real
Cloudflare WARP tunnel (`warp=on`, exit IP ≠ VPS) — see
`vps-gateway-bootstrap/docs/live-cloudflare-warp-egress-zai-82.md`.

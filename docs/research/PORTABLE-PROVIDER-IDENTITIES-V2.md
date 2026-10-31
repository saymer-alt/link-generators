# ADR — portable provider identities for Builder project v2 (#280)

**Status:** implementation contract proposed in a draft PR; **NOT production behavior, not release approval**.  
**Evidence:** inspected `index.html` on main after #297 and `web4core` draft PR #21; original owner requirements: #280, #278 and Phase 0 #293.  
**Security:** examples are synthetic. Never include real subscription URLs, HWID values, private keys, credentials, server endpoints or original field configs in public artifacts.

## Why a project identity, not only a browser identity

- Current `getActiveDeviceIdentity()` reads browser-local registry `link-generators.device-identities.v1`; `rbCollectProject()` does not serialize it. A save/load on another browser can silently change every provider's `x-hwid`.
- The present engine receives **one** `options.deviceHwid` for all subscription providers. Draft `web4core#21` adds explicit per-provider override entries, but does not bind them to portable source identities or alter the public Builder.
- Simply loading exported HWIDs into global `localStorage` is **not acceptable**: importing project B must not replace project A's browser registry, active device, or other tabs' identities.

## Canonical v2 representation (proposed)

```json
{
  "schemaVersion": 2,
  "sources": {
    "subMode": true,
    "mainInput": "https://a.example.invalid/feed\nhttps://b.example.invalid/feed\nhttps://c.example.invalid/feed",
    "subscriptionSources": [
      { "sourceId": "src-a", "url": "https://a.example.invalid/feed" },
      { "sourceId": "src-b", "url": "https://b.example.invalid/feed" },
      { "sourceId": "src-c", "url": "https://c.example.invalid/feed" }
    ]
  },
  "identities": {
    "defaultId": "identity-a",
    "entries": [
      { "id": "identity-a", "label": "Primary", "hwid": "11111111111111111111111111111111" },
      { "id": "identity-b", "label": "Provider B", "hwid": "22222222222222222222222222222222" }
    ],
    "providerBindings": [
      { "sourceId": "src-a", "identityId": "identity-a" },
      { "sourceId": "src-b", "identityId": "identity-b" },
      { "sourceId": "src-c", "identityId": "identity-b" }
    ]
  }
}
```

Other v1 project fields (`meta`, `wgProfiles`, `options`, `dialer`, `domainPolicy`, `tiered`, `passthrough`) remain present and structurally unchanged. The above is an **illustrative fragment**, not a complete standalone project.

### Source binding

- A stable opaque `sourceId` identifies a **subscription entry**, not a URL or generated provider name. URL may contain a secret: never use URL as UI label, diagnostic key, or log value.
- `sources.subscriptionSources` is ordered consistently with the HTTP(S) lines in `sources.mainInput`. The binding validator must check the **exact URLs and the exact number of occurrences**, including identical URLs. No guessed association after edits, import or reorder.
- Reordering subscriptions in a future card UI moves their stable `sourceId` with them. If the current textarea is edited directly, preserve IDs only for unambiguous exact matches; ambiguous duplicate URLs or destructive edits require **explicit remapping**. Do not silently reassign identity based on line number or URL hostname.
- Provider names and custom provider properties (planned #278/#282) are **orthogonal** to source IDs and are not silently changed by HWID binding.
- A referenced identity that does not exist, duplicate source ID, duplicate identity ID, unmatched URL, invalid HWID, unknown extra fields, or ambiguous mapping blocks Build/Restore with a redacted error.
- Multiple entries can intentionally reference the same HWID. Do not deduplicate entries or rotate device IDs without user action. One default identity remains the legacy default; overrides are strictly opt-in.
- Draft engine #21 expects an ordered `providerOverrides` array. Consumer derives this array **at Build time** from the validated source IDs in current subscription order, not directly from stale positional data; no override entries when legacy default mode is active.

### Identity scope

- File v2 carries only identities **actually used by this project** (default and referenced providers), with exact HWIDs. It does **not** export all unrelated identities from `localStorage`.
- Loading a project creates an in-memory **project-scoped identity context** and must leave the browser-global registry untouched. Preview/Build use the same context. A visible, explicit choice may switch back to an existing browser-local identity; no implicit reconciliation.
- A collision of `id` with a local registry entry that contains another HWID must never overwrite the local entry. Project-scoped reference wins only within the loaded project; UI distinguishes the scopes. Importing into the local registry, if ever offered, requires a separate explicit operation.
- Reset or Undo must preserve documented identity semantics, and a failed/cancelled/stale project import must restore **all** previously active identity context. A Build already in flight must not overwrite a newer project/identity state.
- No new HWID during rebuild, preview, re-import or reload of a saved v2 file. Creating/regenerating HWID is an explicit, warned user action only.

### Compatibility and migration

- Existing v1 projects contain **no portable identity**. It is mathematically impossible to reconstruct the original HWID from the file alone. Show `LEGACY_IDENTITY_MISSING` **before** import; require acknowledgment and explicit selection/import of an existing identity. Never claim same device after a v1 import on another browser.
- A historic internal experimental `schemaVersion: 2` without the new `identities` payload exists in older test fixtures. Detect this explicitly as **legacy v2 without portable identities**, do not treat it as a valid new v2 project or silently rotate; retain a narrow compatibility path with an explicit warning.
- Fresh builds without imported project identity preserve the existing `link-generators.device-identities.v1` registry and legacy YAML bytes.
- YAML Reverse cannot derive the real device HWID from a missing provider header. Unknown/unsupported headers must be acknowledged; never invent a supposedly recovered original identity.

### Privacy and export contract

- The file must include raw HWIDs in order to be portable; **HWID is sensitive** and may consume device slots at an external subscription provider. An explicit export notice must name HWIDs alongside URLs, subscription tokens, WG/AWG keys. No automatic upload, autosave, telemetry, or copying the HWID into URL parameters.
- Never expose raw HWIDs/subscription URLs in toast, console, trace, Inspector, diff, source logs, UI labels, issue bodies or CI artifacts. Test fixtures use only synthetic identifiers and `.invalid` URLs.
- Subscription preview remains opt-in. The preview for provider `src-b` sends precisely identity B; direct CORS request and fallback-worker request must agree, without sending any extra credential fields compared with the existing allowed request.
- Stored project state is versioned; reader remains bounded against oversized JSON, excessive nesting, unsafe keys, unexpected arrays and duplicate refs.

## Acceptance gates before considering #280 implemented

1. Browser A: build synthetic providers A/B/C with H1/H2/H2; export the whole project.
2. Browser B with **different browser-local registry**: import, verify no mutation to local storage, Build and optional preview reproduce H1/H2/H2. Verify browser-local active device remains unchanged.
3. Save → import → rebuild with no changes gives deterministic YAML (except explicitly documented nondeterminism, if any). Reordering sources preserves binding by source ID; duplicates/mismatch fail closed with a clear UI.
4. Project v1 and legacy experimental v2: explicit missing-identity warning, no silent HWID replacement; malformed v2 and stale imports are transactional failures; Undo and Reset preserve correct identity scope.
5. No raw HWIDs, tokens or subscription URLs in diagnostics/error text/logs/CI; no background network calls triggered by import.
6. Real pinned Mihomo **1.19.31/1.19.32**: `mihomo -t` and isolated loopback runtime/preview tests with synthetic data. Provider bootstrap `proxy: DIRECT` remains service-plane; no new user direct-egress.
7. Existing Builder modes, AWL/Tiered/DPR, identity selector, project save/load, security stress and default YAML parity pass. **No live VPS/Keenetic configuration changes.**

## Isolated implementation sequence

1. **Schema/reader:** add v2 bounded structural validation, v1 + experimental-v2 missing-identity diagnostics and synthetic tests. Keep current runtime/page behavior unchanged initially.
2. **Project context:** a memory-scoped identity model, explicit secure export, import/Undo/Reset transaction, visible scope distinction, and browser A/B tests. Default single-HWID remains unchanged.
3. **Provider cards / stable source IDs:** reconcile the URL list, identity references, advanced selection and import-exact-HWID UI; prevent duplicate/ref ambiguity.
4. **Runtime integration:** use web4core#21's reviewed API only after consumer-ready tests; align Preview ↔ Build ↔ export/import/rebuild; run full CI on exact SHAs and provenance.
5. **Release:** only after separate owner GO. Never merge an isolated experimental engine PR into the published fork or promote to stable in this ADR's scope.

**Non-goals for this slice:** custom provider name/path/interval/health (#282), per-tier probes (#281), new MASQUE/WG creation (#278), unrelated DIRECT-egress policies (#284), release tagging/publishing.

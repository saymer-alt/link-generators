# Upstream compatibility registry

This document defines how Link Generators tracks compatibility facts that come from external projects without turning those projects into an unquestioned source of truth.

## Any-Tech-ARCHITECT → Mihomo / AmneziaWG

Reference project: `Vadim-Khristenko/Any-Tech-ARCHITECT`.

Architect contains a client/engine compatibility model for AmneziaWG, including a `mihomo / Clash.Meta` target. Link Generators keeps a local structured snapshot in:

`data/upstream/architect-mihomo-compat.json`

The snapshot stores the blob SHA of only the upstream files that can materially change Mihomo/AWG compatibility. An unrelated README/UI commit upstream must not create release noise.

Current watched files:

- `src/engines/awg/generator/clients.ts`
- `src/engines/awg/generator/engines.ts`
- `src/engines/awg/generator/versions.ts`
- `src/engines/awg/mihomoFormat.ts`
- `src/engines/awg/__tests__/mihomo.test.ts`

## Authority model

Architect is a **reference**, not the production source of truth for Link Generators.

A compatibility statement can have one of these evidence levels:

- `UPSTREAM-OBSERVED` — present in Architect or another external project;
- `SOURCE-PROVEN` — independently confirmed in the current Mihomo/amneziawg-go source;
- `RUNTIME-PROVEN` — reproduced by a deterministic runtime test/PoC;
- `FIELD-OBSERVED` — observed in a real deployment;
- `CONFLICT` — sources disagree;
- `UNKNOWN` — insufficient evidence.

Only facts independently proven by current source/runtime should silently constrain generated YAML. An upstream-only observation may produce a diagnostic or a review requirement, but it must not silently mutate user semantics.

## Release check

Before every minor/major release and before a release that changes WG/AWG compatibility, run:

```bash
node tools/check-architect-upstream.mjs
```

Expected result when nothing relevant changed:

```text
ARCHITECT_COMPAT_SOURCES_UNCHANGED
```

If one or more relevant blob SHAs changed, the checker exits non-zero and lists only those files.

Then:

1. inspect the upstream diff for the changed watched files;
2. identify new/changed Mihomo compatibility claims;
3. independently verify material claims against current Mihomo/amneziawg-go source and/or runtime tests;
4. update generator diagnostics/tests if warranted;
5. update the local JSON snapshot deliberately;
6. record the review in release evidence.

Do not update stored SHAs merely to make the watcher green.

## Periodic watch

`.github/workflows/upstream-compat-watch.yml` runs the same check weekly and supports manual `workflow_dispatch`.

The workflow is read-only. It does not modify the snapshot and does not create compatibility rules automatically.

## Initial Mihomo observations from Architect

At the snapshot dated 2026-10-06, Architect models `mihomo / Clash.Meta` as using `amneziawg-go 3.x` and states, among other facts:

- CPS tags: `b`, `t`, `r`, `rc`, `rd`, `d`, `ds`, `dz`;
- `<c>` absent from the `amneziawg-go` tag vocabulary;
- S3/S4 and I1–I5 supported;
- H values up to uint32 max;
- `maxJc = 10` and `maxS4 = 32` in its client model;
- AWG 3.1 includes RandomTrailers/DisableCookies capability flags.

These are stored as `UPSTREAM-OBSERVED` until individually promoted by local proof.

## Known upstream discrepancy

The current Architect `mihomoFormat.ts` / `mihomo.test.ts` branch treats `version: 3` in a way that does not line up cleanly with Link Generators' own v1.8 Mihomo AWG 3.1 source research.

That discrepancy is intentionally recorded in the snapshot as `CONFLICT`.

It is an example of why the sync process is **review + verify**, not copy-and-paste.

## Generator UX direction

The local matrix is intended to feed v1.9+ diagnostics without any live browser request to GitHub.

For a proven incompatibility, the UI should say what is incompatible, what will happen, and why. Example:

> ⚠ Профиль содержит параметр `<c>`, который целевой движок Mihomo/amneziawg-go не поддерживает. Параметр требует явного решения пользователя; генератор не будет молча менять семантику.

For an unsupported value shape such as a native AWG keepalive range where Mihomo expects a different representation:

- preserve the raw input fact;
- explain the mismatch;
- default to no silent conversion;
- offer an explicit fallback only when the user chooses it;
- record that choice in Semantic Trace.

For a stale compatibility snapshot:

> ⚠ Upstream compatibility sources changed after the last verified snapshot. Revalidation is required before this rule can be treated as current.

## Semantic Trace

Compatibility decisions should eventually expose:

`raw input → target implementation → compatibility rule → emitted/omitted/normalized → reason → evidence/source`

This keeps upstream knowledge auditable and prevents an external project's assumptions from becoming invisible generator behavior.

## Privacy

The compatibility registry stores only public source metadata, capability facts and blob SHAs.

It must never store or upload user PrivateKey, PSK, HPK, endpoint credentials or imported private configs.

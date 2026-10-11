# Fixture provenance (synthetic)

Created 2026-10-08, NIGHT-MEGA-01 B2. Sintetika, no real endpoints/credentials.

- `domains.list` / `cidrs.list` — synthetic input lists (RFC 5737/3849 + example domains only).
- `*.mrs` — produced by the OFFICIAL mihomo binary v1.19.31 (Windows amd64):
  `mihomo convert-ruleset domain text domains.list synthetic.mrs`
  `mihomo convert-ruleset ipcidr text cidrs.list synthetic-ip.mrs`
- `*.inner` — `zstd -d` (zstd v1.5.6, sha256 6b5c50dd...) of the corresponding .mrs.
- These fixtures exist to byte-verify the JS port in decode-mrs.test.mjs against
  the official binary output. No real geo data is vendored here.

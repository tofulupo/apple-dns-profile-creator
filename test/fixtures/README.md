# Test fixtures

Re-fetch everything with `deno task fixtures:fetch`.
Validate with `deno task fixtures:lint` (uses Apple's `plutil`, macOS only).

## `upstream/paulmillr/` — committed

Source: <https://github.com/paulmillr/encrypted-dns> (`profiles/`)
License: **The Unlicense** (public domain).

| Fixture | Covers |
| --- | --- |
| `cloudflare-default-https` | DoH, `ServerURL`, dual-stack `ServerAddresses` |
| `cloudflare-default-tls` | DoT, `ServerName` |
| `quad9-default-tls`, `adguard-family-tls` | further DoT variants |
| `quad9-ECS-https`, `google-default-https` | further DoH variants |
| `mullvad-default-https` | DoH, minimal key set |
| `dns4eu-protective-child-ads-tls` | recent provider, long display names |
| `360-default-https` | non-ASCII content (encoding round-trip) |
| `template-on-demand-default-https` | **the only upstream file with `OnDemandRules`** |

## `upstream/mullvad/` — gitignored, fetch on demand

Source: <https://github.com/mullvad/encrypted-dns-profiles>
License: **none declared** - therefore *not* redistributed in this repo.
`deno task fixtures:fetch` pulls them locally.

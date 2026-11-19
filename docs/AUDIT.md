# Release audit — 2026-11-16

Scope: source review, reproducible local HTTP checks, selected market-data calculations, settings backups, dependency advisories and clean installation. No exchange trading account or private VPS was accessed for this audit.

## Findings addressed

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Malformed request URL could terminate the process | Guard parsing; return 400 | Raw TCP regression, followed by healthy request |
| Foreign websites / hostile hostnames could reach local APIs | Host, Origin and cross-site validation before dispatch | Rejected requests invoke no provider calls |
| Optional private connector tried an implicit SSH host | Off by default, explicit opt-in and validated alias | Disabled index/image regression |
| Unbounded queued work and history bootstrap churn | API admission, bounded queues and resident initialization | Parallel request admission regression; source review |
| Settings export lost names after namespace change | Shared prefix and tested export/import | Backup round-trip and rejection without partial writes |
| Inherited operator names passed settings validation | Own-property validation | Invalid `toString` operator regression |
| Background scan could starve visible symbols | Priority scheduler, bounded retries, fresh-success count | Foreground-before-backlog and retry regressions |
| OI USD meanings differed across providers | Shared quantity-delta calculation; bounded observation age | Known-result OI fixture and source review |
| Malformed provider numbers could corrupt candles | Reject nonfinite input | Aggregation code validation |
| Source install relied on prebuilt interface | First-run automatic build and Windows launcher | Clean-install verification recorded below |
| Public package could include personal/runtime artifacts | Explicit source manifest, ignored runtime files, source gate | Release source and archive inspection |

Downloaded assets with unresolved redistribution rights are not included. The release uses the locally authored logo, text coin fallbacks and licensed Geist packages. Mandatory chart attribution and third-party licenses are preserved.

## Validation record

- Windows / Node 24: TypeScript check and production build pass.
- 21 automated regression tests pass, including six market-policy cases.
- npm dependency audit returned no reported advisories at the time of this audit. This result is time-sensitive and CI repeats the check.
- Clean source copy: no node_modules, dist, .cache or .env. npm ci succeeded; startup built the interface in approximately three seconds and returned a healthy local API. No Python or SSH configuration was used.
- Browser: public Binance listings, day/night persistence across reloads, default 15m chart, English controls and a 390px viewport were inspected. No horizontal page overflow was observed.
- Windows CRLF script hashing initially blocked pre-paint theme initialization; the CSP hash now follows browser newline normalization and has its own regression.
- Settings export/import has a source-level round-trip regression. Browser download-event automation was unavailable, so file download/import was not claimed as an end-to-end browser test.
- Independent source reviewers checked security/engineering and product behavior separately; actionable follow-up findings were fixed.

## Limits

This is a targeted release audit, not a guarantee of complete security or correctness. Linux execution is configured in CI but has not yet run on GitHub. Exchange availability and every supported instrument/timeframe are not exhaustively tested. No end-to-end test of a separately configured private SSH feed was performed. The image reader requires its documented existing schema; private account and SSH restrictions remain the operator's responsibility. Long, high-volume second history can take substantial time and memory.

GitHub publication, private vulnerability-reporting settings and the first hosted CI result are separate release steps. The included source is a local application, not an authenticated public web deployment.

Follow-up: configurable rank highlights have five movement regressions plus settings validation/backup coverage. The expanded suite passes 27 tests. Browser checks verified disabled mode, threshold persistence after reload, and restoration to enabled/2 places.


## 2026-11-19 release check

A sample of ten 5m and 1h windows was matched against the exchanges' public one-minute candles using the same start and end timestamps. The sample covered BTC and ETH on both exchanges and ICNT on Binance. Prices and trade counts matched in those windows, as did Binance quote volume and taker volume delta. Independently timed ticker readings can differ while a cached snapshot is in use. This is a sampled check of selected metrics.

The regression suite checks that cached partial candles stay excluded after a minute boundary. It also covers local HTTP routing, input validation, request admission, settings, chart aggregation and instrument policy. The source archive is assembled from the explicit release manifest.

A clean Windows installation built on first launch. Browser checks opened the live Binance market table and BTC chart with the optional connector disabled. All 29 local tests passed and the npm audit reported zero known advisories. Hosted GitHub Actions and a live opt-in connector were outside this verification.

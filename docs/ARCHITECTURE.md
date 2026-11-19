# Architecture

## Request path

Browser React interface → same-origin loopback HTTP API → public Binance / Hyperliquid adapters.

The browser owns presentation, filters, ordering and local preferences. The Node API validates requests before dispatching data work. Provider adapters own deduplication, public-data caching, concurrency and exchange budgets. The seconds module owns resumable aggregation and history coverage. The optional SSH reader is separate and disabled by default.

## Boundaries and choices

- Local-first deployment keeps the default setup to Node and npm. There is no hosted authentication or account database.
- Foreground prices have a separate request lane from background enrichment. Visible and monitored symbols are refreshed before scan backlogs.
- Missing data remains missing. Historical trade gaps are not silently filled with synthetic price movement; zero-volume flat candles are used only inside verified continuous coverage.
- OI percentage is position-quantity change. USD OI change values that quantity change at the current price. Hyperliquid needs local observations close enough to each target interval.
- Chart history is progressive to respect exchange budgets. Seven-day coverage is a request target, not a promise of instant availability.
- Browser alerts depend on an active local app. They are not a server-side guaranteed delivery service.
- The optional reader accepts a validated SSH alias; credentials remain in SSH configuration. Only known non-account metrics and unambiguous saved images are returned.

## Source map

| Area | Files |
| --- | --- |
| HTTP boundary and static build | `server.mjs` |
| Public providers and cache | `providers.mjs`, `market-policy.mjs`, `market-math.mjs` |
| Second-based history | `seconds-history.mjs` |
| Market UI and prioritization | `src/main.tsx`, `src/detail-scheduler.ts` |
| Charts and themes | `src/PriceChart.tsx`, `src/Theme.tsx` |
| Settings and alerts | `src/settings.ts`, `src/useAlerts.ts` |
| Optional images | `copilot-feed.mjs`, `copilot-read.py`, `src/CopilotFeed.tsx` |
| Startup and release manifest | `scripts/` |

The current main screen remains a substantial component. Further component extraction can improve maintenance, but a broad rewrite is intentionally outside the release hardening scope.

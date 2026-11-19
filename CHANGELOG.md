# Changelog

## 1.1.0

- The right-hand panel automatically detects price and volume impulses using public exchange data and displays three candlestick timeframes.
- Scan activity is bounded and pauses when the browser tab is hidden. When no signal qualifies, the panel displays a labelled market overview.
- The optional TRADING COPILOT image connector remains available for existing installations.

## 1.0.0 — 2026-11-16

- Self-contained source release with Node 24 startup and first-run build.
- Hardened local requests, malformed URLs, input validation and resource admission.
- Explicit opt-in for the private alert-image connector.
- Fixed settings backups, scan priority, failure retry timing and coverage counts.
- Consistent open-interest calculations and rejection of stale historical comparisons.
- Regression coverage, release checks, CI, documentation and third-party notices.

- Reject cached partial candles after the minute boundary and expose exact intraday price windows.
- Keep table scroll stable during updates and minimize the optional alert payload.

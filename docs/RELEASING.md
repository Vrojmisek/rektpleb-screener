# Release checklist

## Local checks

1. Use Node 24, run `npm ci`, `npm run verify` and `npm audit`.
2. Install a clean source copy with no `node_modules`, `.cache`, `.env` or `dist`; verify `npm ci` followed by `npm start` builds and serves the app.
3. Inspect both themes, table controls, settings export/import and the default 15m chart in a browser.
4. Include only the source manifest from `scripts/release-check.mjs`. Exclude runtime files and personal screenshots. README screenshots must show public market data with no private integrations.
5. Preserve `LICENSE`, `NOTICE`, `licenses/` and visible TradingView attribution.

## GitHub publication

Suggested repository: `rektpleb-screener`, description: “Local-first crypto screener with live market data, full-screen charts and optional alert images.” Topics: `react`, `typescript`, `crypto`, `market-data`, `local-first`.

Create the repository under the owner's account, upload this clean source root and its lockfile, then wait for **Verify** on Windows and Linux. Do not upload a parent folder containing personal workspace artifacts. Enable private vulnerability reporting and dependency alerts in the repository settings. Pin the repository to the profile only after reviewing its README preview and CI result.

For the first release, tag `v1.0.0` after CI succeeds. State the local-only deployment model and progressive seconds-history limitations in the release notes. Do not claim an existing hosted demo or a successful hosted CI run before one exists.

This checklist prepares publication; no push, tag or remote repository creation is performed by local verification scripts.

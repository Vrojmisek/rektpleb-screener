# Security

## Supported deployment

REKTPLEB 1.x is a local, single-user application. It binds to loopback, validates Host and Origin, rejects cross-site requests and limits concurrent API work. Production responses include a Content Security Policy and browser isolation headers. The API has no order execution or exchange-account access.

It is not an authenticated internet-facing service. Do not expose the port through a reverse proxy or change its binding without adding authentication, TLS and an appropriate multi-user threat model. A malicious local process or browser extension with local access is outside this boundary.

## Storage and privacy

- Browser local storage contains preferences, watchlists, alert rules and recent alert events. Exported backups can reveal those choices.
- `.cache/` contains public exchange data and resumable trade history; chart requests can reveal which symbols you viewed.
- No analytics or telemetry is sent. Network requests go to npm during installation and the documented exchanges during use.
- The optional SSH connector accesses your configured server only when enabled. SSH keys remain managed by your SSH client; no key, password or bot token is stored by this app. Connector results are private local responses.
- Stop the app before clearing `.cache/`. Remove browser site storage separately to clear preferences.

## Resource limits

There are eight active API requests, 360 admitted data requests per minute, bounded provider queues and two resident seconds-history symbols. Chart responses contain at most 100,000 bars. History files are pruned after seven days or when retained files exceed 256 MiB. Image transfers and cache are bounded. Long history still consumes memory and network bandwidth; no fixed RAM guarantee is made.

## Reporting

Use the repository's **Security → Report a vulnerability** feature once private vulnerability reporting is enabled. If unavailable, open an issue requesting a private contact without exploit details, credentials or personal data. Do not attach `.env`, private keys, browser backups, private images or production logs to public issues.

The audit covers source, the local HTTP boundary, settings validation and selected data calculations. It is not a penetration-test certification or a guarantee that all defects have been found. See [docs/AUDIT.md](docs/AUDIT.md).

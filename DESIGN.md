# REKTPLEB interface

Mode: Operate. React and TypeScript, Geist self-hosted from its licensed npm package. Maintain the existing mint-accent identity and custom R monogram.

Dark background #0c1416 and accent #69e3cd; daylight background #eef3f3 and accent #08796b. Semantic tokens in src/rektpleb.css cover panels, controls, text, rank feedback, charts and overlays. Keep text and small controls legible in both modes.

Keep navigation, market context and pulse totals in a compact shared header. Desktop rows adapt to approximately ten markets. Sticky symbol columns and horizontal scrolling preserve usable tables. Small screens wrap the header and stack workspace regions.

Charts open in near-fullscreen native dialogs with default 15m and focus restoration. Rank feedback affects complete rows only for changes of at least two positions, includes an arrow/count, and expires after four seconds. Motion is short and event-driven; reduced-motion disables it. Avoid continuous decorative animation and extra polling.

Optional integrations have a calm, accurate empty state and do not report errors merely because they are disabled. Preserve TradingView chart attribution and its footer link.

Desktop workspace keeps a stable 60/40 table-to-Copilot split. Extra columns scroll inside the table and must not shrink the chart panel.

Rank highlights are configurable in Local workspace. Default is enabled at 2 places; the threshold supports 1–100. Disabling hides active feedback immediately; changing either preference resets the comparison baseline. Preserve the four-second duration and persisted settings.

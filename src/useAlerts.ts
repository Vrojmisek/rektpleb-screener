import { useEffect } from "react";
import { matches, columns, operators, type Ticker } from "./metrics";
import { readPreference } from "./settings";
type Rule = {
  id: string;
  symbol: string;
  column: string;
  operator: string;
  value: number;
  enabled: boolean;
  exchange: "binance" | "hl";
};
export function useAlerts() {
  useEffect(() => {
    let stopped = false,
      busy = false;
    const controller = new AbortController(),
      latch = new Set<string>();
    const fetchData = async (path: string) => {
      const r = await fetch("/api/" + path, { signal: controller.signal });
      if (!r.ok) throw Error("Alert feed unavailable");
      return r.json();
    };
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const rules = readPreference<Rule[]>("alerts", []).filter(
          (r) => r.enabled,
        );
        for (const exchange of ["binance", "hl"] as const) {
          let selected = rules.filter((r) => r.exchange === exchange);
          if (!selected.length) continue;
          const market = await fetchData(`market?exchange=${exchange}`);
          // A fast cached response must not trigger alerts from stale prices.
          if (Date.now() - market.time > 30000) continue;
          selected = selected.filter((rule) =>
            market.rows.some((row: Ticker) => row.symbol === rule.symbol),
          );
          const symbols = [
            ...new Set(
              selected
                .filter(
                  (r) =>
                    !(
                      r.column in
                      (market.rows.find((t: Ticker) => t.symbol === r.symbol) ||
                        {})
                    ),
                )
                .map((r) => r.symbol),
            ),
          ];
          let details: Ticker[] = [];
          for (let i = 0; i < symbols.length; i += 12) {
            const result = await fetchData(
              `details?exchange=${exchange}&symbols=${symbols
                .slice(i, i + 12)
                .map(encodeURIComponent)
                .join(",")}`,
            );
            details.push(...result.rows);
          }
          if (stopped) return;
          if (Date.now() - market.time > 30000) continue;
          for (const rule of selected) {
            const row = market.rows.find(
              (t: Ticker) => t.symbol === rule.symbol,
            );
            if (!row) continue;
            const detail = details.find((t) => t.symbol === rule.symbol);
            const merged = {
              ...(detail && Date.now() - Number(detail.detailsAt) < 150000
                ? detail
                : {}),
              ...row,
            };
            if (!(rule.column in merged)) continue;
            const hit = matches(merged, [rule]);
            if (hit && !latch.has(rule.id)) {
              latch.add(rule.id);
              const label =
                  columns.find((c) => c.id === rule.column)?.label ||
                  rule.column,
                text = `${exchange === "hl" ? "Hyperliquid" : "Binance"} · ${row.symbol} · ${label} ${operators[rule.operator]} ${rule.value}`;
              const next = [
                { id: crypto.randomUUID(), text, time: Date.now() },
                ...readPreference<{ id: string; text: string; time: number }[]>(
                  "alertEvents",
                  [],
                ),
              ].slice(0, 100);
              localStorage.setItem(
                "rektpleb-screener:alertEvents",
                JSON.stringify(next),
              );
              window.dispatchEvent(
                new CustomEvent("rektpleb-alert", {
                  detail: { text, events: next },
                }),
              );
              if (
                "Notification" in window &&
                Notification.permission === "granted"
              )
                new Notification("REKTPLEB screener", { body: text });
            }
            if (!hit) latch.delete(rule.id);
          }
        }
      } catch (e) {
        if (!stopped)
          window.dispatchEvent(
            new CustomEvent("rektpleb-alert-error", {
              detail: (e as Error).message,
            }),
          );
      } finally {
        busy = false;
      }
    };
    void run();
    const id = setInterval(() => void run(), 10000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(id);
    };
  }, []);
}

export const periods = ["5m", "15m", "1h", "4h", "8h", "12h", "1d"] as const;
export type Column = {
  id: string;
  label: string;
  group: string;
  format: string;
  width: number;
  tooltip: string;
};
export type Ticker = {
  symbol: string;
  price: number;
  [key: string]: unknown;
  trend?: number[];
};
const groups = [
  [
    "changePercent",
    "CHANGE %",
    "CHG %",
    "percent",
    135,
    "Price change (%). Intraday windows use completed 1m candles. Hover over a value to see its inputs.",
  ],
  [
    "changeDollar",
    "CHANGE $",
    "CHG $",
    "price",
    115,
    "Price change (USD). Intraday windows use completed 1m candles. Hover over a value to see its inputs.",
  ],
  ["volume", "Volume", "Vol", "volume", 112, "Total trading volume in USD."],
  [
    "trades",
    "Trades",
    "Trd",
    "number",
    100,
    "Number of trades over the selected period.",
  ],
  [
    "volatility",
    "Volatility",
    "Vlt",
    "percent",
    110,
    "Standard deviation of one-minute price returns (%).",
  ],
  [
    "oiChange",
    "OI CHANGE %",
    "OI CHG %",
    "percent",
    150,
    "Change in the amount of open positions (%).",
  ],
  [
    "oiChangeDollar",
    "OI CHANGE $",
    "OI CHG $",
    "volume",
    150,
    "Change in position quantity valued at the current price. Hyperliquid uses local observations.",
  ],
  [
    "vdelta",
    "Volume Δ",
    "Vol Δ",
    "volume",
    120,
    "Aggressive buy volume minus aggressive sell volume.",
  ],
  [
    "volumeChange",
    "VOL CHANGE %",
    "VOL CHG %",
    "percent",
    150,
    "Volume change from the previous equal period (%).",
  ],
  [
    "volumeChangeDollar",
    "VOL CHANGE $",
    "VOL CHG $",
    "volume",
    150,
    "Volume change from the previous equal period (USD).",
  ],
  [
    "btcCorrelation",
    "BTC CORR",
    "COR",
    "number",
    110,
    "Pearson correlation of minute returns with Bitcoin.",
  ],
] as const;
export const columns: Column[] = [
  {
    id: "symbol",
    label: "Symbol",
    group: "Core",
    format: "text",
    width: 200,
    tooltip: "Trading pair or market name.",
  },
  {
    id: "price",
    label: "Price",
    group: "Core",
    format: "price",
    width: 115,
    tooltip: "Current price in USD.",
  },
  {
    id: "openInterest",
    label: "OI $",
    group: "Core",
    format: "volume",
    width: 110,
    tooltip: "Total value of open positions in USD.",
  },
  {
    id: "fundingRate1h",
    label: "Funding/h",
    group: "Core",
    format: "funding",
    width: 130,
    tooltip: "Funding per hour. Positive = longs pay shorts.",
  },
  {
    id: "rvol",
    label: "RVOL",
    group: "Core",
    format: "ratio",
    width: 90,
    tooltip: "Last 5m quote volume / average 5m quote volume over 24h.",
  },
  {
    id: "mcap",
    label: "MCAP",
    group: "Core",
    format: "volume",
    width: 110,
    tooltip:
      "Market capitalization is unavailable from the connected derivatives APIs.",
  },
  ...groups.flatMap(([id, group, short, format, width, tooltip]) =>
    periods.map((p) => ({
      id: `${id}_${p}`,
      group,
      label: `${short} (${p})`,
      format,
      width,
      tooltip,
    })),
  ),
];
export const defaultColumns = [
  "symbol",
  "price",
  "changePercent_5m",
  "changePercent_1h",
  "changePercent_1d",
  "volume_1h",
  "volume_1d",
  "openInterest",
  "oiChange_1h",
  "fundingRate1h",
  "volatility_15m",
  "trades_15m",
];
export const groupNames = ["Core", ...groups.map((g) => g[1])];
export type Filter = {
  column: string;
  operator: string;
  value: number;
  value2?: number;
};
export const operators: Record<string, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  eq: "=",
  between: "between",
  abs_gt: "|x| >",
};
export const presets: { name: string; filters: Filter[] }[] = [
  {
    name: "High Volume",
    filters: [{ column: "rvol", operator: "gt", value: 2 }],
  },
  {
    name: "OI Spike",
    filters: [{ column: "oiChange_1h", operator: "gt", value: 5 }],
  },
  {
    name: "Big Movers",
    filters: [{ column: "changePercent_1h", operator: "gt", value: 3 }],
  },
  {
    name: "High Funding",
    filters: [{ column: "fundingRate1h", operator: "abs_gt", value: 0.05 / 8 }],
  },
];
export function matches(t: Ticker, filters: Filter[]) {
  return filters.every((f) => {
    const x = t[f.column];
    if (typeof x !== "number" || !Number.isFinite(x)) return false;
    switch (f.operator) {
      case "gt":
        return x > f.value;
      case "gte":
        return x >= f.value;
      case "lt":
        return x < f.value;
      case "lte":
        return x <= f.value;
      case "eq":
        return x === f.value;
      case "abs_gt":
        return Math.abs(x) > f.value;
      case "between":
        return x >= f.value && x <= (f.value2 ?? f.value);
      default:
        return false;
    }
  });
}
export function compact(n: number) {
  const a = Math.abs(n);
  for (const [v, s] of [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const)
    if (a >= v) return (n / v).toFixed(2) + s;
  return n.toFixed(2);
}
export function format(v: unknown, c: Column) {
  if (typeof v === "string") return v;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (c.format === "price") {
    const a = Math.abs(v),
      d = a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 4 : a >= 0.0001 ? 6 : 8;
    return (
      "$" +
      v.toLocaleString("en-US", {
        minimumFractionDigits: Math.min(d, 2),
        maximumFractionDigits: d,
      })
    );
  }
  if (c.format === "volume")
    return (v < 0 ? "−" : "") + "$" + compact(Math.abs(v));
  if (c.format === "percent") return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  if (c.format === "funding") return (v > 0 ? "+" : "") + v.toFixed(5) + "%";
  if (c.format === "ratio") return v.toFixed(2) + "x";
  return compact(v);
}

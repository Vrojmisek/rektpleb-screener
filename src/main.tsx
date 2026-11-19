import type { RankHighlightSettings } from "./rank-changes";
import { nextDetailSymbol } from "./detail-scheduler";
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/geist/latin-600.css";
import "@fontsource/geist/latin-700.css";
/* REKTPLEB: a focused, personal crypto workspace. */
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, ThemeToggle } from "./Theme";
import { PriceChart } from "./PriceChart";
import {
  columns,
  defaultColumns,
  groupNames,
  periods,
  presets,
  operators,
  matches,
  format,
  type Column,
  type Ticker,
  type Filter,
} from "./metrics";
import "./style.css";
import {
  readPreference,
  importPreferences,
  exportPreferences,
} from "./settings";
import { useAlerts } from "./useAlerts";
import coinImages from "./coins.json";
import { MarketOverview } from "./MarketOverview";
import "./refresh.css";
import { CopilotFeed } from "./CopilotFeed";
import "./copilot.css";
import "./header.css";
import "./market-rows.css";
import "./trading-motion.css";
import "./rektpleb.css";
import { useRankMovement } from "./useRankMovement";
type Exchange = "binance" | "hl";
type Market = {
  time: number;
  source: string;
  rows: Ticker[];
  warnings: string[];
  details?: Record<string, Ticker>;
};
type AlertRule = {
  id: string;
  symbol: string;
  column: string;
  operator: string;
  value: number;
  enabled: boolean;
  exchange: Exchange;
};
type Preset = { name: string; filters: Filter[] };
const read = readPreference;
function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    try {
      localStorage.setItem("rektpleb-screener:" + key, JSON.stringify(value));
    } catch {
      /* Storage disabled: session remains usable. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch("/api/" + path, { signal });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || `HTTP ${r.status}`);
  return data;
}
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    filter: <path d="M3 4h18l-7 8v7l-4 2v-9z" />,
    columns: (
      <>
        <path d="M4 3v18M12 3v18M20 3v18" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    chart: <path d="M3 3v17h18M6 15l4-5 4 3 5-7" />,
    star: (
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 2v1" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    binance: (
      <>
        <path
          d="m12 2 4 4-4 4-4-4zm-6 6 4 4-4 4-4-4zm12 0 4 4-4 4-4-4zm-6 6 4 4-4 4-4-4z"
          fill="currentColor"
          stroke="none"
        />
        <path d="m12 9 3 3-3 3-3-3z" fill="currentColor" stroke="none" />
      </>
    ),
    hl: (
      <path
        d="M2 12C2 4 5 4 8 10c3 6 5-1 8-5s6 2 6 7-3 9-6 5-5-4-8 1-6 0-6-6Z"
        fill="currentColor"
        stroke="none"
      />
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.help}
    </svg>
  );
}
function Sparkline({ row }: { row: Ticker }) {
  const values = row.trend;
  if (!values?.length)
    return (
      <span className="trend-wait" title="Loading measured price history">
        —
      </span>
    );
  const min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1;
  return (
    <svg
      viewBox="0 0 90 25"
      className="spark"
      role="img"
      aria-label={`${row.symbol} observed price trend${row.trendPartial ? " (partial history)" : ""}`}
    >
      <polyline
        points={values
          .map(
            (v, i) =>
              `${(i / (values.length - 1)) * 88 + 1},${23 - ((v - min) / span) * 21}`,
          )
          .join(" ")}
        fill="none"
        stroke={
          values.at(-1)! >= values[0] ? "var(--positive)" : "var(--negative)"
        }
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
function Coin({ row }: { row: Ticker }) {
  const originalBase = String(row.base || row.symbol),
    base = originalBase.replace(/^1000/, "");
  const artwork =
    (coinImages as Record<string, string>)[originalBase] ||
    (coinImages as Record<string, string>)[base];
  if (artwork)
    return <img className="coin" src={artwork} alt="" loading="lazy" />;
  const colors: Record<string, string> = {
    BTC: "#f7931a",
    ETH: "#707ca7",
    SOL: "#438f84",
    BNB: "#b89526",
    ZEC: "#c69a34",
    HYPE: "#4e9f8d",
    DOGE: "#b5a047",
    XRP: "#555",
  };
  return (
    <span
      className="coin"
      style={{
        background: colors[base] || "#202020",
        color: colors[base] ? "#fff" : "#808080",
      }}
    >
      {base === "BTC"
        ? "₿"
        : base === "ETH"
          ? "♦"
          : base === "ZEC"
            ? "Ƶ"
            : base.slice(0, 2)}
    </span>
  );
}
function Modal({
  title,
  close,
  children,
  className = "",
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input,select,a[href],[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + className}
        tabIndex={-1}
        ref={ref}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <Icon name="close" />
        </button>
        {children}
      </div>
    </div>
  );
}
function ExpandedPriceChart({
  exchange,
  symbol,
  close,
  opener,
}: {
  exchange: Exchange;
  symbol: string;
  close: () => void;
  opener: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    setReady(true);
    return () => {
      element?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.getElementById("search")?.focus();
    };
  }, []);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(close, 180);
    return () => clearTimeout(timer);
  }, [closing, close]);
  return (
    <dialog
      ref={dialog}
      className={"price-chart-dialog" + (closing ? " is-closing" : "")}
      aria-label={`Price chart ${symbol}`}
      onCancel={(event) => {
        event.preventDefault();
        setClosing(true);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setClosing(true);
      }}
    >
      <div className="price-chart-surface">
        <button
          className="price-chart-close"
          autoFocus
          aria-label="Close price chart"
          title="Close · Escape"
          onClick={() => setClosing(true)}
        >
          <Icon name="close" />
        </button>
        {ready && <PriceChart exchange={exchange} symbol={symbol} />}
      </div>
    </dialog>
  );
}
function App() {
  useAlerts();
  const [exchange, setExchange] = useStored<Exchange>("exchange", "binance");
  return (
    <Screener key={exchange} exchange={exchange} setExchange={setExchange} />
  );
}
const windowMinutes: Record<string, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "8h": 480,
  "12h": 720,
};
const windowTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
function priceWindowTitle(row: Ticker, column: string) {
  const period = /^change(?:Percent|Dollar)_(.+)$/.exec(column)?.[1];
  if (!period) return;
  if (period === "1d")
    return "24-hour change from the exchange daily reference.";
  const minutes = windowMinutes[period];
  const end = Number(row.priceWindowEnd);
  const open = (row.priceWindowOpens as Record<string, number> | undefined)?.[
    period
  ];
  const close = Number(row.priceWindowClose);
  if (
    !minutes ||
    !Number.isFinite(end) ||
    open === undefined ||
    !Number.isFinite(close)
  )
    return;
  const calculation = column.startsWith("changeDollar_")
    ? `${close} − ${open} = ${Number((close - open).toPrecision(10))}`
    : `(${close} / ${open} − 1) × 100 = ${((close / open - 1) * 100).toFixed(4)}%`;
  return `Closed 1m candles · ${windowTime.format(end - minutes * 60000)} → ${windowTime.format(end)} UTC · Open ${open} → Close ${close} · ${calculation}`;
}
function Screener({
  exchange,
  setExchange,
}: {
  exchange: Exchange;
  setExchange: (v: Exchange) => void;
}) {
  const [rankHighlights, setRankHighlights] = useStored<RankHighlightSettings>(
    "rankHighlights",
    { enabled: true, minPositions: 2 },
  );
  const [market, setMarket] = useState<Market | null>(null),
    [enriched, setEnriched] = useState<Record<string, Ticker>>({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [lastSuccess, setLastSuccess] = useState(0);
  const [query, setQuery] = useState(""),
    [sort, setSort] = useStored(`sort:${exchange}`, {
      column: "volume_1d",
      direction: "desc",
    }),
    [visible, setVisible] = useStored(`columns:${exchange}`, defaultColumns),
    [trend, setTrend] = useStored(
      `trend:${exchange}`,
      window.innerWidth >= 640,
    ),
    [favorites, setFavorites] = useStored<string[]>(
      `favorites:${exchange}`,
      [],
    ),
    [favoritesOnly, setFavoritesOnly] = useStored(
      `favoritesOnly:${exchange}`,
      false,
    ),
    [filters, setFilters] = useStored<Filter[]>(`filters:${exchange}`, []),
    [custom, setCustom] = useStored<Preset[]>(`presets:${exchange}`, []);
  const [, setTourDone] = useStored("tourDone", false),
    [tour, setTour] = useState<number | null>(() =>
      read("tourDone", false) ? null : 0,
    ),
    [panel, setPanel] = useState(""),
    [expanded, setExpanded] = useState<string | null>(null),
    [clock, setClock] = useState(Date.now()),
    [tick, setTick] = useState(0),
    [scrollTop, setScrollTop] = useState(0),
    [limit, setLimit] = useState(100),
    [scan, setScan] = useState(false),
    [detailError, setDetailError] = useState("");
  const [rules, setRules] = useStored<AlertRule[]>("alerts", []),
    [events, setEvents] = useStored<
      { id: string; text: string; time: number }[]
    >("alertEvents", []),
    [toast, setToast] = useState("");
  useEffect(() => {
    if (!rules.length) return;
    const controller = new AbortController();
    void Promise.allSettled(
      (["binance", "hl"] as const).map(async (source) => {
        const data = await api<Market>(
          `market?exchange=${source}`,
          controller.signal,
        );
        return { source, symbols: new Set(data.rows.map((row) => row.symbol)) };
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const universes = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      setRules((previous) => {
        const next = previous.filter((rule) => {
          const universe = universes.find((x) => x.source === rule.exchange);
          return !universe || universe.symbols.has(rule.symbol);
        });
        return next.length === previous.length ? previous : next;
      });
    });
    return () => controller.abort();
  }, [rules]);
  const [draft, setDraft] = useState<Filter>({
      column: "changePercent_1h",
      operator: "gt",
      value: 0,
    }),
    [presetName, setPresetName] = useState(""),
    [alertDraft, setAlertDraft] = useState({
      symbol: "",
      column: "price",
      operator: "gt",
      value: "",
    }),
    [profile, setProfile] = useStored("profile", "Personal workspace");
  const chartOpener = useRef<HTMLElement | null>(null);
  const tableViewport = useRef<HTMLElement | null>(null);
  const [tableSize, setTableSize] = useState({ height: 960, rowHeight: 96 });
  useEffect(() => {
    const element = tableViewport.current;
    if (!element) return;
    const header = element.querySelector("thead");
    const update = () => {
      const height = Math.max(
        0,
        element.clientHeight - (header?.getBoundingClientRect().height || 39),
      );
      const rowHeight = Math.max(64, Math.floor(height / 10));
      setTableSize((previous) =>
        previous.height === height && previous.rowHeight === rowHeight
          ? previous
          : { height, rowHeight },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (header) observer.observe(header);
    update();
    return () => observer.disconnect();
  }, []);
  const wanted = useRef<string[]>([]),
    visibleWanted = useRef<string[]>([]),
    loaded = useRef(new Map<string, number>()),
    scanWanted = useRef(scan),
    rowsRef = useRef<Ticker[]>([]),
    abortRef = useRef<AbortController | null>(null);
  scanWanted.current = scan;
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let alive = true,
      inFlight = false;
    const c = new AbortController();
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await api<Market>(`market?exchange=${exchange}`, c.signal);
        if (alive) {
          setMarket(data);
          if (data.details)
            setEnriched((previous) => {
              const next = { ...previous };
              for (const [symbol, detail] of Object.entries(data.details || {}))
                if (
                  Number(detail.detailsAt) >
                  Number(next[symbol]?.detailsAt || 0)
                )
                  next[symbol] = detail;
              return next;
            });
          setLastSuccess(data.time);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
        inFlight = false;
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 10000);
    return () => {
      alive = false;
      c.abort();
      clearInterval(id);
    };
  }, [exchange, tick]);
  const rows = useMemo<Ticker[]>(
    () =>
      market?.rows.map((row) => ({
        ...(clock - Number(enriched[row.symbol]?.detailsAt || 0) < 150000
          ? enriched[row.symbol]
          : {}),
        ...row,
      })) || [],
    [market, enriched, clock],
  );
  const scanCount = rows.filter(
    (row) => clock - Number(row.detailsAt || 0) < 150000,
  ).length;
  rowsRef.current = rows;
  const ordered = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (!query || r.symbol.toLowerCase().includes(query.toLowerCase())) &&
            (!favoritesOnly || favorites.includes(r.symbol)) &&
            matches(r, filters),
        )
        .sort((a, b) => {
          const x = a[sort.column],
            y = b[sort.column];
          if (x == null) return y == null ? 0 : 1;
          if (y == null) return -1;
          const cmp =
            typeof x === "number" && typeof y === "number"
              ? x - y
              : String(x).localeCompare(String(y));
          return sort.direction === "asc" ? cmp : -cmp;
        }),
    [rows, query, favoritesOnly, favorites, filters, sort],
  );
  const rankOrder = useMemo(() => ordered.map((row) => row.symbol), [ordered]);
  const rankScope = JSON.stringify([
    exchange,
    query,
    sort,
    filters,
    favoritesOnly,
    favoritesOnly ? favorites : [],
  ]);
  const rankReady = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row[sort.column] != null &&
            filters.every((filter) => row[filter.column] != null),
        )
        .map((row) => row.symbol),
    [rows, sort.column, filters],
  );
  const rankMovement = useRankMovement(
    rankOrder,
    rankScope,
    rankReady,
    rankHighlights,
  );
  const closePriceChart = useCallback(() => setExpanded(null), []);
  const openPriceChart = (
    event: React.MouseEvent<HTMLButtonElement>,
    symbol: string,
  ) => {
    chartOpener.current = event.currentTarget;
    setExpanded(symbol);
  };
  const display = ordered.slice(0, limit),
    first = Math.max(0, Math.floor(scrollTop / tableSize.rowHeight) - 2);
  const visibleCount = Math.ceil(tableSize.height / tableSize.rowHeight);
  const visibleSymbols = display
    .slice(first, first + visibleCount + 4)
    .map((r) => r.symbol);
  // Missing values must not prevent saved numeric filters from ever obtaining data.
  const filterPending = filters.length
    ? rows
        .filter(
          (row) =>
            (!query ||
              row.symbol.toLowerCase().includes(query.toLowerCase())) &&
            (!favoritesOnly || favorites.includes(row.symbol)) &&
            filters.some((filter) => row[filter.column] == null) &&
            clock - Number(row.detailsAt || 0) >= 150000,
        )
        .map((row) => row.symbol)
    : [];
  visibleWanted.current = visibleSymbols;
  wanted.current = [...new Set([...visibleSymbols, ...filterPending])];
  const detailReady = visibleSymbols.filter(
    (symbol) =>
      clock -
        Number(
          enriched[symbol]?.detailsAt ||
            market?.rows.find((r) => r.symbol === symbol)?.detailsAt ||
            0,
        ) <
      150000,
  ).length;
  // Detail worker enriches visible markets, then alert instruments. Full scan is explicit.
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let stopped = false;
    const inFlight = new Set<string>();
    const run = async (allowBacklogFirst: boolean) => {
      while (!stopped) {
        const all = rowsRef.current;
        const monitored = rules
          .filter(
            (r) =>
              r.enabled &&
              r.exchange === exchange &&
              all.some((row) => row.symbol === r.symbol),
          )
          .map((r) => r.symbol);
        const candidates = [
          ...new Set([
            ...wanted.current,
            ...monitored,
            ...(scanWanted.current ? all.map((r) => r.symbol) : []),
          ]),
        ];
        const now = Date.now();
        const priority = [...visibleWanted.current, ...monitored];
        const scheduler = {
          candidates,
          priority,
          attempted: loaded.current,
          measured: new Map(
            all.map((row) => [row.symbol, Number(row.detailsAt || 0)]),
          ),
          inFlight,
          now,
        };
        const prioritySet = new Set(priority);
        const symbol =
          (allowBacklogFirst &&
            nextDetailSymbol({
              ...scheduler,
              candidates: candidates.filter(
                (candidate) => !prioritySet.has(candidate),
              ),
            })) ||
          nextDetailSymbol(scheduler);
        if (!symbol) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        inFlight.add(symbol);
        try {
          const d = await api<{
            rows: Ticker[];
            errors: { symbol: string; error: string }[];
          }>(
            `details?exchange=${exchange}&symbols=${encodeURIComponent(symbol)}`,
            controller.signal,
          );
          if (stopped) return;
          // Attempt scheduling is separate from the measurement's original freshness.
          loaded.current.set(symbol, Date.now());
          const result = d.rows[0];
          if (result) setEnriched((prev) => ({ ...prev, [symbol]: result }));
          setDetailError(
            d.errors.length ? `${symbol}: ${d.errors[0].error}` : "",
          );
        } catch (e) {
          if (stopped) return;
          setDetailError((e as Error).message);
          loaded.current.set(symbol, Date.now());
        } finally {
          inFlight.delete(symbol);
        }
      }
    };
    // Each free slot takes the next instrument without waiting for slower neighbours.
    for (let i = 0; i < 4; i++) void run(i === 3);
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [exchange, rules]);
  useEffect(() => {
    const alert = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setEvents(detail.events);
      setToast(detail.text);
    };
    const failure = (e: Event) =>
      setDetailError("Alerts: " + (e as CustomEvent).detail);
    window.addEventListener("rektpleb-alert", alert);
    window.addEventListener("rektpleb-alert-error", failure);
    return () => {
      window.removeEventListener("rektpleb-alert", alert);
      window.removeEventListener("rektpleb-alert-error", failure);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        setPanel("");
        setExpanded(null);
      }
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        document.getElementById("search")?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const activeColumns = visible
    .map((id) => columns.find((c) => c.id === id))
    .filter(Boolean) as Column[];
  const finishTour = () => {
    setTour(null);
    setTourDone(true);
  };
  const togglePanel = (name: string) =>
    setPanel((p) => (p === name ? "" : name));
  const toggleColumn = (id: string) => {
    if (id === "symbol") return;
    setVisible((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };
  const toggleFavorite = (symbol: string) =>
    setFavorites((prev) =>
      prev.includes(symbol)
        ? prev.filter((x) => x !== symbol)
        : [...prev, symbol],
    );
  const sortBy = (column: string) =>
    setSort((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "desc" ? "asc" : "desc",
    }));
  const numeric = columns.filter((c) => c.format !== "text"),
    isStale = lastSuccess > 0 && clock - lastSuccess > 30000;
  const exportCSV = () => {
    const csv = [
      activeColumns.map((c) => c.label),
      ...ordered.map((r) => activeColumns.map((c) => r[c.id] ?? "")),
    ]
      .map((line) =>
        line.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = `rektpleb-${exchange}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importSettings = async (file: File) => {
    try {
      if (file.size > 2000000) throw Error("File too large");
      importPreferences(JSON.parse(await file.text()));
      location.reload();
    } catch {
      setToast(
        "Settings file is invalid. Import a file exported by REKTPLEB screener.",
      );
    }
  };
  const exportSettings = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(exportPreferences(), null, 2)], {
        type: "application/json",
      }),
    );
    a.download = "rektpleb-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="app">
      <header className="app-header">
        <nav className="nav">
          <div className="brand-lockup">
            <svg
              className="brand-mark"
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <rect width="32" height="32" rx="10" fill="currentColor" />
              <path
                d="M9 23V9h7a4 4 0 0 1 0 8h-7m7 0 7 6"
                stroke="var(--accent-ink)"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
            </svg>
            <strong className="brand-name">
              REKTPLEB<span>screener</span>
            </strong>
          </div>
          <div className="exchange-switch">
            <div className="exchange-buttons">
              {(["binance", "hl"] as const).map((x) => (
                <button
                  key={x}
                  aria-pressed={exchange === x}
                  className={exchange === x ? "active" : ""}
                  onClick={() => setExchange(x)}
                >
                  <Icon name={x === "hl" ? "hl" : "binance"} size={16} />
                  {x === "binance" ? "Binance" : "Hyperliquid"}
                </button>
              ))}
            </div>
            <select
              className="exchange-mobile"
              aria-label="Exchange"
              value={exchange}
              onChange={(e) => setExchange(e.target.value as Exchange)}
            >
              <option value="binance">Binance</option>
              <option value="hl">Hyperliquid</option>
            </select>
          </div>
          <ThemeToggle />
          <button
            className="profile-button"
            title="Local workspace settings"
            onClick={() => setPanel("profile")}
          >
            <span className="local-dot" />
            Local
          </button>
        </nav>
        <MarketOverview rows={rows} loading={loading} />
      </header>
      <div className="screener-workspace">
        <section
          className="screener-table-panel"
          aria-label="Crypto screener"
          style={
            {
              "--market-table-width": `${48 + (trend ? 112 : 0) + activeColumns.reduce((sum, column) => sum + column.width, 0)}px`,
            } as React.CSSProperties
          }
        >
          <div className="toolbar">
            <div className="search-wrap">
              <span className="search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                id="search"
                aria-label="Search instruments"
                placeholder="Search crypto..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(100);
                  setScrollTop(0);
                }}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
            <span className="symbol-count">
              {ordered.length} <span className="count-label">markets</span>
              {loading && <span className="pulse">●</span>}
            </span>
            <div className="presets">
              {presets.map((p) => (
                <button
                  key={p.name}
                  className={
                    JSON.stringify(filters) === JSON.stringify(p.filters)
                      ? "selected"
                      : ""
                  }
                  onClick={() => {
                    setFilters(
                      JSON.stringify(filters) === JSON.stringify(p.filters)
                        ? []
                        : p.filters,
                    );
                    setScan(true);
                  }}
                >
                  {p.name}
                </button>
              ))}
              {custom.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setFilters(p.filters);
                    setScan(true);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="tools">
              {["filter", "columns", "bell"].map((name, i) => (
                <div className="popover-anchor" key={name}>
                  <button
                    aria-label={["Filters", "Columns", "Alerts"][i]}
                    title={["Filters", "Columns", "Alerts"][i]}
                    className={
                      "icon-button " +
                      (panel === name || (name === "filter" && filters.length)
                        ? "selected"
                        : "")
                    }
                    onClick={() => togglePanel(name)}
                  >
                    <Icon name={name} />
                    {name === "filter" && filters.length > 0 && (
                      <span className="badge">{filters.length}</span>
                    )}
                    {name === "bell" && rules.some((r) => r.enabled) && (
                      <span className="notification-dot" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
          {panel === "filter" && (
            <div
              className="popover filters-panel"
              role="dialog"
              aria-label="Filters"
            >
              <div className="panel-head">
                Filters
                <button aria-label="Close filters" onClick={() => setPanel("")}>
                  ×
                </button>
              </div>
              {filters.map((f, i) => (
                <div className="filter-chip" key={i}>
                  <span>
                    {columns.find((c) => c.id === f.column)?.label}{" "}
                    {operators[f.operator]} {f.value}
                    {f.operator === "between" && ` – ${f.value2}`}
                  </span>
                  <button
                    aria-label="Remove filter"
                    onClick={() =>
                      setFilters(filters.filter((_, j) => j !== i))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {filters.length > 0 && (
                <button className="text-button" onClick={() => setFilters([])}>
                  Clear all
                </button>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setFilters([...filters, draft]);
                  setScan(true);
                }}
              >
                <select
                  aria-label="Filter metric"
                  value={draft.column}
                  onChange={(e) =>
                    setDraft({ ...draft, column: e.target.value })
                  }
                >
                  {groupNames.map((g) => (
                    <optgroup label={g} key={g}>
                      {numeric
                        .filter((c) => c.group === g)
                        .map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <div className="form-row">
                  <select
                    aria-label="Filter operator"
                    value={draft.operator}
                    onChange={(e) =>
                      setDraft({ ...draft, operator: e.target.value })
                    }
                  >
                    {Object.entries(operators).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Filter value"
                    required
                    type="number"
                    step="any"
                    value={draft.value}
                    onChange={(e) =>
                      setDraft({ ...draft, value: +e.target.value })
                    }
                  />
                  {draft.operator === "between" && (
                    <input
                      aria-label="Upper filter value"
                      type="number"
                      step="any"
                      required
                      min={draft.value}
                      value={draft.value2 ?? draft.value}
                      onChange={(e) =>
                        setDraft({ ...draft, value2: +e.target.value })
                      }
                    />
                  )}
                </div>
                <button type="submit" className="primary wide">
                  Add Filter
                </button>
              </form>
              <form
                className="preset-save"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (presetName.trim() && filters.length) {
                    setCustom([
                      ...custom.filter((p) => p.name !== presetName.trim()),
                      { name: presetName.trim(), filters },
                    ]);
                    setPresetName("");
                  }
                }}
              >
                <input
                  aria-label="Preset name"
                  placeholder="Preset name"
                  required
                  maxLength={40}
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <button disabled={!filters.length} type="submit">
                  Save
                </button>
              </form>
              {custom.map((p) => (
                <div className="filter-chip" key={p.name}>
                  {p.name}
                  <button
                    aria-label={`Delete ${p.name} preset`}
                    onClick={() =>
                      setCustom(custom.filter((x) => x.name !== p.name))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <p className="hint">
                Filters use measured data only. {scanCount}/{rows.length}{" "}
                instruments have detailed metrics. A full scan respects exchange
                rate limits.
              </p>
              <button className="wide" onClick={() => setScan(!scan)}>
                {scan ? "Pause full scan" : "Scan all instruments"}
              </button>
            </div>
          )}
          {panel === "columns" && (
            <div
              className="popover columns-panel"
              role="dialog"
              aria-label="Column Visibility"
            >
              <div className="panel-head">
                Column Visibility
                <button aria-label="Close columns" onClick={() => setPanel("")}>
                  ×
                </button>
              </div>
              <div className="column-core">
                <div className="group-title">Core</div>
                <div className="checkboxes">
                  <label>
                    <input
                      type="checkbox"
                      checked={trend}
                      onChange={(e) => setTrend(e.target.checked)}
                    />
                    24h trend
                  </label>
                  {columns
                    .filter((c) => c.group === "Core")
                    .map((c) => (
                      <label key={c.id} title={c.tooltip}>
                        <input
                          type="checkbox"
                          checked={visible.includes(c.id)}
                          disabled={c.id === "symbol"}
                          onChange={() => toggleColumn(c.id)}
                        />
                        {c.label}
                      </label>
                    ))}
                </div>
              </div>
              <div className="column-groups">
                {groupNames
                  .filter((g) => g !== "Core")
                  .map((g) => (
                    <section key={g}>
                      <div className="group-title">
                        {g}
                        <button
                          onClick={() => {
                            const ids = columns
                              .filter((c) => c.group === g)
                              .map((c) => c.id);
                            setVisible((prev) =>
                              ids.every((id) => prev.includes(id))
                                ? prev.filter((id) => !ids.includes(id))
                                : [...new Set([...prev, ...ids])],
                            );
                          }}
                        >
                          {columns
                            .filter((c) => c.group === g)
                            .every((c) => visible.includes(c.id))
                            ? "Hide All"
                            : "Show All"}
                        </button>
                      </div>
                      <div className="checkboxes">
                        {columns
                          .filter((c) => c.group === g)
                          .map((c, i) => (
                            <label key={c.id} title={c.tooltip}>
                              <input
                                type="checkbox"
                                checked={visible.includes(c.id)}
                                disabled={exchange === "hl" && g === "Volume Δ"}
                                onChange={() => toggleColumn(c.id)}
                              />
                              {periods[i]}
                            </label>
                          ))}
                      </div>
                    </section>
                  ))}
              </div>
              <div className="form-row column-actions">
                <button
                  onClick={() => {
                    setVisible(
                      columns
                        .filter(
                          (c) => !(exchange === "hl" && c.group === "Volume Δ"),
                        )
                        .map((c) => c.id),
                    );
                    setTrend(true);
                  }}
                >
                  All
                </button>
                <button
                  onClick={() => {
                    setVisible(defaultColumns);
                    setTrend(window.innerWidth >= 640);
                  }}
                >
                  Defaults
                </button>
                <button
                  onClick={() => {
                    setVisible([
                      "symbol",
                      "price",
                      "openInterest",
                      "fundingRate1h",
                    ]);
                    setTrend(false);
                  }}
                >
                  Core Only
                </button>
              </div>
            </div>
          )}
          <div className="market-status-slot">
            {error || detailError || market?.warnings.length || isStale ? (
              <div className="data-warning" role="status">
                <span
                  title={error || detailError || market?.warnings.join(" · ")}
                >
                  {error || detailError || market?.warnings.join(" · ")}
                  {isStale ? " · Showing stale data" : ""}
                </span>
                <button
                  onClick={() => {
                    setTick((t) => t + 1);
                    loaded.current.clear();
                  }}
                >
                  Retry
                </button>
                {scan && <button onClick={() => setScan(false)}>Pause</button>}
              </div>
            ) : scan ? (
              <div className="scan-status">
                <span>
                  Collecting detailed metrics · {scanCount}/{rows.length} ·{" "}
                  {ordered.length} matches
                </span>
                <button onClick={() => setScan(false)}>Pause</button>
              </div>
            ) : !loading && detailReady < visibleSymbols.length ? (
              <div className="scan-status" role="status">
                <span>
                  Loading market metrics · {detailReady}/{visibleSymbols.length}
                </span>
              </div>
            ) : null}
          </div>
          <main
            className="table-scroll"
            ref={tableViewport}
            tabIndex={0}
            aria-label="Market table"
            style={
              {
                "--market-row-height": `${tableSize.rowHeight}px`,
              } as React.CSSProperties
            }
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <table
              className="market-table"
              style={{
                minWidth:
                  48 +
                  (trend ? 112 : 0) +
                  activeColumns.reduce((s, c) => s + c.width, 0),
              }}
            >
              <thead>
                <tr>
                  <th className="pin pin-chart">
                    <button
                      title="Export filtered table as CSV"
                      aria-label="Export CSV"
                      onClick={exportCSV}
                    >
                      <Icon name="download" size={14} />
                    </button>
                  </th>
                  <th className="pin pin-star">
                    <button
                      title="Show favorites only"
                      aria-label="Show favorites only"
                      aria-pressed={favoritesOnly}
                      className={favoritesOnly ? "favorite active" : ""}
                      onClick={() => setFavoritesOnly(!favoritesOnly)}
                    >
                      <Icon name="star" size={17} />
                    </button>
                  </th>
                  {trend && (
                    <th
                      className="pin pin-trend"
                      style={{ width: 112, minWidth: 112 }}
                    >
                      24h trend
                    </th>
                  )}
                  {activeColumns.map((c) => (
                    <th
                      key={c.id}
                      className={c.id === "symbol" ? "pin pin-symbol" : ""}
                      style={{
                        width: c.width,
                        minWidth: c.width,
                        left:
                          c.id === "symbol" ? (trend ? 160 : 48) : undefined,
                      }}
                      draggable={c.id !== "symbol"}
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", c.id)
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = e.dataTransfer.getData("text/plain");
                        if (
                          c.id === "symbol" ||
                          from === "symbol" ||
                          !visible.includes(from)
                        )
                          return;
                        const next = visible.filter((x) => x !== from);
                        next.splice(next.indexOf(c.id), 0, from);
                        setVisible(next);
                      }}
                      aria-sort={
                        sort.column === c.id
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button title={c.tooltip} onClick={() => sortBy(c.id)}>
                        {c.id !== "symbol" && (
                          <span className="drag-handle">⠿</span>
                        )}
                        {c.label}
                        <span className="sort-arrows">
                          <span
                            className={
                              sort.column === c.id && sort.direction === "asc"
                                ? "on"
                                : ""
                            }
                          >
                            ▲
                          </span>
                          <span
                            className={
                              sort.column === c.id && sort.direction === "desc"
                                ? "on"
                                : ""
                            }
                          >
                            ▼
                          </span>
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {display.map((row) => (
                  <tr
                    key={row.symbol}
                    data-symbol={row.symbol}
                    className={
                      rankMovement[row.symbol]
                        ? rankMovement[row.symbol].delta > 0
                          ? "rank-up"
                          : "rank-down"
                        : ""
                    }
                  >
                    <td className="pin pin-chart">
                      <button
                        aria-label={`Expand chart ${row.symbol}`}
                        title="Expand chart"
                        onClick={(event) => openPriceChart(event, row.symbol)}
                        className={expanded === row.symbol ? "active" : ""}
                      >
                        <Icon name="chart" size={14} />
                      </button>
                    </td>
                    <td className="pin pin-star">
                      <button
                        aria-label={`Favorite ${row.symbol}`}
                        aria-pressed={favorites.includes(row.symbol)}
                        title="Toggle favorite"
                        className={
                          "favorite " +
                          (favorites.includes(row.symbol) ? "active" : "")
                        }
                        onClick={() => toggleFavorite(row.symbol)}
                      >
                        <Icon name="star" size={16} />
                      </button>
                    </td>
                    {trend && (
                      <td className="pin pin-trend">
                        <Sparkline row={row} />
                      </td>
                    )}
                    {activeColumns.map((c) => (
                      <td
                        key={c.id}
                        className={
                          (c.id === "symbol"
                            ? "pin pin-symbol symbol-cell "
                            : "") +
                          (["percent", "funding"].includes(c.format) &&
                          typeof row[c.id] === "number"
                            ? Number(row[c.id]) > 0
                              ? "positive"
                              : Number(row[c.id]) < 0
                                ? "negative"
                                : ""
                            : "")
                        }
                        style={{
                          left:
                            c.id === "symbol" ? (trend ? 160 : 48) : undefined,
                        }}
                        title={
                          row[c.id] == null
                            ? "Not available yet; details load for visible instruments."
                            : priceWindowTitle(row, c.id)
                        }
                      >
                        {c.id === "symbol" ? (
                          <button
                            onClick={(event) =>
                              openPriceChart(event, row.symbol)
                            }
                          >
                            <Coin row={row} />
                            <strong>{row.symbol}</strong>
                            {rankMovement[row.symbol] && (
                              <span
                                className="rank-delta"
                                title={`Moved ${Math.abs(rankMovement[row.symbol].delta)} places ${rankMovement[row.symbol].delta > 0 ? "up" : "down"}`}
                                aria-label={`Moved ${Math.abs(rankMovement[row.symbol].delta)} places ${rankMovement[row.symbol].delta > 0 ? "up" : "down"}`}
                              >
                                {rankMovement[row.symbol].delta > 0 ? "↑" : "↓"}{" "}
                                {Math.abs(rankMovement[row.symbol].delta)}
                              </span>
                            )}
                          </button>
                        ) : (
                          format(row[c.id], c)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <div className="empty">Loading ticker data…</div>}
            {!loading && !rows.length && (
              <div className="empty">
                <strong>Market data unavailable</strong>
                <p>{error}</p>
                <button onClick={() => setTick((t) => t + 1)}>Try again</button>
              </div>
            )}
            {!loading && rows.length > 0 && !ordered.length && (
              <div className="empty">
                <strong>No instruments match</strong>
                <p>
                  {filters.length
                    ? "Some detailed metrics are still loading. Scan all instruments or relax your filters."
                    : favoritesOnly
                      ? "Add instruments to your watchlist using the star."
                      : "Try a different symbol."}
                </p>
                <button
                  onClick={() => {
                    setQuery("");
                    setFilters([]);
                    setFavoritesOnly(false);
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
            {ordered.length > limit && (
              <div className="load-more">
                <button onClick={() => setLimit(limit + 100)}>
                  Load 100 more · {ordered.length - limit} remaining
                </button>
              </div>
            )}
          </main>
        </section>
        <CopilotFeed exchange={exchange} onOpen={openPriceChart} />
      </div>
      {expanded && (
        <ExpandedPriceChart
          key={expanded}
          exchange={exchange}
          symbol={expanded}
          close={closePriceChart}
          opener={chartOpener.current}
        />
      )}
      <footer>
        <div className="footer-left">
          <button onClick={() => setPanel("privacy")}>Privacy</button>
          <span className="separator">|</span>
          <button onClick={() => setPanel("terms")}>Terms</button>
          <span className="separator">|</span>
          <span>
            Charts by{" "}
            <a
              href="https://www.tradingview.com/"
              target="_blank"
              rel="noreferrer"
            >
              <b className="tv-icon">Tᵛ</b> TradingView
            </a>
          </span>
        </div>
        <div className="footer-right">
          <span
            className={"connection-dot " + (error || isStale ? "offline" : "")}
          />
          <span
            title={`${market?.source || "Connecting"} · ${lastSuccess ? new Date(lastSuccess).toLocaleTimeString("en-GB") : ""}`}
          >
            {error
              ? rows.length
                ? "Stale"
                : "Disconnected"
              : loading
                ? "Connecting"
                : isStale
                  ? "Stale"
                  : "Connected"}
          </span>
          <span className="separator">|</span>
          <button aria-label="Help" onClick={() => setPanel("help")}>
            <Icon name="help" size={14} />
          </button>
        </div>
      </footer>
      {tour !== null && (
        <Modal
          title="Welcome to REKTPLEB screener"
          close={finishTour}
          className="welcome"
        >
          <div className="welcome-monogram" aria-hidden="true">
            R
          </div>
          <h2>
            {
              [
                "Welcome to REKTPLEB screener",
                "Choose Your Exchange",
                "Find Your Market",
                "Customize Your View",
                "Filter & Save Presets",
                "Build Your Watchlist",
                "Read Trends & Expand Charts",
                "Create Local Alerts",
                "Reorder Columns",
                "Live Public Data",
                "Your Personal Workspace",
              ][tour]
            }
          </h2>
          <p>
            {
              [
                "Explore perpetual futures across Binance and Hyperliquid. Search instruments, compare market activity, and find what matters to you.",
                "Switch between Binance Futures and Hyperliquid, with crypto-only markets.",
                "Search symbols instantly. Click any column heading to sort the market.",
                "Choose metrics and periods from Columns. Your layout is saved in this browser.",
                "Use numeric conditions and save your own presets. Full scans collect history within exchange rate limits.",
                "Click the star beside a symbol. The header star shows only your favorites.",
                "Mini charts show observed price history. Expand a row to inspect live candlesticks.",
                "Set a metric, direction and threshold. Alerts run while this app is open.",
                "Drag metric headers into your preferred order. Symbols stay pinned to the left.",
                "Live data comes directly from public exchange APIs. Unavailable values remain blank.",
                "Your source code, settings and data adapters are local and editable.",
              ][tour]
            }
          </p>
          <div className="tour-dots">
            {Array.from({ length: 11 }, (_, i) => (
              <button
                key={i}
                aria-label={`Tour step ${i + 1}`}
                className={tour === i ? "active" : ""}
                onClick={() => setTour(i)}
              />
            ))}
          </div>
          <button
            className="primary wide start-tour"
            onClick={() => (tour === 10 ? finishTour() : setTour(tour + 1))}
          >
            {tour === 0
              ? "Start tour"
              : tour === 10
                ? "Start screening"
                : "Next"}
          </button>
          <button className="skip-tour" onClick={finishTour}>
            Skip tour
          </button>
        </Modal>
      )}
      {panel === "bell" && (
        <Modal
          title="Alerts"
          close={() => setPanel("")}
          className="alerts-modal"
        >
          <h2>Alerts</h2>
          <p className="muted">
            Local alerts monitor both exchanges while this app is open.
          </p>
          <form
            className="alert-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!alertDraft.symbol || !Number.isFinite(+alertDraft.value))
                return;
              setRules([
                ...rules,
                {
                  ...alertDraft,
                  value: +alertDraft.value,
                  exchange,
                  id: crypto.randomUUID(),
                  enabled: true,
                },
              ]);
              setToast("Alert created");
              setAlertDraft({ ...alertDraft, value: "" });
            }}
          >
            <label>
              Symbol
              <select
                required
                aria-label="Alert symbol"
                value={alertDraft.symbol}
                onChange={(e) =>
                  setAlertDraft({ ...alertDraft, symbol: e.target.value })
                }
              >
                <option value="">Select instrument</option>
                {rows.map((r) => (
                  <option key={r.symbol}>{r.symbol}</option>
                ))}
              </select>
            </label>
            <label>
              Metric
              <select
                aria-label="Alert metric"
                value={alertDraft.column}
                onChange={(e) =>
                  setAlertDraft({ ...alertDraft, column: e.target.value })
                }
              >
                {numeric.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <select
                aria-label="Alert operator"
                value={alertDraft.operator}
                onChange={(e) =>
                  setAlertDraft({ ...alertDraft, operator: e.target.value })
                }
              >
                <option value="gt">Above</option>
                <option value="lt">Below</option>
                <option value="abs_gt">Absolute above</option>
              </select>
              <input
                type="number"
                aria-label="Alert threshold"
                placeholder="Value"
                required
                step="any"
                value={alertDraft.value}
                onChange={(e) =>
                  setAlertDraft({ ...alertDraft, value: e.target.value })
                }
              />
            </div>
            <button type="submit" className="primary wide">
              Create alert
            </button>
          </form>
          {"Notification" in window &&
            Notification.permission !== "granted" && (
              <button
                className="wide"
                onClick={() =>
                  void Notification.requestPermission().then((p) =>
                    setToast(
                      p === "granted"
                        ? "Desktop notifications enabled"
                        : "Notifications remain inside the app",
                    ),
                  )
                }
              >
                Enable desktop notifications
              </button>
            )}
          <h3>Active alerts</h3>
          {!rules.length && <p className="muted">No alerts yet.</p>}
          {rules.map((r) => (
            <div className="alert-item" key={r.id}>
              <input
                type="checkbox"
                aria-label={`Enable alert ${r.symbol}`}
                checked={r.enabled}
                onChange={() =>
                  setRules(
                    rules.map((x) =>
                      x.id === r.id ? { ...x, enabled: !x.enabled } : x,
                    ),
                  )
                }
              />
              <div>
                <strong>{r.symbol}</strong>
                <small>
                  {r.exchange} · {columns.find((c) => c.id === r.column)?.label}{" "}
                  {operators[r.operator]} {r.value}
                </small>
              </div>
              <button
                aria-label={`Delete alert ${r.symbol}`}
                onClick={() => setRules(rules.filter((x) => x.id !== r.id))}
              >
                ×
              </button>
            </div>
          ))}
          <h3>Triggered alerts</h3>
          {events.length > 0 && (
            <button className="text-button" onClick={() => setEvents([])}>
              Clear history
            </button>
          )}
          {events.slice(0, 20).map((e) => (
            <div className="event" key={e.id}>
              <time>{new Date(e.time).toLocaleTimeString("en-GB")}</time>
              {e.text}
            </div>
          ))}
        </Modal>
      )}
      {panel === "profile" && (
        <Modal title="Local workspace" close={() => setPanel("")}>
          <strong className="workspace-brand">REKTPLEB screener</strong>
          <h2>Local workspace</h2>
          <p className="muted">Your personal screener. No sign-in required.</p>
          <label>
            Workspace name
            <input
              value={profile}
              maxLength={60}
              onChange={(e) => setProfile(e.target.value)}
            />
          </label>
          <h3>Row movement highlights</h3>
          <label className="rank-highlight-toggle">
            <input
              type="checkbox"
              checked={rankHighlights.enabled}
              onChange={(event) =>
                setRankHighlights({
                  ...rankHighlights,
                  enabled: event.target.checked,
                })
              }
            />
            Highlight rank changes
          </label>
          <label>
            Minimum move
            <select
              aria-label="Minimum rank movement"
              value={rankHighlights.minPositions}
              disabled={!rankHighlights.enabled}
              onChange={(event) =>
                setRankHighlights({
                  ...rankHighlights,
                  minPositions: Number(event.target.value),
                })
              }
            >
              {Array.from({ length: 100 }, (_, i) => i + 1).map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? "position" : "positions"}
                </option>
              ))}
            </select>
          </label>
          <p className="muted rank-highlight-hint">
            Green when a coin moves up, red when it moves down. Highlights last
            4 seconds. Changes apply to future market updates.
          </p>
          <h3>Settings & watchlists</h3>
          <p className="muted">
            Saved in this browser. Export a backup to move them to another
            computer.
          </p>
          <div className="form-row">
            <button onClick={exportSettings}>Export settings</button>
            <label className="file-button">
              Import settings
              <input
                type="file"
                accept=".json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importSettings(f);
                }}
              />
            </label>
          </div>
          <button className="wide" onClick={exportCSV}>
            Export filtered table as CSV
          </button>
          <h3>Data</h3>
          <p className="muted">
            {market?.source}
            <br />
            Market refresh: 10 seconds. Candle and OI details: 60 seconds, for
            visible and monitored instruments. Missing metrics display —.
          </p>
          <button
            className="wide"
            onClick={() => {
              setPanel("");
              setTour(0);
            }}
          >
            Replay tour
          </button>
        </Modal>
      )}
      {["help", "privacy", "terms"].includes(panel) && (
        <Modal
          title={
            panel === "help"
              ? "Help"
              : panel === "privacy"
                ? "Privacy"
                : "Terms"
          }
          close={() => setPanel("")}
        >
          <h2>
            {panel === "help"
              ? "REKTPLEB screener"
              : panel === "privacy"
                ? "Privacy"
                : "About this screener"}
          </h2>
          {panel === "help" ? (
            <>
              <p>
                Choose an exchange, search an instrument, sort by a metric, or
                expand a candlestick chart.
              </p>
              <p className="muted">
                Use Columns to choose periods, Filters for numeric conditions,
                and the star for your watchlist. Press / to search and Escape to
                close.
              </p>
              <p className="muted">
                Only real available data is displayed. Hyperliquid has no
                historical OI endpoint here: changes become available as this
                server observes history. Its candles do not provide exact USD
                quote volume or taker delta. Some metrics therefore remain —.
              </p>
              <p className="muted">
                Your workspace uses public exchange data. The optional TRADING
                COPILOT connector is disabled until you configure it.
              </p>
              <button
                className="primary wide"
                onClick={() => {
                  setPanel("");
                  setTour(0);
                }}
              >
                Start tour
              </button>
            </>
          ) : panel === "privacy" ? (
            <p>
              Preferences, watchlists and alerts stay in browser local storage.
              This application sends market-data requests to Binance and
              Hyperliquid through your local server. It includes no analytics or
              account authentication. External links open third-party sites.
            </p>
          ) : (
            <p>
              REKTPLEB is a local, read-only crypto market screener. Third-party
              visual assets retain their original ownership. Public-data
              availability and exchange rate limits apply. Charts use
              TradingView Lightweight Charts™. Copyright © 2026 TradingView,
              Inc. Licensed under the Apache License, Version 2.0.
            </p>
          )}
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);

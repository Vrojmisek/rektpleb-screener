import { useEffect, useRef, useState } from "react";
import { useTheme } from "./Theme";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
type HistoryMeta = {
  oldest: number | null;
  newest: number | null;
  complete: boolean;
  pages: number;
  gaps: number;
  error: string;
  live: boolean;
  hasOlder: boolean;
};
const up = "#26a69a",
  down = "#ef5350";
function date(time: number | null) {
  return time
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(time)
    : "—";
}
export function PriceChart({
  exchange,
  symbol,
}: {
  exchange: "binance" | "hl";
  symbol: string;
}) {
  const { theme } = useTheme();
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: {
        background: {
          type: ColorType.Solid,
          color: theme === "light" ? "#fafdfc" : "#111a22",
        },
        textColor: theme === "light" ? "#4b676e" : "#a4b8c1",
      },
    });
  }, [theme]);
  const host = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null);
  const actions = useRef<{ fit: () => void; live: () => void }>({
    fit: () => {},
    live: () => {},
  });
  const [interval, setIntervalValue] = useState("15m"),
    [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [meta, setMeta] = useState<HistoryMeta | null>(null);
  const seconds = interval === "1s" || interval === "5s";
  useEffect(() => {
    if (!host.current) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setMeta(null);
    const chart = createChart(host.current, {
      autoSize: true,
      localization: { locale: "en-GB" },
      layout: {
        background: {
          type: ColorType.Solid,
          color:
            document.documentElement.dataset.theme === "light"
              ? "#fafdfc"
              : "#111a22",
        },
        textColor:
          document.documentElement.dataset.theme === "light"
            ? "#4b676e"
            : "#a4b8c1",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: seconds,
        rightOffset: 40,
        barSpacing: 7,
      },
      crosshair: {
        vertLine: { visible: false, labelVisible: true },
        horzLine: { visible: false, labelVisible: true },
      },
    });
    chartRef.current = chart;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceLineVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volume
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    let bars: Bar[] = [],
      initial = true,
      inFlight = false,
      olderBusy = false,
      lastOlderAttempt = 0,
      stopped = false,
      hasOlder = true,
      following = true,
      painting = false;
    const request = async (extra = "") => {
      const path = seconds
        ? `seconds?exchange=${exchange}&symbol=${encodeURIComponent(symbol)}&seconds=${interval === "1s" ? 1 : 5}&hours=${hours}${extra}`
        : `candles?exchange=${exchange}&symbol=${encodeURIComponent(symbol)}&interval=${interval}`;
      const response = await fetch("/api/" + path, {
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Unable to load the chart.");
      return seconds
        ? (data as { rows: Bar[]; meta: HistoryMeta })
        : { rows: data as Bar[], meta: null };
    };
    const candle = (b: Bar) => ({
      time: (b.time / 1000) as UTCTimestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    });
    const vol = (b: Bar) => ({
      time: (b.time / 1000) as UTCTimestamp,
      value: b.volume,
      color: b.close >= b.open ? "#26a69a40" : "#ef535040",
    });
    const resetView = () =>
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, bars.length - 220),
        to: bars.length + 45,
      });
    const paint = (incoming: Bar[], reset = false, older = false) => {
      if (stopped || !incoming.length) return;
      painting = true;
      if (initial) {
        const price = incoming.at(-1)!.close;
        const precision =
          price >= 1000
            ? 2
            : price >= 1
              ? 4
              : price >= 0.01
                ? 5
                : price >= 0.0001
                  ? 7
                  : 9;
        series.applyOptions({
          priceFormat: { type: "price", precision, minMove: 10 ** -precision },
        });
      }
      const range = chart.timeScale().getVisibleRange();
      const last = bars.at(-1)?.time ?? -Infinity;
      const map = new Map(bars.map((b) => [b.time, b]));
      const changed = incoming.filter((b) => {
        const old = map.get(b.time);
        return (
          !old ||
          old.open !== b.open ||
          old.high !== b.high ||
          old.low !== b.low ||
          old.close !== b.close ||
          old.volume !== b.volume
        );
      });
      for (const bar of incoming) map.set(bar.time, bar);
      bars = [...map.values()].sort((a, b) => a.time - b.time);
      // Keep the current history window bounded; older windows remain on disk/server.
      const trimmed = bars.length > 100000;
      if (trimmed) bars = older ? bars.slice(0, 100000) : bars.slice(-100000);
      if (
        initial ||
        trimmed ||
        older ||
        reset ||
        changed.some((b) => b.time < last)
      ) {
        series.setData(bars.map(candle));
        volume.setData(bars.map(vol));
      } else
        for (const bar of changed) {
          series.update(candle(bar));
          volume.update(vol(bar));
        }
      if (initial || reset) resetView();
      else if ((older || !following) && range)
        chart.timeScale().setVisibleRange(range);
      else if (following) chart.timeScale().scrollToPosition(45, false);
      initial = false;
      painting = false;
    };
    const loadOlder = async () => {
      if (
        !seconds ||
        olderBusy ||
        !bars.length ||
        !hasOlder ||
        Date.now() - lastOlderAttempt < 4000
      )
        return;
      olderBusy = true;
      lastOlderAttempt = Date.now();
      try {
        const result = await request(
          `&before=${bars[0].time + (interval === "1s" ? 1000 : 5000)}&limit=6000`,
        );
        if (stopped) return;
        paint(result.rows, false, true);
        setMeta(result.meta);
        hasOlder = result.meta?.hasOlder ?? false;
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        olderBusy = false;
      }
    };
    const update = async (reset = false) => {
      if (inFlight || stopped || document.hidden) return;
      inFlight = true;
      try {
        const historicalWindow = seconds && !following && bars.length && !reset;
        const extra = historicalWindow
          ? `&before=${bars.at(-1)!.time + (interval === "1s" ? 1000 : 5000)}&limit=${Math.min(100000, bars.length)}`
          : seconds
            ? `&limit=${initial || reset ? 6000 : 1200}`
            : "";
        const result = await request(extra);
        if (stopped) return;
        if (reset) bars = [];
        paint(result.rows, reset);
        setMeta(result.meta);
        hasOlder = result.meta?.hasOlder ?? true;
        setBusy(false);
        setError("");
        if (
          seconds &&
          !following &&
          (chart.timeScale().getVisibleLogicalRange()?.from ?? Infinity) < 150
        )
          void loadOlder();
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          setBusy(false);
        }
      } finally {
        inFlight = false;
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (painting || initial || !range) return;
      following = range.to >= bars.length - 5;
      if (range.from < 150) void loadOlder();
    });
    actions.current = {
      fit: () => chart.timeScale().fitContent(),
      live: () => {
        following = true;
        void update(true);
      },
    };
    void update();
    const timer = setInterval(() => void update(), seconds ? 2000 : 15000);
    const visible = () => {
      if (!document.hidden) void update();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      chart.remove();
      chartRef.current = null;
      actions.current = { fit: () => {}, live: () => {} };
    };
  }, [exchange, symbol, interval, hours, seconds]);
  return (
    <div className="chart-panel openmarket-chart">
      <div className="chart-toolbar">
        <strong>{symbol}</strong>
        <span className="muted">
          {exchange === "binance" ? "Binance Futures" : "Hyperliquid"}
        </span>
        <div className="intervals">
          {["1s", "5s", "1m", "5m", "15m", "1h", "4h", "1d"].map((t) => (
            <button
              key={t}
              aria-pressed={t === interval}
              className={t === interval ? "selected" : ""}
              disabled={exchange !== "binance" && (t === "1s" || t === "5s")}
              title={
                exchange !== "binance" && (t === "1s" || t === "5s")
                  ? "Second-based history is unavailable on Hyperliquid"
                  : undefined
              }
              onClick={() => setIntervalValue(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {seconds && (
          <select
            aria-label="Second-based history range"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>7 days</option>
          </select>
        )}
        <button onClick={() => actions.current.live()}>Go live</button>
        <button onClick={() => actions.current.fit()}>Fit history</button>
      </div>
      {seconds && (
        <div className="chart-history-status" role="status">
          <span>
            {meta
              ? `${date(meta.oldest)} → ${date(meta.newest)}`
              : "Loading exchange trades…"}
          </span>
          <span>
            {meta?.error ||
              (meta?.complete
                ? "History complete"
                : `Backfilling ${hours / 24}-day history${meta ? ` · ${meta.pages} batches` : ""}`)}
          </span>
          {!!meta?.gaps && <span>Recovering connection gaps.</span>}
          {meta && (
            <span>{meta.live ? "Live trades" : "Reconnecting live feed"}</span>
          )}
          <span className="muted">Drag left to load older data.</span>
        </div>
      )}
      <div ref={host} className="chart-host" />
      {busy && <div className="chart-message">Loading candles…</div>}
      {error && <div className="chart-message negative">{error}</div>}
    </div>
  );
}

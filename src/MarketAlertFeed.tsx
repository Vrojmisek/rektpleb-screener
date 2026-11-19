import { useEffect, useState, type MouseEvent } from "react";

type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
type Frame = "1m" | "15m" | "1h";
type Feed = {
  updatedAt: number;
  chart: {
    symbol: string;
    signal: {
      time: number;
      changePercent: number;
      relativeVolume: number;
    } | null;
    frames: Record<Frame, Bar[]>;
  } | null;
};

export type MarketAlertProps = {
  exchange: "binance" | "hl";
  onOpen: (event: MouseEvent<HTMLButtonElement>, symbol: string) => void;
};

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const price = new Intl.NumberFormat("en-GB", { maximumSignificantDigits: 6 });
const frames = [
  ["15m", "Context"],
  ["1m", "Impulse"],
  ["1h", "Trend"],
] as const;

function PreviewFrame({
  bars,
  interval,
  label,
}: {
  bars: Bar[];
  interval: Frame;
  label: string;
}) {
  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));
  const volume = Math.max(1e-12, ...bars.map((bar) => bar.volume));
  const y = (value: number) =>
    8 + (high === low ? 0.5 : (high - value) / (high - low)) * 100;
  const step = 240 / bars.length;
  return (
    <figure className={`market-alert-frame market-alert-frame--${interval}`}>
      <figcaption>
        <span>
          <strong>{interval}</strong> {label}
        </span>
        {bars.length > 0 && <span>{price.format(bars.at(-1)!.close)}</span>}
      </figcaption>
      {bars.length ? (
        <svg
          viewBox="0 0 240 140"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {bars.map((bar, index) => {
            const x = step * (index + 0.5);
            const height = (26 * bar.volume) / volume;
            return (
              <g
                key={bar.time}
                className={bar.close >= bar.open ? "candle-up" : "candle-down"}
              >
                <line
                  x1={x}
                  x2={x}
                  y1={y(bar.high)}
                  y2={y(bar.low)}
                  strokeWidth="1"
                />
                <rect
                  x={x - step * 0.33}
                  y={Math.min(y(bar.open), y(bar.close))}
                  width={step * 0.66}
                  height={Math.max(1, Math.abs(y(bar.open) - y(bar.close)))}
                />
                <rect
                  x={x - step * 0.33}
                  y={140 - height}
                  width={step * 0.66}
                  height={height}
                  opacity="0.35"
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="market-alert-unavailable">Candles unavailable</p>
      )}
    </figure>
  );
}

export function MarketAlertFeed({ exchange, onOpen }: MarketAlertProps) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(
          `/api/market-alerts?exchange=${exchange}`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) throw Error("Market scanner unavailable");
        const data: Feed = await response.json();
        if (!controller.signal.aborted) {
          setFeed(data);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        busy = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [exchange, retry]);

  const chart = feed?.chart;
  const signal = chart?.signal;
  return (
    <aside
      className="copilot-feed market-alert-feed"
      aria-label="Market alerts"
    >
      <header className="copilot-head">
        <div className="copilot-heading-row">
          <h2>Market alerts</h2>
          <button
            type="button"
            aria-label="Check market alerts"
            title="Check market alerts"
            onClick={() => setRetry((value) => value + 1)}
          >
            ↻
          </button>
        </div>
        <p>
          5m price move ≥ 0.75% in either direction · relative volume ≥ 2.5×
        </p>
      </header>
      <div className="copilot-cards">
        <div className="market-alert-status" role="status">
          {failed
            ? chart
              ? "Scanner unavailable. Showing the last chart."
              : "Scanner unavailable. Retrying automatically."
            : !feed
              ? "Scanning public exchange data…"
              : chart && signal
                ? `Volume impulse · ${chart.symbol} · ${clock.format(signal.time)} UTC`
                : "Market overview · waiting for a qualifying move"}
        </div>
        {chart && (
          <article className="copilot-card market-alert-card">
            <div className="copilot-card-meta">
              <strong>{chart.symbol}</strong>
              {signal && (
                <span
                  className={
                    signal.changePercent > 0
                      ? "market-alert-positive"
                      : "market-alert-negative"
                  }
                >
                  {signal.changePercent > 0 ? "+" : ""}
                  {signal.changePercent.toFixed(2)}% ·{" "}
                  {signal.relativeVolume.toFixed(2)}× RVOL
                </span>
              )}
            </div>
            <div className="market-alert-frames">
              {frames.map(([interval, label]) => (
                <PreviewFrame
                  key={interval}
                  bars={chart.frames[interval]}
                  interval={interval}
                  label={label}
                />
              ))}
            </div>
            <button
              type="button"
              className="market-alert-open"
              onClick={(event) => onOpen(event, chart.symbol)}
            >
              Open full chart
            </button>
          </article>
        )}
      </div>
      <div className="copilot-foot">
        {feed?.updatedAt
          ? `Checked ${clock.format(feed.updatedAt)} UTC`
          : "Public exchange data"}
        <span>1 min refresh</span>
      </div>
    </aside>
  );
}

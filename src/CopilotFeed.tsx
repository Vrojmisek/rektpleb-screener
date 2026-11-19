import { useEffect, useState, useRef } from "react";
import { MarketAlertFeed, type MarketAlertProps } from "./MarketAlertFeed";
type Chart = {
  id: string;
  symbol: string;
  label: string;
  sentAt: number;
  file: string;
};
type Feed = {
  enabled?: boolean;
  items: Chart[];
  updatedAt: number;
  connected: boolean;
  error?: string;
};
const imageUrl = (file: string) =>
  "/api/copilot/image?file=" + encodeURIComponent(file);
function stamp(time: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}
export function CopilotFeed({ exchange, onOpen }: MarketAlertProps) {
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement | null>(null),
    currentImage = useRef<HTMLButtonElement>(null);
  const [feed, setFeed] = useState<Feed | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [selected, setSelected] = useState<Chart | null>(null),
    [imageError, setImageError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let busy = false,
      feedDisabled = false;
    const update = async () => {
      if (busy || document.hidden) return;
      if (feedDisabled) return;
      busy = true;
      try {
        const response = await fetch("/api/copilot/charts", {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Unable to load charts");
        if (!controller.signal.aborted) {
          feedDisabled = data.enabled === false;
          setFeed({ ...data, items: data.items.slice(0, 1) });
          setSelected((previous) => (previous ? data.items[0] || null : null));
          setImageError("");
          setError(data.error || "");
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          setFeed((previous) =>
            previous ? { ...previous, connected: false } : previous,
          );
        }
      } finally {
        busy = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 30000);
    const onVisible = () => void update();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [retry]);
  const lightboxOpen = selected !== null;
  useEffect(() => {
    if (!lightboxOpen) return;
    const element = dialog.current,
      previous = opener.current;
    element?.showModal();
    return () => {
      element?.close();
      (previous?.isConnected ? previous : currentImage.current)?.focus({
        preventScroll: true,
      });
    };
  }, [lightboxOpen]);
  if (feed?.enabled === false)
    return (
      <MarketAlertFeed key={exchange} exchange={exchange} onOpen={onOpen} />
    );
  if (!feed && !error)
    return (
      <aside className="copilot-feed">
        <header className="copilot-head">
          <h2>Market alerts</h2>
        </header>
        <div className="copilot-empty" role="status">
          Checking alert source…
        </div>
      </aside>
    );
  const charts = feed?.items || [];
  return (
    <aside className="copilot-feed" aria-label="TRADING COPILOT charts">
      <header className="copilot-head">
        <div className="copilot-title">
          <span
            className={"copilot-dot " + (feed?.connected ? "online" : "")}
          />
          <span>TRADING COPILOT</span>
          <span className="copilot-badge">VPS</span>
        </div>
        <div className="copilot-heading-row">
          <h2>Latest alert chart</h2>
          <button
            aria-label="Refresh charts"
            title="Refresh charts"
            onClick={() => {
              setImageError("");
              setRetry((x) => x + 1);
            }}
          >
            ↻
          </button>
        </div>
        <p>Latest saved screenshot from your TRADING COPILOT feed.</p>
      </header>
      {error && (
        <div className="copilot-warning" role="status">
          {error}
          {feed && " Showing the last loaded chart."}
        </div>
      )}
      <div className="copilot-cards">
        {feed && !charts.length && (
          <div className="copilot-empty">
            No alert images are available yet.
          </div>
        )}
        {charts.map((chart) => (
          <article className="copilot-card" key={chart.id}>
            <div className="copilot-card-meta">
              <strong>
                {chart.symbol.replace(/USDT$/, "")}
                <span>USDT</span>
              </strong>
              <time dateTime={new Date(chart.sentAt).toISOString()}>
                {stamp(chart.sentAt)}
              </time>
            </div>
            <button
              ref={currentImage}
              className="copilot-image-button"
              aria-label={`Enlarge chart ${chart.symbol}`}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(chart);
              }}
            >
              {imageError === chart.file ? (
                <span className="copilot-image-failed">
                  Unable to load this image. Refresh charts to retry.
                </span>
              ) : (
                <span className="copilot-chart-crop">
                  <img
                    src={imageUrl(chart.file)}
                    alt={`Chart ${chart.symbol} · ${chart.label}`}
                    decoding="async"
                    onError={() => setImageError(chart.file)}
                  />
                </span>
              )}
              <span className="copilot-zoom">Enlarge ↗</span>
            </button>
          </article>
        ))}
      </div>
      <div className="copilot-foot">
        {feed?.updatedAt
          ? "Updated " + stamp(feed.updatedAt)
          : "Checking alert source"}
        <span>↻ 30 s</span>
      </div>
      {selected && (
        <dialog
          ref={dialog}
          className="copilot-lightbox"
          onCancel={(event) => {
            event.preventDefault();
            setSelected(null);
          }}
          aria-label={`Chart ${selected.symbol}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="copilot-lightbox-panel">
            <div className="copilot-lightbox-head">
              <div>
                <strong>{selected.symbol}</strong>
                <span>
                  {selected.label} · {stamp(selected.sentAt)}
                </span>
              </div>
              <button
                autoFocus
                aria-label="Close chart"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <div className="copilot-chart-crop">
              <img
                src={imageUrl(selected.file)}
                alt={`Enlarged chart ${selected.symbol}`}
              />
            </div>
          </div>
        </dialog>
      )}
    </aside>
  );
}

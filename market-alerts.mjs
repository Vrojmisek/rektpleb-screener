const minute = 60_000;
const scanInterval = 55_000;
const batchSize = 6;
const marketCount = 24;
const signalLifetime = 30 * minute;
const overviewLifetime = 5 * minute;
const frameBars = 48;
const moveThreshold = 0.75;
const volumeThreshold = 2.5;

function closedBars(bars, minutes, now) {
  const duration = minutes * minute;
  return bars.filter(
    (bar) =>
      Number.isSafeInteger(bar.time) &&
      bar.time + duration <= Math.min(bar.observedAt ?? now, now) &&
      [bar.open, bar.high, bar.low, bar.close, bar.volume].every(
        Number.isFinite,
      ) &&
      bar.low > 0 &&
      bar.open > 0 &&
      bar.close > 0 &&
      bar.high >= Math.max(bar.open, bar.close) &&
      bar.low <= Math.min(bar.open, bar.close) &&
      bar.volume >= 0,
  );
}

function findSignal(bars, now, exchange) {
  // Recheck recent closed windows so a pair outside this minute's batch can still qualify.
  for (let offset = 0; offset <= 4; offset++) {
    const end = bars.length - offset;
    if (end < 65) break;
    const window = bars.slice(end - 65, end);
    const time = window.at(-1).time + minute;
    if (
      now - time >= 6 * minute ||
      !window.every(
        (bar, index) => bar.time === window[0].time + index * minute,
      )
    )
      continue;
    const volumes = window.map((bar) =>
      exchange === "binance" ? bar.quote : bar.volume * bar.close,
    );
    if (volumes.some((value) => !Number.isFinite(value) || value < 0)) continue;
    const baseline =
      volumes.slice(0, 60).reduce((sum, value) => sum + value, 0) / 12;
    if (baseline <= 0) continue;
    const relativeVolume =
      volumes.slice(60).reduce((sum, value) => sum + value, 0) / baseline;
    const changePercent = 100 * (window.at(-1).close / window[60].open - 1);
    if (
      Math.abs(changePercent) >= moveThreshold - 1e-10 &&
      relativeVolume >= volumeThreshold
    )
      return { time, changePercent, relativeVolume };
  }
  return null;
}

function chartBars(bars) {
  return bars
    .slice(-frameBars)
    .map(({ time, open, high, low, close, volume }) => ({
      time,
      open,
      high,
      low,
      close,
      volume,
    }));
}

export function createMarketAlertFeed({ market, candles }) {
  const state = new Map();
  async function fillFrames(exchange, chart) {
    const frames = { ...chart.frames };
    await Promise.all(
      [
        ["15m", 15],
        ["1h", 60],
      ].map(async ([interval, minutes]) => {
        if (frames[interval].length) return;
        try {
          const bars = await candles(
            exchange,
            chart.symbol,
            interval,
            frameBars + 1,
          );
          frames[interval] = chartBars(
            closedBars(bars, minutes, chart.capturedAt),
          );
        } catch {
          // A failed timeframe can recover on the next scan without changing the signal.
        }
      }),
    );
    return { ...chart, frames };
  }
  return async function marketAlerts(exchange) {
    if (!state.has(exchange))
      state.set(exchange, {
        offset: 0,
        attemptedAt: 0,
        updatedAt: null,
        failed: false,
        preview: null,
        alert: null,
        scan: null,
      });
    const feed = state.get(exchange);
    const now = Date.now();
    if (feed.alert && now - feed.alert.signal.time >= signalLifetime)
      feed.alert = null;
    const snapshot = () => ({
      chart: feed.alert ?? feed.preview,
      updatedAt: feed.updatedAt,
    });
    if (feed.scan) {
      // Keep the existing chart accessible to concurrent tabs during a refresh.
      return feed.updatedAt ? snapshot() : feed.scan;
    }
    if (now - feed.attemptedAt < scanInterval) {
      if (feed.failed) throw Error("Market scanner is waiting to retry");
      return snapshot();
    }
    feed.attemptedAt = now;
    feed.scan = (async () => {
      const listing = await market(exchange);
      if (now - listing.time >= 120_000)
        throw Error("Market snapshot is stale");
      const rows = listing.rows
        .filter((row) => row.volume_1d > 0)
        .slice(0, marketCount);
      if (!rows.length) throw Error("No liquid markets available");
      const offset = feed.offset < rows.length ? feed.offset : 0;
      const candidates = rows.slice(offset, offset + batchSize);
      feed.offset = offset + batchSize;
      const results = await Promise.allSettled(
        candidates.map(async ({ symbol }) => {
          const bars = closedBars(
            await candles(exchange, symbol, "1m", 80),
            1,
            Date.now(),
          );
          if (!bars.length || Date.now() - bars.at(-1).time >= 6 * minute)
            throw Error("No recent closed candles");
          return {
            symbol,
            bars,
            signal: findSignal(bars, Date.now(), exchange),
          };
        }),
      );
      const measured = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (!measured.length)
        throw Error("Market candles are temporarily unavailable");
      const newest = measured
        .filter(({ signal }) => {
          if (!signal) return false;
          const current = feed.alert?.signal;
          return (
            !current ||
            signal.time > current.time ||
            (signal.time === current.time &&
              Math.abs(signal.changePercent) > Math.abs(current.changePercent))
          );
        })
        .sort(
          (a, b) =>
            b.signal.time - a.signal.time ||
            Math.abs(b.signal.changePercent) - Math.abs(a.signal.changePercent),
        )[0];
      const liquid = measured.find((entry) => entry.symbol === rows[0].symbol);
      const overviewExpired =
        !feed.preview ||
        now - feed.preview.frames["1m"].at(-1).time >= overviewLifetime;
      const selected =
        newest || liquid || (overviewExpired ? measured[0] : null);
      if (selected) {
        const chart = await fillFrames(exchange, {
          symbol: selected.symbol,
          signal: newest?.signal ?? null,
          capturedAt: Date.now(),
          frames: {
            "1m": chartBars(selected.bars),
            "15m": [],
            "1h": [],
          },
        });
        if (newest) {
          feed.alert = chart;
          if (!feed.preview) feed.preview = { ...chart, signal: null };
        } else feed.preview = chart;
      }
      if (feed.alert && !newest)
        feed.alert = await fillFrames(exchange, feed.alert);
      feed.updatedAt = Date.now();
      feed.failed = false;
      return snapshot();
    })()
      .catch((error) => {
        feed.failed = true;
        throw error;
      })
      .finally(() => {
        feed.scan = null;
      });
    return feed.scan;
  };
}

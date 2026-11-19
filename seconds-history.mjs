import {
  readFile,
  mkdir,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { aggregateTradePage } from "./providers.mjs";
const compress = promisify(gzip),
  decompress = promisify(gunzip);
const directory = new URL("./.cache/seconds/", import.meta.url);
const jobs = new Map();
const week = 7 * 86400000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fileFor = (symbol) =>
  new URL(
    createHash("sha256").update(symbol).digest("hex") + ".json.gz",
    directory,
  );

// IDs choose the true opening/closing trade even when older pages arrive later.
export function addTrade(book, trade) {
  const id = Number(trade.a),
    time = Math.floor(Number(trade.T) / 1000) * 1000;
  const price = Number(trade.p),
    quantity = Number(trade.q);
  if (
    !Number.isSafeInteger(id) ||
    !Number.isFinite(time) ||
    !Number.isFinite(price) ||
    !Number.isFinite(quantity) ||
    !(price > 0) ||
    !(quantity >= 0)
  )
    return;
  const bar = book.get(time);
  if (!bar) {
    book.set(time, {
      time,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: quantity,
      first: id,
      last: id,
    });
    return;
  }
  bar.high = Math.max(bar.high, price);
  bar.low = Math.min(bar.low, price);
  bar.volume += quantity;
  if (id < bar.first) {
    bar.first = id;
    bar.open = price;
  }
  if (id > bar.last) {
    bar.last = id;
    bar.close = price;
  }
}
export function groupSeconds(bars, seconds) {
  if (seconds === 1) return bars;
  const output = [];
  for (const bar of bars) {
    const time = Math.floor(bar.time / (seconds * 1000)) * seconds * 1000,
      previous = output.at(-1);
    if (previous?.time === time) {
      previous.high = Math.max(previous.high, bar.high);
      previous.low = Math.min(previous.low, bar.low);
      previous.close = bar.close;
      previous.volume += bar.volume;
    } else output.push({ ...bar, time });
  }
  return output;
}
// Flat zero-volume bars mean no trades only inside a verified continuous range.
export function candleWindow(bars, seconds, limit, continuous) {
  const grouped = groupSeconds(bars, seconds);
  if (!continuous || !grouped.length) return grouped.slice(-limit);
  const step = seconds * 1000;
  const first = Math.max(
    grouped[0].time,
    grouped.at(-1).time - (limit - 1) * step,
  );
  const output = [];
  let index = 0,
    previous;
  for (let time = first; time <= grouped.at(-1).time; time += step) {
    while (index < grouped.length && grouped[index].time <= time)
      previous = grouped[index++];
    if (previous?.time === time) output.push(previous);
    else if (previous)
      output.push({
        time,
        open: previous.close,
        high: previous.close,
        low: previous.close,
        close: previous.close,
        volume: 0,
      });
  }
  return output;
}
async function cleanDisk() {
  try {
    const names = await readdir(directory);
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json\.gz\.[a-f0-9-]{36}\.tmp$/.test(name)) continue;
      const temp = new URL(name, directory);
      const info = await stat(temp).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 3600000)
        await unlink(temp).catch(() => {});
    }
    const files = await Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}\.json\.gz$/.test(name))
        .map(async (name) => {
          const file = new URL(name, directory),
            info = await stat(file);
          return { file, ...info };
        }),
    );
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let total = 0;
    for (const file of files) {
      total += file.size;
      if (Date.now() - file.mtimeMs > week || total > 256 * 1024 * 1024)
        await unlink(file.file);
    }
  } catch {
    /* Optional cache cleanup cannot stop a chart. */
  }
}
async function save(job) {
  if (job.saving) return job.savePromise;
  if (!job.book.size || jobs.get(job.symbol) !== job) return;
  job.saving = true;
  job.savePromise = (async () => {
    let temp;
    try {
      const packed = [...job.book.values()].map((b) => [
        b.time,
        b.open,
        b.high,
        b.low,
        b.close,
        b.volume,
        b.first,
        b.last,
      ]);
      const buffer = await compress(
        JSON.stringify({
          symbol: job.symbol,
          cursor: job.cursor,
          latest: job.latest,
          gaps: job.gaps,
          exhausted: job.exhausted,
          oldestTradeTime: job.oldestTradeTime,
          bars: packed,
        }),
      );
      await mkdir(directory, { recursive: true });
      const file = fileFor(job.symbol);
      temp = new URL(file.href + "." + randomUUID() + ".tmp");
      await writeFile(temp, buffer);
      if (jobs.get(job.symbol) === job) await rename(temp, file);
      job.savedAt = Date.now();
    } catch {
      /* Live chart remains usable if storage is unavailable. */
    } finally {
      if (temp) await unlink(temp).catch(() => {});
      job.saving = false;
    }
  })();
  return job.savePromise;
}
async function bootstrap(job) {
  try {
    const buffer = await readFile(fileFor(job.symbol));
    if (buffer.length <= 16 * 1024 * 1024) {
      const data = JSON.parse(
        await decompress(buffer, { maxOutputLength: 100 * 1024 * 1024 }),
      );
      if (data.symbol === job.symbol && Array.isArray(data.bars)) {
        for (const row of data.bars)
          if (row[0] >= Date.now() - week && row.every(Number.isFinite)) {
            const [time, open, high, low, close, volume, first, last] = row;
            job.book.set(time, {
              time,
              open,
              high,
              low,
              close,
              volume,
              first,
              last,
            });
          }
        job.cursor = data.cursor;
        job.latest = data.latest;
        job.gaps = data.gaps || [];
        job.exhausted = !!data.exhausted;
        job.oldestTradeTime =
          Number(data.oldestTradeTime) ||
          Math.min(...[...job.book.keys()].slice(0, 1));
      }
    }
  } catch {
    /* Cold start. */
  }
  if (!job.book.size) {
    job.latest = 0;
    job.cursor = undefined;
    job.gaps = [];
    job.exhausted = false;
    job.oldestTradeTime = undefined;
  }
  const recent = await aggregateTradePage(job.symbol);
  if (!Array.isArray(recent) || !recent.length)
    throw Error("The exchange returned no trades.");
  job.oldestTradeTime = Math.min(
    job.oldestTradeTime || Infinity,
    Number(recent[0].T),
  );
  const newer = recent.filter((t) => Number(t.a) > job.latest);
  if (newer.length && job.latest && Number(newer[0].a) > job.latest + 1)
    job.gaps.push([job.latest + 1, Number(newer[0].a) - 1]);
  for (const trade of newer) addTrade(job.book, trade);
  job.cursor ??= Number(recent[0]?.a);
  job.latest = Math.max(job.latest, Number(recent.at(-1)?.a || 0));
  connect(job);
  void work(job);
  void cleanDisk();
}
function connect(job) {
  if (job.socket || Date.now() - job.access > 20000) return;
  const socket = new WebSocket(
    `wss://fstream.binance.com/market/ws/${encodeURIComponent(job.symbol.toLowerCase())}@aggTrade`,
  );
  job.socket = socket;
  socket.onmessage = (event) => {
    try {
      const t = JSON.parse(String(event.data)),
        id = Number(t.a);
      if (!Number.isSafeInteger(id) || id <= job.latest) return;
      if (job.latest && id > job.latest + 1)
        job.gaps.push([job.latest + 1, id - 1]);
      addTrade(job.book, t);
      job.latest = id;
    } catch {
      /* Ignore malformed messages. */
    }
  };
  socket.onerror = () => {
    job.error = "Reconnecting to the live feed.";
    socket.close();
  };
  socket.onclose = () => {
    if (job.socket === socket) job.socket = null;
  };
}
async function work(job) {
  if (job.running) return;
  job.running = true;
  try {
    while (Date.now() - job.access < 20000) {
      connect(job);
      const cutoff = Date.now() - week;
      for (const time of job.book.keys())
        if (time < cutoff) job.book.delete(time);
      if (Date.now() - job.savedAt > 10000) await save(job);
      if (job.gaps.length) {
        const gap = job.gaps[0];
        const page = await aggregateTradePage(job.symbol, gap[0]);
        const missing = page.filter(
          (t) => Number(t.a) >= gap[0] && Number(t.a) <= gap[1],
        );
        if (!missing.length)
          throw Error(
            "Missing trades are not available from the exchange yet.",
          );
        for (const trade of missing) addTrade(job.book, trade);
        gap[0] = Number(missing.at(-1).a) + 1;
        if (gap[0] > gap[1]) job.gaps.shift();
      } else if (
        !job.exhausted &&
        job.oldestTradeTime > Date.now() - job.hours * 3600000 &&
        Number.isSafeInteger(job.cursor)
      ) {
        const fromId = Math.max(0, job.cursor - 1000);
        const page = await aggregateTradePage(job.symbol, fromId);
        const older = page.filter((t) => Number(t.a) < job.cursor);
        if (!older.length) {
          if (!fromId) job.exhausted = true;
          else throw Error("The exchange returned no older trades.");
        } else {
          for (const trade of older)
            if (Number(trade.T) >= cutoff) addTrade(job.book, trade);
          job.cursor = Number(older[0].a);
          job.oldestTradeTime = Number(older[0].T);
          job.pages++;
          if (!fromId) job.exhausted = true;
        }
      } else await pause(1500);
      job.error = "";
    }
  } catch (error) {
    job.error = /429|418/.test(error.message)
      ? "Exchange rate limit reached. History will resume after a pause."
      : error.message;
    job.retryAt = Date.now() + (/429|418/.test(error.message) ? 70000 : 10000);
  } finally {
    job.running = false;
    if (Date.now() - job.access >= 20000) {
      job.socket?.close();
      job.socket = null;
    }
    await save(job);
  }
}
let acquisition = Promise.resolve();
function acquireJob(symbol, hours) {
  const task = acquisition
    .catch(() => {})
    .then(async () => {
      let job = jobs.get(symbol);
      if (!job) {
        // Only two symbols stay resident; the others resume from disk on demand.
        if (jobs.size >= 2) {
          const oldest = [...jobs.values()].sort(
            (a, b) => a.access - b.access,
          )[0];
          if (
            Date.now() - oldest.access < 20000 ||
            oldest.running ||
            oldest.initializing
          )
            throw Object.assign(
              Error(
                "Two history charts are already active. Close one and retry shortly.",
              ),
              { status: 429 },
            );
          oldest.access = 0;
          oldest.socket?.close();
          await save(oldest);
          jobs.delete(oldest.symbol);
        }
        job = {
          symbol,
          initializing: true,
          book: new Map(),
          gaps: [],
          cursor: undefined,
          latest: 0,
          exhausted: false,
          hours,
          access: Date.now(),
          pages: 0,
          savedAt: 0,
          error: "",
          retryAt: 0,
        };
        jobs.set(symbol, job);
        job.initial = bootstrap(job)
          .catch((error) => {
            if (jobs.get(symbol) === job) jobs.delete(symbol);
            throw error;
          })
          .finally(() => {
            job.initializing = false;
          });
      }
      return job;
    });
  acquisition = task;
  return task;
}
export async function secondsHistory(
  symbol,
  { seconds = 1, hours = 24, before, limit = 6000 } = {},
) {
  if (![1, 5].includes(seconds) || ![24, 72, 168].includes(hours))
    throw Error("Invalid second-based interval or range.");
  const job = await acquireJob(symbol, hours);
  job.access = Date.now();
  job.hours = hours;
  await job.initial;
  if (Date.now() >= job.retryAt) void work(job);
  const cutoff = Date.now() - hours * 3600000;
  const ordered = [...job.book.values()]
    .filter((b) => b.time >= cutoff)
    .sort((a, b) => a.time - b.time);
  // Build a small response window, leaving full retained history on the server.
  const end = before === undefined ? Infinity : before;
  const bars = candleWindow(
    ordered.filter((b) => b.time < end),
    seconds,
    Math.min(100000, Math.max(1, limit)),
    !job.gaps.length,
  );
  return {
    rows: bars.map(({ first, last, ...bar }) => bar),
    meta: {
      source: "Binance USDⓈ-M Futures · actual aggTrades",
      requestedHours: hours,
      seconds,
      oldest: ordered[0]?.time || null,
      newest: ordered.at(-1)?.time || null,
      pages: job.pages,
      complete:
        !!ordered.length &&
        (job.oldestTradeTime <= cutoff || job.exhausted) &&
        !job.gaps.length,
      gaps: job.gaps.length,
      loading: job.running,
      error: job.error,
      live: job.socket?.readyState === 1,
      hasOlder: ordered.some((b) => b.time < (bars[0]?.time ?? -Infinity)),
    },
  };
}

// A paused/closed tab must never leave a live socket running indefinitely.
setInterval(() => {
  for (const job of jobs.values()) {
    if (Date.now() - job.access > 20000) {
      job.socket?.close();
      job.socket = null;
    }
    if (Date.now() - job.access > 300000 && !job.running && !job.saving) {
      void save(job).then(() => {
        if (Date.now() - job.access > 300000 && jobs.get(job.symbol) === job)
          jobs.delete(job.symbol);
      });
    }
  }
}, 5000).unref();

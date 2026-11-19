import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";
import { market, candles, details } from "./providers.mjs";
import { secondsHistory } from "./seconds-history.mjs";
import { copilotIndex, copilotImage } from "./copilot-feed.mjs";
import { createMarketAlertFeed } from "./market-alerts.mjs";
import pkg from "./package.json" with { type: "json" };

const root = path.dirname(fileURLToPath(import.meta.url));
const intervals = new Set(["1m", "5m", "15m", "1h", "4h", "8h", "12h", "1d"]);
const routes = new Set([
  "health",
  "copilot/charts",
  "copilot/image",
  "market",
  "market-alerts",
  "details",
  "candles",
  "seconds",
]);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};
const badRequest = (message) => Object.assign(Error(message), { status: 400 });

export function inlineScriptHash(source) {
  // HTML parsing normalizes CRLF before the browser checks a script's CSP hash.
  return createHash("sha256")
    .update(source.replace(/\r\n?/g, "\n"))
    .digest("base64");
}
export async function createAppServer({
  port = 4173,
  dev = false,
  services = {},
} = {}) {
  const api = {
    market,
    candles,
    details,
    secondsHistory,
    copilotIndex,
    copilotImage,
    ...services,
  };
  const marketAlerts = createMarketAlertFeed(api);
  const vite = dev
    ? await (
        await import("vite")
      ).createServer({
        root,
        server: { middlewareMode: true, host: "127.0.0.1" },
        appType: "spa",
      })
    : null;
  const inlineScript = !dev
    ? await readFile(path.join(root, "dist/index.html"), "utf8")
        .then((html) => html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "")
        .catch(() => "")
    : "";
  const scriptHash = inlineScriptHash(inlineScript);
  let active = 0,
    windowStart = Date.now(),
    used = 0;
  const server = http.createServer(async (req, res) => {
    const fail = (status, message) => {
      if (!res.headersSent)
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      res.end(JSON.stringify({ error: message }));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (!dev)
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'sha256-${scriptHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
    let u;
    try {
      if (!req.url || req.url.length > 8192)
        return fail(414, "Request URL is too long");
      u = new URL(req.url, "http://localhost");
      const actualPort = server.address()?.port || port;
      if (
        ![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(
          req.headers.host,
        )
      )
        return fail(403, "Only local requests are allowed");
      if (
        (req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`) ||
        (req.headers["sec-fetch-site"] === "cross-site" &&
          !(
            req.headers["sec-fetch-mode"] === "navigate" &&
            req.headers["sec-fetch-dest"] === "document" &&
            !u.pathname.startsWith("/api/")
          ))
      )
        return fail(403, "Cross-origin requests are not allowed");
      decodeURIComponent(u.pathname);
    } catch {
      return fail(400, "Malformed request URL");
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return fail(405, "GET or HEAD only");
    if (u.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      if (req.method !== "GET") return fail(405, "GET only");
      const route = u.pathname.slice(5);
      if (!routes.has(route)) return fail(404, "Unknown endpoint");
      if (route === "health")
        return res.end(
          JSON.stringify({ ok: true, local: true, version: pkg.version }),
        );
      if (Date.now() - windowStart >= 60000) {
        used = 0;
        windowStart = Date.now();
      }
      if (active >= 8 || ++used > 360) {
        res.setHeader("Retry-After", "10");
        return fail(429, "Too many requests. Retry shortly.");
      }
      active++;
      try {
        if (route === "copilot/charts")
          return res.end(JSON.stringify(await api.copilotIndex()));
        if (route === "copilot/image") {
          const image = await api.copilotImage(
            u.searchParams.get("file") || "",
          );
          res.setHeader("Content-Type", "image/png");
          return res.end(image);
        }
        const exchange = u.searchParams.get("exchange") || "binance";
        if (!["binance", "hl"].includes(exchange))
          throw badRequest("Invalid exchange");
        if (route === "market")
          return res.end(JSON.stringify(await api.market(exchange)));
        if (route === "market-alerts")
          return res.end(JSON.stringify(await marketAlerts(exchange)));
        const symbols = (
          u.searchParams.get("symbols") ||
          u.searchParams.get("symbol") ||
          ""
        )
          .split(",")
          .filter(Boolean);
        if (
          !symbols.length ||
          symbols.length > 30 ||
          symbols.some((s) => !/^[-\p{L}\p{M}\p{N}_.:@/]{1,70}$/u.test(s))
        )
          throw badRequest("Invalid symbol selection (maximum 30)");
        const interval = u.searchParams.get("interval") || "1m";
        const seconds = Number(u.searchParams.get("seconds") || 1),
          hours = Number(u.searchParams.get("hours") || 24);
        const before = u.searchParams.has("before")
          ? Number(u.searchParams.get("before"))
          : undefined;
        const limit = Number(u.searchParams.get("limit") || 6000);
        if (
          route === "candles" &&
          (!intervals.has(interval) || symbols.length !== 1)
        )
          throw badRequest("Invalid interval or symbol count");
        if (
          route === "seconds" &&
          (exchange !== "binance" ||
            symbols.length !== 1 ||
            ![1, 5].includes(seconds) ||
            ![24, 72, 168].includes(hours) ||
            (before !== undefined &&
              (!Number.isSafeInteger(before) || before <= 0)) ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100000)
        )
          throw badRequest("Invalid second-based history window");
        const listed = new Set(
          (await api.market(exchange)).rows.map((row) => row.symbol),
        );
        if (symbols.some((s) => !listed.has(s)))
          throw badRequest("Unknown instrument");
        if (route === "seconds")
          return res.end(
            JSON.stringify(
              await api.secondsHistory(symbols[0], {
                seconds,
                hours,
                before,
                limit,
              }),
            ),
          );
        if (route === "candles")
          return res.end(
            JSON.stringify(
              await api.candles(exchange, symbols[0], interval, undefined, {
                interactive: true,
              }),
            ),
          );
        const result = await Promise.allSettled(
          symbols.map((s) => api.details(exchange, s)),
        );
        res.end(
          JSON.stringify({
            rows: result
              .filter((x) => x.status === "fulfilled")
              .map((x) => x.value),
            errors: result.flatMap((x, i) =>
              x.status === "rejected"
                ? [
                    {
                      symbol: symbols[i],
                      error: "Detailed metrics are temporarily unavailable",
                    },
                  ]
                : [],
            ),
          }),
        );
      } catch (error) {
        fail(
          error.status || 502,
          error.status
            ? error.message
            : "Data source is unavailable. Please retry shortly.",
        );
      } finally {
        active--;
      }
      return;
    }
    if (vite) return vite.middlewares(req, res);
    try {
      const destination = path.resolve(
        root,
        "dist",
        "." + decodeURIComponent(u.pathname),
      );
      const directory = path.join(root, "dist");
      if (
        destination !== directory &&
        !destination.startsWith(directory + path.sep)
      )
        return fail(403, "Invalid path");
      const file = await stat(destination)
        .then((s) =>
          s.isFile() ? destination : path.join(directory, "index.html"),
        )
        .catch(() => path.join(directory, "index.html"));
      const contents = await readFile(file);
      res.setHeader(
        "Content-Type",
        mime[path.extname(file)] || "application/octet-stream",
      );
      res.end(req.method === "HEAD" ? undefined : contents);
    } catch {
      fail(500, "Application build is unavailable. Run npm run build.");
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 60000;
  server.maxConnections = 64;
  server.on("close", () => {
    void vite?.close();
  });
  return server;
}
export async function startServer() {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("PORT must be an integer between 1 and 65535");
  const server = await createAppServer({
    port,
    dev: process.argv.includes("--dev"),
  });
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Port ${port} is already in use. Open the running screener or choose another PORT.`
        : "Unable to start the local server.",
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`REKTPLEB screener → http://127.0.0.1:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      server.close();
      setTimeout(() => process.exit(0), 25000).unref();
    });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await startServer();

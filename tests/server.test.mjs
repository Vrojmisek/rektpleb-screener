import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { createAppServer, inlineScriptHash } from "../server.mjs";
import { copilotIndex, copilotImage } from "../copilot-feed.mjs";

test("Windows and Unix HTML line endings produce the browser-normalized CSP hash", () => {
  assert.equal(
    inlineScriptHash("window.ready = true;\r\n"),
    "WMz/uUkpIfD429MH2BChUqXwHFQvIdkIACRP3tkkdQM=",
  );
  assert.equal(
    inlineScriptHash("window.ready = true;\n"),
    "WMz/uUkpIfD429MH2BChUqXwHFQvIdkIACRP3tkkdQM=",
  );
});
async function fixture(services = {}) {
  const server = await createAppServer({
    services: {
      market: async () => ({ rows: [{ symbol: "BTCUSDT" }] }),
      ...services,
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  return {
    port,
    request: (route, headers = {}, method = "GET") =>
      new Promise((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: route, headers, method },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () =>
              resolve({ status: res.statusCode, headers: res.headers, body }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
test("hostile Host, Origin and cross-site requests cannot reach data services", async () => {
  let calls = 0;
  const app = await fixture({
    market: async () => {
      calls++;
      return { rows: [] };
    },
  });
  try {
    assert.equal(
      (
        await app.request("/api/market", {
          host: `attacker.invalid:${app.port}`,
        })
      ).status,
      403,
    );
    assert.equal(
      (await app.request("/api/market", { origin: "https://attacker.invalid" }))
        .status,
      403,
    );
    assert.equal(
      (await app.request("/api/market", { "sec-fetch-site": "cross-site" }))
        .status,
      403,
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        await app.request("/api/health", {
          origin: `http://127.0.0.1:${app.port}`,
        })
      ).status,
      200,
    );
  } finally {
    await app.close();
  }
});
test("a normal top-level link can open the app, but cannot navigate to private APIs", async () => {
  const app = await fixture();
  try {
    const headers = {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    };
    assert.notEqual((await app.request("/", headers)).status, 403);
    assert.equal((await app.request("/api/health", headers)).status, 403);
  } finally {
    await app.close();
  }
});
test("malformed absolute URL and percent escapes return 400 without crashing", async () => {
  const app = await fixture();
  try {
    const raw = await new Promise((resolve, reject) => {
      let body = "";
      const socket = net.connect(app.port, "127.0.0.1", () =>
        socket.write(
          `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\nConnection: close\r\n\r\n`,
        ),
      );
      socket.on("data", (chunk) => (body += chunk));
      socket.on("end", () => resolve(body));
      socket.on("error", reject);
    });
    assert.match(raw, /HTTP\/1.1 400/);
    assert.equal((await app.request("/%ZZ")).status, 400);
    assert.equal((await app.request("/api/health")).status, 200);
  } finally {
    await app.close();
  }
});
test("invalid methods, endpoints, symbols and second windows reject before network work", async () => {
  let calls = 0;
  const app = await fixture({
    market: async () => {
      calls++;
      return { rows: [] };
    },
  });
  try {
    for (const [route, method, expected] of [
      ["/api/health", "POST", 405],
      ["/api/unknown", "GET", 404],
      ["/api/seconds?symbol=BTCUSDT&seconds=2", "GET", 400],
      ["/api/details?symbol=bad%3Cscript%3E", "GET", 400],
      ["/api/candles?symbol=BTCUSDT&interval=bad", "GET", 400],
    ])
      assert.equal((await app.request(route, {}, method)).status, expected);
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});
test("responses carry browser protections and hide internal upstream errors", async () => {
  const app = await fixture({
    market: async () => {
      throw Error("private/path or secret");
    },
  });
  try {
    const response = await app.request("/api/market");
    assert.equal(response.status, 502);
    assert.doesNotMatch(response.body, /private|secret/);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(
      response.headers["content-security-policy"],
      /frame-ancestors 'none'/,
    );
    assert.equal((await app.request("/%2e%2e%2fpackage.json")).status, 403);
  } finally {
    await app.close();
  }
});
test("request admission rejects excess parallel data work", async () => {
  let count = 0;
  let release;
  const barrier = new Promise((resolve) => (release = resolve));
  let ready;
  const admitted = new Promise((resolve) => (ready = resolve));
  const app = await fixture({
    market: async () => {
      if (++count === 8) ready();
      await barrier;
      return { rows: [] };
    },
  });
  const pending = Array.from({ length: 8 }, () => app.request("/api/market"));
  try {
    await admitted;
    assert.equal((await app.request("/api/market")).status, 429);
    assert.equal(count, 8);
  } finally {
    release();
    await Promise.all(pending);
    await app.close();
  }
});
test("Copilot defaults to disabled and cannot transfer an image", async () => {
  assert.deepEqual(await copilotIndex(), {
    enabled: false,
    connected: false,
    updatedAt: 0,
    items: [],
  });
  await assert.rejects(() => copilotImage("BTCUSDT_123.png"), /disabled/);
});

test("optional chart images prohibit persistent HTTP caching", async () => {
  const app = await fixture({
    copilotImage: async () => Buffer.from("image fixture"),
  });
  try {
    const response = await app.request(
      "/api/copilot/image?file=BTCUSDT_123.png",
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["content-type"], "image/png");
  } finally {
    await app.close();
  }
});

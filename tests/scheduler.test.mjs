import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDetailSymbol } from "../src/detail-scheduler.ts";
test("a due visible market takes priority over an unvisited scan backlog", () => {
  assert.equal(
    nextDetailSymbol({
      candidates: ["BACKLOG", "VISIBLE"],
      priority: ["VISIBLE"],
      attempted: new Map([["VISIBLE", 100000]]),
      measured: new Map(),
      inFlight: new Set(),
      now: 170000,
    }),
    "VISIBLE",
  );
});
test("failed attempts wait before retry and in-flight instruments are skipped", () => {
  const options = {
    candidates: ["VISIBLE"],
    priority: ["VISIBLE"],
    attempted: new Map([["VISIBLE", 170000]]),
    measured: new Map(),
    inFlight: new Set(),
    now: 170001,
  };
  assert.equal(nextDetailSymbol(options), undefined);
  assert.equal(nextDetailSymbol({ ...options, now: 235000 }), "VISIBLE");
  assert.equal(
    nextDetailSymbol({
      ...options,
      now: 235000,
      inFlight: new Set(["VISIBLE"]),
    }),
    undefined,
  );
});

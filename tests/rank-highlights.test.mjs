import { test } from "node:test";
import assert from "node:assert/strict";
import { rankChanges } from "../src/rank-changes.ts";

test("default settings ignore one-place moves and highlight moves of two", () => {
  assert.deepEqual(rankChanges(["A", "B"], ["B", "A"]), {});
  assert.deepEqual(rankChanges(["A", "B", "C"], ["C", "B", "A"]), {
    C: 2,
    A: -2,
  });
});
test("one-place threshold highlights both upward and downward moves", () => {
  assert.deepEqual(rankChanges(["A", "B"], ["B", "A"], 1), { B: 1, A: -1 });
});
test("a higher threshold ignores smaller movements", () => {
  assert.deepEqual(rankChanges(["A", "B", "C"], ["C", "B", "A"], 3), {});
});
test("disabled highlights report no movements even above the threshold", () => {
  assert.deepEqual(rankChanges(["A", "B", "C"], ["C", "B", "A"], 1, false), {});
});
test("new instruments do not generate an initial movement", () => {
  assert.deepEqual(rankChanges(["A", "B"], ["NEW", "A", "B"], 1), {
    A: -1,
    B: -1,
  });
});

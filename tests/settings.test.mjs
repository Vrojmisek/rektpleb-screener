import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validPreference,
  importPreferences,
  readPreference,
  exportPreferences,
} from "../src/settings.ts";
test("settings import rejects inherited operators and applies no partial changes", () => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
  importPreferences({
    version: 1,
    preferences: {
      theme: "light",
      rankHighlights: {enabled:false,minPositions:1},
      "filters:binance": [{ column: "price", operator: "gt", value: 3 }],
    },
  });
  Object.defineProperties(
    globalThis.localStorage,
    Object.fromEntries(
      [...map.keys()].map((key) => [
        key,
        { value: map.get(key), enumerable: true, configurable: true },
      ]),
    ),
  );
  const backup = exportPreferences();
  assert.equal(backup.preferences.theme, "light");
  assert.deepEqual(backup.preferences.rankHighlights, {enabled:false,minPositions:1});
  map.clear();
  importPreferences(backup);
  assert.deepEqual(readPreference("rankHighlights",null), {enabled:false,minPositions:1});
  assert.equal(readPreference("theme", "dark"), "light");
  assert.equal(
    validPreference("filters:binance", [
      { column: "price", operator: "toString", value: 3 },
    ]),
    false,
  );
  assert.throws(
    () =>
      importPreferences({
        version: 1,
        preferences: {
          theme: "dark",
          "filters:binance": [
            { column: "price", operator: "toString", value: 3 },
          ],
        },
      }),
    /Invalid/,
  );
  assert.equal(readPreference("theme", "dark"), "light");
  assert.equal(
    validPreference("filters:binance", [
      { column: "price", operator: "between", value: 10, value2: 3 },
    ]),
    false,
  );
  delete globalThis.localStorage;
});

test("rank highlight preferences reject unsupported thresholds", () => {
  for (const value of [0,101,1.5,"2",null]) assert.equal(validPreference("rankHighlights", {enabled:true,minPositions:value}),false);
  assert.equal(validPreference("rankHighlights", {enabled:"yes",minPositions:2}),false);
  assert.equal(validPreference("rankHighlights", {enabled:true,minPositions:2}),true);
});

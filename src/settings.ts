import { columns, operators, type Filter } from "./metrics.ts";
export const STORAGE_PREFIX = "rektpleb-screener:";
const ids = new Set(columns.map((c) => c.id));
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" && v.length <= 100;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
function filter(v: unknown): v is Filter {
  return (
    record(v) &&
    typeof v.column === "string" &&
    ids.has(v.column) &&
    typeof v.operator === "string" &&
    Object.hasOwn(operators, v.operator) &&
    num(v.value) &&
    (v.operator !== "between" ||
      (num(v.value2) && Number(v.value2) >= Number(v.value)))
  );
}
export function validPreference(key: string, v: unknown): boolean {
  if (key === "exchange") return v === "binance" || v === "hl";
  if (key === "profile") return text(v);
  if (
    ["tourDone", "announcement"].includes(key) ||
    /^(trend|favoritesOnly):/.test(key)
  )
    return typeof v === "boolean";
  if (key.startsWith("sort:"))
    return (
      record(v) &&
      typeof v.column === "string" &&
      ids.has(v.column) &&
      (v.direction === "asc" || v.direction === "desc")
    );
  if (key.startsWith("columns:"))
    return (
      Array.isArray(v) &&
      v.length <= columns.length &&
      v.includes("symbol") &&
      v.every((x) => typeof x === "string" && ids.has(x)) &&
      new Set(v).size === v.length
    );
  if (key.startsWith("favorites:"))
    return Array.isArray(v) && v.length <= 3000 && v.every(text);
  if (key.startsWith("filters:"))
    return Array.isArray(v) && v.length <= 100 && v.every(filter);
  if (key.startsWith("presets:"))
    return (
      Array.isArray(v) &&
      v.length <= 100 &&
      v.every(
        (x) =>
          record(x) &&
          text(x.name) &&
          Array.isArray(x.filters) &&
          x.filters.length <= 100 &&
          x.filters.every(filter),
      )
    );
  if (key === "rankHighlights") return record(v) && typeof v.enabled === "boolean" && Number.isInteger(v.minPositions) && Number(v.minPositions) >= 1 && Number(v.minPositions) <= 100;
  if (key === "theme") return v === "light" || v === "dark";
  if (key === "alerts")
    return (
      Array.isArray(v) &&
      v.length <= 100 &&
      v.every(
        (x) =>
          record(x) &&
          text(x.id) &&
          text(x.symbol) &&
          typeof x.enabled === "boolean" &&
          (x.exchange === "hl" || x.exchange === "binance") &&
          filter(x) &&
          x.operator !== "between",
      )
    );
  if (key === "alertEvents")
    return (
      Array.isArray(v) &&
      v.length <= 100 &&
      v.every(
        (x) =>
          record(x) &&
          text(x.id) &&
          typeof x.text === "string" &&
          x.text.length <= 500 &&
          num(x.time),
      )
    );
  return false;
}
export function readPreference<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) || "null");
    return validPreference(key, v) ? v : fallback;
  } catch {
    return fallback;
  }
}
export function importPreferences(value: unknown) {
  if (!record(value) || value.version !== 1 || !record(value.preferences))
    throw Error("Invalid settings file");
  const entries = Object.entries(value.preferences).filter(([k]) =>
    /^(columns|sort|trend|filters|favorites|favoritesOnly|presets):(binance|hl)$|^(alerts|profile|tourDone|announcement|exchange|alertEvents|theme|rankHighlights)$/.test(
      k,
    ),
  );
  if (!entries.length) throw Error("No supported settings found");
  if (!entries.every(([k, v]) => validPreference(k, v)))
    throw Error("Invalid preference values");
  const old = entries.map(
    ([k]) => [k, localStorage.getItem(STORAGE_PREFIX + k)] as const,
  );
  try {
    for (const [k, v] of entries)
      localStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(v));
  } catch (e) {
    for (const [k, v] of old) {
      if (v === null) localStorage.removeItem(STORAGE_PREFIX + k);
      else localStorage.setItem(STORAGE_PREFIX + k, v);
    }
    throw e;
  }
}

export function exportPreferences() {
  const preferences = Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .map((key) => [
        key.slice(STORAGE_PREFIX.length),
        readPreference(key.slice(STORAGE_PREFIX.length), null),
      ]),
  );
  return { version: 1, preferences };
}

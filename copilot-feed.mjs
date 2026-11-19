import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { market } from "./providers.mjs";
const enabled = process.env.COPILOT_ENABLED === "true";
const sshHost = process.env.COPILOT_SSH_HOST || "";
const validHost = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(sshHost);
const imagePattern = /^[A-Z0-9]+USDT_(?:multi_)?\d+\.png$/;
let indexCache = null,
  indexAt = 0,
  indexPending = null;
const images = new Map();
const imagePending = new Map();
let activeImages = 0;
const imageWaiters = [];
async function imageTransfer(name) {
  if (activeImages >= 2) {
    if (imageWaiters.length >= 8) throw Error("Image transfer queue is full");
    await new Promise((resolve) => imageWaiters.push(resolve));
  }
  activeImages++;
  try {
    return await remote({ mode: "image", name });
  } finally {
    activeImages--;
    imageWaiters.shift()?.();
  }
}
let imageBytes = 0;
const imageCacheLimit = 8 * 1024 * 1024;
const imageCacheTtl = 5 * 60 * 1000;
function removeImage(name) {
  const cached = images.get(name);
  if (!cached) return;
  imageBytes -= cached.buffer.length;
  images.delete(name);
}
function clearExpiredImages() {
  const now = Date.now();
  for (const [name, cached] of images)
    if (now - cached.at >= imageCacheTtl) removeImage(name);
}
setInterval(clearExpiredImages, 60000).unref();
async function remote(request) {
  const program =
    "REQUEST = " +
    JSON.stringify({
      ...request,
      root: process.env.COPILOT_ROOT || "/opt/crypto-copilot",
    }) +
    "\n" +
    (await readFile(new URL("./copilot-read.py", import.meta.url), "utf8"));
  return new Promise((resolve, reject) => {
    const child = execFile(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=6",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
        sshHost,
        "python3",
        "-",
      ],
      {
        windowsHide: true,
        encoding: "buffer",
        timeout: 18000,
        maxBuffer: 14 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error)
          return reject(
            new Error(
              "VPS is unreachable. Check the connection and SSH profile.",
            ),
          );
        resolve(stdout);
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end(program);
  });
}
export async function copilotIndex() {
  if (!enabled)
    return { enabled: false, connected: false, updatedAt: 0, items: [] };
  if (!validHost)
    return {
      enabled: true,
      connected: false,
      updatedAt: 0,
      items: [],
      error: "Set COPILOT_SSH_HOST to an existing SSH alias, then restart.",
    };
  if (indexCache && Date.now() - indexAt < 20000)
    return { ...indexCache, connected: true };
  if (indexPending) return indexPending;
  indexPending = Promise.all([remote({ mode: "index" }), market("binance")])
    .then(([buffer, listing]) => {
      const value = JSON.parse(buffer.toString("utf8"));
      if (!Array.isArray(value.items)) throw Error("Invalid VPS response");
      const crypto = new Set(listing.rows.map((row) => row.symbol));
      const newest = value.items.find(
        (item) =>
          item &&
          crypto.has(item.symbol) &&
          typeof item.file === "string" &&
          imagePattern.test(item.file) &&
          typeof item.id === "string" &&
          Number.isFinite(item.sentAt) &&
          Math.abs(item.sentAt) <= 8.64e15 &&
          typeof item.label === "string",
      );
      indexCache = {
        updatedAt: Date.now(),
        items: newest
          ? [
              {
                id: newest.id,
                symbol: newest.symbol,
                file: newest.file,
                sentAt: newest.sentAt,
                label: newest.label,
              },
            ]
          : [],
      };
      indexAt = Date.now();
      return { ...indexCache, connected: true };
    })
    .catch(() => {
      return {
        ...(indexCache ?? { items: [], updatedAt: 0 }),
        connected: false,
        error: "Copilot feed unavailable. Check the SSH connection.",
      };
    })
    .finally(() => {
      indexPending = null;
    });
  return indexPending;
}
export async function copilotImage(name) {
  if (!enabled)
    throw Object.assign(Error("Copilot is disabled"), { status: 404 });
  if (!imagePattern.test(name)) throw Error("Invalid image");
  const index = await copilotIndex();
  if (!index.items.some((item) => item.file === name))
    throw Error("Image is not in the current feed");
  clearExpiredImages();
  if (images.has(name)) {
    const cached = images.get(name);
    images.delete(name);
    images.set(name, cached);
    return cached.buffer;
  }
  if (imagePending.has(name)) return imagePending.get(name);
  const pending = imageTransfer(name)
    .then((buffer) => {
      if (
        buffer.length < 8 ||
        buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      )
        throw Error("VPS returned an invalid PNG image");
      while (imageBytes + buffer.length > imageCacheLimit && images.size) {
        const first = images.keys().next().value;
        removeImage(first);
      }
      if (buffer.length <= imageCacheLimit) {
        images.set(name, { buffer, at: Date.now() });
        imageBytes += buffer.length;
      }
      return buffer;
    })
    .finally(() => imagePending.delete(name));
  imagePending.set(name, pending);
  return pending;
}

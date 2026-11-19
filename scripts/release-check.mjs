import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const releaseEntries = [
  "src",
  "public",
  "licenses",
  "docs",
  "tests",
  "scripts",
  ".github",
  "README.md",
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "PRODUCT.md",
  "DESIGN.md",
  "CHANGELOG.md",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".env.example",
  ".nvmrc",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "index.html",
  "server.mjs",
  "providers.mjs",
  "seconds-history.mjs",
  "market-math.mjs",
  "market-policy.mjs",
  "market-policy.test.mjs",
  "copilot-feed.mjs",
  "copilot-read.py",
  "start.cmd",
];
const root = fileURLToPath(new URL("..", import.meta.url));
export async function releaseFiles() {
  const files = [];
  const walk = async (rel) => {
    const absolute = path.join(root, rel);
    const entries = await readdir(absolute, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === "ENOTDIR") return null;
        throw error;
      },
    );
    if (entries === null) {
      files.push(rel);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw Error("Release contains a symbolic link");
      await walk(path.join(rel, entry.name));
    }
  };
  for (const entry of releaseEntries) await walk(entry);
  return files;
}
export async function checkRelease() {
  const files = await releaseFiles();
  for (const rel of files) {
    if (
      /(?:^|[\\/])(?:\.env(?:\..+)?|node_modules|\.cache|__pycache__|\.git)(?:[\\/]|$)/.test(
        rel,
      ) &&
      rel !== ".env.example"
    )
      throw Error(`Private runtime path in release: ${rel}`);
    if (/\.(?:log|session|db|sqlite|pem|key|pyc)$/i.test(rel))
      throw Error(`Private file in release: ${rel}`);
    if (/\.(?:png|jpg|woff2?|svg)$/i.test(rel)) continue;
    const text = await readFile(path.join(root, rel), "utf8");
    if (
      /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text) ||
      /gh[pousr]_[A-Za-z0-9]{30,}/.test(text) ||
      /github_pat_[A-Za-z0-9_]{40,}/.test(text) ||
      /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(text)
    )
      throw Error(`Possible credential in ${rel}`);
  }
  return files.length;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(
    `Release source check passed: ${await checkRelease()} files. Runtime state excluded by explicit manifest.`,
  );

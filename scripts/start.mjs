import { existsSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error(
    "REKTPLEB requires Node.js 24 or newer. Download it from https://nodejs.org/",
  );
  process.exit(1);
}
if (existsSync(new URL("../.env", import.meta.url))) {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
}
if (!existsSync(new URL("../dist/index.html", import.meta.url))) {
  console.log("Preparing the screener for its first start...");
  execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vite/bin/vite.js", import.meta.url),
      ),
      "build",
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit" },
  );
}
const server = await (await import("../server.mjs")).startServer();
if (process.argv.includes("--open")) {
  server.once("listening", () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    const [command, args] =
      process.platform === "win32"
        ? [
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `Start-Process '${url}'`,
            ],
          ]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    execFile(command, args, { windowsHide: true }, () => {});
  });
}

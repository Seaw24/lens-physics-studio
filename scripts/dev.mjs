import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadEnv } from "vite";

const env = loadEnv("development", process.cwd(), "");
const certPath = env.DISCOVERY_TLS_CERT
  ? path.resolve(env.DISCOVERY_TLS_CERT)
  : null;
const keyPath = env.DISCOVERY_TLS_KEY
  ? path.resolve(env.DISCOVERY_TLS_KEY)
  : null;
const useTls = Boolean(
  certPath &&
    keyPath &&
    fs.existsSync(certPath) &&
    fs.existsSync(keyPath),
);
const viteHost = useTls ? "0.0.0.0" : "127.0.0.1";

const children = [
  spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "watch", "server/index.ts"],
    { stdio: "inherit", windowsHide: true },
  ),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", viteHost],
    { stdio: "inherit", windowsHide: true },
  ),
];
function stop() {
  for (const child of children) child.kill();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((child) =>
  child.on("exit", (code) => {
    if (code && code !== 0) stop();
  }),
);

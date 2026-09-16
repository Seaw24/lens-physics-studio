import { spawn } from "node:child_process";
const children = [
  spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "watch", "server/index.ts"],
    { stdio: "inherit", windowsHide: true },
  ),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
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

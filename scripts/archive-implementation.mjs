import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = path.resolve(".");
const outputDirectory = path.join(repository, ".runtime", "discovery", "exports");
const output = path.join(outputDirectory, "lens-discovery-v2-source.tar.gz");
const { stdout } = await exec("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
], { cwd: repository, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });

const mediaExtension = /\.(?:avif|gif|heic|jpe?g|m4a|mov|mp3|mp4|png|wav|webm)$/i;
const privatePrefix = /^(?:\.runtime\/|docs\/detection\/(?:data-audit|vision-pilot)\/)/;
const files = stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((file) => !privatePrefix.test(file))
  .filter((file) => !mediaExtension.test(file))
  .filter((file) => !/(?:^|\/)workshop-credentials(?:\.|$)/i.test(file))
  .filter((file) => file === ".env.example" || !/(?:^|\/)\.env(?:\.|$)/.test(file))
  .sort();

if (!files.length) throw new Error("No source files were selected for the archive.");
await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
await fs.unlink(output).catch((error) => {
  if (error?.code !== "ENOENT") throw error;
});
await new Promise((resolve, reject) => {
  const child = spawn("tar", ["-czf", output, "--null", "-T", "-"], {
    cwd: repository,
    stdio: ["pipe", "ignore", "pipe"],
    shell: false,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (code) =>
    code === 0 ? resolve() : reject(new Error(stderr || `tar exited ${code}`)),
  );
  child.stdin.end(`${files.join("\0")}\0`);
});
const bytes = await fs.readFile(output);
const manifest = {
  output: path.relative(repository, output),
  files: files.length,
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  exclusions: [
    "ignored files (including .runtime, credentials, node_modules, and build output)",
    "media extensions",
    "private data-audit and raw vision-pilot records",
  ],
};
await fs.writeFile(
  path.join(outputDirectory, "lens-discovery-v2-source.manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify(manifest, null, 2));

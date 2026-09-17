import fs from "node:fs/promises";
import { loadDiscoveryConfig, safeDiscoveryConfig } from "../server/discovery/config";
import { DiscoveryService } from "../server/discovery/service";

const args = new Set(process.argv.slice(2));
const invoke = args.has("--invoke");
const serverIndex = process.argv.indexOf("--server");
const server = serverIndex >= 0 ? process.argv[serverIndex + 1] : null;

if (server) {
  if (!invoke) {
    console.log(
      JSON.stringify(
        {
          invoked: false,
          note: "No HTTP request was made. Add --invoke to run the server preflight.",
          server,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  const code = process.env.DISCOVERY_ACCESS_CODE;
  if (!code) throw new Error("DISCOVERY_ACCESS_CODE is required for server preflight.");
  const login = await fetch(`${server.replace(/\/$/, "")}/api/discovery/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: server },
    body: JSON.stringify({ code }),
  });
  if (!login.ok) throw new Error(`Controller login failed (${login.status}).`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  const response = await fetch(
    `${server.replace(/\/$/, "")}/api/discovery/preflight`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: server,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ invoke: true }),
    },
  );
  console.log(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
} else {
  const config = loadDiscoveryConfig();
  const local = safeDiscoveryConfig(config);
  const details = {
    invoked: false,
    local,
    credentialsFileReadable: config.credentialsFile
      ? await fs
          .access(config.credentialsFile)
          .then(() => true)
          .catch(() => false)
      : null,
    note: invoke
      ? undefined
      : "Local dependency/configuration check only. Add --invoke for two counted chronological-image model checks.",
  };
  if (!invoke) console.log(JSON.stringify(details, null, 2));
  else {
    const service = await DiscoveryService.create(config);
    try {
      console.log(JSON.stringify(await service.preflight(true), null, 2));
    } finally {
      await service.close();
    }
  }
}

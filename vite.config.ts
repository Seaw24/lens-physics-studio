import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
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
  const https = useTls
    ? { cert: fs.readFileSync(certPath!), key: fs.readFileSync(keyPath!) }
    : undefined;
  const apiTarget =
    env.MOMENTUM_API_TARGET ||
    (useTls ? "https://127.0.0.1:8787" : "http://127.0.0.1:8787");
  const viteOrigin = useTls
    ? "https://127.0.0.1:5173"
    : "http://127.0.0.1:5173";

  return {
    plugins: [react()],
    server: {
      host: useTls ? "0.0.0.0" : "127.0.0.1",
      port: 5173,
      strictPort: true,
      https,
      proxy: {
        "/api": {
          target: apiTarget,
          // Local mkcert / workshop certs are trusted by the browser, not by Node.
          secure: false,
          // The API trusts the default Vite origin; keep that when the browser
          // origin is another local port or the LAN public origin.
          configure: (proxy) =>
            proxy.on("proxyReq", (request) => {
              const origin = String(request.getHeader("origin") ?? "");
              if (
                /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
                (env.DISCOVERY_PUBLIC_ORIGIN &&
                  origin === new URL(env.DISCOVERY_PUBLIC_ORIGIN).origin)
              )
                request.setHeader("origin", viteOrigin);
            }),
        },
      },
    },
    build: { chunkSizeWarningLimit: 800 },
  };
});

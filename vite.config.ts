import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.MOMENTUM_API_TARGET || "http://127.0.0.1:8787",
        // The API trusts the default dev origin; keep that working when Vite runs on another local port.
        configure: (proxy) =>
          proxy.on("proxyReq", (request) => {
            const origin = String(request.getHeader("origin") ?? "");
            if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
              request.setHeader("origin", "http://127.0.0.1:5173");
          }),
      },
    },
  },
  build: { chunkSizeWarningLimit: 800 },
});

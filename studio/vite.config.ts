import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Served by Caddy at http://<instance>/studio/ (same origin as ComfyUI, so no CORS).
// `npm run dev` proxies the API to a running instance: COMFY=http://user:pass@host:port npm run dev
const target = process.env.COMFY || "http://127.0.0.1:8188";
export default defineConfig({
  base: "/studio/",
  // when this Studio was built: the header and the Check everything report show it, so you can tell which image a rental runs
  define: { __BUILT__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC") },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: Object.fromEntries(
      ["/api", "/prompt", "/queue", "/history", "/view", "/upload", "/object_info", "/interrupt", "/ws", "/studio-api", "/h3-status", "/userdata", "/system_stats"].map((p) => [
        p,
        { target, changeOrigin: true, ws: p === "/ws" },
      ]),
    ),
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
});

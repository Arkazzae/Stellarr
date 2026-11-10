import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const apiOrigin = loadEnv(mode, process.cwd(), "").STELLARR_API_ORIGIN || "http://127.0.0.1:5000";

  return {
    // nginx serves the production build under /ops/.
    base: mode === "production" ? "/ops/" : "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
    server: {
      proxy: { "/api": apiOrigin, "/health": apiOrigin },
    },
  };
});

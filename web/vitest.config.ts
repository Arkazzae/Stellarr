import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // A guard against a hung test, not a performance budget. The default 5 s
    // is generous on an idle machine, but the deploy runs this suite right
    // after a containerised `dotnet test`, and under that load the typing
    // simulated by `userEvent` tests ran past it in unrelated files at once.
    testTimeout: 20_000,
  },
});

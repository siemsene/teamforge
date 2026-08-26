import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // highs must be *pre-bundled*, not excluded.
    //
    // The published package is CommonJS with bare `node:` imports, and the only
    // thing that imports it is solver/worker.ts. Excluding it left the dev server
    // handing that raw file straight to a module worker, which cannot parse it —
    // so `npm run dev` failed every solve with an empty "Solver crashed" and the
    // whole allocation step was untestable locally. Production was unaffected,
    // because rollup bundles it either way, which is what kept this hidden.
    include: ["highs"],
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// SINGLE=1 builds one self-contained bundle (used for the shareable preview); the normal build code-splits per page.
const single = process.env.SINGLE === "1";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 600,
    rollupOptions: single ? { output: { inlineDynamicImports: true } } : {},
  },
  test: { environment: "node" },
});

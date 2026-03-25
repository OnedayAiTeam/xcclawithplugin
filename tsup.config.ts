import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts", "setup-entry.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: true,
  splitting: false,
  external: ["openclaw", "ws"],
  outDir: "dist",
});

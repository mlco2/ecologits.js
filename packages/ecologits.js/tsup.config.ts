import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    format: ["esm", "cjs"],
    target: "node20",
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
});

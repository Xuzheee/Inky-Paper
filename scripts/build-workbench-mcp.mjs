import { build } from "esbuild";
await build({
  entryPoints: ["integrations/inky-paper-mcp-server/index.mjs"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  outfile: "src-tauri/resources/paper-mcp.mjs",
  logLevel: "warning",
});

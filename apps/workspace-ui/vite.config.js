import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localWorkspacePlugin } from "./server/local-workspace-plugin.mjs";

export default defineConfig({
  plugins: [react(), ...(process.env.TEN_WORKSPACE_ROOT ? [localWorkspacePlugin(process.env.TEN_WORKSPACE_ROOT)] : [])],
  define: {
    __TEN_WORKSPACE_SOURCE__: JSON.stringify(process.env.TEN_WORKSPACE_ROOT ? "local" : "fixture"),
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
  },
});

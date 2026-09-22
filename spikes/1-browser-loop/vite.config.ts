import { defineConfig } from "vite";

// No node polyfills configured on purpose — spike 1 sub-criterion B needs
// the build to FAIL if the OpenRouter provider bundle pulls in a Node-only
// API. See docs/spikes/spike-1-browser-loop.md for the result.
export default defineConfig({
  build: {
    target: "es2022",
  },
});

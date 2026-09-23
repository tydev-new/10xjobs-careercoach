import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same posture as spikes/1-browser-loop/vite.config.ts: no Node polyfills,
// so a build that accidentally pulls in a Node-only API fails loudly.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
  },
});

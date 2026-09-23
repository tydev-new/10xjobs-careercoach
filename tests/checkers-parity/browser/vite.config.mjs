import { fileURLToPath } from "node:url";
const PKG = fileURLToPath(new URL("../../../packages/checkers/node_modules/", import.meta.url));
export default {
  build: { target: "es2022", chunkSizeWarningLimit: 5000 },
  resolve: { alias: { "just-bash": PKG + "just-bash/dist/bundle/browser.js" } },
};

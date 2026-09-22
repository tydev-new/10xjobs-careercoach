import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "./styles.css";
import { App } from "./App";
import { fixtureWorkspaceProvider } from "./resources/fixture-provider";
import { httpWorkspaceProvider } from "./resources/http-provider";

const provider = __TEN_WORKSPACE_SOURCE__ === "local" ? httpWorkspaceProvider : fixtureWorkspaceProvider;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App provider={provider} />
  </React.StrictMode>,
);

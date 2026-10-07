/**
 * Frontend entry point: mounts the React tree and loads global styles.
 */

import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/calendar.css";
import "./styles/views.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

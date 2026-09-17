import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/fraunces/wght-italic.css";
import App from "./App";
import "./styles.css";
import "./readability.css";
import "./basketball.css";
import "./coaching.css";
import "./theme-legacy.css";
import "./theme.css";
import "./landing.css";
import PhoneCapture from "./discovery/PhoneCapture";

const RootComponent =
  window.location.pathname === "/capture" ? PhoneCapture : App;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);

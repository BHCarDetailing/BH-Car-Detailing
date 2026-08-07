import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import LoadingScreen from "./components/LoadingScreen";
import "@fontsource-variable/inter";
import "@fontsource-variable/oswald";
import "./index.css";

/** Branded boot splash: shows once on hard load, then reveals the app.
    Skipped for users who prefer reduced motion. */
function Boot() {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [booting, setBooting] = useState(!reduce);
  useEffect(() => {
    if (!booting) return;
    const t = setTimeout(() => setBooting(false), 1150);
    return () => clearTimeout(t);
  }, [booting]);
  return (
    <>
      <App />
      {booting && <LoadingScreen />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Boot />
    </BrowserRouter>
  </React.StrictMode>
);

// Register the PWA service worker (installable to phone home screen).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

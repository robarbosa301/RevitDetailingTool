import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import PranchetaBIM from "./App.jsx";
import "./index.css";

// The DSN isn't secret (it ends up in the public bundle either way, same as
// the Firebase config) — it only identifies where to send error reports, it
// can't be used to read/write anything. No tracing/session replay: those
// would need a privacy-policy update (session replay records real screens)
// and aren't needed just to see when/where the app crashes for a field crew.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn });
}

function CrashFallback({ eventId }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center", background: "#141311", color: "#F3F1EA", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Algo deu errado.</div>
      <div style={{ fontSize: 12, color: "#A39D90", maxWidth: 320 }}>
        O erro foi registrado automaticamente. Seus dados já salvos não foram perdidos — feche e abra o app de novo pra continuar.
      </div>
      {eventId && <div style={{ fontSize: 10, color: "#7A756B" }}>Código: {eventId}</div>}
      <button onClick={() => window.location.reload()}
        style={{ marginTop: 8, padding: "10px 20px", borderRadius: 12, background: "#F2F1ED", color: "#141311", border: "none", fontSize: 13, fontWeight: 600 }}>
        Recarregar
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={({ eventId }) => <CrashFallback eventId={eventId} />}>
      <PranchetaBIM />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // updateViaCache: "none" stops the browser from ever satisfying the SW
    // script fetch itself from HTTP cache — without it, an already-cached
    // sw.js can make every future deploy invisible even though the site's
    // own network-first fetch logic is otherwise correct. The explicit
    // update() call forces an immediate check instead of waiting for the
    // browser's own (much longer) update heuristic.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .then((reg) => reg.update());
  });
}

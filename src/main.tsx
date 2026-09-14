import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DataProvider } from "./data/DataProvider";
import ErrorBoundary from "./ErrorBoundary";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./styles.css";
import "./features/signatures/signatures.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DataProvider>
        <App />
      </DataProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

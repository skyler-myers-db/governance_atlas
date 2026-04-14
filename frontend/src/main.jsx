import React from "react";
import ReactDOM from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ReactFlowProvider>
  </React.StrictMode>
);

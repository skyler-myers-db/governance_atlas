import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import { atlasQueryClient } from "./lib/queryClient";
import "./styles/app.css";
import "./styles/lineage.css";
import "./styles/discovery.css";
import "./styles/entity.css";
import "./styles/governance.css";
import "./styles/shell-rail.css";
import "./styles/capability-dashboard.css";
import "./styles/insights.css";
import "./styles/northstar.css";
import "./styles/lineage-v2.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={atlasQueryClient}>
        <ReactFlowProvider>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </ReactFlowProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);

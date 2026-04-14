import { useEffect, useMemo, useState } from "react";
import { fetchBootstrap } from "../lib/api";

function initialBootstrap() {
  if (typeof window === "undefined") return null;
  return window.__GOVHUB_BOOTSTRAP__ || null;
}

export function useBootstrap() {
  const seeded = useMemo(() => initialBootstrap(), []);
  const seededHealthy =
    Boolean(seeded) &&
    seeded?.bootState === "live" &&
    Number(seeded?.discovery?.summary?.visibleAssets || 0) > 0;
  const [state, setState] = useState({
    loading: !seeded,
    refreshing: Boolean(seeded),
    error: "",
    refreshError: "",
    data: seeded,
  });

  useEffect(() => {
    let canceled = false;
    let timeoutId = 0;
    let idleId = 0;
    const refreshBootstrap = () => {
      if (canceled) return;
      setState((current) => ({
        loading: !current.data,
        refreshing: true,
        error: current.data ? "" : current.error,
        refreshError: "",
        data: current.data,
      }));
      fetchBootstrap()
        .then((data) => {
          if (canceled) return;
          setState({ loading: false, refreshing: false, error: "", refreshError: "", data });
        })
        .catch((error) => {
          if (canceled) return;
          const message = error?.message || "Failed to load Governance Hub bootstrap payload.";
          setState((current) =>
            current.data
              ? {
                  loading: false,
                  refreshing: false,
                  error: "",
                  refreshError: message,
                  data: current.data,
                }
              : {
                  loading: false,
                  refreshing: false,
                  error: message,
                  refreshError: "",
                  data: null,
                },
          );
        });
    };

    if (!seeded) {
      refreshBootstrap();
    } else if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(refreshBootstrap, { timeout: seededHealthy ? 9000 : 3200 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(refreshBootstrap, seededHealthy ? 3000 : 1200);
    } else {
      refreshBootstrap();
    }

    return () => {
      canceled = true;
      if (typeof window !== "undefined" && idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (typeof window !== "undefined" && timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [seeded, seededHealthy]);

  return state;
}
